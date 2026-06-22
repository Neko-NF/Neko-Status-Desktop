#![cfg(windows)]

use crate::{
    config::{protect_token, save_profile, AgentProfile},
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

pub const PIPE_NAME: &str = r"\\.\pipe\NekoStatusPresenceAgent-v1";
const MAX_FRAME: usize = 64 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Command {
    protocol_version: u32,
    command: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Serialize)]
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
        let name = wide(PIPE_NAME);
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
    use std::fs::OpenOptions;
    let mut file = OpenOptions::new().read(true).write(true).open(PIPE_NAME)?;
    let command = serde_json::to_vec(&json!({
        "protocolVersion": 1,
        "command": "shutdown",
        "payload": { "reason": "update" }
    }))
    .map_err(std::io::Error::other)?;
    file.write_all(&(command.len() as u32).to_le_bytes())?;
    file.write_all(&command)?;
    file.flush()?;
    let _ = read_frame(&mut file)?;
    Ok(())
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
            Reply {
                ok: true,
                data: status_json(state),
            }
        }
        "resume" => {
            state.paused.store(false, Ordering::Relaxed);
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
            if matches!(reason, "disable" | "logout") {
                let mut profile = state.profile.write().unwrap();
                profile.feature_enabled = false;
                profile.publish_enabled = false;
                profile.background_enabled = false;
                profile.auto_start_enabled = false;
                profile.encrypted_agent_token.clear();
                profile.event_cursor = "0".into();
                let snapshot = profile.clone();
                drop(profile);
                let _ = save_profile(&snapshot);
                let _ = crate::startup::sync_autostart(&snapshot);
            }
            state.shutdown.store(true, Ordering::Relaxed);
            Reply {
                ok: true,
                data: json!({"shuttingDown":true,"reason":reason}),
            }
        }
        "provision" | "reload_config" => provision(state, command.payload),
        _ => Reply {
            ok: false,
            data: json!({"code":"UNKNOWN_COMMAND"}),
        },
    }
}

fn provision(state: &Arc<RuntimeState>, payload: Value) -> Reply {
    let mut next: AgentProfile = match serde_json::from_value(payload.clone()) {
        Ok(profile) => profile,
        Err(error) => {
            return Reply {
                ok: false,
                data: json!({"code":"INVALID_PROFILE","message":error.to_string()}),
            }
        }
    };
    if let Some(token) = payload.get("agentToken").and_then(Value::as_str) {
        match protect_token(token) {
            Ok(encrypted) => next.encrypted_agent_token = encrypted,
            Err(error) => {
                return Reply {
                    ok: false,
                    data: json!({"code":"DPAPI_FAILED","message":error.to_string()}),
                }
            }
        }
    } else {
        next.encrypted_agent_token = state.profile.read().unwrap().encrypted_agent_token.clone();
    }
    if let Err(error) = save_profile(&next) {
        return Reply {
            ok: false,
            data: json!({"code":"PROFILE_SAVE_FAILED","message":error.to_string()}),
        };
    }
    *state.profile.write().unwrap() = next;
    let _ = crate::startup::sync_autostart(&state.profile.read().unwrap());
    Reply {
        ok: true,
        data: status_json(state),
    }
}

fn status_json(state: &Arc<RuntimeState>) -> Value {
    let profile = state.profile.read().unwrap();
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
    json!({
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
        "connection": state.connection.lock().unwrap().clone(),
        "trayClaimed": state.tray_claimed.load(Ordering::Relaxed),
        "latestDetectedApp": latest_detected_app,
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
    use super::{current_user_pipe_security, handle_command, Command};
    use crate::{config::AgentProfile, runtime::RuntimeState};
    use serde_json::json;
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
}
