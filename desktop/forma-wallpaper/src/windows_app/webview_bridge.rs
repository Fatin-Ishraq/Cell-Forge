use super::AppConfig;
use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};

pub(super) fn apply_config_to_webview(webview: &wry::WebView, config: &AppConfig) {
    let payload = match serde_json::to_string(config) {
        Ok(p) => p,
        Err(err) => {
            println!("Failed to serialize config payload for webview: {err}");
            return;
        }
    };
    let script = format!(
        "window.__FORMA_PENDING_CONFIG__ = {payload}; window.dispatchEvent(new CustomEvent('forma-host-message', {{ detail: {{ type: 'ApplyConfig', payload: {payload} }} }}));"
    );
    if let Err(err) = webview.evaluate_script(&script) {
        println!("Failed to apply config in webview: {err}");
    }
}

pub(super) fn apply_wallpaper_session_to_webview(webview: &wry::WebView, active: bool) {
    let script = format!(
        "window.__FORMA_WALLPAPER_ACTIVE__ = {}; window.dispatchEvent(new CustomEvent('forma-host-message', {{ detail: {{ type: 'WallpaperSession', payload: {{ active: {} }} }} }}));",
        if active { "true" } else { "false" },
        if active { "true" } else { "false" }
    );
    if let Err(err) = webview.evaluate_script(&script) {
        println!("Failed to apply wallpaper session state in webview: {err}");
    }
}

pub(super) fn apply_viewport_active_to_webview(webview: &wry::WebView, active: bool) {
    let script = format!(
        "window.__FORMA_VIEWPORT_ACTIVE__ = {}; window.dispatchEvent(new CustomEvent('forma-host-message', {{ detail: {{ type: 'ViewportActive', payload: {{ active: {} }} }} }}));",
        if active { "true" } else { "false" },
        if active { "true" } else { "false" }
    );
    if let Err(err) = webview.evaluate_script(&script) {
        println!("Failed to apply viewport active state in webview: {err}");
    }
}

pub(super) fn apply_power_state_to_webview(webview: &wry::WebView, on_battery: bool) {
    let script = format!(
        "window.__FORMA_ON_BATTERY__ = {}; window.dispatchEvent(new CustomEvent('forma-host-message', {{ detail: {{ type: 'PowerState', payload: {{ on_battery: {} }} }} }}));",
        if on_battery { "true" } else { "false" },
        if on_battery { "true" } else { "false" }
    );
    if let Err(err) = webview.evaluate_script(&script) {
        println!("Failed to apply power state in webview: {err}");
    }
}

pub(super) fn apply_cursor_to_webview(webview: &wry::WebView, x: i32, y: i32) {
    let screen_w = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    let screen_h = unsafe { GetSystemMetrics(SM_CYSCREEN) };
    let script = format!(
        "window.dispatchEvent(new CustomEvent('forma-host-message', {{ detail: {{ type: 'CursorMove', payload: {{ x: {}, y: {}, screen_w: {}, screen_h: {} }} }} }}));",
        x, y, screen_w, screen_h
    );
    if let Err(err) = webview.evaluate_script(&script) {
        println!("Failed to apply cursor update in webview: {err}");
    }
}

pub(super) fn apply_wallpaper_settings_to_webview(
    webview: &wry::WebView,
    settings: &serde_json::Value,
) {
    let settings_json = match serde_json::to_string(settings) {
        Ok(value) => value,
        Err(err) => {
            println!("Failed to serialize wallpaper settings payload: {err}");
            return;
        }
    };
    let script = format!(
        "window.dispatchEvent(new CustomEvent('forma-host-message', {{ detail: {{ type: 'ApplyWallpaperSettings', payload: {{ settings: {} }} }} }}));",
        settings_json
    );
    if let Err(err) = webview.evaluate_script(&script) {
        println!("Failed to apply wallpaper settings in webview: {err}");
    }
}
