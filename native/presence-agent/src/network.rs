use crate::{
    config::{profile_dir, save_profile, unprotect_token, AgentProfile},
    detector::Transition,
    runtime::{ActivityError, RuntimeState},
    snapshot::{capture_foreground_app, CapturedSnapshot},
    win32::unix_ms,
    winhttp,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{Local, SecondsFormat, TimeZone, Utc};
use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Receiver,
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use winrt_notification::{Duration as ToastDuration, IconCrop, Sound, Toast};

const RETRY_DELAYS: [u64; 6] = [1, 2, 5, 10, 30, 60];
const UNSUPPORTED_RECHECK_SECS: u64 = 5 * 60;
const FEATURE_DISABLED_RECHECK_SECS: u64 = 15 * 60;

#[derive(Clone, Copy, Debug, PartialEq)]
enum FailurePolicy {
    Backoff,
    RetryAfter(u64),
    Credential,
    Unsupported,
    FeatureDisabled,
    ConfigurationChanged,
}

#[derive(Clone, Debug, PartialEq)]
struct ApiFailure {
    error: ActivityError,
    policy: FailurePolicy,
}

impl ApiFailure {
    fn new(
        code: &str,
        message: &str,
        status: Option<u32>,
        transient: bool,
        policy: FailurePolicy,
    ) -> Self {
        Self {
            error: ActivityError::new(code, message, status, transient),
            policy,
        }
    }

    fn network() -> Self {
        Self::new(
            "API_TRANSIENT",
            "暂时无法连接提醒服务器",
            None,
            true,
            FailurePolicy::Backoff,
        )
    }

    fn configuration_changed() -> Self {
        Self::new(
            "CONFIG_CHANGED",
            "提醒配置已更新",
            None,
            true,
            FailurePolicy::ConfigurationChanged,
        )
    }
}

fn retry_after_seconds(value: Option<&str>) -> u64 {
    const MAX_RETRY_AFTER_SECS: u64 = 24 * 60 * 60;
    let parsed = value.and_then(|value| {
        let value = value.trim();
        value.parse::<u64>().ok().or_else(|| {
            chrono::DateTime::parse_from_rfc2822(value)
                .ok()
                .map(|date| {
                    date.timestamp()
                        .saturating_sub(Utc::now().timestamp())
                        .max(1) as u64
                })
        })
    });
    parsed
        .filter(|value| *value > 0)
        .unwrap_or(60)
        .min(MAX_RETRY_AFTER_SECS)
}

fn classify_response(
    status: u32,
    content_type: &Option<String>,
    retry_after: Option<&str>,
    expected_content_type: &str,
) -> Result<(), ApiFailure> {
    match status {
        300..=399 => Err(ApiFailure::new(
            "API_REDIRECTED",
            "提醒接口被重定向，服务器配置不正确",
            Some(status),
            false,
            FailurePolicy::Unsupported,
        )),
        401 | 403 => Err(ApiFailure::new(
            "CREDENTIAL_INVALID",
            "提醒凭据已失效，需要重新配置",
            Some(status),
            false,
            FailurePolicy::Credential,
        )),
        404 => Err(ApiFailure::new(
            "API_NOT_DEPLOYED",
            "服务器暂未提供上线提醒接口",
            Some(status),
            false,
            FailurePolicy::Unsupported,
        )),
        204 => Err(ApiFailure::new(
            "FEATURE_DISABLED",
            "服务器暂未开启上线提醒",
            Some(status),
            false,
            FailurePolicy::FeatureDisabled,
        )),
        429 => Err(ApiFailure::new(
            "API_TRANSIENT",
            "请求过于频繁，稍后自动重试",
            Some(status),
            true,
            FailurePolicy::RetryAfter(retry_after_seconds(retry_after)),
        )),
        500..=599 => Err(ApiFailure::new(
            "API_TRANSIENT",
            "提醒服务器暂时不可用",
            Some(status),
            true,
            FailurePolicy::Backoff,
        )),
        400..=499 => Err(ApiFailure::new(
            "API_INCOMPATIBLE",
            "提醒接口与当前客户端不兼容",
            Some(status),
            false,
            FailurePolicy::Unsupported,
        )),
        200..=299 if !winhttp::is_content_type(content_type, expected_content_type) => {
            Err(ApiFailure::new(
                "API_INCOMPATIBLE",
                "服务器返回了无法识别的提醒接口格式",
                Some(status),
                false,
                FailurePolicy::Unsupported,
            ))
        }
        200..=299 => Ok(()),
        _ => Err(ApiFailure::new(
            "API_INCOMPATIBLE",
            "提醒服务器返回了异常响应",
            Some(status),
            false,
            FailurePolicy::Unsupported,
        )),
    }
}

fn envelope_failure(status: u32, value: &Value) -> Option<ApiFailure> {
    if value.get("success").and_then(Value::as_bool) != Some(false) {
        return None;
    }
    let server_code = value
        .pointer("/error/code")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if matches!(
        server_code,
        "ACTIVITY_FEATURE_DISABLED" | "FEATURE_DISABLED"
    ) {
        Some(ApiFailure::new(
            "FEATURE_DISABLED",
            "服务器暂未开启上线提醒",
            Some(status),
            false,
            FailurePolicy::FeatureDisabled,
        ))
    } else if matches!(
        server_code,
        "UNAUTHORIZED" | "INVALID_AGENT_TOKEN" | "AGENT_TOKEN_EXPIRED"
    ) {
        Some(ApiFailure::new(
            "CREDENTIAL_INVALID",
            "提醒凭据已失效，需要重新配置",
            Some(status),
            false,
            FailurePolicy::Credential,
        ))
    } else {
        None
    }
}

fn strict_json(response: winhttp::Response) -> Result<Value, ApiFailure> {
    let parsed = if winhttp::is_content_type(&response.content_type, "application/json") {
        serde_json::from_slice::<Value>(&response.body).ok()
    } else {
        None
    };
    if let Some(failure) = parsed
        .as_ref()
        .and_then(|value| envelope_failure(response.status, value))
    {
        return Err(failure);
    }
    classify_response(
        response.status,
        &response.content_type,
        response.retry_after.as_deref(),
        "application/json",
    )?;
    let value = parsed.ok_or_else(|| {
        ApiFailure::new(
            "API_INCOMPATIBLE",
            "服务器返回了无效的提醒数据",
            Some(response.status),
            false,
            FailurePolicy::Unsupported,
        )
    })?;
    if !value.is_object() || value.get("success").and_then(Value::as_bool) != Some(true) {
        return Err(ApiFailure::new(
            "API_INCOMPATIBLE",
            "服务器返回了不完整的提醒数据",
            Some(response.status),
            false,
            FailurePolicy::Unsupported,
        ));
    }
    Ok(value)
}

fn retry_delay(failure: &ApiFailure, failure_index: usize, now_ms: u64) -> Duration {
    let seconds = match failure.policy {
        FailurePolicy::Backoff => RETRY_DELAYS[failure_index.min(RETRY_DELAYS.len() - 1)],
        FailurePolicy::RetryAfter(seconds) => seconds,
        FailurePolicy::Credential => u64::MAX,
        FailurePolicy::Unsupported => UNSUPPORTED_RECHECK_SECS,
        FailurePolicy::FeatureDisabled => FEATURE_DISABLED_RECHECK_SECS,
        FailurePolicy::ConfigurationChanged => 0,
    };
    if seconds == u64::MAX {
        Duration::MAX
    } else if matches!(failure.policy, FailurePolicy::Backoff) {
        Duration::from_millis(jittered_delay_ms(seconds, now_ms))
    } else {
        Duration::from_secs(seconds)
    }
}

fn retry_at_ms(delay: Duration) -> Option<u64> {
    (delay != Duration::MAX)
        .then(|| unix_ms().saturating_add(delay.as_millis().min(u64::MAX as u128) as u64))
}

fn sleep_receiver_interruptibly(state: &RuntimeState, delay: Duration, revision: u64) {
    let deadline = (delay != Duration::MAX).then(|| Instant::now() + delay);
    while state.should_run() && state.receiver_revision() == revision {
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            break;
        }
        thread::sleep(Duration::from_millis(250));
    }
}

fn endpoint(base: &str, path: &str) -> String {
    format!("{}{}", base.trim_end_matches('/'), path)
}

fn encode_query_component(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
    }
    encoded
}

fn profile_token(profile: &AgentProfile) -> Option<String> {
    (!profile.encrypted_agent_token.is_empty())
        .then(|| unprotect_token(&profile.encrypted_agent_token).ok())
        .flatten()
}

fn auth_headers(token: &str, content_type: Option<&str>) -> Vec<(&'static str, String)> {
    let mut headers = vec![("Authorization", format!("Bearer {token}"))];
    if let Some(content_type) = content_type {
        headers.push(("Content-Type", content_type.to_string()));
    }
    headers
}

fn iso_time(milliseconds: u64) -> String {
    Utc.timestamp_millis_opt(milliseconds as i64)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn presence_payload(request: &PendingPresence, client_session_id: &str) -> Value {
    let (app_key, display_name, stable_since, detector_kind) = match &request.transition {
        Transition::Active {
            process_name,
            stable_since_ms,
            kind,
        } => (
            Some(format!("win32:{process_name}")),
            Some(process_name.trim_end_matches(".exe").to_string()),
            Some(iso_time(*stable_since_ms)),
            Some(kind.as_str()),
        ),
        Transition::Idle { .. } => (None, None, None, None),
    };
    json!({
        "protocolVersion": 1,
        "agentVersion": env!("CARGO_PKG_VERSION"),
        "clientEventId": request.client_event_id,
        "clientSessionId": client_session_id,
        "sequence": request.sequence,
        "state": request.presence_state,
        "appKey": app_key,
        "displayName": display_name,
        "stableSince": stable_since,
        "observedAt": iso_time(request.observed_at_ms),
        "detectorKind": detector_kind,
        "snapshotId": request.snapshot_id,
    })
}

fn ensure_identity_generation(
    state: &RuntimeState,
    expected_generation: u64,
) -> Result<(), ApiFailure> {
    if state.network_identity_revision() == expected_generation {
        Ok(())
    } else {
        Err(ApiFailure::configuration_changed())
    }
}

fn receiver_context_is_current(
    state: &RuntimeState,
    identity_generation: u64,
    receiver_generation: u64,
) -> bool {
    state.should_run()
        && !state.paused.load(Ordering::Relaxed)
        && state.network_identity_revision() == identity_generation
        && state.receiver_revision() == receiver_generation
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum EffectivePresenceState {
    Active,
    Idle,
    Hidden,
    Offline,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum PresencePostOutcome {
    Sent(EffectivePresenceState),
    Skipped,
}

fn parse_presence_effective_state(
    value: &Value,
    http_status: u32,
) -> Result<EffectivePresenceState, ApiFailure> {
    let state = value.pointer("/data/state").and_then(Value::as_str);
    match state {
        Some("active") => Ok(EffectivePresenceState::Active),
        Some("idle") => Ok(EffectivePresenceState::Idle),
        Some("hidden") => Ok(EffectivePresenceState::Hidden),
        Some("offline") => Ok(EffectivePresenceState::Offline),
        _ => Err(ApiFailure::new(
            "API_INCOMPATIBLE",
            "服务器返回了无效的 Presence 状态",
            Some(http_status),
            false,
            FailurePolicy::Unsupported,
        )),
    }
}

fn ensure_presence_context(
    state: &RuntimeState,
    identity_generation: u64,
    config_generation: u64,
) -> Result<(), ApiFailure> {
    ensure_identity_generation(state, identity_generation)?;
    if state.config_revision() != config_generation {
        Err(ApiFailure::configuration_changed())
    } else {
        Ok(())
    }
}

fn post_presence(
    state: &RuntimeState,
    request: &PendingPresence,
    client_session_id: &str,
    identity_generation: u64,
    config_generation: u64,
) -> Result<PresencePostOutcome, ApiFailure> {
    let profile = state.profile.read().unwrap().clone();
    ensure_presence_context(state, identity_generation, config_generation)?;
    let terminal_state = matches!(request.presence_state, "hidden" | "offline");
    if (!profile.feature_enabled || !profile.publish_enabled) && !terminal_state {
        return Ok(PresencePostOutcome::Skipped);
    }
    if state.paused.load(Ordering::Relaxed) && !terminal_state {
        return Ok(PresencePostOutcome::Skipped);
    }
    let token = profile_token(&profile).ok_or_else(|| {
        ApiFailure::new(
            "CREDENTIAL_INVALID",
            "提醒服务尚未完成配置",
            None,
            false,
            FailurePolicy::Credential,
        )
    })?;
    let payload = presence_payload(request, client_session_id);
    let body = serde_json::to_vec(&payload).map_err(|_| {
        ApiFailure::new(
            "API_INCOMPATIBLE",
            "无法生成提醒状态数据",
            None,
            false,
            FailurePolicy::Unsupported,
        )
    })?;
    if body.len() > 2 * 1024 {
        return Err(ApiFailure::new(
            "API_INCOMPATIBLE",
            "提醒状态数据超过大小限制",
            None,
            false,
            FailurePolicy::Unsupported,
        ));
    }
    let response = winhttp::request(
        "POST",
        &endpoint(&profile.server_url, "/api/activity/presence"),
        &auth_headers(&token, Some("application/json")),
        &body,
        10_000,
    )
    .map_err(|_| ApiFailure::network())?;
    let http_status = response.status;
    let value = strict_json(response)?;
    let effective_state = parse_presence_effective_state(&value, http_status)?;
    ensure_presence_context(state, identity_generation, config_generation)?;
    let current = state.profile.read().unwrap().clone();
    if (!current.feature_enabled
        || !current.publish_enabled
        || state.paused.load(Ordering::Relaxed))
        && !terminal_state
    {
        return Ok(PresencePostOutcome::Skipped);
    }
    Ok(PresencePostOutcome::Sent(effective_state))
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
    identity_generation: u64,
    config_generation: u64,
) -> Result<Option<String>, String> {
    let Transition::Active { process_name, .. } = transition else {
        return Ok(None);
    };
    let context_is_current = || {
        state.should_run()
            && !state.paused.load(Ordering::Relaxed)
            && state.network_identity_revision() == identity_generation
            && state.config_revision() == config_generation
    };
    if !context_is_current() {
        return Ok(None);
    }
    let profile = state.profile.read().unwrap().clone();
    if !profile.feature_enabled || !profile.publish_enabled || !profile.snapshot_enabled {
        return Ok(None);
    }
    let Some(snapshot) = capture_foreground_app(process_name, &profile)? else {
        return Ok(None);
    };
    if !context_is_current() {
        return Ok(None);
    }
    let token = profile_token(&profile).ok_or_else(|| "agent is not provisioned".to_string())?;
    let boundary = format!("neko-activity-{}-{}", std::process::id(), unix_ms());
    let body = multipart_snapshot_body(&format!("win32:{process_name}"), &snapshot, &boundary);
    if !context_is_current() {
        return Ok(None);
    }
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
    if !context_is_current() {
        return Ok(None);
    }
    let value = strict_json(response).map_err(|failure| failure.error.message)?;
    Ok(value
        .pointer("/data/snapshot/id")
        .and_then(Value::as_str)
        .map(str::to_string))
}

#[derive(Clone)]
struct PendingPresence {
    transition: Transition,
    sequence: u64,
    client_event_id: String,
    snapshot_id: Option<String>,
    presence_state: &'static str,
    observed_at_ms: u64,
}

fn make_presence(
    transition: Transition,
    sequence: u64,
    snapshot_id: Option<String>,
    presence_state: &'static str,
) -> PendingPresence {
    let observed_at_ms = unix_ms();
    PendingPresence {
        transition,
        sequence,
        client_event_id: format!("{}-{observed_at_ms}-{sequence}", std::process::id()),
        snapshot_id,
        presence_state,
        observed_at_ms,
    }
}

pub fn send_terminal_presence_best_effort(profile: &AgentProfile) {
    if !profile.feature_enabled || !profile.publish_enabled {
        return;
    }
    let Some(agent_token) = profile_token(profile) else {
        return;
    };
    let request = make_presence(
        Transition::Idle { at_ms: unix_ms() },
        unix_ms(),
        None,
        "offline",
    );
    let Ok(body) = serde_json::to_vec(&presence_payload(
        &request,
        &format!("{}-logout", std::process::id()),
    )) else {
        return;
    };
    let Ok(response) = winhttp::request(
        "POST",
        &endpoint(&profile.server_url, "/api/activity/presence"),
        &auth_headers(&agent_token, Some("application/json")),
        &body,
        1_500,
    ) else {
        return;
    };
    let _ = strict_json(response);
}

fn publisher_state_for_failure(failure: &ApiFailure) -> &'static str {
    match failure.policy {
        FailurePolicy::Credential => "credential_error",
        FailurePolicy::Unsupported | FailurePolicy::FeatureDisabled => "unsupported",
        FailurePolicy::Backoff | FailurePolicy::RetryAfter(_) => "retrying",
        FailurePolicy::ConfigurationChanged => "idle",
    }
}

fn transition_presence_state(transition: &Transition) -> &'static str {
    if matches!(transition, Transition::Active { .. }) {
        "active"
    } else {
        "idle"
    }
}

fn transition_app(transition: &Transition) -> Option<Value> {
    match transition {
        Transition::Active {
            process_name,
            stable_since_ms,
            kind,
        } => Some(json!({
            "appKey": format!("win32:{process_name}"),
            "displayName": process_name.trim_end_matches(".exe"),
            "stableSinceMs": stable_since_ms,
            "detectorKind": kind.as_str(),
        })),
        Transition::Idle { .. } => None,
    }
}

fn mark_publisher_pending(state: &RuntimeState) {
    state.update_publisher(|health| {
        health.state = "idle".into();
        health.current_app = None;
    });
}

fn apply_presence_success(
    state: &RuntimeState,
    request: &PendingPresence,
    effective_state: EffectivePresenceState,
) {
    let active = effective_state == EffectivePresenceState::Active;
    state.update_publisher(|health| {
        health.state = if active { "online" } else { "idle" }.into();
        health.current_app = if active {
            transition_app(&request.transition)
        } else {
            None
        };
        health.last_success_at_ms = Some(unix_ms());
        health.consecutive_failures = 0;
        health.next_retry_at_ms = None;
        health.last_error = None;
    });
}

pub fn run_presence_loop(state: Arc<RuntimeState>, receiver: Receiver<Transition>) {
    let mut current: Option<Transition> = None;
    // The server keeps the last sequence per device across Agent restarts.
    let mut sequence = unix_ms();
    let mut last_sent = Instant::now() - Duration::from_secs(30);
    let mut pause_sent = false;
    let mut client_session_id = format!("{}-{}", std::process::id(), unix_ms());
    let mut failure_index = 0usize;
    let mut pending: Option<PendingPresence> = None;
    let mut generation = state.config_revision();
    let mut retry_at: Option<Instant> = None;
    let mut blocked_generation: Option<u64> = None;
    let mut identity_generation = state.network_identity_revision();
    let initial_profile = state.profile.read().unwrap().clone();
    let mut publishing_active = initial_profile.feature_enabled && initial_profile.publish_enabled;

    while state.should_run() {
        let next_identity_generation = state.network_identity_revision();
        if next_identity_generation != identity_generation {
            identity_generation = next_identity_generation;
            // A pending request, session id, or queued transition may belong to the previous
            // account/server. Drop all of them before creating a fresh logical request.
            pending = None;
            current = None;
            while receiver.try_recv().is_ok() {}
            client_session_id = format!("{}-{}", std::process::id(), unix_ms());
            failure_index = 0;
            retry_at = None;
            blocked_generation = None;
            pause_sent = false;
            last_sent = Instant::now() - Duration::from_secs(30);
            state.update_publisher(|health| {
                health.state = "idle".into();
                health.current_app = None;
                health.consecutive_failures = 0;
                health.next_retry_at_ms = None;
                health.last_error = None;
            });
            // The detector is account-independent. Re-snapshot its current stable result into
            // a new session/request rather than reusing any old-account pending payload.
            let latest = state.latest_transition.lock().unwrap().clone();
            if !state.paused.load(Ordering::Relaxed) {
                if let Some(transition) = latest {
                    sequence = sequence.saturating_add(1);
                    pending = Some(make_presence(
                        transition.clone(),
                        sequence,
                        None,
                        transition_presence_state(&transition),
                    ));
                    mark_publisher_pending(&state);
                    current = Some(transition);
                }
            }
        }
        if let Ok(transition) = receiver.recv_timeout(Duration::from_millis(500)) {
            if state.network_identity_revision() != identity_generation {
                continue;
            }
            if state.paused.load(Ordering::Relaxed) {
                pending = None;
                current = None;
                while receiver.try_recv().is_ok() {}
            } else {
                let transition_generation = state.config_revision();
                let snapshot_id = upload_snapshot_for_transition(
                    &state,
                    &transition,
                    identity_generation,
                    transition_generation,
                )
                .ok()
                .flatten();
                if state.network_identity_revision() != identity_generation
                    || state.config_revision() != transition_generation
                    || state.paused.load(Ordering::Relaxed)
                {
                    pending = None;
                    current = None;
                    continue;
                }
                sequence = sequence.saturating_add(1);
                pending = Some(make_presence(
                    transition.clone(),
                    sequence,
                    snapshot_id,
                    transition_presence_state(&transition),
                ));
                mark_publisher_pending(&state);
                current = Some(transition);
            }
        }

        let profile = state.profile.read().unwrap().clone();
        let revision = state.config_revision();
        if revision != generation {
            generation = revision;
            failure_index = 0;
            retry_at = None;
            blocked_generation = None;
            if pending.is_none()
                && current.is_none()
                && profile.feature_enabled
                && profile.publish_enabled
                && !state.paused.load(Ordering::Relaxed)
            {
                if let Some(transition) = state.latest_transition.lock().unwrap().clone() {
                    sequence = sequence.saturating_add(1);
                    pending = Some(make_presence(
                        transition.clone(),
                        sequence,
                        None,
                        transition_presence_state(&transition),
                    ));
                    mark_publisher_pending(&state);
                    current = Some(transition);
                }
            }
        }
        let should_publish = profile.feature_enabled && profile.publish_enabled;
        if publishing_active && !should_publish {
            sequence = sequence.saturating_add(1);
            let terminal = make_presence(
                Transition::Idle { at_ms: unix_ms() },
                sequence,
                None,
                if profile.feature_enabled {
                    "hidden"
                } else {
                    "offline"
                },
            );
            let _ = post_presence(
                &state,
                &terminal,
                &client_session_id,
                identity_generation,
                generation,
            );
        }
        if !publishing_active && should_publish {
            let latest = state.latest_transition.lock().unwrap().clone();
            if let Some(transition) = latest {
                sequence = sequence.saturating_add(1);
                pending = Some(make_presence(
                    transition.clone(),
                    sequence,
                    None,
                    transition_presence_state(&transition),
                ));
                mark_publisher_pending(&state);
                current = Some(transition);
            }
            last_sent = Instant::now() - Duration::from_secs(30);
        }
        publishing_active = should_publish;
        if !should_publish {
            pending = None;
            current = None;
            state.update_publisher(|health| {
                health.state = "disabled".into();
                health.current_app = None;
                health.consecutive_failures = 0;
                health.next_retry_at_ms = None;
                health.last_error = None;
            });
            continue;
        }

        if state.paused.load(Ordering::Relaxed) {
            pending = None;
            current = None;
            while receiver.try_recv().is_ok() {}
            state.update_publisher(|health| {
                health.state = "paused".into();
                health.current_app = None;
                health.consecutive_failures = 0;
                health.next_retry_at_ms = None;
                health.last_error = None;
            });
            if !pause_sent {
                sequence = sequence.saturating_add(1);
                let hidden = make_presence(
                    Transition::Idle { at_ms: unix_ms() },
                    sequence,
                    None,
                    "hidden",
                );
                let _ = post_presence(
                    &state,
                    &hidden,
                    &client_session_id,
                    identity_generation,
                    generation,
                );
                pause_sent = true;
            }
            continue;
        }
        pause_sent = false;

        if pending.is_none() && last_sent.elapsed() >= Duration::from_secs(10) {
            if let Some(transition) = current.clone() {
                sequence = sequence.saturating_add(1);
                pending = Some(make_presence(transition, sequence, None, "heartbeat"));
            }
        }
        let Some(request) = pending.as_ref() else {
            state.update_publisher(|health| {
                if health.state != "online" {
                    health.state = "idle".into();
                }
            });
            continue;
        };
        if blocked_generation == Some(generation) {
            continue;
        }
        if retry_at.is_some_and(|retry_at| Instant::now() < retry_at) {
            continue;
        }
        retry_at = None;

        match post_presence(
            &state,
            request,
            &client_session_id,
            identity_generation,
            generation,
        ) {
            Ok(PresencePostOutcome::Sent(effective_state)) => {
                apply_presence_success(&state, request, effective_state);
                last_sent = Instant::now();
                failure_index = 0;
                blocked_generation = None;
                pending = None;
            }
            Ok(PresencePostOutcome::Skipped) => continue,
            Err(failure) if failure.policy == FailurePolicy::ConfigurationChanged => continue,
            Err(failure) => {
                let delay = retry_delay(&failure, failure_index, unix_ms());
                state.update_publisher(|health| {
                    health.state = publisher_state_for_failure(&failure).into();
                    health.consecutive_failures = health.consecutive_failures.saturating_add(1);
                    health.next_retry_at_ms = retry_at_ms(delay);
                    health.last_error = Some(failure.error.clone());
                });
                if matches!(failure.policy, FailurePolicy::Backoff) {
                    failure_index = (failure_index + 1).min(RETRY_DELAYS.len() - 1);
                }
                if delay == Duration::MAX {
                    blocked_generation = Some(generation);
                } else {
                    retry_at = Some(Instant::now() + delay);
                }
            }
        }
    }

    if current.is_some() {
        sequence = sequence.saturating_add(1);
        let offline = make_presence(
            Transition::Idle { at_ms: unix_ms() },
            sequence,
            None,
            "offline",
        );
        let _ = post_presence(
            &state,
            &offline,
            &client_session_id,
            identity_generation,
            generation,
        );
    }
}

fn json_get(server_url: &str, token: &str, path: &str) -> Result<Value, ApiFailure> {
    let response = winhttp::request(
        "GET",
        &endpoint(server_url, path),
        &auth_headers(token, Some("application/json")),
        &[],
        15_000,
    )
    .map_err(|_| ApiFailure::network())?;
    strict_json(response)
}

fn bootstrap_cursor(server_url: &str, token: &str) -> Result<String, ApiFailure> {
    let value = json_get(server_url, token, "/api/activity/agent/bootstrap")?;
    let data = value
        .get("data")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            ApiFailure::new(
                "API_INCOMPATIBLE",
                "服务器返回了不完整的提醒配置",
                Some(200),
                false,
                FailurePolicy::Unsupported,
            )
        })?;
    Ok(data
        .get("latestEventId")
        .and_then(Value::as_str)
        .unwrap_or("0")
        .to_string())
}

fn save_cursor(state: &RuntimeState, cursor: &str, identity_generation: u64) {
    if !state.should_run() {
        return;
    }
    let mut profile = state.profile.write().unwrap();
    if !state.should_run() || state.network_identity_revision() != identity_generation {
        return;
    }
    if profile.event_cursor == cursor {
        return;
    }
    profile.event_cursor = cursor.to_string();
    let snapshot = profile.clone();
    let _ = save_profile(&snapshot);
    drop(profile);
}

fn notification_cache_dir(profile: &AgentProfile) -> PathBuf {
    let configured = profile.snapshot_cache_dir.clone();
    if configured.trim().is_empty() {
        profile_dir().join("notification-images")
    } else {
        PathBuf::from(configured).join("notification-images")
    }
}

fn private_cache_dirs(profile: &AgentProfile) -> Vec<PathBuf> {
    let mut directories = vec![profile_dir().join("notification-images")];
    if !profile.snapshot_cache_dir.trim().is_empty() {
        let configured = PathBuf::from(&profile.snapshot_cache_dir).join("notification-images");
        if !directories.contains(&configured) {
            directories.push(configured);
        }
    }
    directories
}

pub fn purge_private_cache(profile: &AgentProfile) {
    for directory in private_cache_dirs(profile) {
        // Only the fixed Agent-owned child is eligible; never remove the configured root.
        if directory.file_name().and_then(|name| name.to_str()) == Some("notification-images") {
            let _ = fs::remove_dir_all(directory);
        }
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
    profile: &AgentProfile,
    token: &str,
    value: &str,
    cache_stem: &str,
    role: &str,
) -> Option<PathBuf> {
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
    let cache_dir = notification_cache_dir(profile);
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

fn show_activity_notification(
    state: &RuntimeState,
    event: &Value,
    identity_generation: u64,
) -> Result<bool, String> {
    if !should_notify_event(event, unix_ms()) {
        return Ok(false);
    }
    let profile = state.profile.read().unwrap().clone();
    if state.network_identity_revision() != identity_generation {
        return Ok(false);
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
    let cache_dir = notification_cache_dir(&profile);
    let _ = fs::create_dir_all(&cache_dir);
    cleanup_notification_cache(&cache_dir, Duration::from_secs(48 * 60 * 60));
    let event_id = safe_cache_stem(event.get("id").and_then(Value::as_str).unwrap_or(""));
    let agent_token = profile_token(&profile);
    let avatar = event
        .pointer("/payload/target/avatar")
        .and_then(Value::as_str)
        .and_then(|url| {
            agent_token.as_deref().and_then(|current| {
                download_notification_image(&profile, current, url, &event_id, "avatar")
            })
        });
    let hero = event_snapshot_url(event).and_then(|url| {
        agent_token.as_deref().and_then(|current| {
            download_notification_image(&profile, current, url, &event_id, "hero")
        })
    });
    if state.network_identity_revision() != identity_generation {
        return Ok(false);
    }
    let app_user_model_id = if crate::config::is_dev_channel() {
        "com.koirin.neko-status.dev"
    } else {
        "com.koirin.neko-status"
    };
    let mut toast = Toast::new(app_user_model_id)
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
    toast
        .show()
        .map(|_| true)
        .map_err(|error| format!("Windows Toast 投递失败: {error}"))
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
    let base_ms = base_secs.saturating_mul(1000);
    let spread = base_ms / 5;
    let width = spread.saturating_mul(2).saturating_add(1);
    let jitter_ms = (now_ms % width) as i64 - spread as i64;
    let delay_ms = base_ms as i64 + jitter_ms;
    delay_ms.max(1) as u64
}

fn remember_event_in_profile(profile: &mut AgentProfile, event_id: &str) -> bool {
    if event_id.is_empty() || event_id.len() > 512 {
        return true;
    }
    if profile
        .recent_event_ids
        .iter()
        .any(|existing| existing == event_id)
    {
        return false;
    }
    profile.recent_event_ids.push(event_id.to_string());
    if profile.recent_event_ids.len() > 128 {
        let excess = profile.recent_event_ids.len() - 128;
        profile.recent_event_ids.drain(..excess);
    }
    profile.event_cursor = event_id.to_string();
    true
}

fn remember_event(state: &RuntimeState, event_id: &str, identity_generation: u64) -> bool {
    if event_id.is_empty() || event_id.len() > 512 {
        return true;
    }
    if !state.should_run() {
        return false;
    }
    let mut profile = state.profile.write().unwrap();
    if !state.should_run() || state.network_identity_revision() != identity_generation {
        return false;
    }
    if !remember_event_in_profile(&mut profile, event_id) {
        return false;
    }
    let snapshot = profile.clone();
    let _ = save_profile(&snapshot);
    drop(profile);
    true
}

fn consume_event(state: &RuntimeState, event: &Value, event_id: &str, identity_generation: u64) {
    if !remember_event(state, event_id, identity_generation) {
        return;
    }
    if state.network_identity_revision() != identity_generation {
        return;
    }
    if state.profile.read().unwrap().notifications_enabled {
        let _ = show_activity_notification(state, event, identity_generation);
    }
}

fn connection_reset_cursor(event: &Value, event_id: &str) -> Option<String> {
    if event.get("type").and_then(Value::as_str) != Some("activity.connection_reset") {
        return None;
    }
    event
        .get("cursor")
        .and_then(Value::as_str)
        .or_else(|| event.pointer("/data/cursor").and_then(Value::as_str))
        .or_else(|| event.pointer("/payload/cursor").and_then(Value::as_str))
        .filter(|cursor| !cursor.is_empty())
        .or_else(|| (!event_id.is_empty()).then_some(event_id))
        .map(str::to_string)
}

fn poll_reset_cursor(data: &serde_json::Map<String, Value>) -> Result<Option<String>, ApiFailure> {
    let reset = match data.get("reset") {
        None | Some(Value::Null) | Some(Value::Bool(false)) => return Ok(None),
        Some(Value::Bool(true)) => data.get("cursor").and_then(Value::as_str),
        Some(Value::Object(reset)) => reset
            .get("cursor")
            .and_then(Value::as_str)
            .or_else(|| data.get("cursor").and_then(Value::as_str)),
        Some(_) => {
            return Err(ApiFailure::new(
                "API_INCOMPATIBLE",
                "提醒事件游标重置字段格式无效",
                Some(200),
                false,
                FailurePolicy::Unsupported,
            ));
        }
    };
    reset
        .filter(|cursor| !cursor.is_empty())
        .map(|cursor| Some(cursor.to_string()))
        .ok_or_else(|| {
            ApiFailure::new(
                "API_INCOMPATIBLE",
                "提醒事件游标重置响应缺少新游标",
                Some(200),
                false,
                FailurePolicy::Unsupported,
            )
        })
}

#[derive(Debug)]
enum PollPageAction<'a> {
    Reset(String),
    Event(&'a Value),
}

#[derive(Debug)]
struct PollPagePlan<'a> {
    actions: Vec<PollPageAction<'a>>,
    next_cursor: String,
    has_more: bool,
}

fn plan_poll_page<'a>(
    data: &'a serde_json::Map<String, Value>,
    previous_cursor: &str,
) -> Result<PollPagePlan<'a>, ApiFailure> {
    let events = data
        .get("events")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            ApiFailure::new(
                "API_INCOMPATIBLE",
                "服务器返回了不完整的提醒事件列表",
                Some(200),
                false,
                FailurePolicy::Unsupported,
            )
        })?;
    let has_more = data
        .get("hasMore")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut actions = Vec::with_capacity(events.len().saturating_add(1));
    let mut next_cursor = previous_cursor.to_string();

    if let Some(reset_cursor) = poll_reset_cursor(data)? {
        next_cursor = reset_cursor.clone();
        actions.push(PollPageAction::Reset(reset_cursor));
    } else {
        let mut event_reset_seen = false;
        for event in events {
            let id = event.get("id").and_then(Value::as_str).unwrap_or("");
            if let Some(reset_cursor) = connection_reset_cursor(event, id) {
                event_reset_seen = true;
                next_cursor = reset_cursor.clone();
                actions.push(PollPageAction::Reset(reset_cursor));
                continue;
            }
            if !id.is_empty() {
                next_cursor = id.to_string();
            }
            actions.push(PollPageAction::Event(event));
        }
        if !event_reset_seen {
            if let Some(response_cursor) = data.get("cursor").and_then(Value::as_str) {
                next_cursor = response_cursor.to_string();
            }
        }
    }

    if has_more && next_cursor == previous_cursor {
        return Err(ApiFailure::new(
            "API_INCOMPATIBLE",
            "提醒事件分页游标没有前进",
            Some(200),
            false,
            FailurePolicy::Unsupported,
        ));
    }

    Ok(PollPagePlan {
        actions,
        next_cursor,
        has_more,
    })
}

fn poll_events(
    state: &RuntimeState,
    server_url: &str,
    token: &str,
    identity_generation: u64,
    receiver_generation: u64,
) -> Result<(), ApiFailure> {
    let mut cursor = state.profile.read().unwrap().event_cursor.clone();
    for _ in 0..128 {
        if !receiver_context_is_current(state, identity_generation, receiver_generation) {
            return Err(ApiFailure::configuration_changed());
        }
        let value = json_get(
            server_url,
            token,
            &format!(
                "/api/activity/events?after={}",
                encode_query_component(&cursor)
            ),
        )?;
        if !receiver_context_is_current(state, identity_generation, receiver_generation) {
            return Err(ApiFailure::configuration_changed());
        }
        let data = value
            .get("data")
            .and_then(Value::as_object)
            .ok_or_else(|| {
                ApiFailure::new(
                    "API_INCOMPATIBLE",
                    "服务器返回了不完整的提醒事件数据",
                    Some(200),
                    false,
                    FailurePolicy::Unsupported,
                )
            })?;
        let previous_cursor = cursor.clone();
        let PollPagePlan {
            actions,
            next_cursor,
            has_more,
        } = plan_poll_page(data, &previous_cursor)?;
        for action in actions {
            match action {
                PollPageAction::Reset(reset_cursor) => {
                    cursor = reset_cursor;
                    save_cursor(state, &cursor, identity_generation);
                    state.update_receiver(|health| health.last_heartbeat_at_ms = Some(unix_ms()));
                }
                PollPageAction::Event(event) => {
                    let id = event.get("id").and_then(Value::as_str).unwrap_or("");
                    consume_event(state, event, id, identity_generation);
                    state.update_receiver(|health| health.last_event_at_ms = Some(unix_ms()));
                }
            }
        }
        cursor = next_cursor;
        if cursor != previous_cursor {
            save_cursor(state, &cursor, identity_generation);
        }
        if !has_more {
            return Ok(());
        }
    }
    Err(ApiFailure::new(
        "API_TRANSIENT",
        "提醒事件积压较多，将继续追赶",
        None,
        true,
        FailurePolicy::Backoff,
    ))
}

#[derive(Default)]
struct SseParser {
    last_event_id: String,
    data_lines: Vec<String>,
    cursor_changed: bool,
}

enum SseItem {
    Heartbeat,
    Cursor(String),
    Event { id: String, data: String },
}

impl SseParser {
    fn with_last_event_id(last_event_id: String) -> Self {
        Self {
            last_event_id,
            ..Self::default()
        }
    }

    fn feed(&mut self, line: &str) -> Option<SseItem> {
        if line.is_empty() {
            if self.data_lines.is_empty() {
                return self.cursor_changed.then(|| {
                    self.cursor_changed = false;
                    SseItem::Cursor(self.last_event_id.clone())
                });
            }
            self.cursor_changed = false;
            return Some(SseItem::Event {
                id: self.last_event_id.clone(),
                data: std::mem::take(&mut self.data_lines).join("\n"),
            });
        }
        if line.starts_with(':') {
            return Some(SseItem::Heartbeat);
        }
        let (field, mut value) = line.split_once(':').unwrap_or((line, ""));
        if let Some(stripped) = value.strip_prefix(' ') {
            value = stripped;
        }
        match field {
            "data" => self.data_lines.push(value.to_string()),
            "id" if !value.contains('\0') => {
                self.last_event_id = value.to_string();
                self.cursor_changed = true;
            }
            _ => {}
        }
        None
    }
}

fn receiver_state_for_failure(failure: &ApiFailure) -> &'static str {
    match failure.policy {
        FailurePolicy::Credential => "credential_error",
        FailurePolicy::Unsupported | FailurePolicy::FeatureDisabled => "unsupported",
        FailurePolicy::Backoff | FailurePolicy::RetryAfter(_) => "retrying",
        FailurePolicy::ConfigurationChanged => "connecting",
    }
}

fn set_receiver_failure(
    state: &RuntimeState,
    failure: &ApiFailure,
    delay: Duration,
    transport: Option<&str>,
) {
    state.update_receiver(|health| {
        health.state = receiver_state_for_failure(failure).into();
        health.transport = transport.map(str::to_string);
        health.consecutive_failures = health.consecutive_failures.saturating_add(1);
        health.next_retry_at_ms = retry_at_ms(delay);
        health.last_error = Some(failure.error.clone());
    });
}

fn stream_attempt_was_stable(open_duration: Duration) -> bool {
    open_duration >= Duration::from_secs(30)
}

pub fn run_event_loop(state: Arc<RuntimeState>) {
    let mut first_bootstrap = true;
    let mut sse_failures = 0usize;
    let mut polling_failures = 0usize;
    let mut generation = state.receiver_revision();
    let mut identity_generation = state.network_identity_revision();
    let mut next_sse_probe = Instant::now();

    while state.should_run() {
        let current_generation = state.receiver_revision();
        if current_generation != generation {
            generation = current_generation;
            sse_failures = 0;
            polling_failures = 0;
            next_sse_probe = Instant::now();
        }
        let current_identity_generation = state.network_identity_revision();
        if current_identity_generation != identity_generation {
            identity_generation = current_identity_generation;
            first_bootstrap = true;
            sse_failures = 0;
            polling_failures = 0;
            next_sse_probe = Instant::now();
        }
        let profile = state.profile.read().unwrap().clone();
        if !profile.feature_enabled {
            state.update_receiver(|health| {
                health.state = "disabled".into();
                health.transport = None;
                health.consecutive_failures = 0;
                health.next_retry_at_ms = None;
                health.last_error = None;
            });
            thread::sleep(Duration::from_millis(500));
            continue;
        }
        if state.paused.load(Ordering::Relaxed) {
            state.update_receiver(|health| {
                health.state = "paused".into();
                health.transport = None;
                health.next_retry_at_ms = None;
            });
            thread::sleep(Duration::from_millis(250));
            continue;
        }
        let Some(agent_token) = profile_token(&profile) else {
            let failure = ApiFailure::new(
                "CREDENTIAL_INVALID",
                "提醒服务尚未完成配置",
                None,
                false,
                FailurePolicy::Credential,
            );
            set_receiver_failure(&state, &failure, Duration::MAX, None);
            sleep_receiver_interruptibly(&state, Duration::MAX, generation);
            continue;
        };

        if first_bootstrap {
            state.update_receiver(|health| {
                health.state = "connecting".into();
                health.transport = Some("sse".into());
                health.next_retry_at_ms = None;
            });
            match bootstrap_cursor(&profile.server_url, &agent_token) {
                Ok(cursor) => {
                    if !receiver_context_is_current(&state, identity_generation, generation) {
                        continue;
                    }
                    if profile.event_cursor.is_empty() || profile.event_cursor == "0" {
                        save_cursor(&state, &cursor, identity_generation);
                    }
                    first_bootstrap = false;
                    sse_failures = 0;
                }
                Err(failure) => {
                    let delay = retry_delay(&failure, sse_failures, unix_ms());
                    set_receiver_failure(&state, &failure, delay, None);
                    if matches!(failure.policy, FailurePolicy::Backoff) {
                        sse_failures = (sse_failures + 1).min(RETRY_DELAYS.len());
                    }
                    sleep_receiver_interruptibly(&state, delay, generation);
                    continue;
                }
            }
        }

        if sse_failures >= 2 && Instant::now() < next_sse_probe {
            let mut polling_delay = Duration::from_secs(5);
            match poll_events(
                &state,
                &profile.server_url,
                &agent_token,
                identity_generation,
                generation,
            ) {
                Ok(()) => {
                    polling_failures = 0;
                    state.update_receiver(|health| {
                        health.state = "polling".into();
                        health.transport = Some("polling".into());
                        health.next_retry_at_ms = Some(
                            unix_ms().saturating_add(
                                next_sse_probe
                                    .saturating_duration_since(Instant::now())
                                    .as_millis()
                                    .min(u64::MAX as u128) as u64,
                            ),
                        );
                        health.last_error = None;
                    });
                }
                Err(failure) if failure.policy == FailurePolicy::ConfigurationChanged => continue,
                Err(failure) => {
                    let delay = retry_delay(&failure, polling_failures, unix_ms());
                    polling_delay = delay;
                    set_receiver_failure(&state, &failure, delay, Some("polling"));
                    if matches!(failure.policy, FailurePolicy::Backoff) {
                        polling_failures = (polling_failures + 1).min(RETRY_DELAYS.len());
                    }
                    if !matches!(failure.policy, FailurePolicy::Backoff) {
                        next_sse_probe = if delay == Duration::MAX {
                            Instant::now() + Duration::from_secs(365 * 24 * 60 * 60)
                        } else {
                            Instant::now() + delay
                        };
                    }
                }
            }
            let until_probe = next_sse_probe.saturating_duration_since(Instant::now());
            sleep_receiver_interruptibly(&state, polling_delay.min(until_probe), generation);
            continue;
        }

        let stream_profile = state.profile.read().unwrap().clone();
        if !receiver_context_is_current(&state, identity_generation, generation) {
            continue;
        }
        let Some(stream_token) = profile_token(&stream_profile) else {
            continue;
        };
        let cursor = stream_profile.event_cursor.clone();
        let url = format!(
            "{}?after={}",
            endpoint(&stream_profile.server_url, "/api/activity/events/stream"),
            encode_query_component(&cursor)
        );
        let mut stream_headers = auth_headers(&stream_token, None);
        stream_headers.push(("Accept", "text/event-stream".into()));
        if !cursor.is_empty() && cursor != "0" {
            stream_headers.push(("Last-Event-ID", cursor.clone()));
        }
        let mut parser = SseParser::with_last_event_id(cursor.clone());
        let invalid_event = AtomicBool::new(false);
        let mut stream_opened_at: Option<Instant> = None;
        state.update_receiver(|health| {
            health.state = "connecting".into();
            health.transport = Some("sse".into());
            health.next_retry_at_ms = None;
        });
        let result = winhttp::stream_lines(
            &url,
            &stream_headers,
            |line| {
                if !receiver_context_is_current(&state, identity_generation, generation) {
                    return;
                }
                match parser.feed(line) {
                    Some(SseItem::Heartbeat) => {
                        state.update_receiver(|health| {
                            health.last_heartbeat_at_ms = Some(unix_ms());
                        });
                    }
                    Some(SseItem::Cursor(id)) => {
                        save_cursor(&state, &id, identity_generation);
                        state.update_receiver(|health| {
                            health.last_heartbeat_at_ms = Some(unix_ms());
                        });
                    }
                    Some(SseItem::Event { id, data }) => {
                        if let Ok(event) = serde_json::from_str::<Value>(&data) {
                            if let Some(reset_cursor) = connection_reset_cursor(&event, &id) {
                                parser.last_event_id = reset_cursor.clone();
                                save_cursor(&state, &reset_cursor, identity_generation);
                                state.update_receiver(|health| {
                                    health.last_heartbeat_at_ms = Some(unix_ms());
                                });
                            } else {
                                consume_event(&state, &event, &id, identity_generation);
                                state.update_receiver(|health| {
                                    health.last_event_at_ms = Some(unix_ms());
                                    health.last_heartbeat_at_ms = Some(unix_ms());
                                });
                            }
                        } else {
                            invalid_event.store(true, Ordering::Relaxed);
                        }
                    }
                    None => {}
                }
            },
            |_| {
                if !receiver_context_is_current(&state, identity_generation, generation) {
                    return;
                }
                stream_opened_at = Some(Instant::now());
                state.update_receiver(|health| {
                    health.state = "connected".into();
                    health.transport = Some("sse".into());
                    health.last_connected_at_ms = Some(unix_ms());
                    health.consecutive_failures = 0;
                    health.next_retry_at_ms = None;
                    health.last_error = None;
                });
            },
            || {
                receiver_context_is_current(&state, identity_generation, generation)
                    && !invalid_event.load(Ordering::Relaxed)
            },
        );

        if !receiver_context_is_current(&state, identity_generation, generation) {
            continue;
        }
        if stream_opened_at.is_some_and(|opened_at| stream_attempt_was_stable(opened_at.elapsed()))
        {
            sse_failures = 0;
            polling_failures = 0;
        }
        let failure = if invalid_event.load(Ordering::Relaxed) {
            ApiFailure::new(
                "API_INCOMPATIBLE",
                "服务器推送了无法识别的提醒事件",
                Some(200),
                false,
                FailurePolicy::Unsupported,
            )
        } else {
            match result {
                Err(_) => ApiFailure::network(),
                Ok(response) => {
                    let head = response.head;
                    let server_failure =
                        winhttp::is_content_type(&head.content_type, "application/json")
                            .then(|| serde_json::from_slice::<Value>(&response.error_body).ok())
                            .flatten()
                            .and_then(|value| envelope_failure(head.status, &value));
                    if let Some(failure) = server_failure {
                        failure
                    } else if let Err(failure) = classify_response(
                        head.status,
                        &head.content_type,
                        head.retry_after.as_deref(),
                        "text/event-stream",
                    ) {
                        failure
                    } else {
                        // A healthy SSE response is expected to remain open. Clean EOF is a disconnect.
                        ApiFailure::new(
                            "API_TRANSIENT",
                            "提醒连接已中断，正在恢复",
                            Some(head.status),
                            true,
                            FailurePolicy::Backoff,
                        )
                    }
                }
            }
        };
        let delay = retry_delay(&failure, sse_failures, unix_ms());
        set_receiver_failure(&state, &failure, delay, Some("sse"));
        if matches!(
            failure.policy,
            FailurePolicy::Backoff | FailurePolicy::RetryAfter(_)
        ) {
            sse_failures = (sse_failures + 1).min(RETRY_DELAYS.len());
        }
        next_sse_probe = if delay == Duration::MAX {
            // Never reached while the same credential/config generation remains active.
            Instant::now() + Duration::from_secs(365 * 24 * 60 * 60)
        } else {
            Instant::now() + delay
        };
        if sse_failures < 2 || !matches!(failure.policy, FailurePolicy::Backoff) {
            sleep_receiver_interruptibly(&state, delay, generation);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        absolute_image_url, apply_presence_success, cleanup_notification_cache,
        connection_reset_cursor, decode_data_image, encode_query_component,
        ensure_identity_generation, event_snapshot_url, image_extension, jittered_delay_ms,
        make_presence, mark_publisher_pending, multipart_snapshot_body,
        parse_presence_effective_state, plan_poll_page, poll_reset_cursor, post_presence,
        presence_payload, private_cache_dirs, receiver_context_is_current,
        remember_event_in_profile, retry_after_seconds, retry_delay, safe_cache_stem,
        should_notify_event, show_activity_notification, stream_attempt_was_stable, strict_json,
        ApiFailure, EffectivePresenceState, FailurePolicy, PollPageAction, PresencePostOutcome,
        SseItem, SseParser, RETRY_DELAYS,
    };
    use crate::{
        config::AgentProfile,
        detector::{DetectorKind, Transition},
        snapshot::CapturedSnapshot,
        winhttp::Response,
    };
    use serde_json::{json, Value};
    use std::{
        fs,
        io::{Read, Write},
        net::TcpListener,
        sync::atomic::{AtomicBool, Ordering},
        thread,
        time::Duration,
    };

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
    fn connection_reset_events_advance_without_becoming_notifications() {
        let nested = json!({
            "type": "activity.connection_reset",
            "data": { "cursor": "checkpoint-200" },
            "createdAtMs": 1_000_000
        });
        assert_eq!(
            connection_reset_cursor(&nested, "control-event-1").as_deref(),
            Some("checkpoint-200")
        );
        assert!(!should_notify_event(&nested, 1_000_000));

        let fallback = json!({ "type": "activity.connection_reset" });
        assert_eq!(
            connection_reset_cursor(&fallback, "checkpoint-201").as_deref(),
            Some("checkpoint-201")
        );
        assert!(
            connection_reset_cursor(&json!({ "type": "activity.entered" }), "event-1").is_none()
        );
    }

    #[test]
    fn poll_reset_objects_advance_the_checkpoint_without_using_events() {
        let object = json!({
            "events": [{ "id": "must-not-be-consumed", "type": "activity.entered" }],
            "cursor": "checkpoint-300",
            "hasMore": false,
            "reset": { "reason": "cursor_expired", "cursor": "checkpoint-300" }
        });
        assert_eq!(
            poll_reset_cursor(object.as_object().unwrap())
                .unwrap()
                .as_deref(),
            Some("checkpoint-300")
        );

        let legacy = json!({ "events": [], "cursor": "checkpoint-301", "reset": true });
        assert_eq!(
            poll_reset_cursor(legacy.as_object().unwrap())
                .unwrap()
                .as_deref(),
            Some("checkpoint-301")
        );

        let normal = json!({ "events": [], "cursor": "checkpoint-302", "reset": false });
        assert!(poll_reset_cursor(normal.as_object().unwrap())
            .unwrap()
            .is_none());
    }

    #[test]
    fn poll_pages_follow_has_more_and_resume_from_a_reset_checkpoint() {
        let pages = [
            json!({
                "events": [{ "id": "must-not-be-consumed", "type": "activity.entered" }],
                "cursor": "checkpoint-300",
                "hasMore": true,
                "reset": { "reason": "cursor_expired", "cursor": "checkpoint-300" }
            }),
            json!({
                "events": [{ "id": "event-301", "type": "activity.entered" }],
                "cursor": "event-301",
                "hasMore": true
            }),
            json!({
                "events": [{ "id": "event-302", "type": "activity.entered" }],
                "cursor": "event-302",
                "hasMore": false
            }),
        ];
        let mut cursor = "expired-cursor".to_string();
        let mut requested_after = Vec::new();
        let mut reset_checkpoints = Vec::new();
        let mut consumed_event_ids = Vec::new();

        for page in pages {
            requested_after.push(cursor.clone());
            let plan = plan_poll_page(page.as_object().unwrap(), &cursor).unwrap();
            for action in &plan.actions {
                match action {
                    PollPageAction::Reset(next) => reset_checkpoints.push(next.clone()),
                    PollPageAction::Event(event) => consumed_event_ids.push(
                        event
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    ),
                }
            }
            cursor = plan.next_cursor;
            if !plan.has_more {
                break;
            }
        }

        assert_eq!(
            requested_after,
            ["expired-cursor", "checkpoint-300", "event-301"]
        );
        assert_eq!(reset_checkpoints, ["checkpoint-300"]);
        assert_eq!(consumed_event_ids, ["event-301", "event-302"]);
        assert_eq!(cursor, "event-302");

        let stalled = json!({
            "events": [],
            "cursor": "event-302",
            "hasMore": true
        });
        let failure = plan_poll_page(stalled.as_object().unwrap(), &cursor).unwrap_err();
        assert_eq!(failure.error.code, "API_INCOMPATIBLE");
        assert_eq!(failure.policy, FailurePolicy::Unsupported);
    }

    #[test]
    fn retry_jitter_stays_in_expected_window() {
        for now in [0, 1, 200, 400, 123_456] {
            let delay = jittered_delay_ms(10, now);
            assert!((8_000..=12_000).contains(&delay));
        }
    }

    #[test]
    fn event_cursors_are_encoded_as_single_query_components() {
        assert_eq!(encode_query_component("event-42_~.ok"), "event-42_~.ok");
        assert_eq!(
            encode_query_component("folder/cursor+value== 中文"),
            "folder%2Fcursor%2Bvalue%3D%3D%20%E4%B8%AD%E6%96%87"
        );
    }

    #[test]
    fn retry_schedule_uses_every_backoff_step() {
        let failure = ApiFailure::network();
        for (index, seconds) in RETRY_DELAYS.iter().enumerate() {
            let delay = retry_delay(&failure, index, 10_000).as_millis() as u64;
            let base = seconds * 1_000;
            assert!((base * 4 / 5..=base * 6 / 5).contains(&delay));
        }
    }

    #[test]
    fn strict_json_rejects_html_and_incomplete_envelopes() {
        let html = strict_json(Response {
            status: 200,
            content_type: Some("text/html; charset=utf-8".into()),
            retry_after: None,
            body: b"<html></html>".to_vec(),
        })
        .unwrap_err();
        assert_eq!(html.error.code, "API_INCOMPATIBLE");
        assert_eq!(html.policy, FailurePolicy::Unsupported);

        let incomplete = strict_json(Response {
            status: 200,
            content_type: Some("application/json".into()),
            retry_after: None,
            body: br#"{}"#.to_vec(),
        })
        .unwrap_err();
        assert_eq!(incomplete.error.code, "API_INCOMPATIBLE");

        assert!(strict_json(Response {
            status: 200,
            content_type: Some("application/json; charset=utf-8".into()),
            retry_after: None,
            body: br#"{"success":true,"data":{}}"#.to_vec(),
        })
        .is_ok());

        let disabled = strict_json(Response {
            status: 503,
            content_type: Some("application/json".into()),
            retry_after: None,
            body: br#"{"success":false,"error":{"code":"ACTIVITY_FEATURE_DISABLED"}}"#.to_vec(),
        })
        .unwrap_err();
        assert_eq!(disabled.error.code, "FEATURE_DISABLED");
        assert_eq!(disabled.policy, FailurePolicy::FeatureDisabled);

        let json_not_found = strict_json(Response {
            status: 404,
            content_type: Some("application/json".into()),
            retry_after: None,
            body: br#"{"success":false,"error":{"code":"ROUTE_NOT_FOUND"}}"#.to_vec(),
        })
        .unwrap_err();
        assert_eq!(json_not_found.error.code, "API_NOT_DEPLOYED");
        assert_eq!(json_not_found.error.http_status, Some(404));
        assert_eq!(json_not_found.policy, FailurePolicy::Unsupported);
    }

    #[test]
    fn presence_response_requires_a_known_effective_state() {
        for (state, expected) in [
            ("active", EffectivePresenceState::Active),
            ("idle", EffectivePresenceState::Idle),
            ("hidden", EffectivePresenceState::Hidden),
            ("offline", EffectivePresenceState::Offline),
        ] {
            assert_eq!(
                parse_presence_effective_state(
                    &json!({ "success": true, "data": { "state": state } }),
                    200,
                )
                .unwrap(),
                expected,
            );
        }

        for value in [
            json!({ "success": true, "data": {} }),
            json!({ "success": true, "data": { "state": "heartbeat" } }),
        ] {
            let failure = parse_presence_effective_state(&value, 200).unwrap_err();
            assert_eq!(failure.error.code, "API_INCOMPATIBLE");
            assert_eq!(failure.error.http_status, Some(200));
            assert_eq!(failure.policy, FailurePolicy::Unsupported);
        }
    }

    #[test]
    fn publisher_uses_server_effective_state_before_showing_an_app() {
        let profile = AgentProfile {
            feature_enabled: true,
            publish_enabled: true,
            ..AgentProfile::default()
        };
        let state = crate::runtime::RuntimeState::new(profile);
        let pending = make_presence(
            Transition::Active {
                process_name: "chatgpt.exe".into(),
                stable_since_ms: 1_700_000_000_000,
                kind: DetectorKind::Interactive,
            },
            42,
            None,
            "active",
        );

        state.update_publisher(|health| {
            health.state = "online".into();
            health.current_app = Some(json!({ "appKey": "win32:previous.exe" }));
        });
        mark_publisher_pending(&state);
        let pending_health = state.publisher_health();
        assert_eq!(pending_health.state, "idle");
        assert!(pending_health.current_app.is_none());

        apply_presence_success(&state, &pending, EffectivePresenceState::Hidden);
        let hidden = state.publisher_health();
        assert_eq!(hidden.state, "idle");
        assert!(hidden.current_app.is_none());
        assert!(hidden.last_success_at_ms.is_some());

        apply_presence_success(&state, &pending, EffectivePresenceState::Active);
        let active = state.publisher_health();
        assert_eq!(active.state, "online");
        assert_eq!(
            active
                .current_app
                .as_ref()
                .and_then(|app| app.get("appKey"))
                .and_then(Value::as_str),
            Some("win32:chatgpt.exe"),
        );

        apply_presence_success(&state, &pending, EffectivePresenceState::Offline);
        let offline = state.publisher_health();
        assert_eq!(offline.state, "idle");
        assert!(offline.current_app.is_none());
    }

    #[test]
    fn response_classification_stops_credentials_and_slows_unsupported_routes() {
        use super::classify_response;
        for status in [401, 403] {
            let credential = classify_response(
                status,
                &Some("application/json".into()),
                None,
                "application/json",
            )
            .unwrap_err();
            assert_eq!(credential.error.code, "CREDENTIAL_INVALID");
            assert_eq!(credential.error.http_status, Some(status));
            assert_eq!(credential.policy, FailurePolicy::Credential);
        }
        let redirected =
            classify_response(307, &Some("text/html".into()), None, "application/json")
                .unwrap_err();
        assert_eq!(redirected.error.code, "API_REDIRECTED");
        assert_eq!(redirected.error.http_status, Some(307));
        assert_eq!(redirected.policy, FailurePolicy::Unsupported);
        let missing = classify_response(
            404,
            &Some("application/json".into()),
            None,
            "application/json",
        )
        .unwrap_err();
        assert_eq!(missing.error.code, "API_NOT_DEPLOYED");
        assert_eq!(missing.policy, FailurePolicy::Unsupported);
        let limited = classify_response(
            429,
            &Some("application/json".into()),
            Some("37"),
            "application/json",
        )
        .unwrap_err();
        assert_eq!(limited.policy, FailurePolicy::RetryAfter(37));
        let server_error = classify_response(
            500,
            &Some("application/json".into()),
            None,
            "application/json",
        )
        .unwrap_err();
        assert_eq!(server_error.error.code, "API_TRANSIENT");
        assert_eq!(server_error.error.http_status, Some(500));
        assert!(server_error.error.transient);
        assert_eq!(server_error.policy, FailurePolicy::Backoff);
        assert_eq!(retry_after_seconds(Some("999999999")), 24 * 60 * 60);
        assert_eq!(
            retry_after_seconds(Some("Sun, 06 Nov 1994 08:49:37 GMT")),
            1
        );
    }

    #[test]
    fn sse_parser_supports_heartbeats_ids_and_multiline_data() {
        let mut parser = SseParser::default();
        assert!(matches!(
            parser.feed(": heartbeat"),
            Some(SseItem::Heartbeat)
        ));
        assert!(parser.feed("id: event-42").is_none());
        assert!(parser.feed("data: {\"message\":").is_none());
        assert!(parser.feed("data: \"hello\"}").is_none());
        match parser.feed("") {
            Some(SseItem::Event { id, data }) => {
                assert_eq!(id, "event-42");
                assert_eq!(data, "{\"message\":\n\"hello\"}");
            }
            _ => panic!("expected a complete SSE event"),
        }

        assert!(parser.feed("id: checkpoint-43").is_none());
        assert!(matches!(
            parser.feed(""),
            Some(SseItem::Cursor(id)) if id == "checkpoint-43"
        ));

        let mut reconnected = SseParser::with_last_event_id("checkpoint-43".into());
        assert!(reconnected.feed("data: {\"next\":true}").is_none());
        assert!(matches!(
            reconnected.feed(""),
            Some(SseItem::Event { id, .. }) if id == "checkpoint-43"
        ));
    }

    #[test]
    fn malformed_sse_event_cancels_before_later_heartbeats() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: not-json\n\n",
                )
                .unwrap();
            stream.flush().unwrap();
            thread::sleep(Duration::from_millis(100));
            // A broken server may keep the socket alive and continue heartbeats after an
            // invalid event. The client must already have left the read loop.
            let _ = stream.write_all(b": heartbeat\n\n");
            let _ = stream.flush();
        });
        let invalid = AtomicBool::new(false);
        let mut heartbeat_count = 0usize;
        let mut parser = SseParser::default();
        let _ = crate::winhttp::stream_lines(
            &format!("http://{address}/activity"),
            &[("Accept", "text/event-stream".into())],
            |line| match parser.feed(line) {
                Some(SseItem::Heartbeat) => heartbeat_count += 1,
                Some(SseItem::Event { data, .. })
                    if serde_json::from_str::<Value>(&data).is_err() =>
                {
                    invalid.store(true, Ordering::Release);
                }
                _ => {}
            },
            |_| {},
            || !invalid.load(Ordering::Acquire),
        );
        server.join().unwrap();
        assert!(invalid.load(Ordering::Acquire));
        assert_eq!(heartbeat_count, 0);
    }

    #[test]
    fn event_deduplication_is_bounded_and_survives_profile_reload() {
        let mut profile = AgentProfile::default();
        assert!(remember_event_in_profile(&mut profile, "event-1"));
        assert!(!remember_event_in_profile(&mut profile, "event-1"));
        for index in 2..=140 {
            assert!(remember_event_in_profile(
                &mut profile,
                &format!("event-{index}")
            ));
        }
        assert_eq!(profile.event_cursor, "event-140");
        assert_eq!(profile.recent_event_ids.len(), 128);
        let serialized = serde_json::to_vec(&profile).unwrap();
        let mut reloaded: AgentProfile = serde_json::from_slice(&serialized).unwrap();
        assert!(!remember_event_in_profile(&mut reloaded, "event-140"));
    }

    #[test]
    fn logical_presence_retry_reuses_sequence_and_client_event_id() {
        let pending = make_presence(
            Transition::Active {
                process_name: "code.exe".into(),
                stable_since_ms: 1_700_000_000_000,
                kind: DetectorKind::Interactive,
            },
            42,
            None,
            "active",
        );
        let first = presence_payload(&pending, "session-1");
        let retry = presence_payload(&pending, "session-1");
        assert_eq!(first.get("sequence"), retry.get("sequence"));
        assert_eq!(first.get("clientEventId"), retry.get("clientEventId"));
        assert_eq!(first.get("sequence").and_then(Value::as_u64), Some(42));
        assert!(first
            .get("observedAt")
            .and_then(Value::as_str)
            .is_some_and(|value| value.ends_with('Z')));
        assert!(first
            .get("stableSince")
            .and_then(Value::as_str)
            .is_some_and(|value| value.ends_with('Z')));
    }

    #[test]
    fn identity_rotation_invalidates_old_presence_results() {
        let state = crate::runtime::RuntimeState::new(AgentProfile::default());
        let old_generation = state.network_identity_revision();
        assert!(ensure_identity_generation(&state, old_generation).is_ok());
        state.network_identity_changed();
        let failure = ensure_identity_generation(&state, old_generation).unwrap_err();
        assert_eq!(failure.policy, FailurePolicy::ConfigurationChanged);
    }

    #[test]
    fn ordinary_profile_reload_keeps_a_healthy_sse_context_open() {
        let profile = AgentProfile {
            feature_enabled: true,
            encrypted_agent_token: "protected".into(),
            ..AgentProfile::default()
        };
        let state = crate::runtime::RuntimeState::new(profile);
        state.update_receiver(|health| {
            health.state = "connected".into();
            health.transport = Some("sse".into());
            health.consecutive_failures = 0;
            health.last_error = None;
        });
        let identity_generation = state.network_identity_revision();
        let receiver_generation = state.receiver_revision();

        // Background, publishing, snapshot and notification settings advance only the
        // publisher/config generation and must not cancel a healthy receiver stream.
        state.config_changed();

        assert_eq!(state.receiver_revision(), receiver_generation);
        assert!(receiver_context_is_current(
            &state,
            identity_generation,
            receiver_generation
        ));
        let receiver = state.receiver_health();
        assert_eq!(receiver.state, "connected");
        assert_eq!(receiver.transport.as_deref(), Some("sse"));
        assert_eq!(receiver.consecutive_failures, 0);
        assert!(receiver.last_error.is_none());
    }

    #[test]
    fn disabled_publishing_is_skipped_and_never_reported_as_online() {
        let state = crate::runtime::RuntimeState::new(AgentProfile::default());
        let pending = make_presence(Transition::Idle { at_ms: 1 }, 1, None, "heartbeat");
        let outcome = post_presence(
            &state,
            &pending,
            "session",
            state.network_identity_revision(),
            state.config_revision(),
        )
        .unwrap();
        assert_eq!(outcome, PresencePostOutcome::Skipped);
        assert_eq!(state.publisher_health().state, "disabled");
    }

    #[test]
    fn immediate_heartbeat_then_eof_does_not_reset_sse_failure_history() {
        assert!(!stream_attempt_was_stable(Duration::from_millis(50)));
        assert!(!stream_attempt_was_stable(Duration::from_secs(29)));
        assert!(stream_attempt_was_stable(Duration::from_secs(30)));
    }

    #[test]
    fn private_cache_cleanup_targets_only_agent_owned_child_directories() {
        let profile = AgentProfile {
            snapshot_cache_dir: r"C:\safe-cache-root".into(),
            ..AgentProfile::default()
        };
        let directories = private_cache_dirs(&profile);
        assert!(directories.iter().all(|directory| {
            directory.file_name().and_then(|name| name.to_str()) == Some("notification-images")
        }));
        assert!(directories.iter().any(|directory| directory
            == &std::path::PathBuf::from(r"C:\safe-cache-root\notification-images")));
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

    #[test]
    #[ignore = "displays a real Windows notification and is run only during manual E2E validation"]
    fn windows_toast_smoke_reaches_the_operating_system() {
        crate::config::configure_channel(true);
        let state = crate::runtime::RuntimeState::new(AgentProfile {
            notifications_enabled: true,
            ..AgentProfile::default()
        });
        let identity_generation = state.network_identity_revision();
        let marker = format!(
            "codex-toast-{}-{}",
            std::process::id(),
            crate::win32::unix_ms()
        );
        let event = json!({
            "id": marker,
            "type": "activity.entered",
            "createdAtMs": crate::win32::unix_ms(),
            "payload": {
                "target": { "username": "Activity 通知验收" },
                "app": { "displayName": marker },
                "session": {
                    "onlineSeconds": 3,
                    "devices": [{ "name": "开发版测试设备" }]
                }
            }
        });

        assert_eq!(
            show_activity_notification(&state, &event, identity_generation),
            Ok(true)
        );
        println!("TOAST_SMOKE_MARKER={marker}");
    }
}
