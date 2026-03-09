export function clampToTier(size, tiers) {
    let closest = tiers[0];
    let bestDist = Math.abs(size - closest);
    for (let i = 1; i < tiers.length; i++) {
        const candidate = tiers[i];
        const dist = Math.abs(size - candidate);
        if (dist < bestDist) {
            closest = candidate;
            bestDist = dist;
        }
    }
    return closest;
}

export function tierIndex(size, tiers) {
    return tiers.indexOf(clampToTier(size, tiers));
}

export function detectAutoTargetResolution(tiers, nav = navigator, win = window) {
    const cores = Number(nav.hardwareConcurrency || 0);
    const memory = Number(nav.deviceMemory || 0);
    const dpr = Math.min(Number(win.devicePixelRatio || 1), 2);
    const viewport = Math.max(win.innerWidth || 0, win.innerHeight || 0) * dpr;
    const ua = nav.userAgent || '';
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

    let target = clampToTier(Math.max(512, Math.min(1280, Math.round(viewport))), tiers);
    let penalty = 0;
    if (memory > 0 && memory <= 4) penalty += 2;
    else if (memory > 0 && memory <= 6) penalty += 1;
    if (cores > 0 && cores <= 4) penalty += 2;
    else if (cores > 0 && cores <= 6) penalty += 1;
    if (isMobileUA) penalty += 1;

    let idx = tierIndex(target, tiers) - penalty;
    if (idx < 0) idx = 0;
    if (idx >= tiers.length) idx = tiers.length - 1;
    return tiers[idx];
}

export function clampSpeed(value, maxSpeed) {
    return Math.max(1, Math.min(maxSpeed, value | 0));
}

export function speedFromSlider(sliderValue, sliderMax, maxSpeed) {
    const t = Math.max(0, Math.min(sliderMax, sliderValue | 0)) / sliderMax;
    const mapped = Math.exp(Math.log(maxSpeed) * t);
    return clampSpeed(Math.round(mapped), maxSpeed);
}

export function sliderFromSpeed(speedValue, sliderMax, maxSpeed) {
    const s = clampSpeed(speedValue, maxSpeed);
    const t = Math.log(s) / Math.log(maxSpeed);
    return Math.max(0, Math.min(sliderMax, Math.round(t * sliderMax)));
}
