use super::util::wide_null;
use super::{WallpaperHost, WallpaperState};
use std::ptr::{null, null_mut};
use tao::platform::windows::WindowExtWindows;
use windows_sys::Win32::Foundation::{
    BOOL, GetLastError, HWND, LPARAM, POINT, RECT, SetLastError,
};
use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, FindWindowExW, FindWindowW, GetClassNameW, GetClientRect, GetCursorPos,
    GetForegroundWindow, GetParent, GetSystemMetrics, GetWindowLongPtrW, IsWindow,
    SendMessageTimeoutW, SetParent, SetWindowLongPtrW, SetWindowPos, SM_CXSCREEN, SM_CYSCREEN,
    SMTO_NORMAL, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW, WS_CHILD,
    WS_OVERLAPPEDWINDOW, WS_POPUP, WS_VISIBLE, GWL_STYLE,
};

pub(super) fn start_wallpaper_mode(window: &tao::window::Window) -> WallpaperState {
    window.set_visible(true);
    window.set_decorations(false);
    let state = try_attach_wallpaper(window);
    if state.attached {
        if let Err(err) = window.set_skip_taskbar(true) {
            println!("Failed to hide taskbar entry in wallpaper mode: {err}");
        }
        window.set_visible(true);
    } else {
        window.set_decorations(true);
        let _ = window.set_skip_taskbar(false);
        window.set_visible(true);
    }
    state
}

pub(super) fn stop_wallpaper_mode(
    window: &tao::window::Window,
    show_controls_window: bool,
) -> WallpaperState {
    let hwnd = window.hwnd() as HWND;
    detach_from_workerw(hwnd);
    if show_controls_window {
        window.set_decorations(true);
        if let Err(err) = window.set_skip_taskbar(false) {
            println!("Failed to restore taskbar entry: {err}");
        }
        window.set_visible(true);
        println!("Wallpaper stopped; running as normal window.");
    } else {
        // Keep the wallpaper runtime alive by parking the window off-screen
        // without taskbar presence.
        window.set_decorations(false);
        if let Err(err) = window.set_skip_taskbar(true) {
            println!("Failed to hide taskbar entry for parked engine window: {err}");
        }
        window.set_visible(true);
        unsafe {
            let _ = SetWindowPos(
                hwnd,
                null_mut(),
                -32000,
                -32000,
                64,
                64,
                SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
            );
        }
        println!("Wallpaper stopped; engine parked off-screen for controls mode.");
    }
    WallpaperState {
        attached: false,
        workerw: null_mut(),
    }
}

pub(super) fn current_cursor_pos() -> Option<(i32, i32)> {
    let mut pt = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut pt) };
    if ok == 0 {
        None
    } else {
        Some((pt.x, pt.y))
    }
}

pub(super) fn is_desktop_view_active(workerw: HWND) -> bool {
    let fg = unsafe { GetForegroundWindow() };
    if fg.is_null() {
        return false;
    }
    if fg == workerw {
        return true;
    }

    let mut probe = fg;
    for _ in 0..8 {
        if probe.is_null() {
            break;
        }
        if probe == workerw {
            return true;
        }
        probe = unsafe { GetParent(probe) };
    }

    matches!(
        class_name_for_window(fg).as_deref(),
        Some("Progman")
            | Some("WorkerW")
            | Some("SHELLDLL_DefView")
            | Some("SysListView32")
            | Some("Shell_TrayWnd")
    )
}

pub(super) fn query_on_battery_power() -> Option<bool> {
    let mut status = SYSTEM_POWER_STATUS {
        ACLineStatus: 255,
        BatteryFlag: 0,
        BatteryLifePercent: 0,
        SystemStatusFlag: 0,
        BatteryLifeTime: 0,
        BatteryFullLifeTime: 0,
    };
    let ok = unsafe { GetSystemPowerStatus(&mut status) };
    if ok == 0 || status.ACLineStatus == 255 {
        None
    } else {
        Some(status.ACLineStatus == 0)
    }
}

pub(super) fn is_window_valid(hwnd: HWND) -> bool {
    unsafe { !hwnd.is_null() && IsWindow(hwnd) != 0 }
}

pub(super) fn refresh_wallpaper_bounds(window: &tao::window::Window, workerw: HWND) {
    if workerw.is_null() {
        return;
    }
    let hwnd = window.hwnd() as HWND;
    unsafe {
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let got_rect = GetClientRect(workerw, &mut rect);
        let (base_width, base_height) = if got_rect != 0 {
            (rect.right - rect.left, rect.bottom - rect.top)
        } else {
            (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN))
        };
        let width = (base_width + 2).max(1);
        let height = (base_height + 2).max(1);
        let _ = SetWindowPos(
            hwnd,
            null_mut(),
            -1,
            -1,
            width,
            height,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        );
    }
}

fn class_name_for_window(hwnd: HWND) -> Option<String> {
    if hwnd.is_null() {
        return None;
    }
    let mut buf = [0u16; 128];
    let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
    if len <= 0 {
        None
    } else {
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

fn try_attach_wallpaper(window: &tao::window::Window) -> WallpaperState {
    let hwnd = window.hwnd() as HWND;
    try_attach_wallpaper_hwnd(hwnd)
}

fn try_attach_wallpaper_hwnd(hwnd: HWND) -> WallpaperState {
    if std::env::var("FORMA_FORCE_FALLBACK").ok().as_deref() == Some("1") {
        println!("Wallpaper embedding skipped via FORMA_FORCE_FALLBACK=1 (fallback window mode)");
        return WallpaperState {
            attached: false,
            workerw: null_mut(),
        };
    }

    match attach_to_workerw(hwnd) {
        Some(workerw) => {
            println!("Wallpaper attached to WorkerW successfully.");
            WallpaperState {
                attached: true,
                workerw,
            }
        }
        None => {
            println!("Wallpaper host attach failed; running in fallback normal window mode.");
            WallpaperState {
                attached: false,
                workerw: null_mut(),
            }
        }
    }
}

fn attach_to_workerw(hwnd: HWND) -> Option<HWND> {
    let host = find_wallpaper_host()?;
    println!("Attempting wallpaper attach via {} host.", host.kind);
    if !reparent_window_to_wallpaper(hwnd, host.hwnd) {
        return None;
    }
    Some(host.hwnd)
}

fn find_wallpaper_host() -> Option<WallpaperHost> {
    unsafe {
        let progman = FindWindowW(wide_null("Progman").as_ptr(), null());
        if progman.is_null() {
            println!("Progman window not found.");
            return None;
        }

        let mut _result: usize = 0;
        let send_ok_a = SendMessageTimeoutW(progman, 0x052C, 0, 0, SMTO_NORMAL, 1000, &mut _result);
        let send_ok_b = SendMessageTimeoutW(progman, 0x052C, 0, 1, SMTO_NORMAL, 1000, &mut _result);
        if send_ok_a == 0 && send_ok_b == 0 {
            println!("Progman message 0x052C did not complete in time.");
        }

        #[repr(C)]
        struct WorkerSearch {
            icons_parent: HWND,
            worker_after_icons: HWND,
            progman_child_workerw: HWND,
            first_workerw: HWND,
            first_workerw_without_icons: HWND,
        }

        unsafe extern "system" fn enum_windows_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let state = &mut *(lparam as *mut WorkerSearch);
            let worker_class = wide_null("WorkerW");
            let shell_class = wide_null("SHELLDLL_DefView");
            let mut class_buf = [0u16; 64];
            let class_len = GetClassNameW(hwnd, class_buf.as_mut_ptr(), class_buf.len() as i32);
            let is_worker =
                class_len > 0 && String::from_utf16_lossy(&class_buf[..class_len as usize]) == "WorkerW";
            if is_worker {
                if state.first_workerw.is_null() {
                    state.first_workerw = hwnd;
                }
                let has_icons = !FindWindowExW(hwnd, null_mut(), shell_class.as_ptr(), null()).is_null();
                if !has_icons && state.first_workerw_without_icons.is_null() {
                    state.first_workerw_without_icons = hwnd;
                }
            }

            let shell = FindWindowExW(hwnd, null_mut(), shell_class.as_ptr(), null());
            if !shell.is_null() {
                state.icons_parent = hwnd;
                let workerw = FindWindowExW(null_mut(), hwnd, worker_class.as_ptr(), null());
                if !workerw.is_null() {
                    state.worker_after_icons = workerw;
                    return 0;
                }
            }
            1
        }

        let mut state = WorkerSearch {
            icons_parent: null_mut(),
            worker_after_icons: null_mut(),
            progman_child_workerw: null_mut(),
            first_workerw: null_mut(),
            first_workerw_without_icons: null_mut(),
        };
        let ptr = &mut state as *mut WorkerSearch;
        let _ = EnumWindows(Some(enum_windows_proc), ptr as LPARAM);

        state.progman_child_workerw =
            FindWindowExW(progman, null_mut(), wide_null("WorkerW").as_ptr(), null());

        if !state.worker_after_icons.is_null() {
            return Some(WallpaperHost {
                hwnd: state.worker_after_icons,
                kind: "WorkerW(after-icons)",
            });
        }
        if !state.progman_child_workerw.is_null() {
            return Some(WallpaperHost {
                hwnd: state.progman_child_workerw,
                kind: "WorkerW(progman-child)",
            });
        }
        if !state.first_workerw_without_icons.is_null() {
            return Some(WallpaperHost {
                hwnd: state.first_workerw_without_icons,
                kind: "WorkerW(no-icons)",
            });
        }
        if !state.first_workerw.is_null() {
            return Some(WallpaperHost {
                hwnd: state.first_workerw,
                kind: "WorkerW(first)",
            });
        }

        // Avoid Progman parenting by default; it can destabilize the host window on some systems.
        // Opt-in only for debugging.
        if std::env::var("FORMA_ALLOW_PROGMAN").ok().as_deref() == Some("1") {
            println!("WorkerW not found; FORMA_ALLOW_PROGMAN=1 so trying Progman host.");
            return Some(WallpaperHost {
                hwnd: progman,
                kind: "Progman",
            });
        }

        println!("WorkerW host not found; staying in fallback mode.");
        None
    }
}

fn reparent_window_to_wallpaper(hwnd: HWND, workerw: HWND) -> bool {
    unsafe {
        let current_style = GetWindowLongPtrW(hwnd, GWL_STYLE) as usize;
        let mut new_style = current_style;
        new_style &= !(WS_OVERLAPPEDWINDOW as usize);
        new_style &= !(WS_POPUP as usize);
        new_style |= (WS_CHILD | WS_VISIBLE) as usize;
        let _ = SetWindowLongPtrW(hwnd, GWL_STYLE, new_style as isize);

        // SetParent can return null if previous parent was null; verify with GetLastError.
        SetLastError(0);
        let previous_parent = SetParent(hwnd, workerw);
        if previous_parent.is_null() && GetLastError() != 0 {
            println!("SetParent failed with Win32 error {}", GetLastError());
            return false;
        }

        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let got_rect = GetClientRect(workerw, &mut rect);
        let (base_width, base_height) = if got_rect != 0 {
            (rect.right - rect.left, rect.bottom - rect.top)
        } else {
            (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN))
        };
        let width = (base_width + 2).max(1);
        let height = (base_height + 2).max(1);
        let _ = SetWindowPos(
            hwnd,
            null_mut(),
            -1,
            -1,
            width,
            height,
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        );

        let parent_ok = GetParent(hwnd) == workerw;
        if !parent_ok {
            println!("Attach verification failed: window parent does not match wallpaper host.");
        }
        parent_ok
    }
}

fn detach_from_workerw(hwnd: HWND) {
    unsafe {
        let _ = SetParent(hwnd, null_mut());

        let current_style = GetWindowLongPtrW(hwnd, GWL_STYLE) as usize;
        let mut new_style = current_style;
        new_style &= !(WS_CHILD as usize);
        new_style &= !(WS_POPUP as usize);
        new_style |= (WS_OVERLAPPEDWINDOW | WS_VISIBLE) as usize;
        let _ = SetWindowLongPtrW(hwnd, GWL_STYLE, new_style as isize);

        let _ = SetWindowPos(
            hwnd,
            null_mut(),
            120,
            120,
            1280,
            800,
            SWP_NOZORDER | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        );
    }
}
