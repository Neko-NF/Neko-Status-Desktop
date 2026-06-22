use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::{env, fs, io, path::PathBuf};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub protocol_version: u32,
    pub server_url: String,
    pub device_id: i64,
    pub device_name: String,
    pub user_id: i64,
    pub main_executable: String,
    pub feature_enabled: bool,
    pub publish_enabled: bool,
    pub background_enabled: bool,
    pub auto_start_enabled: bool,
    pub notifications_enabled: bool,
    #[serde(default)]
    pub snapshot_enabled: bool,
    #[serde(default = "default_snapshot_max_bytes")]
    pub snapshot_max_bytes: usize,
    #[serde(default = "default_snapshot_max_width")]
    pub snapshot_max_width: u32,
    #[serde(default = "default_snapshot_max_height")]
    pub snapshot_max_height: u32,
    #[serde(default)]
    pub snapshot_cache_dir: String,
    #[serde(default)]
    pub snapshot_privacy_block_all: bool,
    #[serde(default)]
    pub snapshot_blocked_processes: Vec<String>,
    #[serde(default)]
    pub encrypted_agent_token: String,
    #[serde(default)]
    pub event_cursor: String,
}

fn default_snapshot_max_bytes() -> usize {
    512 * 1024
}

fn default_snapshot_max_width() -> u32 {
    640
}

fn default_snapshot_max_height() -> u32 {
    360
}

impl Default for AgentProfile {
    fn default() -> Self {
        Self {
            protocol_version: 1,
            server_url: String::new(),
            device_id: 0,
            device_name: String::new(),
            user_id: 0,
            main_executable: String::new(),
            feature_enabled: false,
            publish_enabled: false,
            background_enabled: false,
            auto_start_enabled: false,
            notifications_enabled: true,
            snapshot_enabled: false,
            snapshot_max_bytes: default_snapshot_max_bytes(),
            snapshot_max_width: default_snapshot_max_width(),
            snapshot_max_height: default_snapshot_max_height(),
            snapshot_cache_dir: String::new(),
            snapshot_privacy_block_all: false,
            snapshot_blocked_processes: Vec::new(),
            encrypted_agent_token: String::new(),
            event_cursor: "0".into(),
        }
    }
}

pub fn profile_dir() -> PathBuf {
    let root = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir);
    root.join("NekoStatus").join("presence-agent")
}

pub fn profile_path() -> PathBuf {
    profile_dir().join("profile.v1.json")
}

pub fn load_profile() -> AgentProfile {
    fs::read_to_string(profile_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_profile(profile: &AgentProfile) -> io::Result<()> {
    fs::create_dir_all(profile_dir())?;
    let tmp = profile_dir().join("profile.v1.tmp");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(profile).map_err(io::Error::other)?,
    )?;
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let source: Vec<u16> = tmp.as_os_str().encode_wide().chain(Some(0)).collect();
        let target_path = profile_path();
        let target: Vec<u16> = target_path
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        if unsafe {
            MoveFileExW(
                source.as_ptr(),
                target.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    fs::rename(tmp, profile_path())
}

#[cfg(windows)]
pub fn protect_token(token: &str) -> io::Result<String> {
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: token.len() as u32,
        pbData: token.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let ok = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let encoded = STANDARD.encode(bytes);
    unsafe {
        LocalFree(output.pbData as _);
    }
    Ok(encoded)
}

#[cfg(windows)]
pub fn unprotect_token(encoded: &str) -> io::Result<String> {
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };
    let mut encrypted = STANDARD.decode(encoded).map_err(io::Error::other)?;
    let input = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_mut_ptr(),
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let ok = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) };
    let token = String::from_utf8(bytes.to_vec()).map_err(io::Error::other)?;
    unsafe {
        LocalFree(output.pbData as _);
    }
    Ok(token)
}

#[cfg(all(test, windows))]
mod tests {
    use super::{protect_token, unprotect_token};

    #[test]
    fn dpapi_round_trips_agent_token() {
        let token = "nk_act_unit_test_secret";
        let encrypted = protect_token(token).expect("token should be protected");
        assert_ne!(encrypted, token);
        assert_eq!(
            unprotect_token(&encrypted).expect("token should unprotect"),
            token
        );
    }

    #[test]
    fn dpapi_rejects_corrupted_ciphertext() {
        assert!(unprotect_token("not-base64-token").is_err());
    }
}
