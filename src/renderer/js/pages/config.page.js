(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  function $(id) {
    return document.getElementById(id);
  }

  function configClient() {
    return window._nekoModules?.services?.ConfigClient || null;
  }

  function isLocalServerUrl(serverUrl) {
    return String(serverUrl || '').includes('localhost') || String(serverUrl || '').includes('127.0.0.1');
  }

  function setButtonFeedback(button, html, className) {
    if (!button) return;
    if (/ph-spinner|ph-circle-notch/.test(html)) {
      const label = String(html).replace(/<[^>]+>/g, '').trim() || '处理中…';
      window._nekoUIHelpers?.setButtonBusy?.(button, true, { label });
      return;
    }
    window._nekoUIHelpers?.setButtonBusy?.(button, false);
    button.innerHTML = html;
    if (className) button.classList.add(className);
  }

  function resetButtonFeedback(button, originalHtml, className) {
    if (!button) return;
    window._nekoUIHelpers?.setButtonBusy?.(button, false);
    button.innerHTML = originalHtml;
    if (className) button.classList.remove(className);
    button.disabled = false;
  }

  const ConfigPage = {
    _initialized: false,
    _deps: {},

    init(deps = {}) {
      if (this._initialized) return;
      this._initialized = true;
      this._deps = {
        addLogLine: () => {},
        showNotice: () => {},
        showTakeoverConfirmDialog: async () => false,
        reopenAuthModal: () => {},
        ...deps,
      };

      $('btnConfigKey')?.addEventListener('click', () => this.loadConfigToModal());
      $('stgConfigBtn')?.addEventListener('click', () => this.loadConfigToModal());
      this.bindSaveButton();
    },

    async loadConfigToModal() {
      const cfg = await configClient()?.getAll?.();
      if (!cfg) return;

      const urlInput = $('configUrlInput');
      const keyInput = $('configApiKeyInput');
      const isLocal = cfg.serverMode === 'local';

      if (urlInput) urlInput.value = isLocal ? cfg.serverUrlLocal : cfg.serverUrlProd;
      if (keyInput) keyInput.value = cfg.deviceKey || '';

      const switcher = $('configModeSwitcher');
      if (switcher) {
        switcher.querySelectorAll('.modal-mode-btn').forEach((button) => {
          button.classList.toggle('active', button.dataset.mode === (isLocal ? 'local' : 'server'));
        });
      }
    },

    bindSaveButton() {
      const saveBtn = $('saveConfigBtn');
      if (!saveBtn || saveBtn.dataset.configPageBound === '1') return;

      const boundButton = saveBtn.cloneNode(true);
      boundButton.dataset.configPageBound = '1';
      saveBtn.parentNode.replaceChild(boundButton, saveBtn);
      boundButton.addEventListener('click', () => this.saveConfig());
    },

    async saveConfig() {
      const client = configClient();
      const saveBtn = $('saveConfigBtn');
      if (!client || !saveBtn) return;

      const urlInput = $('configUrlInput');
      const keyInput = $('configApiKeyInput');
      const serverUrl = urlInput?.value?.trim() || '';
      const deviceKey = keyInput?.value?.trim() || '';
      const originalHtml = saveBtn.innerHTML;

      if (!serverUrl) {
        this._deps.addLogLine('WARN', '请填写服务器地址');
        return;
      }

      setButtonFeedback(saveBtn, '<i class="ph ph-spinner ph-spin"></i> 测试连接中...');
      saveBtn.disabled = true;

      try {
        const connResult = await client.testConnection(serverUrl);
        if (!connResult?.ok) {
          setButtonFeedback(saveBtn, '<i class="ph ph-wifi-slash"></i> 连接失败', 'btn-feedback-error');
          this._deps.addLogLine('ERROR', `服务器连接失败: ${connResult?.error || '无法连接'}`);
          this._deps.showNotice('服务器连接失败', 'error', 3500);
          setTimeout(() => resetButtonFeedback(saveBtn, originalHtml, 'btn-feedback-error'), 2500);
          return;
        }

        const oldKey = await client.get('deviceKey');
        if (deviceKey && deviceKey !== oldKey) {
          const canContinue = await this.confirmDeviceKeyChange(deviceKey, serverUrl, saveBtn, originalHtml);
          if (!canContinue) return;
        }

        const isLocal = isLocalServerUrl(serverUrl);
        const configUpdate = {
          deviceKey,
          serverMode: isLocal ? 'local' : 'production',
          serverConfigured: true,
        };
        if (isLocal) configUpdate.serverUrlLocal = serverUrl;
        else configUpdate.serverUrlProd = serverUrl;

        await client.setMany(configUpdate);

        setButtonFeedback(saveBtn, '<i class="ph ph-check"></i> 已保存', 'btn-feedback-success');
        this._deps.addLogLine('SUCCESS', `配置已保存，服务器延迟 ${connResult.latencyMs || '-'}ms`);
        this._deps.showNotice('配置已保存', 'success', 2000);

        setTimeout(() => {
          $('configModal')?.classList.remove('show');
          setTimeout(() => resetButtonFeedback(saveBtn, originalHtml, 'btn-feedback-success'), 300);

          if (window._authPendingAfterConfig) {
            window._authPendingAfterConfig = false;
            setTimeout(() => this._deps.reopenAuthModal('login'), 400);
          }
        }, 800);
      } catch (error) {
        setButtonFeedback(saveBtn, '<i class="ph ph-x-circle"></i> 出错了', 'btn-feedback-error');
        this._deps.addLogLine('ERROR', `保存配置出错: ${error.message}`);
        setTimeout(() => resetButtonFeedback(saveBtn, originalHtml, 'btn-feedback-error'), 2000);
      }
    },

    async confirmDeviceKeyChange(deviceKey, serverUrl, saveBtn, originalHtml) {
      setButtonFeedback(saveBtn, '<i class="ph ph-spinner ph-spin"></i> 验证密钥中...');
      this._deps.addLogLine('INFO', '检测到密钥变更，正在预验证...');

      let validationResult = null;
      try {
        validationResult = await Promise.race([
          configClient().preValidateKey(deviceKey, serverUrl),
          new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
        ]);
      } catch (error) {
        this._deps.addLogLine('WARN', `密钥预验证失败: ${error.message || '未知错误'}，继续保存`);
      }

      if (validationResult?.warning === 'KEY_BOUND_TO_OTHER_DEVICE') {
        // Release the LoadingSystem overlay before asking for takeover. Directly
        // replacing innerHTML would orphan its WeakMap state and leave a blank
        // busy button when the dialog is cancelled.
        setButtonFeedback(saveBtn, originalHtml);
        saveBtn.disabled = false;
        const userConfirmed = await this._deps.showTakeoverConfirmDialog();
        if (!userConfirmed) {
          this._deps.addLogLine('INFO', '用户取消了密钥变更');
          return false;
        }
        this._deps.addLogLine('WARN', '用户确认接管密钥，继续保存');
      }

      setButtonFeedback(saveBtn, '<i class="ph ph-spinner ph-spin"></i> 保存中...');
      saveBtn.disabled = true;
      return true;
    },
  };

  window._nekoModules.pages.ConfigPage = ConfigPage;
})();
