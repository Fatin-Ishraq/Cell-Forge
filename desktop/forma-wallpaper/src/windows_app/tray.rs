use super::{icon, AppConfig, TrayMenuIds, TrayUiState};
use anyhow::{Context, Result};
use tray_icon::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tray_icon::TrayIconBuilder;

pub(super) fn sync_tray_checks(ui: &TrayUiState, config: &AppConfig, wallpaper_enabled: bool) {
    ui.wallpaper_enabled.set_checked(wallpaper_enabled);
    ui.startup_enabled.set_checked(config.startup_enabled);
    ui.res_512.set_checked(config.resolution == 512);
    ui.res_768.set_checked(config.resolution == 768);
    ui.res_1024.set_checked(config.resolution == 1024);
    ui.fps_30.set_checked(config.fps_cap == 30);
    ui.fps_60.set_checked(config.fps_cap == 60);
    ui.fps_120.set_checked(config.fps_cap == 120);
    ui.theme_0.set_checked(config.theme == 0);
    ui.theme_1.set_checked(config.theme == 1);
    ui.theme_2.set_checked(config.theme == 2);
    ui.theme_3.set_checked(config.theme == 3);
}

pub(super) fn create_tray_icon(
    config: &AppConfig,
    wallpaper_enabled: bool,
) -> Result<(tray_icon::TrayIcon, TrayMenuIds, TrayUiState)> {
    let menu = Menu::new();
    let controls_item = MenuItem::new("Open Controls Window", true, None);
    let wallpaper_item = CheckMenuItem::new("Wallpaper Enabled", true, wallpaper_enabled, None);
    let startup_item = CheckMenuItem::new("Launch at Startup", true, config.startup_enabled, None);
    let check_updates_item = MenuItem::new("Check for Updates", true, None);
    let export_diag_item = MenuItem::new("Export Diagnostics", true, None);
    let open_logs_item = MenuItem::new("Open Logs Folder", true, None);
    let about_item = MenuItem::new("About Forma Wallpaper", true, None);

    let res_512 = CheckMenuItem::new("512", true, config.resolution == 512, None);
    let res_768 = CheckMenuItem::new("768", true, config.resolution == 768, None);
    let res_1024 = CheckMenuItem::new("1024", true, config.resolution == 1024, None);
    let resolution_menu = Submenu::with_items("Resolution", true, &[&res_512, &res_768, &res_1024])?;

    let fps_30 = CheckMenuItem::new("30", true, config.fps_cap == 30, None);
    let fps_60 = CheckMenuItem::new("60", true, config.fps_cap == 60, None);
    let fps_120 = CheckMenuItem::new("120", true, config.fps_cap == 120, None);
    let fps_menu = Submenu::with_items("FPS Cap", true, &[&fps_30, &fps_60, &fps_120])?;

    let theme_0 = CheckMenuItem::new("Lab", true, config.theme == 0, None);
    let theme_1 = CheckMenuItem::new("Ember", true, config.theme == 1, None);
    let theme_2 = CheckMenuItem::new("Bio", true, config.theme == 2, None);
    let theme_3 = CheckMenuItem::new("Mono", true, config.theme == 3, None);
    let theme_menu = Submenu::with_items("Theme", true, &[&theme_0, &theme_1, &theme_2, &theme_3])?;
    let exit_item = MenuItem::new("Exit", true, None);
    let separator = PredefinedMenuItem::separator();

    menu.append(&controls_item)?;
    menu.append(&wallpaper_item)?;
    menu.append(&startup_item)?;
    menu.append(&check_updates_item)?;
    menu.append(&export_diag_item)?;
    menu.append(&resolution_menu)?;
    menu.append(&fps_menu)?;
    menu.append(&theme_menu)?;
    menu.append(&open_logs_item)?;
    menu.append(&about_item)?;
    menu.append(&separator)?;
    menu.append(&exit_item)?;

    let icon = icon::load_tray_icon().context("failed to load tray icon image")?;
    let tray = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip("Forma Wallpaper")
        .with_icon(icon)
        .build()
        .context("failed to initialize tray icon")?;

    let ids = TrayMenuIds {
        open_controls: controls_item.id().clone(),
        wallpaper_enabled: wallpaper_item.id().clone(),
        startup_enabled: startup_item.id().clone(),
        check_updates: check_updates_item.id().clone(),
        export_diagnostics: export_diag_item.id().clone(),
        res_512: res_512.id().clone(),
        res_768: res_768.id().clone(),
        res_1024: res_1024.id().clone(),
        fps_30: fps_30.id().clone(),
        fps_60: fps_60.id().clone(),
        fps_120: fps_120.id().clone(),
        theme_0: theme_0.id().clone(),
        theme_1: theme_1.id().clone(),
        theme_2: theme_2.id().clone(),
        theme_3: theme_3.id().clone(),
        open_logs: open_logs_item.id().clone(),
        about: about_item.id().clone(),
        exit: exit_item.id().clone(),
    };
    let ui = TrayUiState {
        wallpaper_enabled: wallpaper_item,
        startup_enabled: startup_item,
        res_512,
        res_768,
        res_1024,
        fps_30,
        fps_60,
        fps_120,
        theme_0,
        theme_1,
        theme_2,
        theme_3,
    };
    Ok((tray, ids, ui))
}
