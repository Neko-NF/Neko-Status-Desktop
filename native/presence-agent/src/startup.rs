#![cfg(windows)]

use crate::config::{is_dev_channel, AgentProfile};
use std::io;
use winreg::{enums::HKEY_CURRENT_USER, RegKey};

pub fn sync_autostart(profile: &AgentProfile) -> io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hkcu.create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")?;
    let value_name = if is_dev_channel() {
        "NekoStatusPresenceAgentDev"
    } else {
        "NekoStatusPresenceAgent"
    };
    if profile.background_enabled && profile.auto_start_enabled {
        let exe = std::env::current_exe()?;
        let channel = if is_dev_channel() {
            " --channel=dev"
        } else {
            ""
        };
        run.set_value(
            value_name,
            &format!("\"{}\" --background{channel}", exe.display()),
        )
    } else {
        let _ = run.delete_value(value_name);
        Ok(())
    }
}
