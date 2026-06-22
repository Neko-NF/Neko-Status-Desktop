(function attachActivityPage() {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  let initialized = false;
  let refreshTimer = null;
  let state = {
    settings: { enabled: false, publishing: false, snapshots: false, background: false, autoStart: true },
    agent: { state: 'disabled' },
    follows: [], followers: [], apps: [], blocks: [], visibility: 'private',
    partialFailures: [],
    currentUserId: null, currentUsername: '',
  };
  const pendingSettings = new Set();
  let deps = {};

  const byId = (id) => document.getElementById(id);
  const client = () => window._nekoModules?.services?.ActivityClient;
  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const notify = (message, type = 'info') => deps.showNotice?.(message, type);
  const failed = (result) => result?.ok === false || result?.success === false;
  const errorText = (result, fallback) => result?.message || result?.error || fallback;

  function confirmActivityDanger(action, button) {
    const messages = {
      unfollow: '确定取消关注这个用户吗？相关应用提醒规则也会一并失效。',
      'delete-rule': '确定删除这条应用提醒规则吗？删除后不会再收到该应用提醒。',
      block: '确定拉黑这个用户吗？双方会互相不可见，并立即撤销相关关注动态。',
    };
    if (action === 'toggle-app' && button?.dataset.hidden !== '1') {
      return window.confirm('停止公开这个应用吗？关注你的人将看不到它，也不会再收到它的上线提醒。');
    }
    const message = messages[action];
    return !message || window.confirm(message);
  }

  function setPageStatus(message = '', type = 'info') {
    const el = byId('activityPageStatus');
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      el.className = 'activity-page-status';
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.className = `activity-page-status ${type}`.trim();
  }

  function switchState(element, enabled, disabled = false, pending = false) {
    if (!element) return;
    element.classList.toggle('on', !!enabled);
    element.classList.toggle('disabled', !!disabled || !!pending);
    element.classList.toggle('loading', !!pending);
    element.setAttribute('aria-checked', enabled ? 'true' : 'false');
    element.setAttribute('aria-disabled', disabled || pending ? 'true' : 'false');
    element.setAttribute('aria-busy', pending ? 'true' : 'false');
  }

  function formatDuration(value) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
    return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
  }

  function normalizeBootstrap(data) {
    state.follows = data?.follows?.follows || [];
    state.followers = data?.followers?.followers || [];
    state.apps = data?.apps?.apps || [];
    state.blocks = data?.blocks?.blocks || [];
    state.visibility = data?.privacy?.visibility || 'private';
    if (data?.privacy && Object.prototype.hasOwnProperty.call(data.privacy, 'shareSnapshots')) {
      state.settings = { ...state.settings, snapshots: data.privacy.shareSnapshots === true };
    }
    state.partialFailures = Array.isArray(data?.partialFailures) ? data.partialFailures : [];
  }

  function renderPartialLoadStatus() {
    const status = byId('activityPageStatus');
    if (!state.partialFailures.length) {
      if (status?.dataset.partialLoad === '1') setPageStatus('');
      return;
    }
    const sectionLabels = {
      follows: '关注列表',
      privacy: '隐私设置',
      apps: '云端应用目录',
      followers: '关注者',
      blocks: '黑名单',
    };
    const labels = [...new Set(state.partialFailures.map((item) => (
      sectionLabels[item?.section] || '部分数据'
    )))];
    setPageStatus(`${labels.join('、')}暂时无法加载，已继续显示可用的应用数据。`, 'warn');
    if (status) status.dataset.partialLoad = '1';
  }

  function renderAgent() {
    const settings = state.settings || {};
    const agent = state.agent || {};
    switchState(byId('activityEnabledSwitch'), settings.enabled, false, pendingSettings.has('enabled'));
    switchState(byId('activityPublishingSwitch'), settings.publishing, !settings.enabled, pendingSettings.has('publishing'));
    switchState(byId('activitySnapshotsSwitch'), settings.snapshots, !settings.enabled || !settings.publishing, pendingSettings.has('snapshots'));
    switchState(byId('activityBackgroundSwitch'), settings.background, !settings.enabled, pendingSettings.has('background'));
    switchState(byId('activityAutoStartSwitch'), settings.autoStart, !settings.enabled || !settings.background, pendingSettings.has('autoStart'));

    const labels = {
      disabled: ['未开启', ''], embedded: ['应用打开时运行', 'success'], background: ['后台提醒中', 'success'],
      paused: ['已暂停', 'warn'], reconnecting: ['网络重连中', 'warn'], error: ['需要处理', 'error'],
      session_exit: ['本次已退出', 'warn'], update_shutdown: ['更新准备中', 'warn'],
    };
    const [label, className] = labels[agent.state] || ['正在连接', 'warn'];
    const badge = byId('activityAgentBadge');
    if (badge) {
      badge.textContent = label;
      badge.className = `status-badge ${className}`.trim();
    }
    const memory = Number(agent.memoryBytes || 0);
    const technical = [
      agent.agentVersion ? `版本 ${agent.agentVersion}` : null,
      agent.pid ? `PID ${agent.pid}` : null,
      memory ? `内存 ${(memory / 1024 / 1024).toFixed(1)} MiB` : null,
      agent.connection ? `网络 ${agent.connection}` : null,
      agent.protocolVersion ? `协议 v${agent.protocolVersion}` : null,
    ].filter(Boolean);
    const detailEl = byId('activityAgentDetails');
    if (detailEl) {
      let copy = '开启后，你可以决定哪些应用对外可见；不会影响截图、完整状态上报或应用历史。';
      if (settings.enabled && !settings.publishing) copy = '提醒功能已开启，但此设备暂不公开前台应用。你仍可以接收关注对象的提醒。';
      if (settings.enabled && settings.publishing && agent.state === 'embedded') copy = '客户端打开时会由轻量代理识别你主动公开的应用，短暂切换会被过滤。';
      if (settings.enabled && settings.publishing && agent.state === 'background') copy = '客户端关闭后，轻量后台提醒仍会继续运行；可从托盘临时暂停或退出本次后台功能。';
      if (agent.state === 'paused') copy = '已临时暂停：不会公开你的活动，也不会接收关注对象提醒。下次登录会按设置恢复。';
      if (agent.state === 'reconnecting') copy = '网络正在恢复中：本地设置已保留，连接恢复后只同步当前稳定状态。';
      if (agent.state === 'error') copy = '后台提醒需要修复。你可以点击“修复后台提醒”重新配置。';
      detailEl.innerHTML = `<div>${escapeHtml(copy)}</div>${technical.length
        ? `<details class="activity-diagnostics"><summary>诊断信息</summary><span>${technical.map(escapeHtml).join(' · ')}</span></details>`
        : ''}`;
    }
    const pauseButton = byId('activityPauseBtn');
    if (pauseButton) {
      const paused = agent.state === 'paused' || agent.paused === true;
      pauseButton.disabled = !settings.enabled;
      pauseButton.innerHTML = paused
        ? '<i class="ph ph-play"></i> 恢复活动功能'
        : '<i class="ph ph-pause"></i> 临时暂停';
      pauseButton.dataset.paused = paused ? '1' : '0';
    }
  }

  function renderPrivacy() {
    document.querySelectorAll('#activityPrivacyOptions [data-visibility]').forEach((button) => {
      const active = button.dataset.visibility === state.visibility;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.disabled = !state.settings.enabled;
    });
  }

  function userRow(user, actions = '') {
    const username = user?.username || '未知用户';
    const avatar = user?.avatar
      ? `<img src="${escapeHtml(user.avatar)}" alt="${escapeHtml(username)}头像">`
      : `<span aria-hidden="true">${escapeHtml(String(username || '?').slice(0, 1).toUpperCase())}</span>`;
    return `<div class="activity-user-avatar">${avatar}</div>
      <div class="activity-user-copy" title="${escapeHtml(username)}"><strong>${escapeHtml(username)}</strong><small>UID ${escapeHtml(user?.id)}</small></div>
      <div class="activity-row-actions">${actions}</div>`;
  }

  function renderSearchResults(users = []) {
    const root = byId('activitySearchResults');
    if (!root) return;
    root.innerHTML = users.length ? users.map((user) => `<div class="activity-list-row">
      ${userRow(user, `<button class="action-btn x-small primary-border" type="button" data-action="follow" data-user-id="${escapeHtml(user.id)}" aria-label="关注 ${escapeHtml(user.username || `UID ${user.id}`)}"><i class="ph ph-user-plus"></i> 关注</button>`)}
    </div>`).join('') : '<div class="activity-empty">没有找到匹配的用户</div>';
  }

  function renderSearchMessage(message, tone = '') {
    const root = byId('activitySearchResults');
    if (!root) return;
    root.innerHTML = `<div class="activity-empty ${escapeHtml(tone)}">${escapeHtml(message)}</div>`;
  }

  function setButtonBusy(button, busy, busyLabel) {
    if (!button) return;
    window._nekoUIHelpers?.setButtonBusy?.(button, busy, { label: busyLabel || '处理中…' });
  }

  function queryTargetsSelf(query = '') {
    const text = String(query || '').trim();
    const currentId = Number(state.currentUserId || 0);
    if (currentId > 0) {
      const uidMatch = text.match(/^#?(\d+)$/);
      if (uidMatch && Number(uidMatch[1]) === currentId) return true;
    }
    return !!state.currentUsername && text.toLowerCase() === String(state.currentUsername).toLowerCase();
  }

  async function loadCurrentUser() {
    try {
      const auth = await window._nekoModules?.services?.AuthClient?.getState?.();
      const user = auth?.user || auth?.authUser || null;
      state.currentUserId = Number(user?.id || user?.uid || 0) || null;
      state.currentUsername = user?.username || '';
    } catch {}
  }

  function renderFollows() {
    const root = byId('activityFollowsList');
    if (!root) return;
    if (!state.follows.length) {
      root.innerHTML = '<div class="activity-empty">暂无关注用户，先在上方搜索吧。</div>';
      return;
    }
    root.innerHTML = state.follows.map((follow) => {
      const online = follow.activeSessions || [];
      const onlineHtml = online.length ? online.map((session) => {
        const devices = (session.devices || []).map((device) => device.name).join('、') || '未知设备';
        return `<div class="activity-online-pill" title="${escapeHtml(session.displayName)} · ${escapeHtml(devices)}"><i class="ph ph-circle"></i><strong>${escapeHtml(session.displayName)}</strong>
          <span>已在线 ${formatDuration(session.startedAt)} · ${escapeHtml(devices)}</span></div>`;
      }).join('') : `<div class="activity-offline-copy">${follow.allowed ? '当前没有匹配规则的应用在线' : '对方未向你开放活动状态'}</div>`;
      const rules = (follow.rules || []).map((rule) => `<div class="activity-rule-chip">
        <span title="${escapeHtml(rule.displayName)} · ${escapeHtml(rule.appKey)}">${escapeHtml(rule.displayName)} <small>${escapeHtml(rule.appKey)}</small></span>
        <button type="button" data-action="delete-rule" data-rule-id="${escapeHtml(rule.id)}" title="删除规则" aria-label="删除 ${escapeHtml(rule.displayName)} 的提醒规则"><i class="ph ph-x"></i></button>
      </div>`).join('');
      const catalog = (follow.catalog || []).map((app) => `<button class="activity-catalog-option" type="button" data-action="catalog-rule" title="为 ${escapeHtml(app.displayName)} 开启上线提醒"
        data-follow-id="${escapeHtml(follow.id)}" data-app-key="${escapeHtml(app.appKey)}" data-display-name="${escapeHtml(app.displayName)}">
        <i class="ph ph-bell-ringing"></i> ${escapeHtml(app.displayName)} <small>${escapeHtml(app.appKey)}</small></button>`).join('');
      const catalogHtml = catalog || (follow.catalogLoaded ? '<div class="activity-empty compact">对方还没有公开可提醒的应用</div>' : '');
      return `<article class="activity-follow-card" data-follow-id="${escapeHtml(follow.id)}">
        <div class="activity-list-row activity-follow-head">
          ${userRow(follow.user, `<button class="action-btn x-small" type="button" data-action="unfollow" data-follow-id="${escapeHtml(follow.id)}">取消关注</button>`)}
        </div>
        <div class="activity-online-state">${onlineHtml}</div>
        <div class="activity-rules">${rules || '<span class="activity-empty compact">尚未设置应用规则，不会发送提醒</span>'}</div>
        <div class="activity-rule-editor">
          <button class="action-btn x-small primary" type="button" data-action="load-catalog" data-follow-id="${escapeHtml(follow.id)}">选择对方公开的应用</button>
          <input class="activity-input" data-field="app-key" placeholder="高级：手动输入对方已公开的 .exe">
          <input class="activity-input" data-field="display-name" placeholder="提醒名称（可选）">
          <button class="action-btn x-small" type="button" data-action="create-rule" data-follow-id="${escapeHtml(follow.id)}">手动添加</button>
        </div>
        <div class="activity-catalog-list">${catalogHtml}</div>
      </article>`;
    }).join('');
  }

  function renderFollowers() {
    const root = byId('activityFollowersList');
    if (!root) return;
    root.innerHTML = state.followers.length ? state.followers.map((item) => `<div class="activity-list-row">
      ${userRow(item.user, `<button class="action-btn x-small danger" type="button" data-action="block" data-user-id="${escapeHtml(item.user.id)}"><i class="ph ph-prohibit"></i> 拉黑</button>`)}
    </div>`).join('') : '<div class="activity-empty">暂无关注者</div>';
  }

  function renderApps() {
    const root = byId('activityAppsList');
    if (!root) return;
    root.innerHTML = state.apps.length ? state.apps.map((app) => {
      const isPublic = app.isHidden === false;
      const locallyDetected = app.detected === true && app.source === 'local-detected';
      return `<div class="activity-list-row">
      <div class="activity-app-icon"><i class="ph ph-app-window"></i></div>
      <div class="activity-user-copy" title="${escapeHtml(app.displayName)}"><strong>${escapeHtml(app.displayName)}</strong><small>${escapeHtml(app.appKey)}${locallyDetected ? ' · 本机检测' : ''}</small></div>
      <span class="activity-app-visibility ${isPublic ? 'public' : 'private'}">${isPublic ? '已公开' : '未公开'}</span>
      <button class="action-btn x-small ${isPublic ? '' : 'primary-border'}" type="button" data-action="toggle-app" data-app-key="${escapeHtml(app.appKey)}" data-display-name="${escapeHtml(app.displayName)}" data-hidden="${app.isHidden ? '1' : '0'}" data-local-detected="${locallyDetected ? '1' : '0'}" aria-label="${isPublic ? '停止公开' : '公开'} ${escapeHtml(app.displayName)}">
        ${isPublic ? '停止公开' : '公开'}
      </button>
    </div>`;
    }).join('') : '<div class="activity-empty">还没有公开应用。你可以从已打开的窗口中选择应用，也可以手动输入规范化 .exe 进程名。</div>';
  }

  function renderBlocks() {
    const root = byId('activityBlocksList');
    if (!root) return;
    root.innerHTML = state.blocks.length ? state.blocks.map((item) => `<div class="activity-list-row">
      ${userRow(item.user, `<button class="action-btn x-small" type="button" data-action="unblock" data-user-id="${escapeHtml(item.user.id)}">解除拉黑</button>`)}
    </div>`).join('') : '<div class="activity-empty">暂无拉黑用户</div>';
  }

  function renderAll() {
    renderAgent(); renderPrivacy(); renderFollows(); renderFollowers(); renderApps(); renderBlocks();
  }

  async function refreshAgent(silent = false) {
    const result = await client()?.getState?.();
    if (!result || failed(result)) {
      if (!silent) notify(errorText(result, '无法读取活动代理状态'), 'error');
      return;
    }
    state.settings = result.settings || state.settings;
    state.agent = result.agent || state.agent;
    renderAgent();
  }

  async function refreshData(silent = false) {
    await refreshAgent(silent);
    if (!state.settings.enabled) {
      renderAll();
      return { disabled: true };
    }
    const result = await client()?.bootstrap?.();
    if (!result || failed(result)) {
      if (!silent) notify(errorText(result, '无法加载关注动态'), 'error');
      return result;
    }
    normalizeBootstrap(result);
    renderAll();
    renderPartialLoadStatus();
    return result;
  }

  async function updateSettings(changes) {
    const previous = { ...state.settings };
    const next = { ...state.settings, ...changes };
    const keys = Object.keys(changes);
    keys.forEach((key) => pendingSettings.add(key));
    state.settings = next;
    renderAgent();
    setPageStatus('正在保存设置。网络慢时可以停在这里，失败会自动恢复。', 'loading');
    try {
      const result = await client()?.updateSettings?.(next);
      if (!result || failed(result)) {
        state.settings = previous;
        notify(errorText(result, '设置未能保存'), 'error');
        setPageStatus('保存失败，已恢复到上一次设置。', 'error');
        await refreshAgent(true);
        return false;
      }
      if (result.settings && typeof result.settings === 'object') {
        state.settings = { ...next, ...result.settings };
      } else {
        state.settings = next;
      }
      if (result.agent) state.agent = result.agent;
      setPageStatus('设置已保存。', 'success');
      renderAgent();
      await refreshData(true);
      window.setTimeout(() => setPageStatus('', 'info'), 2200);
      return true;
    } catch (error) {
      state.settings = previous;
      notify(error.message || '设置未能保存', 'error');
      setPageStatus('保存失败，已恢复到上一次设置。', 'error');
      await refreshAgent(true);
      return false;
    } finally {
      keys.forEach((key) => pendingSettings.delete(key));
      renderAgent();
    }
  }

  function bindSwitch(id, settingKey) {
    const element = byId(id);
    if (!element) return;
    const activate = () => {
      if (element.classList.contains('disabled') || element.classList.contains('loading')) return;
      updateSettings({ [settingKey]: !state.settings[settingKey] });
    };
    element.addEventListener('click', activate);
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
    });
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    if (!action) return;
    if (!confirmActivityDanger(action, button)) return;
    button.disabled = true;
    try {
      let result;
      if (action === 'follow' && Number(button.dataset.userId) === Number(state.currentUserId)) {
        throw new Error('不能关注自己。你可以搜索其他用户。');
      }
      if (action === 'follow') result = await client().follow(Number(button.dataset.userId));
      if (action === 'unfollow') result = await client().unfollow(button.dataset.followId);
      if (action === 'delete-rule') result = await client().deleteRule(button.dataset.ruleId);
      if (action === 'block') result = await client().block(Number(button.dataset.userId));
      if (action === 'unblock') result = await client().unblock(Number(button.dataset.userId));
      if (action === 'toggle-app') {
        const shouldPublishLocalCandidate = button.dataset.localDetected === '1'
          && button.dataset.hidden === '1';
        result = shouldPublishLocalCandidate
          ? await client().upsertApp({
              appKey: button.dataset.appKey,
              displayName: button.dataset.displayName,
            })
          : await client().setAppHidden(
              button.dataset.appKey,
              button.dataset.hidden !== '1',
              button.dataset.displayName,
            );
      }
      if (action === 'create-rule') {
        const card = button.closest('.activity-follow-card');
        const appKey = card?.querySelector('[data-field="app-key"]')?.value?.trim();
        const displayName = card?.querySelector('[data-field="display-name"]')?.value?.trim();
        result = await client().createRule({ followId: button.dataset.followId, appKey, displayName });
      }
      if (action === 'load-catalog') {
        const follow = state.follows.find((item) => item.id === button.dataset.followId);
        result = await client().getApps(follow?.user?.id);
        if (!failed(result) && follow) {
          follow.catalog = result.apps || [];
          follow.catalogLoaded = true;
        }
        renderFollows();
        return;
      }
      if (action === 'catalog-rule') {
        result = await client().createRule({
          followId: button.dataset.followId,
          appKey: button.dataset.appKey,
          displayName: button.dataset.displayName,
        });
      }
      if (!result || failed(result)) throw new Error(errorText(result, '操作失败'));
      await refreshData(true);
      const actionMessages = {
        follow: '已关注，可以为对方公开的应用设置提醒。',
        unfollow: '已取消关注。',
        'delete-rule': '提醒规则已删除。',
        block: '已拉黑，双方的关注动态已撤销。',
        unblock: '已解除拉黑。',
        'toggle-app': button.dataset.hidden === '1' ? '已公开此应用。' : '已停止公开此应用。',
        'create-rule': '提醒规则已添加。',
        'catalog-rule': '提醒规则已添加。',
      };
      notify(actionMessages[action] || '操作已完成', 'success');
    } catch (error) {
      notify(error.message || '操作失败', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function displayNameFromProcess(processName = '') {
    return String(processName || '').replace(/\.exe$/i, '').replace(/[-_]+/g, ' ').trim();
  }

  async function pickActivityAppForComposer() {
    const button = byId('activityActiveAppBtn');
    if (button) button.disabled = true;
    try {
      const selected = await window._nekoModules?.services?.SystemClient?.pickActivityAppWindow?.();
      if (!selected) {
        notify('已取消选择。', 'info');
        return;
      }
      const processName = String(selected?.processName || '').trim();
      if (!processName) {
        notify('没有读到这个窗口的进程名，请手动输入 .exe 进程名。', 'warn');
        return;
      }
      const appKeyInput = byId('activityAppKeyInput');
      const appNameInput = byId('activityAppNameInput');
      if (appKeyInput) appKeyInput.value = processName;
      if (appNameInput && !appNameInput.value.trim()) appNameInput.value = displayNameFromProcess(processName);
      notify('已选择应用。确认名称后点击“公开此应用”。', 'success');
    } catch (error) {
      notify(error.message || '选择应用失败，请手动输入。', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function addPublicAppFromComposer() {
    const button = byId('activityAddAppBtn');
    const appKey = byId('activityAppKeyInput')?.value?.trim();
    const displayName = byId('activityAppNameInput')?.value?.trim();
    if (!appKey) {
      notify('请输入要公开的 .exe 进程名。', 'warn');
      byId('activityAppKeyInput')?.focus?.();
      return;
    }
    if (button) button.disabled = true;
    try {
      const result = await client()?.upsertApp?.({ appKey, displayName });
      if (!result || failed(result)) throw new Error(errorText(result, '公开应用失败'));
      await refreshData(true);
      notify('已公开此应用。关注你的人现在可以为它设置提醒。', 'success');
    } catch (error) {
      notify(error.message || '公开应用失败', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function handleRefreshButton(button) {
    setButtonBusy(button, true, '刷新中');
    setPageStatus('正在刷新关注动态。', 'loading');
    try {
      const result = await refreshData();
      if (!result || failed(result)) {
        setPageStatus('刷新失败，请稍后再试。', 'error');
        return;
      }
      if (state.partialFailures.length) {
        renderPartialLoadStatus();
      } else {
        setPageStatus('关注动态已刷新。', 'success');
      }
      window.setTimeout(() => setPageStatus('', 'info'), 1800);
    } catch (error) {
      notify(error.message || '刷新失败', 'error');
      setPageStatus('刷新失败，请稍后再试。', 'error');
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function handleRepairButton(button) {
    setButtonBusy(button, true, '修复中');
    setPageStatus('正在重新准备后台提醒。', 'loading');
    try {
      const result = await client()?.provisionAgent?.();
      if (!result || failed(result)) throw new Error(errorText(result, '后台提醒修复失败'));
      notify('后台提醒已重新准备好', 'success');
      setPageStatus('后台提醒已重新准备好。', 'success');
      await refreshData(true);
      window.setTimeout(() => setPageStatus('', 'info'), 2200);
    } catch (error) {
      notify(error.message || '后台提醒修复失败', 'error');
      setPageStatus('后台提醒修复失败，请检查登录状态和服务器连接。', 'error');
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function handlePauseButton(button) {
    const paused = button.dataset.paused === '1';
    setButtonBusy(button, true, paused ? '恢复中' : '暂停中');
    setPageStatus(paused ? '正在恢复活动提醒。' : '正在临时暂停活动提醒。', 'loading');
    try {
      const result = paused ? await client()?.resumeAgent?.() : await client()?.pauseAgent?.();
      if (!result || failed(result)) throw new Error(errorText(result, '状态切换失败'));
      notify(paused ? '活动提醒已恢复' : '活动提醒已临时暂停', 'success');
      setPageStatus(paused ? '活动提醒已恢复。' : '活动提醒已临时暂停。', 'success');
      await refreshAgent(true);
      window.setTimeout(() => setPageStatus('', 'info'), 2000);
    } catch (error) {
      notify(error.message || '状态切换失败', 'error');
      setPageStatus('状态切换失败，请稍后再试。', 'error');
      await refreshAgent(true);
    } finally {
      setButtonBusy(button, false);
    }
  }

  async function handleSearchButton(button) {
    const query = byId('activityUserSearchInput')?.value?.trim();
    if (!query) return notify('请输入用户名或 #UID', 'warn');
    if (queryTargetsSelf(query)) {
      renderSearchMessage('不能关注自己。你可以搜索其他用户。', 'compact');
      return notify('不能关注自己喵。换一个用户试试。', 'warn');
    }
    setButtonBusy(button, true, '搜索中');
    renderSearchMessage('正在搜索用户…');
    try {
      const result = await client()?.searchUsers?.(query);
      if (!result || failed(result)) throw new Error(errorText(result, '搜索失败'));
      const users = (result?.users || []).filter((user) => Number(user?.id) !== Number(state.currentUserId));
      if (!users.length && (result?.users || []).length) {
        renderSearchMessage('不能关注自己。你可以搜索其他用户。', 'compact');
        return;
      }
      renderSearchResults(users);
    } catch (error) {
      if (queryTargetsSelf(query)) {
        renderSearchMessage('不能关注自己。你可以搜索其他用户。', 'compact');
        notify('不能关注自己喵。换一个用户试试。', 'warn');
        return;
      }
      renderSearchMessage('搜索失败，请检查网络后重试。');
      notify(error.message || '搜索失败', 'error');
    } finally {
      setButtonBusy(button, false);
    }
  }

  function bindActivityToolbarDelegation() {
    const pageRoot = byId('page-activity');
    if (!pageRoot || pageRoot.dataset.toolbarDelegated === '1') return;
    pageRoot.dataset.toolbarDelegated = '1';
    pageRoot.addEventListener('click', (event) => {
      const button = event.target.closest?.('#activityRefreshBtn, #activityRepairBtn, #activityPauseBtn, #activityUserSearchBtn');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled && !button.classList.contains('loading')) return;
      if (button.id === 'activityRefreshBtn') handleRefreshButton(button);
      if (button.id === 'activityRepairBtn') handleRepairButton(button);
      if (button.id === 'activityPauseBtn') handlePauseButton(button);
      if (button.id === 'activityUserSearchBtn') handleSearchButton(button);
    }, true);
  }

  function init(options = {}) {
    deps = { ...deps, ...options };
    if (initialized) return;
    initialized = true;
    bindActivityToolbarDelegation();
    bindSwitch('activityEnabledSwitch', 'enabled');
    bindSwitch('activityPublishingSwitch', 'publishing');
    bindSwitch('activitySnapshotsSwitch', 'snapshots');
    bindSwitch('activityBackgroundSwitch', 'background');
    bindSwitch('activityAutoStartSwitch', 'autoStart');
    byId('activityActiveAppBtn')?.addEventListener('click', pickActivityAppForComposer);
    byId('activityAddAppBtn')?.addEventListener('click', addPublicAppFromComposer);
    byId('activityAppKeyInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') byId('activityAddAppBtn')?.click();
    });
    byId('activityAppNameInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') byId('activityAddAppBtn')?.click();
    });
    byId('activityUserSearchInput')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') byId('activityUserSearchBtn')?.click();
    });
    byId('activityPrivacyOptions')?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-visibility]');
      if (!button || button.disabled) return;
      const result = await client()?.setPrivacy?.(button.dataset.visibility);
      if (failed(result)) return notify(errorText(result, '隐私设置失败'), 'error');
      state.visibility = button.dataset.visibility;
      renderPrivacy();
      notify('可见范围已更新', 'success');
    });
    document.getElementById('page-activity')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (button) handleAction(button);
    });
    window._nekoModules?.services?.IpcClient?.on?.('activity:stateChanged', (agent) => {
      state.agent = { ...state.agent, ...(agent || {}) };
      renderAgent();
    });
    window._nekoModules?.services?.IpcClient?.on?.('app:openPage', (payload) => {
      if (payload?.page === 'page-activity') window._nekoModules?.router?.navigateTo?.('page-activity');
    });
    loadCurrentUser();
    refreshData(true);
    refreshTimer = window.setInterval(() => {
      if (window._nekoModules?.router?.getCurrentPage?.() === 'page-activity') refreshData(true);
    }, 10000);
  }

  function destroy() {
    if (refreshTimer) window.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  window._nekoModules.pages.ActivityPage = { init, refresh: refreshData, destroy };
})();
