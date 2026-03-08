use super::assets;
use super::util::wide_null;
use anyhow::{Context, Result};
use std::path::PathBuf;
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_SZ,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONQUESTION, MB_YESNO};

fn startup_reg_subkey() -> Vec<u16> {
    wide_null("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
}

fn startup_value_name() -> Vec<u16> {
    wide_null("FormaWallpaper")
}

fn app_launch_command() -> Result<String> {
    let exe = std::env::current_exe().context("failed to resolve executable path for startup")?;
    let asset_root = assets::resolve_asset_root().unwrap_or_else(|_| PathBuf::from("www"));
    Ok(format!(
        "\"{}\" --asset-root \"{}\"",
        exe.display(),
        asset_root.display()
    ))
}

fn open_run_key(access: u32) -> Result<HKEY> {
    let mut key: HKEY = std::ptr::null_mut();
    let subkey = startup_reg_subkey();
    let status = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, subkey.as_ptr(), 0, access, &mut key) };
    if status != 0 {
        return Err(anyhow::anyhow!("RegOpenKeyExW failed with {}", status));
    }
    Ok(key)
}

pub(super) fn is_startup_enabled() -> Result<bool> {
    let key = open_run_key(KEY_QUERY_VALUE)?;
    let value_name = startup_value_name();
    let mut value_type = 0u32;
    let mut byte_len = 0u32;
    let first = unsafe {
        RegQueryValueExW(
            key,
            value_name.as_ptr(),
            std::ptr::null_mut(),
            &mut value_type,
            std::ptr::null_mut(),
            &mut byte_len,
        )
    };
    unsafe { RegCloseKey(key) };
    if first != 0 {
        return Ok(false);
    }
    Ok(value_type == REG_SZ)
}

pub(super) fn set_startup_enabled(enabled: bool) -> Result<()> {
    let key = open_run_key(KEY_SET_VALUE)?;
    let value_name = startup_value_name();
    let status = if enabled {
        let cmd = app_launch_command()?;
        let mut wide: Vec<u16> = cmd.encode_utf16().collect();
        wide.push(0);
        unsafe {
            RegSetValueExW(
                key,
                value_name.as_ptr(),
                0,
                REG_SZ,
                wide.as_ptr() as *const u8,
                (wide.len() * 2) as u32,
            )
        }
    } else {
        unsafe { RegDeleteValueW(key, value_name.as_ptr()) }
    };
    unsafe { RegCloseKey(key) };
    if status != 0 {
        return Err(anyhow::anyhow!("startup registry update failed with {}", status));
    }
    Ok(())
}

pub(super) fn prompt_startup_enable() -> bool {
    let title = wide_null("Forma Wallpaper");
    let msg = wide_null("Enable Launch at Startup for Forma Wallpaper?");
    let result = unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            msg.as_ptr(),
            title.as_ptr(),
            MB_YESNO | MB_ICONQUESTION,
        )
    };
    result == IDYES
}
