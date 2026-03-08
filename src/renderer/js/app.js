
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
            const mainDashboardArea = document.getElementById('mainDashboardArea');
            const consoleArea = document.getElementById('consoleArea');
            const headerTitleText = document.querySelector('.page-title');
            const topNavEditBtn = document.getElementById('editLayoutBtn');

            navItems.forEach(item => {
                item.addEventListener('click', function() {
                    const targetAreaId = this.getAttribute('data-target');
                    if (targetAreaId) {
                        // 更新导航激活状态
                        navItems.forEach(nav => nav.classList.remove('active'));
                        this.classList.add('active');

                        // 切换视图显示及工具栏按钮状态
                        const areas = {
                            mainDashboardArea: document.getElementById('mainDashboardArea'),
                            consoleArea: document.getElementById('consoleArea'),
                            'page-device-status': document.getElementById('page-device-status'),
                            'page-screenshot': document.getElementById('page-screenshot'),
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
            const savedMode = localStorage.getItem('neko-theme-mode') || 'dark';
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

            // 4. 昼夜切换事件
            themeModeBtn.addEventListener('click', () => {
                const isLight = document.documentElement.getAttribute('data-theme') === 'light';
                if (isLight) {
                    document.documentElement.removeAttribute('data-theme');
                    themeModeIcon.classList.replace('ph-sun', 'ph-moon');
                    localStorage.setItem('neko-theme-mode', 'dark');
                } else {
                    document.documentElement.setAttribute('data-theme', 'light');
                    themeModeIcon.classList.replace('ph-moon', 'ph-sun');
                    localStorage.setItem('neko-theme-mode', 'light');
                }
            });

            // 5. 颜色面板展开/收起事件
            themeColorBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                colorPalette.classList.toggle('show');
            });

            // 6. 更换颜色事件
            colorSwatches.forEach(swatch => {
                swatch.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const newColor = swatch.getAttribute('data-color');
                    document.documentElement.style.setProperty('--theme-color', newColor);
                    localStorage.setItem('neko-theme-color', newColor);
                    
                    if (profileAvatarImg) {
                        profileAvatarImg.src = `https://ui-avatars.com/api/?name=User&background=${newColor.replace('#', '')}&color=fff`;
                    }

                    colorSwatches.forEach(s => s.classList.remove('active'));
                    swatch.classList.add('active');
                    colorPalette.classList.remove('show');
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

            // 点击模态框背景关闭
            document.addEventListener('click', (e) => {
                if (e.target === configModal) {
                    closeModal();
                }
                if (e.target === profileModal) {
                    profileModal.classList.remove('show');
                }
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
                } else {
                    navConsole.classList.remove('show');
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

                // 拖拽拉伸拉手 (右下角)
                const resizeHandle = document.createElement('div');
                resizeHandle.className = 'resize-handle';
                card.appendChild(resizeHandle);

                // ============= 拖拽调整大小 (Snap to Grid) =============
                resizeHandle.addEventListener('mousedown', (e) => {
                    if (!isEditMode) return;
                    e.preventDefault(); // 阻止浏览器的默认拖拽与文本选择，确保只被识别为大小调整
                    e.stopPropagation();

                    // 禁用卡片的拖拽属性，避免一边调大小一边触发了拖放重排
                    card.setAttribute('draggable', 'false');
                    card.classList.add('resizing');
                    resizeHandle.classList.add('active');

                    const startX = e.clientX;
                    const startY = e.clientY;
                    const startDataW = parseInt(card.getAttribute('data-w') || 1);
                    const startDataH = parseInt(card.getAttribute('data-h') || 1);
                    
                    // 获取当前卡片所在的 section 容器
                    const parentSection = card.closest('.dashboard-section');
                    // 根据当前12格网格状态计算一个槽位的像素宽 (加上 gap 一起计算)
                    const slotWidth = (parentSection.offsetWidth + 16) / 12; 
                    const slotHeight = 40 + 16; // 新的 row height 40 + gap 16
                    
                    document.onmousemove = (moveE) => {
                        let addW = Math.round((moveE.clientX - startX) / slotWidth);
                        let addH = Math.round((moveE.clientY - startY) / slotHeight);
                        
                        let newW = Math.max(2, Math.min(12, startDataW + addW)); // 最小宽度占2列，避免被压缩到不可见
                        let newH = Math.max(2, startDataH + addH); // 最小高度2行
                        
                        // 更新内联动态样式属性
                        card.style.gridColumn = `span ${newW}`;
                        card.style.gridRow = `span ${newH}`;
                        card.setAttribute('data-w', newW);
                        card.setAttribute('data-h', newH);
                    };
                    
                    document.onmouseup = () => {
                        document.onmousemove = null;
                        document.onmouseup = null;

                        // 恢复拖拽属性和去除视觉反馈
                        if (isEditMode) {
                            card.setAttribute('draggable', 'true');
                        }
                        card.classList.remove('resizing');
                        resizeHandle.classList.remove('active');
                    };
                });

                // ============= 内容替换逻辑 (可双向切换) =============
                if (btnReplace) {
                    let isSwapped = false;
                    const viewDefault = card.querySelector('.view-default');
                    const viewSwapped = card.querySelector('.view-swapped');

                    btnReplace.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // 过渡动画
                        card.style.opacity = '0';
                        card.style.transform = 'scale(0.95)';
                        
                        setTimeout(() => {
                            isSwapped = !isSwapped;
                            if (isSwapped) {
                                viewDefault.style.display = 'none';
                                viewSwapped.style.display = 'flex';
                            } else {
                                viewDefault.style.display = 'flex';
                                viewSwapped.style.display = 'none';
                            }
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

            // ============= 加载持久化布局 =============
            function loadLayoutConfig() {
                const savedConfig = localStorage.getItem(STORAGE_KEY);
                if (savedConfig) {
                    try {
                        const layout = JSON.parse(savedConfig);
                        layout.forEach(item => {
                            const card = document.getElementById(item.id);
                            const targetSection = document.querySelector(`.dashboard-section[data-section="${item.section}"]`);
                            if (card && targetSection) {
                                // 还原宽和高
                                card.setAttribute('data-w', item.w);
                                card.setAttribute('data-h', item.h);
                                card.style.gridColumn = `span ${item.w}`;
                                card.style.gridRow = `span ${item.h}`;
                                // 还原层级流排序
                                targetSection.appendChild(card);
                            }
                        });
                    } catch (e) { console.error('加载防抖布局失败', e); }
                }
            }
            // 自动加载上次保存的配置
            loadLayoutConfig();

            editLayoutBtn.addEventListener('click', () => {
                toggleEditMode(true);
            });

            cancelEditBtn.addEventListener('click', () => {
                // 取消：直接刷新页面重新加载配置好的或默认的样子
                window.location.reload(); 
            });

            restoreDefaultBtn.addEventListener('click', () => {
                if (confirm('确定要放弃所有的布局修改并恢复出厂默认布局吗？')) {
                    localStorage.removeItem(STORAGE_KEY);
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
                                section: secName
                            });
                        }
                    });
                });
                
                const btn = saveEditBtn;
                const originalHtml = btn.innerHTML;
                btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 保存中...';
                
                setTimeout(() => {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
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
            [
                'uploadSwitch', 'autoStartSwitch', 'reportAutoStartSwitch', 'autoRestartSwitch',
                'stgAutoStartSwitch', 'stgTraySwitch', 'stgRestoreSwitch', 'stgDarkModeSwitch',
                'stgGlassSwitch', 'stgAutoUploadSwitch', 'stgNotifySwitch', 'stgDndSwitch',
                'stgIncognitoSwitch', 'stg2FASwitch', 'stgAutoDownloadSwitch'
            ].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('click', () => {
                    el.classList.toggle('on');
                    // 设置页深色模式联动
                    if (id === 'stgDarkModeSwitch') {
                        const isLight = !el.classList.contains('on');
                        document.documentElement.setAttribute('data-theme', isLight ? 'light' : '');
                        if (isLight) document.documentElement.setAttribute('data-theme', 'light');
                        else document.documentElement.removeAttribute('data-theme');
                        localStorage.setItem('neko-theme-mode', isLight ? 'light' : 'dark');
                    }
                });
            });

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
            document.querySelectorAll('#stgColorSwatches .settings-swatch').forEach(swatch => {
                swatch.addEventListener('click', () => {
                    const color = swatch.dataset.color;
                    document.documentElement.style.setProperty('--theme-color', color);
                    localStorage.setItem('neko-theme-color', color);
                    // 同步两处色板的 active 状态
                    document.querySelectorAll('.settings-swatch, .color-swatch').forEach(s => {
                        s.classList.toggle('active', s.dataset.color === color);
                    });
                });
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

            // ======== 更新中心：回滚二次确认 ======== //
            const rollbackBtn = document.getElementById('rollbackBtn');
            if (rollbackBtn) {
                let rollbackTimer = null;
                rollbackBtn.addEventListener('click', () => {
                    if (rollbackBtn.classList.contains('confirming')) {
                        clearTimeout(rollbackTimer);
                        rollbackBtn.classList.remove('confirming');
                        rollbackBtn.querySelector('.update-ctrl-label').textContent = '版本回滚';
                    } else {
                        rollbackBtn.classList.add('confirming');
                        rollbackBtn.querySelector('.update-ctrl-label').textContent = rollbackBtn.dataset.confirm;
                        rollbackTimer = setTimeout(() => {
                            rollbackBtn.classList.remove('confirming');
                            rollbackBtn.querySelector('.update-ctrl-label').textContent = '版本回滚';
                        }, 3000);
                    }
                });
            }

            // ======== 服务与自启动 - 危险操作二次确认 ======== //
            // 带 data-confirm 属性的按钮点击后进入「确认态」，3s 内再次点击才执行
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

            // ======== 服务与自启动 - 一键体检 ======== //
            const runHealthCheckBtn = document.getElementById('runHealthCheckBtn');
            const healthResultsList = document.getElementById('healthResultsList');

            const healthChecks = [
                { name: '守护进程状态',  check: () => ({ ok: true,  text: 'NekoDaemon.exe 运行正常，PID 10243' }) },
                { name: '屏幕捕获权限',  check: () => ({ ok: false, text: 'Access Denied — 需要以管理员身份运行' }) },
                { name: '进程遍历 (WMI)', check: () => ({ ok: true,  text: 'WMI 查询正常，已获取前台应用信息' }) },
                { name: '网络连通性',    check: () => ({ ok: true,  text: 'WebSocket 延迟 12ms，上报服务正常' }) },
                { name: '开机自启配置',  check: () => ({ ok: true,  text: '注册表启动项已正确写入' }) },
                { name: '本地存储空间',  check: () => ({ ok: 'warn', text: '已用 384 MB / 2 GB，建议清理旧截图' }) },
                { name: '服务崩溃恢复',  check: () => ({ ok: true,  text: '看门狗已启用，最大重启 3 次' }) },
            ];

            if (runHealthCheckBtn && healthResultsList) {
                runHealthCheckBtn.addEventListener('click', () => {
                    runHealthCheckBtn.disabled = true;
                    runHealthCheckBtn.innerHTML = '<i class="ph ph-circle-notch" style="animation: spin 0.8s linear infinite;"></i> 检测中...';
                    healthResultsList.innerHTML = '';

                    healthChecks.forEach((item, i) => {
                        const placeholder = document.createElement('div');
                        placeholder.className = 'health-result-item';
                        placeholder.style.animationDelay = (i * 0.12) + 's';
                        placeholder.innerHTML = `
                            <i class="ph ph-circle-notch health-result-icon checking"></i>
                            <div class="health-result-name">${item.name}</div>
                            <div class="health-result-desc">检测中...</div>`;
                        healthResultsList.appendChild(placeholder);

                        setTimeout(() => {
                            const result = item.check();
                            const iconClass = result.ok === true ? 'ph-check-circle ok' :
                                              result.ok === 'warn' ? 'ph-warning warn' : 'ph-x-circle fail';
                            placeholder.innerHTML = `
                                <i class="ph ${iconClass} health-result-icon"></i>
                                <div class="health-result-name">${item.name}</div>
                                <div class="health-result-desc">${result.text}</div>`;
                        }, 400 + i * 350);
                    });

                    setTimeout(() => {
                        runHealthCheckBtn.disabled = false;
                        runHealthCheckBtn.innerHTML = '<i class="ph ph-heartbeat"></i> 重新体检';
                    }, 400 + healthChecks.length * 350 + 200);
                });
            }

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

            // ======== 设置页：系统字体列表填充 ======== //
            const stgFontSelect = document.getElementById('stgFontSelect');
            if (stgFontSelect) {
                const commonFonts = [
                    { label: '微软雅黑 / Microsoft YaHei', value: 'Microsoft YaHei' },
                    { label: '思源黑体 / Source Han Sans', value: 'Source Han Sans SC' },
                    { label: '苹方 / PingFang SC', value: 'PingFang SC' },
                    { label: 'Segoe UI', value: 'Segoe UI' },
                    { label: 'Inter', value: 'Inter' },
                    { label: 'Roboto', value: 'Roboto' },
                    { label: 'Helvetica Neue', value: 'Helvetica Neue' },
                    { label: 'Arial', value: 'Arial' },
                    { label: 'Consolas', value: 'Consolas' },
                    { label: '等线 / DengXian', value: 'DengXian' },
                ];
                commonFonts.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f.value;
                    opt.textContent = f.label;
                    opt.style.fontFamily = f.value;
                    stgFontSelect.appendChild(opt);
                });
                const savedFont = localStorage.getItem('neko-ui-font') || '';
                stgFontSelect.value = savedFont;
                stgFontSelect.addEventListener('change', () => {
                    const font = stgFontSelect.value;
                    document.body.style.fontFamily = font ? `"${font}", "Microsoft YaHei", sans-serif` : '';
                    localStorage.setItem('neko-ui-font', font);
                });
                // 页面加载时应用已保存字体
                if (savedFont) document.body.style.fontFamily = `"${savedFont}", "Microsoft YaHei", sans-serif`;
            }
        });