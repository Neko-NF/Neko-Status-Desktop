(function() {
    window._nekoModules = window._nekoModules || {};
    window._nekoModules.pages = window._nekoModules.pages || {};

    let _streamPollTimer = null;

    const StreamPage = {
        init() {
            console.log('[StreamPage] 初始化');
            this.bindEvents();
            this.initData();
        },

        async initData() {
            if (!window.nekoIPC) return;
            try {
                // 读取当前配置
                const cfg = await window.nekoIPC.getStreamConfig();
                if (cfg) {
                    if (document.getElementById('obsWsHost')) document.getElementById('obsWsHost').value = cfg.obsWsHost || '127.0.0.1';
                    if (document.getElementById('obsWsPort')) document.getElementById('obsWsPort').value = cfg.obsWsPort || 4455;
                    if (document.getElementById('obsWsPassword')) document.getElementById('obsWsPassword').value = cfg.obsWsPassword || '';
                    if (document.getElementById('srsHost')) document.getElementById('srsHost').value = cfg.srsHost || '';
                    if (document.getElementById('srsRtmpPort')) document.getElementById('srsRtmpPort').value = cfg.srsRtmpPort || 51935;
                    if (document.getElementById('srsApp')) document.getElementById('srsApp').value = cfg.srsApp || 'live';
                    if (document.getElementById('srsApiPort')) document.getElementById('srsApiPort').value = cfg.srsApiPort || 51985;
                }

                // 尝试获取一次最新 Key
                const info = await window.nekoIPC.getStreamKey();
                if (info && info.streamKey) {
                    const el = document.getElementById('srsStreamKey');
                    if (el) {
                        el.value = info.streamKey;
                        el.dataset.fullKey = info.streamKey;
                    }
                }

                // 初次测一次连通性
                this.testObsWebSocket();
            } catch (e) {
                console.error('[StreamPage] initData error:', e);
            }
        },

        bindEvents() {
            if (!window.nekoIPC) return;

            // 获取推流密钥按钮
            const btnGetKey = document.getElementById('btnGetStreamKey');
            if (btnGetKey) {
                btnGetKey.addEventListener('click', async () => {
                    const btn = btnGetKey;
                    btn.disabled = true;
                    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 获取中...';
                    try {
                        const info = await window.nekoIPC.getStreamKey();
                        if (info && info.streamKey) {
                            const el = document.getElementById('srsStreamKey');
                            if (el) {
                                el.value = info.streamKey;
                                el.dataset.fullKey = info.streamKey;
                            }
                            window.showNekoIsland?.('✅ 获取串流密钥成功');
                        } else {
                            window.showNekoIsland?.('❌ 获取失败: ' + (info?.error || '未知错误'));
                        }
                    } catch (e) {
                        window.showNekoIsland?.('❌ 请求异常: ' + e.message);
                    }
                    btn.disabled = false;
                    btn.innerHTML = '<i class="ph ph-key"></i> 重新获取密钥';
                });
            }

            // 重置推流密钥按钮
            const btnResetKey = document.getElementById('btnResetStreamKey');
            if (btnResetKey) {
                btnResetKey.addEventListener('click', async () => {
                    if (!confirm('警告：重置后旧密钥将失效，需要重新配置 OBS，确定继续吗？')) return;
                    const btn = btnResetKey;
                    btn.disabled = true;
                    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 重置中...';
                    try {
                        const info = await window.nekoIPC.resetStreamKey();
                        if (info && info.streamKey) {
                            const el = document.getElementById('srsStreamKey');
                            if (el) {
                                el.value = info.streamKey;
                                el.dataset.fullKey = info.streamKey;
                            }
                            window.showNekoIsland?.('✅ 密钥已重置并生效');
                        } else {
                            window.showNekoIsland?.('❌ 重置失败: ' + (info?.error || '未知错误'));
                        }
                    } catch (e) {
                        window.showNekoIsland?.('❌ 请求异常: ' + e.message);
                    }
                    btn.disabled = false;
                    btn.innerHTML = '<i class="ph ph-arrows-clockwise"></i> 重置密钥';
                });
            }

            // 复制密钥按钮
            const btnCopyKey = document.getElementById('btnCopyStreamKey');
            if (btnCopyKey) {
                btnCopyKey.addEventListener('click', () => {
                    const el = document.getElementById('srsStreamKey');
                    if (!el || !el.dataset.fullKey) return window.showNekoIsland?.('没有可复制的密钥');
                    navigator.clipboard.writeText(el.dataset.fullKey)
                        .then(() => window.showNekoIsland?.('✅ 密钥已复制到剪贴板'))
                        .catch(err => window.showNekoIsland?.('❌ 复制失败: ' + err.message));
                });
            }

            // 保存设置按钮
            const btnSaveCfg = document.getElementById('btnSaveStreamConfig');
            if (btnSaveCfg) {
                btnSaveCfg.addEventListener('click', async () => {
                    const btn = btnSaveCfg;
                    btn.disabled = true;
                    const originalHtml = btn.innerHTML;
                    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 保存中...';

                    const cfg = {
                        obsWsHost: document.getElementById('obsWsHost')?.value || '127.0.0.1',
                        obsWsPort: Number(document.getElementById('obsWsPort')?.value) || 4455,
                        obsWsPassword: document.getElementById('obsWsPassword')?.value || '',
                        ...this.collectSrsSettings()
                    };

                    try {
                        const res = await window.nekoIPC.saveStreamConfig(cfg);
                        if (res && res.ok) {
                            window.showNekoIsland?.('✅ 直播推流设置已保存');
                            this.testObsWebSocket();
                        } else {
                            window.showNekoIsland?.('❌ 保存失败');
                        }
                    } catch (e) {
                        window.showNekoIsland?.('❌ 保存异常: ' + e.message);
                    }
                    btn.disabled = false;
                    btn.innerHTML = originalHtml;
                });
            }

            // 测速 OBS 按钮
            const btnTestObs = document.getElementById('testObsWsBtn');
            if (btnTestObs) {
                btnTestObs.addEventListener('click', () => this.testObsWebSocket());
            }

            // 应用至 OBS 按钮
            const btnApplyObs = document.getElementById('applyToObsBtn');
            if (btnApplyObs) {
                btnApplyObs.addEventListener('click', () => this.applyStreamConfigToObs());
            }

            // 测试 SRS 按钮
            const btnTestSrs = document.getElementById('testSrsBtn');
            if (btnTestSrs) {
                btnTestSrs.addEventListener('click', async () => {
                    const btn = btnTestSrs;
                    btn.disabled = true;
                    btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> 检测中...';
                    try {
                        const set = this.collectSrsSettings();
                        const res = await window.nekoIPC.testSrs(set);
                        if (res && res.ok) {
                            window.showNekoIsland?.('✅ SRS 服务连通性正常: ' + (res.latencyMs || 0) + 'ms');
                        } else {
                            window.showNekoIsland?.('❌ SRS 检测失败: ' + (res?.error || '超时或异常'));
                        }
                    } catch (e) {
                        window.showNekoIsland?.('❌ SRS 请求异常: ' + e.message);
                    }
                    btn.disabled = false;
                    btn.innerHTML = '<i class="ph ph-activity"></i> 测试连通性';
                });
            }

            // 状态轮询
            if (!_streamPollTimer) {
                _streamPollTimer = setInterval(() => this.pollStreamStatus(), 5000);
            }
        },

        async pollStreamStatus() {
            if (!window.nekoIPC) return;
            try {
                const info = await window.nekoIPC.getLiveStatus();
                this.updateLiveStatusUI(info);
            } catch (e) {
                // silently fail polling
            }
        },

        updateLiveStatusUI(info) {
            const card = document.getElementById('liveStatusCard');
            if (!card) return;
            const dot = card.querySelector('.status-dot');
            const lbl = card.querySelector('.status-label');
            const clients = document.getElementById('liveClientsCount');
            const timeEl = document.getElementById('liveUptime');

            if (info && info.live) {
                if (dot) dot.className = 'status-dot active';
                if (lbl) lbl.textContent = '直播进行中';
                if (clients) clients.textContent = info.clients || 0;
                if (timeEl) {
                    const up = info.streamTime || 0;
                    const mm = Math.floor(up / 60);
                    timeEl.textContent = `${mm}分${ss}秒`;
                }
            } else {
                if (dot) dot.className = 'status-dot';
                if (lbl) lbl.textContent = '未直播 / 连接断开';
                if (clients) clients.textContent = '0';
                if (timeEl) timeEl.textContent = '0分0秒';
            }
        },

        collectSrsSettings() {
            return {
                srsHost:     (document.getElementById('srsHost') || {}).value || '',
                srsRtmpPort: Number((document.getElementById('srsRtmpPort') || {}).value) || 51935,
                srsApp:      (document.getElementById('srsApp') || {}).value || 'live',
                srsApiPort:  Number((document.getElementById('srsApiPort') || {}).value) || 51985,
            };
        },

        async testObsWebSocket() {
            if (!window.nekoIPC) return;
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
                    window.showNekoIsland?.('✅ OBS WebSocket 连接成功');
                } else {
                    if (dot) dot.setAttribute('data-connected', 'false');
                    if (lbl) lbl.textContent = 'OBS WebSocket 未连接';
                    if (applyBtn) applyBtn.disabled = true;
                    window.showNekoIsland?.('❌ ' + (res && res.reason ? res.reason : 'OBS 连接失败'));
                }
            } catch (e) {
                if (dot) dot.setAttribute('data-connected', 'false');
                if (lbl) lbl.textContent = 'OBS WebSocket 未连接';
                window.showNekoIsland?.('❌ OBS 连接异常: ' + e.message);
            }
        },

        async applyStreamConfigToObs() {
            if (!window.nekoIPC) return;
            const host = (document.getElementById('obsWsHost') || {}).value || '127.0.0.1';
            const port = (document.getElementById('obsWsPort') || {}).value || '4455';
            const pass = (document.getElementById('obsWsPassword') || {}).value || '';
            try {
                const res = await window.nekoIPC.applyStreamConfigToObs({ host, port: Number(port), password: pass });
                if (res && res.ok) {
                    window.showNekoIsland?.('✅ OBS 推流配置已应用，可在 OBS 中开始推流');
                } else {
                    window.showNekoIsland?.('❌ 配置失败: ' + (res && res.error ? res.error : '未知错误'));
                }
            } catch (e) {
                window.showNekoIsland?.('❌ 配置异常: ' + e.message);
            }
        }
    };

    window._nekoModules.pages.StreamPage = StreamPage;
})();
