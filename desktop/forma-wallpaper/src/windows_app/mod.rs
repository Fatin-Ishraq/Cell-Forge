use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::WindowBuilder;
use tray_icon::menu::{CheckMenuItem, MenuEvent, MenuId};
use wry::http::Request;
use wry::WebViewBuilder;

mod assets;
mod config;
mod icon;
mod logs;
mod release_ops;
mod startup;
mod tray;
mod util;
mod wallpaper;
mod webview_bridge;

#[derive(Debug, Deserialize)]
struct IpcMessage {
    #[serde(rename = "type")]
    message_type: String,
    #[serde(default)]
    payload: Option<IpcPayload>,
}

#[derive(Debug, Deserialize)]
struct IpcPayload {
    active: Option<bool>,
    resolution: Option<u16>,
    fps_cap: Option<u16>,
    theme: Option<u8>,
    interaction_profile: Option<u8>,
    settings: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
enum HostCommand {
    SetWallpaperActive(bool),
    SetDesktopConfig {
        resolution: Option<u16>,
        fps_cap: Option<u16>,
        theme: Option<u8>,
        interaction_profile: Option<u8>,
    },
    ApplyWallpaperSettings(serde_json::Value),
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
#[serde(default)]
struct AppConfig {
    resolution: u16,
    fps_cap: u16,
    theme: u8,
    interaction_profile: u8,
    startup_enabled: bool,
    startup_prompt_seen: bool,
    onboarding_prompt_seen: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            resolution: 1024,
            fps_cap: 30,
            theme: 0,
            interaction_profile: 1,
            startup_enabled: false,
            startup_prompt_seen: false,
            onboarding_prompt_seen: false,
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
        if self.interaction_profile > 2 {
            self.interaction_profile = 1;
        }
        self
    }
}

fn recommended_first_run_resolution_fps() -> (u16, u16) {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let on_battery = wallpaper::query_on_battery_power().unwrap_or(false);

    let (mut resolution, mut fps_cap) = if cores <= 4 {
        (512u16, 30u16)
    } else if cores <= 8 {
        (768u16, 60u16)
    } else {
        (1024u16, 120u16)
    };

    if on_battery {
        fps_cap = 30;
        if resolution > 512 {
            resolution = 768;
        }
    }

    (resolution, fps_cap)
}

fn normalize_tray_resolution(value: u16) -> u16 {
    if value < 640 {
        512
    } else if value < 896 {
        768
    } else {
        1024
    }
}

fn normalize_tray_fps(value: u16) -> u16 {
    let candidates = [30u16, 60u16, 120u16];
    let mut best = candidates[0];
    let mut best_dist = value.abs_diff(best);
    for candidate in candidates.iter().skip(1) {
        let dist = value.abs_diff(*candidate);
        if dist < best_dist {
            best = *candidate;
            best_dist = dist;
        }
    }
    best
}

fn normalize_interaction_profile(value: u8) -> u8 {
    value.min(2)
}

struct TrayMenuIds {
    open_controls: MenuId,
    wallpaper_enabled: MenuId,
    startup_enabled: MenuId,
    check_updates: MenuId,
    export_diagnostics: MenuId,
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
    profile_subtle: MenuId,
    profile_balanced: MenuId,
    profile_expressive: MenuId,
    open_logs: MenuId,
    about: MenuId,
    exit: MenuId,
}

struct TrayUiState {
    wallpaper_enabled: CheckMenuItem,
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
    profile_subtle: CheckMenuItem,
    profile_balanced: CheckMenuItem,
    profile_expressive: CheckMenuItem,
}

pub fn run() -> Result<()> {
    if let Err(err) = logs::init() {
        println!("Logging setup failed: {err}");
    }

    let event_loop = EventLoop::new();
    let window_icon = match icon::load_window_icon() {
        Ok(icon) => Some(icon),
        Err(err) => {
            logs::warn(format!("Failed to load window icon, using default: {err}"));
            None
        }
    };
    let wallpaper_window = WindowBuilder::new()
        .with_title("Forma Wallpaper")
        .with_window_icon(window_icon)
        .with_inner_size(LogicalSize::new(1680.0, 1000.0))
        .build(&event_loop)
        .context("failed to create desktop window")?;
    let controls_window = WindowBuilder::new()
        .with_title("Forma Controls")
        .with_window_icon(icon::load_window_icon().ok())
        .with_inner_size(LogicalSize::new(1680.0, 1000.0))
        .with_visible(false)
        .build(&event_loop)
        .context("failed to create controls window")?;
    let wallpaper_window_id = wallpaper_window.id();
    let controls_window_id = controls_window.id();

    let mut config = config::load_config().unwrap_or_else(|err| {
        logs::warn(format!("Config load failed, using defaults: {err}"));
        AppConfig::default()
    });
    config = config.normalize();
    let first_run = !config.startup_prompt_seen && !config.onboarding_prompt_seen;
    if first_run {
        let (resolution, fps_cap) = recommended_first_run_resolution_fps();
        config.resolution = resolution;
        config.fps_cap = fps_cap;
        config.theme = 3; // Mono
        logs::info(format!(
            "First-run defaults: preset=Brian's Brain theme=Mono resolution={} fps={}",
            config.resolution, config.fps_cap
        ));
    }
    config.startup_enabled = startup::is_startup_enabled().unwrap_or(config.startup_enabled);

    if !config.startup_prompt_seen {
        let prompt_yes = startup::prompt_startup_enable();
        config.startup_prompt_seen = true;
        config.startup_enabled = prompt_yes;
        if let Err(err) = startup::set_startup_enabled(prompt_yes) {
            logs::warn(format!(
                "Failed to update startup setting from first-run prompt: {err}"
            ));
        }
        config::save_config(&config);
    }

    let mut wallpaper_enabled = true;
    if !config.onboarding_prompt_seen {
        wallpaper_enabled = startup::prompt_start_wallpaper_now();
        config.onboarding_prompt_seen = true;
        config::save_config(&config);
    }

    let asset_root = assets::resolve_asset_root()?;
    logs::info(format!("Serving assets from {}", asset_root.display()));

    let wallpaper_init_script = r#"
            (() => {
              window.__FORMA_DESKTOP__ = true;
              window.__FORMA_SURFACE__ = 'wallpaper';
              window.__FORMA_HOST_READY__ = true;
              window.dispatchEvent(new CustomEvent('forma-host-message', {
                detail: { type: 'HostReady' }
              }));
            })();
        "#;
    let controls_init_script = r#"
            (() => {
              window.__FORMA_DESKTOP__ = true;
              window.__FORMA_SURFACE__ = 'controls';
              window.__FORMA_HOST_READY__ = true;
              window.dispatchEvent(new CustomEvent('forma-host-message', {
                detail: { type: 'HostReady' }
              }));
            })();
        "#;

    let (host_cmd_tx, host_cmd_rx) = mpsc::channel::<HostCommand>();
    let wallpaper_asset_root = asset_root.clone();
    let wallpaper_cmd_tx = host_cmd_tx.clone();
    let wallpaper_webview = WebViewBuilder::new()
        .with_custom_protocol(String::from("forma"), move |_webview_id, request| {
            assets::build_asset_response(&request, &wallpaper_asset_root)
        })
        .with_initialization_script(wallpaper_init_script)
        .with_ipc_handler(move |request: Request<String>| {
            let payload = request.body();
            let parsed = serde_json::from_str::<IpcMessage>(&payload);
            match parsed {
                Ok(msg) if msg.message_type == "WebReady" => {
                    logs::info("IPC: received WebReady from web app");
                }
                Ok(msg) if msg.message_type == "SetWallpaperActive" => {
                    if let Some(active) = msg.payload.and_then(|p| p.active) {
                        if let Err(err) = wallpaper_cmd_tx.send(HostCommand::SetWallpaperActive(active)) {
                            logs::warn(format!("Failed to queue host command from webview: {err}"));
                        }
                    } else {
                        logs::warn("IPC SetWallpaperActive missing payload.active");
                    }
                }
                Ok(msg) if msg.message_type == "SetDesktopConfig" => {
                    if let Some(payload) = msg.payload {
                        if let Err(err) = wallpaper_cmd_tx.send(HostCommand::SetDesktopConfig {
                            resolution: payload.resolution,
                            fps_cap: payload.fps_cap,
                            theme: payload.theme,
                            interaction_profile: payload.interaction_profile,
                        }) {
                            logs::warn(format!("Failed to queue config command from webview: {err}"));
                        }
                    } else {
                        logs::warn("IPC SetDesktopConfig missing payload");
                    }
                }
                Ok(msg) if msg.message_type == "ApplyWallpaperSettings" => {
                    if let Some(settings) = msg.payload.and_then(|p| p.settings) {
                        if let Err(err) =
                            wallpaper_cmd_tx.send(HostCommand::ApplyWallpaperSettings(settings))
                        {
                            logs::warn(format!(
                                "Failed to queue apply-wallpaper-settings command from webview: {err}"
                            ));
                        }
                    } else {
                        logs::warn("IPC ApplyWallpaperSettings missing payload.settings");
                    }
                }
                Ok(msg) => {
                    logs::info(format!("IPC: received {}", msg.message_type));
                }
                Err(_) => {
                    logs::warn(format!("IPC: unparsed payload: {}", payload));
                }
            }
        })
        .with_url("forma://localhost/index.html?surface=wallpaper")
        .build(&wallpaper_window)
        .context("failed to build webview")?;
    let controls_asset_root = asset_root.clone();
    let controls_cmd_tx = host_cmd_tx.clone();
    let controls_webview = WebViewBuilder::new()
        .with_custom_protocol(String::from("forma"), move |_webview_id, request| {
            assets::build_asset_response(&request, &controls_asset_root)
        })
        .with_initialization_script(controls_init_script)
        .with_ipc_handler(move |request: Request<String>| {
            let payload = request.body();
            let parsed = serde_json::from_str::<IpcMessage>(&payload);
            match parsed {
                Ok(msg) if msg.message_type == "WebReady" => {
                    logs::info("IPC: received WebReady from controls web app");
                }
                Ok(msg) if msg.message_type == "SetWallpaperActive" => {
                    if let Some(active) = msg.payload.and_then(|p| p.active) {
                        if let Err(err) = controls_cmd_tx.send(HostCommand::SetWallpaperActive(active)) {
                            logs::warn(format!("Failed to queue host command from controls webview: {err}"));
                        }
                    } else {
                        logs::warn("IPC SetWallpaperActive missing payload.active");
                    }
                }
                Ok(msg) if msg.message_type == "SetDesktopConfig" => {
                    if let Some(payload) = msg.payload {
                        if let Err(err) = controls_cmd_tx.send(HostCommand::SetDesktopConfig {
                            resolution: payload.resolution,
                            fps_cap: payload.fps_cap,
                            theme: payload.theme,
                            interaction_profile: payload.interaction_profile,
                        }) {
                            logs::warn(format!("Failed to queue config command from controls webview: {err}"));
                        }
                    } else {
                        logs::warn("IPC SetDesktopConfig missing payload");
                    }
                }
                Ok(msg) if msg.message_type == "ApplyWallpaperSettings" => {
                    if let Some(settings) = msg.payload.and_then(|p| p.settings) {
                        if let Err(err) =
                            controls_cmd_tx.send(HostCommand::ApplyWallpaperSettings(settings))
                        {
                            logs::warn(format!(
                                "Failed to queue apply-wallpaper-settings command from controls webview: {err}"
                            ));
                        }
                    } else {
                        logs::warn("IPC ApplyWallpaperSettings missing payload.settings");
                    }
                }
                Ok(msg) => {
                    logs::info(format!("IPC: received {}", msg.message_type));
                }
                Err(_) => {
                    logs::warn(format!("IPC: unparsed payload: {}", payload));
                }
            }
        })
        .with_url("forma://localhost/index.html?surface=controls")
        .build(&controls_window)
        .context("failed to build controls webview")?;

    let (tray_icon, tray_ids, tray_ui) = tray::create_tray_icon(&config, wallpaper_enabled)
        .context("failed to create system tray")?;

    let mut wallpaper_state = if wallpaper_enabled {
        wallpaper::start_wallpaper_mode(&wallpaper_window)
    } else {
        wallpaper::stop_wallpaper_mode(&wallpaper_window, false)
    };
    controls_window.set_visible(!wallpaper_enabled);
    if !wallpaper_enabled {
        controls_window.set_focus();
    }
    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
    webview_bridge::apply_config_to_webview(&controls_webview, &config);
    webview_bridge::apply_wallpaper_session_to_webview(
        &wallpaper_webview,
        wallpaper_enabled && wallpaper_state.attached,
    );
    webview_bridge::apply_wallpaper_session_to_webview(
        &controls_webview,
        wallpaper_enabled && wallpaper_state.attached,
    );
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
    webview_bridge::apply_viewport_active_to_webview(&wallpaper_webview, viewport_active);
    webview_bridge::apply_viewport_active_to_webview(&controls_webview, false);
    let mut on_battery_power = wallpaper::query_on_battery_power().unwrap_or(false);
    webview_bridge::apply_power_state_to_webview(&wallpaper_webview, on_battery_power);
    webview_bridge::apply_power_state_to_webview(&controls_webview, on_battery_power);
    let menu_events = MenuEvent::receiver();

    event_loop.run(move |event, _, control_flow| {
        let _keep_tray_alive = &tray_icon;
        *control_flow = if wallpaper_enabled && wallpaper_state.attached {
            let delay_ms = if viewport_active { 16 } else { 250 };
            ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(delay_ms))
        } else {
            // Keep polling host/webview command channel even in controls mode so
            // UI actions (like wallpaper toggle) apply immediately.
            ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(50))
        };

        if let Event::MainEventsCleared = event {
            while let Ok(menu_event) = menu_events.try_recv() {
                if menu_event.id == tray_ids.open_controls {
                    controls_window.set_visible(true);
                    controls_window.set_focus();
                    webview_bridge::apply_wallpaper_session_to_webview(
                        &controls_webview,
                        wallpaper_enabled && wallpaper_state.attached,
                    );
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    logs::info("Opened controls window from tray.");
                } else if menu_event.id == tray_ids.wallpaper_enabled {
                    let next = !wallpaper_enabled;
                    wallpaper_enabled = next;
                    wallpaper_state = if wallpaper_enabled {
                        wallpaper::start_wallpaper_mode(&wallpaper_window)
                    } else {
                        controls_window.set_visible(true);
                        controls_window.set_focus();
                        wallpaper::stop_wallpaper_mode(&wallpaper_window, false)
                    };
                    webview_bridge::apply_wallpaper_session_to_webview(
                        &wallpaper_webview,
                        wallpaper_enabled && wallpaper_state.attached,
                    );
                    webview_bridge::apply_wallpaper_session_to_webview(
                        &controls_webview,
                        wallpaper_enabled && wallpaper_state.attached,
                    );
                    viewport_active = wallpaper_enabled
                        && wallpaper_state.attached
                        && wallpaper::is_desktop_view_active(wallpaper_state.workerw);
                    webview_bridge::apply_viewport_active_to_webview(&wallpaper_webview, viewport_active);
                    if !viewport_active {
                        last_cursor = None;
                    }
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    logs::info(if wallpaper_enabled {
                        "Wallpaper enabled from tray toggle."
                    } else {
                        "Wallpaper disabled from tray toggle."
                    });
                } else if menu_event.id == tray_ids.startup_enabled {
                    let next = !config.startup_enabled;
                    config.startup_enabled = next;
                    if let Err(err) = startup::set_startup_enabled(next) {
                        logs::warn(format!("Failed to update startup registry entry: {err}"));
                        config.startup_enabled = !next;
                    }
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                } else if menu_event.id == tray_ids.check_updates {
                    if let Err(err) = release_ops::open_releases_page() {
                        logs::warn(format!("Failed to open releases page: {err}"));
                    } else {
                        logs::info("Opened releases page.");
                    }
                } else if menu_event.id == tray_ids.export_diagnostics {
                    match release_ops::export_diagnostics() {
                        Ok(path) => {
                            let _ = release_ops::open_path_in_explorer(&path);
                        }
                        Err(err) => {
                            logs::warn(format!("Failed to export diagnostics: {err}"));
                        }
                    }
                } else if menu_event.id == tray_ids.res_512 {
                    config.resolution = 512;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.res_768 {
                    config.resolution = 768;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.res_1024 {
                    config.resolution = 1024;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.fps_30 {
                    config.fps_cap = 30;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.fps_60 {
                    config.fps_cap = 60;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.fps_120 {
                    config.fps_cap = 120;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.theme_0 {
                    config.theme = 0;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.theme_1 {
                    config.theme = 1;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.theme_2 {
                    config.theme = 2;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.theme_3 {
                    config.theme = 3;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.profile_subtle {
                    config.interaction_profile = 0;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.profile_balanced {
                    config.interaction_profile = 1;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.profile_expressive {
                    config.interaction_profile = 2;
                    tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                    config::save_config(&config);
                    webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                    webview_bridge::apply_config_to_webview(&controls_webview, &config);
                } else if menu_event.id == tray_ids.open_logs {
                    if let Err(err) = logs::open_logs_folder() {
                        logs::warn(format!("Failed to open logs folder: {err}"));
                    }
                } else if menu_event.id == tray_ids.about {
                    startup::show_about_dialog(logs::log_path());
                } else if menu_event.id == tray_ids.exit {
                    logs::info("Exit selected from tray.");
                    *control_flow = ControlFlow::Exit;
                }
            }

            while let Ok(cmd) = host_cmd_rx.try_recv() {
                match cmd {
                    HostCommand::SetWallpaperActive(active) => {
                        if wallpaper_enabled == active {
                            continue;
                        }
                        wallpaper_enabled = active;
                        wallpaper_state = if wallpaper_enabled {
                            wallpaper::start_wallpaper_mode(&wallpaper_window)
                        } else {
                            controls_window.set_visible(true);
                            controls_window.set_focus();
                            wallpaper::stop_wallpaper_mode(&wallpaper_window, false)
                        };
                        webview_bridge::apply_wallpaper_session_to_webview(
                            &wallpaper_webview,
                            wallpaper_enabled && wallpaper_state.attached,
                        );
                        webview_bridge::apply_wallpaper_session_to_webview(
                            &controls_webview,
                            wallpaper_enabled && wallpaper_state.attached,
                        );
                        viewport_active = wallpaper_enabled
                            && wallpaper_state.attached
                            && wallpaper::is_desktop_view_active(wallpaper_state.workerw);
                        webview_bridge::apply_viewport_active_to_webview(&wallpaper_webview, viewport_active);
                        if !viewport_active {
                            last_cursor = None;
                        }
                        tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                        logs::info(if wallpaper_enabled {
                            "Wallpaper enabled from controls window."
                        } else {
                            "Wallpaper disabled from controls window."
                        });
                    }
                    HostCommand::SetDesktopConfig {
                        resolution,
                        fps_cap,
                        theme,
                        interaction_profile,
                    } => {
                        let mut changed = false;

                        if let Some(res) = resolution {
                            let next = normalize_tray_resolution(res);
                            if config.resolution != next {
                                config.resolution = next;
                                changed = true;
                            }
                        }

                        if let Some(fps) = fps_cap {
                            let next = normalize_tray_fps(fps);
                            if config.fps_cap != next {
                                config.fps_cap = next;
                                changed = true;
                            }
                        }

                        if let Some(theme_idx) = theme {
                            let next = theme_idx.min(3);
                            if config.theme != next {
                                config.theme = next;
                                changed = true;
                            }
                        }

                        if let Some(profile) = interaction_profile {
                            let next = normalize_interaction_profile(profile);
                            if config.interaction_profile != next {
                                config.interaction_profile = next;
                                changed = true;
                            }
                        }

                        if changed {
                            tray::sync_tray_checks(&tray_ui, &config, wallpaper_enabled);
                            config::save_config(&config);
                            webview_bridge::apply_config_to_webview(&wallpaper_webview, &config);
                            webview_bridge::apply_config_to_webview(&controls_webview, &config);
                            logs::info(format!(
                                "Applied config patch from controls window: res={} fps={} theme={} interaction={}",
                                config.resolution, config.fps_cap, config.theme, config.interaction_profile
                            ));
                        }
                    }
                    HostCommand::ApplyWallpaperSettings(settings) => {
                        webview_bridge::apply_wallpaper_settings_to_webview(
                            &wallpaper_webview,
                            &settings,
                        );
                    }
                }
            }

            if wallpaper_enabled
                && wallpaper_state.attached
                && last_rebind_probe.elapsed() >= Duration::from_secs(2)
            {
                if !wallpaper::is_window_valid(wallpaper_state.workerw) {
                    logs::warn("WorkerW host was lost (Explorer restart likely). Reattaching...");
                    wallpaper_state = wallpaper::start_wallpaper_mode(&wallpaper_window);
                    webview_bridge::apply_wallpaper_session_to_webview(
                        &wallpaper_webview,
                        wallpaper_enabled && wallpaper_state.attached,
                    );
                    webview_bridge::apply_wallpaper_session_to_webview(
                        &controls_webview,
                        wallpaper_enabled && wallpaper_state.attached,
                    );
                    viewport_active = wallpaper_state.attached
                        && wallpaper::is_desktop_view_active(wallpaper_state.workerw);
                    webview_bridge::apply_viewport_active_to_webview(&wallpaper_webview, viewport_active);
                    if !viewport_active {
                        last_cursor = None;
                    }
                } else {
                    wallpaper::refresh_wallpaper_bounds(&wallpaper_window, wallpaper_state.workerw);
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
                    webview_bridge::apply_viewport_active_to_webview(&wallpaper_webview, viewport_active);
                    if !viewport_active {
                        last_cursor = None;
                    }
                }
                last_viewport_probe = Instant::now();
            } else if (!wallpaper_enabled || !wallpaper_state.attached) && viewport_active {
                viewport_active = false;
                webview_bridge::apply_viewport_active_to_webview(&wallpaper_webview, viewport_active);
                last_cursor = None;
            }

            if wallpaper_enabled
                && wallpaper_state.attached
                && last_power_probe.elapsed() >= Duration::from_secs(30)
            {
                if let Some(next_power) = wallpaper::query_on_battery_power() {
                    if next_power != on_battery_power {
                        on_battery_power = next_power;
                        webview_bridge::apply_power_state_to_webview(&wallpaper_webview, on_battery_power);
                        webview_bridge::apply_power_state_to_webview(&controls_webview, on_battery_power);
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
                        webview_bridge::apply_cursor_to_webview(&wallpaper_webview, x, y);
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
                    ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(50))
                };
            }
        }

        if let Event::WindowEvent {
            window_id,
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            if window_id == controls_window_id {
                controls_window.set_visible(false);
                logs::info("Controls window hidden. Wallpaper keeps running.");
            } else if window_id == wallpaper_window_id {
                wallpaper_window.set_visible(false);
                logs::info("Wallpaper window close requested; ignored (managed by tray).");
            }
        }

        if matches!(event, Event::Resumed) {
            logs::info("System resumed; revalidating wallpaper host.");
            if wallpaper_enabled {
                if !wallpaper_state.attached || !wallpaper::is_window_valid(wallpaper_state.workerw) {
                    wallpaper_state = wallpaper::start_wallpaper_mode(&wallpaper_window);
                    webview_bridge::apply_wallpaper_session_to_webview(
                        &wallpaper_webview,
                        wallpaper_enabled && wallpaper_state.attached,
                    );
                    webview_bridge::apply_wallpaper_session_to_webview(
                        &controls_webview,
                        wallpaper_enabled && wallpaper_state.attached,
                    );
                }
                viewport_active = wallpaper_state.attached
                    && wallpaper::is_desktop_view_active(wallpaper_state.workerw);
                webview_bridge::apply_viewport_active_to_webview(&wallpaper_webview, viewport_active);
                if !viewport_active {
                    last_cursor = None;
                }
            }
        }

        if matches!(event, Event::Suspended) {
            logs::info("System suspended.");
            last_cursor = None;
        }
    });

    #[allow(unreachable_code)]
    Ok(())
}
