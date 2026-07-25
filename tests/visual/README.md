# Electron visual regression tests

The harness loads the production `src/renderer/index.html` in a hidden Electron
`BrowserWindow`. A deterministic preload supplies local fixture data; no
network, account, service, or OS state is read.

Commands:

```powershell
npm run test:visual
npm run test:visual:update
npm run test:visual -- --ci-smoke
```

`test:visual:update` refreshes the Windows PNG baselines. Normal runs compare
pixels with a per-channel tolerance and fail when more than 1% of pixels differ.
Failures write `actual` and `diff` PNG files to `tests/visual/artifacts/`.

The full run also checks the 1180x700, 1280x840, and 1600x900 viewports in both
themes, 80/125/150/200 percent zoom, normal/reduced motion, horizontal overflow,
top-bar occlusion, activity-card alignment, busy-button geometry, announcement
CLS/state preservation, per-route scroll restoration, and disclosure timing.
It also captures the quiet profile in light/dark mode for dashboard, activity
sharing, settings, and UI Lab, verifies that trend grids stay disabled, and
checks bounded scrolling/counts for long follows, apps, followers, and blocks.
