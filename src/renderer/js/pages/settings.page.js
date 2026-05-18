(function() {
    window._nekoModules = window._nekoModules || {};
    window._nekoModules.pages = window._nekoModules.pages || {};

    function getConfigClient() {
        return window._nekoModules?.services?.ConfigClient || null;
    }

    function getSystemClient() {
        return window._nekoModules?.services?.SystemClient || null;
    }

    function applySavedFontProfile() {
        const savedFont = localStorage.getItem('neko-ui-font') || '';
        if (savedFont) {
            document.documentElement.style.setProperty('--ui-font', `"${savedFont}"`);
        } else {
            document.documentElement.style.removeProperty('--ui-font');
        }
        window._nekoUIHelpers?.applyUIFontProfile?.(savedFont);
        return savedFont;
    }

    function applyFont(font) {
        if (font) {
            document.documentElement.style.setProperty('--ui-font', `"${font}"`);
        } else {
            document.documentElement.style.removeProperty('--ui-font');
        }
        window._nekoUIHelpers?.applyUIFontProfile?.(font);
        localStorage.setItem('neko-ui-font', font);
        const savePromise = getConfigClient()?.set?.('uiFont', font);
        if (savePromise?.catch) savePromise.catch(() => {});
    }

    async function loadFontOptions(select) {
        select.innerHTML = '<option value="">系统默认</option>';
        let fonts = [];
        try {
            const client = getSystemClient();
            fonts = client?.isReady?.() ? await client.getFonts() : [];
        } catch {}
        [...new Set(fonts || [])]
            .sort((a, b) => a.localeCompare(b, 'zh-CN'))
            .forEach((name) => {
                const opt = document.createElement('option');
                opt.value = name;
                opt.textContent = name;
                opt.style.fontFamily = name;
                select.appendChild(opt);
            });
        select.value = localStorage.getItem('neko-ui-font') || '';
    }

    const SettingsPage = {
        init() {
            if (this._inited) return;
            this._inited = true;
            console.log('[SettingsPage] 初始化');
            this.bindEvents();
        },

        bindEvents() {
            const stgFontSelect = document.getElementById('stgFontSelect');
            if (!stgFontSelect) return;

            const savedFont = applySavedFontProfile();
            loadFontOptions(stgFontSelect);

            stgFontSelect.addEventListener('change', () => {
                applyFont(stgFontSelect.value);
            });
        },

        render(data) {
            // 渲染逻辑
        }
    };

    window._nekoModules.pages.SettingsPage = SettingsPage;
    applySavedFontProfile();
})();
