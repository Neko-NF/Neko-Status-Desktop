# Changelog

All notable project-level changes are tracked here. Keep `release_notes.txt` as the draft for the next GitHub Release, and move durable release history into this file after publishing.

## 1.2.9 - 2026-05-19

- Added personal repository update source support and synchronized GitHub/Gitea release publishing.
- Improved update center repository diagnostics, speed estimation, loading feedback, and source-specific UI states.

## 1.2.6 - 2026-05-17

- Continued the Electron team-readiness refactor with shared IPC contracts, preload-mediated renderer access, and modular main-process IPC registration.
- Added stronger IPC payload validation for auth, config, stream, and update-related flows.
- Expanded Node test coverage for API IPC, config IPC, IPC index exports, schemas, auth IPC, service IPC, stream IPC, system IPC, and update IPC.
- Kept Windows build and release workflows aligned with the documented release process.
