#![cfg(windows)]

use crate::{config::AgentProfile, win32::unix_ms};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, RgbaImage};
use std::{ffi::OsString, os::windows::ffi::OsStringExt, path::Path};
use windows_sys::Win32::{
    Foundation::{CloseHandle, RECT},
    Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
        DIB_RGB_COLORS, RGBQUAD, SRCCOPY,
    },
    System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    },
    UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId},
};

#[derive(Clone, Debug)]
pub struct CapturedSnapshot {
    pub bytes: Vec<u8>,
    pub mime_type: &'static str,
    pub extension: &'static str,
    pub width: u32,
    pub height: u32,
    pub captured_at_ms: u64,
}

pub fn capture_foreground_app(
    expected_process: &str,
    profile: &AgentProfile,
) -> Result<Option<CapturedSnapshot>, String> {
    let expected = normalize_process(expected_process);
    if !snapshot_allowed(&expected, profile) {
        return Ok(None);
    }

    let (rect, process_name) = unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return Ok(None);
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let process_name = process_name(pid).map(|name| normalize_process(&name));
        if !foreground_process_matches(&expected, process_name.as_deref()) {
            return Ok(None);
        }
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return Ok(None);
        }
        (rect, process_name.unwrap_or_default())
    };
    if snapshot_blocked(&process_name, profile) {
        return Ok(None);
    }

    let width = (rect.right - rect.left).max(0) as u32;
    let height = (rect.bottom - rect.top).max(0) as u32;
    if !(32..=4096).contains(&width) || !(32..=4096).contains(&height) {
        return Ok(None);
    }
    let image = capture_rect_bgra(rect, width, height)?;
    let bytes = encode_thumbnail(
        image,
        profile.snapshot_max_width.clamp(160, 1920),
        profile.snapshot_max_height.clamp(90, 1080),
        profile.snapshot_max_bytes.clamp(64 * 1024, 1024 * 1024),
    )?;
    Ok(Some(CapturedSnapshot {
        width: bytes.1,
        height: bytes.2,
        bytes: bytes.0,
        mime_type: "image/jpeg",
        extension: "jpg",
        captured_at_ms: unix_ms(),
    }))
}

fn snapshot_allowed(process_name: &str, profile: &AgentProfile) -> bool {
    profile.snapshot_enabled && !process_name.is_empty() && !snapshot_blocked(process_name, profile)
}

fn foreground_process_matches(expected: &str, actual: Option<&str>) -> bool {
    actual == Some(expected)
}

fn snapshot_blocked(process_name: &str, profile: &AgentProfile) -> bool {
    if profile.snapshot_privacy_block_all {
        return true;
    }
    profile
        .snapshot_blocked_processes
        .iter()
        .any(|item| normalize_process(item) == process_name)
}

fn normalize_process(value: &str) -> String {
    let mut text = value.trim().to_lowercase();
    if let Some(rest) = text.strip_prefix("win32:") {
        text = rest.to_string();
    }
    let leaf = text
        .split(['\\', '/'])
        .rfind(|part| !part.is_empty())
        .unwrap_or("")
        .to_string();
    if leaf.is_empty() {
        String::new()
    } else if leaf.ends_with(".exe") {
        leaf
    } else {
        format!("{leaf}.exe")
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

fn capture_rect_bgra(rect: RECT, width: u32, height: u32) -> Result<RgbaImage, String> {
    unsafe {
        let screen_dc = GetDC(std::ptr::null_mut());
        if screen_dc.is_null() {
            return Err("GetDC failed".into());
        }
        let memory_dc = CreateCompatibleDC(screen_dc);
        if memory_dc.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("CreateCompatibleDC failed".into());
        }
        let bitmap = CreateCompatibleBitmap(screen_dc, width as i32, height as i32);
        if bitmap.is_null() {
            DeleteDC(memory_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("CreateCompatibleBitmap failed".into());
        }
        let previous = SelectObject(memory_dc, bitmap as _);
        let copied = BitBlt(
            memory_dc,
            0,
            0,
            width as i32,
            height as i32,
            screen_dc,
            rect.left,
            rect.top,
            SRCCOPY | CAPTUREBLT,
        );
        if copied == 0 {
            SelectObject(memory_dc, previous);
            DeleteObject(bitmap as _);
            DeleteDC(memory_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("BitBlt failed".into());
        }

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD {
                rgbBlue: 0,
                rgbGreen: 0,
                rgbRed: 0,
                rgbReserved: 0,
            }],
        };
        let mut bgra = vec![0u8; width as usize * height as usize * 4];
        let scanlines = GetDIBits(
            memory_dc,
            bitmap,
            0,
            height,
            bgra.as_mut_ptr() as *mut _,
            &mut info,
            DIB_RGB_COLORS,
        );
        SelectObject(memory_dc, previous);
        DeleteObject(bitmap as _);
        DeleteDC(memory_dc);
        ReleaseDC(std::ptr::null_mut(), screen_dc);

        if scanlines == 0 {
            return Err("GetDIBits failed".into());
        }
        let mut rgba = Vec::with_capacity(bgra.len());
        for pixel in bgra.chunks_exact(4) {
            rgba.push(pixel[2]);
            rgba.push(pixel[1]);
            rgba.push(pixel[0]);
            rgba.push(255);
        }
        RgbaImage::from_raw(width, height, rgba).ok_or_else(|| "invalid captured bitmap".into())
    }
}

fn encode_thumbnail(
    image: RgbaImage,
    max_width: u32,
    max_height: u32,
    max_bytes: usize,
) -> Result<(Vec<u8>, u32, u32), String> {
    let (target_width, target_height) =
        scaled_size(image.width(), image.height(), max_width, max_height);
    let resized = if target_width != image.width() || target_height != image.height() {
        image::imageops::resize(&image, target_width, target_height, FilterType::Triangle)
    } else {
        image
    };
    for quality in [82u8, 74, 66, 58] {
        let encoded = encode_jpeg(&resized, quality)?;
        if encoded.len() <= max_bytes {
            return Ok((encoded, resized.width(), resized.height()));
        }
    }
    Err("encoded activity snapshot exceeds byte limit".into())
}

fn encode_jpeg(image: &RgbaImage, quality: u8) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut output, quality);
    encoder
        .encode_image(&DynamicImage::ImageRgba8(image.clone()))
        .map_err(|error| error.to_string())?;
    Ok(output)
}

fn scaled_size(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (1, 1);
    }
    let scale = (max_width as f64 / width as f64)
        .min(max_height as f64 / height as f64)
        .min(1.0);
    (
        ((width as f64 * scale).round() as u32).max(1),
        ((height as f64 * scale).round() as u32).max(1),
    )
}

#[cfg(test)]
mod tests {
    use super::{
        foreground_process_matches, normalize_process, scaled_size, snapshot_allowed,
        snapshot_blocked,
    };
    use crate::config::AgentProfile;

    #[test]
    fn process_names_normalize_for_snapshot_matching() {
        assert_eq!(normalize_process("Code"), "code.exe");
        assert_eq!(normalize_process("win32:Code.exe"), "code.exe");
        assert_eq!(normalize_process("C:\\Apps\\Code.exe"), "code.exe");
    }

    #[test]
    fn thumbnails_keep_aspect_ratio_inside_bounds() {
        assert_eq!(scaled_size(1920, 1080, 640, 360), (640, 360));
        assert_eq!(scaled_size(800, 1200, 640, 360), (240, 360));
        assert_eq!(scaled_size(320, 180, 640, 360), (320, 180));
    }

    #[test]
    fn privacy_rules_block_matching_processes() {
        let mut profile = AgentProfile {
            snapshot_blocked_processes: vec!["Code.exe".into()],
            ..AgentProfile::default()
        };
        assert!(snapshot_blocked("code.exe", &profile));
        assert!(!snapshot_blocked("notepad.exe", &profile));
        profile.snapshot_privacy_block_all = true;
        assert!(snapshot_blocked("notepad.exe", &profile));
    }

    #[test]
    fn snapshot_switch_and_foreground_match_are_required() {
        assert!(!snapshot_allowed("code.exe", &AgentProfile::default()));
        let profile = AgentProfile {
            snapshot_enabled: true,
            ..AgentProfile::default()
        };
        assert!(snapshot_allowed("code.exe", &profile));
        assert!(foreground_process_matches("code.exe", Some("code.exe")));
        assert!(!foreground_process_matches("code.exe", Some("notepad.exe")));
        assert!(!foreground_process_matches("code.exe", None));
    }
}
