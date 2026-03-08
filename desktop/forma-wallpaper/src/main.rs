#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("forma-wallpaper currently supports Windows only.");
}

#[cfg(target_os = "windows")]
mod windows_app;

#[cfg(target_os = "windows")]
fn main() -> anyhow::Result<()> {
    windows_app::run()
}
