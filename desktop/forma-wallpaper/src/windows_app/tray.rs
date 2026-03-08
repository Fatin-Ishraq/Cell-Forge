use super::{AppConfig, TrayMenuIds, TrayUiState};
use anyhow::{Context, Result};
use tray_icon::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tray_icon::{Icon, TrayIconBuilder};

pub(super) fn sync_tray_checks(ui: &TrayUiState, config: &AppConfig) {
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
) -> Result<(tray_icon::TrayIcon, TrayMenuIds, TrayUiState)> {
    let menu = Menu::new();
    let start_item = MenuItem::new("Start Wallpaper", true, None);
    let stop_item = MenuItem::new("Stop Wallpaper", true, None);
    let startup_item = CheckMenuItem::new("Launch at Startup", true, config.startup_enabled, None);

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

    menu.append(&start_item)?;
    menu.append(&stop_item)?;
    menu.append(&startup_item)?;
    menu.append(&resolution_menu)?;
    menu.append(&fps_menu)?;
    menu.append(&theme_menu)?;
    menu.append(&separator)?;
    menu.append(&exit_item)?;

    let icon = make_tray_icon().context("failed to build tray icon image")?;
    let tray = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip("Forma Wallpaper")
        .with_icon(icon)
        .build()
        .context("failed to initialize tray icon")?;

    let ids = TrayMenuIds {
        start: start_item.id().clone(),
        stop: stop_item.id().clone(),
        startup_enabled: startup_item.id().clone(),
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
        exit: exit_item.id().clone(),
    };
    let ui = TrayUiState {
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

fn make_tray_icon() -> Result<Icon> {
    let size = 32u32;
    let mut rgba = vec![0u8; (size * size * 4) as usize];

    for y in 0..size {
        for x in 0..size {
            let i = ((y * size + x) * 4) as usize;
            let checker = ((x / 4) + (y / 4)) % 2 == 0;
            let (r, g, b) = if checker { (38, 214, 140) } else { (18, 98, 80) };
            rgba[i] = r;
            rgba[i + 1] = g;
            rgba[i + 2] = b;
            rgba[i + 3] = 255;
        }
    }

    Icon::from_rgba(rgba, size, size).map_err(Into::into)
}
