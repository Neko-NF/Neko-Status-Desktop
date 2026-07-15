use crate::{config::AgentProfile, detector::Transition, win32::unix_ms};
use serde::Serialize;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex, RwLock,
};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityError {
    pub code: String,
    pub message: String,
    pub http_status: Option<u32>,
    pub transient: bool,
    pub at_ms: u64,
}

impl ActivityError {
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        http_status: Option<u32>,
        transient: bool,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            http_status,
            transient,
            at_ms: unix_ms(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiverHealth {
    pub state: String,
    pub transport: Option<String>,
    pub last_connected_at_ms: Option<u64>,
    pub last_heartbeat_at_ms: Option<u64>,
    pub last_event_at_ms: Option<u64>,
    pub consecutive_failures: u32,
    pub next_retry_at_ms: Option<u64>,
    pub last_error: Option<ActivityError>,
}

impl ReceiverHealth {
    fn disabled() -> Self {
        Self {
            state: "disabled".into(),
            transport: None,
            last_connected_at_ms: None,
            last_heartbeat_at_ms: None,
            last_event_at_ms: None,
            consecutive_failures: 0,
            next_retry_at_ms: None,
            last_error: None,
        }
    }

    fn connecting() -> Self {
        Self {
            state: "connecting".into(),
            ..Self::disabled()
        }
    }

    fn credential_error() -> Self {
        let mut health = Self::connecting();
        health.state = "credential_error".into();
        health.last_error = Some(ActivityError::new(
            "CREDENTIAL_INVALID",
            "提醒服务尚未完成配置",
            None,
            false,
        ));
        health
    }

    fn paused() -> Self {
        Self {
            state: "paused".into(),
            ..Self::disabled()
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublisherHealth {
    pub state: String,
    pub last_success_at_ms: Option<u64>,
    pub current_app: Option<Value>,
    pub consecutive_failures: u32,
    pub next_retry_at_ms: Option<u64>,
    pub last_error: Option<ActivityError>,
}

impl PublisherHealth {
    fn disabled() -> Self {
        Self {
            state: "disabled".into(),
            last_success_at_ms: None,
            current_app: None,
            consecutive_failures: 0,
            next_retry_at_ms: None,
            last_error: None,
        }
    }

    fn idle() -> Self {
        Self {
            state: "idle".into(),
            ..Self::disabled()
        }
    }

    fn paused() -> Self {
        Self {
            state: "paused".into(),
            ..Self::disabled()
        }
    }
}

fn health_for_profile(profile: &AgentProfile, paused: bool) -> (ReceiverHealth, PublisherHealth) {
    let receiver = if !profile.feature_enabled {
        ReceiverHealth::disabled()
    } else if paused {
        ReceiverHealth::paused()
    } else if profile.encrypted_agent_token.is_empty() {
        ReceiverHealth::credential_error()
    } else {
        ReceiverHealth::connecting()
    };
    let publisher = if !profile.feature_enabled || !profile.publish_enabled {
        PublisherHealth::disabled()
    } else if paused {
        PublisherHealth::paused()
    } else {
        PublisherHealth::idle()
    };
    (receiver, publisher)
}

pub struct RuntimeState {
    pub profile: RwLock<AgentProfile>,
    pub paused: AtomicBool,
    pub shutdown: AtomicBool,
    pub tray_claimed: AtomicBool,
    pub tray_visible: AtomicBool,
    pub client_connected: AtomicBool,
    pub launched_background: AtomicBool,
    pub latest_transition: Mutex<Option<Transition>>,
    receiver: Mutex<ReceiverHealth>,
    publisher: Mutex<PublisherHealth>,
    health_revision: AtomicU64,
    config_revision: AtomicU64,
    receiver_revision: AtomicU64,
    network_identity_revision: AtomicU64,
}

impl RuntimeState {
    pub fn new(profile: AgentProfile) -> Self {
        let (receiver, publisher) = health_for_profile(&profile, false);
        Self {
            profile: RwLock::new(profile),
            paused: AtomicBool::new(false),
            shutdown: AtomicBool::new(false),
            tray_claimed: AtomicBool::new(false),
            tray_visible: AtomicBool::new(false),
            client_connected: AtomicBool::new(false),
            launched_background: AtomicBool::new(false),
            latest_transition: Mutex::new(None),
            receiver: Mutex::new(receiver),
            publisher: Mutex::new(publisher),
            health_revision: AtomicU64::new(1),
            config_revision: AtomicU64::new(1),
            receiver_revision: AtomicU64::new(1),
            network_identity_revision: AtomicU64::new(1),
        }
    }

    pub fn receiver_health(&self) -> ReceiverHealth {
        self.receiver.lock().unwrap().clone()
    }

    pub fn update_receiver<F>(&self, update: F)
    where
        F: FnOnce(&mut ReceiverHealth),
    {
        let mut health = self.receiver.lock().unwrap();
        let previous = health.clone();
        update(&mut health);
        if *health != previous {
            self.touch_health();
        }
    }

    pub fn publisher_health(&self) -> PublisherHealth {
        self.publisher.lock().unwrap().clone()
    }

    pub fn update_publisher<F>(&self, update: F)
    where
        F: FnOnce(&mut PublisherHealth),
    {
        let mut health = self.publisher.lock().unwrap();
        let previous = health.clone();
        update(&mut health);
        if *health != previous {
            self.touch_health();
        }
    }

    /// Replaces both remote health axes from one canonical profile snapshot. This is used
    /// immediately after an account/device/token rotation so a successful provision reply
    /// cannot retain credential errors or retry metadata from the previous identity.
    pub fn reset_network_health(&self, profile: &AgentProfile) {
        let (next_receiver, next_publisher) =
            health_for_profile(profile, self.paused.load(Ordering::Relaxed));
        let mut receiver = self.receiver.lock().unwrap();
        let mut publisher = self.publisher.lock().unwrap();
        let changed = *receiver != next_receiver || *publisher != next_publisher;
        *receiver = next_receiver;
        *publisher = next_publisher;
        drop(publisher);
        drop(receiver);
        if changed {
            self.touch_health();
        }
    }

    pub fn sync_profile_switch_health(&self, previous: &AgentProfile, current: &AgentProfile) {
        if previous.feature_enabled != current.feature_enabled {
            self.reset_network_health(current);
            return;
        }
        if previous.publish_enabled != current.publish_enabled {
            let paused = self.paused.load(Ordering::Relaxed);
            self.update_publisher(|health| {
                *health = if current.feature_enabled && current.publish_enabled {
                    if paused {
                        PublisherHealth::paused()
                    } else {
                        PublisherHealth::idle()
                    }
                } else {
                    PublisherHealth::disabled()
                };
            });
        }
    }

    pub fn touch_health(&self) {
        self.health_revision.fetch_add(1, Ordering::Relaxed);
    }

    pub fn health_revision(&self) -> u64 {
        self.health_revision.load(Ordering::Relaxed)
    }

    pub fn config_revision(&self) -> u64 {
        self.config_revision.load(Ordering::Relaxed)
    }

    pub fn config_changed(&self) {
        self.config_revision.fetch_add(1, Ordering::Relaxed);
        self.touch_health();
    }

    pub fn receiver_revision(&self) -> u64 {
        self.receiver_revision.load(Ordering::Relaxed)
    }

    pub fn receiver_changed(&self) {
        self.receiver_revision.fetch_add(1, Ordering::Relaxed);
        self.touch_health();
    }

    pub fn network_identity_revision(&self) -> u64 {
        self.network_identity_revision.load(Ordering::Relaxed)
    }

    pub fn network_identity_changed(&self) {
        self.network_identity_revision
            .fetch_add(1, Ordering::Relaxed);
        self.receiver_revision.fetch_add(1, Ordering::Relaxed);
        self.config_changed();
    }

    pub fn legacy_connection(&self) -> String {
        match self.receiver.lock().unwrap().state.as_str() {
            "connected" => "online",
            "polling" => "polling",
            "credential_error" => "unprovisioned",
            "disabled" | "paused" => "idle",
            _ => "reconnecting",
        }
        .into()
    }

    pub fn overall_health(&self) -> &'static str {
        let profile = self.profile.read().unwrap();
        if !profile.feature_enabled {
            return "disabled";
        }
        if self.paused.load(Ordering::Relaxed) {
            return "paused";
        }
        if profile.encrypted_agent_token.is_empty() {
            return "needs_enroll";
        }
        drop(profile);
        let receiver = self.receiver.lock().unwrap();
        let publisher = self.publisher.lock().unwrap();
        if receiver.state == "credential_error" || publisher.state == "credential_error" {
            "needs_action"
        } else if receiver.state == "unsupported" || publisher.state == "unsupported" {
            "unavailable"
        } else if receiver.state == "polling" || publisher.state == "retrying" {
            "degraded"
        } else if matches!(receiver.state.as_str(), "connecting" | "retrying") {
            "recovering"
        } else {
            "healthy"
        }
    }

    pub fn should_run(&self) -> bool {
        !self.shutdown.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::RuntimeState;
    use crate::config::AgentProfile;

    #[test]
    fn publisher_cannot_overwrite_receiver_legacy_connection() {
        let profile = AgentProfile {
            feature_enabled: true,
            publish_enabled: true,
            encrypted_agent_token: "protected".into(),
            ..AgentProfile::default()
        };
        let state = RuntimeState::new(profile);
        state.update_receiver(|health| health.state = "retrying".into());
        state.update_publisher(|health| health.state = "online".into());
        assert_eq!(state.legacy_connection(), "reconnecting");
        assert_eq!(state.overall_health(), "recovering");
    }
}
