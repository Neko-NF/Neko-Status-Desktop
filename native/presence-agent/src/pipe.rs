#![cfg(windows)]

use crate::{
    config::{clear_activity_identity, pipe_name, protect_token, save_profile, AgentProfile},
    detector::Transition,
    runtime::RuntimeState,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    ffi::c_void,
    fs::File,
    io::{Read, Write},
    os::windows::io::FromRawHandle,
    ptr,
    sync::{atomic::Ordering, Arc},
};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, LocalFree, ERROR_PIPE_CONNECTED, INVALID_HANDLE_VALUE,
    },
    Security::{
        Authorization::{
            ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
            SDDL_REVISION_1,
        },
        GetTokenInformation, TokenUser, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::PIPE_ACCESS_DUPLEX,
    System::Pipes::{
        ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe, PIPE_READMODE_BYTE,
        PIPE_TYPE_BYTE, PIPE_WAIT,
    },
    System::Threading::{GetCurrentProcess, OpenProcessToken},
};

const MAX_FRAME: usize = 64 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Command {
    protocol_version: u32,
    command: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentProfilePatch {
    protocol_version: Option<u32>,
    server_url: Option<String>,
    device_id: Option<i64>,
    device_name: Option<String>,
    user_id: Option<i64>,
    main_executable: Option<String>,
    feature_enabled: Option<bool>,
    publish_enabled: Option<bool>,
    background_enabled: Option<bool>,
    auto_start_enabled: Option<bool>,
    notifications_enabled: Option<bool>,
    snapshot_enabled: Option<bool>,
    snapshot_max_bytes: Option<usize>,
    snapshot_max_width: Option<u32>,
    snapshot_max_height: Option<u32>,
    snapshot_cache_dir: Option<String>,
    snapshot_privacy_block_all: Option<bool>,
    snapshot_blocked_processes: Option<Vec<String>>,
    agent_token: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct Reply {
    ok: bool,
    data: Value,
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

struct PipeSecurity {
    attributes: SECURITY_ATTRIBUTES,
    descriptor: *mut c_void,
}

impl Drop for PipeSecurity {
    fn drop(&mut self) {
        if !self.descriptor.is_null() {
            unsafe {
                LocalFree(self.descriptor as _);
            }
        }
    }
}

fn current_user_pipe_security() -> std::io::Result<PipeSecurity> {
    let mut token = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let mut required = 0u32;
    unsafe {
        GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut required);
    }
    let mut buffer = vec![0u8; required as usize];
    if unsafe {
        GetTokenInformation(
            token,
            TokenUser,
            buffer.as_mut_ptr() as *mut c_void,
            required,
            &mut required,
        )
    } == 0
    {
        unsafe {
            CloseHandle(token);
        }
        return Err(std::io::Error::last_os_error());
    }
    unsafe {
        CloseHandle(token);
    }
    let token_user = unsafe { &*(buffer.as_ptr() as *const TOKEN_USER) };
    let mut sid_text = ptr::null_mut();
    if unsafe { ConvertSidToStringSidW(token_user.User.Sid, &mut sid_text) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    let mut length = 0usize;
    unsafe {
        while *sid_text.add(length) != 0 {
            length += 1;
        }
    }
    let sid = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(sid_text, length) });
    unsafe {
        LocalFree(sid_text as _);
    }

    // Protected DACL: only the current interactive Windows user receives full pipe access.
    let sddl = wide(&format!("D:P(A;;GA;;;{sid})"));
    let mut descriptor = ptr::null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            ptr::null_mut(),
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error());
    }
    Ok(PipeSecurity {
        attributes: SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        },
        descriptor,
    })
}

fn read_frame(file: &mut File) -> std::io::Result<Vec<u8>> {
    let mut length = [0u8; 4];
    file.read_exact(&mut length)?;
    let length = u32::from_le_bytes(length) as usize;
    if length == 0 || length > MAX_FRAME {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "invalid frame length",
        ));
    }
    let mut payload = vec![0u8; length];
    file.read_exact(&mut payload)?;
    Ok(payload)
}

fn write_reply(file: &mut File, reply: &Reply) -> std::io::Result<()> {
    let bytes = serde_json::to_vec(reply).map_err(std::io::Error::other)?;
    file.write_all(&(bytes.len() as u32).to_le_bytes())?;
    file.write_all(&bytes)?;
    file.flush()
}

pub fn run_pipe_server(state: Arc<RuntimeState>) {
    while state.should_run() {
        let name = wide(pipe_name());
        let security = match current_user_pipe_security() {
            Ok(security) => security,
            Err(_) => {
                std::thread::sleep(std::time::Duration::from_secs(1));
                continue;
            }
        };
        let handle = unsafe {
            CreateNamedPipeW(
                name.as_ptr(),
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                1,
                MAX_FRAME as u32,
                MAX_FRAME as u32,
                1000,
                &security.attributes,
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            std::thread::sleep(std::time::Duration::from_secs(1));
            continue;
        }
        let connected = unsafe {
            ConnectNamedPipe(handle, ptr::null_mut()) != 0 || GetLastError() == ERROR_PIPE_CONNECTED
        };
        if !connected {
            unsafe {
                DisconnectNamedPipe(handle);
            }
            continue;
        }
        state.client_connected.store(true, Ordering::Relaxed);
        let mut file = unsafe { File::from_raw_handle(handle as _) };
        while state.should_run() {
            let Ok(bytes) = read_frame(&mut file) else {
                break;
            };
            let parsed: Result<Command, _> = serde_json::from_slice(&bytes);
            let reply = match parsed {
                Ok(command) if command.protocol_version == 1 => handle_command(&state, command),
                Ok(_) => Reply {
                    ok: false,
                    data: json!({"code":"UNSUPPORTED_PROTOCOL"}),
                },
                Err(error) => Reply {
                    ok: false,
                    data: json!({"code":"INVALID_COMMAND","message":error.to_string()}),
                },
            };
            if write_reply(&mut file, &reply).is_err() {
                break;
            }
        }
        state.client_connected.store(false, Ordering::Relaxed);
        state.tray_claimed.store(false, Ordering::Relaxed);
        let background = state.profile.read().unwrap().background_enabled;
        if !background {
            state.shutdown.store(true, Ordering::Relaxed);
        }
    }
}

pub fn send_shutdown_for_update() -> std::io::Result<()> {
    send_shutdown("update")
}

pub fn send_shutdown(reason: &str) -> std::io::Result<()> {
    use std::fs::OpenOptions;
    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(pipe_name())?;
    let command = serde_json::to_vec(&json!({
        "protocolVersion": 1,
        "command": "shutdown",
        "payload": { "reason": reason }
    }))
    .map_err(std::io::Error::other)?;
    file.write_all(&(command.len() as u32).to_le_bytes())?;
    file.write_all(&command)?;
    file.flush()?;
    let reply: Reply =
        serde_json::from_slice(&read_frame(&mut file)?).map_err(std::io::Error::other)?;
    if reply.ok {
        Ok(())
    } else {
        Err(std::io::Error::other(
            reply
                .data
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("AGENT_SHUTDOWN_REJECTED"),
        ))
    }
}

fn handle_command(state: &Arc<RuntimeState>, command: Command) -> Reply {
    match command.command.as_str() {
        "hello" | "get_status" => Reply {
            ok: true,
            data: status_json(state),
        },
        "claim_tray" => {
            state.tray_claimed.store(true, Ordering::Relaxed);
            for _ in 0..40 {
                if !state.tray_visible.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Reply {
                ok: true,
                data: json!({
                    "claimed": true,
                    "trayRemoved": !state.tray_visible.load(Ordering::Relaxed)
                }),
            }
        }
        "release_tray" => {
            state.tray_claimed.store(false, Ordering::Relaxed);
            Reply {
                ok: true,
                data: json!({"claimed":false}),
            }
        }
        "pause" => {
            state.paused.store(true, Ordering::Relaxed);
            state.config_changed();
            state.receiver_changed();
            Reply {
                ok: true,
                data: status_json(state),
            }
        }
        "resume" => {
            state.paused.store(false, Ordering::Relaxed);
            state.config_changed();
            state.receiver_changed();
            Reply {
                ok: true,
                data: status_json(state),
            }
        }
        "shutdown" => {
            let reason = command
                .payload
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("session");
            state.shutdown.store(true, Ordering::Relaxed);
            let previous = state.profile.read().unwrap().clone();
            crate::network::send_terminal_presence_best_effort(&previous);
            if revokes_identity(reason) {
                let mut profile = state.profile.write().unwrap();
                clear_activity_identity(&mut profile);
                let snapshot = profile.clone();
                if let Err(error) = save_profile(&snapshot) {
                    return Reply {
                        ok: false,
                        data: json!({
                            "code":"PROFILE_SAVE_FAILED",
                            "message":error.to_string(),
                            "shuttingDown":true,
                            "reason":reason
                        }),
                    };
                }
                drop(profile);
                let _ = crate::startup::sync_autostart(&snapshot);
                crate::network::purge_private_cache(&snapshot);
            }
            Reply {
                ok: true,
                data: json!({"shuttingDown":true,"reason":reason}),
            }
        }
        "provision" | "reload_config" => provision(state, command.payload),
        "retry_now" => {
            state.config_changed();
            state.receiver_changed();
            Reply {
                ok: true,
                data: status_json(state),
            }
        }
        _ => Reply {
            ok: false,
            data: json!({"code":"UNKNOWN_COMMAND"}),
        },
    }
}

fn revokes_identity(reason: &str) -> bool {
    matches!(
        reason,
        "disable" | "logout" | "account_change" | "credential_invalid" | "server_change"
    )
}

fn merge_profile_patch(
    current: &AgentProfile,
    mut patch: AgentProfilePatch,
) -> (AgentProfile, bool, Option<String>) {
    let mut next = current.clone();
    let identity_changed = patch
        .server_url
        .as_ref()
        .is_some_and(|value| value != &current.server_url)
        || patch.user_id.is_some_and(|value| value != current.user_id)
        || patch
            .device_id
            .is_some_and(|value| value != current.device_id);
    if let Some(value) = patch.protocol_version {
        next.protocol_version = value;
    }
    if let Some(value) = patch.server_url {
        next.server_url = value;
    }
    if let Some(value) = patch.device_id {
        next.device_id = value;
    }
    if let Some(value) = patch.device_name {
        next.device_name = value;
    }
    if let Some(value) = patch.user_id {
        next.user_id = value;
    }
    if let Some(value) = patch.main_executable {
        next.main_executable = value;
    }
    if let Some(value) = patch.feature_enabled {
        next.feature_enabled = value;
    }
    if let Some(value) = patch.publish_enabled {
        next.publish_enabled = value;
    }
    if let Some(value) = patch.background_enabled {
        next.background_enabled = value;
    }
    if let Some(value) = patch.auto_start_enabled {
        next.auto_start_enabled = value;
    }
    if let Some(value) = patch.notifications_enabled {
        next.notifications_enabled = value;
    }
    if let Some(value) = patch.snapshot_enabled {
        next.snapshot_enabled = value;
    }
    if let Some(value) = patch.snapshot_max_bytes {
        next.snapshot_max_bytes = value;
    }
    if let Some(value) = patch.snapshot_max_width {
        next.snapshot_max_width = value;
    }
    if let Some(value) = patch.snapshot_max_height {
        next.snapshot_max_height = value;
    }
    if let Some(value) = patch.snapshot_cache_dir {
        next.snapshot_cache_dir = value;
    }
    if let Some(value) = patch.snapshot_privacy_block_all {
        next.snapshot_privacy_block_all = value;
    }
    if let Some(value) = patch.snapshot_blocked_processes {
        next.snapshot_blocked_processes = value;
    }
    let token = patch.agent_token.take();
    (next, identity_changed, token)
}

fn provision(state: &Arc<RuntimeState>, payload: Value) -> Reply {
    let patch: AgentProfilePatch = match serde_json::from_value(payload) {
        Ok(patch) => patch,
        Err(error) => {
            return Reply {
                ok: false,
                data: json!({"code":"INVALID_PROFILE","message":error.to_string()}),
            }
        }
    };
    let current = state.profile.read().unwrap().clone();
    let (mut next, identity_changed, token) = merge_profile_patch(&current, patch);
    let token_changed = token.is_some();
    let receiver_switch_changed = current.feature_enabled != next.feature_enabled;
    if let Some(token) = token {
        if token.trim().is_empty() {
            return Reply {
                ok: false,
                data: json!({"code":"INVALID_PROFILE","message":"agentToken cannot be empty"}),
            };
        }
        match protect_token(&token) {
            Ok(encrypted) => next.encrypted_agent_token = encrypted,
            Err(error) => {
                return Reply {
                    ok: false,
                    data: json!({"code":"DPAPI_FAILED","message":error.to_string()}),
                }
            }
        }
    }
    // eventCursor and encryptedAgentToken are Agent-owned fields. Normal config reloads
    // preserve both; only a real server/account/device/credential change resets the cursor.
    if identity_changed || token_changed {
        next.event_cursor = "0".into();
        next.recent_event_ids.clear();
    }
    if identity_changed && !token_changed {
        next.encrypted_agent_token.clear();
    }
    let mut current_profile = state.profile.write().unwrap();
    if !identity_changed && !token_changed {
        // Rebase fields owned by the network loop in case an event arrived while the
        // Client was preparing this config patch.
        next.encrypted_agent_token = current_profile.encrypted_agent_token.clone();
        next.event_cursor = current_profile.event_cursor.clone();
        next.recent_event_ids = current_profile.recent_event_ids.clone();
    }
    if let Err(error) = save_profile(&next) {
        return Reply {
            ok: false,
            data: json!({"code":"PROFILE_SAVE_FAILED","message":error.to_string()}),
        };
    }
    *current_profile = next.clone();
    if identity_changed || token_changed {
        state.network_identity_changed();
    } else {
        state.config_changed();
        if receiver_switch_changed {
            state.receiver_changed();
        }
    }
    drop(current_profile);
    if identity_changed || token_changed {
        state.reset_network_health(&next);
    } else {
        state.sync_profile_switch_health(&current, &next);
    }
    let _ = crate::startup::sync_autostart(&state.profile.read().unwrap());
    Reply {
        ok: true,
        data: status_json(state),
    }
}

fn status_json(state: &Arc<RuntimeState>) -> Value {
    let profile = state.profile.read().unwrap().clone();
    let memory_bytes = process_memory_bytes();
    let latest_detected_app =
        state
            .latest_transition
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|transition| match transition {
                Transition::Active {
                    process_name,
                    stable_since_ms,
                    kind,
                } => Some(json!({
                    "appKey": format!("win32:{process_name}"),
                    "processName": process_name,
                    "displayName": process_name.strip_suffix(".exe").unwrap_or(process_name),
                    "stableSinceMs": stable_since_ms,
                    "detectorKind": kind.as_str(),
                })),
                Transition::Idle { .. } => None,
            });
    let receiver = state.receiver_health();
    let publisher = state.publisher_health();
    let provision_state = if profile.encrypted_agent_token.is_empty() {
        "needs_enroll"
    } else if receiver.state == "credential_error" || publisher.state == "credential_error" {
        "credential_error"
    } else {
        "ready"
    };
    let lifecycle = if state.paused.load(Ordering::Relaxed) {
        "paused"
    } else if state.launched_background.load(Ordering::Relaxed) {
        "background"
    } else {
        "embedded"
    };
    json!({
        "schemaVersion": 2,
        "revision": state.health_revision(),
        "observedAtMs": crate::win32::unix_ms(),
        "protocolVersion": 1,
        "agentVersion": env!("CARGO_PKG_VERSION"),
        "pid": std::process::id(),
        "memoryBytes": memory_bytes,
        "paused": state.paused.load(Ordering::Relaxed),
        "backgroundEnabled": profile.background_enabled,
        "autoStartEnabled": profile.auto_start_enabled,
        "publishEnabled": profile.publish_enabled,
        "snapshotEnabled": profile.snapshot_enabled,
        "provisioned": !profile.encrypted_agent_token.is_empty(),
        "connection": state.legacy_connection(),
        "trayClaimed": state.tray_claimed.load(Ordering::Relaxed),
        "latestDetectedApp": latest_detected_app,
        "health": {
            "overall": state.overall_health(),
            "lifecycle": lifecycle,
            "localIpc": {
                "state": if state.client_connected.load(Ordering::Relaxed) { "connected" } else { "disconnected" },
                "attempt": 0,
                "sinceMs": null,
                "nextRetryAtMs": null,
                "lastError": null,
            },
            "provision": {
                "state": provision_state,
                "deviceConfigured": profile.device_id > 0,
                "boundToCurrentUser": profile.user_id > 0,
            },
            "receiver": receiver,
            "publisher": publisher,
        },
    })
}

fn process_memory_bytes() -> usize {
    use windows_sys::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS,
    };
    let mut counters: PROCESS_MEMORY_COUNTERS = unsafe { std::mem::zeroed() };
    counters.cb = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    if unsafe { GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) } != 0 {
        counters.WorkingSetSize
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::{
        current_user_pipe_security, handle_command, merge_profile_patch, revokes_identity,
        status_json, AgentProfilePatch, Command,
    };
    use crate::{
        config::{clear_activity_identity, AgentProfile},
        runtime::{ActivityError, RuntimeState},
    };
    use serde_json::{json, Value};
    use std::sync::{atomic::Ordering, Arc};

    #[test]
    fn current_user_pipe_security_can_be_created() {
        let security = current_user_pipe_security().expect("pipe security should be created");
        assert!(!security.attributes.lpSecurityDescriptor.is_null());
        assert_eq!(security.attributes.bInheritHandle, 0);
    }

    #[test]
    fn pause_and_resume_commands_update_runtime_state() {
        let state = Arc::new(RuntimeState::new(AgentProfile::default()));
        let pause = handle_command(
            &state,
            Command {
                protocol_version: 1,
                command: "pause".into(),
                payload: json!({}),
            },
        );
        assert!(pause.ok);
        assert!(state.paused.load(Ordering::Relaxed));

        let resume = handle_command(
            &state,
            Command {
                protocol_version: 1,
                command: "resume".into(),
                payload: json!({}),
            },
        );
        assert!(resume.ok);
        assert!(!state.paused.load(Ordering::Relaxed));
    }

    #[test]
    fn unknown_command_is_rejected() {
        let state = Arc::new(RuntimeState::new(AgentProfile::default()));
        let reply = handle_command(
            &state,
            Command {
                protocol_version: 1,
                command: "run_shell".into(),
                payload: json!({}),
            },
        );
        assert!(!reply.ok);
        assert_eq!(
            reply.data.get("code").and_then(|value| value.as_str()),
            Some("UNKNOWN_COMMAND")
        );
    }

    #[test]
    fn status_exposes_v2_health_without_removing_legacy_connection() {
        let profile = AgentProfile {
            feature_enabled: true,
            encrypted_agent_token: "protected".into(),
            device_id: 42,
            user_id: 7,
            ..AgentProfile::default()
        };
        let state = Arc::new(RuntimeState::new(profile));
        state.client_connected.store(true, Ordering::Relaxed);
        state.update_receiver(|health| health.state = "polling".into());
        let value = status_json(&state);
        assert_eq!(value.get("schemaVersion").and_then(|v| v.as_u64()), Some(2));
        assert_eq!(
            value.get("connection").and_then(|v| v.as_str()),
            Some("polling")
        );
        assert_eq!(
            value
                .pointer("/health/provision/state")
                .and_then(|v| v.as_str()),
            Some("ready")
        );
        assert_eq!(
            value
                .pointer("/health/receiver/state")
                .and_then(|v| v.as_str()),
            Some("polling")
        );
    }

    #[test]
    fn successful_reprovision_clears_previous_credential_errors_before_reply() {
        let initial = AgentProfile {
            feature_enabled: true,
            publish_enabled: true,
            encrypted_agent_token: "old-protected-token".into(),
            device_id: 42,
            user_id: 7,
            ..AgentProfile::default()
        };
        let state = Arc::new(RuntimeState::new(initial.clone()));
        state.update_receiver(|health| {
            health.state = "credential_error".into();
            health.consecutive_failures = 4;
            health.next_retry_at_ms = Some(99_999);
            health.last_error = Some(ActivityError::new(
                "CREDENTIAL_INVALID",
                "old token was rejected",
                Some(401),
                false,
            ));
        });
        state.update_publisher(|health| {
            health.state = "credential_error".into();
            health.consecutive_failures = 2;
            health.next_retry_at_ms = Some(88_888);
            health.last_error = Some(ActivityError::new(
                "CREDENTIAL_INVALID",
                "old token was rejected",
                Some(401),
                false,
            ));
        });

        let reprovisioned = AgentProfile {
            encrypted_agent_token: "new-protected-token".into(),
            ..initial
        };
        *state.profile.write().unwrap() = reprovisioned.clone();
        state.network_identity_changed();
        state.reset_network_health(&reprovisioned);

        let value = status_json(&state);
        assert_eq!(
            value
                .pointer("/health/provision/state")
                .and_then(Value::as_str),
            Some("ready")
        );
        assert_eq!(
            value
                .pointer("/health/receiver/state")
                .and_then(Value::as_str),
            Some("connecting")
        );
        assert_eq!(
            value
                .pointer("/health/publisher/state")
                .and_then(Value::as_str),
            Some("idle")
        );
        assert_eq!(
            value.pointer("/health/receiver/consecutiveFailures"),
            Some(&json!(0))
        );
        assert_eq!(
            value.pointer("/health/receiver/lastError"),
            Some(&Value::Null)
        );
        assert_eq!(
            value.pointer("/health/publisher/lastError"),
            Some(&Value::Null)
        );
    }

    #[test]
    fn retry_now_only_advances_network_generation() {
        let state = Arc::new(RuntimeState::new(AgentProfile::default()));
        let before = state.config_revision();
        let reply = handle_command(
            &state,
            Command {
                protocol_version: 1,
                command: "retry_now".into(),
                payload: json!({}),
            },
        );
        assert!(reply.ok);
        assert!(state.config_revision() > before);
        assert!(state
            .profile
            .read()
            .unwrap()
            .encrypted_agent_token
            .is_empty());
    }

    #[test]
    fn ordinary_reload_preserves_agent_owned_token_and_cursor() {
        let current = AgentProfile {
            publish_enabled: true,
            encrypted_agent_token: "dpapi-ciphertext".into(),
            event_cursor: "event-99".into(),
            recent_event_ids: vec!["event-98".into(), "event-99".into()],
            ..AgentProfile::default()
        };
        let patch: AgentProfilePatch = serde_json::from_value(json!({
            "publishEnabled": false,
            "eventCursor": "0",
            "encryptedAgentToken": "untrusted"
        }))
        .unwrap();
        let (next, identity_changed, token) = merge_profile_patch(&current, patch);
        assert!(!identity_changed);
        assert!(token.is_none());
        assert!(!next.publish_enabled);
        assert_eq!(next.encrypted_agent_token, "dpapi-ciphertext");
        assert_eq!(next.event_cursor, "event-99");
        assert_eq!(next.recent_event_ids, ["event-98", "event-99"]);
    }

    #[test]
    fn only_identity_revoking_shutdown_reasons_clear_binding() {
        for reason in [
            "disable",
            "logout",
            "account_change",
            "credential_invalid",
            "server_change",
        ] {
            assert!(revokes_identity(reason));
        }
        assert!(!revokes_identity("session"));
        assert!(!revokes_identity("update"));

        let mut profile = AgentProfile {
            feature_enabled: true,
            publish_enabled: true,
            snapshot_enabled: true,
            background_enabled: true,
            auto_start_enabled: true,
            encrypted_agent_token: "ciphertext".into(),
            event_cursor: "event-42".into(),
            recent_event_ids: vec!["event-42".into()],
            user_id: 7,
            device_id: 9,
            device_name: "old binding".into(),
            ..AgentProfile::default()
        };
        clear_activity_identity(&mut profile);
        assert!(!profile.feature_enabled);
        assert!(!profile.publish_enabled);
        assert!(!profile.snapshot_enabled);
        assert!(profile.encrypted_agent_token.is_empty());
        assert_eq!(profile.event_cursor, "0");
        assert!(profile.recent_event_ids.is_empty());
        assert_eq!(profile.user_id, 0);
        assert_eq!(profile.device_id, 0);
        assert!(profile.device_name.is_empty());
    }
}
