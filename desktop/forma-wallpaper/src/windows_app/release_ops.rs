use super::logs;
use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const RELEASES_URL: &str = "https://github.com/fatin-ishraq/Forma/releases";

fn appdata_config_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("Forma").join("config.json"))
}

fn local_logs_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Forma").join("logs"))
}

fn diagnostics_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Forma").join("diagnostics"))
}

pub(super) fn open_releases_page() -> Result<()> {
    Command::new("explorer")
        .arg(RELEASES_URL)
        .spawn()
        .context("failed to open releases URL in browser")?;
    Ok(())
}

pub(super) fn export_diagnostics() -> Result<PathBuf> {
    let out_dir = diagnostics_dir().context("LOCALAPPDATA not available for diagnostics")?;
    fs::create_dir_all(&out_dir)
        .with_context(|| format!("failed to create diagnostics dir {}", out_dir.display()))?;

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let report_path = out_dir.join(format!("diagnostics-{ts}.txt"));

    let mut report = String::new();
    report.push_str("Forma Wallpaper Diagnostics\n");
    report.push_str("==========================\n\n");
    report.push_str(&format!("timestamp_unix={ts}\n"));
    report.push_str(&format!("version={}\n", env!("CARGO_PKG_VERSION")));
    report.push_str(&format!("os={}\n", std::env::consts::OS));
    report.push_str(&format!("arch={}\n", std::env::consts::ARCH));
    report.push_str(&format!(
        "exe={}\n",
        std::env::current_exe()
            .ok()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "<unknown>".to_string())
    ));

    if let Some(config) = appdata_config_path() {
        report.push_str(&format!("config_path={}\n", config.display()));
        if let Ok(cfg) = fs::read_to_string(&config) {
            report.push_str("\nconfig_json:\n");
            report.push_str(&cfg);
            report.push('\n');
        } else {
            report.push_str("config_json=<unreadable>\n");
        }
    } else {
        report.push_str("config_path=<unavailable>\n");
    }

    if let Some(log_dir) = local_logs_dir() {
        report.push_str(&format!("\nlogs_dir={}\n", log_dir.display()));
        if let Ok(entries) = fs::read_dir(&log_dir) {
            report.push_str("log_files:\n");
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    report.push_str(&format!(
                        "- {} ({} bytes)\n",
                        entry.path().display(),
                        meta.len()
                    ));
                }
            }
        }
    } else {
        report.push_str("\nlogs_dir=<unavailable>\n");
    }

    fs::write(&report_path, report)
        .with_context(|| format!("failed to write diagnostics file {}", report_path.display()))?;

    logs::info(format!("Diagnostics exported to {}", report_path.display()));
    Ok(report_path)
}

pub(super) fn open_path_in_explorer(path: &PathBuf) -> Result<()> {
    Command::new("explorer")
        .arg(path.as_os_str())
        .spawn()
        .with_context(|| format!("failed to open {}", path.display()))?;
    Ok(())
}
