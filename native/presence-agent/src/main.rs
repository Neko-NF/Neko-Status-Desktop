#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

#[cfg(not(windows))]
fn main() {
    eprintln!("NekoPresenceAgent is Windows-only");
}

#[cfg(windows)]
mod config;
#[cfg(windows)]
mod detector;
#[cfg(windows)]
mod network;
#[cfg(windows)]
mod pipe;
#[cfg(windows)]
mod runtime;
#[cfg(windows)]
mod snapshot;
#[cfg(windows)]
mod startup;
#[cfg(windows)]
mod tray;
#[cfg(windows)]
mod win32;
#[cfg(windows)]
mod winhttp;

#[cfg(windows)]
fn main() {
    use crate::{
        config::load_profile,
        detector::{ActivityDetector, SAMPLE_INTERVAL_MS},
        runtime::RuntimeState,
        tray::AgentTray,
        win32::ForegroundSampler,
    };
    use std::{
        ptr,
        sync::{atomic::Ordering, mpsc, Arc},
        thread,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, WAIT_TIMEOUT},
        System::Threading::{CreateMutexW, OpenMutexW, WaitForSingleObject},
        UI::WindowsAndMessaging::{
            DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
        },
    };

    let mutex_name: Vec<u16> = "Local\\NekoStatusPresenceAgent-v1\0"
        .encode_utf16()
        .collect();
    if std::env::args().any(|arg| arg == "--shutdown-for-update") {
        let existing = unsafe { OpenMutexW(0x0010_0000, 0, mutex_name.as_ptr()) };
        let _ = pipe::send_shutdown_for_update();
        if !existing.is_null() {
            let result = unsafe { WaitForSingleObject(existing, 20_000) };
            if result == WAIT_TIMEOUT {
                eprintln!("timed out waiting for the running agent to stop");
            }
            unsafe {
                CloseHandle(existing);
            }
        }
        return;
    }

    let mutex = unsafe { CreateMutexW(ptr::null(), 0, mutex_name.as_ptr()) };
    if mutex.is_null() || unsafe { GetLastError() } == ERROR_ALREADY_EXISTS {
        if !mutex.is_null() {
            unsafe {
                CloseHandle(mutex);
            }
        }
        return;
    }

    let profile = load_profile();
    let _ = startup::sync_autostart(&profile);
    let state = Arc::new(RuntimeState::new(profile));
    let (transition_tx, transition_rx) = mpsc::channel();

    {
        let state = state.clone();
        thread::spawn(move || pipe::run_pipe_server(state));
    }
    {
        let state = state.clone();
        thread::spawn(move || network::run_presence_loop(state, transition_rx));
    }
    {
        let state = state.clone();
        thread::spawn(move || network::run_event_loop(state));
    }
    {
        let state = state.clone();
        thread::spawn(move || {
            let mut sampler = ForegroundSampler::default();
            let mut detector = ActivityDetector::default();
            let mut paused = false;
            while state.should_run() {
                let now_paused = state.paused.load(Ordering::Relaxed);
                if now_paused {
                    if !paused {
                        if let Some(transition) = detector.force_idle(win32::unix_ms()) {
                            let _ = transition_tx.send(transition);
                        }
                    }
                    paused = true;
                } else {
                    paused = false;
                    if let Some(transition) = detector.push(sampler.sample()) {
                        *state.latest_transition.lock().unwrap() = Some(transition.clone());
                        let _ = transition_tx.send(transition);
                    }
                }
                thread::sleep(Duration::from_millis(SAMPLE_INTERVAL_MS));
            }
        });
    }

    let launched_background = std::env::args().any(|arg| arg == "--background");
    let started_at = Instant::now();
    let mut tray: Option<AgentTray> = None;
    let mut last_paused = false;
    let mut last_connection = String::new();
    while state.should_run() {
        let profile = state.profile.read().unwrap().clone();
        let claimed = state.tray_claimed.load(Ordering::Relaxed);
        let should_show = !claimed && profile.background_enabled;
        let paused = state.paused.load(Ordering::Relaxed);
        let connection = state.connection.lock().unwrap().clone();
        let status_changed = paused != last_paused || connection != last_connection;
        if !should_show {
            tray = None;
            state.tray_visible.store(false, Ordering::Relaxed);
        } else if tray.is_none() || status_changed {
            tray = AgentTray::create(&state).ok();
            state.tray_visible.store(tray.is_some(), Ordering::Relaxed);
        }
        if let Some(current_tray) = tray.as_ref() {
            if current_tray.handle_events(&state) {
                tray = None;
            }
        }
        last_paused = paused;
        last_connection = connection;

        unsafe {
            let mut message: MSG = std::mem::zeroed();
            while PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
        }
        if !launched_background
            && !profile.background_enabled
            && !state.client_connected.load(Ordering::Relaxed)
            && started_at.elapsed() > Duration::from_secs(15)
        {
            state.shutdown.store(true, Ordering::Relaxed);
        }
        thread::sleep(Duration::from_millis(100));
    }
    tray = None;
    state.tray_visible.store(false, Ordering::Relaxed);
    drop(tray);
    unsafe {
        CloseHandle(mutex);
    }
}
