# Changelog

All notable project-level changes are tracked here. Keep `release_notes.txt` as the draft for the next GitHub Release, and move durable release history into this file after publishing.

## Unreleased

## 1.5.0-beta.3 - 2026-08-01

- Added resilient desktop refresh sessions, cached-account offline state, encrypted credential migration, atomic configuration recovery, and indefinite weak-network status-report recovery without consuming internal watchdog restart limits.
- Added the default-off, anomaly-only Software Improvement Program with versioned feature contributions, dual redaction, bounded/deduplicated offline queue, capability negotiation and CI contract gates.
- Added explicit tray/window exit outbox delivery and runtime-session-aware dashboard disconnect reasons, plus Android OpenAPI/DTO/capability placeholders without enabling mobile collection or upload.

## 1.5.0-beta.2 - 2026-07-26

- Made the optional personal Gitea Git-ref sync non-blocking so a temporary distribution-server outage cannot prevent GitHub from building and publishing a verified beta release.

## 1.5.0-beta.1 - 2026-07-26

- Added the experimental quiet appearance profile with persistent, gated selection, startup-safe local mirroring, classic fallback controls, and synchronized main-window, popup, startup-update, and developer-panel styling.
- Reworked the desktop visual system across dashboard, Activity, announcements, authentication, settings, updates, streaming, screenshot, service, and device-status views with local icon assets, stronger focus semantics, responsive navigation, and local avatar fallbacks.
- Stabilized CPU and memory trends by retaining Chart instances, using fixed time buckets, updating only the active bucket, preserving no-animation refreshes, and removing chart-area grid lines.
- Added bounded, stable scrolling for search, application visibility, followers, blacklists, complex rules, announcement, history, and health-result lists; independent content cards now top-align without stretching their neighbours.
- Updated UI Lab to default to an appearance preview and activate curve feedback only in its dedicated tab; added quiet-profile chart styling and appearance controls.
- Made announcement and other dynamic list rendering preserve scroll position, selection, and keyboard focus while applying bounded enter, exit, and reorder motion that respects reduced-motion preferences.
- Added visual regression infrastructure, baselines, scale/theme/reduced-motion coverage, and CI artifact upload for the UI matrix; expanded unit coverage for appearance gating, trend stability, list behaviour, accessibility, and rendering fallbacks.

## 1.4.1 - 2026-07-15

- Reworked Activity connection health reporting around independent local IPC, receiver, publisher, provisioning, and lifecycle states, with stable degraded and recovery feedback instead of a single flickering connection flag.
- Fixed Activity API redirect, HTML, unsupported-route, credential, throttling, and transient-error classification; added bounded SSE recovery, polling fallback, heartbeat tracking, cursor reset handling, and retry backoff.
- Fixed hidden or locally detected applications being presented as actively shared; the client now reports an application as shared only after the server confirms an active Presence state.
- Added stable per-installation Activity identity for development and production channels, improved re-enrollment and account/server switching cleanup, and prevented Activity-only devices from appearing as unknown status-reporting devices.
- Redesigned the Activity page with a persistent service-status card, clearer per-capability feedback, actionable diagnostics, accessible status announcements, safer settings transactions, and explicit partial-data failure states.
- Improved update installation coordination so the background Activity agent must exit cleanly before the installer is launched.
- Expanded Native Agent, IPC, authentication lifecycle, renderer, update, smoke, and packaged-resource validation coverage.

## 1.4.0 - 2026-06-22

- Added the opt-in experimental following activity module with per-app publishing, follow rules, privacy controls, Windows notifications, and optional application-window snapshots.
- Added the standalone Rust presence agent with scoped credentials, SSE/polling event delivery, background operation, tray handoff, and update-safe lifecycle management.
- Added the optional mathematical-curve loading system and UI Lab, with shared scheduling, reduced-motion fallbacks, and independently controlled experimental entries.
- Standardized loading and button-busy feedback across startup, updates, announcements, settings, authentication, service, and activity flows.
- Updated the default production service endpoint to `https://nekostatus.koirin.com`.
- Improved cleanup when signing out, switching servers, disabling experiments, updating, or uninstalling.

## 1.3.0-beta.3 - 2026-05-31
 
- Added screenshot compression and optimization core algorithm, supporting configuration of resolution, format selection (JPEG/PNG/auto), target/max bytes, and resolution scaling bounds.
- Added Visual CSS token visual parameter tuning (card/button border-radius, font scaling, opacity) in Developer Mode with persistence.
- Added live screenshot compression debugging and computed styles inspect details (rounded borders, line height, margins, padding, gap, background colors) in Developer Mode.
- Optimized app-theme color picker with real-time swatch preview.
- Optimized autostart registration and Windows shortcut creation to reduce AV false positives.
- Fixed Developer Mode UI positioning and misalignment.
- Added comprehensive unit tests and verify script static scans for screenshot tuning.
 
## 1.2.11 - 2026-05-20

- Fixed update installer relaunch after installing a new version.
- Fixed Windows taskbar identity and icon handling for dev and packaged builds.
- Fixed config loading for users upgrading from older app-name storage paths.

## 1.2.9 - 2026-05-19

- Added personal repository update source support and synchronized GitHub/Gitea release publishing.
- Improved update center repository diagnostics, speed estimation, loading feedback, and source-specific UI states.

## 1.2.6 - 2026-05-17

- Continued the Electron team-readiness refactor with shared IPC contracts, preload-mediated renderer access, and modular main-process IPC registration.
- Added stronger IPC payload validation for auth, config, stream, and update-related flows.
- Expanded Node test coverage for API IPC, config IPC, IPC index exports, schemas, auth IPC, service IPC, stream IPC, system IPC, and update IPC.
- Kept Windows build and release workflows aligned with the documented release process.
