
        (function() {
            const savedMode = localStorage.getItem('neko-theme-mode') || 'dark';
            if (savedMode === 'light') {
                document.documentElement.setAttribute('data-theme', 'light');
            }
            const savedColor = localStorage.getItem('neko-theme-color');
            if (savedColor) {
                document.documentElement.style.setProperty('--theme-color', savedColor);
            }
        })();
    


        document.addEventListener('DOMContentLoaded', () => {
            // ======== 主题与颜色切换系统 ======== //
            const themeModeBtn = document.getElementById('themeModeBtn');
            const themeModeIcon = document.getElementById('themeModeIcon');
            const themeColorBtn = document.getElementById('themeColorBtn');
            const colorPalette = document.getElementById('colorPalette');

            // ======== 导航切换逻辑 ======== //
            const navItems = document.querySelectorAll('.nav-menu .nav-item');
            const navMenu = document.querySelector('.nav-menu');
            const navIndicator = document.getElementById('navActiveIndicator');
            const mainDashboardArea = document.getElementById('mainDashboardArea');
            const consoleArea = document.getElementById('consoleArea');
            const headerTitleText = document.querySelector('.page-title');
            const topNavEditBtn = document.getElementById('editLayoutBtn');

            function setExpandableSectionState(el, expanded, options = {}) {
                if (!el) return;
                const targetDisplay = options.display ?? el.dataset.expandedDisplay ?? 'block';
                const duration = options.duration ?? 280;
                const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

                el.dataset.expandedDisplay = targetDisplay;
                el.classList.add('ui-expandable');

                if (el._expandTimer) {
                    clearTimeout(el._expandTimer);
                    el._expandTimer = null;
                }

                if (reduceMotion) {
                    el.style.display = expanded ? targetDisplay : 'none';
                    el.style.maxHeight = expanded ? 'none' : '0px';
                    el.style.opacity = expanded ? '1' : '0';
                    el.style.transform = expanded ? 'translateY(0) scaleY(1)' : 'translateY(-6px) scaleY(0.98)';
                    el.classList.toggle('is-expanded', expanded);
                    el.classList.toggle('is-collapsed', !expanded);
                    el.classList.remove('is-animating');
                    return;
                }

                if (expanded) {
                    el.style.display = targetDisplay;
                    el.classList.add('is-animating');
                    el.classList.remove('is-collapsed');
                    el.classList.add('is-expanded');
                    el.style.maxHeight = '0px';
                    el.style.opacity = '0';
                    el.style.transform = 'translateY(-6px) scaleY(0.98)';

                    requestAnimationFrame(() => {
                        const fullHeight = el.scrollHeight;
                        el.style.maxHeight = `${fullHeight}px`;
                        el.style.opacity = '1';
                        el.style.transform = 'translateY(0) scaleY(1)';
                    });

                    el._expandTimer = setTimeout(() => {
                        el.classList.remove('is-animating');
                        el.style.maxHeight = 'none';
                        el.style.opacity = '';
                        el.style.transform = '';
                        el._expandTimer = null;
                    }, duration);
                    return;
                }

                if (getComputedStyle(el).display === 'none') {
                    el.classList.remove('is-expanded', 'is-animating');
                    el.classList.add('is-collapsed');
                    return;
                }

                el.classList.add('is-animating');
                el.classList.remove('is-expanded');
                el.style.display = targetDisplay;
                el.style.maxHeight = `${el.scrollHeight}px`;
                el.style.opacity = '1';
                el.style.transform = 'translateY(0) scaleY(1)';

                requestAnimationFrame(() => {
                    el.style.maxHeight = '0px';
                    el.style.opacity = '0';
                    el.style.transform = 'translateY(-6px) scaleY(0.98)';
                });

                el._expandTimer = setTimeout(() => {
                    el.style.display = 'none';
                    el.classList.remove('is-animating');
                    el.classList.add('is-collapsed');
                    el.style.maxHeight = '0px';
                    el._expandTimer = null;
                }, duration);
            }

            const FONT_PROFILE_PRESETS = {
                default: {
                    '--fw-page-title': '600',
                    '--fw-page-subtitle': '400',
                    '--fw-section-title': '600',
                    '--fw-section-subtitle': '400',
                    '--fw-section-label': '600',
                    '--fw-row-title': '500',
                    '--fw-row-desc': '400',
                    '--fw-body-strong': '600',
                    '--fw-value-strong': '700',
                    '--tracking-section-label': '0.06em',
                    '--tracking-label-caps': '0.07em'
                },
                cjkBalanced: {
                    '--fw-page-title': '600',
                    '--fw-page-subtitle': '420',
                    '--fw-section-title': '580',
                    '--fw-section-subtitle': '420',
                    '--fw-section-label': '580',
                    '--fw-row-title': '500',
                    '--fw-row-desc': '420',
                    '--fw-body-strong': '580',
                    '--fw-value-strong': '650',
                    '--tracking-section-label': '0.04em',
                    '--tracking-label-caps': '0.05em'
                },
                uiNeutral: {
                    '--fw-page-title': '650',
                    '--fw-page-subtitle': '420',
                    '--fw-section-title': '620',
                    '--fw-section-subtitle': '420',
                    '--fw-section-label': '620',
                    '--fw-row-title': '520',
                    '--fw-row-desc': '420',
                    '--fw-body-strong': '620',
                    '--fw-value-strong': '720',
                    '--tracking-section-label': '0.06em',
                    '--tracking-label-caps': '0.07em'
                },
                serifReadable: {
                    '--fw-page-title': '680',
                    '--fw-page-subtitle': '430',
                    '--fw-section-title': '640',
                    '--fw-section-subtitle': '430',
                    '--fw-section-label': '640',
                    '--fw-row-title': '520',
                    '--fw-row-desc': '430',
                    '--fw-body-strong': '620',
                    '--fw-value-strong': '720',
                    '--tracking-section-label': '0.03em',
                    '--tracking-label-caps': '0.04em'
                }
            };

            const FONT_PROFILE_MATCHERS = [
                { name: 'cjkBalanced', pattern: /(yahei|微软雅黑|pingfang|苹方|hiragino sans|source han sans|思源黑体|noto sans cjk|harmonyos sans|misans|oppo sans|sarasa gothic|lxgw|wenkai)/i },
                { name: 'serifReadable', pattern: /(simsun|宋体|source han serif|思源宋体|noto serif|songti|times new roman|georgia)/i },
                { name: 'uiNeutral', pattern: /(segoe ui|aptos|inter|roboto|sf pro|helvetica neue|arial|ubuntu|fira sans)/i }
            ];

            function resolveUIFontProfile(font = '') {
                const name = String(font || '').trim();
                if (!name) return 'default';
                return FONT_PROFILE_MATCHERS.find(item => item.pattern.test(name))?.name || 'default';
            }

            function applyUIFontProfile(font = '') {
                const root = document.documentElement;
                const profileName = resolveUIFontProfile(font);
                const profile = FONT_PROFILE_PRESETS[profileName] || FONT_PROFILE_PRESETS.default;
                Object.entries(profile).forEach(([token, value]) => root.style.setProperty(token, value));
                root.dataset.fontProfile = profileName;
                root.dataset.uiFontName = font ? String(font) : 'system-default';
            }

            function normalizeServiceHealthCheckCopy() {
                const title = document.querySelector('#page-services .health-check-copy .svc-cfg-title');
                const subtitle = document.querySelector('#page-services .health-check-copy .svc-cfg-subtitle');
                if (title) {
                    title.innerHTML = '<i class="ph ph-stethoscope"></i> 系统一键体检';
                }
                if (subtitle) {
                    subtitle.textContent = '汇总服务运行、网络连通、权限环境与恢复建议，让排障结果保持和其他服务卡片一致的阅读层级。';
                }
            }

            window._nekoUIHelpers = window._nekoUIHelpers || {};
            window._nekoUIHelpers.setExpandableSectionState = setExpandableSectionState;
            window._nekoUIHelpers.applyUIFontProfile = applyUIFontProfile;
            window._nekoUIHelpers.resolveUIFontProfile = resolveUIFontProfile;
            window._nekoUIHelpers.normalizeServiceHealthCheckCopy = normalizeServiceHealthCheckCopy;

            normalizeServiceHealthCheckCopy();

            let navIndicatorFrame = 0;
            function syncNavIndicatorNow(target) {
                if (!navMenu || !navIndicator) return;
                const item = target || document.querySelector('.nav-menu .nav-item.active');
                if (!item || getComputedStyle(item).display === 'none') return;
                if (item.classList.contains('console-nav') && !item.classList.contains('show')) return;
                navMenu.style.setProperty('--nav-indicator-y', `${item.offsetTop}px`);
                navMenu.style.setProperty('--nav-indicator-h', `${item.offsetHeight}px`);
                navIndicator.classList.add('is-ready');
            }
            function syncNavIndicator(target) {
                if (navIndicatorFrame) cancelAnimationFrame(navIndicatorFrame);
                navIndicatorFrame = requestAnimationFrame(() => {
                    navIndicatorFrame = 0;
                    syncNavIndicatorNow(target);
                });
            }
            function syncNavIndicatorAfterLayout(target) {
                syncNavIndicator(target);
                requestAnimationFrame(() => syncNavIndicator(target));
                setTimeout(() => syncNavIndicator(target), 280);
            }
            window._nekoSyncNavIndicator = syncNavIndicatorAfterLayout;

            syncNavIndicator();
            window.addEventListener('resize', () => syncNavIndicator());
            if (window.MutationObserver && navMenu) {
                const navMutationObserver = new MutationObserver(() => requestAnimationFrame(() => syncNavIndicator()));
                navMutationObserver.observe(navMenu, {
                    subtree: true,
                    childList: false,
                    attributes: true,
                    attributeFilter: ['class'],
                });
            }

            navItems.forEach(item => {
                item.addEventListener('click', function() {
                    const targetAreaId = this.getAttribute('data-target');
                    if (targetAreaId) {
                        if (this.classList.contains('console-nav') && !this.classList.contains('show')) return;
                        // 保存最后访问的页面（供 restoreLastState 使用）
                        const restorablePages = new Set([
                            'mainDashboardArea',
                            'consoleArea',
                            'page-device-status',
                            'page-screenshot',
                            'page-services',
                            'page-stream',
                            'page-update',
                            'page-about'
                        ]);
                        if (window.nekoIPC && restorablePages.has(targetAreaId)) {
                            window.nekoIPC.setConfig('lastPage', targetAreaId);
                        }

                        // 更新导航激活状态
                        navItems.forEach(nav => nav.classList.remove('active'));
                        this.classList.add('active');
                        syncNavIndicator(this);

                        // 切换视图显示及工具栏按钮状态
                        const areas = {
                            mainDashboardArea: document.getElementById('mainDashboardArea'),
                            consoleArea: document.getElementById('consoleArea'),
                            'page-device-status': document.getElementById('page-device-status'),
                            'page-screenshot': document.getElementById('page-screenshot'),
                            'page-stream': document.getElementById('page-stream'),
                            'page-services': document.getElementById('page-services'),
                            'page-update': document.getElementById('page-update'),
                            'page-settings': document.getElementById('page-settings'),
                            'page-about': document.getElementById('page-about')
                        };

                        // 隐藏所有区域
                        Object.values(areas).forEach(area => {
                            if (area) area.style.display = 'none';
                        });

                        // 显示目标区域
                        // mainDashboardArea 与 consoleArea 是 content-safe-area（display:flex），
                        // page-device-status 是外层 page 容器（display:block），其内部 content-safe-area 自带 flex
                        if (areas[targetAreaId]) {
                            const flexAreas = ['mainDashboardArea', 'consoleArea'];
                            areas[targetAreaId].style.display = flexAreas.includes(targetAreaId) ? 'flex' : 'block';
                        }

                        if (targetAreaId === 'consoleArea') {
                            if (topNavEditBtn) topNavEditBtn.classList.add('hidden-action');
                            if (headerTitleText) {
                                headerTitleText.innerHTML = '<i class="ph ph-terminal-window" style="color: var(--theme-color);"></i>\n                    开发者控制台 / Console';
                            }
                        } else if (targetAreaId === 'mainDashboardArea') {
                            if (topNavEditBtn) topNavEditBtn.classList.remove('hidden-action');
                            if (headerTitleText) {
                                headerTitleText.innerHTML = '<i class="ph ph-squares-four" style="color: var(--theme-color);"></i>\n                    仪表盘 / Dashboard';
                            }
                        } else if (targetAreaId === 'page-device-status') {
                            if (topNavEditBtn) topNavEditBtn.classList.add('hidden-action');
                            if (headerTitleText) {
                                headerTitleText.innerHTML = '<i class="ph ph-hard-drives" style="color: var(--theme-color);"></i>\n                    设备状态 / Device Status';
                            }
                        } else if (targetAreaId === 'page-screenshot') {
                            if (topNavEditBtn) topNavEditBtn.classList.add('hidden-action');
                            if (headerTitleText) {
                                headerTitleText.innerHTML = '<i class="ph ph-image" style="color: var(--theme-color);"></i>\n                    截图与活动 / Screenshot & Activity';
                            }
                        } else if (targetAreaId === 'page-services') {
                            if (topNavEditBtn) topNavEditBtn.classList.add('hidden-action');
                            if (headerTitleText) {
                                headerTitleText.innerHTML = '<i class="ph ph-cpu" style="color: var(--theme-color);"></i>\n                    服务与自启动 / Services';
                            }
                        } else if (targetAreaId === 'page-update') {
                            if (topNavEditBtn) topNavEditBtn.classList.add('hidden-action');
                            if (headerTitleText) {
                                headerTitleText.innerHTML = '<i class="ph ph-cloud-arrow-down" style="color: var(--theme-color);"></i>\n                    更新中心 / Update Center';
                            }
                            if (window._nekoModules?.pages?.UpdatePage && !window._updatePageInited) {
                                window._updatePageInited = true;
                                window._nekoModules.pages.UpdatePage.init();
                            }
                            window._nekoModules?.pages?.UpdatePage?.requestSourceDiagnosticsCheck?.({ reason: 'enter-update-page' });
                        } else if (targetAreaId === 'page-settings') {
                            if (topNavEditBtn) topNavEditBtn.classList.add('hidden-action');
                            if (headerTitleText) {
                                headerTitleText.innerHTML = '<i class="ph ph-gear" style="color: var(--theme-color);"></i>\n                    设置 / Settings';
                            }
                            if (window._nekoModules?.pages?.SettingsPage && !window._settingsPageInited) {
                                window._settingsPageInited = true;
                                window._nekoModules.pages.SettingsPage.init();
                            }
                        } else if (targetAreaId === 'page-stream') {
                            if (topNavEditBtn) topNavEditBtn.classList.add('hidden-action');
                            if (headerTitleText) {
                                headerTitleText.innerHTML = '<i class="ph ph-broadcast" style="color: var(--theme-color);"></i>\n                    直播推流 / Live Stream';
                            }
                            // 首次进入推流页时初始化
                            if (window._nekoModules?.pages?.StreamPage && !window._streamPageInited) {
                                window._streamPageInited = true;
                                window._nekoModules.pages.StreamPage.init();
                            }
                        } else if (targetAreaId === 'page-about') {
                            if (topNavEditBtn) topNavEditBtn.classList.add('hidden-action');
                            if (headerTitleText) {
                                headerTitleText.innerHTML = '<i class="ph ph-info" style="color: var(--theme-color);"></i>\n                    关于 / About';
                            }
                        }
                    }
                });
            });

            // 1. 读取本地存储的主题设置
            const savedMode = localStorage.getItem('neko-theme-mode') || 'light';
            const savedColor = localStorage.getItem('neko-theme-color') || '#0ea5e9';

            // 2. 初始化主题模式
            if (savedMode === 'light') {
                document.documentElement.setAttribute('data-theme', 'light');
                themeModeIcon.classList.replace('ph-moon', 'ph-sun');
            }

            // 3. 初始化主题色彩
            document.documentElement.style.setProperty('--theme-color', savedColor);
            
            // 更新个人模态框头像颜色
            const profileAvatarImg = document.getElementById('profileModalAvatar');
            if (profileAvatarImg) {
                profileAvatarImg.src = `https://ui-avatars.com/api/?name=User&background=${savedColor.replace('#', '')}&color=fff`;
            }

            window._nekoModules?.theme?.initThemeColorControls?.();

            // 4. 昼夜切换事件（dock 按钮 → 同步设置页开关 + config）
            themeModeBtn.addEventListener('click', () => {
                const isLight = document.documentElement.getAttribute('data-theme') === 'light';
                const newMode = isLight ? 'dark' : 'light';
                if (isLight) {
                    document.documentElement.removeAttribute('data-theme');
                    themeModeIcon.classList.replace('ph-sun', 'ph-moon');
                } else {
                    document.documentElement.setAttribute('data-theme', 'light');
                    themeModeIcon.classList.replace('ph-moon', 'ph-sun');
                }
                localStorage.setItem('neko-theme-mode', newMode);
                // 同步设置页深色开关
                const darkSw = document.getElementById('stgDarkSwitch');
                if (darkSw) darkSw.classList.toggle('on', newMode === 'dark');
                // 关闭定时（手动切换时取消定时模式）
                const schedSw = document.getElementById('stgDarkScheduleSwitch');
                if (schedSw && schedSw.classList.contains('on')) {
                    schedSw.classList.remove('on');
                    const tr = document.getElementById('stgDarkTimeRow');
                    setExpandableSectionState(tr, false, { display: 'flex' });
                }
                const desc = document.getElementById('stgDarkModeDesc');
                if (desc) desc.textContent = newMode === 'dark' ? '当前：深色模式' : '当前：浅色模式';
                // 持久化
                if (window.nekoIPC) window.nekoIPC.setConfig('themeMode', newMode);
            });

            // ==================================== //

            const avatar = document.getElementById('userAvatar');
            const dropdown = document.getElementById('userDropdown');

            // 点击头像显示/隐藏菜单
            avatar.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.classList.toggle('show');
            });

            // 点击页面其他任何区域 收起浮窗
            document.addEventListener('click', (e) => {
                if (!dropdown.contains(e.target) && !avatar.contains(e.target)) {
                    dropdown.classList.remove('show');
                }
                if (!colorPalette.contains(e.target) && !themeColorBtn.contains(e.target)) {
                    colorPalette.classList.remove('show');
                }
            });

            // 3. 服务器配置模态框的显示与隐藏逻辑
            const configModal = document.getElementById('configModal');
            const btnConfigKey = document.getElementById('btnConfigKey');
            const closeConfigBtn = document.getElementById('closeConfigBtn');
            const cancelConfigBtn = document.getElementById('cancelConfigBtn');
            const saveConfigBtn = document.getElementById('saveConfigBtn');

            function openModal() {
                configModal.classList.add('show');
            }
            function closeModal() {
                configModal.classList.remove('show');
            }

            btnConfigKey.addEventListener('click', openModal);
            closeConfigBtn.addEventListener('click', closeModal);
            cancelConfigBtn.addEventListener('click', closeModal);
            saveConfigBtn.addEventListener('click', () => {
                // 模拟保存逻辑
                const btn = saveConfigBtn;
                const originalHtml = btn.innerHTML;
                btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 测试中...';
                
                setTimeout(() => {
                    btn.innerHTML = '<i class="ph ph-check"></i> 同步成功';
                    btn.style.background = 'color-mix(in srgb, var(--theme-color) 20%, transparent)';
                    btn.style.borderColor = 'color-mix(in srgb, var(--theme-color) 40%, transparent)';
                    btn.style.color = 'var(--theme-color)';
                    setTimeout(() => {
                        closeModal();
                        // 恢复按钮初始状态以便下次点击
                        setTimeout(() => {
                            btn.innerHTML = originalHtml;
                            btn.style = '';
                        }, 300);
                    }, 800);
                }, 1000);
            });

            // 3.5 个人信息设置模态框逻辑
            const profileModal = document.getElementById('profileModal');
            const btnProfileSettings = document.getElementById('btnProfileSettings');
            const closeProfileBtn = document.getElementById('closeProfileBtn');
            const saveProfileBtn = document.getElementById('saveProfileBtn');

            btnProfileSettings.addEventListener('click', () => {
                dropdown.classList.remove('show'); // 点开时收起下拉单
                profileModal.classList.add('show');
            });
            closeProfileBtn.addEventListener('click', () => {
                profileModal.classList.remove('show');
            });
            saveProfileBtn.addEventListener('click', () => {
                const originalHtml = saveProfileBtn.innerHTML;
                saveProfileBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 保存中...';
                setTimeout(() => {
                    saveProfileBtn.innerHTML = '<i class="ph ph-check-circle"></i> 已保存!';
                    setTimeout(() => {
                        profileModal.classList.remove('show');
                        setTimeout(() => saveProfileBtn.innerHTML = originalHtml, 300);
                    }, 800);
                }, 600);
            });

            // 点击模态框背景关闭（记录 mousedown 目标，防止拖选文字时误关弹窗）
            let _modalMouseDownTarget = null;
            document.addEventListener('mousedown', (e) => {
                _modalMouseDownTarget = e.target;
            });
            document.addEventListener('click', (e) => {
                if (_modalMouseDownTarget === configModal && e.target === configModal) {
                    closeModal();
                }
                if (_modalMouseDownTarget === profileModal && e.target === profileModal) {
                    profileModal.classList.remove('show');
                }
                _modalMouseDownTarget = null;
            });

            // 4. 右侧快捷操作开关逻辑
            const toggleScreenshot = document.getElementById('toggleScreenshot');
            const toggleConsole = document.getElementById('toggleConsole');
            const navConsole = document.getElementById('navConsole');

            // 截图开关交互
            toggleScreenshot.addEventListener('click', () => {
                toggleScreenshot.classList.toggle('on');
            });

            // 控制台开关交互与侧边栏联动
            toggleConsole.addEventListener('click', () => {
                const isOn = toggleConsole.classList.toggle('on');
                // 如果开启控制台，在左侧导航栏显示入口，反之隐藏
                if (isOn) {
                    navConsole.classList.add('show');
                    navConsole.setAttribute('aria-hidden', 'false');
                    navConsole.removeAttribute('tabindex');
                    syncNavIndicatorAfterLayout();
                } else {
                    navConsole.classList.remove('show');
                    navConsole.setAttribute('aria-hidden', 'true');
                    navConsole.setAttribute('tabindex', '-1');
                    if (navConsole.classList.contains('active')) {
                        document.querySelector('.nav-menu .nav-item[data-target="mainDashboardArea"]')?.click();
                    } else {
                        syncNavIndicatorAfterLayout();
                    }
                }
            });

            // Dashboard page-specific interactions live in pages/dashboard.page.js.
            window._nekoModules?.pages?.DashboardPage?.init?.();

            // Screenshot page-specific interactions live in pages/screenshot.page.js.
            window._nekoModules?.pages?.ScreenshotPage?.init?.();

            const reportAutoStartSwitch = document.getElementById('reportAutoStartSwitch');
            const reportAutoDelayRow = document.getElementById('reportAutoDelayRow');
            if (reportAutoStartSwitch && reportAutoDelayRow) {
                function updateReportAutoDelayVisibility() {
                    setExpandableSectionState(reportAutoDelayRow, reportAutoStartSwitch.classList.contains('on'), { display: 'flex' });
                }
                updateReportAutoDelayVisibility();
                reportAutoStartSwitch.addEventListener('click', updateReportAutoDelayVisibility);
            }

            // ======== 自定义步进器（+/-）全局代理 ======== //
            document.addEventListener('click', (e) => {
                const btn = e.target.closest('.neko-stepper-btn');
                if (!btn) return;
                const input = document.getElementById(btn.dataset.target);
                if (!input) return;
                const dir = parseInt(btn.dataset.dir, 10) || 1;
                let val = parseInt(input.value, 10) || 0;
                const min = parseInt(input.min, 10);
                const max = parseInt(input.max, 10);
                val += dir;
                if (!isNaN(min)) val = Math.max(min, val);
                if (!isNaN(max)) val = Math.min(max, val);
                input.value = val;
            });

            // ======== 设置页：打开个人资料弹窗 ======== //
            const openProfileBtnSettings = document.getElementById('openProfileBtnSettings');
            if (openProfileBtnSettings) {
                openProfileBtnSettings.addEventListener('click', () => {
                    const profileModal = document.getElementById('profileModal');
                    if (profileModal) profileModal.classList.add('active');
                });
            }

            // ======== 设置页：服务器配置按钮 ======== //
            const stgConfigBtn = document.getElementById('stgConfigBtn');
            if (stgConfigBtn) {
                stgConfigBtn.addEventListener('click', () => openModal());
            }

            // ======== 更新中心：检查更新按钮 ======== //
            const checkUpdateBtn = document.getElementById('checkUpdateBtn');
            const updateStatusBadge = document.getElementById('updateStatusBadge');
            const checkUpdateIcon = document.getElementById('checkUpdateIcon');
            if (checkUpdateBtn) {
                checkUpdateBtn.addEventListener('click', () => {
                    checkUpdateBtn.disabled = true;
                    if (checkUpdateIcon) checkUpdateIcon.className = 'ph ph-circle-notch';
                    if (checkUpdateIcon) checkUpdateIcon.style.animation = 'spin 0.8s linear infinite';
                    setTimeout(() => {
                        checkUpdateBtn.disabled = false;
                        if (checkUpdateIcon) { checkUpdateIcon.className = 'ph ph-arrows-clockwise'; checkUpdateIcon.style.animation = ''; }
                        if (updateStatusBadge) { updateStatusBadge.className = 'update-status-badge success'; updateStatusBadge.innerHTML = '<i class="ph ph-check-circle"></i> 已是最新'; }
                    }, 1800);
                });
            }

            // ======== 更新中心：回滚按钮 UI 占位（实际逻辑由 app-ipc.js 覆盖）======== //
            // rollbackBtn 的真实处理由 app-ipc.js replaceHandler('rollbackBtn') 接管


            document.querySelectorAll('.svc-action-btn[data-confirm]').forEach(btn => {
                let confirmTimer = null;
                const originalHTML = btn.innerHTML;
                const originalClass = btn.className;

                btn.addEventListener('click', () => {
                    if (btn.classList.contains('confirming')) {
                        // 二次确认：执行操作（此处为 demo，打印日志）
                        clearTimeout(confirmTimer);
                        btn.innerHTML = '<i class="ph ph-check"></i>';
                        btn.classList.remove('confirming');
                        setTimeout(() => {
                            btn.innerHTML = originalHTML;
                            btn.className = originalClass;
                        }, 1200);
                    } else {
                        // 第一次点击：进入确认态
                        btn.classList.add('confirming');
                        btn.innerHTML = btn.dataset.confirm;
                        confirmTimer = setTimeout(() => {
                            btn.innerHTML = originalHTML;
                            btn.className = originalClass;
                        }, 3000);
                    }
                });
            });

            // ======== 服务与自启动 - 一键体检（实际逻辑由 app-ipc.js 覆盖） ======== //

            // ======== configModal 模式切换 ======== //
            const configModeSwitcher = document.getElementById('configModeSwitcher');
            const configUrlInput = document.getElementById('configUrlInput');
            const configUrlLabel = document.getElementById('configUrlLabel');
            const configApiKeyGroup = document.getElementById('configApiKeyGroup');
            const configHint = document.getElementById('configHint');

            if (configModeSwitcher) {
                configModeSwitcher.addEventListener('click', (e) => {
                    const btn = e.target.closest('.modal-mode-btn');
                    if (!btn) return;
                    configModeSwitcher.querySelectorAll('.modal-mode-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const mode = btn.dataset.mode;
                    if (mode === 'local') {
                        if (configUrlLabel) configUrlLabel.textContent = '本地服务地址 (Local URL)';
                        if (configUrlInput) { configUrlInput.value = 'http://localhost:8080'; configUrlInput.placeholder = '例如: http://localhost:8080'; }
                        if (configApiKeyGroup) configApiKeyGroup.style.opacity = '0.45';
                        if (configHint) configHint.innerHTML = '<i class="ph ph-info"></i> 本地测试模式下无需填写 API 密钥，直连本地服务即可。';
                    } else {
                        if (configUrlLabel) configUrlLabel.textContent = '服务器后端地址 (Server URL)';
                        if (configUrlInput) { configUrlInput.value = 'https://api.koirin.com/neko'; configUrlInput.placeholder = '例如: http://192.168.1.100:8080'; }
                        if (configApiKeyGroup) configApiKeyGroup.style.opacity = '1';
                        if (configHint) configHint.innerHTML = '<i class="ph ph-info"></i> 保存后服务可能需要重启以应用新的网络连接。';
                    }
                });
            }

            // ======== 设置页：系统字体列表填充（从系统枚举） ======== //
            const stgFontSelect = null;
            if (stgFontSelect) {
                function applyFont(font) {
                    if (font) {
                        document.documentElement.style.setProperty('--ui-font', `"${font}"`);
                    } else {
                        document.documentElement.style.removeProperty('--ui-font');
                    }
                    applyUIFontProfile(font);
                    localStorage.setItem('neko-ui-font', font);
                    if (window.nekoIPC) window.nekoIPC.setConfig('uiFont', font);
                }

                // 页面加载时立即应用已保存字体
                const savedFont = localStorage.getItem('neko-ui-font') || '';
                if (savedFont) document.documentElement.style.setProperty('--ui-font', `"${savedFont}"`);
                applyUIFontProfile(savedFont);

                // 异步加载系统字体列表
                (async () => {
                    stgFontSelect.innerHTML = '<option value="">系统默认</option>';
                    let fonts = [];
                    try {
                        fonts = (window.nekoIPC ? await window.nekoIPC.getSystemFonts() : []) || [];
                    } catch {}
                    // 去重排序
                    fonts = [...new Set(fonts)].sort((a, b) => a.localeCompare(b, 'zh-CN'));
                    fonts.forEach(name => {
                        const opt = document.createElement('option');
                        opt.value = name;
                        opt.textContent = name;
                        opt.style.fontFamily = name;
                        stgFontSelect.appendChild(opt);
                    });
                    stgFontSelect.value = savedFont;
                })();

                stgFontSelect.addEventListener('change', () => {
                    applyFont(stgFontSelect.value);
                });
            }
        });
