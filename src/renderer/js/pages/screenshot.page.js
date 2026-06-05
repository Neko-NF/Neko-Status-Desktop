(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  const $ = (id) => document.getElementById(id);

  function defaultDeps() {
      return {
          addLogLine: () => {},
          showNotice: () => {},
          appendActivityItem: () => {},
          formatDateTime: (value) => new Date(value).toLocaleString(),
          formatTimeOnly: (value) => new Date(value).toLocaleTimeString(),
          config: window._nekoModules?.services?.ConfigClient || null,
          service: window._nekoModules?.services?.ServiceClient || null,
          system: window._nekoModules?.services?.SystemClient || null,
      };
  }

  const ScreenshotPage = {
    _initialized: false,
    _actionsBound: false,
    _deps: defaultDeps(),

    init(deps = {}) {
      this._deps = { ...this._deps, ...deps };
      if (this._initialized) {
        this.bindBackendControls();
        return;
      }
      this._initialized = true;

      const historyFilterGroup = document.getElementById('historyFilterGroup');
      const historyFilterPill = document.getElementById('historyFilterPill');
      const historyTableBody = document.getElementById('historyTableBody');
      
      function syncFilterPill(activeBtn) {
          if (!historyFilterPill || !activeBtn) return;
          historyFilterPill.style.width = activeBtn.offsetWidth + 'px';
          historyFilterPill.style.transform = `translateX(${activeBtn.offsetLeft - 4}px)`;
      }
      
      if (historyFilterGroup && historyTableBody) {
          // 初始化 pill 位置（需等字体渲染完毕）
          requestAnimationFrame(() => {
              syncFilterPill(historyFilterGroup.querySelector('.filter-segmented-btn.active'));
          });
      
          window.addEventListener('resize', () => {
              syncFilterPill(historyFilterGroup.querySelector('.filter-segmented-btn.active'));
          });
      
          historyFilterGroup.addEventListener('click', (e) => {
              const btn = e.target.closest('.filter-segmented-btn');
              if (!btn) return;
      
              historyFilterGroup.querySelectorAll('.filter-segmented-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              syncFilterPill(btn);
      
              const filter = btn.dataset.filter;
              Array.from(historyTableBody.querySelectorAll('tr')).forEach((row, i) => {
                  const show = filter === 'all' || row.dataset.status === filter;
                  if (show) {
                      row.style.display = '';
                      row.style.animationDelay = (i * 0.05) + 's';
                      row.style.animation = 'none';
                      row.offsetHeight; // force reflow
                      row.style.animation = 'tableRowFadeIn 0.3s ease forwards';
                  } else {
                      row.style.display = 'none';
                  }
              });
          });
      }
      // ======== 截图与活动 - 活动流标签筛选 ======== //
      const activityTabGroup = document.getElementById('activityTabGroup');
      const activityList = document.getElementById('activityList');
      
      if (activityTabGroup && activityList) {
          activityTabGroup.addEventListener('click', (e) => {
              const tab = e.target.closest('.activity-tab');
              if (!tab) return;
      
              activityTabGroup.querySelectorAll('.activity-tab').forEach(t => t.classList.remove('active'));
              tab.classList.add('active');
      
              const filter = tab.dataset.tab;
              Array.from(activityList.querySelectorAll('.activity-item')).forEach((item, i) => {
                  const show = filter === 'all' || item.dataset.type === filter;
                  if (show) {
                      item.style.display = '';
                      item.style.animation = 'none';
                      item.offsetHeight; // force reflow
                      item.style.animationDelay = (i * 0.05) + 's';
                      item.style.animation = 'tableRowFadeIn 0.3s ease forwards';
                  } else {
                      item.style.display = 'none';
                  }
              });
          });
      }
      
      // ======== 截图与活动 - 截图模式 & 间隔切换 ======== //
      const screenshotModeGroup = document.getElementById('screenshotModeGroup');
      const intervalSelector = document.getElementById('intervalSelector');
      const intervalCustomGroup = document.getElementById('intervalCustomGroup');
      const intervalAutoHint = document.getElementById('intervalAutoHint');
      const customIntervalValue = document.getElementById('customIntervalValue');
      
      function applyScreenshotMode(mode) {
          const isInterval = mode === 'interval';
          const isAuto = mode === 'auto';
          const isManual = mode === 'manual';
      
          // 预设间隔按钮：仅定时模式
          if (intervalSelector) {
              intervalSelector.style.display = isInterval ? 'flex' : 'none';
          }
          // 自定义间隔输入：仅定时模式
          if (intervalCustomGroup) {
              intervalCustomGroup.style.display = isInterval ? 'flex' : 'none';
          }
          // 自动模式提示（随上报间隔）：仅自动模式
          if (intervalAutoHint) {
              intervalAutoHint.style.display = isAuto ? 'flex' : 'none';
          }
          // 立即截图按钮：仅手动模式
          const captureBtn = document.getElementById('captureNowBtn');
          if (captureBtn) {
              captureBtn.style.display = isManual ? '' : 'none';
          }
      }
      
      // 初始化：自动模式（默认）
      applyScreenshotMode('auto');
      
      if (screenshotModeGroup) {
          screenshotModeGroup.addEventListener('click', (e) => {
              const btn = e.target.closest('.toggle-btn');
              if (!btn) return;
              screenshotModeGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
              applyScreenshotMode(btn.dataset.mode);
          });
      }
      
      // 自定义间隔最小 10s 校验
      if (customIntervalValue) {
          customIntervalValue.addEventListener('change', () => {
              const unit = document.getElementById('customIntervalUnit')?.value || 's';
              let val = parseInt(customIntervalValue.value, 10) || 10;
              // 换算为秒
              const seconds = unit === 's' ? val : unit === 'm' ? val * 60 : val * 3600;
              if (seconds < 10) {
                  if (unit === 's') customIntervalValue.value = 10;
                  else if (unit === 'm') customIntervalValue.value = 1; // 1分 = 60s > 10s
                  else customIntervalValue.value = 1;
              }
          });
      }
      
      if (intervalSelector) {
          intervalSelector.addEventListener('click', (e) => {
              const btn = e.target.closest('.interval-btn');
              if (!btn) return;
              intervalSelector.querySelectorAll('.interval-btn').forEach(b => b.classList.remove('active'));
              btn.classList.add('active');
          });
      }
      
      // ======== div 开关统一 click 处理（截图页 + 服务页 + 设置页） ======== //
      // 只做 UI class 切换，具体配置持久化逻辑统一在 ScreenshotPage 中
      [
          'uploadSwitch', 'autoStartSwitch', 'autoStartMinimizeSwitch', 'reportAutoStartSwitch', 'autoRestartSwitch',
          'stgAutoStartSwitch', 'stgTraySwitch', 'stgRestoreSwitch',
          'stgDarkSwitch', 'stgDarkScheduleSwitch',
          'stgGlassSwitch', 'stgAutoUploadSwitch', 'stgNotifySwitch', 'stgDndSwitch',
          'stgIncognitoSwitch', 'stg2FASwitch', 'stgAutoDownloadSwitch',
          'blurAllSwitch', 'stgSyncScreenshotSwitch', 'stgExperimentalSwitch'
      ].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.addEventListener('click', () => {
              el.classList.toggle('on');
          });
      });
      
      // ======== 隐私防护 - 隐身模式联动 ======== //
      const stgIncognitoSwitch = document.getElementById('stgIncognitoSwitch');
      const privacyBarCard = document.querySelector('.privacy-bar-card');
      const privacyBarIcon = document.getElementById('privacyBarIcon');
      const privacyBarTitle = document.getElementById('privacyBarTitle');
      const privacyBarDesc = document.getElementById('privacyBarDesc');
      
      function syncPrivacyBarWithIncognito() {
          const isOn = stgIncognitoSwitch && stgIncognitoSwitch.classList.contains('on');
          const scope = typeof getIncognitoScope === 'function' ? getIncognitoScope() : 'screenshot';
          const canBlurScreenshot = scope === 'screenshot' || scope === 'both';
          if (privacyBarCard) privacyBarCard.classList.toggle('disabled', !isOn);
          if (privacyBarTitle) privacyBarTitle.textContent = isOn ? '隐私防护已启用' : '隐私防护已关闭';
          if (privacyBarIcon) {
              privacyBarIcon.innerHTML = isOn
                  ? '<i class="ph ph-shield-check"></i>'
                  : '<i class="ph ph-shield-slash"></i>';
          }
          if (privacyBarDesc) {
              if (!isOn) {
                  privacyBarDesc.textContent = '隐身模式已关闭，截图和标题将按原始信息上传。';
              } else if (scope === 'title') {
                  privacyBarDesc.textContent = '仅隐藏上传到服务器的前台应用标题和进程名，截图不做模糊处理。';
              } else if (scope === 'both') {
                  privacyBarDesc.textContent = '隐藏上传标题，并在全局模糊或隐私规则命中时模糊截图。';
              } else {
                  privacyBarDesc.textContent = canBlurScreenshot
                      ? '匹配隐私规则的前台应用截图将自动模糊后再上传，标题保持原始信息。'
                      : '隐私防护已启用。';
              }
          }
      }
      
      // 初始同步
      syncPrivacyBarWithIncognito();
      
      // 隐私未启用时点击卡片 → 跳转到设置页并高亮隐身开关
      if (privacyBarCard) {
          privacyBarCard.addEventListener('click', (e) => {
              // 仅在隐私关闭（disabled 状态）且不是点击"设置隐私规则"按钮时触发
              if (!privacyBarCard.classList.contains('disabled')) return;
              if (e.target.closest('#openPrivacyRulesBtn')) return;
      
              // 切换到设置页
              const settingsNav = document.querySelector('.nav-item[data-target="page-settings"]');
              if (settingsNav) settingsNav.click();
      
              // 滚动到隐身开关并高亮
              setTimeout(() => {
                  const incognitoRow = stgIncognitoSwitch?.closest('.settings-row');
                  if (incognitoRow) {
                      incognitoRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      incognitoRow.classList.add('highlight-flash');
                      setTimeout(() => incognitoRow.classList.remove('highlight-flash'), 2000);
                  }
              }, 300);
          });
      }
      
      // 监听隐身开关变化
      if (stgIncognitoSwitch) {
          stgIncognitoSwitch.addEventListener('click', () => {
              // 等 toggle 完成后再同步
              setTimeout(syncPrivacyBarWithIncognito, 0);
          });
      }
      
      // ======== 隐私规则弹窗 ======== //
      const privacyRulesModal = document.getElementById('privacyRulesModal');
      const openPrivacyRulesBtn = document.getElementById('openPrivacyRulesBtn');
      const closePrivacyRulesBtn = document.getElementById('closePrivacyRulesBtn');
      const privacyRuleInput = document.getElementById('privacyRuleInput');
      const addPrivacyRuleBtn = document.getElementById('addPrivacyRuleBtn');
      const addActiveProcessRuleBtn = document.getElementById('addActiveProcessRuleBtn');
      const selectPrivacyExeBtn = document.getElementById('selectPrivacyExeBtn');
      const refreshPrivacyWindowsBtn = document.getElementById('refreshPrivacyWindowsBtn');
      const privacyWindowPicker = document.getElementById('privacyWindowPicker');
      const privacyWindowPickerList = document.getElementById('privacyWindowPickerList');
      const privacyRulesList = document.getElementById('privacyRulesList');
      const privacyRulesEmpty = document.getElementById('privacyRulesEmpty');
      const incognitoScopeGroup = document.getElementById('incognitoScopeGroup');
      const incognitoScopePill = document.getElementById('incognitoScopePill');
      
      // 从 localStorage 加载规则
      function loadPrivacyRulesFromStorage() {
          let rules = [];
          try { rules = JSON.parse(localStorage.getItem('neko_privacy_rules') || '[]'); } catch { rules = []; }
          return rules.map(normalizePrivacyRule).filter(Boolean);
      }
      
      let privacyRules = loadPrivacyRulesFromStorage();
      
      function normalizePrivacyRule(value) {
          const raw = String(value || '').trim().replace(/^["']+|["']+$/g, '');
          if (!raw) return '';
          const exeMatch = raw.match(/([^\\/:"<>|?*\r\n]+?\.exe)\b/i);
          const baseName = exeMatch ? exeMatch[1] : raw.split(/[\\/]/).pop().trim();
          if (!baseName) return '';
          return /\.[a-z0-9]+$/i.test(baseName) ? baseName : `${baseName}.exe`;
      }
      
      function privacyRuleKey(value) {
          return normalizePrivacyRule(value).toLowerCase();
      }
      
      function getIncognitoScope() {
          const group = document.getElementById('incognitoScopeGroup');
          const active = group?.querySelector('.filter-segmented-btn.active');
          return active?.dataset.scope || 'screenshot';
      }
      
      function syncIncognitoScopePill() {
          const group = document.getElementById('incognitoScopeGroup');
          const active = group?.querySelector('.filter-segmented-btn.active');
          if (!incognitoScopePill || !active) return;
          incognitoScopePill.style.width = active.offsetWidth + 'px';
          incognitoScopePill.style.transform = `translateX(${active.offsetLeft - 4}px)`;
      }
      
      function screenshotPrivacyEnabled() {
          const scope = getIncognitoScope();
          return !!stgIncognitoSwitch?.classList.contains('on') && (scope === 'screenshot' || scope === 'both');
      }
      
      const configClient = () => window._nekoModules?.services?.ConfigClient || null;
      const systemClient = () => window._nekoModules?.services?.SystemClient || null;

      function savePrivacyRules() {
          privacyRules = privacyRules.map(normalizePrivacyRule).filter(Boolean);
          localStorage.setItem('neko_privacy_rules', JSON.stringify(privacyRules));
          const savePromise = configClient()?.set?.('privacyRules', privacyRules);
          if (savePromise?.catch) savePromise.catch(() => {});
      }
      
      function renderPrivacyRules() {
          if (!privacyRulesList || !privacyRulesEmpty) return;
          privacyRulesList.innerHTML = '';
          privacyRulesEmpty.style.display = privacyRules.length === 0 ? '' : 'none';
          privacyRulesList.style.display = privacyRules.length > 0 ? '' : 'none';
      
          privacyRules.forEach((rule, idx) => {
              const item = document.createElement('div');
              item.className = 'privacy-rule-item';
              const icon = document.createElement('div');
              icon.className = 'privacy-rule-icon';
              icon.innerHTML = '<i class="ph ph-app-window"></i>';
              const name = document.createElement('div');
              name.className = 'privacy-rule-name';
              name.textContent = rule;
              const remove = document.createElement('button');
              remove.className = 'privacy-rule-remove';
              remove.dataset.idx = String(idx);
              remove.title = '移除';
              remove.innerHTML = '<i class="ph ph-trash"></i>';
              item.append(icon, name, remove);
              privacyRulesList.appendChild(item);
          });
      
          // 更新预设按钮状态
          document.querySelectorAll('.privacy-preset-btn').forEach(btn => {
              btn.classList.toggle('added', privacyRules.some(rule => privacyRuleKey(rule) === privacyRuleKey(btn.dataset.process)));
          });
      
          // 更新模糊计数统计
          updateBlurCount();
      }
      
      function addPrivacyRule(processName) {
          const name = normalizePrivacyRule(processName);
          if (!name || privacyRules.some(rule => privacyRuleKey(rule) === privacyRuleKey(name))) return;
          privacyRules.push(name);
          savePrivacyRules();
          renderPrivacyRules();
      }
      
      function renderPrivacyWindowPicker(windows) {
          if (!privacyWindowPicker || !privacyWindowPickerList) return;
          privacyWindowPicker.hidden = false;
          privacyWindowPickerList.innerHTML = '';
      
          if (!Array.isArray(windows) || windows.length === 0) {
              const empty = document.createElement('div');
              empty.className = 'privacy-rules-empty';
              empty.textContent = '未找到可选择的窗口';
              privacyWindowPickerList.appendChild(empty);
              return;
          }
      
          const seen = new Set();
          windows.forEach((win) => {
              const processName = normalizePrivacyRule(win.processName);
              if (!processName) return;
              const key = `${processName.toLowerCase()}::${String(win.title || '').toLowerCase()}`;
              if (seen.has(key)) return;
              seen.add(key);
      
              const item = document.createElement('button');
              item.type = 'button';
              item.className = 'privacy-window-item';
              item.dataset.process = processName;
      
              const icon = document.createElement('div');
              icon.className = 'privacy-window-icon';
              icon.innerHTML = '<i class="ph ph-app-window"></i>';
      
              const text = document.createElement('div');
              const title = document.createElement('div');
              title.className = 'privacy-window-title';
              title.textContent = win.title || processName;
              const proc = document.createElement('div');
              proc.className = 'privacy-window-process';
              proc.textContent = processName;
              text.append(title, proc);
      
              const pid = document.createElement('div');
              pid.className = 'privacy-window-pid';
              pid.textContent = win.pid ? `PID ${win.pid}` : '';
      
              item.append(icon, text, pid);
              privacyWindowPickerList.appendChild(item);
          });
      }
      
      async function refreshPrivacyWindowPicker() {
          if (!privacyWindowPicker || !privacyWindowPickerList) return;
          privacyWindowPicker.hidden = false;
          privacyWindowPickerList.innerHTML = '';
          const loading = document.createElement('div');
          loading.className = 'privacy-rules-empty';
          loading.textContent = '正在读取窗口列表...';
          privacyWindowPickerList.appendChild(loading);
          try {
              const windows = await systemClient()?.listWindows?.();
              renderPrivacyWindowPicker(windows || []);
          } catch {
              renderPrivacyWindowPicker([]);
          }
      }
      
      function removePrivacyRule(idx) {
          privacyRules.splice(idx, 1);
          savePrivacyRules();
          renderPrivacyRules();
      }
      
      const BLUR_EVENTS_KEY = 'neko_blur_events';
      const BLUR_LEGACY_KEY = 'neko_blur_count';
      const BLUR_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
      
      function loadBlurEvents() {
          const now = Date.now();
          let events = [];
          try {
              const parsed = JSON.parse(localStorage.getItem(BLUR_EVENTS_KEY) || '[]');
              if (Array.isArray(parsed)) events = parsed.map(Number).filter(Number.isFinite);
          } catch { events = []; }
      
          const legacyCount = parseInt(localStorage.getItem(BLUR_LEGACY_KEY) || '0', 10);
          if (events.length === 0 && legacyCount > 0) {
              const count = Math.min(legacyCount, 10000);
              events = Array.from({ length: count }, (_, idx) => now - Math.floor((idx / Math.max(count, 1)) * BLUR_RETENTION_MS));
          }
      
          events = events.filter(ts => ts >= now - BLUR_RETENTION_MS && ts <= now + 60000);
          localStorage.setItem(BLUR_EVENTS_KEY, JSON.stringify(events));
          localStorage.setItem(BLUR_LEGACY_KEY, String(events.length));
          return events;
      }
      
      function updateBlurCount() {
          const countEl = document.getElementById('privacyBlurCount');
          if (countEl) {
              const count = loadBlurEvents().length;
              countEl.textContent = count + ' 张';
          }
      }
      
      // 打开/关闭弹窗
      if (openPrivacyRulesBtn && privacyRulesModal) {
          openPrivacyRulesBtn.addEventListener('click', () => {
              privacyRulesModal.classList.add('show');
              renderPrivacyRules();
          });
      }
      if (closePrivacyRulesBtn && privacyRulesModal) {
          closePrivacyRulesBtn.addEventListener('click', () => privacyRulesModal.classList.remove('show'));
      }
      if (privacyRulesModal) {
          privacyRulesModal.addEventListener('click', (e) => {
              if (e.target === privacyRulesModal) privacyRulesModal.classList.remove('show');
          });
      }
      
      // 添加规则
      if (addPrivacyRuleBtn && privacyRuleInput) {
          addPrivacyRuleBtn.addEventListener('click', () => {
              addPrivacyRule(privacyRuleInput.value);
              privacyRuleInput.value = '';
          });
          privacyRuleInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                  addPrivacyRule(privacyRuleInput.value);
                  privacyRuleInput.value = '';
              }
          });
      }
      
      if (addActiveProcessRuleBtn) {
          addActiveProcessRuleBtn.addEventListener('click', async () => {
              try {
                  const selected = await systemClient()?.pickPrivacyWindow?.();
                  if (selected?.processName) addPrivacyRule(selected.processName);
              } catch { /* ignore */ }
          });
      }
      
      if (refreshPrivacyWindowsBtn) {
          refreshPrivacyWindowsBtn.addEventListener('click', refreshPrivacyWindowPicker);
      }
      
      if (privacyWindowPickerList) {
          privacyWindowPickerList.addEventListener('click', (e) => {
              const item = e.target.closest('.privacy-window-item');
              if (!item) return;
              addPrivacyRule(item.dataset.process || '');
              if (privacyWindowPicker) privacyWindowPicker.hidden = true;
          });
      }
      
      if (selectPrivacyExeBtn) {
          selectPrivacyExeBtn.addEventListener('click', async () => {
              try {
                  const filePath = await systemClient()?.selectFile?.({
                      title: '选择要加入隐私规则的 EXE',
                      filters: [{ name: 'Windows 可执行文件', extensions: ['exe'] }],
                  });
                  addPrivacyRule(filePath || '');
              } catch { /* ignore */ }
          });
      }
      
      if (incognitoScopeGroup) {
          requestAnimationFrame(syncIncognitoScopePill);
          window.addEventListener('resize', syncIncognitoScopePill);
          incognitoScopeGroup.addEventListener('click', (e) => {
              const btn = e.target.closest('.filter-segmented-btn');
              if (!btn) return;
              incognitoScopeGroup.querySelectorAll('.filter-segmented-btn').forEach(item => item.classList.remove('active'));
              btn.classList.add('active');
              syncIncognitoScopePill();
              syncPrivacyBarWithIncognito();
          });
          document.addEventListener('neko:privacy-scope-changed', () => {
              syncIncognitoScopePill();
              syncPrivacyBarWithIncognito();
          });
      }
      
      // 快捷预设
      document.querySelectorAll('.privacy-preset-btn').forEach(btn => {
          btn.addEventListener('click', () => {
              addPrivacyRule(btn.dataset.process);
          });
      });
      
      // 删除规则（事件委托）
      if (privacyRulesList) {
          privacyRulesList.addEventListener('click', (e) => {
              const removeBtn = e.target.closest('.privacy-rule-remove');
              if (!removeBtn) return;
              removePrivacyRule(parseInt(removeBtn.dataset.idx, 10));
          });
      }
      
      // 初始渲染
      renderPrivacyRules();
      syncPrivacyBarWithIncognito();
      document.addEventListener('neko:privacy-rules-loaded', () => {
          privacyRules = loadPrivacyRulesFromStorage();
          renderPrivacyRules();
      });
      
      // ======== 活动流 - 空态管理 ======== //
      // 暴露给 renderer runtime 使用的辅助函数

      window._nekoActivityHelpers = {
          hideEmpty() {
              const empty = document.getElementById('activityEmpty');
              if (empty) empty.style.display = 'none';
          },
          isIncognitoOn() {
              const sw = document.getElementById('stgIncognitoSwitch');
              return sw ? sw.classList.contains('on') : false;
          },
          getIncognitoScope,
          isScreenshotPrivacyEnabled: screenshotPrivacyEnabled,
          normalizePrivacyRule,
          getPrivacyRules() { return privacyRules; },
          incrementBlurCount() {
              const events = loadBlurEvents();
              events.push(Date.now());
              localStorage.setItem(BLUR_EVENTS_KEY, JSON.stringify(events));
              localStorage.setItem(BLUR_LEGACY_KEY, String(events.length));
              updateBlurCount();
          },
          syncPrivacyBar: syncPrivacyBarWithIncognito,
      };
      
      // ======== 服务与自启动 - 上报服务自启联动 ======== //
      this.bindBackendControls();
    },

    config() {
      return this._deps.config || window._nekoModules?.services?.ConfigClient || null;
    },

    service() {
      return this._deps.service || window._nekoModules?.services?.ServiceClient || null;
    },

    system() {
      return this._deps.system || window._nekoModules?.services?.SystemClient || null;
    },

    log(level, message) {
      this._deps.addLogLine(level, message);
    },

    notice(message, type = 'info', durationMs = 3000) {
      this._deps.showNotice(message, type, durationMs);
    },

    bindBackendControls() {
      if (this._actionsBound) return;
      if (!this.config() && !this.service() && !this.system()) return;
      this._actionsBound = true;

      $('toggleScreenshot')?.addEventListener('click', async function handleDashboardScreenshotToggle() {
        const enabled = this.classList.contains('on');
        await ScreenshotPage.config()?.set?.('enableScreenshot', enabled);
        $('uploadSwitch')?.classList.toggle('on', enabled);
        ScreenshotPage.log('INFO', `截图上报 -> ${enabled ? '已启用' : '已禁用'}`);
        ScreenshotPage.service()?.syncMeta?.().catch(() => {});
      });

      $('uploadSwitch')?.addEventListener('click', async function handleUploadToggle() {
        const enabled = this.classList.contains('on');
        await ScreenshotPage.config()?.set?.('enableScreenshot', enabled);
        $('toggleScreenshot')?.classList.toggle('on', enabled);
        ScreenshotPage.service()?.syncMeta?.().catch(() => {});
      });

      $('captureNowBtn')?.addEventListener('click', () => this.triggerScreenshot());
      $('dashCaptureNowBtn')?.addEventListener('click', () => this.triggerScreenshot());

      $('screenshotModeGroup')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.toggle-btn');
        if (!btn || !btn.dataset.mode) return;
        await this.config()?.set?.('screenshotMode', btn.dataset.mode);
        if (btn.dataset.mode === 'auto') {
          await this.config()?.set?.('syncScreenshotInterval', true);
        } else if (btn.dataset.mode === 'interval') {
          await this.config()?.set?.('syncScreenshotInterval', false);
        }
      });

      $('intervalSelector')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.interval-btn');
        if (!btn || !btn.dataset.value) return;
        const seconds = parseInt(btn.dataset.value, 10);
        if (!Number.isNaN(seconds) && seconds >= 10) {
          await this.config()?.set?.('screenshotInterval', seconds);
        }
      });

      $('customIntervalValue')?.addEventListener('change', async function handleCustomIntervalChange() {
        const raw = parseInt(this.value, 10);
        const unit = $('customIntervalUnit')?.value || 's';
        const seconds = unit === 'm' ? raw * 60 : unit === 'h' ? raw * 3600 : raw;
        if (!Number.isNaN(seconds) && seconds >= 10) {
          await ScreenshotPage.config()?.set?.('screenshotInterval', seconds);
        }
      });
    },

    async triggerScreenshot() {
      this.log('INFO', '正在截图...');
      const captureTs = Date.now();
      const result = await this.system()?.captureScreen?.();
      if (!result) {
        this.log('ERROR', '截图失败或功能不可用');
        this.notice('截图失败', 'error', 3000);
        return null;
      }

      const bytes = new Uint8Array(result.data);
      const screenshotMime = result.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
      const screenshotExt = result.extension || (screenshotMime === 'image/jpeg' ? 'jpg' : 'png');
      const screenshotFormat = screenshotExt.toUpperCase();
      const blob = new Blob([bytes], { type: screenshotMime });
      const url = URL.createObjectURL(blob);
      let isBlurred = false;

      const helpers = window._nekoActivityHelpers;
      const screenshotPrivacyOn = helpers?.isScreenshotPrivacyEnabled?.();
      if (screenshotPrivacyOn) {
        const blurAllEl = $('blurAllSwitch');
        if (blurAllEl?.classList.contains('on')) {
          isBlurred = true;
          this.log('INFO', '全局截图模糊已启用，截图已模糊');
          helpers?.incrementBlurCount?.();
        }
      }

      if (!isBlurred && screenshotPrivacyOn) {
        try {
          const activeWin = await this.system()?.getActiveWindow?.();
          const rules = helpers?.getPrivacyRules?.() || [];
          if (activeWin?.processName && rules.length > 0) {
            const procLower = helpers.normalizePrivacyRule(activeWin.processName).toLowerCase();
            const matched = rules.some((rule) => procLower === helpers.normalizePrivacyRule(rule).toLowerCase());
            if (matched) {
              isBlurred = true;
              this.log('INFO', `隐私规则命中: ${activeWin.processName}，截图已模糊`);
              helpers?.incrementBlurCount?.();
            }
          }
        } catch { /* 获取前台窗口失败，跳过模糊 */ }
      }

      this.log('SUCCESS', `截图完成${isBlurred ? '（已模糊）' : ''}，大小 ${(bytes.length / 1024).toFixed(1)} KB`);
      this.notice(isBlurred ? '截图完成（隐私模糊）' : '截图完成', 'success', 2000);
      this._deps.appendActivityItem('capture', isBlurred ? '截图完成（已模糊）' : '截图完成', `${(bytes.length / 1024).toFixed(0)} KB · ${screenshotFormat}`, this._deps.formatTimeOnly(captureTs));

      const timeText = this._deps.formatDateTime(captureTs);
      const timeEl = document.querySelector('.screenshot-preview-time');
      if (timeEl) timeEl.textContent = timeText;

      const frame = document.querySelector('.screenshot-frame');
      if (frame) {
        frame.style.backgroundImage = `url(${url})`;
        frame.style.backgroundSize = 'cover';
        frame.style.backgroundPosition = 'center';
        frame.style.filter = isBlurred ? 'blur(20px)' : 'none';
        const placeholder = frame.querySelector('.screenshot-placeholder');
        if (placeholder) placeholder.style.display = 'none';
        const overlay = frame.querySelector('.screenshot-frame-overlay');
        if (overlay) overlay.style.display = 'flex';
      }

      const dashImg = $('dashScreenshotImg');
      const dashEmpty = $('dashScreenshotEmpty');
      if (dashImg) {
        dashImg.src = url;
        dashImg.style.display = '';
        dashImg.style.filter = isBlurred ? 'blur(20px)' : 'none';
      }
      if (dashEmpty) dashEmpty.style.display = 'none';
      const dashName = $('dashScreenshotName');
      const dashSize = $('dashScreenshotSize');
      if (dashName) dashName.innerHTML = `<i class="ph ph-hard-drive"></i> screenshot_${Date.now()}.${screenshotExt}`;
      if (dashSize) dashSize.innerHTML = `<i class="ph ph-arrows-out"></i> ${(bytes.length / 1024).toFixed(0)} KB`;

      return { url, isBlurred };
    },
  };

  window._nekoModules.pages.ScreenshotPage = ScreenshotPage;
})();
