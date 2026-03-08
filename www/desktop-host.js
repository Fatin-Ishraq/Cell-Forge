export function createDesktopHostBridge(handlers) {
    const hasIpc = typeof window !== 'undefined' && !!window.ipc && typeof window.ipc.postMessage === 'function';
    let hostReady = false;

    function post(type, payload = {}) {
        if (!hasIpc) return;
        window.ipc.postMessage(JSON.stringify({ type, payload }));
    }

    function setup() {
        if (!hasIpc) return;
        window.addEventListener('forma-host-message', (event) => {
            const message = event?.detail || {};
            if (message.type === 'HostReady') {
                hostReady = true;
                post('WebReady', { ua: navigator.userAgent });
                return;
            }
            if (message.type === 'ApplyConfig') {
                handlers.onApplyConfig?.(message.payload || {});
                return;
            }
            if (message.type === 'WallpaperSession') {
                handlers.onWallpaperSession?.(!!message?.payload?.active);
                return;
            }
            if (message.type === 'ViewportActive') {
                handlers.onViewportActive?.(!!message?.payload?.active);
                return;
            }
            if (message.type === 'PowerState') {
                handlers.onPowerState?.(!!message?.payload?.on_battery);
                return;
            }
            if (message.type === 'CursorMove') {
                handlers.onCursorMove?.(message.payload || {});
            }
        });

        // Fallback if host marked ready before listeners were attached.
        if (window.__FORMA_HOST_READY__ === true && !hostReady) {
            hostReady = true;
            post('WebReady', { ua: navigator.userAgent, source: 'bootstrap' });
        }
        if (window.__FORMA_PENDING_CONFIG__) {
            handlers.onApplyConfig?.(window.__FORMA_PENDING_CONFIG__);
        }
        if (typeof window.__FORMA_WALLPAPER_ACTIVE__ === 'boolean') {
            handlers.onWallpaperSession?.(window.__FORMA_WALLPAPER_ACTIVE__);
        }
        if (typeof window.__FORMA_VIEWPORT_ACTIVE__ === 'boolean') {
            handlers.onViewportActive?.(window.__FORMA_VIEWPORT_ACTIVE__);
        }
        if (typeof window.__FORMA_ON_BATTERY__ === 'boolean') {
            handlers.onPowerState?.(window.__FORMA_ON_BATTERY__);
        }
    }

    return { setup };
}
