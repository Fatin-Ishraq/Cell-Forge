use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use tray_icon::menu::{CheckMenuItem, MenuEvent, MenuId};
use wry::http::Request;
use wry::WebViewBuilder;

mod assets;
mod config;
mod startup;
mod tray;
mod util;
mod wallpaper;
mod webview_bridge;

#[derive(Debug, Deserialize)]
struct IpcMessage {
    #[serde(rename = "type")]
    message_type: String,
}

#[derive(Debug, Clone, Copy)]
struct WallpaperState {
    attached: bool,
    workerw: windows_sys::Win32::Foundation::HWND,
}

#[derive(Debug, Clone, Copy)]
struct WallpaperHost {
    hwnd: windows_sys::Win32::Foundation::HWND,
    kind: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppConfig {
    resolution: u16,
    fps_cap: u16,
    theme: u8,
    startup_enabled: bool,
    startup_prompt_seen: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            resolution: 1024,
            fps_cap: 30,
            theme: 0,
            startup_enabled: false,
            startup_prompt_seen: false,
        }
    }
}

impl AppConfig {
    fn normalize(mut self) -> Self {
        const RES_ALLOWED: [u16; 6] = [384, 512, 640, 768, 896, 1024];
        if !RES_ALLOWED.contains(&self.resolution) {
            self.resolution = 1024;
        }
        if self.fps_cap < 1 {
            self.fps_cap = 1;
        } else if self.fps_cap > 240 {
            self.fps_cap = 240;
        }
        if self.theme > 3 {
            self.theme = 0;
        }
        self
    }
}

struct TrayMenuIds {
    start: MenuId,
    stop: MenuId,
    startup_enabled: MenuId,
    res_512: MenuId,
    res_768: MenuId,
    res_1024: MenuId,
    fps_30: MenuId,
    fps_60: MenuId,
    fps_120: MenuId,
    theme_0: MenuId,
    theme_1: MenuId,
    theme_2: MenuId,
    theme_3: MenuId,
    exit: MenuId,
}

struct TrayUiState {
    startup_enabled: CheckMenuItem,
    res_512: CheckMenuItem,
    res_768: CheckMenuItem,
    res_1024: CheckMenuItem,
    fps_30: CheckMenuItem,
    fps_60: CheckMenuItem,
    fps_120: CheckMenuItem,
    theme_0: CheckMenuItem,
    theme_1: CheckMenuItem,
    theme_2: CheckMenuItem,
    theme_3: CheckMenuItem,
}

pub fn run() -> Result<()> {
    let event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("Forma Wallpaper (Phase 4)")
        .build(&event_loop)
        .context("failed to create desktop window")?;

    let mut config = config::load_config().unwrap_or_else(|err| {
        println!("Config load failed, using defaults: {err}");
        AppConfig::default()
    });
    config = config.normalize();
    config.startup_enabled = startup::is_startup_enabled().unwrap_or(config.startup_enabled);

    if !config.startup_prompt_seen {
        let prompt_yes = startup::prompt_startup_enable();
        config.startup_prompt_seen = true;
        config.startup_enabled = prompt_yes;
        if let Err(err) = startup::set_startup_enabled(prompt_yes) {
            println!("Failed to update startup setting from first-run prompt: {err}");
        }
        config::save_config(&config);
    }

    let asset_root = assets::resolve_asset_root()?;
    println!("Serving assets from {}", asset_root.display());

    let init_script = r#"
            (() => {
              window.__FORMA_DESKTOP__ = true;
              window.__FORMA_HOST_READY__ = true;
              window.dispatchEvent(new CustomEvent('forma-host-message', {
                detail: { type: 'HostReady' }
              }));
            })();
        "#;

    let webview = WebViewBuilder::new()
        .with_custom_protocol(String::from("forma"), move |_webview_id, request| {
            assets::build_asset_response(&request, &asset_root)
        })
        .with_initialization_script(init_script)
        .with_ipc_handler(move |request: Request<String>| {
            let payload = request.body();
            let parsed = serde_json::from_str::<IpcMessage>(&payload);
            match parsed {
                Ok(msg) if msg.message_type == "WebReady" => {
                    println!("IPC: received WebReady from web app");
                }
                Ok(msg) => {
                    println!("IPC: received {}", msg.message_type);
                }
                Err(_) => {
                    println!("IPC: unparsed payload: {}", payload);
                }
            }
        })
        .with_url("forma://localhost/index.html")
        .build(&window)
        .context("failed to build webview")?;

    let (tray_icon, tray_ids, tray_ui) =
        tray::create_tray_icon(&config).context("failed to create system tray")?;

    let mut wallpaper_enabled = true;
    let mut wallpaper_state = if wallpaper_enabled {
        wallpaper::start_wallpaper_mode(&window)
    } else {
        wallpaper::stop_wallpaper_mode(&window)
    };
    webview_bridge::apply_config_to_webview(&webview, &config);
    webview_bridge::apply_wallpaper_session_to_webview(&webview, wallpaper_enabled);
    let mut last_rebind_probe = Instant::now();
    let mut last_viewport_probe = Instant::now();
    let mut last_power_probe = Instant::now();
    let mut last_cursor_probe = Instant::now();
    let mut last_cursor_emit = Instant::now();
    let mut last_cursor: Option<(i32, i32)> = None;
    let mut viewport_active =
        wallpaper_enabled
            && wallpaper_state.attached
            && wallpaper::is_desktop_view_active(wallpaper_state.workerw);
    webview_bridge::apply_viewport_active_to_webview(&webview, viewport_active);
    let mut on_battery_power = wallpaper::query_on_battery_power().unwrap_or(false);
    webview_bridge::apply_power_state_to_webview(&webview, on_battery_power);
    let menu_events = MenuEvent::receiver();

    event_loop.run(move |event, _, control_flow| {
        let _keep_tray_alive = &tray_icon;
        *control_flow = if wallpaper_enabled && wallpaper_state.attached {
            let delay_ms = if viewport_active { 16 } else { 250 };
            ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(delay_ms))
        } else {
            ControlFlow::Wait
        };

        if let Event::MainEventsCleared = event {
            while let Ok(menu_event) = menu_events.try_recv() {
                if menu_event.id == tray_ids.start {
                    wallpaper_enabled = true;
                    wallpaper_state = wallpaper::start_wallpaper_mode(&window);
                    webview_bridge::apply_wallpaper_session_to_webview(&webview, wallpaper_enabled);
                    viewport_active = wallpaper_state.attached
                        && wallpaper::is_desktop_view_active(wallpaper_state.workerw);
                    webview_bridge::apply_viewport_active_to_webview(&webview, viewport_active);
                    if !viewport_active {
                        last_cursor = None;
                    }
                } else if menu_event.id == tray_ids.stop {
                    wallpaper_enabled = false;
                    wallpaper_state = wallpaper::stop_wallpaper_mode(&window);
                    webview_bridge::apply_wallpaper_session_to_webview(&webview, wallpaper_enabled);
                    viewport_active = false;
                    webview_bridge::apply_viewport_active_to_webview(&webview, viewport_active);
                    last_cursor = None;
                } else if menu_event.id == tray_ids.startup_enabled {
                    let next = !config.startup_enabled;
                    config.startup_enabled = next;
                    if let Err(err) = startup::set_startup_enabled(next) {
                        println!("Failed to update startup registry entry: {err}");
                        config.startup_enabled = !next;
                    }
                    tray::sync_tray_checks(&tray_ui, &config);
                    config::save_config(&config);
                } else if menu_event.id == tray_ids.res_512 {
                    config.resolution = 512;
                    tray::sync_tray_checks(&tray_ui, &config);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&webview, &config);
                } else if menu_event.id == tray_ids.res_768 {
                    config.resolution = 768;
                    tray::sync_tray_checks(&tray_ui, &config);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&webview, &config);
                } else if menu_event.id == tray_ids.res_1024 {
                    config.resolution = 1024;
                    tray::sync_tray_checks(&tray_ui, &config);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&webview, &config);
                } else if menu_event.id == tray_ids.fps_30 {
                    config.fps_cap = 30;
                    tray::sync_tray_checks(&tray_ui, &config);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&webview, &config);
                } else if menu_event.id == tray_ids.fps_60 {
                    config.fps_cap = 60;
                    tray::sync_tray_checks(&tray_ui, &config);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&webview, &config);
                } else if menu_event.id == tray_ids.fps_120 {
                    config.fps_cap = 120;
                    tray::sync_tray_checks(&tray_ui, &config);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&webview, &config);
                } else if menu_event.id == tray_ids.theme_0 {
                    config.theme = 0;
                    tray::sync_tray_checks(&tray_ui, &config);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&webview, &config);
                } else if menu_event.id == tray_ids.theme_1 {
                    config.theme = 1;
                    tray::sync_tray_checks(&tray_ui, &config);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&webview, &config);
                } else if menu_event.id == tray_ids.theme_2 {
                    config.theme = 2;
                    tray::sync_tray_checks(&tray_ui, &config);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&webview, &config);
                } else if menu_event.id == tray_ids.theme_3 {
                    config.theme = 3;
                    tray::sync_tray_checks(&tray_ui, &config);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&webview, &config);
                } else if menu_event.id == tray_ids.exit {
                    *control_flow = ControlFlow::Exit;
                }
            }

            if wallpaper_enabled
                && wallpaper_state.attached
                && last_rebind_probe.elapsed() >= Duration::from_secs(2)
            {
                if !wallpaper::is_window_valid(wallpaper_state.workerw) {
                    println!("WorkerW host was lost (Explorer restart likely). Reattaching...");
                    wallpaper_state = wallpaper::start_wallpaper_mode(&window);
                    webview_bridge::apply_wallpaper_session_to_webview(&webview, wallpaper_enabled);
                    viewport_active = wallpaper_state.attached
                        && wallpaper::is_desktop_view_active(wallpaper_state.workerw);
                    webview_bridge::apply_viewport_active_to_webview(&webview, viewport_active);
                    if !viewport_active {
                        last_cursor = None;
                    }
                }
                last_rebind_probe = Instant::now();
            }

            if wallpaper_enabled
                && wallpaper_state.attached
                && last_viewport_probe.elapsed() >= Duration::from_millis(250)
            {
                let next_viewport_active = wallpaper::is_desktop_view_active(wallpaper_state.workerw);
                if next_viewport_active != viewport_active {
                    viewport_active = next_viewport_active;
                    webview_bridge::apply_viewport_active_to_webview(&webview, viewport_active);
                    if !viewport_active {
                        last_cursor = None;
                    }
                }
                last_viewport_probe = Instant::now();
            } else if (!wallpaper_enabled || !wallpaper_state.attached) && viewport_active {
                viewport_active = false;
                webview_bridge::apply_viewport_active_to_webview(&webview, viewport_active);
                last_cursor = None;
            }

            if wallpaper_enabled
                && wallpaper_state.attached
                && last_power_probe.elapsed() >= Duration::from_secs(30)
            {
                if let Some(next_power) = wallpaper::query_on_battery_power() {
                    if next_power != on_battery_power {
                        on_battery_power = next_power;
                        webview_bridge::apply_power_state_to_webview(&webview, on_battery_power);
                    }
                }
                last_power_probe = Instant::now();
            }

            if wallpaper_enabled
                && wallpaper_state.attached
                && viewport_active
                && last_cursor_probe.elapsed() >= Duration::from_millis(33)
            {
                if let Some((x, y)) = wallpaper::current_cursor_pos() {
                    let should_send = match last_cursor {
                        None => true,
                        Some((lx, ly)) => {
                            let dx = (x - lx).abs();
                            let dy = (y - ly).abs();
                            dx >= 2 || dy >= 2 || last_cursor_emit.elapsed() >= Duration::from_millis(150)
                        }
                    };
                    if should_send {
                        webview_bridge::apply_cursor_to_webview(&webview, x, y);
                        last_cursor = Some((x, y));
                        last_cursor_emit = Instant::now();
                    }
                }
                last_cursor_probe = Instant::now();
            }

            if !matches!(*control_flow, ControlFlow::Exit) {
                *control_flow = if wallpaper_enabled && wallpaper_state.attached {
                    let delay_ms = if viewport_active { 16 } else { 250 };
                    ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(delay_ms))
                } else {
                    ControlFlow::Wait
                };
            }
        }

        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            window.set_visible(false);
            println!("Window hidden to tray. Use tray menu Exit to quit.");
        }
    });

    #[allow(unreachable_code)]
    Ok(())
}
