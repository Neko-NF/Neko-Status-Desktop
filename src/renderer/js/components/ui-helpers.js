(function attachNekoUIHelpers() {
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

    window._nekoUIHelpers = {
        ...(window._nekoUIHelpers || {}),
        setExpandableSectionState,
        applyUIFontProfile,
        resolveUIFontProfile,
        normalizeServiceHealthCheckCopy,
    };
})();
