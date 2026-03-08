use super::AppConfig;
use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;

fn config_path() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("Forma").join("config.json"))
}

pub(super) fn load_config() -> Result<AppConfig> {
    let path = config_path().context("APPDATA is not available")?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content =
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))?;
    let parsed: AppConfig =
        serde_json::from_str(&content).with_context(|| format!("invalid config {}", path.display()))?;
    Ok(parsed.normalize())
}

pub(super) fn save_config(config: &AppConfig) {
    let Some(path) = config_path() else {
        println!("APPDATA not available; skipping config save.");
        return;
    };
    if let Some(parent) = path.parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            println!("Failed to create config directory {}: {err}", parent.display());
            return;
        }
    }
    match serde_json::to_string_pretty(config) {
        Ok(data) => {
            if let Err(err) = fs::write(&path, data) {
                println!("Failed to write config {}: {err}", path.display());
            }
        }
        Err(err) => {
            println!("Failed to serialize config: {err}");
        }
    }
}
