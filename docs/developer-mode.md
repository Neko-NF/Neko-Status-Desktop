# Developer Mode Design

Developer Mode is a global diagnostic mode for frontend UIUX inspection and backend status debugging. It is not the Developer Console and does not execute arbitrary user input.

## Scope

- State is persisted through the existing config IPC key `debugEnabled`.
- The UIUX guide layer state is persisted through `developerUiInspectEnabled`.
- The UIUX hidden/pre-rendered layer scan option is persisted through `developerUiInspectIncludeHidden`.
- Renderer code uses the existing service/client path only: page/component -> renderer service -> `IpcClient` -> preload bridge -> main IPC.
- The mode never concatenates JavaScript, shell commands, PowerShell commands, or dynamic IPC channel names.

## Frontend Design

- Main-window runtime module: `src/renderer/js/components/developer-mode.js`
- External sidecar window: `src/renderer/developer-mode-panel.html` + `src/renderer/js/developer-mode-panel.js`
- Style layer: `src/renderer/css/components.css`
- Load point: `src/renderer/index.html`, after `developer-console.js` and before `app.js` / `app-ipc.js`
- Injection point: `src/renderer/js/app-ipc.js`

Developer Mode is opened from Settings, not from dashboard quick actions. The UIUX guide switch is gated by Developer Mode: if Developer Mode is off, UIUX guide requests are rejected, the config is kept off, and the UI shows a warning.

Developer Mode opens an independent Electron sidecar window when enabled. The sidecar is positioned outside the main software interface and attached to the right edge of the main window by the main process. The main app window keeps its own content size; it is not padded, squeezed, or covered by the Developer Mode menu.

The sidecar is a controlled frameless tool window. It does not expose the Windows title bar or system close button, cannot be moved away from the main window by dragging, cannot be resized by the mouse, and keeps its height synchronized to the main window. Closing Developer Mode must go through the in-app Settings switch or the sidecar's own internal close control, which updates `debugEnabled` before the sidecar is destroyed.

The main renderer keeps only the UIUX inspection guide layer. The external sidecar window owns the Developer Mode menu, backend snapshot UI, selected-element details, and copy buttons. The two windows communicate through whitelisted `dev:modePanel:*` IPC channels and `dev:modePanel:*` events.

The sidecar receives the main window's current theme mode and core CSS variables through the panel state payload, so theme color, semantic colors, text colors, and UI font follow the main application.

The sidecar provides:

- UIUX 辅助线: scans visible interactive/layout elements and draws guide boxes.
- 后端状态: refreshes a backend snapshot using existing clients.
- 重新扫描: redraws guide boxes after layout changes.

The UIUX guide layer highlights targets such as buttons, links, inputs, cards, page sections, open modals, toggles, charts, and navigation items. By default it scans visually visible UI only. Pre-rendered but closed dialogs are valid application structure, and developers can explicitly enable "include hidden layers" from the sidecar when they need to inspect those DOM nodes. Hovering a guide box shows a preview. Clicking a guide box resolves the topmost visible element at that screen point before locking the selection, so overlapped guide boxes follow the visual stacking order instead of DOM scan order. The locked selection exposes copy buttons for each locator field:

- code-facing name
- selector
- role/type
- nearest owner/page
- source file hint
- rendered size
- CSS layer features such as position, z-index, transition, animation, mask, backdrop filter, and overflow

The locked details panel must use text-only values and `navigator.clipboard.writeText()` with a DOM fallback. It must not write HTML from inspected element data.

Runtime source hints are inferred from stable DOM ownership. For exact source mapping, future components should add stable `data-dev-name` or `data-component` attributes.

## Backend Debug Snapshot

Developer Mode does not add a new IPC channel yet. It aggregates existing safe capabilities:

- `config:get` / `config:getAll`
- `app:getVersion`
- `service:isRunning`
- `service:getProcessInfo`
- `system:metrics`
- `cache:getSize`
- optional `api:testConnection`

The sidecar window adds these controlled IPC entries:

- `dev:modePanel:open`
- `dev:modePanel:close`
- `dev:modePanel:command`
- `dev:modePanel:state`

If a future feature needs a single atomic snapshot from main, add or extend a dedicated `dev:*` IPC contract through:

1. `src/shared/ipc-contracts.js`
2. `src/shared/schemas.js` if payload validation is needed
3. `src/main/ipc/*.ipc.js`
4. `src/preload/index.js`
5. `src/renderer/js/services/*`
6. renderer component/page
7. unit tests and this document

## Entry Points

Settings exposes two switches:

- Developer Mode
- UIUX Guide

The UIUX Guide switch does not enable Developer Mode automatically. Developers must enable Developer Mode first, then enable the UIUX Guide.

Settings keeps the UIUX Guide row collapsed while Developer Mode is off. The sidecar exposes the additional "include hidden layers" switch only after Developer Mode is active.

## Testing

Covered by `tests/unit/renderer-services.test.js`:

- metadata extraction without direct IPC access
- config key ownership through `debugEnabled`
- source hint and CSS feature reporting

Recommended manual check:

1. Start the app.
2. Open Settings and enable Developer Mode.
3. Confirm the Developer Mode menu appears as a separate window attached to the right of the main window.
4. Enable UIUX Guide from Settings or the right-side sidecar.
5. Hover visible UI elements and verify guide boxes and metadata stay aligned with the main app.
6. Press Backend in the sidecar and confirm IPC-backed status updates.
