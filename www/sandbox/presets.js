export const CONWAY_PRESETS = {
    life: { b: (1 << 3), s: (1 << 2) | (1 << 3), speed: 24 },
    highlife: { b: (1 << 3) | (1 << 6), s: (1 << 2) | (1 << 3), speed: 22 },
    daynight: { b: (1 << 3) | (1 << 6) | (1 << 7) | (1 << 8), s: (1 << 3) | (1 << 4) | (1 << 6) | (1 << 7) | (1 << 8), speed: 18 },
    seeds: { b: (1 << 2), s: 0, speed: 30 },
    maze: { b: (1 << 3), s: (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5), speed: 12 },
    replicator: { b: (1 << 1) | (1 << 3) | (1 << 5) | (1 << 7), s: (1 << 1) | (1 << 3) | (1 << 5) | (1 << 7), speed: 20 },
    '34life': { b: (1 << 3) | (1 << 4), s: (1 << 3) | (1 << 4), speed: 18 },
};

export const GEN_PRESETS = {
    brians: { b: (1 << 2), s: 0, states: 3, speed: 22 },
    starwars: { b: (1 << 2), s: (1 << 3) | (1 << 4) | (1 << 5), states: 4, speed: 18 },
    fireworld: { b: (1 << 2), s: (1 << 3) | (1 << 4), states: 8, speed: 14 },
    pulse: { b: (1 << 2), s: 0, states: 4, speed: 20 },
    dune: { b: (1 << 2), s: (1 << 2) | (1 << 3), states: 6, speed: 16 },
    tides: { b: (1 << 2), s: (1 << 3) | (1 << 4) | (1 << 6), states: 8, speed: 14 },
    frost: { b: (1 << 2), s: (1 << 1) | (1 << 2) | (1 << 5), states: 9, speed: 12 },
    lattice: { b: (1 << 3) | (1 << 4), s: (1 << 2) | (1 << 3) | (1 << 4), states: 6, speed: 16 },
    echo: { b: (1 << 2), s: (1 << 2) | (1 << 4), states: 10, speed: 12 },
    cathedral: { b: (1 << 2), s: (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4), states: 16, speed: 8 },
};

export const THEMES = [
    { name: 'Lab', bodyTheme: 'lab', bloom: true, bloomStrength: 0.34 },
    { name: 'Ember', bodyTheme: 'ember', bloom: true, bloomStrength: 0.54 },
    { name: 'Bio', bodyTheme: 'bio', bloom: true, bloomStrength: 0.28 },
    { name: 'Mono', bodyTheme: 'mono', bloom: false, bloomStrength: 0.0 },
];

export const AMBIENT_SCENES = [
    { mode: 0, preset: 'maze', theme: 2, density: 0.18, seed: 4201, speed: 6, zoom: 1.55 },
    { mode: 0, preset: 'highlife', theme: 0, density: 0.08, seed: 7331, speed: 8, zoom: 1.25 },
    { mode: 1, preset: 'starwars', theme: 3, density: 0.06, seed: 1887, speed: 7, zoom: 1.4 },
];
