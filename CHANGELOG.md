# Changelog

All notable project-level changes are tracked here. Keep `release_notes.txt` as the draft for the next GitHub Release, and move durable release history into this file after publishing.

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
