use crate::{config::AgentProfile, detector::Transition};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, RwLock,
};

pub struct RuntimeState {
    pub profile: RwLock<AgentProfile>,
    pub paused: AtomicBool,
    pub shutdown: AtomicBool,
    pub tray_claimed: AtomicBool,
    pub tray_visible: AtomicBool,
    pub client_connected: AtomicBool,
    pub connection: Mutex<String>,
    pub latest_transition: Mutex<Option<Transition>>,
}

impl RuntimeState {
    pub fn new(profile: AgentProfile) -> Self {
        Self {
            profile: RwLock::new(profile),
            paused: AtomicBool::new(false),
            shutdown: AtomicBool::new(false),
            tray_claimed: AtomicBool::new(false),
            tray_visible: AtomicBool::new(false),
            client_connected: AtomicBool::new(false),
            connection: Mutex::new("idle".into()),
            latest_transition: Mutex::new(None),
        }
    }

    pub fn set_connection(&self, value: &str) {
        *self.connection.lock().unwrap() = value.to_string();
    }

    pub fn should_run(&self) -> bool {
        !self.shutdown.load(Ordering::Relaxed)
    }
}
