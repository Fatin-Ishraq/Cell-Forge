export function safeReadStorage(key) {
    try {
        return window.localStorage.getItem(key);
    } catch (_) {
        return null;
    }
}

export function safeWriteStorage(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch (_) {}
}

export function isDesktopRuntime() {
    if (typeof window === 'undefined') return false;
    return window.__FORMA_DESKTOP__ === true || (!!window.ipc && typeof window.ipc.postMessage === 'function');
}
