// ═══════════════════════════════════════════════════════════════════════
// Forma — main.js
// WebGL2 rendering, UI wiring, interaction, game loop
// ═══════════════════════════════════════════════════════════════════════

import init, { Simulation } from './pkg/forma.js?v=theme2';
import { createDesktopHostBridge } from './desktop-host.js';
import { AMBIENT_SCENES, CONWAY_PRESETS, GEN_PRESETS, THEMES } from './presets.js';
import { BLOOM_FRAG, BLOOM_VERT, FRAG_SRC, VERT_SRC } from './shaders.js';

const desktopHost = createDesktopHostBridge({
    onApplyConfig: applyDesktopConfig,
    onWallpaperSession: setWallpaperSessionActive,
    onViewportActive: setDesktopViewportActive,
    onPowerState: setDesktopPowerState,
    onCursorMove: applyDesktopCursorMove,
});

// ── Globals ────────────────────────────────────────────────────────────
let sim = null;
let wasmMemory = null;
let wasmExports = null;
let gl = null;
let canvas = null;

// View state
let viewX = 0, viewY = 0; // pan offset in grid coords
let zoom = 1;
let gridW = 1024;
let gridH = 1024;

// Simulation state
let playing = true;
let speed = 30; // ticks per second
const MAX_SPEED = 240;
const SPEED_SLIDER_MAX = 100;
let tickAccumulator = 0;
let lastFrameTime = 0;
let needsUpload = true; // dirty flag: only upload pixels when something changed
let needsRender = true;
let statsDirty = true;
let desktopPendingConfig = null;
let wallpaperSessionActive = false;
let wallpaperTogglePendingTarget = null;
let wallpaperTogglePendingTimer = 0;
let suppressHostConfigEmit = false;
let desktopViewportActive = true;
let desktopOnBattery = false;
let loopSuspended = false;
let batteryEcoResolutionActive = false;
let batteryEcoBaseResolution = null;
let hostCursorLast = null;

// Brush state
let brushSize = 4;
let brushShape = 'square'; // square, circle, spray
let paintState = 1;
let generationsCount = 3;
let currentMode = 0; // start in Conway
let selectedConwayPreset = 'life';
let selectedGenerationsPreset = 'starwars';
let squareBrushBuffer = new Uint8Array(brushSize * brushSize);
let squareBrushFillState = paintState;
squareBrushBuffer.fill(paintState);
let presentationMode = false;
let aboutOpen = false;
let currentTheme = 0;
let themeBadgeTimeout = null;
let bloomStrength = 0.35;
let ambientMode = false;
let ambientStartTime = 0;
let ambientLastReseedAt = 0;
let ambientNextMotionAt = 0;
let ambientNextHealthCheckAt = 0;
let mobileUI = false;
let mobileSheet = null;
let mobileEraseMode = false;
let touchMode = 'none';
let touchPrevDistance = 0;
let touchPrevCenterX = 0;
let touchPrevCenterY = 0;
let loopTimerId = 0;
const RENDER_RESOLUTION = 1024;
let simResolution = 1024;
const GRID_TIERS = [384, 512, 640, 768, 896, 1024, 1280];
const RES_STORAGE_MODE_KEY = 'forma_sim_res_mode';
const RES_STORAGE_VALUE_KEY = 'forma_sim_res_value';
const DESKTOP_RULE_STATE_KEY = 'forma_desktop_rule_state_v1';
let resolutionMode = 'auto';
let autoTargetResolution = 1024;
let adaptiveLowFpsMs = 0;
let adaptiveHighFpsMs = 0;
let adaptiveCooldownUntil = 0;
const ADAPTIVE_LOW_FPS = 46;
const ADAPTIVE_HIGH_FPS = 58;
const ADAPTIVE_LOW_WINDOW_MS = 6500;
const ADAPTIVE_HIGH_WINDOW_MS = 22000;
const ADAPTIVE_COOLDOWN_MS = 12000;
const BATTERY_WALLPAPER_FPS_CAP = 20;

// FPS tracking
const fpsSamples = new Array(60).fill(16.67);
let fpsIndex = 0;
let fpsSum = 16.67 * fpsSamples.length;

// Mouse state
let isLeftDown = false;
let isRightDown = false;
let isMiddleDown = false;
let lastMouseX = 0, lastMouseY = 0;

// WebGL objects
let texture = null;
let program = null;
let vao = null;
let bloomEnabled = false; // disabled by default for perf
let bloomSupported = true;
let bloomFBOs = [];
let bloomProgram = null;

// Cached uniform locations
let u_program = {};
let u_bloom = {};

// Cached WASM pixel view (re-created only when memory/pointer changes).
let wasmPixelsView = null;
let wasmPixelsBuffer = null;
let wasmPixelsPtr = -1;
let wasmPixelsLen = -1;

const AMBIENT_MOTION_INTERVAL_MS = 66;
const AMBIENT_HEALTH_INTERVAL_MS = 1000;
const IDLE_FRAME_DELAY_MS = 180;

// ═══════════════════════════════════════════════════════════════════════
// WebGL Setup
// ═══════════════════════════════════════════════════════════════════════

function compileShader(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader error:', gl.getShaderInfoLog(s));
        return null;
    }
    return s;
}

function createProgram(vSrc, fSrc) {
    const v = compileShader(vSrc, gl.VERTEX_SHADER);
    const f = compileShader(fSrc, gl.FRAGMENT_SHADER);
    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        console.error('Program error:', gl.getProgramInfoLog(p));
        return null;
    }
    return p;
}

function applyRenderResolution() {
    if (!canvas || !gl) return;
    canvas.width = RENDER_RESOLUTION;
    canvas.height = RENDER_RESOLUTION;
    setupBloomFBOs();
    needsRender = true;
}

function updateResolutionUI() {
    const btn = document.getElementById('btn-resolution');
    if (!btn) return;
    const mode = resolutionMode === 'manual' ? 'MANUAL' : 'AUTO';
    btn.textContent = `RES: ${simResolution} (${mode})`;
}

function resetPixelCache() {
    wasmPixelsView = null;
    wasmPixelsBuffer = null;
    wasmPixelsPtr = -1;
    wasmPixelsLen = -1;
}

function syncGridDimensions() {
    gridW = Number(sim.get_width());
    gridH = Number(sim.get_height());
    simResolution = gridW;
}

function reallocateSimulationTexture() {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gridW, gridH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    resetPixelCache();
}

function safeReadStorage(key) {
    try {
        return window.localStorage.getItem(key);
    } catch (_) {
        return null;
    }
}

function safeWriteStorage(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch (_) {}
}

function isDesktopRuntime() {
    if (typeof window === 'undefined') return false;
    return window.__FORMA_DESKTOP__ === true || (!!window.ipc && typeof window.ipc.postMessage === 'function');
}

function pushDesktopConfigPatch(patch) {
    if (!isDesktopRuntime() || suppressHostConfigEmit) return;
    desktopHost.setDesktopConfig(patch || {});
}

function clampDesktopMask(mask, fallback) {
    if (!Number.isInteger(mask)) return fallback;
    if (mask < 0 || mask > 511) return fallback;
    return mask;
}

function clampDesktopGenerations(value, fallback = 3) {
    if (!Number.isInteger(value)) return fallback;
    return Math.max(2, Math.min(20, value));
}

function normalizeConwayPresetName(name) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(CONWAY_PRESETS, name)
        ? name
        : 'life';
}

function normalizeGenerationsPresetName(name) {
    return typeof name === 'string' && Object.prototype.hasOwnProperty.call(GEN_PRESETS, name)
        ? name
        : 'starwars';
}

function persistDesktopRuleState() {
    if (!isDesktopRuntime() || !sim) return;
    const payload = {
        mode: currentMode === 1 ? 1 : 0,
        birth_mask: Number(sim.get_birth_mask()) | 0,
        survival_mask: Number(sim.get_survival_mask()) | 0,
        generations: clampDesktopGenerations(generationsCount, 3),
        preset_conway: normalizeConwayPresetName(selectedConwayPreset),
        preset_gen: normalizeGenerationsPresetName(selectedGenerationsPreset),
    };
    safeWriteStorage(DESKTOP_RULE_STATE_KEY, JSON.stringify(payload));
}

function loadDesktopRuleState() {
    if (!isDesktopRuntime()) return null;
    const raw = safeReadStorage(DESKTOP_RULE_STATE_KEY);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || (parsed.mode !== 0 && parsed.mode !== 1)) return null;
        return {
            mode: parsed.mode,
            birth_mask: clampDesktopMask(parsed.birth_mask, CONWAY_PRESETS.life.b),
            survival_mask: clampDesktopMask(parsed.survival_mask, CONWAY_PRESETS.life.s),
            generations: clampDesktopGenerations(parsed.generations, 3),
            preset_conway: normalizeConwayPresetName(parsed.preset_conway),
            preset_gen: normalizeGenerationsPresetName(parsed.preset_gen),
        };
    } catch (_) {
        return null;
    }
}

function applyDesktopRuleState(state) {
    if (!state || !sim) return false;
    const mode = state.mode === 1 ? 1 : 0;
    const birthMask = clampDesktopMask(state.birth_mask, CONWAY_PRESETS.life.b);
    const survivalMask = clampDesktopMask(state.survival_mask, CONWAY_PRESETS.life.s);
    const nextGenerations = clampDesktopGenerations(state.generations, 3);
    selectedConwayPreset = normalizeConwayPresetName(state.preset_conway);
    selectedGenerationsPreset = normalizeGenerationsPresetName(state.preset_gen);

    updateModeUI(mode);
    sim.set_birth_rule(birthMask);
    sim.set_survival_rule(survivalMask);

    const conwayPreset = document.getElementById('conway-preset');
    if (conwayPreset) conwayPreset.value = selectedConwayPreset;
    const genPreset = document.getElementById('gen-preset');
    if (genPreset) genPreset.value = selectedGenerationsPreset;

    if (mode === 1) {
        generationsCount = nextGenerations;
        sim.set_generations(generationsCount);
        const genStates = document.getElementById('gen-states');
        const genStatesVal = document.getElementById('gen-states-val');
        const paintStateInput = document.getElementById('paint-state');
        if (genStates) genStates.value = String(generationsCount);
        if (genStatesVal) genStatesVal.textContent = String(generationsCount);
        if (paintStateInput) paintStateInput.max = String(generationsCount - 1);
        if (paintState >= generationsCount) {
            paintState = generationsCount - 1;
            if (paintStateInput) paintStateInput.value = String(paintState);
            const paintStateVal = document.getElementById('paint-state-val');
            if (paintStateVal) paintStateVal.textContent = String(paintState);
        }
    } else {
        generationsCount = 3;
    }

    buildCheckboxRow(document.getElementById('birth-row'), 'b', Number(sim.get_birth_mask()));
    buildCheckboxRow(document.getElementById('survival-row'), 's', Number(sim.get_survival_mask()));
    buildCheckboxRow(document.getElementById('gen-birth-row'), 'gb', Number(sim.get_birth_mask()));
    buildCheckboxRow(document.getElementById('gen-survival-row'), 'gs', Number(sim.get_survival_mask()));
    return true;
}

function clampToTier(size) {
    let closest = GRID_TIERS[0];
    let bestDist = Math.abs(size - closest);
    for (let i = 1; i < GRID_TIERS.length; i++) {
        const candidate = GRID_TIERS[i];
        const dist = Math.abs(size - candidate);
        if (dist < bestDist) {
            closest = candidate;
            bestDist = dist;
        }
    }
    return closest;
}

function tierIndex(size) {
    return GRID_TIERS.indexOf(clampToTier(size));
}

function detectAutoTargetResolution() {
    const cores = Number(navigator.hardwareConcurrency || 0);
    const memory = Number(navigator.deviceMemory || 0);
    const dpr = Math.min(Number(window.devicePixelRatio || 1), 2);
    const viewport = Math.max(window.innerWidth || 0, window.innerHeight || 0) * dpr;
    const ua = navigator.userAgent || '';
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);

    let target = clampToTier(Math.max(512, Math.min(1280, Math.round(viewport))));
    let penalty = 0;
    if (memory > 0 && memory <= 4) penalty += 2;
    else if (memory > 0 && memory <= 6) penalty += 1;
    if (cores > 0 && cores <= 4) penalty += 2;
    else if (cores > 0 && cores <= 6) penalty += 1;
    if (isMobileUA) penalty += 1;

    let idx = tierIndex(target) - penalty;
    if (idx < 0) idx = 0;
    if (idx >= GRID_TIERS.length) idx = GRID_TIERS.length - 1;
    autoTargetResolution = GRID_TIERS[idx];
    return autoTargetResolution;
}

function applySimulationResolution(nextSize, reseed = true, emitHost = true) {
    const size = clampToTier(nextSize);
    sim.set_grid_size(size, size);
    syncGridDimensions();
    reallocateSimulationTexture();
    if (reseed) {
        sim.randomize_with_seed(0.11, Math.floor(Math.random() * 0xFFFFFFFF));
    }
    adaptiveLowFpsMs = 0;
    adaptiveHighFpsMs = 0;
    adaptiveCooldownUntil = performance.now() + ADAPTIVE_COOLDOWN_MS;
    updateResolutionUI();
    needsUpload = true;
    needsRender = true;
    statsDirty = true;
    if (emitHost) {
        pushDesktopConfigPatch({ resolution: simResolution });
    }
}

function persistResolutionPrefs() {
    safeWriteStorage(RES_STORAGE_MODE_KEY, resolutionMode);
    safeWriteStorage(RES_STORAGE_VALUE_KEY, String(simResolution));
}

function setResolutionModeAuto() {
    resolutionMode = 'auto';
    persistResolutionPrefs();
    applySimulationResolution(detectAutoTargetResolution(), true);
    applyBatteryResolutionPolicy();
}

function toggleSimulationResolution() {
    if (resolutionMode === 'auto') {
        resolutionMode = 'manual';
        const manual = simResolution <= 512 ? 1024 : 512;
        persistResolutionPrefs();
        applySimulationResolution(manual, true);
        applyBatteryResolutionPolicy();
        return;
    }
    if (simResolution <= 512) {
        resolutionMode = 'manual';
        persistResolutionPrefs();
        applySimulationResolution(1024, true);
        applyBatteryResolutionPolicy();
        return;
    }
    setResolutionModeAuto();
}

function applyAdaptiveResolution(dt, fps) {
    if (resolutionMode !== 'auto') return;
    const now = performance.now();
    if (now < adaptiveCooldownUntil) return;

    const idx = tierIndex(simResolution);
    if (fps < ADAPTIVE_LOW_FPS && idx > 0) {
        adaptiveLowFpsMs += dt;
        adaptiveHighFpsMs = 0;
        if (adaptiveLowFpsMs >= ADAPTIVE_LOW_WINDOW_MS) {
            applySimulationResolution(GRID_TIERS[idx - 1], true);
        }
        return;
    }

    if (fps > ADAPTIVE_HIGH_FPS && idx < tierIndex(autoTargetResolution)) {
        adaptiveHighFpsMs += dt;
        adaptiveLowFpsMs = 0;
        if (adaptiveHighFpsMs >= ADAPTIVE_HIGH_WINDOW_MS) {
            applySimulationResolution(GRID_TIERS[idx + 1], true);
        }
        return;
    }

    adaptiveLowFpsMs = 0;
    adaptiveHighFpsMs = 0;
}

function initWebGL() {
    canvas = document.getElementById('canvas');

    gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) {
        alert('WebGL2 not supported');
        return false;
    }

    // Main program
    program = createProgram(VERT_SRC, FRAG_SRC);

    // Bloom program
    bloomProgram = createProgram(BLOOM_VERT, BLOOM_FRAG);

    // Fullscreen quad
    const quadVerts = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);

    // Set up attribute for all programs
    for (const prog of [program, bloomProgram]) {
        const loc = gl.getAttribLocation(prog, 'a_pos');
        if (loc >= 0) {
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        }
    }

    // Create texture for simulation output
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gridW, gridH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    // Bloom FBOs (2 ping-pong at half resolution)
    applyRenderResolution();

    window.addEventListener('resize', () => {
        applyRenderResolution();
        needsRender = true;
    });
    // Cache uniform locations
    u_program = {
        u_tex: gl.getUniformLocation(program, 'u_tex'),
        u_pan: gl.getUniformLocation(program, 'u_pan'),
        u_zoom: gl.getUniformLocation(program, 'u_zoom'),
        u_resolution: gl.getUniformLocation(program, 'u_resolution'),
    };
    u_bloom = {
        u_tex: gl.getUniformLocation(bloomProgram, 'u_tex'),
        u_dir: gl.getUniformLocation(bloomProgram, 'u_dir'),
        u_texSize: gl.getUniformLocation(bloomProgram, 'u_texSize'),
    };

    return true;
}

function setupBloomFBOs() {
    // Clean up old
    for (const fbo of bloomFBOs) {
        gl.deleteFramebuffer(fbo.fb);
        gl.deleteTexture(fbo.tex);
    }
    bloomFBOs = [];
    bloomSupported = true;

    const bw = Math.floor(canvas.width / 2);
    const bh = Math.floor(canvas.height / 2);

    for (let i = 0; i < 2; i++) {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, bw, bh, 0, gl.RGBA, gl.FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            bloomSupported = false;
        }

        bloomFBOs.push({ fb, tex, w: bw, h: bh });
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!bloomSupported) {
        bloomEnabled = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Rendering
// ═══════════════════════════════════════════════════════════════════════

function uploadPixels() {
    sim.refresh_pixels();
    const ptr = sim.get_pixels_ptr();
    const len = sim.get_pixels_len();
    const buf = wasmMemory.memory.buffer;
    if (
        !wasmPixelsView ||
        wasmPixelsBuffer !== buf ||
        wasmPixelsPtr !== ptr ||
        wasmPixelsLen !== len
    ) {
        wasmPixelsView = new Uint8Array(buf, ptr, len);
        wasmPixelsBuffer = buf;
        wasmPixelsPtr = ptr;
        wasmPixelsLen = len;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gridW, gridH, gl.RGBA, gl.UNSIGNED_BYTE, wasmPixelsView);
}

function render() {
    const cw = canvas.width, ch = canvas.height;

    if (bloomEnabled) {
        // Pass 1: Render scene to bloomFBO[0]
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOs[0].fb);
        gl.viewport(0, 0, bloomFBOs[0].w, bloomFBOs[0].h);
        drawScene();

        // Pass 2: Horizontal blur → bloomFBO[1]
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOs[1].fb);
        gl.viewport(0, 0, bloomFBOs[1].w, bloomFBOs[1].h);
        gl.useProgram(bloomProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, bloomFBOs[0].tex);
        gl.uniform1i(u_bloom.u_tex, 0);
        gl.uniform2f(u_bloom.u_dir, 1.0, 0.0);
        gl.uniform2f(u_bloom.u_texSize, bloomFBOs[0].w, bloomFBOs[0].h);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Pass 3: Vertical blur → bloomFBO[0]
        gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOs[0].fb);
        gl.viewport(0, 0, bloomFBOs[0].w, bloomFBOs[0].h);
        gl.bindTexture(gl.TEXTURE_2D, bloomFBOs[1].tex);
        gl.uniform2f(u_bloom.u_dir, 0.0, 1.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Pass 4: Draw scene to screen
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, cw, ch);
        drawScene();

        // Additive bloom overlay
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(bloomProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, bloomFBOs[0].tex);
        gl.uniform1i(u_bloom.u_tex, 0);
        gl.uniform2f(u_bloom.u_dir, 0.0, 0.0);
        gl.uniform2f(u_bloom.u_texSize, cw, ch);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disable(gl.BLEND);
    } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, cw, ch);
        drawScene();
    }
}

function drawScene() {
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u_program.u_tex, 0);
    gl.uniform2f(u_program.u_pan, viewX, viewY);
    gl.uniform1f(u_program.u_zoom, zoom);
    gl.uniform2f(u_program.u_resolution, canvas.width, canvas.height);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// drawSceneFinal removed — bloom overlay handled inline in render()

// ═══════════════════════════════════════════════════════════════════════
// Screen ↔ Grid coordinate conversion
// ═══════════════════════════════════════════════════════════════════════

function screenToGrid(sx, sy) {
    const displayWidth = canvas.clientWidth || window.innerWidth;
    const displayHeight = canvas.clientHeight || window.innerHeight;
    // Convert screen pixel to normalized device coords
    const ndcX = (sx / displayWidth) * 2 - 1;
    const ndcY = 1 - (sy / displayHeight) * 2;

    // Reverse pan+zoom to get UV
    const uvX = ndcX / zoom + viewX;
    const uvY = ndcY / zoom + viewY;

    // UV to grid coords
    let gx = (uvX * 0.5 + 0.5) * gridW;
    let gy = (uvY * 0.5 + 0.5) * gridH;

    // Toroidal wrap
    gx = ((gx % gridW) + gridW) % gridW;
    gy = ((gy % gridH) + gridH) % gridH;

    return { x: Math.floor(gx), y: Math.floor(gy) };
}

function normalizeZoom(value) {
    let nextZoom = Math.max(0.25, Math.min(value, 32));
    if (nextZoom > 0.9 && nextZoom < 1.1) nextZoom = 1;
    const rounded = Math.round(nextZoom);
    if (nextZoom > 1 && Math.abs(nextZoom - rounded) < 0.15) nextZoom = rounded;
    return nextZoom;
}

function updateZoomUI() {
    const zoomVal = document.getElementById('zoom-val');
    if (zoomVal) {
        zoomVal.textContent = `${zoom.toFixed(2)}x`;
    }
}

function updatePlaybackUI() {
    const label = playing ? '⏸ PAUSE' : '▶ PLAY';
    const icon = playing ? '⏸' : '▶';
    const desktopBtn = document.getElementById('btn-play');
    const mobileBtn = document.getElementById('btn-mobile-play');
    if (desktopBtn) desktopBtn.textContent = label;
    if (mobileBtn) mobileBtn.textContent = icon;
}

function updateWallpaperToggleUI() {
    const btn = document.getElementById('btn-wallpaper-toggle');
    if (!btn) return;
    if (!isDesktopRuntime()) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = '';
    const effective = wallpaperTogglePendingTarget === null
        ? wallpaperSessionActive
        : wallpaperTogglePendingTarget;
    btn.textContent = wallpaperTogglePendingTarget === null
        ? (effective ? 'WALLPAPER: ON' : 'WALLPAPER: OFF')
        : (effective ? 'SWITCHING: ON...' : 'SWITCHING: OFF...');
    btn.classList.toggle('accent', effective);
    btn.disabled = wallpaperTogglePendingTarget !== null;
}

function updateMobileEraseUI() {
    const paintBtn = document.getElementById('btn-touch-paint');
    const eraseBtn = document.getElementById('btn-touch-erase');
    if (!paintBtn || !eraseBtn) return;
    paintBtn.classList.toggle('active', !mobileEraseMode);
    eraseBtn.classList.toggle('active', mobileEraseMode);
}

function setZoom(nextZoom, updateUi = true) {
    const normalized = normalizeZoom(nextZoom);
    if (Math.abs(normalized - zoom) < 0.0001) {
        if (updateUi) updateZoomUI();
        return;
    }
    zoom = normalized;
    if (updateUi) updateZoomUI();
    needsRender = true;
}

function zoomBy(factor) {
    setZoom(zoom * factor);
}

function resetView() {
    viewX = 0;
    viewY = 0;
    setZoom(1);
}

function scheduleNextFrame(delayMs = 0) {
    if (loopTimerId) {
        clearTimeout(loopTimerId);
        loopTimerId = 0;
    }
    if (delayMs <= 0) {
        requestAnimationFrame(gameLoop);
        return;
    }
    loopTimerId = setTimeout(() => {
        loopTimerId = 0;
        requestAnimationFrame(gameLoop);
    }, delayMs);
}

function closeMobileSheets() {
    mobileSheet = null;
    document.querySelectorAll('#top-bar, #left-panel, #right-panel, #bottom-bar').forEach(panel => {
        panel.classList.remove('mobile-open');
    });
    const backdrop = document.getElementById('mobile-sheet-backdrop');
    if (backdrop) backdrop.classList.remove('open');
}

function setMobileSheet(panelId) {
    if (!mobileUI) return;
    if (mobileSheet === panelId) {
        closeMobileSheets();
        return;
    }
    mobileSheet = panelId;
    document.querySelectorAll('#top-bar, #left-panel, #right-panel, #bottom-bar').forEach(panel => {
        panel.classList.toggle('mobile-open', panel.id === panelId);
    });
    const backdrop = document.getElementById('mobile-sheet-backdrop');
    if (backdrop) backdrop.classList.add('open');
}

function setMobileUI(enabled) {
    mobileUI = enabled;
    document.body.classList.toggle('mobile-ui', enabled);
    if (!enabled) {
        closeMobileSheets();
    }
}

function clampSpeed(value) {
    return Math.max(1, Math.min(MAX_SPEED, value | 0));
}

function speedFromSlider(sliderValue) {
    const t = Math.max(0, Math.min(SPEED_SLIDER_MAX, sliderValue | 0)) / SPEED_SLIDER_MAX;
    const mapped = Math.exp(Math.log(MAX_SPEED) * t);
    return clampSpeed(Math.round(mapped));
}

function sliderFromSpeed(speedValue) {
    const s = clampSpeed(speedValue);
    const t = Math.log(s) / Math.log(MAX_SPEED);
    return Math.max(0, Math.min(SPEED_SLIDER_MAX, Math.round(t * SPEED_SLIDER_MAX)));
}

function setSpeed(value, syncSlider = true, emitHost = true) {
    const nextSpeed = clampSpeed(value);
    const changed = nextSpeed !== speed;
    speed = nextSpeed;
    if (syncSlider) {
        const speedSlider = document.getElementById('speed');
        if (speedSlider) speedSlider.value = sliderFromSpeed(speed);
    }
    const speedVal = document.getElementById('speed-val');
    if (speedVal) speedVal.textContent = speed;
    if (emitHost && changed) {
        pushDesktopConfigPatch({ fps_cap: speed });
    }
}

function effectiveTickRate() {
    if (isDesktopRuntime() && wallpaperSessionActive && desktopOnBattery) {
        return Math.min(speed, BATTERY_WALLPAPER_FPS_CAP);
    }
    return speed;
}

function refreshPerformanceOverrides() {
    const theme = THEMES[currentTheme] || THEMES[0];
    const forceNoBloom = wallpaperSessionActive || (isDesktopRuntime() && desktopOnBattery);
    bloomEnabled = !forceNoBloom && theme.bloom && bloomSupported;
}

function applyBatteryResolutionPolicy() {
    if (!isDesktopRuntime() || !sim) return;
    const shouldEco = wallpaperSessionActive && desktopOnBattery;
    if (shouldEco && !batteryEcoResolutionActive) {
        batteryEcoBaseResolution = simResolution;
        const idx = tierIndex(simResolution);
        if (idx > 0) {
            applySimulationResolution(GRID_TIERS[idx - 1], false);
        }
        batteryEcoResolutionActive = true;
        return;
    }
    if (!shouldEco && batteryEcoResolutionActive) {
        const restore = clampToTier(Number(batteryEcoBaseResolution || simResolution));
        if (restore !== simResolution) {
            applySimulationResolution(restore, false);
        }
        batteryEcoResolutionActive = false;
        batteryEcoBaseResolution = null;
    }
}

function ensureLoopRunning() {
    if (!loopSuspended) return;
    loopSuspended = false;
    lastFrameTime = performance.now();
    scheduleNextFrame(0);
}

function setWallpaperSessionActive(active) {
    wallpaperSessionActive = !!active;
    wallpaperTogglePendingTarget = null;
    if (wallpaperTogglePendingTimer) {
        clearTimeout(wallpaperTogglePendingTimer);
        wallpaperTogglePendingTimer = 0;
    }
    document.body.classList.toggle('wallpaper-session', wallpaperSessionActive);
    updateWallpaperToggleUI();
    const exitBtn = document.getElementById('btn-exit-view');
    if (exitBtn) {
        exitBtn.style.display = wallpaperSessionActive ? 'none' : '';
    }
    if (wallpaperSessionActive) {
        setPresentationMode(true);
    } else {
        setPresentationMode(false);
        hostCursorLast = null;
        ensureLoopRunning();
    }
    refreshPerformanceOverrides();
    applyBatteryResolutionPolicy();
}

function setDesktopViewportActive(active) {
    const wasActive = desktopViewportActive;
    desktopViewportActive = !!active;
    if (!desktopViewportActive) {
        hostCursorLast = null;
        tickAccumulator = 0;
    } else if (!wasActive && desktopViewportActive) {
        ensureLoopRunning();
    }
}

function setDesktopPowerState(onBattery) {
    desktopOnBattery = !!onBattery;
    refreshPerformanceOverrides();
    applyBatteryResolutionPolicy();
}

function applyDesktopConfig(payload) {
    if (!sim) {
        desktopPendingConfig = payload;
        return;
    }
    const cfg = payload || {};
    suppressHostConfigEmit = true;
    if (Number.isFinite(cfg.resolution)) {
        resolutionMode = 'manual';
        applySimulationResolution(Number(cfg.resolution), false, false);
        applyBatteryResolutionPolicy();
    }
    if (Number.isFinite(cfg.fps_cap)) {
        setSpeed(Number(cfg.fps_cap), true, false);
    }
    if (Number.isFinite(cfg.theme)) {
        applyTheme(Number(cfg.theme), false, false);
    }
    suppressHostConfigEmit = false;
}

function screenFromHostToClient(payload) {
    const px = Number(payload?.x);
    const py = Number(payload?.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    const width = canvas?.clientWidth || window.innerWidth;
    const height = canvas?.clientHeight || window.innerHeight;

    const sw = Number(payload?.screen_w);
    const sh = Number(payload?.screen_h);
    if (Number.isFinite(sw) && Number.isFinite(sh) && sw > 0 && sh > 0) {
        return {
            x: Math.max(0, Math.min(width - 1, (px / sw) * width)),
            y: Math.max(0, Math.min(height - 1, (py / sh) * height)),
        };
    }

    const originX = Number.isFinite(window.screenX) ? window.screenX : (window.screenLeft || 0);
    const originY = Number.isFinite(window.screenY) ? window.screenY : (window.screenTop || 0);
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

function paintFromHostCursor(payload) {
    if (!wallpaperSessionActive || !desktopViewportActive || !sim || !playing) {
        hostCursorLast = null;
        return;
    }
    const point = screenFromHostToClient(payload);
    if (!point) {
        hostCursorLast = null;
        return;
    }
    if (!hostCursorLast) {
        paintAt(point.x, point.y, false);
        hostCursorLast = point;
        return;
    }
    const dx = point.x - hostCursorLast.x;
    const dy = point.y - hostCursorLast.y;
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    const steps = Math.max(1, Math.ceil(distance / 3));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        paintAt(hostCursorLast.x + dx * t, hostCursorLast.y + dy * t, false);
    }
    hostCursorLast = point;
}

function applyDesktopCursorMove(payload) {
    paintFromHostCursor(payload || {});
}

function updateAmbientUI() {
    const btn = document.getElementById('btn-ambient');
    if (!btn) return;
    btn.textContent = ambientMode ? 'AMBIENT ON' : 'AMBIENT';
    btn.classList.toggle('accent', ambientMode);
}

function updateModeUI(mode) {
    currentMode = mode;
    sim.set_rule_mode(mode);

    document.getElementById('conway-rules').style.display = mode === 0 ? 'block' : 'none';
    document.getElementById('generations-rules').style.display = mode === 1 ? 'block' : 'none';
    document.getElementById('paint-state-section').style.display = mode === 1 ? 'block' : 'none';

    document.querySelectorAll('#mode-toggle .mode-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.mode) === mode);
    });
}

function applyPreset(mode, name) {
    if (mode === 0) {
        applyConwayPreset(name);
        document.getElementById('conway-preset').value = name;
    } else {
        applyGenPreset(name);
        document.getElementById('gen-preset').value = name;
    }
}

function setPresentationMode(enabled) {
    if (wallpaperSessionActive && !enabled) return;
    presentationMode = enabled;
    document.body.classList.toggle('presentation', enabled);
    if (enabled) {
        closeMobileSheets();
    }
    if (enabled) {
        setAboutOpen(false);
    }
    const btn = document.getElementById('btn-present');
    btn.textContent = enabled ? 'EDIT MODE' : 'PRESENT';
    btn.classList.toggle('accent', enabled);
    needsRender = true;
}

function setAboutOpen(enabled) {
    aboutOpen = enabled;
    const modal = document.getElementById('about-modal');
    modal.classList.toggle('open', enabled);
    modal.setAttribute('aria-hidden', enabled ? 'false' : 'true');
    if (enabled) {
        closeMobileSheets();
    }
}

function flashThemeBadge(name) {
    const badge = document.getElementById('theme-badge');
    badge.textContent = `Theme: ${name}`;
    badge.classList.add('show');
    if (themeBadgeTimeout) {
        clearTimeout(themeBadgeTimeout);
    }
    themeBadgeTimeout = setTimeout(() => {
        badge.classList.remove('show');
    }, 1400);
}

function applyTheme(themeIndex, announce = true, emitHost = true) {
    const nextTheme = ((themeIndex % THEMES.length) + THEMES.length) % THEMES.length;
    const changed = nextTheme !== currentTheme;
    currentTheme = nextTheme;
    const theme = THEMES[currentTheme];
    document.body.dataset.theme = theme.bodyTheme;
    bloomStrength = theme.bloomStrength;
    refreshPerformanceOverrides();
    sim.set_theme(currentTheme);
    document.getElementById('btn-theme').textContent = `THEME: ${theme.name.toUpperCase()}`;
    needsUpload = true;
    needsRender = true;
    if (emitHost && changed) {
        pushDesktopConfigPatch({ theme: currentTheme });
    }
    if (announce) {
        flashThemeBadge(theme.name);
    }
}

function cycleTheme() {
    applyTheme(currentTheme + 1);
}

function applyAmbientScene() {
    const scene = AMBIENT_SCENES[Math.floor(Math.random() * AMBIENT_SCENES.length)];
    updateModeUI(scene.mode);
    applyPreset(scene.mode, scene.preset);
    applyPresetScene(scene.mode, scene.preset);
    applyTheme(scene.theme, false, false);
    resetView();
    setZoom(scene.zoom, false);
    sim.randomize_with_seed(scene.density, scene.seed + Math.floor(performance.now()));
    setSpeed(scene.speed, true, false);
    needsUpload = true;
    needsRender = true;
    statsDirty = true;
}

function disableAmbientMode() {
    if (!ambientMode) return;
    ambientMode = false;
    ambientStartTime = 0;
    ambientLastReseedAt = 0;
    ambientNextMotionAt = 0;
    ambientNextHealthCheckAt = 0;
    updateAmbientUI();
    updateZoomUI();
    setPresentationMode(false);
}

function setAmbientMode(enabled) {
    if (enabled) {
        ambientMode = true;
        ambientStartTime = performance.now();
        ambientLastReseedAt = ambientStartTime;
        ambientNextMotionAt = ambientStartTime;
        ambientNextHealthCheckAt = ambientStartTime;
        updateAmbientUI();
        setAboutOpen(false);
        applyAmbientScene();
        playing = true;
        updatePlaybackUI();
        setPresentationMode(true);
    } else {
        disableAmbientMode();
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Painting
// ═══════════════════════════════════════════════════════════════════════

function paintAt(sx, sy, erase) {
    const { x, y } = screenToGrid(sx, sy);
    const state = erase ? 0 : paintState;
    const half = Math.floor(brushSize / 2);

    if (brushShape === 'square') {
        // Reuse brush buffer to avoid per-stroke allocations.
        const area = brushSize * brushSize;
        if (squareBrushBuffer.length !== area) {
            squareBrushBuffer = new Uint8Array(area);
            squareBrushFillState = 255;
        }
        if (squareBrushFillState !== state) {
            squareBrushBuffer.fill(state);
            squareBrushFillState = state;
        }
        sim.fill_region(
            (x - half + gridW) % gridW,
            (y - half + gridH) % gridH,
            brushSize, brushSize, squareBrushBuffer
        );
        needsUpload = true;
        needsRender = true;
    } else if (brushShape === 'circle') {
        for (let dy = -half; dy <= half; dy++) {
            for (let dx = -half; dx <= half; dx++) {
                if (dx * dx + dy * dy <= half * half) {
                    sim.set_cell(
                        (x + dx + gridW) % gridW,
                        (y + dy + gridH) % gridH,
                        state
                    );
                }
            }
        }
        needsUpload = true;
        needsRender = true;
    } else { // spray
        const count = brushSize * brushSize / 3;
        for (let i = 0; i < count; i++) {
            const dx = Math.floor(Math.random() * brushSize) - half;
            const dy = Math.floor(Math.random() * brushSize) - half;
            sim.set_cell(
                (x + dx + gridW) % gridW,
                (y + dy + gridH) % gridH,
                state
            );
        }
        needsUpload = true;
        needsRender = true;
    }
}

// ═══════════════════════════════════════════════════════════════════════
// UI Wiring
// ═══════════════════════════════════════════════════════════════════════

function buildCheckboxRow(container, prefix, mask) {
    container.innerHTML = '';
    for (let i = 0; i <= 8; i++) {
        const item = document.createElement('div');
        item.className = 'cb-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = `${prefix}-${i}`;
        cb.checked = (mask >> i) & 1;
        const lbl = document.createElement('label');
        lbl.setAttribute('for', cb.id);
        lbl.textContent = i;
        item.appendChild(cb);
        item.appendChild(lbl);
        container.appendChild(item);
    }
}

function readCheckboxMask(container) {
    let mask = 0;
    const cbs = container.querySelectorAll('input[type="checkbox"]');
    cbs.forEach((cb, i) => {
        if (cb.checked) mask |= (1 << i);
    });
    return mask;
}

function setMode(mode) {
    disableAmbientMode();
    closeMobileSheets();
    updateModeUI(mode);
    if (mode === 0) {
        applyPreset(0, selectedConwayPreset);
        applyPresetScene(0, selectedConwayPreset);
    } else if (mode === 1) {
        applyPreset(1, selectedGenerationsPreset);
        applyPresetScene(1, selectedGenerationsPreset);
    }
    persistDesktopRuleState();
}

function applyConwayPreset(name) {
    const presetName = normalizeConwayPresetName(name);
    selectedConwayPreset = presetName;
    const p = CONWAY_PRESETS[presetName];
    if (!p) return;
    sim.set_birth_rule(p.b);
    sim.set_survival_rule(p.s);
    const conwayPreset = document.getElementById('conway-preset');
    if (conwayPreset) conwayPreset.value = presetName;
    buildCheckboxRow(document.getElementById('birth-row'), 'b', p.b);
    buildCheckboxRow(document.getElementById('survival-row'), 's', p.s);
    persistDesktopRuleState();
}

function applyGenPreset(name) {
    const presetName = normalizeGenerationsPresetName(name);
    selectedGenerationsPreset = presetName;
    const p = GEN_PRESETS[presetName];
    if (!p) return;
    sim.set_birth_rule(p.b);
    sim.set_survival_rule(p.s);
    generationsCount = p.states;
    sim.set_generations(p.states);
    const genPreset = document.getElementById('gen-preset');
    if (genPreset) genPreset.value = presetName;
    buildCheckboxRow(document.getElementById('gen-birth-row'), 'gb', p.b);
    buildCheckboxRow(document.getElementById('gen-survival-row'), 'gs', p.s);
    document.getElementById('gen-states').value = p.states;
    document.getElementById('gen-states-val').textContent = p.states;
    document.getElementById('paint-state').max = p.states - 1;
    if (paintState >= p.states) {
        paintState = p.states - 1;
        document.getElementById('paint-state').value = paintState;
        document.getElementById('paint-state-val').textContent = paintState;
    }
    persistDesktopRuleState();
}

function applyPresetScene(mode, name) {
    const preset = mode === 0 ? CONWAY_PRESETS[name] : GEN_PRESETS[name];
    if (!preset) return;
    sim.clear();
    // Keep user-selected speed when changing rules/presets.
    setSpeed(speed, true, false);
    needsUpload = true;
    needsRender = true;
    statsDirty = true;
}

function wireUI() {
    // Mode toggle
    document.querySelectorAll('#mode-toggle .mode-btn').forEach(btn => {
        btn.addEventListener('click', () => setMode(parseInt(btn.dataset.mode)));
    });

    // Brush size
    const brushSlider = document.getElementById('brush-size');
    brushSlider.addEventListener('input', () => {
        brushSize = parseInt(brushSlider.value);
        squareBrushBuffer = new Uint8Array(brushSize * brushSize);
        squareBrushBuffer.fill(paintState);
        squareBrushFillState = paintState;
        document.getElementById('brush-size-val').textContent = brushSize;
    });

    // Brush shape
    document.querySelectorAll('#brush-shape-toggle .mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            brushShape = btn.dataset.shape;
            document.querySelectorAll('#brush-shape-toggle .mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Paint state
    const paintSlider = document.getElementById('paint-state');
    paintSlider.addEventListener('input', () => {
        paintState = parseInt(paintSlider.value);
        if (squareBrushFillState !== paintState) {
            squareBrushBuffer.fill(paintState);
            squareBrushFillState = paintState;
        }
        document.getElementById('paint-state-val').textContent = paintState;
    });

    // Conway presets
    const conwayPreset = document.getElementById('conway-preset');
    conwayPreset.addEventListener('change', () => {
        disableAmbientMode();
        closeMobileSheets();
        applyConwayPreset(conwayPreset.value);
        applyPresetScene(0, conwayPreset.value);
    });

    // Conway B/S checkboxes
    buildCheckboxRow(document.getElementById('birth-row'), 'b', sim.get_birth_mask());
    buildCheckboxRow(document.getElementById('survival-row'), 's', sim.get_survival_mask());

    document.getElementById('birth-row').addEventListener('change', () => {
        sim.set_birth_rule(readCheckboxMask(document.getElementById('birth-row')));
        persistDesktopRuleState();
    });
    document.getElementById('survival-row').addEventListener('change', () => {
        sim.set_survival_rule(readCheckboxMask(document.getElementById('survival-row')));
        persistDesktopRuleState();
    });

    // Generations presets
    const genPreset = document.getElementById('gen-preset');
    genPreset.addEventListener('change', () => {
        disableAmbientMode();
        closeMobileSheets();
        applyGenPreset(genPreset.value);
        applyPresetScene(1, genPreset.value);
    });

    buildCheckboxRow(document.getElementById('gen-birth-row'), 'gb', sim.get_birth_mask());
    buildCheckboxRow(document.getElementById('gen-survival-row'), 'gs', sim.get_survival_mask());

    document.getElementById('gen-birth-row').addEventListener('change', () => {
        sim.set_birth_rule(readCheckboxMask(document.getElementById('gen-birth-row')));
        persistDesktopRuleState();
    });
    document.getElementById('gen-survival-row').addEventListener('change', () => {
        sim.set_survival_rule(readCheckboxMask(document.getElementById('gen-survival-row')));
        persistDesktopRuleState();
    });

    const genStates = document.getElementById('gen-states');
    genStates.addEventListener('input', () => {
        const v = parseInt(genStates.value);
        generationsCount = v;
        sim.set_generations(v);
        document.getElementById('gen-states-val').textContent = v;
        document.getElementById('paint-state').max = v - 1;
        persistDesktopRuleState();
    });


    // Playback
    const btnPlay = document.getElementById('btn-play');
    const btnAmbient = document.getElementById('btn-ambient');
    const btnWallpaperToggle = document.getElementById('btn-wallpaper-toggle');
    const btnPresent = document.getElementById('btn-present');
    const btnTheme = document.getElementById('btn-theme');
    const btnExitView = document.getElementById('btn-exit-view');
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnZoomReset = document.getElementById('btn-zoom-reset');
    const btnAbout = document.getElementById('btn-about');
    const btnAboutClose = document.getElementById('btn-about-close');
    const aboutBackdrop = document.getElementById('about-backdrop');
    const mobileBackdrop = document.getElementById('mobile-sheet-backdrop');
    const btnMobileTools = document.getElementById('btn-mobile-tools');
    const btnMobileRules = document.getElementById('btn-mobile-rules');
    const btnMobilePlay = document.getElementById('btn-mobile-play');
    const btnMobileControls = document.getElementById('btn-mobile-controls');
    const btnMobileMore = document.getElementById('btn-mobile-more');
    const btnTouchPaint = document.getElementById('btn-touch-paint');
    const btnTouchErase = document.getElementById('btn-touch-erase');

    btnAbout.addEventListener('click', () => {
        setAboutOpen(true);
    });

    if (btnWallpaperToggle) {
        btnWallpaperToggle.addEventListener('click', () => {
            if (!isDesktopRuntime()) return;
            if (wallpaperTogglePendingTarget !== null) return;
            const next = !wallpaperSessionActive;
            wallpaperTogglePendingTarget = next;
            updateWallpaperToggleUI();
            desktopHost.setWallpaperActive(next);
            wallpaperTogglePendingTimer = window.setTimeout(() => {
                wallpaperTogglePendingTarget = null;
                wallpaperTogglePendingTimer = 0;
                updateWallpaperToggleUI();
            }, 1500);
        });
    }

    btnAboutClose.addEventListener('click', () => {
        setAboutOpen(false);
    });

    aboutBackdrop.addEventListener('click', () => {
        setAboutOpen(false);
    });

    mobileBackdrop.addEventListener('click', () => {
        closeMobileSheets();
    });

    btnMobileTools.addEventListener('click', () => {
        setMobileSheet('left-panel');
    });

    btnMobileRules.addEventListener('click', () => {
        setMobileSheet('right-panel');
    });

    btnMobileControls.addEventListener('click', () => {
        setMobileSheet('bottom-bar');
    });

    btnMobileMore.addEventListener('click', () => {
        setMobileSheet('top-bar');
    });

    btnMobilePlay.addEventListener('click', () => {
        disableAmbientMode();
        playing = !playing;
        updatePlaybackUI();
        needsRender = true;
    });

    btnTouchPaint.addEventListener('click', () => {
        mobileEraseMode = false;
        updateMobileEraseUI();
    });

    btnTouchErase.addEventListener('click', () => {
        mobileEraseMode = true;
        updateMobileEraseUI();
    });

    btnAmbient.addEventListener('click', () => {
        closeMobileSheets();
        setAmbientMode(!ambientMode);
    });

    btnPresent.addEventListener('click', () => {
        if (ambientMode) {
            disableAmbientMode();
            return;
        }
        closeMobileSheets();
        setPresentationMode(!presentationMode);
    });

    btnExitView.addEventListener('click', () => {
        if (ambientMode) {
            disableAmbientMode();
        } else {
            setPresentationMode(false);
        }
    });

    btnTheme.addEventListener('click', () => {
        disableAmbientMode();
        closeMobileSheets();
        cycleTheme();
    });

    btnZoomIn.addEventListener('click', () => {
        disableAmbientMode();
        zoomBy(1.2);
    });

    btnZoomOut.addEventListener('click', () => {
        disableAmbientMode();
        zoomBy(1 / 1.2);
    });

    btnZoomReset.addEventListener('click', () => {
        disableAmbientMode();
        setZoom(1);
    });

    btnPlay.addEventListener('click', () => {
        disableAmbientMode();
        playing = !playing;
        updatePlaybackUI();
        needsRender = true;
    });

    document.getElementById('btn-step').addEventListener('click', () => {
        disableAmbientMode();
        closeMobileSheets();
        sim.tick_no_render(1);
        needsUpload = true;
        needsRender = true;
        statsDirty = true;
    });

    document.getElementById('btn-clear').addEventListener('click', () => {
        disableAmbientMode();
        closeMobileSheets();
        sim.clear();
        needsUpload = true;
        needsRender = true;
        statsDirty = true;
    });

    document.getElementById('btn-randomize').addEventListener('click', () => {
        disableAmbientMode();
        closeMobileSheets();
        const density = 0.3;
        sim.randomize_with_seed(density, Math.floor(Math.random() * 0xFFFFFFFF));
        needsUpload = true;
        needsRender = true;
        statsDirty = true;
    });

    // Speed
    const speedSlider = document.getElementById('speed');
    speedSlider.addEventListener('input', () => {
        disableAmbientMode();
        setSpeed(speedFromSlider(parseInt(speedSlider.value)), false);
    });

    // Export PNG
    document.getElementById('btn-export').addEventListener('click', () => {
        closeMobileSheets();
        if (needsUpload) {
            uploadPixels();
            needsUpload = false;
        }
        render();
        canvas.toBlob(blob => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `forma-gen${Number(sim.get_generation())}.png`;
            a.click();
            URL.revokeObjectURL(a.href);
        });
    });

    document.getElementById('btn-random-rule').addEventListener('click', () => {
        disableAmbientMode();
        closeMobileSheets();
        const b = Math.floor(Math.random() * 512);
        const s = Math.floor(Math.random() * 512);
        sim.set_birth_rule(b);
        sim.set_survival_rule(s);
        if (currentMode === 0) {
            buildCheckboxRow(document.getElementById('birth-row'), 'b', b);
            buildCheckboxRow(document.getElementById('survival-row'), 's', s);
        } else {
            buildCheckboxRow(document.getElementById('gen-birth-row'), 'gb', b);
            buildCheckboxRow(document.getElementById('gen-survival-row'), 'gs', s);
        }
        sim.randomize_with_seed(0.3, Math.floor(Math.random() * 0xFFFFFFFF));
        persistDesktopRuleState();
        needsUpload = true;
        needsRender = true;
        statsDirty = true;
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Mouse / Keyboard interaction
// ═══════════════════════════════════════════════════════════════════════

function setupInput() {
    let lastPaintTime = 0;

    canvas.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (e.button === 0) {
            disableAmbientMode();
            isLeftDown = true;
            paintAt(e.clientX, e.clientY, false);
        } else if (e.button === 2) {
            disableAmbientMode();
            isRightDown = true;
            paintAt(e.clientX, e.clientY, true);
        } else if (e.button === 1) {
            disableAmbientMode();
            isMiddleDown = true;
        }
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });

    canvas.addEventListener('mousemove', (e) => {
        const now = performance.now();

        if (isMiddleDown) {
            // Pan
            const displayWidth = canvas.clientWidth || window.innerWidth;
            const displayHeight = canvas.clientHeight || window.innerHeight;
            const dx = (e.clientX - lastMouseX) / displayWidth * 2 / zoom;
            const dy = -(e.clientY - lastMouseY) / displayHeight * 2 / zoom;
            viewX -= dx;
            viewY -= dy;
            needsRender = true;
        } else if (isLeftDown && now - lastPaintTime > 16) {
            paintAt(e.clientX, e.clientY, false);
            lastPaintTime = now;
        } else if (isRightDown && now - lastPaintTime > 16) {
            paintAt(e.clientX, e.clientY, true);
            lastPaintTime = now;
        }

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 0) isLeftDown = false;
        if (e.button === 2) isRightDown = false;
        if (e.button === 1) isMiddleDown = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('touchstart', (e) => {
        if (!mobileUI) return;
        e.preventDefault();
        closeMobileSheets();
        disableAmbientMode();

        if (e.touches.length === 1) {
            touchMode = 'paint';
            const touch = e.touches[0];
            paintAt(touch.clientX, touch.clientY, mobileEraseMode);
            lastPaintTime = performance.now();
        } else if (e.touches.length >= 2) {
            touchMode = 'gesture';
            const [t1, t2] = e.touches;
            touchPrevDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            touchPrevCenterX = (t1.clientX + t2.clientX) * 0.5;
            touchPrevCenterY = (t1.clientY + t2.clientY) * 0.5;
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (!mobileUI) return;
        e.preventDefault();

        if (e.touches.length === 1 && touchMode === 'paint') {
            const now = performance.now();
            const touch = e.touches[0];
            if (now - lastPaintTime > 16) {
                paintAt(touch.clientX, touch.clientY, mobileEraseMode);
                lastPaintTime = now;
            }
        } else if (e.touches.length >= 2) {
            touchMode = 'gesture';
            const [t1, t2] = e.touches;
            const centerX = (t1.clientX + t2.clientX) * 0.5;
            const centerY = (t1.clientY + t2.clientY) * 0.5;
            const distance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            const dx = centerX - touchPrevCenterX;
            const dy = centerY - touchPrevCenterY;
            const displayWidth = canvas.clientWidth || window.innerWidth;
            const displayHeight = canvas.clientHeight || window.innerHeight;
            viewX -= dx / displayWidth * 2 / zoom;
            viewY += dy / displayHeight * 2 / zoom;
            if (touchPrevDistance > 0) {
                setZoom(zoom * (distance / touchPrevDistance));
            }
            touchPrevDistance = distance;
            touchPrevCenterX = centerX;
            touchPrevCenterY = centerY;
            needsRender = true;
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        if (!mobileUI) return;
        e.preventDefault();
        if (e.touches.length === 0) {
            touchMode = 'none';
            touchPrevDistance = 0;
        } else if (e.touches.length === 1) {
            touchMode = 'paint';
        } else {
            const [t1, t2] = e.touches;
            touchMode = 'gesture';
            touchPrevDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            touchPrevCenterX = (t1.clientX + t2.clientX) * 0.5;
            touchPrevCenterY = (t1.clientY + t2.clientY) * 0.5;
        }
    }, { passive: false });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        disableAmbientMode();
        const zoomSpeed = 1.1;
        if (e.deltaY < 0) {
            zoomBy(zoomSpeed);
        } else {
            zoomBy(1 / zoomSpeed);
        }
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            setAboutOpen(false);
        } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            if (!presentationMode) {
                setAboutOpen(true);
            }
        } else if (e.code === 'Space' && !e.repeat) {
            e.preventDefault();
            disableAmbientMode();
            playing = !playing;
            updatePlaybackUI();
            needsRender = true;
        } else if (e.key === 'a' || e.key === 'A') {
            if (!aboutOpen) {
                e.preventDefault();
                setAmbientMode(!ambientMode);
            }
        } else if (e.key === 'd' || e.key === 'D') {
            if (!aboutOpen) {
                disableAmbientMode();
                cycleTheme();
            }
        } else if (e.key === 'r' || e.key === 'R') {
            if (!aboutOpen) {
                e.preventDefault();
                disableAmbientMode();
                toggleSimulationResolution();
            }
        } else if ((e.key === '+' || e.key === '=') && !aboutOpen) {
            e.preventDefault();
            disableAmbientMode();
            zoomBy(1.2);
        } else if ((e.key === '-' || e.key === '_') && !aboutOpen) {
            e.preventDefault();
            disableAmbientMode();
            zoomBy(1 / 1.2);
        } else if (e.key === '0' && !aboutOpen) {
            e.preventDefault();
            disableAmbientMode();
            setZoom(1);
        } else if (e.key === 'f' || e.key === 'F') {
            if (!aboutOpen) {
                if (ambientMode) {
                    disableAmbientMode();
                    return;
                }
                setPresentationMode(!presentationMode);
            }
        }
    });

    window.addEventListener('resize', () => {
        setMobileUI(window.innerWidth <= 760);
        detectAutoTargetResolution();
        if (resolutionMode === 'auto' && simResolution !== autoTargetResolution) {
            applySimulationResolution(autoTargetResolution, true);
        }
    });
}

// ═══════════════════════════════════════════════════════════════════════
// Stats
// ═══════════════════════════════════════════════════════════════════════

function updateStats() {
    document.getElementById('stat-pop').textContent = sim.get_population().toLocaleString();
    document.getElementById('stat-gen').textContent = Number(sim.get_generation()).toLocaleString();
}

// ═══════════════════════════════════════════════════════════════════════
// Game Loop
// ═══════════════════════════════════════════════════════════════════════

function gameLoop(timestamp) {
    // FPS tracking
    const dt = timestamp - lastFrameTime;
    lastFrameTime = timestamp;
    const previous = fpsSamples[fpsIndex];
    fpsSamples[fpsIndex] = dt;
    fpsSum += dt - previous;
    fpsIndex = (fpsIndex + 1) % fpsSamples.length;

    const avgDt = fpsSum / fpsSamples.length;
    const avgFps = 1000 / avgDt;
    if (fpsIndex % 10 === 0) {
        document.getElementById('stat-fps').textContent = Math.round(avgFps);
    }

    const desktopHidden =
        isDesktopRuntime() &&
        wallpaperSessionActive &&
        !desktopViewportActive;
    if (desktopHidden) {
        tickAccumulator = 0;
        loopSuspended = true;
        return;
    }
    loopSuspended = false;

    applyAdaptiveResolution(dt, avgFps);

    if (ambientMode && timestamp >= ambientNextMotionAt) {
        const ambientT = (timestamp - ambientStartTime) * 0.0001;
        const nextX = Math.sin(ambientT * 0.9) * 0.18;
        const nextY = Math.cos(ambientT * 0.7) * 0.14;
        if (Math.abs(nextX - viewX) > 0.0001 || Math.abs(nextY - viewY) > 0.0001) {
            viewX = nextX;
            viewY = nextY;
            needsRender = true;
        }
        setZoom(1.35 + Math.sin(ambientT * 0.45) * 0.16, false);
        ambientNextMotionAt = timestamp + AMBIENT_MOTION_INTERVAL_MS;
    }

    if (ambientMode && timestamp >= ambientNextHealthCheckAt) {
        const pop = sim.get_population();
        if ((timestamp - ambientLastReseedAt > 28000) && (pop < 250 || pop > 720000)) {
            applyAmbientScene();
            ambientLastReseedAt = timestamp;
        }
        ambientNextHealthCheckAt = timestamp + AMBIENT_HEALTH_INTERVAL_MS;
    }

    // Simulation ticks
    if (playing) {
        // How many ticks this frame based on desired speed
        tickAccumulator += effectiveTickRate() * (dt / 1000);
        // Cap ticks per frame to avoid long catch-up bursts after tab stalls.
        const maxTicks = 5;
        const ticksThisFrame = Math.min(Math.floor(tickAccumulator), maxTicks);
        tickAccumulator -= ticksThisFrame;

        if (ticksThisFrame > 0) {
            sim.tick_no_render(ticksThisFrame);
            needsUpload = true;
            needsRender = true;
            statsDirty = true;
        }
    }

    // Only upload + render when something changed
    if (needsUpload) {
        uploadPixels();
        needsUpload = false;
        needsRender = true;
    }
    if (needsRender) {
        render();
        needsRender = false;
    }

    // Update stats every 10 frames, only when simulation state changed.
    if (statsDirty && fpsIndex % 10 === 0) {
        updateStats();
        statsDirty = false;
    }

    const activeInput = isLeftDown || isRightDown || isMiddleDown || touchMode !== 'none';
    const canIdle =
        !playing &&
        !ambientMode &&
        !needsUpload &&
        !needsRender &&
        !statsDirty &&
        !activeInput;
    scheduleNextFrame(canIdle ? IDLE_FRAME_DELAY_MS : 0);
}

// ═══════════════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════════════

async function main() {
    desktopHost.setup();
    wasmExports = await init({ module_or_path: new URL('./pkg/forma_bg.wasm?v=theme2', import.meta.url) });
    wasmMemory = wasmExports;

    sim = new Simulation();
    syncGridDimensions();

    const savedMode = safeReadStorage(RES_STORAGE_MODE_KEY);
    const savedValue = Number(safeReadStorage(RES_STORAGE_VALUE_KEY) || 0);
    detectAutoTargetResolution();
    if (savedMode === 'manual' && Number.isFinite(savedValue) && savedValue > 0) {
        resolutionMode = 'manual';
        sim.set_grid_size(clampToTier(savedValue), clampToTier(savedValue));
        syncGridDimensions();
    } else {
        resolutionMode = 'auto';
        sim.set_grid_size(autoTargetResolution, autoTargetResolution);
        syncGridDimensions();
    }

    if (!initWebGL()) return;
    applyTheme(isDesktopRuntime() ? 3 : 0, false, false);
    updateResolutionUI();
    updateZoomUI();

    const desktopRulesLoaded = applyDesktopRuleState(loadDesktopRuleState());
    if (!desktopRulesLoaded) {
        if (isDesktopRuntime()) {
            updateModeUI(1);
            applyGenPreset('brians');
        } else {
            updateModeUI(0);
            applyConwayPreset('life');
        }
    }
    applyBatteryResolutionPolicy();
    refreshPerformanceOverrides();

    // Startup pattern: desktop starts clean; web keeps its default seeded field.
    sim.clear();
    if (!isDesktopRuntime()) {
        sim.randomize_with_seed(0.11, 42);
    }
    needsUpload = true;
    needsRender = true;
    statsDirty = true;

    // Initial render
    uploadPixels();
    render();

    // Wire UI and input
    wireUI();
    setupInput();
    setMobileUI(window.innerWidth <= 760);
    updatePlaybackUI();
    updateWallpaperToggleUI();
    updateMobileEraseUI();
    if (desktopPendingConfig) {
        applyDesktopConfig(desktopPendingConfig);
        desktopPendingConfig = null;
    }

    // Start loop
    playing = true;
    updatePlaybackUI();
    lastFrameTime = performance.now();
    scheduleNextFrame(0);
}

main().catch(console.error);
