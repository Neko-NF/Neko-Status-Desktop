
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
            const colorSwatches = document.querySelectorAll('.color-swatch');

            // ======== 导航切换逻辑 ======== //
            const navItems = document.querySelectorAll('.nav-menu .nav-item');
            const navMenu = document.querySelector('.nav-menu');
            const navIndicator = document.getElementById('navActiveIndicator');
            const mainDashboardArea = document.getElementById('mainDashboardArea');
            const consoleArea = document.getElementById('consoleArea');
            const headerTitleText = document.querySelector('.page-title');
            const topNavEditBtn = document.getElementById('editLayoutBtn');

            function syncNavIndicator(target) {
                if (!navMenu || !navIndicator) return;
                const item = target || document.querySelector('.nav-menu .nav-item.active');
                if (!item || getComputedStyle(item).display === 'none') return;
                if (item.classList.contains('console-nav') && !item.classList.contains('show')) return;
                const menuRect = navMenu.getBoundingClientRect();
                const itemRect = item.getBoundingClientRect();
                navMenu.style.setProperty('--nav-indicator-y', `${itemRect.top - menuRect.top}px`);
                navMenu.style.setProperty('--nav-indicator-h', `${itemRect.height}px`);
                navIndicator.classList.add('is-ready');
            }

            requestAnimationFrame(() => syncNavIndicator());
            window.addEventListener('resize', () => syncNavIndicator());

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
                        } else if (targetAreaId === 'page-settings') {
                            if (topNavEditBtn) topNavEditBtn.classList.add('hidden-action');
                            if (headerTitleText) {
                                headerTitleText.innerHTML = '<i class="ph ph-gear" style="color: var(--theme-color);"></i>\n                    设置 / Settings';
                            }
                        } else if (targetAreaId === 'page-stream') {
                            if (topNavEditBtn) topNavEditBtn.classList.add('hidden-action');
                            if (headerTitleText) {
                                headerTitleText.innerHTML = '<i class="ph ph-broadcast" style="color: var(--theme-color);"></i>\n                    直播推流 / Live Stream';
                            }
                            // 首次进入推流页时初始化
                            if (typeof initStreamPage === 'function' && !window._streamPageInited) {
                                window._streamPageInited = true;
                                initStreamPage();
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
            const savedColor = localStorage.getItem('neko-theme-color') || '#06b6d4';

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

            colorSwatches.forEach(swatch => {
                const color = swatch.getAttribute('data-color');
                swatch.style.color = color; // For shadow
                if (color === savedColor) swatch.classList.add('active');
                else swatch.classList.remove('active');
            });

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
                    if (tr) tr.style.display = 'none';
                }
                const desc = document.getElementById('stgDarkModeDesc');
                if (desc) desc.textContent = newMode === 'dark' ? '当前：深色模式' : '当前：浅色模式';
                // 持久化
                if (window.nekoIPC) window.nekoIPC.setConfig('themeMode', newMode);
            });

            // 5. 颜色面板展开/收起事件
            themeColorBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                colorPalette.classList.toggle('show');
            });

            // 6. 更换颜色事件（dock 色板 → 同步设置页色板 + config）
            colorSwatches.forEach(swatch => {
                swatch.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const newColor = swatch.getAttribute('data-color');
                    document.documentElement.style.setProperty('--theme-color', newColor);
                    localStorage.setItem('neko-theme-color', newColor);
                    
                    if (profileAvatarImg) {
                        profileAvatarImg.src = `https://ui-avatars.com/api/?name=User&background=${newColor.replace('#', '')}&color=fff`;
                    }

                    // 同步 dock 色板
                    colorSwatches.forEach(s => s.classList.remove('active'));
                    swatch.classList.add('active');
                    colorPalette.classList.remove('show');

                    // 同步设置页色板
                    document.querySelectorAll('.settings-swatch').forEach(s => {
                        s.classList.toggle('active', s.dataset.color === newColor);
                    });
                    const cb = document.getElementById('stgCustomColorBtn');
                    if (cb) { cb.classList.remove('active'); }

                    // 持久化到 config
                    if (window.nekoIPC) window.nekoIPC.setConfig('seedColor', newColor);
                    // 通知 app-ipc.js 重绘图表以跟随新主题色
                    document.dispatchEvent(new CustomEvent('neko:themeChange'));
                });
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
                } else {
                    navConsole.classList.remove('show');
                    navConsole.setAttribute('aria-hidden', 'true');
                    navConsole.setAttribute('tabindex', '-1');
                    if (navConsole.classList.contains('active')) {
                        document.querySelector('.nav-menu .nav-item[data-target="mainDashboardArea"]')?.click();
                    } else {
                        syncNavIndicator();
                    }
                }
            });

            // 5. 上报按钮控制（停止 -> 尝试上报 -> 开始）
            const reportToggleBtn = document.getElementById('reportToggleBtn');
            const deviceStatusDot = document.getElementById('deviceStatusDot');
            let isReporting = true; // 初始状态为运行中

            reportToggleBtn.addEventListener('click', () => {
                // 如果正处于“尝试”等中间状态，忽略点击（防抖）
                if (reportToggleBtn.classList.contains('btn-pending')) return;

                if (isReporting) {
                    // 当前为上报，点击则切换到“停止”
                    // 为了演示，过渡用 pending 状态
                    reportToggleBtn.className = 'status-toggle-btn btn-pending';
                    reportToggleBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 停止中...';
                    
                    setTimeout(() => {
                        isReporting = false;
                        reportToggleBtn.className = 'status-toggle-btn btn-start';
                        reportToggleBtn.innerHTML = '<i class="ph ph-play-circle"></i> 开始上报';
                        // 切断上报，指示灯变红
                        if(deviceStatusDot) deviceStatusDot.classList.add('error');
                    }, 800);
                } else {
                    // 当前为停止，点击则切换到“开始”
                    reportToggleBtn.className = 'status-toggle-btn btn-pending';
                    reportToggleBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 连接中...';
                    
                    setTimeout(() => {
                        isReporting = true;
                        reportToggleBtn.className = 'status-toggle-btn btn-stop';
                        reportToggleBtn.innerHTML = '<i class="ph ph-stop-circle"></i> 停止上报';
                        // 恢复上报，指示灯切回主题色
                        if(deviceStatusDot) deviceStatusDot.classList.remove('error');
                    }, 1200);
                }
            });

            // 6. 仪表盘小组件编辑模式 (分区拖拽与调整)
            const editLayoutBtn = document.getElementById('editLayoutBtn');
            const saveEditBtn = document.getElementById('saveEditBtn');
            const cancelEditBtn = document.getElementById('cancelEditBtn');
            const editActionBar = document.getElementById('editActionBar');
            
            const mainArea = document.getElementById('mainDashboardArea');
            const allSections = Array.from(document.querySelectorAll('.dashboard-section'));
            const allCards = Array.from(document.querySelectorAll('.dashboard-section > .glass-card'));
            
            let isEditMode = false;
            let preEditStateHTML = ''; // 用于取消保存时的回滚
            let preEditSnapshot = []; // 取消编辑时恢复卡片布局快照

            // 绑定基础编辑态控件与拖拽/缩放拉手
            allCards.forEach(card => {
                card.classList.add('editable-widget');
                
                // 特定可替换卡片
                const isReplaceable = card.id === 'replaceableCard';
                let btnReplace = null;
                
                const controls = document.createElement('div');
                controls.className = 'widget-controls';
                
                if (isReplaceable) {
                    btnReplace = document.createElement('div');
                    btnReplace.className = 'ctrl-btn danger';
                    btnReplace.innerHTML = '<i class="ph ph-arrows-left-right"></i>';
                    btnReplace.title = '切换卡片功能';
                    controls.appendChild(btnReplace);
                }
                card.appendChild(controls);

                // 拖拽拉伸拉手：右下角同时缩放、右侧横向缩放、底部纵向缩放
                const resizeHandle = document.createElement('div');
                resizeHandle.className = 'resize-handle resize-handle-corner';
                card.appendChild(resizeHandle);

                const resizeHandleRight = document.createElement('div');
                resizeHandleRight.className = 'resize-handle resize-handle-right';
                card.appendChild(resizeHandleRight);

                const resizeHandleBottom = document.createElement('div');
                resizeHandleBottom.className = 'resize-handle resize-handle-bottom';
                card.appendChild(resizeHandleBottom);

                // ============= 拖拽调整大小 (Snap to Grid) — 通用 =============
                function _initResize(e, mode) {
                    if (!isEditMode) return;
                    e.preventDefault();
                    e.stopPropagation();

                    card.setAttribute('draggable', 'false');
                    card.classList.add('resizing');
                    const activeHandle = e.currentTarget;
                    activeHandle.classList.add('active');

                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startDataW = parseInt(card.getAttribute('data-w') || 1);
                    const startDataH = parseInt(card.getAttribute('data-h') || 1);
                    const parentSection = card.closest('.dashboard-section');
                    if (!parentSection) return;

                    const sectionStyle = getComputedStyle(parentSection);
                    const gap = parseFloat(sectionStyle.columnGap || sectionStyle.gap || '16') || 16;
                    const rowGap = parseFloat(sectionStyle.rowGap || sectionStyle.gap || '16') || 16;
                    const rowHeight = parseFloat(sectionStyle.gridAutoRows || '40') || 40;
                    const colWidth = (parentSection.clientWidth - gap * 11) / 12;
                    const colStep = colWidth + gap;
                    const rowStep = rowHeight + rowGap;
                    let lastW = startDataW;
                    let lastH = startDataH;

                    const onMove = (moveE) => {
                        const addW = mode === 'bottom' ? 0 : Math.round((moveE.clientX - startX) / colStep);
                        const addH = mode === 'right' ? 0 : Math.round((moveE.clientY - startY) / rowStep);
                        const newW = Math.max(2, Math.min(12, startDataW + addW));
                        const newH = Math.max(2, startDataH + addH);
                        if (newW === lastW && newH === lastH) return;
                        lastW = newW;
                        lastH = newH;

                        card.style.gridColumn = `span ${newW}`;
                        card.style.gridRow = `span ${newH}`;
                        card.setAttribute('data-w', newW);
                        card.setAttribute('data-h', newH);
                    };

                    const onUp = () => {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);

                        if (isEditMode) {
                            card.setAttribute('draggable', 'true');
                        }
                        card.classList.remove('resizing');
                        activeHandle.classList.remove('active');
                    };

                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                }

                resizeHandle.addEventListener('mousedown', (e) => _initResize(e, 'corner'));
                resizeHandleRight.addEventListener('mousedown', (e) => _initResize(e, 'right'));
                resizeHandleBottom.addEventListener('mousedown', (e) => _initResize(e, 'bottom'));

                // ============= 内容替换逻辑 (可双向切换) =============
                if (btnReplace) {
                    btnReplace.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // 过渡动画
                        card.style.opacity = '0';
                        card.style.transform = 'scale(0.95)';
                        
                        setTimeout(() => {
                            const isSwapped = card.dataset.viewState === 'swapped';
                            setCardViewState(card, !isSwapped);
                            card.style.opacity = '1';
                            card.style.transform = 'scale(1)';
                        }, 300);
                    });
                }
            });

            // ============= HTML5 拖拽重排 (Drag and Drop / FLIP) =============
            let draggedCard = null;
            let currentGridRects = new Map();

            // 监听开始与移动
            allCards.forEach(card => {
                card.addEventListener('dragstart', (e) => {
                    if (!isEditMode) return e.preventDefault();
                    draggedCard = card;
                    e.dataTransfer.effectAllowed = 'move';
                    setTimeout(() => card.classList.add('dragging'), 0);
                    
                    // 记录拖拽前同 section 内的所有人的位置
                    const parentSection = card.closest('.dashboard-section');
                    Array.from(parentSection.children).forEach(c => {
                        if(c.classList.contains('glass-card')) {
                            currentGridRects.set(c, c.getBoundingClientRect());
                        }
                    });
                });

                card.addEventListener('dragend', () => {
                    if (draggedCard) draggedCard.classList.remove('dragging');
                    draggedCard = null;
                    currentGridRects.clear();
                });
            });

            allSections.forEach(section => {
                section.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    if (!draggedCard) return;
                    
                    // 只能在自己所在的 section 内拖拽
                    if (draggedCard.closest('.dashboard-section') !== section) return;

                    const targetCard = e.target.closest('.glass-card');
                    if (targetCard && targetCard !== draggedCard && targetCard.closest('.dashboard-section') === section) {
                        const cards = Array.from(section.children).filter(c => c.classList.contains('glass-card'));
                        const draggedIdx = cards.indexOf(draggedCard);
                        const targetIdx = cards.indexOf(targetCard);
                        
                        // DOM 位置交换
                        if (draggedIdx < targetIdx) {
                            targetCard.after(draggedCard);
                        } else {
                            targetCard.before(draggedCard);
                        }

                        // FLIP 动画实现无缝重排
                        const newCards = Array.from(section.children).filter(c => c.classList.contains('glass-card'));
                        newCards.forEach(c => {
                            const oldRect = currentGridRects.get(c);
                            const newRect = c.getBoundingClientRect();
                            if (!oldRect) return;

                            const dx = oldRect.left - newRect.left;
                            const dy = oldRect.top - newRect.top;
                            
                            if (dx !== 0 || dy !== 0) {
                                // 瞬移回去
                                c.style.transition = 'none';
                                c.style.transform = `translate(${dx}px, ${dy}px)`;
                                c.offsetHeight; // 强制 reflow
                                // 平滑过渡到当前新位置
                                c.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)';
                                c.style.transform = '';
                                /* 取消拖拽和碰撞计算后残留的过度动画，防止后续排版时卡片胡乱挤压 */
                                setTimeout(() => { c.style.transition = ''; }, 450);
                            }
                            // 更新最新位置预备下一次跨越
                            currentGridRects.set(c, newRect);
                        });
                    }
                });
            });

            // ============= 模式开关设置 =============
            function toggleEditMode(enable) {
                isEditMode = enable;
                if (isEditMode) {
                    // 保存编辑前的 HTML 结构状态以便取消
                    preEditStateHTML = mainArea.innerHTML;
                    // 快照：保存每张卡片的宽高和所属 section、顺序
                    preEditSnapshot = [];
                    document.querySelectorAll('.dashboard-section').forEach(sec => {
                        const secName = sec.getAttribute('data-section');
                        Array.from(sec.children).forEach((c, idx) => {
                            if (c.classList.contains('glass-card') && c.id) {
                                preEditSnapshot.push({
                                    id: c.id,
                                    w: c.getAttribute('data-w'),
                                    h: c.getAttribute('data-h'),
                                    section: secName,
                                    order: idx,
                                    swapped: c.dataset.viewState === 'swapped',
                                });
                            }
                        });
                    });
                    
                    document.body.classList.add('edit-mode');
                    editActionBar.classList.add('show');
                    // 开启全域拖拽
                    document.querySelectorAll('.dashboard-section > .glass-card').forEach(c => c.setAttribute('draggable', 'true'));
                } else {
                    document.body.classList.remove('edit-mode');
                    editActionBar.classList.remove('show');
                    // 关闭拖拽
                    document.querySelectorAll('.dashboard-section > .glass-card').forEach(c => c.setAttribute('draggable', 'false'));
                }
            }

            const restoreDefaultBtn = document.getElementById('restoreDefaultBtn');
            const STORAGE_KEY = 'neko_layout_config';

            function setCardViewState(card, swapped) {
                if (!card) return;
                const viewDefault = card.querySelector('.view-default');
                const viewSwapped = card.querySelector('.view-swapped');
                if (!viewDefault || !viewSwapped) return;
                card.dataset.viewState = swapped ? 'swapped' : 'default';
                viewDefault.style.display = swapped ? 'none' : 'flex';
                viewSwapped.style.display = swapped ? 'flex' : 'none';
            }

            // ============= 加载持久化布局 =============
            function loadLayoutConfig(layoutData) {
                // 优先使用传入的 layoutData（来自 configStore），否则回退 localStorage
                let layout = layoutData;
                if (!layout) {
                    const savedConfig = localStorage.getItem(STORAGE_KEY);
                    if (savedConfig) {
                        try { layout = JSON.parse(savedConfig); } catch (e) { console.error('加载布局失败', e); }
                    }
                }
                if (!layout || !Array.isArray(layout)) return;
                try {
                    layout.forEach(item => {
                        const card = document.getElementById(item.id);
                        const targetSection = document.querySelector(`.dashboard-section[data-section="${item.section}"]`);
                        if (card && targetSection) {
                            card.setAttribute('data-w', item.w);
                            card.setAttribute('data-h', item.h);
                            card.style.gridColumn = `span ${item.w}`;
                            card.style.gridRow = `span ${item.h}`;
                            setCardViewState(card, !!item.swapped);
                            targetSection.appendChild(card);
                        }
                    });
                    // 同步回 localStorage 作为快速缓存
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
                } catch (e) { console.error('加载布局失败', e); }
            }
            // 自动加载上次保存的配置
            loadLayoutConfig();

            editLayoutBtn.addEventListener('click', () => {
                toggleEditMode(true);
            });

            cancelEditBtn.addEventListener('click', () => {
                // 从快照恢复卡片布局（无需重新加载页面，避免图表重建卡顿）
                if (preEditSnapshot.length) {
                    // 按 section 分组恢复
                    const bySection = {};
                    preEditSnapshot.forEach(snap => {
                        if (!bySection[snap.section]) bySection[snap.section] = [];
                        bySection[snap.section].push(snap);
                    });
                    for (const [secName, items] of Object.entries(bySection)) {
                        const sec = document.querySelector(`.dashboard-section[data-section="${secName}"]`);
                        if (!sec) continue;
                        // 按原始顺序排列
                        items.sort((a, b) => a.order - b.order);
                        items.forEach(snap => {
                            const c = document.getElementById(snap.id);
                            if (!c) return;
                            c.setAttribute('data-w', snap.w);
                            c.setAttribute('data-h', snap.h);
                            c.style.gridColumn = `span ${snap.w}`;
                            c.style.gridRow = `span ${snap.h}`;
                            setCardViewState(c, !!snap.swapped);
                            sec.appendChild(c); // 按顺序重新追加以恢复 DOM 顺序
                        });
                    }
                }
                toggleEditMode(false);
            });

            restoreDefaultBtn.addEventListener('click', () => {
                if (confirm('确定要放弃所有的布局修改并恢复出厂默认布局吗？')) {
                    localStorage.removeItem(STORAGE_KEY);
                    if (window.nekoIPC) window.nekoIPC.setConfig('dashboardLayout', null);
                    window.location.reload();
                }
            });

            saveEditBtn.addEventListener('click', () => {
                // 保存：将现在的每一个卡片的位置和长高存储到 localStorage
                const layout = [];
                document.querySelectorAll('.dashboard-section').forEach(sec => {
                    const secName = sec.getAttribute('data-section');
                    Array.from(sec.children).forEach(c => {
                        if (c.classList.contains('glass-card') && c.id) {
                            layout.push({
                                id: c.id,
                                w: c.getAttribute('data-w'),
                                h: c.getAttribute('data-h'),
                                section: secName,
                                swapped: c.dataset.viewState === 'swapped'
                            });
                        }
                    });
                });
                
                const btn = saveEditBtn;
                const originalHtml = btn.innerHTML;
                btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 保存中...';
                
                setTimeout(() => {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
                    // 同时持久化到 configStore（跨会话可靠存储）
                    if (window.nekoIPC) window.nekoIPC.setConfig('dashboardLayout', layout);
                    btn.innerHTML = '<i class="ph ph-check"></i> 保存成功';
                    setTimeout(() => {
                        toggleEditMode(false);
                        btn.innerHTML = originalHtml;
                    }, 500);
                }, 600);
            });

            // ======== 设备状态 - 历史诊断日志筛选器 ======== //
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
            // 只做 UI class 切换，具体配置持久化逻辑统一在 app-ipc.js 中
            [
                'uploadSwitch', 'autoStartSwitch', 'autoStartMinimizeSwitch', 'reportAutoStartSwitch', 'autoRestartSwitch',
                'stgAutoStartSwitch', 'stgTraySwitch', 'stgRestoreSwitch',
                'stgDarkSwitch', 'stgDarkScheduleSwitch',
                'stgGlassSwitch', 'stgAutoUploadSwitch', 'stgNotifySwitch', 'stgDndSwitch',
                'stgIncognitoSwitch', 'stg2FASwitch', 'stgAutoDownloadSwitch',
                'blurAllSwitch', 'stgSyncScreenshotSwitch'
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

            function savePrivacyRules() {
                privacyRules = privacyRules.map(normalizePrivacyRule).filter(Boolean);
                localStorage.setItem('neko_privacy_rules', JSON.stringify(privacyRules));
                if (window.nekoIPC) window.nekoIPC.setConfig('privacyRules', privacyRules);
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
                    const windows = await window.nekoIPC?.listWindows?.();
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
                        const selected = await window.nekoIPC?.pickPrivacyWindow?.();
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
                        const filePath = await window.nekoIPC?.selectFile?.({
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
            // 暴露给 app-ipc 使用的辅助函数
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
            const reportAutoStartSwitch = document.getElementById('reportAutoStartSwitch');
            const reportAutoDelayRow = document.getElementById('reportAutoDelayRow');
            if (reportAutoStartSwitch && reportAutoDelayRow) {
                function updateReportAutoDelayVisibility() {
                    reportAutoDelayRow.style.display = reportAutoStartSwitch.classList.contains('on') ? '' : 'none';
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

            // ======== 设置页：色板联动主题色 ======== //
            function applyThemeColor(color) {
                document.documentElement.style.setProperty('--theme-color', color);
                localStorage.setItem('neko-theme-color', color);
                // 同步两处色板的 active 状态
                document.querySelectorAll('.settings-swatch, .color-swatch').forEach(s => {
                    s.classList.toggle('active', s.dataset.color === color);
                });
                // 自定义按钮
                const cb = document.getElementById('stgCustomColorBtn');
                if (cb) {
                    const isCustom = !document.querySelector('.settings-swatch.active');
                    cb.classList.toggle('active', isCustom);
                    if (isCustom) cb.style.setProperty('--custom-swatch-color', color);
                }
                // 持久化到 config-store
                if (window.nekoIPC) window.nekoIPC.setConfig('seedColor', color);
                // 通知 app-ipc.js 重绘图表以跟随新主题色
                document.dispatchEvent(new CustomEvent('neko:themeChange'));
            }

            document.querySelectorAll('#stgColorSwatches .settings-swatch').forEach(swatch => {
                swatch.addEventListener('click', () => {
                    applyThemeColor(swatch.dataset.color);
                    const customRow = document.getElementById('stgCustomColorRow');
                    if (customRow) customRow.style.display = 'none';
                });
            });

            // 自定义颜色按钮
            const customColorBtn = document.getElementById('stgCustomColorBtn');
            const customColorInput = document.getElementById('stgCustomColorInput');
            const customColorRow = document.getElementById('stgCustomColorRow');
            const customColorPreview = document.getElementById('stgCustomColorPreview');
            const customColorHex = document.getElementById('stgCustomColorHex');

            if (customColorBtn && customColorInput) {
                customColorBtn.addEventListener('click', () => {
                    if (customColorRow) customColorRow.style.display = customColorRow.style.display === 'none' ? '' : 'none';
                    const cur = localStorage.getItem('neko-theme-color') || '#06b6d4';
                    customColorInput.value = cur;
                    if (customColorHex) customColorHex.value = cur;
                    if (customColorPreview) customColorPreview.style.background = cur;
                });
                customColorInput.addEventListener('input', () => {
                    const c = customColorInput.value;
                    if (customColorPreview) customColorPreview.style.background = c;
                    if (customColorHex) customColorHex.value = c;
                });
                // 点击预览色块打开系统取色器
                if (customColorPreview) {
                    customColorPreview.style.cursor = 'pointer';
                    customColorPreview.addEventListener('click', () => customColorInput.click());
                }
                if (customColorHex) {
                    customColorHex.addEventListener('input', () => {
                        const v = customColorHex.value;
                        if (/^#[0-9a-f]{6}$/i.test(v)) {
                            customColorInput.value = v;
                            if (customColorPreview) customColorPreview.style.background = v;
                        }
                    });
                }
                document.getElementById('stgCustomColorApply')?.addEventListener('click', () => {
                    const c = customColorInput.value;
                    applyThemeColor(c);
                    // 额外持久化自定义色（切换预设色时不会丢失）
                    if (window.nekoIPC) window.nekoIPC.setConfig('customSeedColor', c);
                    if (customColorRow) customColorRow.style.display = 'none';
                });
            }

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

            // ======== 直播推流页 初始化逻辑 ======== //
            // showNekoIsland 由 app-ipc.js 暴露到 window，此处统一代理调用
            function showNekoIsland(text, type = 'info') {
                if (typeof window.showNekoIsland === 'function') window.showNekoIsland(text, type);
            }

            function initStreamPage() {
                // 1. 读取 SRS 配置，判断显示引导卡片还是主控区
                if (!window.nekoIPC || !window.nekoIPC.getStreamConfig) return;
                window.nekoIPC.getStreamConfig().then((config) => {
                    const hasSrsConfig = config && config.srsHost && config.srsHost.trim() !== '';
                    const guideCard = document.getElementById('streamGuideCard');
                    const mainArea  = document.getElementById('streamMainArea');
                    if (guideCard) guideCard.style.display = hasSrsConfig ? 'none' : '';
                    if (mainArea)  mainArea.style.display  = hasSrsConfig ? '' : 'none';
                    if (hasSrsConfig) {
                        renderStreamUrl(config);
                        startStreamStatusPolling();
                    }
                    // 回写设置页输入框
                    if (config) {
                        const h = document.getElementById('srsHost'); if (h) h.value = config.srsHost || '';
                        const p = document.getElementById('srsRtmpPort'); if (p) p.value = config.srsRtmpPort || 51935;
                        const a = document.getElementById('srsApp'); if (a) a.value = config.srsApp || 'live';
                        const ap = document.getElementById('srsApiPort'); if (ap) ap.value = config.srsApiPort || 51985;
                    }
                });

                // 2. 前往配置按钮
                const goBtn = document.getElementById('goToStreamSettings');
                if (goBtn) {
                    goBtn.addEventListener('click', () => {
                        const settingsNav = document.querySelector('[data-target="page-settings"]');
                        if (settingsNav) settingsNav.click();
                        setTimeout(() => {
                            const el = document.getElementById('settings-stream');
                            if (el) el.scrollIntoView({ behavior: 'smooth' });
                        }, 150);
                    });
                }

                // 3. 复制 RTMP URL
                const copyBtn = document.getElementById('copyRtmpUrlBtn');
                if (copyBtn) {
                    copyBtn.addEventListener('click', () => {
                        const url = (document.getElementById('streamRtmpUrl') || {}).textContent || '';
                        navigator.clipboard.writeText(url.trim()).then(() => {
                            showNekoIsland('✅ 已复制推流地址');
                        });
                    });
                }

                // 4. 重置 Stream Key
                const resetBtn = document.getElementById('resetStreamKeyBtn');
                if (resetBtn) {
                    resetBtn.addEventListener('click', () => {
                        if (!confirm('重置后旧 Stream Key 立即失效，OBS 需重新配置。确认重置？')) return;
                        window.nekoIPC.resetStreamKey().then((res) => {
                            const newKey = typeof res === 'string' ? res : (res && res.stream_key);
                            if (newKey) {
                                const keyEl = document.getElementById('streamKeyDisplay');
                                if (keyEl) keyEl.textContent = newKey;
                                window.nekoIPC.getStreamConfig().then(cfg => renderStreamUrl({ ...cfg, streamKey: newKey }));
                                showNekoIsland('✅ Stream Key 已重置');
                            }
                        });
                    });
                }

                // 5. 测试 OBS WebSocket
                const testObsBtn = document.getElementById('testObsWsBtn');
                if (testObsBtn) testObsBtn.addEventListener('click', testObsWebSocket);

                // 6. 一键配置 OBS
                const applyBtn = document.getElementById('applyToObsBtn');
                if (applyBtn) applyBtn.addEventListener('click', applyStreamConfigToObs);

                // 7. 导出 OBS 配置文件
                const exportBtn = document.getElementById('exportObsConfigBtn');
                if (exportBtn) {
                    exportBtn.addEventListener('click', () => {
                        window.nekoIPC.exportObsServiceConfig().then((savedPath) => {
                            showNekoIsland('✅ 已导出: ' + savedPath);
                        }).catch(e => showNekoIsland('❌ 导出失败: ' + e.message));
                    });
                }

                // 8. 帮助折叠展开
                const helpToggle = document.getElementById('streamHelpToggle');
                if (helpToggle) {
                    helpToggle.addEventListener('click', () => {
                        const content = document.getElementById('streamHelpContent');
                        const caret   = document.getElementById('streamHelpCaret');
                        if (!content) return;
                        const isOpen = content.style.display !== 'none';
                        content.style.display = isOpen ? 'none' : '';
                        if (caret) caret.classList.toggle('open', !isOpen);
                    });
                }

                // 9. 设置页保存按钮
                const saveSrsBtn = document.getElementById('saveSrsSettingsBtn');
                if (saveSrsBtn) {
                    saveSrsBtn.addEventListener('click', () => {
                        const cfg = collectSrsSettings();
                        window.nekoIPC.saveStreamConfig(cfg).then(() => {
                            showNekoIsland('✅ SRS 配置已保存');
                            // 保存后刷新推流页显示状态
                            window.nekoIPC.getStreamConfig().then((config) => {
                                const hasSrsConfig = config && config.srsHost && config.srsHost.trim() !== '';
                                const guideCard = document.getElementById('streamGuideCard');
                                const mainArea  = document.getElementById('streamMainArea');
                                if (guideCard) guideCard.style.display = hasSrsConfig ? 'none' : '';
                                if (mainArea)  mainArea.style.display  = hasSrsConfig ? '' : 'none';
                                if (hasSrsConfig) { renderStreamUrl(config); startStreamStatusPolling(); }
                            });
                        });
                    });
                }

                // 10. 设置页测试按钮
                const testSrsBtn = document.getElementById('testSrsConnectionBtn');
                if (testSrsBtn) {
                    testSrsBtn.addEventListener('click', () => {
                        const cfg = collectSrsSettings();
                        const resultEl = document.getElementById('srsTestResult');
                        if (resultEl) { resultEl.textContent = '测试中...'; resultEl.className = 'test-result-label'; }
                        window.nekoIPC.testSrsConnection(cfg).then((res) => {
                            if (resultEl) {
                                if (res && res.ok) {
                                    resultEl.textContent = '✅ 连通成功' + (res.srsVersion ? ' (SRS ' + res.srsVersion + ')' : '');
                                    resultEl.className = 'test-result-label success';
                                } else {
                                    resultEl.textContent = '❌ ' + (res && res.reason ? res.reason : '连接失败');
                                    resultEl.className = 'test-result-label error';
                                }
                            }
                        }).catch(e => {
                            if (resultEl) { resultEl.textContent = '❌ ' + e.message; resultEl.className = 'test-result-label error'; }
                        });
                    });
                }
            }

            function renderStreamUrl(config) {
                const key  = config.streamKey || '';
                const host = config.srsHost || 'your-server';
                const port = config.srsRtmpPort || 51935;
                const app  = config.srsApp || 'live';
                const url  = 'rtmp://' + host + ':' + port + '/' + app + '/' + key;
                const urlEl = document.getElementById('streamRtmpUrl');
                const keyEl = document.getElementById('streamKeyDisplay');
                if (urlEl) urlEl.textContent = url;
                if (keyEl) keyEl.textContent = key;
            }

            let streamPollTimer = null;
            function startStreamStatusPolling() {
                if (streamPollTimer) clearInterval(streamPollTimer);
                streamPollTimer = setInterval(() => {
                    if (!window.nekoIPC || !window.nekoIPC.getStreamLiveStatus) return;
                    window.nekoIPC.getStreamLiveStatus().then((status) => {
                        updateStreamStatusBanner(status);
                    });
                }, 10000);
                // 立即刷新一次
                if (window.nekoIPC && window.nekoIPC.getStreamLiveStatus) {
                    window.nekoIPC.getStreamLiveStatus().then(updateStreamStatusBanner);
                }
            }

            function updateStreamStatusBanner(status) {
                const banner = document.getElementById('streamStatusBanner');
                const label  = document.getElementById('streamStatusLabel');
                const labels = { live: '直播中', idle: '未推流', error: '连接失败' };
                if (banner) banner.dataset.status = status;
                if (label)  label.textContent = labels[status] || '未知';
            }

            async function testObsWebSocket() {
                const host = (document.getElementById('obsWsHost') || {}).value || '127.0.0.1';
                const port = (document.getElementById('obsWsPort') || {}).value || '4455';
                const pass = (document.getElementById('obsWsPassword') || {}).value || '';
                const dot  = document.getElementById('obsWsDot');
                const lbl  = document.getElementById('obsWsLabel');
                const applyBtn = document.getElementById('applyToObsBtn');
                if (lbl) lbl.textContent = '连接中...';
                try {
                    const res = await window.nekoIPC.testObsWebSocket({ host, port: Number(port), password: pass });
                    if (res && res.connected) {
                        if (dot) dot.setAttribute('data-connected', 'true');
                        if (lbl) lbl.textContent = 'OBS 已连接' + (res.obsVersion ? ' (v' + res.obsVersion + ')' : '');
                        if (applyBtn) applyBtn.disabled = false;
                        showNekoIsland('✅ OBS WebSocket 连接成功');
                    } else {
                        if (dot) dot.setAttribute('data-connected', 'false');
                        if (lbl) lbl.textContent = 'OBS WebSocket 未连接';
                        if (applyBtn) applyBtn.disabled = true;
                        showNekoIsland('❌ ' + (res && res.reason ? res.reason : 'OBS 连接失败'));
                    }
                } catch (e) {
                    if (dot) dot.setAttribute('data-connected', 'false');
                    if (lbl) lbl.textContent = 'OBS WebSocket 未连接';
                    showNekoIsland('❌ OBS 连接异常: ' + e.message);
                }
            }

            async function applyStreamConfigToObs() {
                const host = (document.getElementById('obsWsHost') || {}).value || '127.0.0.1';
                const port = (document.getElementById('obsWsPort') || {}).value || '4455';
                const pass = (document.getElementById('obsWsPassword') || {}).value || '';
                try {
                    const res = await window.nekoIPC.applyStreamConfigToObs({ host, port: Number(port), password: pass });
                    if (res && res.ok) {
                        showNekoIsland('✅ OBS 推流配置已应用，可在 OBS 中开始推流');
                    } else {
                        showNekoIsland('❌ 配置失败: ' + (res && res.error ? res.error : '未知错误'));
                    }
                } catch (e) {
                    showNekoIsland('❌ 配置异常: ' + e.message);
                }
            }

            function collectSrsSettings() {
                return {
                    srsHost:     (document.getElementById('srsHost') || {}).value || '',
                    srsRtmpPort: Number((document.getElementById('srsRtmpPort') || {}).value) || 51935,
                    srsApp:      (document.getElementById('srsApp') || {}).value || 'live',
                    srsApiPort:  Number((document.getElementById('srsApiPort') || {}).value) || 51985,
                };
            }

            // ======== 服务与自启动 - 危险操作二次确认 ======== //
            // 带 data-confirm 属性的按钮点击后进入「确认态」，3s 内再次点击才执行
            if (typeof initStreamPage === 'function' && !window._streamPageInited) {
                window._streamPageInited = true;
                initStreamPage();
            }

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

            // ======== 更新源保存 ======== //
            const saveUpdateSourceBtn = document.getElementById('saveUpdateSourceBtn');
            const updateSourceInput = document.getElementById('updateSourceInput');
            const updateSourceCurrentWrap = document.getElementById('updateSourceCurrent');

            if (saveUpdateSourceBtn && updateSourceInput) {
                saveUpdateSourceBtn.addEventListener('click', () => {
                    const url = updateSourceInput.value.trim();
                    if (!url) return;
                    const btn = saveUpdateSourceBtn;
                    const originalHtml = btn.innerHTML;
                    btn.innerHTML = '<i class="ph ph-circle-notch" style="animation:spin 0.8s linear infinite"></i> 验证中...';
                    btn.disabled = true;
                    setTimeout(() => {
                        const currentUrlSpan = updateSourceCurrentWrap?.querySelector('.update-source-current-url');
                        if (currentUrlSpan) {
                            try {
                                const u = new URL(url);
                                currentUrlSpan.textContent = u.hostname + u.pathname.replace(/\/+$/, '').substring(0, 30);
                            } catch { currentUrlSpan.textContent = url.substring(0, 40); }
                        }
                        btn.innerHTML = '<i class="ph ph-check-circle"></i> 已保存';
                        setTimeout(() => {
                            btn.innerHTML = originalHtml;
                            btn.disabled = false;
                            updateSourceInput.value = '';
                        }, 1500);
                    }, 800);
                });
            }

            // ======== 设置页：系统字体列表填充（从系统枚举） ======== //
            const stgFontSelect = document.getElementById('stgFontSelect');
            if (stgFontSelect) {
                function applyFont(font) {
                    if (font) {
                        document.documentElement.style.setProperty('--ui-font', `"${font}"`);
                    } else {
                        document.documentElement.style.removeProperty('--ui-font');
                    }
                    localStorage.setItem('neko-ui-font', font);
                    if (window.nekoIPC) window.nekoIPC.setConfig('uiFont', font);
                }

                // 页面加载时立即应用已保存字体
                const savedFont = localStorage.getItem('neko-ui-font') || '';
                if (savedFont) document.documentElement.style.setProperty('--ui-font', `"${savedFont}"`);

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
