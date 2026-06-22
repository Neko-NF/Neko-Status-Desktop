#![cfg(windows)]

use crate::detector::Sample;
use std::{
    ffi::OsString,
    os::windows::ffi::OsStringExt,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, POINT, RECT},
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::{
        Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
        WindowsAndMessaging::{
            GetCursorPos, GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
        },
    },
};

pub struct ForegroundSampler {
    previous_input_tick: u32,
    previous_cursor: POINT,
    previous_sample_at: u64,
}

impl Default for ForegroundSampler {
    fn default() -> Self {
        Self {
            previous_input_tick: 0,
            previous_cursor: POINT { x: 0, y: 0 },
            previous_sample_at: 0,
        }
    }
}

pub fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl ForegroundSampler {
    pub fn sample(&mut self) -> Sample {
        let at_ms = unix_ms();
        unsafe {
            let hwnd = GetForegroundWindow();
            let mut pid = 0u32;
            if !hwnd.is_null() {
                GetWindowThreadProcessId(hwnd, &mut pid);
            }
            let raw_process_name = process_name(pid).map(|name| name.to_lowercase());
            let secure_desktop = raw_process_name
                .as_deref()
                .is_some_and(|name| matches!(name, "lockapp.exe" | "logonui.exe" | "winlogon.exe"));
            let process_name = raw_process_name.and_then(|lower| {
                const IGNORED: &[&str] = &[
                    "lockapp.exe",
                    "searchhost.exe",
                    "startmenuexperiencehost.exe",
                    "shellexperiencehost.exe",
                    "textinputhost.exe",
                    "dwm.exe",
                ];
                (!IGNORED.contains(&lower.as_str())).then_some(lower)
            });

            let mut info = LASTINPUTINFO {
                cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
                dwTime: 0,
            };
            let input_pulse =
                GetLastInputInfo(&mut info) != 0 && info.dwTime != self.previous_input_tick;
            if info.dwTime != 0 {
                self.previous_input_tick = info.dwTime;
            }

            let mut cursor = POINT { x: 0, y: 0 };
            let cursor_changed = GetCursorPos(&mut cursor) != 0
                && (cursor.x != self.previous_cursor.x || cursor.y != self.previous_cursor.y);
            self.previous_cursor = cursor;
            let mut rect = RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            };
            let inside = !hwnd.is_null()
                && GetWindowRect(hwnd, &mut rect) != 0
                && cursor.x >= rect.left
                && cursor.x < rect.right
                && cursor.y >= rect.top
                && cursor.y < rect.bottom;

            let resumed_after_gap = self.previous_sample_at != 0
                && at_ms.saturating_sub(self.previous_sample_at) > 2_500;
            self.previous_sample_at = at_ms;
            Sample {
                at_ms,
                process_name,
                input_pulse,
                mouse_active_inside: cursor_changed && inside,
                force_idle: secure_desktop || resumed_after_gap,
            }
        }
    }
}

unsafe fn process_name(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if handle.is_null() {
        return None;
    }
    let mut buffer = vec![0u16; 1024];
    let mut size = buffer.len() as u32;
    let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size);
    CloseHandle(handle);
    if ok == 0 || size == 0 {
        return None;
    }
    let path = OsString::from_wide(&buffer[..size as usize]);
    Path::new(&path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
}
