use crate::core::desktop::{DesktopController, EnginePhase, EngineRuntimeState};
use std::sync::Arc;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

const TRAY_ID: &str = "netf-main";
const SHOW_ID: &str = "netf-show";
const DISCONNECT_ID: &str = "netf-disconnect";
const EXIT_ID: &str = "netf-exit";

pub struct TrayManager {
    tray: TrayIcon<Wry>,
    status_item: MenuItem<Wry>,
    disconnect_item: MenuItem<Wry>,
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let status_item = MenuItem::with_id(
        app,
        "netf-status",
        "INACTIVE — NetF is starting",
        false,
        None::<&str>,
    )?;
    let show_item = MenuItem::with_id(app, SHOW_ID, "Show NetF", true, None::<&str>)?;
    let disconnect_item = MenuItem::with_id(app, DISCONNECT_ID, "Disconnect", false, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit_item = MenuItem::with_id(app, EXIT_ID, "Exit NetF", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status_item,
            &show_item,
            &disconnect_item,
            &separator,
            &exit_item,
        ],
    )?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .icon(state_icon(EnginePhase::Unknown))
        .tooltip("NetF — Starting")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id().0.as_str() {
            SHOW_ID => show_main_window(app),
            DISCONNECT_ID => disconnect_from_tray(app),
            EXIT_ID => exit_from_tray(app),
            _ => {}
        })
        .build(app)?;

    app.manage(TrayManager {
        tray,
        status_item,
        disconnect_item,
    });
    Ok(())
}

pub fn update(app: &AppHandle, state: &EngineRuntimeState) {
    let Some(tray) = app.try_state::<TrayManager>() else {
        return;
    };
    let (label, tooltip) = presentation(state);
    let _ = tray.status_item.set_text(label);
    let _ = tray.disconnect_item.set_enabled(state.active);
    let _ = tray.tray.set_tooltip(Some(tooltip));
    let _ = tray.tray.set_icon(Some(state_icon(state.phase)));
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(&format!("NetF — {}", phase_label(state.phase)));
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn disconnect_from_tray(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let controller = Arc::clone(app.state::<Arc<DesktopController>>().inner());
        if let Err(error) = controller.disconnect(&app) {
            controller.log(format!("Tray disconnect failed: {}", error.message));
            show_main_window(&app);
        }
    });
}

fn exit_from_tray(app: &AppHandle) {
    request_exit(app);
}

pub(crate) fn request_exit(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let controller = Arc::clone(app.state::<Arc<DesktopController>>().inner());
        match controller.shutdown(&app) {
            Ok(()) => app.exit(0),
            Err(error) if error.code == "shutdown_in_progress" => {}
            Err(error) => {
                controller.log(format!("Exit cleanup failed: {}", error.message));
                show_main_window(&app);
            }
        }
    });
}

fn presentation(state: &EngineRuntimeState) -> (String, String) {
    let label = match state.phase {
        EnginePhase::Connected => "ACTIVE — Traffic routing",
        EnginePhase::Starting => "STARTING — Preparing tunnel",
        EnginePhase::Stopping => "STOPPING — Restoring network",
        EnginePhase::Stopped => "INACTIVE — Tunnel stopped",
        EnginePhase::Failed => "ATTENTION REQUIRED",
        EnginePhase::Unknown => "STATUS UNKNOWN",
    };
    (label.into(), format!("NetF — {}", phase_label(state.phase)))
}

fn phase_label(phase: EnginePhase) -> &'static str {
    match phase {
        EnginePhase::Connected => "Connected",
        EnginePhase::Starting => "Starting",
        EnginePhase::Stopping => "Stopping",
        EnginePhase::Stopped => "Inactive",
        EnginePhase::Failed => "Attention required",
        EnginePhase::Unknown => "Status unknown",
    }
}

fn state_icon(phase: EnginePhase) -> Image<'static> {
    let accent = match phase {
        EnginePhase::Connected => [52, 211, 153, 255],
        EnginePhase::Starting | EnginePhase::Stopping => [245, 158, 11, 255],
        EnginePhase::Failed => [239, 68, 68, 255],
        EnginePhase::Stopped | EnginePhase::Unknown => [148, 163, 184, 255],
    };
    let mut rgba = vec![0_u8; 32 * 32 * 4];
    for y in 2..30 {
        for x in 2..30 {
            if (x < 5 && y < 5) || (x > 26 && y < 5) || (x < 5 && y > 26) || (x > 26 && y > 26) {
                continue;
            }
            set_pixel(&mut rgba, x, y, [17, 24, 39, 255]);
        }
    }
    for offset in -1..=1 {
        draw_line(&mut rgba, 8 + offset, 23, 8 + offset, 9, accent);
        draw_line(&mut rgba, 8, 9 + offset, 17, 23 + offset, accent);
        draw_line(&mut rgba, 17 + offset, 23, 17 + offset, 9, accent);
        draw_line(&mut rgba, 17, 9 + offset, 25, 9 + offset, accent);
        draw_line(&mut rgba, 17, 15 + offset, 23, 15 + offset, accent);
    }
    for y in 21..=25 {
        for x in 23..=27 {
            let dx = x - 25;
            let dy = y - 23;
            if dx * dx + dy * dy <= 4 {
                set_pixel(&mut rgba, x, y, accent);
            }
        }
    }
    Image::new_owned(rgba, 32, 32)
}

fn draw_line(rgba: &mut [u8], mut x0: i32, mut y0: i32, x1: i32, y1: i32, color: [u8; 4]) {
    let dx = (x1 - x0).abs();
    let sx = if x0 < x1 { 1 } else { -1 };
    let dy = -(y1 - y0).abs();
    let sy = if y0 < y1 { 1 } else { -1 };
    let mut error = dx + dy;
    loop {
        set_pixel(rgba, x0, y0, color);
        if x0 == x1 && y0 == y1 {
            break;
        }
        let doubled = 2 * error;
        if doubled >= dy {
            error += dy;
            x0 += sx;
        }
        if doubled <= dx {
            error += dx;
            y0 += sy;
        }
    }
}

fn set_pixel(rgba: &mut [u8], x: i32, y: i32, color: [u8; 4]) {
    if !(0..32).contains(&x) || !(0..32).contains(&y) {
        return;
    }
    let index = ((y * 32 + x) * 4) as usize;
    rgba[index..index + 4].copy_from_slice(&color);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connected_tray_presentation_is_explicit() {
        let state = EngineRuntimeState {
            phase: EnginePhase::Connected,
            active: true,
            message: "Connected".into(),
            updated_at_ms: 0,
        };
        let (label, tooltip) = presentation(&state);
        assert!(label.contains("ACTIVE"));
        assert!(tooltip.contains("Connected"));
    }
}
