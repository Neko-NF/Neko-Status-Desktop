use crate::{
    config::{profile_dir, save_profile, unprotect_token},
    detector::Transition,
    runtime::RuntimeState,
    snapshot::{capture_foreground_app, CapturedSnapshot},
    win32::unix_ms,
    winhttp,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{Local, TimeZone};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, mpsc::Receiver, Arc},
    thread,
    time::{Duration, Instant},
};
use winrt_notification::{Duration as ToastDuration, IconCrop, Sound, Toast};

fn endpoint(base: &str, path: &str) -> String {
    format!("{}{}", base.trim_end_matches('/'), path)
}

fn token(state: &RuntimeState) -> Option<String> {
    let encrypted = state.profile.read().unwrap().encrypted_agent_token.clone();
    (!encrypted.is_empty())
        .then(|| unprotect_token(&encrypted).ok())
        .flatten()
}

fn auth_headers(token: &str, content_type: Option<&str>) -> Vec<(&'static str, String)> {
    let mut headers = vec![("Authorization", format!("Bearer {token}"))];
    if let Some(content_type) = content_type {
        headers.push(("Content-Type", content_type.to_string()));
    }
    headers
}

fn post_presence(
    state: &RuntimeState,
    transition: &Transition,
    sequence: u64,
    client_session_id: &str,
    snapshot_id: Option<&str>,
) -> Result<(), String> {
    let profile = state.profile.read().unwrap().clone();
    if !profile.publish_enabled {
        return Ok(());
    }
    let token = token(state).ok_or_else(|| "agent is not provisioned".to_string())?;
    let now = unix_ms();
    let (state_name, app_key, display_name, stable_since, detector_kind) = match transition {
        Transition::Active {
            process_name,
            stable_since_ms,
            kind,
        } => (
            "active",
            Some(format!("win32:{process_name}")),
            Some(process_name.trim_end_matches(".exe").to_string()),
            Some(*stable_since_ms),
            Some(kind.as_str()),
        ),
        Transition::Idle { .. } => ("idle", None, None, None, None),
    };
    let payload = json!({
        "protocolVersion": 1,
        "agentVersion": env!("CARGO_PKG_VERSION"),
        "clientEventId": format!("{}-{}-{sequence}", std::process::id(), now),
        "clientSessionId": client_session_id,
        "sequence": sequence,
        "state": state_name,
        "appKey": app_key,
        "displayName": display_name,
        "stableSince": stable_since,
        "observedAt": now,
        "detectorKind": detector_kind,
        "snapshotId": snapshot_id,
    });
    let body = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
    if body.len() > 2 * 1024 {
        return Err("presence payload exceeds 2KiB".into());
    }
    let response = winhttp::request(
        "POST",
        &endpoint(&profile.server_url, "/api/activity/presence"),
        &auth_headers(&token, Some("application/json")),
        &body,
        10_000,
    )
    .map_err(|error| error.to_string())?;
    if response.status >= 300 {
        return Err(format!("presence HTTP {}", response.status));
    }
    Ok(())
}

fn multipart_snapshot_body(app_key: &str, snapshot: &CapturedSnapshot, boundary: &str) -> Vec<u8> {
    let mut body = Vec::with_capacity(snapshot.bytes.len() + 1024);
    for (name, value) in [
        ("appKey", app_key.to_string()),
        ("capturedAt", snapshot.captured_at_ms.to_string()),
        ("width", snapshot.width.to_string()),
        ("height", snapshot.height.to_string()),
    ] {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n")
                .as_bytes(),
        );
    }
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"snapshot\"; filename=\"activity.{}\"\r\nContent-Type: {}\r\n\r\n",
            snapshot.extension, snapshot.mime_type
        )
        .as_bytes(),
    );
    body.extend_from_slice(&snapshot.bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

fn upload_snapshot_for_transition(
    state: &RuntimeState,
    transition: &Transition,
) -> Result<Option<String>, String> {
    let Transition::Active { process_name, .. } = transition else {
        return Ok(None);
    };
    let profile = state.profile.read().unwrap().clone();
    if !profile.publish_enabled || !profile.snapshot_enabled {
        return Ok(None);
    }
    let Some(snapshot) = capture_foreground_app(process_name, &profile)? else {
        return Ok(None);
    };
    let token = token(state).ok_or_else(|| "agent is not provisioned".to_string())?;
    let boundary = format!("neko-activity-{}-{}", std::process::id(), unix_ms());
    let body = multipart_snapshot_body(&format!("win32:{process_name}"), &snapshot, &boundary);
    let response = winhttp::request(
        "POST",
        &endpoint(&profile.server_url, "/api/activity/snapshots"),
        &auth_headers(
            &token,
            Some(&format!("multipart/form-data; boundary={boundary}")),
        ),
        &body,
        2_500,
    )
    .map_err(|error| error.to_string())?;
    if response.status >= 300 {
        return Err(format!("snapshot upload HTTP {}", response.status));
    }
    let value: Value = serde_json::from_slice(&response.body).map_err(|error| error.to_string())?;
    Ok(value
        .pointer("/data/snapshot/id")
        .and_then(Value::as_str)
        .map(str::to_string))
}

pub fn run_presence_loop(state: Arc<RuntimeState>, receiver: Receiver<Transition>) {
    let mut current: Option<Transition> = None;
    // The server keeps the last sequence per device across Agent restarts.
    let mut sequence = unix_ms();
    let mut last_sent = Instant::now() - Duration::from_secs(30);
    let mut pause_sent = false;
    let client_session_id = format!("{}-{}", std::process::id(), unix_ms());
    let retry_delays = [1u64, 2, 5, 10, 30, 60];
    let mut retry_index = 0usize;
    let mut retry_at = Instant::now();
    let mut transition_pending = false;
    let mut pending_snapshot_id: Option<String> = None;
    while state.should_run() {
        if let Ok(transition) = receiver.recv_timeout(Duration::from_millis(500)) {
            pending_snapshot_id = upload_snapshot_for_transition(&state, &transition)
                .ok()
                .flatten();
            current = Some(transition);
            retry_at = Instant::now();
            transition_pending = true;
        }
        if state.paused.load(Ordering::Relaxed) {
            if !pause_sent {
                sequence += 1;
                let idle = Transition::Idle { at_ms: unix_ms() };
                let _ = post_presence(&state, &idle, sequence, &client_session_id, None);
                pause_sent = true;
            }
            continue;
        }
        pause_sent = false;
        let heartbeat_due = transition_pending || last_sent.elapsed() >= Duration::from_secs(10);
        if !heartbeat_due || Instant::now() < retry_at {
            continue;
        }
        let Some(transition) = current.as_ref() else {
            continue;
        };
        sequence += 1;
        let snapshot_id = transition_pending
            .then_some(pending_snapshot_id.as_deref())
            .flatten();
        match post_presence(
            &state,
            transition,
            sequence,
            &client_session_id,
            snapshot_id,
        ) {
            Ok(()) => {
                state.set_connection("online");
                last_sent = Instant::now();
                retry_index = 0;
                transition_pending = false;
                pending_snapshot_id = None;
            }
            Err(_) => {
                state.set_connection("reconnecting");
                let base = retry_delays[retry_index.min(retry_delays.len() - 1)];
                retry_at =
                    Instant::now() + Duration::from_millis(jittered_delay_ms(base, unix_ms()));
                retry_index = (retry_index + 1).min(retry_delays.len() - 1);
            }
        }
    }
    if current.is_some() {
        sequence += 1;
        let _ = post_presence(
            &state,
            &Transition::Idle { at_ms: unix_ms() },
            sequence,
            &client_session_id,
            None,
        );
    }
}

fn json_get(state: &RuntimeState, token: &str, path: &str) -> Result<Value, String> {
    let profile = state.profile.read().unwrap().clone();
    let response = winhttp::request(
        "GET",
        &endpoint(&profile.server_url, path),
        &auth_headers(token, Some("application/json")),
        &[],
        15_000,
    )
    .map_err(|error| error.to_string())?;
    if response.status >= 300 {
        return Err(format!("GET {path} HTTP {}", response.status));
    }
    serde_json::from_slice(&response.body).map_err(|error| error.to_string())
}

fn bootstrap_cursor(state: &RuntimeState, token: &str) -> Result<String, String> {
    let value = json_get(state, token, "/api/activity/agent/bootstrap")?;
    Ok(value
        .pointer("/data/latestEventId")
        .and_then(Value::as_str)
        .unwrap_or("0")
        .to_string())
}

fn save_cursor(state: &RuntimeState, cursor: &str) {
    let mut profile = state.profile.write().unwrap();
    if profile.event_cursor == cursor {
        return;
    }
    profile.event_cursor = cursor.to_string();
    let snapshot = profile.clone();
    drop(profile);
    let _ = save_profile(&snapshot);
}

fn notification_cache_dir(state: &RuntimeState) -> PathBuf {
    let configured = state.profile.read().unwrap().snapshot_cache_dir.clone();
    if configured.trim().is_empty() {
        profile_dir().join("notification-images")
    } else {
        PathBuf::from(configured).join("notification-images")
    }
}

fn cleanup_notification_cache(cache_dir: &Path, max_age: Duration) {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let Ok(age) = std::time::SystemTime::now().duration_since(modified) else {
            continue;
        };
        if age > max_age {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else {
        None
    }
}

fn safe_cache_stem(value: &str) -> String {
    let safe = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(80)
        .collect::<String>();
    if safe.is_empty() {
        format!("event-{}", unix_ms())
    } else {
        safe
    }
}

fn absolute_image_url(server_url: &str, value: &str) -> Option<String> {
    if value.starts_with('/') {
        Some(endpoint(server_url, value))
    } else if value.starts_with("https://") || value.starts_with("http://") {
        let base = server_url.trim_end_matches('/');
        value
            .strip_prefix(base)
            .filter(|remainder| remainder.is_empty() || remainder.starts_with('/'))
            .map(|_| value.to_string())
    } else {
        None
    }
}

fn decode_data_image(value: &str) -> Option<Vec<u8>> {
    let encoded = value
        .strip_prefix("data:image/jpeg;base64,")
        .or_else(|| value.strip_prefix("data:image/png;base64,"))?;
    if encoded.len() > 3 * 1024 * 1024 {
        return None;
    }
    let bytes = STANDARD.decode(encoded).ok()?;
    (bytes.len() <= 2 * 1024 * 1024 && image_extension(&bytes).is_some()).then_some(bytes)
}

fn download_notification_image(
    state: &RuntimeState,
    token: &str,
    value: &str,
    cache_stem: &str,
    role: &str,
) -> Option<PathBuf> {
    let profile = state.profile.read().unwrap().clone();
    let bytes = if let Some(bytes) = decode_data_image(value) {
        bytes
    } else {
        let url = absolute_image_url(&profile.server_url, value)?;
        let response =
            winhttp::request("GET", &url, &auth_headers(token, None), &[], 3_000).ok()?;
        if response.status >= 300 || response.body.len() > 2 * 1024 * 1024 {
            return None;
        }
        response.body
    };
    let extension = image_extension(&bytes)?;
    let cache_dir = notification_cache_dir(state);
    fs::create_dir_all(&cache_dir).ok()?;
    let path = cache_dir.join(format!("{cache_stem}-{role}.{extension}"));
    fs::write(&path, bytes).ok()?;
    Some(path)
}

fn notification_time(event: &Value) -> String {
    let created_at_ms = event
        .get("createdAtMs")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    Local
        .timestamp_millis_opt(created_at_ms)
        .single()
        .map(|value| value.format("%m-%d %H:%M").to_string())
        .unwrap_or_else(|| "刚刚".to_string())
}

fn event_snapshot_url(event: &Value) -> Option<&str> {
    event
        .pointer("/payload/snapshot/url")
        .and_then(Value::as_str)
}

fn show_activity_notification(state: &RuntimeState, event: &Value) {
    if !should_notify_event(event, unix_ms()) {
        return;
    }
    let username = event
        .pointer("/payload/target/username")
        .and_then(Value::as_str)
        .unwrap_or("关注用户");
    let app = event
        .pointer("/payload/app/displayName")
        .and_then(Value::as_str)
        .unwrap_or("应用");
    let seconds = event
        .pointer("/payload/session/onlineSeconds")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let devices = event
        .pointer("/payload/session/devices")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("、")
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "未知设备".to_string());
    let cache_dir = notification_cache_dir(state);
    let _ = fs::create_dir_all(&cache_dir);
    cleanup_notification_cache(&cache_dir, Duration::from_secs(48 * 60 * 60));
    let event_id = safe_cache_stem(event.get("id").and_then(Value::as_str).unwrap_or(""));
    let agent_token = token(state);
    let avatar = event
        .pointer("/payload/target/avatar")
        .and_then(Value::as_str)
        .and_then(|url| {
            agent_token.as_deref().and_then(|current| {
                download_notification_image(state, current, url, &event_id, "avatar")
            })
        });
    let hero = event_snapshot_url(event).and_then(|url| {
        agent_token
            .as_deref()
            .and_then(|current| download_notification_image(state, current, url, &event_id, "hero"))
    });
    let mut toast = Toast::new("com.koirin.neko-status")
        .title(&format!("{username} 正在使用 {app}"))
        .text1(&format!("已在线 {seconds} 秒 · {devices}"))
        .text2(&format!("上线时间 {}", notification_time(event)))
        .sound(Some(Sound::Default))
        .duration(if hero.is_some() {
            ToastDuration::Long
        } else {
            ToastDuration::Short
        });
    if let Some(path) = avatar.as_deref() {
        toast = toast.icon(path, IconCrop::Circular, username);
    }
    if let Some(path) = hero.as_deref() {
        toast = toast.hero(path, &format!("{app} 应用窗口快照"));
    }
    let _ = toast.show();
}

fn should_notify_event(event: &Value, now_ms: u64) -> bool {
    if event.get("type").and_then(Value::as_str) != Some("activity.entered") {
        return false;
    }
    let created_at = event
        .get("createdAtMs")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    created_at != 0 && now_ms.saturating_sub(created_at) <= 120_000
}

fn jittered_delay_ms(base_secs: u64, now_ms: u64) -> u64 {
    let jitter_ms = (now_ms % 401) as i64 - 200;
    let delay_ms = (base_secs * 1000) as i64 + jitter_ms;
    delay_ms.max(1) as u64
}

fn consume_event(state: &RuntimeState, event: &Value, event_id: &str) {
    if state.profile.read().unwrap().notifications_enabled {
        show_activity_notification(state, event);
    }
    if !event_id.is_empty() {
        save_cursor(state, event_id);
    }
}

fn poll_events(state: &RuntimeState, token: &str) -> Result<(), String> {
    let cursor = state.profile.read().unwrap().event_cursor.clone();
    let value = json_get(
        state,
        token,
        &format!("/api/activity/events?after={cursor}"),
    )?;
    if let Some(events) = value.pointer("/data/events").and_then(Value::as_array) {
        for event in events {
            let id = event.get("id").and_then(Value::as_str).unwrap_or("");
            consume_event(state, event, id);
        }
    }
    if let Some(cursor) = value.pointer("/data/cursor").and_then(Value::as_str) {
        save_cursor(state, cursor);
    }
    Ok(())
}

pub fn run_event_loop(state: Arc<RuntimeState>) {
    let mut first_bootstrap = true;
    let reconnect = [1u64, 2, 5, 10, 30, 60];
    let mut attempt = 0usize;
    while state.should_run() {
        if state.paused.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(500));
            continue;
        }
        let Some(token) = token(&state) else {
            state.set_connection("unprovisioned");
            thread::sleep(Duration::from_secs(2));
            continue;
        };
        if first_bootstrap {
            match bootstrap_cursor(&state, &token) {
                Ok(cursor) => {
                    save_cursor(&state, &cursor);
                    first_bootstrap = false;
                }
                Err(_) => {
                    state.set_connection("reconnecting");
                    thread::sleep(Duration::from_secs(2));
                    continue;
                }
            }
        }
        let profile = state.profile.read().unwrap().clone();
        let url = format!(
            "{}?after={}",
            endpoint(&profile.server_url, "/api/activity/events/stream"),
            profile.event_cursor
        );
        let mut event_id = String::new();
        let mut stream_headers = auth_headers(&token, None);
        stream_headers.push(("Accept", "text/event-stream".into()));
        let result = winhttp::stream_lines(
            &url,
            &stream_headers,
            |line| {
                if let Some(value) = line.strip_prefix("id: ") {
                    event_id = value.trim().to_string();
                }
                if let Some(data) = line.strip_prefix("data: ") {
                    if let Ok(event) = serde_json::from_str::<Value>(data) {
                        consume_event(&state, &event, &event_id);
                    }
                }
            },
            || state.should_run() && !state.paused.load(Ordering::Relaxed),
        );
        if matches!(result, Ok(status) if status < 300) {
            state.set_connection("online");
            attempt = 0;
        } else {
            state.set_connection("reconnecting");
            attempt = (attempt + 1).min(reconnect.len() - 1);
        }

        // SSE 不可用时使用 5 秒游标轮询；每轮后仍会尝试恢复单一 SSE 长连接。
        if attempt >= 2 {
            if poll_events(&state, &token).is_ok() {
                state.set_connection("polling");
            }
            thread::sleep(Duration::from_secs(5));
        } else {
            let delay = reconnect[attempt.min(reconnect.len() - 1)];
            thread::sleep(Duration::from_millis(jittered_delay_ms(delay, unix_ms())));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        absolute_image_url, cleanup_notification_cache, decode_data_image, event_snapshot_url,
        image_extension, jittered_delay_ms, multipart_snapshot_body, safe_cache_stem,
        should_notify_event,
    };
    use crate::snapshot::CapturedSnapshot;
    use serde_json::json;
    use std::{fs, time::Duration};

    #[test]
    fn stale_or_non_entered_events_do_not_notify() {
        let now = 1_000_000u64;
        assert!(should_notify_event(
            &json!({"type":"activity.entered","createdAtMs": now - 30_000}),
            now,
        ));
        assert!(!should_notify_event(
            &json!({"type":"activity.entered","createdAtMs": now - 121_000}),
            now,
        ));
        assert!(!should_notify_event(
            &json!({"type":"activity.ended","createdAtMs": now}),
            now,
        ));
        assert!(!should_notify_event(
            &json!({"type":"activity.entered"}),
            now
        ));
    }

    #[test]
    fn retry_jitter_stays_in_expected_window() {
        for now in [0, 1, 200, 400, 123_456] {
            let delay = jittered_delay_ms(10, now);
            assert!((9_800..=10_200).contains(&delay));
        }
    }

    #[test]
    fn snapshot_multipart_contains_metadata_and_binary_body() {
        let snapshot = CapturedSnapshot {
            bytes: vec![0xff, 0xd8, 0xff, 0x11],
            mime_type: "image/jpeg",
            extension: "jpg",
            width: 640,
            height: 360,
            captured_at_ms: 1234,
        };
        let body = multipart_snapshot_body("win32:code.exe", &snapshot, "boundary");
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("win32:code.exe"));
        assert!(text.contains("name=\"snapshot\""));
        assert!(text.contains("filename=\"activity.jpg\""));
        assert!(body.windows(4).any(|part| part == [0xff, 0xd8, 0xff, 0x11]));
    }

    #[test]
    fn notification_cache_helpers_reject_unsafe_names_and_unknown_images() {
        assert_eq!(safe_cache_stem("../../event:42"), "event42");
        assert_eq!(image_extension(&[0xff, 0xd8, 0xff]), Some("jpg"));
        assert_eq!(image_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(image_extension(b"GIF89a"), None);
        assert_eq!(
            absolute_image_url("https://example.test", "/avatar.png").as_deref(),
            Some("https://example.test/avatar.png"),
        );
        assert!(absolute_image_url("https://example.test", "https://evil.test/a.png").is_none());
        assert!(decode_data_image("data:image/jpeg;base64,/9j/").is_some());
    }

    #[test]
    fn notification_cache_cleanup_removes_expired_files() {
        let cache_dir =
            std::env::temp_dir().join(format!("neko-agent-cache-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&cache_dir);
        fs::create_dir_all(&cache_dir).unwrap();
        let image = cache_dir.join("expired.jpg");
        fs::write(&image, [0xff, 0xd8, 0xff]).unwrap();
        std::thread::sleep(Duration::from_millis(2));
        cleanup_notification_cache(&cache_dir, Duration::ZERO);
        assert!(!image.exists());
        let _ = fs::remove_dir_all(&cache_dir);
    }

    #[test]
    fn toast_events_support_optional_snapshot_images() {
        let with_image = json!({
            "payload": { "snapshot": { "url": "/api/activity/snapshots/abc" } }
        });
        assert_eq!(
            event_snapshot_url(&with_image),
            Some("/api/activity/snapshots/abc")
        );
        assert_eq!(event_snapshot_url(&json!({"payload": {}})), None);
    }
}
