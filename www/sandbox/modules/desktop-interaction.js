export const INTERACTION_PROFILES = [
    // Very light reaction: larger movement threshold + slower sampling.
    { id: 0, label: 'SUBTLE', minDistance: 14, interpolateStep: 24, maxSteps: 1, sampleStride: 1, minIntervalMs: 44, splashPx: 0 },
    // Default middle ground.
    { id: 1, label: 'BALANCED', minDistance: 3, interpolateStep: 4, maxSteps: 12, sampleStride: 1, minIntervalMs: 10, splashPx: 0 },
    // Strong reaction: dense interpolation + thicker cursor stroke.
    { id: 2, label: 'EXPRESSIVE', minDistance: 0, interpolateStep: 1, maxSteps: 30, sampleStride: 1, minIntervalMs: 0, splashPx: 2 },
];

export function normalizeInteractionProfile(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    return Math.max(0, Math.min(2, Math.round(n)));
}

export function getInteractionProfileConfig(index) {
    return INTERACTION_PROFILES[index] || INTERACTION_PROFILES[1];
}

export function screenFromHostToClient(payload, canvas, win = window) {
    const px = Number(payload?.x);
    const py = Number(payload?.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    const width = canvas?.clientWidth || win.innerWidth;
    const height = canvas?.clientHeight || win.innerHeight;

    const sw = Number(payload?.screen_w);
    const sh = Number(payload?.screen_h);
    if (Number.isFinite(sw) && Number.isFinite(sh) && sw > 0 && sh > 0) {
        return {
            x: Math.max(0, Math.min(width - 1, (px / sw) * width)),
            y: Math.max(0, Math.min(height - 1, (py / sh) * height)),
        };
    }

    const originX = Number.isFinite(win.screenX) ? win.screenX : (win.screenLeft || 0);
    const originY = Number.isFinite(win.screenY) ? win.screenY : (win.screenTop || 0);
    const localX = px - originX;
    const localY = py - originY;
    if (localX < -2 || localY < -2 || localX > width + 2 || localY > height + 2) {
        return null;
    }
    return {
        x: Math.max(0, Math.min(width - 1, localX)),
        y: Math.max(0, Math.min(height - 1, localY)),
    };
}
