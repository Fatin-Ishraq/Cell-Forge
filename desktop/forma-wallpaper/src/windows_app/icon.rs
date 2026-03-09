use anyhow::{Context, Result};

fn decode_png(bytes: &[u8], label: &'static str) -> Result<(Vec<u8>, u32, u32)> {
    let rgba = image::load_from_memory(bytes)
        .with_context(|| format!("failed to decode {label} png"))?
        .into_rgba8();
    let (width, height) = rgba.dimensions();
    Ok((rgba.into_raw(), width, height))
}

pub(super) fn load_window_icon() -> Result<tao::window::Icon> {
    let (rgba, width, height) = decode_png(
        include_bytes!("../../assets/icons/forma-256.png"),
        "window icon",
    )?;
    tao::window::Icon::from_rgba(rgba, width, height).context("failed to build window icon")
}

pub(super) fn load_tray_icon() -> Result<tray_icon::Icon> {
    let (rgba, width, height) = decode_png(
        include_bytes!("../../assets/icons/forma-32.png"),
        "tray icon",
    )?;
    tray_icon::Icon::from_rgba(rgba, width, height).context("failed to build tray icon")
}
