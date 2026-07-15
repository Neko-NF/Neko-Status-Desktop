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
fn mutex_wait_acquired(result: u32) -> bool {
    use windows_sys::Win32::Foundation::{WAIT_ABANDONED, WAIT_OBJECT_0};
    result == WAIT_OBJECT_0 || result == WAIT_ABANDONED
}

#[cfg(windows)]
fn main() {
    use crate::{
        config::{clear_activity_identity, load_profile, save_profile},
        detector::{ActivityDetector, Transition, SAMPLE_INTERVAL_MS},
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
        System::Threading::{
            CreateMutexW, OpenMutexW, ReleaseMutex, WaitForSingleObject, MUTEX_MODIFY_STATE,
            SYNCHRONIZATION_SYNCHRONIZE,
        },
        UI::WindowsAndMessaging::{
            DispatchMessageW, PeekMessageW, TranslateMessage, MSG, PM_REMOVE,
        },
    };

    let args = std::env::args().collect::<Vec<_>>();
    config::configure_channel(args.iter().any(|arg| arg == "--channel=dev"));
    let mutex_name: Vec<u16> = config::mutex_name().encode_utf16().chain(Some(0)).collect();
    if args.iter().any(|arg| arg == "--shutdown-for-update") {
        let existing = unsafe {
            OpenMutexW(
                SYNCHRONIZATION_SYNCHRONIZE | MUTEX_MODIFY_STATE,
                0,
                mutex_name.as_ptr(),
            )
        };
        if existing.is_null() {
            return;
        }
        let shutdown_error = pipe::send_shutdown_for_update().err();
        let result = unsafe { WaitForSingleObject(existing, 20_000) };
        let acquired = mutex_wait_acquired(result);
        unsafe {
            if acquired {
                ReleaseMutex(existing);
            }
            CloseHandle(existing);
        }
        if result == WAIT_TIMEOUT {
            if let Some(error) = shutdown_error {
                eprintln!("failed to request Agent shutdown for update: {error}");
            } else {
                eprintln!("timed out waiting for the running agent to stop");
            }
            std::process::exit(3);
        }
        if !acquired {
            eprintln!("failed while waiting for the running agent to stop");
            std::process::exit(4);
        }
        return;
    }

    if args.iter().any(|arg| arg == "--clear-activity-identity") {
        let mut cleanup_mutex = unsafe {
            OpenMutexW(
                SYNCHRONIZATION_SYNCHRONIZE | MUTEX_MODIFY_STATE,
                0,
                mutex_name.as_ptr(),
            )
        };
        if !cleanup_mutex.is_null() {
            let _ = pipe::send_shutdown("credential_invalid");
            let result = unsafe { WaitForSingleObject(cleanup_mutex, 10_000) };
            if result == WAIT_TIMEOUT {
                unsafe {
                    CloseHandle(cleanup_mutex);
                }
                eprintln!("timed out waiting for the running agent before identity cleanup");
                std::process::exit(2);
            } else if !mutex_wait_acquired(result) {
                unsafe {
                    CloseHandle(cleanup_mutex);
                }
                eprintln!("failed while waiting for the running agent before identity cleanup");
                std::process::exit(2);
            }
            // WaitForSingleObject transfers ownership of a mutex to the waiter.
            // Keep that ownership until the profile and private cache are clean.
        } else {
            // Hold the channel singleton while touching the Agent-owned profile so a
            // newly starting Agent cannot race the atomic cleanup.
            cleanup_mutex = unsafe { CreateMutexW(ptr::null(), 1, mutex_name.as_ptr()) };
            if cleanup_mutex.is_null() {
                eprintln!("failed to create the identity cleanup mutex");
                std::process::exit(3);
            }
            let raced_with_startup = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
            if raced_with_startup {
                let _ = pipe::send_shutdown("credential_invalid");
                let result = unsafe { WaitForSingleObject(cleanup_mutex, 10_000) };
                if result == WAIT_TIMEOUT || !mutex_wait_acquired(result) {
                    unsafe {
                        CloseHandle(cleanup_mutex);
                    }
                    eprintln!("agent restarted while identity cleanup was acquiring the mutex");
                    std::process::exit(3);
                }
            }
        }
        let mut profile = load_profile();
        clear_activity_identity(&mut profile);
        let saved = save_profile(&profile);
        let _ = startup::sync_autostart(&profile);
        network::purge_private_cache(&profile);
        unsafe {
            ReleaseMutex(cleanup_mutex);
            CloseHandle(cleanup_mutex);
        }
        if let Err(error) = saved {
            eprintln!("failed to clear activity identity: {error}");
            std::process::exit(4);
        }
        return;
    }

    // The singleton must own the mutex, not merely keep a named handle alive.
    // Update/cleanup helpers wait for ownership to know that the process has
    // really finished touching the pipe and Agent-owned profile.
    let mutex = unsafe { CreateMutexW(ptr::null(), 1, mutex_name.as_ptr()) };
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
    let launched_background = args.iter().any(|arg| arg == "--background");
    state
        .launched_background
        .store(launched_background, Ordering::Relaxed);
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
                        let at_ms = win32::unix_ms();
                        let transition = detector
                            .force_idle(at_ms)
                            .unwrap_or(Transition::Idle { at_ms });
                        *state.latest_transition.lock().unwrap() = Some(transition.clone());
                        let _ = transition_tx.send(transition);
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

    let started_at = Instant::now();
    let mut tray: Option<AgentTray> = None;
    let mut last_paused = false;
    let mut last_connection = String::new();
    while state.should_run() {
        let profile = state.profile.read().unwrap().clone();
        let claimed = state.tray_claimed.load(Ordering::Relaxed);
        let should_show = !claimed && profile.background_enabled;
        let paused = state.paused.load(Ordering::Relaxed);
        let connection = state.legacy_connection();
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
        ReleaseMutex(mutex);
        CloseHandle(mutex);
    }
}

#[cfg(all(test, windows))]
mod mutex_tests {
    use super::mutex_wait_acquired;
    use windows_sys::Win32::Foundation::{WAIT_ABANDONED, WAIT_OBJECT_0, WAIT_TIMEOUT};

    #[test]
    fn normal_and_abandoned_mutex_waits_both_transfer_ownership() {
        assert!(mutex_wait_acquired(WAIT_OBJECT_0));
        assert!(mutex_wait_acquired(WAIT_ABANDONED));
        assert!(!mutex_wait_acquired(WAIT_TIMEOUT));
    }
}
