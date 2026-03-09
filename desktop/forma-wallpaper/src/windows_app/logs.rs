use anyhow::{Context, Result};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static LOG_FILE: OnceLock<Mutex<File>> = OnceLock::new();
static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

fn logs_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Forma").join("logs"))
}

pub(super) fn init() -> Result<()> {
    let Some(dir) = logs_dir() else {
        println!("LOCALAPPDATA not available; file logging disabled.");
        return Ok(());
    };
    fs::create_dir_all(&dir).with_context(|| format!("failed to create logs dir {}", dir.display()))?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = dir.join(format!("forma-{ts}.log"));
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .with_context(|| format!("failed to open log file {}", path.display()))?;

    let _ = LOG_PATH.set(path.clone());
    let _ = LOG_FILE.set(Mutex::new(file));
    info(format!("Logging initialized at {}", path.display()));
    Ok(())
}

pub(super) fn log_path() -> Option<&'static PathBuf> {
    LOG_PATH.get()
}

pub(super) fn open_logs_folder() -> Result<()> {
    let Some(dir) = logs_dir() else {
        return Err(anyhow::anyhow!("LOCALAPPDATA not available"));
    };
    Command::new("explorer")
        .arg(dir.as_os_str())
        .spawn()
        .context("failed to launch explorer for logs folder")?;
    Ok(())
}

pub(super) fn info(message: impl AsRef<str>) {
    emit("INFO", message.as_ref());
}

pub(super) fn warn(message: impl AsRef<str>) {
    emit("WARN", message.as_ref());
}

fn emit(level: &str, message: &str) {
    let line = format!("[{level}] {message}");
    println!("{line}");
    if let Some(lock) = LOG_FILE.get() {
        if let Ok(mut file) = lock.lock() {
            let _ = writeln!(file, "{line}");
        }
    }
}
