(function () {
  window._nekoModules = window._nekoModules || {};
  window._nekoModules.pages = window._nekoModules.pages || {};

  const defaultDeps = {
    callAuth: async () => ({}),
    callConfig: async () => null,
    callSystem: async () => null,
    validateKey: async () => ({ valid: false }),
    addLogLine: () => {},
    showNekoIsland: () => {},
    escapeHtml: (value) => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
  };

  const AuthPage = {
    _initialized: false,
    _api: {},

    init(deps = {}) {
      if (this._initialized) return this._api;
      this._initialized = true;
      const { callAuth, callConfig, callSystem, validateKey, addLogLine, showNekoIsland, escapeHtml } = { ...defaultDeps, ...deps };

  //  用户认证系统
  // ══════════════════════════════════════════════════════════════

  // ── 辅助：灵动岛通知（复用已有逻辑或简易版）──────────────────
  function showAuthNotice(msg, type = 'info') {
    // 尝试使用已有的灵动岛
    const island = document.getElementById('nekoIsland');
    if (island && typeof window._showIslandNotice === 'function') {
      window._showIslandNotice(msg, type);
      return;
    }
    // 降级方案：控制台
    addLogLine(type === 'error' ? 'ERROR' : 'INFO', msg);
  }

  function applyAvatar(image, { src = '', name = '', mode = 'initial' } = {}) {
    if (!image) return;
    const avatarFallback = window._nekoModules?.components?.avatarFallback;
    if (avatarFallback?.apply) {
      avatarFallback.apply(image, { src, name, mode });
      return;
    }
    image.src = src || '../../assets/app_icon.png';
  }

  // ── UI 状态更新 ────────────────────────────────────────────────
  function updateAuthUI(isLoggedIn, user) {
    const avatar = document.getElementById('userAvatar');
    const nameEl = document.getElementById('dropdownUsername');
    const roleEl = document.getElementById('dropdownRole');
    const loginBtn = document.getElementById('btnOpenLogin');
    const profileBtn = document.getElementById('btnProfileSettings');
    const logoutBtn = document.getElementById('btnLogout');
    const logoutDiv = document.getElementById('logoutDivider');
    const settingsAvatar = document.getElementById('settingsAvatar');
    const profileAvatar = document.getElementById('profileModalAvatar');
    const settingsName = document.querySelector('.settings-profile-name');
    const settingsSub = document.querySelector('.settings-profile-sub');

    if (isLoggedIn && user) {
      const displayName = user.username || 'User';
      const avatarUrl = user.avatar || '';

      applyAvatar(avatar, { src: avatarUrl, name: displayName });
      if (nameEl) nameEl.textContent = displayName;
      if (roleEl) roleEl.textContent = user.role === 'admin' ? '管理员' : '已登录';
      if (loginBtn) loginBtn.style.display = 'none';
      if (profileBtn) profileBtn.style.display = '';
      if (logoutBtn) logoutBtn.style.display = '';
      if (logoutDiv) logoutDiv.style.display = '';
      applyAvatar(settingsAvatar, { src: avatarUrl, name: displayName });
      applyAvatar(profileAvatar, { src: avatarUrl, name: displayName });
      if (settingsName) settingsName.textContent = displayName;
      if (settingsSub) settingsSub.textContent = `已登录 · ${user.role === 'admin' ? '管理员' : '普通用户'}`;
      document.dispatchEvent(new CustomEvent('neko:authChange', { detail: { loggedIn: true, user } }));
    } else {
      applyAvatar(avatar, { name: 'Neko Status', mode: 'app' });
      if (nameEl) nameEl.textContent = '未登录';
      if (roleEl) roleEl.textContent = '设备密钥模式';
      if (loginBtn) loginBtn.style.display = '';
      if (profileBtn) profileBtn.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'none';
      if (logoutDiv) logoutDiv.style.display = 'none';
      applyAvatar(settingsAvatar, { name: 'Neko Status', mode: 'app' });
      applyAvatar(profileAvatar, { name: 'Neko Status', mode: 'app' });
      if (settingsName) settingsName.textContent = 'Neko User';
      if (settingsSub) settingsSub.textContent = '设备监控本地账户';
      document.dispatchEvent(new CustomEvent('neko:authChange', { detail: { loggedIn: false, user: null } }));
    }
  }

  // ── 认证弹窗逻辑 ──────────────────────────────────────────────
  const authModal = document.getElementById('authModal');
  const authLoginView = document.getElementById('authLoginView');
  const authRegisterView = document.getElementById('authRegisterView');
  const authViewStage = document.getElementById('authViewStage');

  function setAuthView(mode = 'login', options = {}) {
    const active = mode === 'register' ? authRegisterView : authLoginView;
    const inactive = active === authRegisterView ? authLoginView : authRegisterView;
    const setter = window._nekoUIHelpers?.setViewStackState;
    if (authViewStage && active && typeof setter === 'function') {
      setter(authViewStage, active, {
        selector: '[data-ui-view]',
        display: 'block',
        duration: 220,
        ...options,
      });
      return;
    }
    if (active) {
      active.style.display = '';
      active.setAttribute?.('aria-hidden', 'false');
    }
    if (inactive) {
      inactive.style.display = 'none';
      inactive.setAttribute?.('aria-hidden', 'true');
    }
  }

  function openAuthModal(mode = 'login') {
    if (!authModal) return;

    // 检查服务器配置状态，更新警告/标识显示
    (async () => {
      const state = await callAuth('getState', 'authGetState') || {};
      const warningEl = document.getElementById('authServerWarning');
      const localBadge = document.getElementById('authLocalBadge');
      const loginBtn = document.getElementById('authLoginBtn');
      const regBtn = document.getElementById('authRegBtn');

      if (state.serverMode === 'local' && !state.serverConfigured) {
        // 本地测试模式，未连接服务器
        if (warningEl) warningEl.style.display = 'none';
        if (localBadge) localBadge.style.display = '';
        if (loginBtn) loginBtn.disabled = false;
        if (regBtn) regBtn.disabled = false;
      } else if (!state.serverConfigured) {
        // 生产模式但未配置服务器
        if (warningEl) warningEl.style.display = '';
        if (localBadge) localBadge.style.display = 'none';
        if (loginBtn) loginBtn.disabled = true;
        if (regBtn) regBtn.disabled = true;
      } else {
        // 服务器已配置
        if (warningEl) warningEl.style.display = 'none';
        if (localBadge) localBadge.style.display = 'none';
        if (loginBtn) loginBtn.disabled = false;
        if (regBtn) regBtn.disabled = false;
      }
    })();

    authModal.style.display = 'flex';
    setAuthView(mode);
    // 清空错误和输入
    const errLogin = document.getElementById('authLoginError');
    const errReg = document.getElementById('authRegError');
    if (errLogin) errLogin.style.display = 'none';
    if (errReg) errReg.style.display = 'none';
  }

  function closeAuthModal() {
    if (authModal) authModal.style.display = 'none';
  }


  // 关闭按钮
  const closeAuthBtn = document.getElementById('closeAuthModal');
  if (closeAuthBtn) closeAuthBtn.addEventListener('click', closeAuthModal);
  // 切换到注册
  const switchToReg = document.getElementById('switchToRegister');
  if (switchToReg) switchToReg.addEventListener('click', (e) => { e.preventDefault(); openAuthModal('register'); });
  // 切换到登录
  const switchToLog = document.getElementById('switchToLogin');
  if (switchToLog) switchToLog.addEventListener('click', (e) => { e.preventDefault(); openAuthModal('login'); });
  // 点击遮罩关闭
  if (authModal) authModal.addEventListener('click', (e) => { if (e.target === authModal) closeAuthModal(); });

  // auth modal 内「去配置」按钮 → 关闭 auth modal，打开 configModal
  const authOpenConfigBtn = document.getElementById('authOpenConfigBtn');
  if (authOpenConfigBtn) {
    authOpenConfigBtn.addEventListener('click', () => {
      closeAuthModal();
      // 标记来源，以便配置成功后重新打开 authModal
      window._authPendingAfterConfig = true;
      document.getElementById('stgConfigBtn')?.click();  // 触发已有的 loadConfigToModal + open modal 逻辑
      const cm = document.getElementById('configModal');
      if (cm) cm.classList.add('show');
    });
  }

  // 导航栏 "登录/注册" 按钮
  const btnOpenLogin = document.getElementById('btnOpenLogin');
  if (btnOpenLogin) btnOpenLogin.addEventListener('click', () => openAuthModal('login'));

  // ── 登录提交 ──────────────────────────────────────────────────
  const authLoginBtn = document.getElementById('authLoginBtn');
  if (authLoginBtn) {
    authLoginBtn.addEventListener('click', async () => {
      const username = document.getElementById('authLoginUsername')?.value?.trim();
      const password = document.getElementById('authLoginPassword')?.value;
      const errEl = document.getElementById('authLoginError');

      if (!username || !password) {
        if (errEl) { errEl.textContent = '请填写用户名和密码'; errEl.style.display = ''; }
        return;
      }

      window._nekoUIHelpers?.setButtonBusy?.(authLoginBtn, true, { label: '登录中…' });

      const result = await callAuth('login', 'authLogin', username, password);

      if (result.success) {
        closeAuthModal();
        updateAuthUI(true, result.user);
        const localHint = result.isLocal ? '（本地测试模式）' : '';
        showAuthNotice(`欢迎回来，${result.user.username}！${localHint}`, 'info');
        // 登录后自动检查设备密钥（仅在线模式）
        if (!result.isLocal) await autoProvisionDeviceKey();
      } else {
        const errMsg = result.message || '登录失败';
        if (errEl) { errEl.textContent = errMsg; errEl.style.display = ''; }
        addLogLine('ERROR', `登录失败: ${errMsg}`);
      }

      window._nekoUIHelpers?.setButtonBusy?.(authLoginBtn, false);
    });
  }

  // Enter 键提交登录
  ['authLoginUsername', 'authLoginPassword'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') authLoginBtn?.click(); });
  });

  // ── 注册提交 ──────────────────────────────────────────────────
  const authRegBtn = document.getElementById('authRegBtn');
  if (authRegBtn) {
    authRegBtn.addEventListener('click', async () => {
      const username = document.getElementById('authRegUsername')?.value?.trim();
      const password = document.getElementById('authRegPassword')?.value;
      const confirm = document.getElementById('authRegConfirm')?.value;
      const errEl = document.getElementById('authRegError');

      if (!username || !password) {
        if (errEl) { errEl.textContent = '请填写用户名和密码'; errEl.style.display = ''; }
        return;
      }
      if (password !== confirm) {
        if (errEl) { errEl.textContent = '两次输入的密码不一致'; errEl.style.display = ''; }
        return;
      }

      window._nekoUIHelpers?.setButtonBusy?.(authRegBtn, true, { label: '注册中…' });

      const result = await callAuth('register', 'authRegister', username, password);

      if (result.success) {
        closeAuthModal();
        updateAuthUI(true, result.user);
        const localHint = result.isLocal ? '（本地测试模式）' : '';
        showAuthNotice(`注册成功！欢迎，${result.user.username}${localHint}`, 'info');
        // 注册后自动生成设备密钥（仅在线模式）
        if (!result.isLocal) await autoProvisionDeviceKey();
      } else {
        const errMsg = result.message || '注册失败';
        if (errEl) { errEl.textContent = errMsg; errEl.style.display = ''; }
        addLogLine('ERROR', `注册失败: ${errMsg}`);
      }

      window._nekoUIHelpers?.setButtonBusy?.(authRegBtn, false);
    });
  }

  // Enter 键提交注册
  ['authRegUsername', 'authRegPassword', 'authRegConfirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') authRegBtn?.click(); });
  });

  // ── 退出登录 ──────────────────────────────────────────────────
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      await callAuth('logout', 'authLogout');
      updateAuthUI(false, null);
      showAuthNotice('已退出登录，当前使用设备密钥模式', 'info');
    });
  }

  // ── 自动配置设备密钥 ──────────────────────────────────────────
  async function autoProvisionDeviceKey() {
    const currentKey = await callConfig('get', 'getConfig', 'deviceKey');

    // 已有密钥 → 先验证其有效性，有效则直接跳过
    if (currentKey) {
      try {
        const validation = await validateKey();
        if (validation.valid) {
          addLogLine('INFO', '当前设备密钥有效，跳过自动生成');
          return;
        }
        // 密钥无效（被撤销、设备已删除等）→ 继续生成新密钥
        addLogLine('WARN', `当前密钥已失效（${validation.error || '未知原因'}），将为当前账户重新生成`);
      } catch {
        // 验证请求失败（网络等问题）→ 保守处理，保留现有密钥
        addLogLine('WARN', '无法验证现有密钥（网络异常），保留当前密钥');
        return;
      }
    } else {
      addLogLine('INFO', '检测到未配置设备密钥，正在自动为当前设备生成...');
    }

    const result = await callAuth('generateDeviceKey', 'authGenerateDeviceKey');
    if (result.success && result.deviceKey) {
      // deviceKey 已由主进程 IPC handler 自动写入 configStore
      const keyInputEl = document.getElementById('inputDeviceKey');
      if (keyInputEl) keyInputEl.value = result.deviceKey;

      const msg = result.isExisting
        ? `已自动恢复此设备的密钥: ${result.deviceKey}`
        : `已自动为此设备生成新密钥: ${result.deviceKey}`;

      addLogLine('INFO', msg);
      showAuthNotice(`${msg}，已自动填入服务器配置`, 'info');

      // 通知系统
      callSystem('notify', 'notify', '设备密钥已自动配置', msg);
    } else {
      addLogLine('WARN', '自动生成设备密钥失败: ' + (result.message || '未知错误'));
    }
  }

  // ── 个人信息编辑（对接服务端同步）───────────────────────────
  const avatarEditorState = {
    sourceUrl: '',
    image: null,
    baseScale: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    interactionMode: '',
    dragStartX: 0,
    dragStartY: 0,
    dragOriginX: 0,
    dragOriginY: 0,
    dragOriginScale: 1,
    pendingAvatar: '',
  };

  function ensureAvatarEditorUI() {
    if (document.getElementById('avatarEditorModal')) return;

    document.body.insertAdjacentHTML('beforeend', `
      <input type="file" id="avatarFileInput" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden>
      <input type="file" id="avatarDropzoneInput" accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" hidden>
      <div class="modal-overlay" id="avatarEditorModal">
        <div class="avatar-editor-modal-container">
          <button class="close-profile-btn" id="closeAvatarEditorBtn" type="button" title="关闭头像编辑器" aria-label="关闭头像编辑器"><i class="ph ph-x" aria-hidden="true"></i></button>
          <div class="profile-header">头像编辑器</div>
          <div class="avatar-editor-body">
            <div class="avatar-dropzone" id="avatarDropzone">
              <div class="avatar-dropzone-empty" id="avatarDropzoneEmpty">
                <i class="ph ph-image-square"></i>
                <div class="avatar-dropzone-title">拖拽图片到这里，或点击选择文件</div>
                <div class="avatar-dropzone-desc">支持 PNG / JPG / WEBP / GIF / BMP</div>
              </div>
              <div class="avatar-cropper-shell" id="avatarCropperShell">
                <div class="avatar-cropper-stage" id="avatarCropperStage">
                  <img id="avatarCropImage" alt="avatar crop source">
                  <div class="avatar-crop-mask"></div>
                </div>
              </div>
            </div>
            <div class="avatar-editor-sidebar">
              <div class="avatar-editor-preview-wrap">
                <div class="avatar-editor-preview">
                  <img id="avatarPreviewImage" alt="" hidden>
                </div>
                <div class="avatar-editor-preview-label">1:1 圆形预览</div>
              </div>
              <div class="avatar-editor-controls">
                <label class="avatar-editor-label" for="avatarZoomRange">缩放</label>
                <input type="range" id="avatarZoomRange" min="1" max="3" step="0.01" value="1">
                <div class="avatar-editor-actions">
                  <button class="action-btn" id="avatarChooseAnotherBtn"><i class="ph ph-folder-open"></i> 重新选择</button>
                  <button class="action-btn" id="avatarResetBtn"><i class="ph ph-arrow-counter-clockwise"></i> 重置</button>
                </div>
                <div class="avatar-editor-error" id="avatarEditorError" hidden></div>
              </div>
            </div>
          </div>
          <div class="profile-footer avatar-editor-footer">
            <div class="profile-sync-hint">
              <i class="ph ph-crop"></i> 裁剪后仅更新本地预览，保存个人资料时才会上传
            </div>
            <div class="avatar-editor-footer-actions">
              <button class="action-btn avatar-editor-cancel" id="cancelAvatarEditorBtn">取消</button>
              <button class="btn-theme-save" id="applyAvatarCropBtn"><i class="ph ph-check"></i> 应用头像</button>
            </div>
          </div>
        </div>
      </div>
    `);

    const avatarEditorModal = document.getElementById('avatarEditorModal');
    avatarEditorModal?.querySelector('.profile-header')?.replaceChildren(document.createTextNode('头像编辑器'));
    avatarEditorModal?.querySelector('.avatar-dropzone-title')?.replaceChildren(document.createTextNode('拖拽图片到这里，或点击选择文件'));
    avatarEditorModal?.querySelector('.avatar-dropzone-desc')?.replaceChildren(document.createTextNode('支持 PNG / JPG / WEBP / GIF / BMP'));
    avatarEditorModal?.querySelector('.avatar-editor-preview-label')?.replaceChildren(document.createTextNode('1:1 圆形预览'));

    const controls = avatarEditorModal?.querySelector('.avatar-editor-controls');
    if (controls) {
      controls.innerHTML = `
        <div class="avatar-editor-label">操作方式</div>
        <div class="avatar-editor-instructions">
          <div class="avatar-editor-instruction"><i class="ph ph-cursor-click"></i><span>左键拖动图片，调整头像位置</span></div>
          <div class="avatar-editor-instruction"><i class="ph ph-mouse-middle-click"></i><span>中键上下拖动，连续缩放图片</span></div>
          <div class="avatar-editor-instruction"><i class="ph ph-upload-simple"></i><span>应用头像后，再点击保存更改同步到服务器</span></div>
        </div>
        <div class="avatar-editor-actions">
          <button class="action-btn" id="avatarChooseAnotherBtn"><i class="ph ph-folder-open"></i> 重新选择</button>
          <button class="action-btn" id="avatarResetBtn"><i class="ph ph-arrow-counter-clockwise"></i> 重置</button>
        </div>
        <div class="avatar-editor-error" id="avatarEditorError" hidden></div>
      `;
    }

    const footer = avatarEditorModal?.querySelector('.avatar-editor-footer');
    if (footer) {
      footer.innerHTML = `
        <div class="avatar-editor-footer-note">
          <i class="ph ph-crop"></i>
          <span>裁剪后的头像会先更新当前预览，点击“保存更改”后才会同步到服务器。</span>
        </div>
        <div class="avatar-editor-footer-actions">
          <button class="action-btn avatar-editor-cancel" id="cancelAvatarEditorBtn">取消</button>
          <button class="btn-theme-save" id="applyAvatarCropBtn"><i class="ph ph-check"></i> 应用头像</button>
        </div>
      `;
    }
  }

  function getAvatarCropMetrics() {
    const shell = document.getElementById('avatarCropperShell');
    if (!shell) return { radius: 160, diameter: 320 };
    const shellWidth = shell.clientWidth || 0;
    const shellHeight = shell.clientHeight || 0;
    const diameter = Math.max(260, Math.min(shellWidth, shellHeight) - 72);
    const radius = diameter / 2;
    shell.style.setProperty('--avatar-crop-diameter', `${diameter}px`);
    shell.style.setProperty('--avatar-crop-radius', `${radius}px`);
    return { radius, diameter };
  }

  function setAvatarEditorError(message = '') {
    const errorEl = document.getElementById('avatarEditorError');
    if (!errorEl) return;
    errorEl.hidden = !message;
    errorEl.textContent = message || '';
  }

  function getAvatarFitScale() {
    if (!avatarEditorState.image) return 1;
    const { radius } = getAvatarCropMetrics();
    const cropDiameter = radius * 2;
    return Math.max(cropDiameter / avatarEditorState.image.width, cropDiameter / avatarEditorState.image.height);
  }

  function clampAvatarOffsets() {
    if (!avatarEditorState.image) return;
    const { radius } = getAvatarCropMetrics();
    const fitScale = getAvatarFitScale();
    const renderedWidth = avatarEditorState.image.width * fitScale * avatarEditorState.scale;
    const renderedHeight = avatarEditorState.image.height * fitScale * avatarEditorState.scale;
    const maxOffsetX = Math.max(0, renderedWidth / 2 - radius);
    const maxOffsetY = Math.max(0, renderedHeight / 2 - radius);
    avatarEditorState.offsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, avatarEditorState.offsetX));
    avatarEditorState.offsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, avatarEditorState.offsetY));
  }

  function clampAvatarScale(nextScale) {
    return Math.max(1, Math.min(3.2, nextScale));
  }

  function buildCroppedAvatarDataUrl() {
    if (!avatarEditorState.image) return '';
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const { radius } = getAvatarCropMetrics();
    const cropDiameter = radius * 2;
    const transformScale = getAvatarFitScale() * avatarEditorState.scale;
    const sx = (avatarEditorState.image.width / 2) - ((radius + avatarEditorState.offsetX) / transformScale);
    const sy = (avatarEditorState.image.height / 2) - ((radius + avatarEditorState.offsetY) / transformScale);
    const sSize = cropDiameter / transformScale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(128, 128, 128, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatarEditorState.image, sx, sy, sSize, sSize, 0, 0, 256, 256);
    ctx.restore();

    return canvas.toDataURL('image/png');
  }

  function updateAvatarPreview() {
    const preview = document.getElementById('avatarPreviewImage');
    if (!preview) return;
    const dataUrl = buildCroppedAvatarDataUrl();
    if (!dataUrl) {
      preview.hidden = true;
      preview.removeAttribute('src');
      return;
    }
    preview.src = dataUrl;
    preview.hidden = false;
  }

  function renderAvatarCropper() {
    const dropzone = document.getElementById('avatarDropzone');
    const shell = document.getElementById('avatarCropperShell');
    const empty = document.getElementById('avatarDropzoneEmpty');
    const imageEl = document.getElementById('avatarCropImage');
    if (!dropzone || !shell || !empty || !imageEl) return;

    if (!avatarEditorState.image || !avatarEditorState.sourceUrl) {
      dropzone.classList.remove('has-image');
      shell.classList.remove('is-ready');
      empty.hidden = false;
      imageEl.removeAttribute('src');
      updateAvatarPreview();
      return;
    }

    clampAvatarOffsets();
    dropzone.classList.add('has-image');
    shell.classList.add('is-ready');
    empty.hidden = true;
    const fitScale = getAvatarFitScale();
    imageEl.src = avatarEditorState.sourceUrl;
    imageEl.style.width = `${avatarEditorState.image.width * fitScale * avatarEditorState.scale}px`;
    imageEl.style.height = `${avatarEditorState.image.height * fitScale * avatarEditorState.scale}px`;
    imageEl.style.transform = `translate(calc(-50% + ${avatarEditorState.offsetX}px), calc(-50% + ${avatarEditorState.offsetY}px))`;
    updateAvatarPreview();
  }

  async function loadAvatarSource(file) {
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      setAvatarEditorError('只能上传图片文件');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (avatarEditorState.sourceUrl && avatarEditorState.sourceUrl.startsWith('blob:')) {
        URL.revokeObjectURL(avatarEditorState.sourceUrl);
      }
      avatarEditorState.sourceUrl = objectUrl;
      avatarEditorState.image = image;
      avatarEditorState.baseScale = 1;
      avatarEditorState.scale = 1;
      avatarEditorState.offsetX = 0;
      avatarEditorState.offsetY = 0;
      setAvatarEditorError('');
      renderAvatarCropper();
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setAvatarEditorError('图片加载失败，请换一张试试');
    };
    image.src = objectUrl;
  }

  function openAvatarEditor() {
    ensureAvatarEditorUI();
    document.getElementById('avatarEditorModal')?.classList.add('show');
    document.getElementById('avatarDropzone')?.classList.remove('is-dragover');
    setAvatarEditorError('');
    renderAvatarCropper();
  }

  function closeAvatarEditor() {
    document.getElementById('avatarEditorModal')?.classList.remove('show');
  }

  function wireAvatarEditor() {
    ensureAvatarEditorUI();
    const profileAvatarTrigger = document.querySelector('.profile-avatar-sec');
    const profileAvatarImage = document.getElementById('profileModalAvatar');
    const pickerInput = document.getElementById('avatarFileInput');
    const dropzoneInput = document.getElementById('avatarDropzoneInput');
    const dropzone = document.getElementById('avatarDropzone');
    const cropperShell = document.getElementById('avatarCropperShell');

    profileAvatarTrigger?.setAttribute('tabindex', '0');
    profileAvatarTrigger?.addEventListener('click', openAvatarEditor);
    profileAvatarTrigger?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openAvatarEditor();
      }
    });

    document.getElementById('closeAvatarEditorBtn')?.addEventListener('click', closeAvatarEditor);
    document.getElementById('cancelAvatarEditorBtn')?.addEventListener('click', closeAvatarEditor);
    document.getElementById('avatarChooseAnotherBtn')?.addEventListener('click', () => dropzoneInput?.click());
    dropzone?.addEventListener('click', (e) => {
      if (e.target === dropzone || e.target.closest('#avatarDropzoneEmpty')) dropzoneInput?.click();
    });

    [pickerInput, dropzoneInput].forEach((input) => {
      input?.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        loadAvatarSource(file);
        e.target.value = '';
      });
    });

    ['dragenter', 'dragover'].forEach((eventName) => {
      dropzone?.addEventListener(eventName, (e) => {
        e.preventDefault();
        if ([...(e.dataTransfer?.items || [])].some((item) => item.kind === 'file' && item.type.startsWith('image/'))) {
          dropzone.classList.add('is-dragover');
        }
      });
    });

    ['dragleave', 'drop'].forEach((eventName) => {
      dropzone?.addEventListener(eventName, (e) => {
        e.preventDefault();
        if (eventName === 'drop') {
          const file = [...(e.dataTransfer?.files || [])][0];
          if (file) loadAvatarSource(file);
        }
        dropzone.classList.remove('is-dragover');
      });
    });

    document.getElementById('avatarResetBtn')?.addEventListener('click', () => {
      if (!avatarEditorState.image) return;
      avatarEditorState.scale = 1;
      avatarEditorState.offsetX = 0;
      avatarEditorState.offsetY = 0;
      renderAvatarCropper();
    });

    function startAvatarInteraction(e) {
      if (!avatarEditorState.image) return;
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      avatarEditorState.dragging = true;
      avatarEditorState.interactionMode = e.button === 1 ? 'zoom' : 'move';
      avatarEditorState.dragStartX = e.clientX;
      avatarEditorState.dragStartY = e.clientY;
      avatarEditorState.dragOriginX = avatarEditorState.offsetX;
      avatarEditorState.dragOriginY = avatarEditorState.offsetY;
      avatarEditorState.dragOriginScale = avatarEditorState.scale;
      cropperShell?.classList.toggle('zooming', avatarEditorState.interactionMode === 'zoom');
      cropperShell?.classList.add('dragging');
      if ('pointerId' in e && cropperShell?.setPointerCapture) {
        try { cropperShell.setPointerCapture(e.pointerId); } catch {}
      }
    }

    function updateAvatarInteraction(e) {
      if (!avatarEditorState.dragging) return;
      e.preventDefault();
      if (avatarEditorState.interactionMode === 'zoom') {
        const delta = (avatarEditorState.dragStartY - e.clientY) / 160;
        avatarEditorState.scale = clampAvatarScale(avatarEditorState.dragOriginScale + delta);
      } else {
        avatarEditorState.offsetX = avatarEditorState.dragOriginX + (e.clientX - avatarEditorState.dragStartX);
        avatarEditorState.offsetY = avatarEditorState.dragOriginY + (e.clientY - avatarEditorState.dragStartY);
      }
      renderAvatarCropper();
    }

    function stopAvatarDrag(e) {
      if (!avatarEditorState.dragging) return;
      avatarEditorState.dragging = false;
      avatarEditorState.interactionMode = '';
      cropperShell?.classList.remove('dragging');
      cropperShell?.classList.remove('zooming');
      if (cropperShell && e?.pointerId != null && cropperShell.releasePointerCapture) {
        try {
          if (cropperShell.hasPointerCapture?.(e.pointerId)) cropperShell.releasePointerCapture(e.pointerId);
        } catch {}
      }
    }

    cropperShell?.addEventListener('pointerdown', startAvatarInteraction);
    cropperShell?.addEventListener('pointermove', updateAvatarInteraction);
    cropperShell?.addEventListener('pointerup', stopAvatarDrag);
    cropperShell?.addEventListener('pointercancel', stopAvatarDrag);
    cropperShell?.addEventListener('mousedown', startAvatarInteraction);
    cropperShell?.addEventListener('auxclick', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    cropperShell?.addEventListener('contextmenu', (e) => {
      if (avatarEditorState.dragging || e.button === 1) e.preventDefault();
    });
    cropperShell?.addEventListener('wheel', (e) => {
      if (!avatarEditorState.image) return;
      e.preventDefault();
      avatarEditorState.scale = clampAvatarScale(avatarEditorState.scale - (e.deltaY * 0.0015));
      renderAvatarCropper();
    }, { passive: false });
    window.addEventListener('mousemove', updateAvatarInteraction);
    window.addEventListener('mouseup', stopAvatarDrag);
    window.addEventListener('blur', stopAvatarDrag);

    document.getElementById('applyAvatarCropBtn')?.addEventListener('click', () => {
      if (!avatarEditorState.image) {
        setAvatarEditorError('请先选择一张头像图片');
        return;
      }
      const cropped = buildCroppedAvatarDataUrl();
      if (!cropped) {
        setAvatarEditorError('头像裁剪失败，请重试');
        return;
      }
      avatarEditorState.pendingAvatar = cropped;
      if (profileAvatarImage) profileAvatarImage.src = cropped;
      closeAvatarEditor();
    });

    document.getElementById('avatarEditorModal')?.addEventListener('paste', (e) => {
      const file = [...(e.clipboardData?.files || [])][0];
      if (file) loadAvatarSource(file);
    });

    window.addEventListener('resize', () => {
      if (document.getElementById('avatarEditorModal')?.classList.contains('show')) {
        renderAvatarCropper();
      }
    });
  }

  const profileModal = document.getElementById('profileModal');
  const openProfileBtns = [
    document.getElementById('btnProfileSettings'),
    document.getElementById('openProfileBtnSettings'),
  ].filter(Boolean);

  wireAvatarEditor();

  openProfileBtns.forEach(btn => {
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    clone.addEventListener('click', async () => {
      const state = await callAuth('getState', 'authGetState') || {};
      if (!state.isLoggedIn) {
        showAuthNotice('请先登录后再编辑个人信息', 'info');
        openAuthModal('login');
        return;
      }

      const fillProfileForm = (u = {}) => {
        const pUsername = document.getElementById('profileUsername');
        const pEmail = document.getElementById('profileEmail');
        const pAvatar = document.getElementById('profileModalAvatar');
        if (pUsername) pUsername.value = u.username || '';
        if (pEmail) pEmail.value = u.email || '';
        avatarEditorState.pendingAvatar = u.avatar || '';
        applyAvatar(pAvatar, { src: u.avatar || '', name: u.username || 'User' });
      };

      fillProfileForm(state.user || {});
      if (profileModal) profileModal.classList.add('show');

      const me = await callAuth('getMe', 'authGetMe');
      if (me.success && me.user) {
        fillProfileForm(me.user);
      } else if (me && me.success === false) {
        showAuthNotice(me.message || me.error || '用户信息刷新失败', 'error');
      }
    });
  });

  // 保存个人信息
  const saveProfileBtn = document.getElementById('saveProfileBtn');
  if (saveProfileBtn) {
    const clone = saveProfileBtn.cloneNode(true);
    saveProfileBtn.parentNode.replaceChild(clone, saveProfileBtn);
    clone.addEventListener('click', async () => {
      const username = document.getElementById('profileUsername')?.value?.trim();
      const email = document.getElementById('profileEmail')?.value?.trim();
      const currentPassword = document.getElementById('profileCurrentPassword')?.value;
      const newPassword = document.getElementById('profileNewPassword')?.value;

      if (newPassword && !currentPassword) {
        showAuthNotice('请先输入当前密码', 'error');
        document.getElementById('profileCurrentPassword')?.focus();
        return;
      }
      if (currentPassword && !newPassword) {
        showAuthNotice('请输入新密码', 'error');
        document.getElementById('profileNewPassword')?.focus();
        return;
      }
      if (newPassword && newPassword.length < 6) {
        showAuthNotice('新密码至少需要 6 位', 'error');
        document.getElementById('profileNewPassword')?.focus();
        return;
      }

      const data = {};
      if (username) data.username = username;
      if (email !== undefined) data.email = email;
      if (avatarEditorState.pendingAvatar) data.avatar = avatarEditorState.pendingAvatar;
      if (currentPassword && newPassword) {
        data.currentPassword = currentPassword;
        data.newPassword = newPassword;
      }

      window._nekoUIHelpers?.setButtonBusy?.(clone, true, { label: '保存中…' });

      const result = await callAuth('updateProfile', 'authUpdateProfile', data);

      if (result.success) {
        showAuthNotice('个人信息已更新并同步到服务器', 'info');
        if (result.user) updateAuthUI(true, result.user);
        avatarEditorState.pendingAvatar = '';
        if (profileModal) profileModal.classList.remove('show');
        // 清空密码字段
        const cp = document.getElementById('profileCurrentPassword');
        const np = document.getElementById('profileNewPassword');
        if (cp) cp.value = '';
        if (np) np.value = '';
      } else {
        showAuthNotice(result.message || result.error || '保存失败', 'error');
      }

      window._nekoUIHelpers?.setButtonBusy?.(clone, false);
      clone.innerHTML = '<i class="ph ph-check-circle"></i> 保存更改';
    });
  }

  // ── 首次使用引导提示 ──────────────────────────────────────────
  async function checkFirstTimeAuthPrompt() {
    const state = await callAuth('getState', 'authGetState') || {};
    if (state.isLoggedIn) {
      // 已登录 — 更新 UI，验证 token 有效性
      updateAuthUI(true, state.user);
      // 本地测试 token 无需远程验证
      if (String(state.user?.id || '').startsWith('local-')) return;
      // 静默刷新用户信息
      const me = await callAuth('getMe', 'authGetMe');
      if (me.success && me.user) {
        updateAuthUI(true, me.user);
        if (me.sessionState === 'offline_cached') {
          showAuthNotice('当前网络不可用，正在使用本地缓存账号；恢复网络后会自动续期', 'info');
        }
      } else if (!me.success) {
        const terminal = ['AUTH_TOKEN_INVALID', 'AUTH_REFRESH_INVALID', 'AUTH_REFRESH_EXPIRED', 'AUTH_SESSION_REVOKED'].includes(me.code);
        if (terminal || me.details?.sessionState === 'needs_login') {
          updateAuthUI(false, null);
          showAuthNotice('登录已失效，请重新登录', 'info');
        } else {
          showAuthNotice('暂时无法验证账号，继续使用本地缓存信息', 'info');
        }
      }
      return;
    }

    updateAuthUI(false, null);

    // 未登录且未曾关闭提示
    if (!state.promptDismissed) {
      const prompt = document.getElementById('firstTimeAuthPrompt');
      const step1 = document.getElementById('firstTimeStep1');
      const step2 = document.getElementById('firstTimeStep2');
      const stage = document.getElementById('firstTimeViewStage');
      const setFirstTimeStep = (step, options = {}) => {
        const setter = window._nekoUIHelpers?.setViewStackState;
        if (stage && step && typeof setter === 'function') {
          setter(stage, step, { selector: '[data-ui-view]', display: 'block', duration: 240, ...options });
          return;
        }
        if (step1) step1.style.display = step === step1 ? '' : 'none';
        if (step2) step2.style.display = step === step2 ? '' : 'none';
      };
      if (prompt) {
        prompt.style.display = 'flex';
        if (state.serverConfigured) {
          // 服务器已配置，直接展示 Step 2（登录/注册）
          setFirstTimeStep(step2, { initial: true });
        } else {
          // 服务器未配置，展示 Step 1（配置服务器）
          setFirstTimeStep(step1, { initial: true });
          // 预填充默认服务器地址
          const urlInput = document.getElementById('firstTimeServerUrl');
          if (urlInput) {
            const cfg = await callConfig('getAll', 'getAllConfig');
            if (cfg) {
              urlInput.value = cfg.serverMode === 'local'
                ? (cfg.serverUrlLocal || '')
                : (cfg.serverUrlProd || '');
            }
          }
        }
      }
    }
  }

  // Step 1 — "跳过" 按钮
  const firstTimeSkipBtn = document.getElementById('firstTimeSkipBtn');
  if (firstTimeSkipBtn) {
    firstTimeSkipBtn.addEventListener('click', async () => {
      await callAuth('dismissPrompt', 'authDismissPrompt');
      const prompt = document.getElementById('firstTimeAuthPrompt');
      if (prompt) prompt.style.display = 'none';
    });
  }

  // Step 1 — "测试并继续" 按钮（内嵌服务器地址测试）
  const firstTimeTestBtn = document.getElementById('firstTimeTestBtn');
  if (firstTimeTestBtn) {
    firstTimeTestBtn.addEventListener('click', async () => {
      const urlInput = document.getElementById('firstTimeServerUrl');
      const statusEl = document.getElementById('firstTimeServerStatus');
      const serverUrl = urlInput?.value?.trim();

      if (!serverUrl) {
        if (statusEl) {
          statusEl.textContent = '请输入服务器地址';
          statusEl.className = 'first-time-server-status first-time-status-error';
        }
        return;
      }

      window._nekoUIHelpers?.setButtonBusy?.(firstTimeTestBtn, true, { label: '测试中…' });
      if (statusEl) {
        statusEl.textContent = '正在测试连接...';
        statusEl.className = 'first-time-server-status first-time-status-testing';
      }

      try {
        const connResult = await callConfig('testConnection', 'testConnection', serverUrl);

        if (connResult.ok) {
          // 保存到配置（与 configModal 同步）
          const isLocal = serverUrl.includes('localhost') || serverUrl.includes('127.0.0.1');
          const configUpdate = {
            serverMode: isLocal ? 'local' : 'production',
            serverConfigured: true,
          };
          if (isLocal) configUpdate.serverUrlLocal = serverUrl;
          else configUpdate.serverUrlProd = serverUrl;
          await callConfig('setMany', 'setManyConfig', configUpdate);

          if (statusEl) {
            statusEl.textContent = `连接成功！延迟 ${connResult.latencyMs || '—'}ms`;
            statusEl.className = 'first-time-server-status first-time-status-success';
          }
          addLogLine('SUCCESS', `服务器连接成功，延迟 ${connResult.latencyMs || '—'}ms`);

          // 延迟后过渡到 Step 2
          setTimeout(() => {
            const step1 = document.getElementById('firstTimeStep1');
            const step2 = document.getElementById('firstTimeStep2');
            const stage = document.getElementById('firstTimeViewStage');
            const setter = window._nekoUIHelpers?.setViewStackState;
            if (stage && step2 && typeof setter === 'function') {
              setter(stage, step2, { selector: '[data-ui-view]', display: 'block', duration: 240 });
            } else {
              if (step1) step1.style.display = 'none';
              if (step2) step2.style.display = '';
            }
          }, 800);
        } else {
          if (statusEl) {
            statusEl.textContent = `连接失败: ${connResult.error || '无法连接'}`;
            statusEl.className = 'first-time-server-status first-time-status-error';
          }
          addLogLine('ERROR', `服务器连接失败: ${connResult.error || '无法连接'}`);
        }
      } catch (e) {
        if (statusEl) {
          statusEl.textContent = `错误: ${e.message}`;
          statusEl.className = 'first-time-server-status first-time-status-error';
        }
      }

      window._nekoUIHelpers?.setButtonBusy?.(firstTimeTestBtn, false);
    });
  }

  // Enter 键提交服务器地址
  const firstTimeUrlInput = document.getElementById('firstTimeServerUrl');
  if (firstTimeUrlInput) {
    firstTimeUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') firstTimeTestBtn?.click();
    });
  }

  // Step 2 — "跳过" 按钮
  const firstTimeSkipStep2Btn = document.getElementById('firstTimeSkipStep2Btn');
  if (firstTimeSkipStep2Btn) {
    firstTimeSkipStep2Btn.addEventListener('click', async () => {
      await callAuth('dismissPrompt', 'authDismissPrompt');
      const prompt = document.getElementById('firstTimeAuthPrompt');
      if (prompt) prompt.style.display = 'none';
    });
  }

  // Step 2 — "登录/注册" 按钮
  const firstTimeLoginBtn = document.getElementById('firstTimeLoginBtn');
  if (firstTimeLoginBtn) {
    firstTimeLoginBtn.addEventListener('click', async () => {
      await callAuth('dismissPrompt', 'authDismissPrompt');
      const prompt = document.getElementById('firstTimeAuthPrompt');
      if (prompt) prompt.style.display = 'none';
      openAuthModal('login');
    });
  }

  // 启动时检查认证状态
  checkFirstTimeAuthPrompt();

      this._api = {
        openAuthModal,
        closeAuthModal,
        updateAuthUI,
        autoProvisionDeviceKey,
        checkFirstTimeAuthPrompt,
      };
      checkFirstTimeAuthPrompt();
      return this._api;
    },

    openAuthModal(mode = 'login') {
      return this._api.openAuthModal?.(mode);
    },

    closeAuthModal() {
      return this._api.closeAuthModal?.();
    },

    updateAuthUI(isLoggedIn, user) {
      return this._api.updateAuthUI?.(isLoggedIn, user);
    },

    autoProvisionDeviceKey() {
      return this._api.autoProvisionDeviceKey?.();
    },

    checkFirstTimeAuthPrompt() {
      return this._api.checkFirstTimeAuthPrompt?.();
    },
  };

  window._nekoModules.pages.AuthPage = AuthPage;
})();
