use anyhow::{Context, Result};
use std::borrow::Cow;
use std::fs;
use std::path::{Component, Path, PathBuf};
use wry::http::header::CONTENT_TYPE;
use wry::http::{Request, Response, StatusCode};

pub(super) fn resolve_asset_root() -> Result<PathBuf> {
    if let Some(arg_root) = asset_root_from_args() {
        if arg_root.join("index.html").exists() {
            return Ok(arg_root);
        }
    }

    let exe_dir = std::env::current_exe()
        .context("failed to resolve current executable path")?
        .parent()
        .context("failed to resolve executable parent directory")?
        .to_path_buf();

    let candidate = exe_dir.join("www");
    if candidate.join("index.html").exists() {
        return Ok(candidate);
    }

    let cwd_candidate = std::env::current_dir()
        .context("failed to read current directory")?
        .join("www");
    if cwd_candidate.join("index.html").exists() {
        return Ok(cwd_candidate);
    }

    Err(anyhow::anyhow!(
        "could not find web assets. expected 'www/index.html' next to executable or current directory"
    ))
}

pub(super) fn build_asset_response(
    request: &Request<Vec<u8>>,
    asset_root: &Path,
) -> Response<Cow<'static, [u8]>> {
    let uri = request.uri().to_string();
    let path = parse_uri_path(&uri);
    let requested = normalize_path(asset_root, &path);
    let file_path = match requested {
        Some(p) => p,
        None => return text_response(StatusCode::BAD_REQUEST, "Invalid asset path"),
    };

    let final_path = if file_path.is_dir() {
        file_path.join("index.html")
    } else {
        file_path
    };

    match fs::read(&final_path) {
        Ok(bytes) => {
            let mime = content_type_for(&final_path);
            Response::builder()
                .status(StatusCode::OK)
                .header(CONTENT_TYPE, mime)
                .body(Cow::Owned(bytes))
                .expect("valid response")
        }
        Err(_) => text_response(StatusCode::NOT_FOUND, "Not found"),
    }
}

fn asset_root_from_args() -> Option<PathBuf> {
    let mut args = std::env::args_os();
    let _ = args.next();
    let mut pending_flag = false;
    for arg in args {
        if pending_flag {
            return Some(PathBuf::from(arg));
        }
        if arg == "--asset-root" {
            pending_flag = true;
        }
    }
    None
}

fn parse_uri_path(uri: &str) -> String {
    match url::Url::parse(uri) {
        Ok(parsed) => {
            let mut path = parsed.path().to_string();
            if path == "/" {
                path = "/index.html".to_string();
            }
            path
        }
        Err(_) => "/index.html".to_string(),
    }
}

fn normalize_path(root: &Path, web_path: &str) -> Option<PathBuf> {
    let mut clean = PathBuf::from(root);
    for component in Path::new(web_path.trim_start_matches('/')).components() {
        match component {
            Component::Normal(seg) => clean.push(seg),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(clean)
}

fn text_response(status: StatusCode, message: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Cow::Owned(message.as_bytes().to_vec()))
        .expect("valid error response")
}

fn content_type_for(path: &Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()).unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}
