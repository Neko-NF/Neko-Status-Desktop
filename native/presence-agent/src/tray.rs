#![cfg(windows)]

use crate::runtime::RuntimeState;
use std::{
    process::Command,
    sync::{atomic::Ordering, Arc},
};
use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    Icon, TrayIcon, TrayIconBuilder,
};

pub struct AgentTray {
    _tray: TrayIcon,
    open_id: tray_icon::menu::MenuId,
    pause_id: tray_icon::menu::MenuId,
    exit_id: tray_icon::menu::MenuId,
}

fn icon() -> Icon {
    let width = 32;
    let height = 32;
    let mut rgba = vec![0u8; width * height * 4];
    for y in 0..height {
        for x in 0..width {
            let i = (y * width + x) * 4;
            let inside = (5..27).contains(&x) && (7..27).contains(&y);
            let ear = ((6..=12).contains(&x) || (20..=26).contains(&x)) && (2..=9).contains(&y);
            if inside || ear {
                rgba[i] = 14;
                rgba[i + 1] = 165;
                rgba[i + 2] = 233;
                rgba[i + 3] = 255;
            }
        }
    }
    Icon::from_rgba(rgba, width as u32, height as u32).expect("valid tray icon")
}

impl AgentTray {
    pub fn create(state: &RuntimeState) -> Result<Self, Box<dyn std::error::Error>> {
        let menu = Menu::new();
        let connection = state.connection.lock().unwrap().clone();
        let paused = state.paused.load(Ordering::Relaxed);
        let status = MenuItem::new(
            format!(
                "活动提醒：{}",
                if paused {
                    "已暂停"
                } else if connection == "online" {
                    "运行中"
                } else {
                    "正在连接"
                }
            ),
            false,
            None,
        );
        let open = MenuItem::new("打开 Neko Status", true, None);
        let pause = MenuItem::new(
            if paused {
                "恢复活动功能"
            } else {
                "临时暂停活动功能"
            },
            true,
            None,
        );
        let exit = MenuItem::new("退出后台功能（本次）", true, None);
        menu.append_items(&[
            &status,
            &PredefinedMenuItem::separator(),
            &open,
            &pause,
            &PredefinedMenuItem::separator(),
            &exit,
        ])?;
        let open_id = open.id().clone();
        let pause_id = pause.id().clone();
        let exit_id = exit.id().clone();
        let tray = TrayIconBuilder::new()
            .with_tooltip("Neko Status 活动提醒")
            .with_icon(icon())
            .with_menu(Box::new(menu))
            .build()?;
        Ok(Self {
            _tray: tray,
            open_id,
            pause_id,
            exit_id,
        })
    }

    pub fn handle_events(&self, state: &Arc<RuntimeState>) -> bool {
        let mut rebuild = false;
        while let Ok(event) = MenuEvent::receiver().try_recv() {
            if event.id == self.open_id {
                let exe = state.profile.read().unwrap().main_executable.clone();
                if !exe.is_empty() {
                    let _ = Command::new(exe).arg("--page=activity").spawn();
                }
            } else if event.id == self.pause_id {
                let next = !state.paused.load(Ordering::Relaxed);
                state.paused.store(next, Ordering::Relaxed);
                rebuild = true;
            } else if event.id == self.exit_id {
                state.shutdown.store(true, Ordering::Relaxed);
            }
        }
        rebuild
    }
}
