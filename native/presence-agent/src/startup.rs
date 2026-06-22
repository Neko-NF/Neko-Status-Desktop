#![cfg(windows)]

use crate::config::AgentProfile;
use std::io;
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

const VALUE_NAME: &str = "NekoStatusPresenceAgent";

pub fn sync_autostart(profile: &AgentProfile) -> io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hkcu.create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")?;
    if profile.background_enabled && profile.auto_start_enabled {
        let exe = std::env::current_exe()?;
        run.set_value(VALUE_NAME, &format!("\"{}\" --background", exe.display()))
    } else {
        let _ = run.delete_value(VALUE_NAME);
        Ok(())
    }
}
