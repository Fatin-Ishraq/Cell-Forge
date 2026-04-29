export function clampDesktopMask(mask, fallback) {
    if (!Number.isInteger(mask)) return fallback;
    if (mask < 0 || mask > 511) return fallback;
    return mask;
}

export function clampDesktopGenerations(value, fallback = 3) {
    if (!Number.isInteger(value)) return fallback;
    return Math.max(2, Math.min(20, value));
}

export function normalizeConwayPresetName(name, conwayPresets) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(conwayPresets, name)
        ? name
        : 'life';
}

export function normalizeGenerationsPresetName(name, generationsPresets) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(generationsPresets, name)
        ? name
        : 'starwars';
}

export function buildDesktopRuleStatePayload(input) {
    const {
        currentMode,
        birthMask,
        survivalMask,
        generationsCount,
        selectedConwayPreset,
        selectedGenerationsPreset,
        conwayPresets,
        generationsPresets,
    } = input;
    return {
        mode: currentMode === 1 ? 1 : 0,
        birth_mask: Number(birthMask) | 0,
        survival_mask: Number(survivalMask) | 0,
        generations: clampDesktopGenerations(generationsCount, 3),
        preset_conway: normalizeConwayPresetName(selectedConwayPreset, conwayPresets),
        preset_gen: normalizeGenerationsPresetName(selectedGenerationsPreset, generationsPresets),
    };
}

export function parseDesktopRuleState(raw, presets) {
    const { conwayPresets, generationsPresets } = presets;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || (parsed.mode !== 0 && parsed.mode !== 1)) return null;
        return {
            mode: parsed.mode,
            birth_mask: clampDesktopMask(parsed.birth_mask, conwayPresets.life.b),
            survival_mask: clampDesktopMask(parsed.survival_mask, conwayPresets.life.s),
            generations: clampDesktopGenerations(parsed.generations, 3),
            preset_conway: normalizeConwayPresetName(parsed.preset_conway, conwayPresets),
            preset_gen: normalizeGenerationsPresetName(parsed.preset_gen, generationsPresets),
        };
    } catch (_) {
        return null;
    }
}
