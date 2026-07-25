(function attachNekoUIHelpers() {
    const expandableStates = new WeakMap();
    const viewStackStates = new WeakMap();
    let expandableId = 0;

    const requestFrame = window.requestAnimationFrame?.bind(window)
        || ((callback) => window.setTimeout(callback, 16));
    const cancelFrame = window.cancelAnimationFrame?.bind(window)
        || ((handle) => window.clearTimeout(handle));
    const motionNow = () => window.performance?.now?.() ?? Date.now();

    function ensureExpandableStructure(el, targetDisplay) {
        let track = Array.from(el.children || []).find((child) => child.classList?.contains?.('ui-expandable-track'));
        let content = track?.querySelector?.(':scope > .ui-expandable-content') || null;
        if (!content && track) {
            content = Array.from(track.children || []).find((child) => child.classList?.contains?.('ui-expandable-content')) || null;
        }

        if (!track || !content) {
            const computed = window.getComputedStyle?.(el);
            const originalNodes = Array.from(el.childNodes || []);
            track = document.createElement('div');
            content = document.createElement('div');
            track.className = 'ui-expandable-track';
            content.className = 'ui-expandable-content';

            originalNodes.forEach((node) => content.appendChild(node));
            track.appendChild(content);
            el.appendChild(track);

            // Existing rows were authored as flex containers. Keep their visual layout inside
            // the grid track while the outer element becomes the padding-free animation shell.
            content.style.display = targetDisplay;
            if (computed) {
                [
                    'alignItems', 'justifyContent', 'flexDirection', 'flexWrap', 'gap',
                    'gridTemplateColumns', 'gridTemplateRows', 'gridAutoFlow',
                    'gridAutoColumns', 'gridAutoRows', 'columnGap', 'rowGap',
                ].forEach((property) => {
                    const value = computed[property];
                    if (value && value !== 'normal') content.style[property] = value;
                });
                content.style.padding = `${computed.paddingTop} ${computed.paddingRight} ${computed.paddingBottom} ${computed.paddingLeft}`;
                if (computed.minHeight && computed.minHeight !== 'auto') content.style.minHeight = computed.minHeight;
            }
            el.style?.setProperty?.('padding', '0', 'important');
            el.style?.setProperty?.('min-height', '0', 'important');
        } else {
            content.style.display = targetDisplay;
        }

        // Content added directly to an already initialized panel is folded into the track.
        Array.from(el.childNodes || []).forEach((node) => {
            if (node !== track) content.appendChild(node);
        });
        return { track, content };
    }

    function syncExpandableA11y(el, expanded, state, trigger) {
        if (trigger) state.trigger = trigger;
        const activeTrigger = state.trigger;
        if (activeTrigger) {
            if (!el.id) el.id = `neko-expandable-${++expandableId}`;
            activeTrigger.setAttribute?.('aria-controls', el.id);
            activeTrigger.setAttribute?.('aria-expanded', expanded ? 'true' : 'false');
        }
        el.setAttribute?.('aria-hidden', expanded ? 'false' : 'true');
        if (expanded) {
            el.hidden = false;
            el.removeAttribute?.('hidden');
            if ('inert' in el) el.inert = false;
            el.removeAttribute?.('inert');
        } else {
            if ('inert' in el) el.inert = true;
            el.setAttribute?.('inert', '');
        }
    }

    function cancelExpandableWork(el, state) {
        if (state.frame !== null) cancelFrame(state.frame);
        if (state.finalizeFrame !== null) cancelFrame(state.finalizeFrame);
        if (state.finalizeTimer !== null) window.clearTimeout(state.finalizeTimer);
        if (state.onTransitionEnd) el.removeEventListener?.('transitionend', state.onTransitionEnd);
        state.frame = null;
        state.finalizeFrame = null;
        state.finalizeTimer = null;
        state.onTransitionEnd = null;
    }

    function applyExpandableFinalState(el, expanded, state) {
        cancelExpandableWork(el, state);
        el.classList.toggle('is-expanded', expanded);
        el.classList.toggle('is-collapsed', !expanded);
        el.classList.remove('is-animating');
        el.style.display = expanded ? 'grid' : 'none';
        el.hidden = !expanded;
        if (expanded) el.removeAttribute?.('hidden');
        else el.setAttribute?.('hidden', '');
        state.expanded = expanded;
        state.desired = expanded;
    }

    function scheduleExpandableFinalState(el, expanded, state, duration, revision) {
        const deadline = motionNow() + duration;
        const finish = () => {
            if (state.revision !== revision || state.desired !== expanded) return;
            applyExpandableFinalState(el, expanded, state);
        };
        state.onTransitionEnd = (event) => {
            if (event?.target !== el || event?.propertyName !== 'grid-template-rows') return;
            finish();
        };
        el.addEventListener?.('transitionend', state.onTransitionEnd);

        // A reversal can cancel transitionend. Drive the deadline from animation frames so
        // hidden Electron test windows and timer coalescing cannot strand an intermediate state.
        const finalizeAtDeadline = (frameTime) => {
            state.finalizeFrame = null;
            if (state.revision !== revision || state.desired !== expanded) return;
            const now = Number.isFinite(frameTime) ? frameTime : motionNow();
            if (now >= deadline) {
                finish();
                return;
            }
            state.finalizeFrame = requestFrame(finalizeAtDeadline);
        };
        state.finalizeFrame = requestFrame(finalizeAtDeadline);
        // Chromium can pause off-screen animation frames while regular tasks keep running.
        // The timer shares the same revision guard, so either clock may safely finish first.
        state.finalizeTimer = window.setTimeout(finish, duration + 24);
    }

    function setExpandableSectionState(el, expanded, options = {}) {
        if (!el) return false;
        const nextExpanded = !!expanded;
        const targetDisplay = options.display ?? el.dataset.expandedDisplay ?? 'block';
        const duration = Math.max(0, Number(options.duration ?? 240));
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

        el.dataset.expandedDisplay = targetDisplay;
        el.classList.add('ui-expandable');
        el.style?.setProperty?.('--ui-expandable-duration', `${duration}ms`);
        const structure = ensureExpandableStructure(el, targetDisplay);
        let state = expandableStates.get(el);
        if (!state) {
            state = {
                ...structure,
                expanded: null,
                desired: null,
                trigger: null,
                frame: null,
                finalizeFrame: null,
                finalizeTimer: null,
                onTransitionEnd: null,
                revision: 0,
            };
            expandableStates.set(el, state);
        } else {
            state.track = structure.track;
            state.content = structure.content;
        }
        syncExpandableA11y(el, nextExpanded, state, options.trigger);

        if (state.desired === nextExpanded && options.initial !== true) return false;
        cancelExpandableWork(el, state);
        const revision = ++state.revision;
        state.desired = nextExpanded;

        const currentlyHidden = window.getComputedStyle?.(el)?.display === 'none' || el.style.display === 'none';
        if (options.initial === true || reduceMotion || duration === 0 || (!nextExpanded && currentlyHidden)) {
            applyExpandableFinalState(el, nextExpanded, state);
            return true;
        }

        // The native hidden attribute wins over authored display rules. Remove it for both
        // the opening and closing frames, then restore it only after the close transition.
        el.hidden = false;
        el.removeAttribute?.('hidden');
        el.style.display = 'grid';
        el.classList.add('is-animating');

        if (nextExpanded && currentlyHidden) {
            el.classList.remove('is-expanded');
            el.classList.add('is-collapsed');
            void el.offsetHeight;
            state.frame = requestFrame(() => {
                state.frame = null;
                if (state.revision !== revision || state.desired !== true) return;
                el.classList.remove('is-collapsed');
                el.classList.add('is-expanded');
                scheduleExpandableFinalState(el, true, state, duration, revision);
            });
            return true;
        }

        el.classList.toggle('is-expanded', nextExpanded);
        el.classList.toggle('is-collapsed', !nextExpanded);
        scheduleExpandableFinalState(el, nextExpanded, state, duration, revision);
        return true;
    }

    function syncViewPanelA11y(panel, active) {
        panel.setAttribute?.('aria-hidden', active ? 'false' : 'true');
        if (active) {
            if ('inert' in panel) panel.inert = false;
            panel.removeAttribute?.('inert');
        } else {
            if ('inert' in panel) panel.inert = true;
            panel.setAttribute?.('inert', '');
        }
    }

    function setViewPanelDisplay(panel, visible, display) {
        panel.style.display = visible ? display : 'none';
        panel.classList.toggle('is-active', visible);
        panel.classList.remove('is-entering', 'is-leaving');
        syncViewPanelA11y(panel, visible);
    }

    /**
     * Cross-fades mutually exclusive views while animating the stack to the
     * incoming view's height. This keeps modal and card geometry stable.
     */
    function setViewStackState(stack, activePanel, options = {}) {
        if (!stack || !activePanel) return false;
        const selector = options.selector || ':scope > [data-ui-view]';
        const panels = Array.from(stack.querySelectorAll?.(selector) || []);
        if (!panels.includes(activePanel)) panels.push(activePanel);
        if (!panels.length) return false;

        const duration = Math.max(0, Number(options.duration ?? 220));
        const display = options.display || activePanel.dataset?.viewDisplay || 'block';
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        let state = viewStackStates.get(stack);
        if (!state) {
            state = { active: null, frame: null, timer: null, generation: 0 };
            viewStackStates.set(stack, state);
        }

        // A repeated request for the current target must not cancel the timer
        // that is finishing an in-flight transition.
        if (state.active === activePanel && options.initial !== true) return false;

        if (state.frame) cancelFrame(state.frame);
        if (state.timer) window.clearTimeout(state.timer);
        state.frame = null;
        state.timer = null;
        state.generation += 1;
        const generation = state.generation;

        stack.classList.add('ui-view-stack');
        stack.style?.setProperty?.('--ui-view-duration', `${duration}ms`);
        panels.forEach((panel) => panel.classList.add('ui-view-panel'));

        const outgoing = state.active && state.active !== activePanel
            ? state.active
            : panels.find((panel) => panel !== activePanel && panel.classList.contains('is-active'));

        const finish = () => {
            if (state.generation !== generation) return;
            panels.forEach((panel) => setViewPanelDisplay(
                panel,
                panel === activePanel,
                panel === activePanel ? display : (panel.dataset?.viewDisplay || 'block'),
            ));
            stack.style.height = '';
            stack.classList.remove('is-transitioning');
            state.active = activePanel;
            state.frame = null;
            state.timer = null;
        };

        if (options.initial === true || reduceMotion || duration === 0 || !outgoing) {
            finish();
            return true;
        }

        // Resolve any interrupted transition to its most recent target before
        // measuring the next one. The generation guard prevents stale timers.
        panels.forEach((panel) => {
            if (panel !== outgoing && panel !== activePanel) {
                setViewPanelDisplay(panel, false, panel.dataset?.viewDisplay || 'block');
            }
        });
        const currentHeight = Math.ceil(stack.getBoundingClientRect?.().height || outgoing.scrollHeight || 0);
        activePanel.style.display = display;
        activePanel.classList.remove('is-leaving');
        activePanel.classList.add('is-active', 'is-entering');
        syncViewPanelA11y(activePanel, true);
        const targetHeight = Math.ceil(activePanel.scrollHeight || activePanel.getBoundingClientRect?.().height || currentHeight);

        outgoing.classList.remove('is-active', 'is-entering', 'is-leaving');
        outgoing.classList.add('is-leaving');
        syncViewPanelA11y(outgoing, false);
        stack.style.height = `${currentHeight}px`;
        stack.classList.add('is-transitioning');
        state.active = activePanel;
        void stack.offsetHeight;

        state.frame = requestFrame(() => {
            state.frame = null;
            if (state.generation !== generation) return;
            activePanel.classList.remove('is-entering');
            stack.style.height = `${targetHeight}px`;
            state.timer = window.setTimeout(finish, duration + 60);
        });
        return true;
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

    function setButtonBusy(button, busy, options = {}) {
        const loadingSystem = window._nekoModules?.components?.LoadingSystem;
        if (loadingSystem?.setButtonBusy) {
            return loadingSystem.setButtonBusy(button, busy, options);
        }
        if (!button) return false;
        if (busy) {
            let overlay = button.querySelector?.(':scope > .neko-button-busy-overlay');
            if (!overlay) {
                overlay = document.createElement('span');
                overlay.className = 'neko-button-busy-overlay';
                overlay.setAttribute('aria-hidden', 'true');
                overlay.innerHTML = '<span class="neko-busy-indicator" aria-hidden="true"></span><span class="neko-busy-label"></span>';
                button.appendChild(overlay);
                button.dataset.nekoWasDisabled = button.disabled ? 'true' : 'false';
                button.dataset.nekoAriaLabel = button.getAttribute('aria-label') ?? '';
            }
            button.disabled = true;
            button.classList.add('loading', 'neko-button-busy');
            button.setAttribute('aria-busy', 'true');
            const label = String(options.label || '处理中…');
            button.setAttribute('aria-label', label);
            const labelElement = overlay.querySelector?.('.neko-busy-label');
            if (labelElement) labelElement.textContent = label;
            return true;
        }
        const overlay = button.querySelector?.(':scope > .neko-button-busy-overlay');
        if (!overlay) return false;
        overlay.remove();
        button.disabled = button.dataset.nekoWasDisabled === 'true';
        const ariaLabel = button.dataset.nekoAriaLabel;
        if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
        else button.removeAttribute('aria-label');
        delete button.dataset.nekoWasDisabled;
        delete button.dataset.nekoAriaLabel;
        button.classList.remove('loading', 'neko-button-busy');
        button.removeAttribute('aria-busy');
        return true;
    }

    function enhanceSelect(select, options = {}) {
        if (!select || select._nekoSelect) return select?._nekoSelect || null;

        const icons = options.icons || {};
        const labels = options.labels || {};
        const root = document.createElement('div');
        const trigger = document.createElement('button');
        const menu = document.createElement('div');
        const iconEl = document.createElement('i');
        const iconClassName = (token) => `${String(token || '').startsWith('tb-') ? 'tb' : 'ph'} ${token || 'ph-list'}`;
        const valueLabel = document.createElement('span');
        const caret = document.createElement('i');

        root.className = 'neko-select';
        trigger.type = 'button';
        trigger.className = 'neko-select-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        menu.className = 'neko-select-menu';
        menu.setAttribute('role', 'listbox');
        iconEl.className = 'ph neko-select-leading';
        valueLabel.className = 'neko-select-value';
        caret.className = 'ph ph-caret-down neko-select-caret';

        trigger.append(iconEl, valueLabel, caret);
        root.append(trigger, menu);
        select.classList.add('neko-select-source');
        select.setAttribute('aria-hidden', 'true');
        select.tabIndex = -1;
        select.insertAdjacentElement('afterend', root);

        const close = () => {
            root.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
        };
        const open = () => {
            document.querySelectorAll('.neko-select.open').forEach((item) => {
                if (item !== root) item.classList.remove('open');
            });
            root.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
        };
        const sync = () => {
            const selected = select.options[select.selectedIndex] || select.options[0];
            const value = selected?.value || '';
            valueLabel.textContent = labels[value] || selected?.textContent || '';
            iconEl.className = `${iconClassName(icons[value] || options.defaultIcon || 'ph-list')} neko-select-leading`;
            menu.querySelectorAll('[data-value]').forEach((item) => {
                const active = item.dataset.value === value;
                item.classList.toggle('active', active);
                item.setAttribute('aria-selected', active ? 'true' : 'false');
            });
        };
        const render = () => {
            menu.innerHTML = '';
            Array.from(select.options).forEach((option) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'neko-select-option';
                item.dataset.value = option.value;
                item.setAttribute('role', 'option');
                item.innerHTML = `<i class="${iconClassName(icons[option.value] || options.defaultIcon || 'ph-circle')}"></i><span></span>`;
                item.querySelector('span').textContent = labels[option.value] || option.textContent;
                item.addEventListener('click', () => {
                    select.value = option.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    sync();
                    close();
                });
                menu.appendChild(item);
            });
            sync();
        };

        trigger.addEventListener('click', (event) => {
            event.preventDefault();
            root.classList.contains('open') ? close() : open();
        });
        trigger.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                close();
                return;
            }
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                root.classList.contains('open') ? close() : open();
            }
        });
        select.addEventListener('change', sync);
        document.addEventListener('click', (event) => {
            if (!root.contains(event.target)) close();
        });

        render();
        select._nekoSelect = { root, trigger, menu, render, sync, close, open };
        return select._nekoSelect;
    }

    window._nekoUIHelpers = {
        ...(window._nekoUIHelpers || {}),
        setExpandableSectionState,
        setViewStackState,
        applyUIFontProfile,
        resolveUIFontProfile,
        normalizeServiceHealthCheckCopy,
        setButtonBusy,
        enhanceSelect,
    };
})();
