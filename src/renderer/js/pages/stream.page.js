(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  let streamPollTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function replaceHandler(id, handler) {
    const el = $(id);
    if (!el) return null;
    const clone = el.cloneNode(true);
    el.parentNode.replaceChild(clone, el);
    clone.addEventListener('click', handler);
    return clone;
  }

  function notify(message, type = 'info') {
    if (window.showNekoIsland) window.showNekoIsland(message, type, 2600);
  }

  function renderTestResult(element, state, message) {
    if (!element) return;
    const icons = {
      pending: 'ph-circle-notch',
      success: 'ph-check-circle',
      error: 'ph-x-circle',
    };
    const icon = document.createElement('i');
    icon.className = `ph ${icons[state] || icons.pending}`;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = message;
    element.replaceChildren(icon, label);
    element.className = `test-result-label ${state}`;
  }

  function streamKeyFrom(info) {
    return info?.streamKey || info?.stream_key || info?.key || '';
  }

  function collectObsSettings() {
    return {
      host: $('obsWsHost')?.value || '127.0.0.1',
      port: Number($('obsWsPort')?.value || 4455),
      password: $('obsWsPassword')?.value || '',
    };
  }

  function collectSrsSettings() {
    return {
      srsHost: $('srsHost')?.value?.trim() || '',
      srsRtmpPort: Number($('srsRtmpPort')?.value || 51935),
      srsApp: $('srsApp')?.value?.trim() || 'live',
      srsApiPort: Number($('srsApiPort')?.value || 51985),
    };
  }

  function buildRtmpUrl(cfg = {}) {
    const host = String(cfg.srsHost || '').trim();
    const app = String(cfg.srsApp || 'live').replace(/^\/+|\/+$/g, '') || 'live';
    const port = Number(cfg.srsRtmpPort || 51935);
    if (!host) return 'rtmp://your-srs-server/live';
    if (/^rtmps?:\/\//i.test(host)) {
      try {
        const url = new URL(host);
        url.pathname = `/${app}`;
        if (!url.port && port) url.port = String(port);
        return url.toString().replace(/\/$/, '');
      } catch {
        return host;
      }
    }
    const protocol = port === 443 ? 'rtmps' : 'rtmp';
    return `${protocol}://${host}:${port}/${app}`;
  }

  function applyConfigToForm(cfg = {}) {
    if ($('obsWsHost')) $('obsWsHost').value = cfg.obsWsHost || '127.0.0.1';
    if ($('obsWsPort')) $('obsWsPort').value = cfg.obsWsPort || 4455;
    if ($('obsWsPassword')) $('obsWsPassword').value = cfg.obsWsPassword || '';
    if ($('srsHost')) $('srsHost').value = cfg.srsHost || '';
    if ($('srsRtmpPort')) $('srsRtmpPort').value = cfg.srsRtmpPort || 51935;
    if ($('srsApp')) $('srsApp').value = cfg.srsApp || 'live';
    if ($('srsApiPort')) $('srsApiPort').value = cfg.srsApiPort || 51985;
  }

  function renderStreamIdentity(cfg = {}) {
    const key = streamKeyFrom(cfg);
    const rtmpUrl = buildRtmpUrl(cfg);
    if ($('streamRtmpUrl')) $('streamRtmpUrl').textContent = rtmpUrl;
    if ($('streamKeyDisplay')) {
      $('streamKeyDisplay').textContent = key || 'Not configured';
      $('streamKeyDisplay').dataset.fullKey = key;
    }
    const mainArea = $('streamMainArea');
    const guide = $('streamGuideCard');
    if (mainArea) mainArea.style.display = '';
    if (guide) guide.style.display = key ? 'none' : '';
  }

  function setObsStatus(connected, text) {
    const dot = $('obsWsDot');
    const label = $('obsWsLabel');
    const applyBtn = $('applyToObsBtn');
    if (dot) dot.setAttribute('data-connected', connected ? 'true' : 'false');
    if (label) label.textContent = text;
    if (applyBtn) applyBtn.disabled = !connected;
  }

  function renderLiveStatus(info) {
    const status = typeof info === 'string' ? info : (info?.status || (info?.live ? 'live' : 'idle'));
    const isLive = status === 'live' || info?.live === true;
    const banner = $('streamStatusBanner');
    const dot = $('streamStatusDot');
    const label = $('streamStatusLabel');
    const duration = $('streamStatusDuration');
    if (banner) banner.dataset.status = isLive ? 'live' : status || 'idle';
    if (dot) dot.classList.toggle('active', isLive);
    if (label) label.textContent = isLive ? '推流中' : (status === 'error' ? '状态获取失败' : '未推流');
    if (duration) duration.textContent = isLive && info?.streamTime ? `${Math.floor(info.streamTime / 60)} min` : '';
  }

  function streamClient() {
    return window._nekoModules?.services?.StreamClient || null;
  }

  const StreamPage = {
    init() {
      streamClient()?.installMock?.();
      this.bindEvents();
      this.initData();
    },

    async initData() {
      const client = streamClient();
      if (!client?.isReady?.()) return;
      try {
        const cfg = await client.getConfig();
        applyConfigToForm(cfg || {});
        renderStreamIdentity(cfg || {});

        try {
          const info = await client.getStreamKey();
          const key = streamKeyFrom(info);
          if (key) renderStreamIdentity({ ...(cfg || {}), streamKey: key });
        } catch {}

        this.testObsWebSocket({ silent: true });
        this.pollStreamStatus();
      } catch (e) {
        console.error('[StreamPage] initData error:', e);
      }
    },

    bindEvents() {
      replaceHandler('goToStreamSettings', () => {
        $('settings-stream')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        $('srsHost')?.focus?.();
      });

      const helpContent = $('streamHelpContent');
      const setHelpExpanded = (expanded, trigger, initial = false) => {
        const setter = window._nekoUIHelpers?.setExpandableSectionState;
        if (typeof setter === 'function') {
          setter(helpContent, expanded, { trigger, initial, display: 'block', duration: 240 });
          return;
        }
        if (helpContent) helpContent.style.display = expanded ? '' : 'none';
        trigger?.setAttribute?.('aria-expanded', expanded ? 'true' : 'false');
      };
      const helpToggle = replaceHandler('streamHelpToggle', (event) => {
        const trigger = event.currentTarget;
        setHelpExpanded(trigger?.getAttribute?.('aria-expanded') !== 'true', trigger);
      });
      setHelpExpanded(false, helpToggle, true);

      const client = streamClient();
      if (!client?.isReady?.()) return;

      replaceHandler('copyRtmpUrlBtn', async () => {
        const value = $('streamRtmpUrl')?.textContent || '';
        if (!value) return notify('没有可复制的推流地址', 'warn');
        await navigator.clipboard.writeText(value);
        notify('推流地址已复制', 'success');
      });

      replaceHandler('resetStreamKeyBtn', async () => {
        try {
          const info = await client.resetStreamKey();
          const key = streamKeyFrom(info);
          renderStreamIdentity({ ...collectSrsSettings(), streamKey: key });
          notify('Stream Key 已重置', 'success');
        } catch (e) {
          notify(`重置失败: ${e.message}`, 'error');
        }
      });

      replaceHandler('saveSrsSettingsBtn', async () => {
        const btn = $('saveSrsSettingsBtn');
        window._nekoUIHelpers?.setButtonBusy?.(btn, true, { label: '保存中…' });
        try {
          const cfg = {
            ...collectSrsSettings(),
            obsWsHost: $('obsWsHost')?.value || '127.0.0.1',
            obsWsPort: Number($('obsWsPort')?.value || 4455),
            obsWsPassword: $('obsWsPassword')?.value || '',
          };
          const saved = await client.saveConfig(cfg);
          if (saved && saved.ok === false) throw new Error(saved.error || '保存失败');
          applyConfigToForm(saved || cfg);
          renderStreamIdentity(saved || cfg);
          notify('直播推流配置已保存', 'success');
        } catch (e) {
          notify(`保存失败: ${e.message}`, 'error');
        } finally {
          window._nekoUIHelpers?.setButtonBusy?.(btn, false);
        }
      });

      replaceHandler('testSrsConnectionBtn', async () => {
        const resultEl = $('srsTestResult');
        renderTestResult(resultEl, 'pending', '测试中...');
        try {
          const res = await client.testSrsConnection(collectSrsSettings());
          if (res?.ok) {
            renderTestResult(resultEl, 'success', `连通成功 ${res.srsVersion ? `SRS ${res.srsVersion}` : ''}`);
          } else {
            renderTestResult(resultEl, 'error', res?.reason || res?.error || '连接失败');
          }
        } catch (e) {
          renderTestResult(resultEl, 'error', e.message);
        }
      });

      replaceHandler('testObsWsBtn', () => this.testObsWebSocket());
      replaceHandler('applyToObsBtn', () => this.applyStreamConfigToObs());

      replaceHandler('exportObsConfigBtn', async () => {
        try {
          const res = await client.exportObsServiceConfig();
          const savedPath = typeof res === 'string' ? res : res?.path;
          if (!savedPath || res?.ok === false) throw new Error(res?.error || '导出失败');
          notify(`OBS 配置已导出: ${savedPath}`, 'success');
        } catch (e) {
          notify(`导出失败: ${e.message}`, 'error');
        }
      });

      if (!streamPollTimer) {
        streamPollTimer = setInterval(() => this.pollStreamStatus(), 5000);
        window.stopStreamStatusPolling = () => {
          clearInterval(streamPollTimer);
          streamPollTimer = null;
        };
      }
    },

    async pollStreamStatus() {
      const client = streamClient();
      if (!client?.isReady?.()) return;
      try {
        renderLiveStatus(await client.getLiveStatus());
      } catch {
        renderLiveStatus('error');
      }
    },

    async testObsWebSocket(options = {}) {
      const client = streamClient();
      if (!client?.isReady?.()) return;
      setObsStatus(false, 'OBS WebSocket 连接中...');
      try {
        const res = await client.testObsWebSocket(collectObsSettings());
        if (res?.connected) {
          setObsStatus(true, `OBS 已连接${res.obsVersion ? ` (${res.obsVersion})` : ''}`);
          if (!options.silent) notify('OBS WebSocket 连接成功', 'success');
        } else {
          setObsStatus(false, 'OBS WebSocket 未连接');
          if (!options.silent) notify(res?.reason || res?.error || 'OBS 连接失败', 'error');
        }
      } catch (e) {
        setObsStatus(false, 'OBS WebSocket 未连接');
        if (!options.silent) notify(`OBS 连接异常: ${e.message}`, 'error');
      }
    },

    async applyStreamConfigToObs() {
      const client = streamClient();
      if (!client?.isReady?.()) return;
      try {
        const res = await client.applyConfigToObs(collectObsSettings());
        if (res?.ok || res?.success) {
          notify('OBS 推流配置已应用', 'success');
        } else {
          notify(`配置失败: ${res?.error || '未知错误'}`, 'error');
        }
      } catch (e) {
        notify(`配置异常: ${e.message}`, 'error');
      }
    },
  };

  window._nekoModules.pages.StreamPage = StreamPage;
})();
