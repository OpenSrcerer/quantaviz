/* main.js — Quanta app shell: scene registry, settings, UI, render loop.
 *
 * THE BAND RULE (every scene follows it, and post.js applies it globally):
 *   bass  (32–150 Hz)    -> motion, shake, force: kicks, squeezes, ripples, field strength, the
 *                           horizon breathing. Beats (`audio.beat`, `audio.beatPulse`, `onset`)
 *                           are bass onsets.
 *   mid   (150–2200 Hz)  -> light and body: brightness, size and colour energy of the main
 *                           bodies (quarks, stars, tracks, wave packets, the disk).
 *   high  (2200–16 kHz)  -> sparkle and detail: twinkle, jitter, fine particles, ink shimmer.
 * Scenes read them as audio.bass / mid / high, the sharp onsets audio.beatPulse / midPulse /
 * highPulse, and per-band spectra via bandLow(x) / bandMid(x) / bandHigh(x) (GLSL) or
 * audio.bandLow(x) / bandMid(x) / bandHigh(x) (JS), x in 0..1 inside that band.
 *
 * SCENE CONTRACT (see js/scenes/horizon.js for a minimal example)
 * ----------------------------------------------------------------
 * VIZ.registerScene({
 *   id: 'horizon',            // unique, used in settings + URL (?scene=horizon)
 *   name: 'Event Horizon',    // shown in the HUD
 *   blurb: 'One line shown under the name for a few seconds',
 *   params: [                 // optional user-tweakable sliders (panel "Scene parameters")
 *     { key: 'lensing', label: 'Lensing', min: 0, max: 2, step: 0.01, value: 1 },
 *   ],
 *   create(ctx) { return new MyScene(ctx); },
 * });
 *
 * A scene instance implements:
 *   resize(w, h)                   target size in device pixels (called before first render)
 *   render(target, audio, u)       draw linear HDR colour into `target` (a VIZ.RenderTarget,
 *                                  already bound + cleared to black; depth buffer available).
 *                                  Scenes with their own FBOs must call target.bind() before
 *                                  drawing their final pass. Any GL state may be changed; the
 *                                  app resets depth/blend/cull after the call.
 *   dispose()
 *
 * `ctx`   : from VIZ.initGL — { gl, caps, drawQuad(), fsProgram(fs,label), program(vs,fs,opts),
 *           createTarget(w,h,opts), createTexture(opts), setCommon(prog, audio, u) }
 * `audio` : VIZ.AudioEngine — bands[128] (0..1 smoothed), bandsRaw, peaks, wave[512] (-1..1),
 *           bass, mid, high, level (0..1), beat (bass envelope), beatPulse / midPulse / highPulse
 *           (sharp 0..1), onset / midOnset / highOnset (true on the detection frame), beatCount,
 *           bpm, recentBeats[8] (bass beat times), bandAt(t), bandLow/bandMid/bandHigh(x)
 * `u`     : { time, dt, width, height, intensity, palette (Float32Array 12 = 4 linear RGB colours,
 *           [0]=dark, [1..3]=accents), bandTex, waveTex, params ({key:value} of this scene's
 *           params), motion {dx,dy,vx,vy} (window movement, CSS px and px/s),
 *           pointer {x,y,down} (0..1, y up), aspect }
 * Shader programs may include VIZ.glsl.common and use ctx.setCommon(prog, audio, u) to fill
 * uTime/uRes/uBass/uMid/uHigh/uLevel/uBeat/uPulse/uMidPulse/uHighPulse/uIntensity/uCol[4]/uBands/uWave.
 */
(function () {
  'use strict';
  const VIZ = (window.VIZ = window.VIZ || {});
  VIZ.scenes = VIZ.scenes || [];
  VIZ.registerScene = function (def) {
    if (!def || !def.id || typeof def.create !== 'function') { console.error('[quanta] bad scene definition', def); return; }
    if (VIZ.scenes.some((s) => s.id === def.id)) { console.warn('[quanta] duplicate scene id', def.id); return; }
    VIZ.scenes.push(def);
  };
  /** One event per kick, fired at the peak of the kick envelope (the Bubble Chamber's rule).
   *  `update(audio.kick)` returns that peak (0..1) on the frame a significant kick tops out, else 0. */
  VIZ.KickTrigger = class KickTrigger {
    constructor(min = 0.35) { this.min = min; this.prev = 0; this.max = 0; this.fired = false; this.rise = false; }
    update(k) {
      let out = 0;
      if (k > this.prev + 1e-3) { this.rise = true; if (k > this.max) this.max = k; }
      if (this.rise && !this.fired && this.max > this.min && k < this.max * 0.97) { out = this.max; this.fired = true; }
      // Re-arm once the envelope has fallen to half its peak; the next rise starts a fresh peak.
      if (k < this.max * 0.5) { this.max = 0; this.fired = false; this.rise = false; }
      this.prev = k;
      return out;
    }
  };

  const PALETTES = [
    { name: 'Aurora', colors: ['#0a1430', '#1de9b6', '#7c4dff', '#ff4fd8'] },
    { name: 'Solar', colors: ['#2a0a00', '#ff5a1f', '#ffc53d', '#fff2c7'] },
    { name: 'Glacier', colors: ['#061a33', '#2f7bff', '#7df3ff', '#f4fbff'] },
    { name: 'Candy', colors: ['#2b0b3a', '#ff4ecd', '#ffe14f', '#4ff0ff'] },
    { name: 'Quark', colors: ['#120c2a', '#ff3b5c', '#3bff7a', '#4f8dff'] },
    { name: 'Ember', colors: ['#160606', '#ff2d55', '#ff9f1c', '#ffe9a8'] },
    { name: 'Nebula', colors: ['#0d0620', '#6a00f4', '#ff2bd6', '#ffd6f5'] },
    { name: 'Reef', colors: ['#031a1a', '#00c9a7', '#00e0ff', '#c7ff9a'] },
    { name: 'Plasma', colors: ['#1a0230', '#ff007f', '#ff8c00', '#ffff5c'] },
    { name: 'Toxic', colors: ['#0a1a02', '#7dff00', '#00ffb3', '#eaffd0'] },
    { name: 'Sakura', colors: ['#2a0f1f', '#ff7eb6', '#ffc1e3', '#fff5fb'] },
    { name: 'Deep Sea', colors: ['#020c1c', '#0052cc', '#00b4ff', '#9ff0ff'] },
    { name: 'Retro', colors: ['#1b1030', '#ff5e5b', '#ffed66', '#00cecb'] },
    { name: 'Mono', colors: ['#0a0a0c', '#5a5f6e', '#c4c9d6', '#ffffff'] },
  ];

  const EFFECTS = [
    { key: 'mirror', label: 'Mirror', min: 0, max: 3, step: 1, fmt: (v) => ['off', 'horizontal', 'vertical', 'quad'][v | 0] },
    { key: 'kaleido', label: 'Kaleidoscope', min: 0, max: 12, step: 1, fmt: (v) => (v < 3 ? 'off' : (v | 0) + ' segments') },
    { key: 'fractal', label: 'Fractal tiling', min: 0, max: 1, step: 0.01 },
    { key: 'bulge', label: 'Space bend (pinch ↔ bulge)', min: -1, max: 1, step: 0.01 },
    { key: 'trails', label: 'Echo trails', min: 0, max: 1, step: 0.01 },
    { key: 'rotate', label: 'Rotation', min: -60, max: 60, step: 1, fmt: (v) => (Math.round(v) ? Math.round(v) + '°/s' : 'off') },
    { key: 'posterize', label: 'Cel shading & ink', min: 0, max: 1, step: 0.01 },
    { key: 'halftone', label: 'Halftone print', min: 0, max: 1, step: 0.01 },
    { key: 'scanlines', label: 'Scanlines', min: 0, max: 1, step: 0.01 },
    { key: 'aberration', label: 'Chromatic aberration', min: 0, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
    { key: 'invert', label: 'Negative flash on kicks', min: 0, max: 1, step: 0.01 },
    { key: 'hueDrift', label: 'Palette cycling', min: 0, max: 90, step: 1, fmt: (v) => (v ? Math.round(v) + '°/s' : 'off') },
  ];
  // Random effect recipes: [key, amount generator, weight].
  const FX_RECIPES = [
    ['mirror', () => 1 + Math.floor(Math.random() * 3), 1.0],
    ['kaleido', () => [3, 4, 5, 6, 8][Math.floor(Math.random() * 5)], 1.0],
    ['fractal', () => 0.3 + Math.random() * 0.5, 0.8],
    ['bulge', () => (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.45), 0.8],
    ['trails', () => 0.3 + Math.random() * 0.6, 1.0],
    ['rotate', () => (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 25), 0.7],
    ['posterize', () => 0.4 + Math.random() * 0.5, 0.9],
    ['halftone', () => 0.3 + Math.random() * 0.4, 0.5],
    ['scanlines', () => 0.3 + Math.random() * 0.4, 0.4],
    ['invert', () => 0.5 + Math.random() * 0.5, 0.5],
    ['hueDrift', () => 8 + Math.random() * 35, 0.8],
  ];

  const DEFAULTS = {
    scene: 'quarks',
    palette: 0,
    customPalette: null,
    sensitivity: 1.0,
    intensity: 1.0,
    bloom: 1.0,
    grain: 1.0,
    quality: 1.0,
    autoQuality: true,
    autoCycle: false,
    cycleSecs: 45,
    autoFx: false,
    fxSecs: 30,
    volume: 0.6,
    drive: { bass: 1, mid: 1, high: 1 },
    kickRelease: 0.18,
    kickThreshold: 0.35,
    kickGate: -46,
    bandFx: { shake: 1, glow: 1, sparkle: 1 },
    effects: Object.assign({}, VIZ.EFFECT_DEFAULTS),
    sceneParams: {},
  };
  const STORAGE_KEY = 'quanta.settings.v2';
  // Firefox implements screen sharing but never returns its audio, so desktop capture can't work there.
  const IS_FIREFOX = /firefox|fxios/i.test(navigator.userAgent);
  const FIREFOX_AUDIO = "Firefox can't capture system audio. Use Chrome or Edge, or pick Microphone and choose Stereo Mix.";
  const TAGLINES = [
    'Feed it sound. It does physics.',
    'Sound in, physics out.',
    'A bench full of experiments that listen.',
    'Twenty-three experiments, one audio cable.',
    'Turn it up. The equations like it loud.',
  ];
  const TIPS = [
    'Space skips to the next experiment; the arrow keys go both ways.',
    'Press E a few times. Some effect combinations are ugly. Some are great.',
    'R invents a new palette. There is no undo, so screenshot the good ones.',
    'In Ferrofluid you can drag the magnet around under the plate.',
    'Hold the mouse on the plasma globe and the filaments come to you.',
    'Quiet music firing phantom kicks? Raise the kick level gate in Setup.',
    'Adaptive quality lowers the resolution before it ever drops frames.',
    'H hides the panels and F goes fullscreen. Together: a decent screensaver.',
    'Every experiment has its own knobs under Setup, at the bottom.',
    'In Double Slit every kick is a measurement. Watch the fringes collapse.',
    'The bpm readout is a guess from the kicks. Usually right. Usually.',
    'Nothing you play here leaves your computer. There is no server to send it to.',
  ];
  const GENERAL_SLIDERS = {
    generalAudio: [
      { key: 'sensitivity', label: 'Sensitivity', min: 0.3, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'volume', label: 'Playback volume (file / demo)', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
    ],
    generalBands: [
      { key: 'drive.bass', label: 'Bass → motion & shake', min: 0, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'drive.mid', label: 'Mids → light & body', min: 0, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'drive.high', label: 'Highs → sparkle & detail', min: 0, max: 2.5, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'kickThreshold', label: 'Kick threshold (% of a typical kick)', min: 0, max: 0.9, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'kickGate', label: 'Kick level gate (min bass loudness)', min: -80, max: -25, step: 1, fmt: (v) => Math.round(v) + ' dB' },
      { key: 'kickRelease', label: 'Kick decay (how long a hit shows)', min: 0.06, max: 0.6, step: 0.01, fmt: (v) => Math.round(v * 1000) + ' ms' },
      { key: 'bandFx.shake', label: 'Screen shake on kicks', min: 0, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'bandFx.glow', label: 'Glow follows mids', min: 0, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'bandFx.sparkle', label: 'Fringe & grain follow highs', min: 0, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
    ],
    generalLook: [
      { key: 'intensity', label: 'Intensity', min: 0, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'bloom', label: 'Bloom', min: 0, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'grain', label: 'Film grain', min: 0, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'quality', label: 'Render scale', min: 0.4, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
    ],
    generalCycle: [
      { key: 'cycleSecs', label: 'Switch every', min: 10, max: 180, step: 5, fmt: (v) => v + ' s' },
    ],
    generalFx: [
      { key: 'fxSecs', label: 'Reshuffle every', min: 5, max: 120, step: 5, fmt: (v) => v + ' s' },
    ],
  };

  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const setPath = (obj, path, value) => {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) { if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {}; o = o[keys[i]]; }
    o[keys[keys.length - 1]] = value;
  };

  function hexToLinear(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2));
  }
  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  }
  /** A harmonious random palette: dark base + three accents from a colour scheme. */
  function randomPalette() {
    const h = Math.random() * 360;
    const schemes = [[0, 30, 60], [0, 120, 240], [0, 150, 210], [0, 40, 180], [0, 90, 180], [0, 60, 300]];
    const sch = schemes[Math.floor(Math.random() * schemes.length)].slice().sort(() => Math.random() - 0.5);
    const accents = sch.map((d, i) => hslToHex(h + d + (Math.random() - 0.5) * 12, 0.78 + Math.random() * 0.22, 0.5 + i * 0.1 + Math.random() * 0.08));
    const dark = hslToHex(h + 180 + (Math.random() - 0.5) * 80, 0.45 + Math.random() * 0.3, 0.06 + Math.random() * 0.04);
    return [dark, accents[0], accents[1], accents[2]];
  }
  /** Rotate the hue of 4 linear RGB colours (SVG feColorMatrix hueRotate). */
  function hueRotate(out, inp, deg) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const m = [
      0.213 + 0.787 * c - 0.213 * s, 0.715 - 0.715 * c - 0.715 * s, 0.072 - 0.072 * c + 0.928 * s,
      0.213 - 0.213 * c + 0.143 * s, 0.715 + 0.285 * c + 0.140 * s, 0.072 - 0.072 * c - 0.283 * s,
      0.213 - 0.213 * c - 0.787 * s, 0.715 - 0.715 * c + 0.715 * s, 0.072 + 0.928 * c + 0.072 * s,
    ];
    for (let i = 0; i < 4; i++) {
      const r = inp[i * 3], g = inp[i * 3 + 1], b = inp[i * 3 + 2];
      out[i * 3] = Math.max(0, m[0] * r + m[1] * g + m[2] * b);
      out[i * 3 + 1] = Math.max(0, m[3] * r + m[4] * g + m[5] * b);
      out[i * 3 + 2] = Math.max(0, m[6] * r + m[7] * g + m[8] * b);
    }
  }

  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (e) { s = {}; }
    const out = Object.assign({}, DEFAULTS, s);
    out.drive = Object.assign({}, DEFAULTS.drive, s.drive || {});
    out.bandFx = Object.assign({}, DEFAULTS.bandFx, s.bandFx || {});
    out.effects = Object.assign({}, DEFAULTS.effects, s.effects || {});
    out.sceneParams = Object.assign({}, s.sceneParams || {});
    return out;
  }

  class App {
    constructor() {
      this.canvas = $('#c');
      this.ctx = VIZ.initGL(this.canvas);
      if (!this.ctx) {
        this.fatal('WebGL2 is not available in this browser. Please use a recent Edge or Chrome.');
        return;
      }
      const gl = (this.gl = this.ctx.gl);
      this.audio = new VIZ.AudioEngine();
      this.settings = loadSettings();
      this.post = new VIZ.Post(this.ctx);
      this.hdr = this.ctx.createTarget(2, 2, { hdr: true, depth: true });
      const { NUM_BANDS, WAVE_LEN } = VIZ.AUDIO;
      this.bandTex = this.ctx.createTexture({ width: NUM_BANDS, height: 1, internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR });
      this.waveTex = this.ctx.createTexture({ width: WAVE_LEN, height: 1, internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR, wrap: gl.REPEAT });
      this.palette = new Float32Array(12);
      this.paletteBase = new Float32Array(12);
      this.paletteTarget = new Float32Array(12);
      this.hueOffset = 0;
      this.paletteTau = 0.35;
      // Live effect values ease toward the settings; discrete modes cross-fade through a mix.
      this.fx = Object.assign({}, VIZ.EFFECT_DEFAULTS, { mirrorMode: 0, mirrorMix: 0, kaleidoN: 0, kaleidoMix: 0 });
      this.fxTau = 1.2;

      this.scene = null;
      this.sceneDef = null;
      this.brokenAt = new Map();   // scene id -> time it last failed; retried after a minute
      this.broken = { has: (id) => this.isBroken(id), add: (id) => this.brokenAt.set(id, performance.now() / 1000), [Symbol.iterator]: function* () { } };
      this.fade = 0;          // 0 = visible, 1 = black
      this.fadeDir = 0;
      this.pendingScene = null;
      this.cycleTimer = 0;
      this.fxTimer = 0;
      this.blurbTimer = 0;

      this.time = 0;
      this.last = 0;
      this.frameAvg = 16.7;
      this.refreshMs = 16.7;
      this.refreshHz = 60;
      this.frameCount = 0;
      this.autoScale = 0.35;
      this.qualityTimer = 0;
      this.qualityCooldown = 0;
      this.fpsAcc = 0; this.fpsFrames = 0;

      this.motion = { x: window.screenX, y: window.screenY, dx: 0, dy: 0, vx: 0, vy: 0, init: false };
      this.pointer = { x: 0.5, y: 0.5, down: false };
      this.uiIdle = 0;
      this.uiHidden = false;
      this.uiForceHidden = false;
      this.started = false;
      this.silentHintShown = false;
      this.toastTimer = null;

      this.buildUI();
      this.applySettings();
      this.resize();

      const params = new URLSearchParams(location.search);
      const initial = params.get('scene') || this.settings.scene;
      this.selectScene(initial, true);
      if (params.has('mute')) this.setSetting('volume', 0);

      window.addEventListener('resize', () => this.resize());
      // A lost GPU context (driver reset, sleep, display change) leaves WebGL dead: restart cleanly.
      this.canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.contextLost = true;
        this.toast('Graphics context was lost. Restarting Quanta…', 'error', 4000);
        setTimeout(() => location.reload(), 1500);
      });
      document.addEventListener('visibilitychange', () => {
        this.last = 0;
        // Coming back from a throttled background spell: start at full quality again.
        if (!document.hidden) { this.autoScale = 1; this.qualityCooldown = 2; this.frameAvg = this.refreshMs; }
      });
      requestAnimationFrame((t) => this.frame(t));
    }

    fatal(msg) {
      const hero = $('#hero');
      hero.innerHTML = `<div class="window hero-win"><div class="titlebar"><span>Quanta Lab</span></div><div class="win-body"><p class="err-head">The instrument could not start.</p><p class="hint">${msg}</p></div><div class="statusbar"><span>Halted</span></div></div>`;
    }

    /* ---------------- settings ---------------- */
    saveSettings() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch (e) { /* ignore */ }
    }
    setSetting(key, value) {
      setPath(this.settings, key, value);
      if (key.startsWith('effects.')) this.fxTau = 0.15;   // slider drags feel direct
      if (key === 'palette') this.paletteTau = 0.35;
      this.applySettings();
      this.saveSettings();
      this.syncControls();
    }
    paletteColors() {
      const s = this.settings;
      if (s.palette === -1 && s.customPalette && s.customPalette.length === 4) return s.customPalette;
      return PALETTES[clamp(s.palette | 0, 0, PALETTES.length - 1)].colors;
    }
    applySettings() {
      const s = this.settings;
      this.audio.sensitivity = s.sensitivity;
      this.audio.setMonitorVolume(s.volume);
      Object.assign(this.audio.drive, s.drive);
      this.audio.hitRelease = s.kickRelease || 0.18;
      this.audio.hitThreshold = s.kickThreshold === undefined ? 0.35 : s.kickThreshold;
      this.audio.kickGateDb = s.kickGate === undefined ? -46 : s.kickGate;
      Object.assign(this.post.bands, s.bandFx);
      const colors = this.paletteColors();
      colors.forEach((hex, i) => this.paletteBase.set(hexToLinear(hex), i * 3));
      document.documentElement.style.setProperty('--accent', colors[2]);
      document.documentElement.style.setProperty('--accent2', colors[1]);
    }
    sceneParamValues(def) {
      const out = {};
      if (!def || !def.params) return out;
      const saved = this.settings.sceneParams[def.id] || {};
      for (const p of def.params) out[p.key] = saved[p.key] !== undefined ? saved[p.key] : p.value;
      return out;
    }

    /* ---------------- effects & palettes ---------------- */
    /** Ease the live effect values toward the settings so changes glide instead of snapping. */
    updateEffects(dt) {
      const t = this.settings.effects, f = this.fx;
      const k = 1 - Math.exp(-dt / Math.max(0.05, this.fxTau));
      for (const key of ['fractal', 'bulge', 'trails', 'rotate', 'posterize', 'halftone', 'scanlines', 'aberration', 'invert', 'hueDrift']) {
        f[key] += ((t[key] || 0) - f[key]) * k;
        if (Math.abs(f[key] - (t[key] || 0)) < 1e-3) f[key] = t[key] || 0;
      }
      // Discrete modes: fade the current one out, switch, fade the new one in.
      const wantMirror = t.mirror | 0;
      if (f.mirrorMode !== wantMirror) {
        f.mirrorMix += (0 - f.mirrorMix) * k;
        if (f.mirrorMix < 0.02) { f.mirrorMix = 0; f.mirrorMode = wantMirror; }
      } else {
        f.mirrorMix += ((wantMirror ? 1 : 0) - f.mirrorMix) * k;
      }
      const wantN = t.kaleido >= 3 ? Math.round(t.kaleido) : 0;
      if (f.kaleidoN !== wantN) {
        f.kaleidoMix += (0 - f.kaleidoMix) * k;
        if (f.kaleidoMix < 0.02) { f.kaleidoMix = 0; f.kaleidoN = wantN; }
      } else {
        f.kaleidoMix += ((wantN ? 1 : 0) - f.kaleidoMix) * k;
      }
      // Rotation accumulates an angle from the eased speed; when the effect is off, unwind back to upright.
      if (Math.abs(f.rotate) > 0.05) this.rotAngle = ((this.rotAngle || 0) + f.rotate * dt * Math.PI / 180) % (Math.PI * 2);
      else if (this.rotAngle) {
        let a = this.rotAngle; if (a > Math.PI) a -= Math.PI * 2;
        a += (0 - a) * (1 - Math.exp(-dt / 1.2));
        this.rotAngle = Math.abs(a) < 0.001 ? 0 : a;
      }
      const e = this.post.effects;
      e.rotAngle = this.rotAngle || 0;
      e.mirror = f.mirrorMode; e.mirrorMix = f.mirrorMix;
      e.kaleido = f.kaleidoN; e.kaleidoMix = f.kaleidoMix;
      e.fractal = f.fractal; e.bulge = f.bulge; e.trails = f.trails; e.posterize = f.posterize;
      e.halftone = f.halftone; e.scanlines = f.scanlines; e.aberration = f.aberration; e.invert = f.invert;
    }
    randomizeEffects(silent) {
      const e = Object.assign({}, VIZ.EFFECT_DEFAULTS);
      const pool = FX_RECIPES.slice();
      const n = 1 + Math.floor(Math.random() * 2) + (Math.random() < 0.3 ? 1 : 0);
      const picked = [];
      for (let i = 0; i < n && pool.length; i++) {
        const total = pool.reduce((s, r) => s + r[2], 0);
        let r = Math.random() * total, idx = 0;
        while (idx < pool.length - 1 && (r -= pool[idx][2]) > 0) idx++;
        const [key, gen] = pool.splice(idx, 1)[0];
        e[key] = gen();
        picked.push(EFFECTS.find((d) => d.key === key).label.split(' (')[0]);
      }
      e.aberration = 0.5 + Math.random() * 1.5;
      this.settings.effects = e;
      this.fxTau = 1.6;
      this.applySettings(); this.saveSettings(); this.syncControls();
      if (!silent) this.toast('Effects: ' + picked.join(' + '));
    }
    clearEffects() {
      this.settings.effects = Object.assign({}, VIZ.EFFECT_DEFAULTS);
      this.fxTau = 1.2;
      this.applySettings(); this.saveSettings(); this.syncControls();
      this.toast('Effects cleared');
    }
    newRandomPalette() {
      this.settings.customPalette = randomPalette();
      this.settings.palette = -1;
      this.paletteTau = 1.2;
      this.applySettings(); this.saveSettings(); this.syncControls();
      this.renderCustomSwatch();
    }
    renderCustomSwatch() {
      const b = $('#paletteList .swatch[data-index="-1"]');
      if (!b) return;
      b.innerHTML = '';
      const cols = this.settings.customPalette || ['#222', '#555', '#999', '#ddd'];
      cols.forEach((c) => { const sp = document.createElement('span'); sp.style.background = c; b.appendChild(sp); });
      const tag = document.createElement('i'); tag.textContent = '✦'; b.appendChild(tag);
    }

    /* ---------------- UI ---------------- */
    buildUI() {
      const s = this.settings;
      // A different tagline and tip of the day on every visit.
      const pick = (a) => a[Math.floor(Math.random() * a.length)];
      $('#tagline').textContent = pick(TAGLINES);
      let tip = Math.floor(Math.random() * TIPS.length);
      $('#tipText').textContent = TIPS[tip];
      $('#statusCount').textContent = VIZ.scenes.length + ' experiments loaded';
      const sticker = document.querySelector('.sticker');
      if (sticker) sticker.style.transform = `rotate(${(-1 - Math.random() * 3.5).toFixed(1)}deg)`;   // stuck on by hand
      $('#btnTip').addEventListener('click', () => { tip = (tip + 1) % TIPS.length; $('#tipText').textContent = TIPS[tip]; });
      if (IS_FIREFOX) {
        $('#ffNotice').classList.remove('hidden');
        $('#desktopHint').classList.add('hidden');
        const d = $('.src[data-src="desktop"]');
        d.classList.add('unavailable');
        d.querySelector('span:last-child').textContent = 'not available in Firefox';
      }
      document.querySelectorAll('.src').forEach((b) => b.addEventListener('click', () => this.selectSource(b.dataset.src)));
      $('#btnSource').addEventListener('click', () => this.showHero());
      $('#fileInput').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) this.selectSource('file', f);
        e.target.value = '';
      });
      let dragDepth = 0;
      window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#dropHint').classList.remove('hidden'); });
      window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropHint').classList.add('hidden'); });
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('drop', (e) => {
        e.preventDefault(); dragDepth = 0; $('#dropHint').classList.add('hidden');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this.selectSource('file', f);
      });

      $('#btnSettings').addEventListener('click', () => this.togglePanel());
      $('#btnClosePanel').addEventListener('click', () => this.togglePanel(false));
      $('#btnFull').addEventListener('click', () => this.toggleFullscreen());
      $('#btnPrev').addEventListener('click', () => this.stepScene(-1));
      $('#btnNext').addEventListener('click', () => this.stepScene(1));
      $('#btnFxRandom').addEventListener('click', () => this.randomizeEffects());
      $('#btnFxClear').addEventListener('click', () => this.clearEffects());
      $('#btnReset').addEventListener('click', () => {
        const keepScene = this.settings.scene;
        this.settings = loadSettings.call(null);
        this.settings = Object.assign({}, DEFAULTS, { scene: keepScene, sceneParams: {} });
        this.settings.drive = Object.assign({}, DEFAULTS.drive);
        this.settings.bandFx = Object.assign({}, DEFAULTS.bandFx);
        this.settings.effects = Object.assign({}, DEFAULTS.effects);
        this.applySettings(); this.saveSettings(); this.syncControls(); this.buildSceneParams();
        this.toast('Settings reset');
      });

      const list = $('#sceneList');
      list.innerHTML = '';
      VIZ.scenes.forEach((def) => {
        const b = document.createElement('button');
        b.className = 'chip'; b.textContent = def.name; b.dataset.id = def.id;
        b.addEventListener('click', () => this.selectScene(def.id));
        list.appendChild(b);
      });
      const pl = $('#paletteList');
      pl.innerHTML = '';
      PALETTES.forEach((p, i) => {
        const b = document.createElement('button');
        b.className = 'swatch'; b.title = p.name; b.dataset.index = i;
        p.colors.forEach((c) => { const sp = document.createElement('span'); sp.style.background = c; b.appendChild(sp); });
        b.addEventListener('click', () => this.setSetting('palette', i));
        pl.appendChild(b);
      });
      const rb = document.createElement('button');
      rb.className = 'swatch random'; rb.title = 'Random palette (R) — click again for a new one'; rb.dataset.index = -1;
      rb.addEventListener('click', () => this.newRandomPalette());
      pl.appendChild(rb);
      this.renderCustomSwatch();

      this.controls = {};
      for (const containerId of Object.keys(GENERAL_SLIDERS)) {
        const host = document.getElementById(containerId);
        if (!host) continue;
        for (const def of GENERAL_SLIDERS[containerId]) {
          host.appendChild(this.makeSlider(def, getPath(s, def.key), (v) => this.setSetting(def.key, v)));
        }
      }
      const fxHost = $('#effectList');
      for (const def of EFFECTS) {
        fxHost.appendChild(this.makeSlider(
          { key: 'effects.' + def.key, label: def.label, min: def.min, max: def.max, step: def.step, fmt: def.fmt },
          s.effects[def.key],
          (v) => this.setSetting('effects.' + def.key, v)
        ));
      }
      $('#autoCycle').addEventListener('change', (e) => { this.cycleTimer = 0; this.setSetting('autoCycle', e.target.checked); });
      $('#autoFx').addEventListener('change', (e) => { this.fxTimer = 0; this.setSetting('autoFx', e.target.checked); });
      $('#autoQuality').addEventListener('change', (e) => { this.autoScale = 1; this.setSetting('autoQuality', e.target.checked); });

      window.addEventListener('keydown', (e) => this.onKey(e));
      window.addEventListener('pointermove', (e) => {
        this.pointer.x = e.clientX / window.innerWidth;
        this.pointer.y = 1 - e.clientY / window.innerHeight;
        this.wakeUI();
      });
      window.addEventListener('pointerdown', (e) => { if (e.target === this.canvas) this.pointer.down = true; this.wakeUI(); });
      window.addEventListener('pointerup', () => { this.pointer.down = false; });
      window.addEventListener('blur', () => { this.pointer.down = false; });
      this.canvas.addEventListener('dblclick', () => this.toggleFullscreen());

      this.audio.on('source', (info) => this.onSourceChanged(info));
      this.syncControls();
    }

    makeSlider(def, value, onChange) {
      const wrap = document.createElement('div');
      wrap.className = 'slider';
      const label = document.createElement('label'); label.textContent = def.label;
      const out = document.createElement('output');
      const input = document.createElement('input');
      input.type = 'range'; input.min = def.min; input.max = def.max; input.step = def.step; input.value = value;
      const fmt = def.fmt || ((v) => (+v).toFixed(2));
      out.textContent = fmt(+value);
      input.addEventListener('input', () => { out.textContent = fmt(+input.value); onChange(+input.value); });
      wrap.append(label, out, input);
      this.controls[def.key] = { input, out, fmt };
      return wrap;
    }

    syncControls() {
      const s = this.settings;
      for (const key of Object.keys(this.controls || {})) {
        if (key.startsWith('scene.')) continue;
        const c = this.controls[key];
        const v = getPath(s, key);
        if (v !== undefined && +c.input.value !== v) { c.input.value = v; c.out.textContent = c.fmt(v); }
      }
      $('#autoCycle').checked = !!s.autoCycle;
      $('#autoFx').checked = !!s.autoFx;
      $('#autoQuality').checked = !!s.autoQuality;
      document.querySelectorAll('#sceneList .chip').forEach((b) => {
        b.classList.toggle('active', b.dataset.id === s.scene);
        b.classList.toggle('broken', this.broken.has(b.dataset.id));
      });
      document.querySelectorAll('#paletteList .swatch').forEach((b) => b.classList.toggle('active', +b.dataset.index === s.palette));
    }

    buildSceneParams() {
      const host = $('#sceneParamList');
      host.innerHTML = '';
      const def = this.sceneDef;
      if (!def || !def.params || !def.params.length) {
        host.innerHTML = '<div class="empty">This scene has no extra parameters.</div>';
        return;
      }
      const values = this.sceneParamValues(def);
      for (const p of def.params) {
        host.appendChild(this.makeSlider(
          { key: 'scene.' + p.key, label: p.label, min: p.min, max: p.max, step: p.step, fmt: p.fmt },
          values[p.key],
          (v) => {
            const sp = (this.settings.sceneParams[def.id] = this.settings.sceneParams[def.id] || {});
            sp[p.key] = v;
            this.saveSettings();
          }
        ));
      }
    }

    toast(msg, kind = 'info', ms = 3200) {
      const t = $('#toast');
      t.textContent = msg;
      t.className = kind === 'error' ? 'error' : '';
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
    }

    togglePanel(force) {
      const p = $('#panel');
      const show = force === undefined ? p.classList.contains('hidden') : force;
      p.classList.toggle('hidden', !show);
      if (show) this.wakeUI();
    }

    toggleFullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    }

    showHero() { $('#hero').classList.remove('hidden'); this.wakeUI(); }
    hideHero() { $('#hero').classList.add('hidden'); $('#hud').classList.remove('hidden'); this.started = true; this.wakeUI(); }

    wakeUI() {
      this.uiIdle = 0;
      if (this.uiHidden) {
        this.uiHidden = false;
        if (!this.uiForceHidden) $('#hud').classList.remove('hidden');
        document.body.classList.remove('cursor-hidden');
      }
    }

    onKey(e) {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
      const k = e.key;
      if (k === ' ' || k === 'ArrowRight') { e.preventDefault(); this.stepScene(1); }
      else if (k === 'ArrowLeft') { e.preventDefault(); this.stepScene(-1); }
      else if (/^Digit\d$/.test(e.code) && !e.ctrlKey && !e.metaKey) {
        // 1-9, 0 pick scenes 1-10; Shift adds 10, Alt adds 20. e.code, so it works on any layout.
        e.preventDefault();
        const n = (+e.code.slice(5) || 10) + (e.shiftKey ? 10 : 0) + (e.altKey ? 20 : 0);
        const d = VIZ.scenes[n - 1];
        if (d) this.selectScene(d.id);
      }
      else if (k === 'f' || k === 'F') this.toggleFullscreen();
      else if (k === 'h' || k === 'H') { this.uiForceHidden = !this.uiForceHidden; $('#hud').classList.toggle('hidden', this.uiForceHidden); if (this.uiForceHidden) this.togglePanel(false); }
      else if (k === 's' || k === 'S') this.togglePanel();
      else if (k === 'p') this.setSetting('palette', (Math.max(0, this.settings.palette) + 1) % PALETTES.length);
      else if (k === 'P') this.setSetting('palette', (Math.max(0, this.settings.palette) + PALETTES.length - 1) % PALETTES.length);
      else if (k === 'r' || k === 'R') this.newRandomPalette();
      else if (k === 'e' || k === 'E') this.randomizeEffects();
      else if (k === 'c' || k === 'C') this.clearEffects();
      else if (k === 'a' || k === 'A') { this.cycleTimer = 0; this.setSetting('autoCycle', !this.settings.autoCycle); this.toast('Auto-cycle scenes ' + (this.settings.autoCycle ? 'on' : 'off')); }
      else if (k === 'x' || k === 'X') { this.fxTimer = 0; this.setSetting('autoFx', !this.settings.autoFx); this.toast('Auto-shuffle effects ' + (this.settings.autoFx ? 'on' : 'off')); }
      else if (k === 'Escape') { this.togglePanel(false); }
      else if (k === 'm' || k === 'M') { this.setSetting('volume', this.settings.volume > 0 ? 0 : 0.6); }
    }

    /* ---------------- sources ---------------- */
    async selectSource(kind, file) {
      try {
        if (kind === 'desktop' && IS_FIREFOX) { this.toast(FIREFOX_AUDIO, 'error', 7000); return; }
        if (kind === 'desktop') await this.audio.useDesktop();
        else if (kind === 'mic') await this.audio.useMic();
        else if (kind === 'file') { if (!file) { $('#fileInput').click(); return; } await this.audio.useFile(file); }
        else if (kind === 'demo') this.audio.useDemo();
        else return;
        this.hideHero();
        this.silentHintShown = false;
        this.toast('Listening to ' + this.audio.sourceLabel);
      } catch (e) {
        console.warn(e);
        this.toast(e && e.message ? e.message : String(e), 'error', 7000);
      }
    }
    onSourceChanged(info) {
      const pill = $('#sourcePill');
      pill.classList.toggle('live', info.type !== 'none');
      $('#sourceLabel').textContent = info.label;
      if (info.type === 'none' && this.started) this.toast(info.label);
    }

    /* ---------------- scenes ---------------- */
    isBroken(id) {
      const t = this.brokenAt.get(id);
      if (t === undefined) return false;
      if (performance.now() / 1000 - t > 60) { this.brokenAt.delete(id); return false; }
      return true;
    }
    selectScene(id, immediate) {
      const def = VIZ.scenes.find((s) => s.id === id) || VIZ.scenes[0];
      if (!def) { this.toast('No scenes registered', 'error'); return; }
      if (this.sceneDef && this.sceneDef.id === def.id && !immediate) return;
      this.settings.scene = def.id;
      this.saveSettings();
      this.syncControls();
      this.cycleTimer = 0;
      if (immediate || !this.scene) { this.instantiate(def); return; }
      this.pendingScene = def;
      this.fadeDir = 1;
    }
    stepScene(dir) {
      const list = VIZ.scenes.filter((s) => !this.broken.has(s.id));
      if (!list.length) return;
      const i = Math.max(0, list.findIndex((s) => this.sceneDef && s.id === this.sceneDef.id));
      const next = list[(i + dir + list.length) % list.length];
      this.selectScene(next.id);
    }
    instantiate(def) {
      if (this.scene) { try { this.scene.dispose(); } catch (e) { console.warn(e); } this.scene = null; }
      this.sceneDef = def;
      try {
        const s = def.create(this.ctx);
        s.resize(this.hdr.w, this.hdr.h);
        this.scene = s;
      } catch (e) {
        console.error(`[quanta] scene "${def.id}" failed to initialise`, e);
        this.brokenAt.set(def.id, performance.now() / 1000);
        this.toast(`Scene "${def.name}" failed (${e.message}). Skipping it for a minute.`, 'error', 7000);
        this.scene = null;
        if (this.gl.isContextLost()) return;
        const alt = VIZ.scenes.find((s) => !this.isBroken(s.id));
        if (alt) { this.settings.scene = alt.id; return this.instantiate(alt); }
      }
      $('#sceneName').textContent = def.name;
      const si = VIZ.scenes.indexOf(def) + 1;
      $('#sceneIndex').textContent = String(si).padStart(2, '0') + '/' + String(VIZ.scenes.length).padStart(2, '0');
      $('#sceneBlurb').textContent = def.blurb || '';
      this.blurbTimer = 6;
      this.buildSceneParams();
      this.syncControls();
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindVertexArray(null);
    }
    sceneCrashed(e) {
      console.error(`[quanta] scene "${this.sceneDef.id}" crashed while rendering`, e);
      this.brokenAt.set(this.sceneDef.id, performance.now() / 1000);
      this.toast(`Scene "${this.sceneDef.name}" crashed (${e.message}). Skipping it for a minute.`, 'error', 7000);
      try { this.scene.dispose(); } catch (err) { /* ignore */ }
      this.scene = null;
      if (this.gl.isContextLost()) return;
      const alt = VIZ.scenes.find((s) => !this.isBroken(s.id));
      if (alt) this.selectScene(alt.id, true);
    }

    /* ---------------- frame ---------------- */
    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = this.canvas.clientWidth || window.innerWidth;
      const ch = this.canvas.clientHeight || window.innerHeight;
      const scale = this.settings.quality * (this.settings.autoQuality ? this.autoScale : 1);
      const w = Math.max(2, Math.round(cw * dpr * scale));
      const h = Math.max(2, Math.round(ch * dpr * scale));
      if (w === this.canvas.width && h === this.canvas.height) return;
      this.canvas.width = w; this.canvas.height = h;
      this.ctx.width = w; this.ctx.height = h;
      this.hdr.resize(w, h);
      this.post.resize(w, h);
      if (this.scene) { try { this.scene.resize(w, h); } catch (e) { this.sceneCrashed(e); } }
    }

    updateMotion(dt) {
      const m = this.motion;
      const x = window.screenX, y = window.screenY;
      if (m.init) { m.dx = x - m.x; m.dy = y - m.y; } else { m.dx = 0; m.dy = 0; m.init = true; }
      if (Math.abs(m.dx) > 600 || Math.abs(m.dy) > 600) { m.dx = 0; m.dy = 0; }
      m.x = x; m.y = y;
      const a = 1 - Math.exp(-dt / 0.08);
      m.vx += (m.dx / dt - m.vx) * a;
      m.vy += (m.dy / dt - m.vy) * a;
    }

    updateQuality(dt, frameMs) {
      if (this.frameCount < 45) {
        this.frameCount++;
        this.autoScale = 0.35;
        if (this.frameCount > 8 && frameMs > 3) this.refreshMs = Math.min(this.refreshMs, frameMs);
        if (this.frameCount === 45) {
          const hz = 1000 / this.refreshMs;
          const cands = [60, 75, 90, 100, 120, 144, 165, 240];
          let best = 60;
          for (const c of cands) if (Math.abs(c - hz) < Math.abs(best - hz)) best = c;
          this.refreshMs = 1000 / best;
          this.refreshHz = best;
          this.autoScale = 1;
          this.frameAvg = this.refreshMs;
        }
        return;
      }
      this.frameAvg += (frameMs - this.frameAvg) * 0.08;
      // Keep re-checking the refresh rate: a page that started in a hidden tab measured a throttled one.
      // Use the 10th percentile of recent frame intervals, not the minimum, so one jittery frame can't
      // promote the estimate.
      if (!this.frameSamples) this.frameSamples = [];
      if (frameMs > 2) this.frameSamples.push(frameMs);
      this.minFrameTimer = (this.minFrameTimer || 0) + dt;
      if (this.minFrameTimer > 2 && this.frameSamples.length > 30) {
        const sorted = this.frameSamples.slice().sort((a, b) => a - b);
        const p10 = sorted[Math.floor(sorted.length * 0.1)];
        const hz = 1000 / p10;
        if (hz > this.refreshHz * 1.12) {
          const cands = [60, 75, 90, 100, 120, 144, 165, 240];
          let best = this.refreshHz;
          for (const c of cands) if (Math.abs(c - hz) < Math.abs(best - hz)) best = c;
          this.refreshHz = best; this.refreshMs = 1000 / best;
        }
        this.frameSamples.length = 0; this.minFrameTimer = 0;
      }
      if (!this.settings.autoQuality) return;
      this.qualityTimer += dt;
      this.qualityCooldown = Math.max(0, this.qualityCooldown - dt);
      if (this.qualityTimer < 1.0 || this.qualityCooldown > 0) return;
      this.qualityTimer = 0;
      const budget = this.refreshMs;
      if (this.frameAvg > budget * 1.22 + 0.5 && this.autoScale > 0.5) { this.autoScale = Math.max(0.5, this.autoScale - 0.1); this.qualityCooldown = 1.5; }
      else if (this.frameAvg < budget * 1.1 && this.autoScale < 1) { this.autoScale = Math.min(1, this.autoScale + 0.1); this.qualityCooldown = 3; }
    }

    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      const t = now / 1000;
      let dt = this.last ? t - this.last : 1 / 60;
      const frameMs = this.last ? (t - this.last) * 1000 : 16.7;
      this.last = t;
      dt = clamp(dt, 0.0005, 0.1);
      this.time = t;

      this.updateMotion(dt);
      this.audio.update(dt, t);
      this.updateFade(dt);
      this.updateUI(dt);
      if (document.hidden) return;
      this.updateQuality(dt, frameMs);
      this.resize();

      // Effects glide toward their targets; palette hue cycling, then ease toward the target.
      this.updateEffects(dt);
      const drift = this.fx.hueDrift || 0;
      if (drift > 0.01) this.hueOffset = (this.hueOffset + drift * dt) % 360;
      else if (this.hueOffset !== 0) { this.hueOffset += (0 - this.hueOffset) * (1 - Math.exp(-dt / 1.5)); if (Math.abs(this.hueOffset) < 0.5) this.hueOffset = 0; }
      hueRotate(this.paletteTarget, this.paletteBase, this.hueOffset);
      const pe = 1 - Math.exp(-dt / this.paletteTau);
      for (let i = 0; i < 12; i++) this.palette[i] += (this.paletteTarget[i] - this.palette[i]) * pe;

      const gl = this.gl, audio = this.audio;
      gl.bindTexture(gl.TEXTURE_2D, this.bandTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, VIZ.AUDIO.NUM_BANDS, 1, gl.RGBA, gl.UNSIGNED_BYTE, audio.bandBytes);
      gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, VIZ.AUDIO.WAVE_LEN, 1, gl.RED, gl.UNSIGNED_BYTE, audio.waveBytes);
      gl.bindTexture(gl.TEXTURE_2D, null);

      const u = {
        time: this.time, dt, width: this.hdr.w, height: this.hdr.h, aspect: this.hdr.w / this.hdr.h,
        intensity: this.settings.intensity, palette: this.palette,
        bandTex: this.bandTex, waveTex: this.waveTex,
        params: this.sceneParamValues(this.sceneDef),
        motion: this.motion, pointer: this.pointer,
      };

      const hdr = this.hdr;
      hdr.bind();
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(true);
      hdr.clear(0, 0, 0, 1);
      if (this.scene) {
        try { this.scene.render(hdr, audio, u); } catch (e) { this.sceneCrashed(e); }
      }
      gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.depthMask(true);
      gl.bindVertexArray(null);

      const s = this.settings, p = this.post.params;
      p.bloom = s.bloom;
      p.grain = 0.035 * s.grain;
      p.exposure = (1 - this.fade) * (1 - this.fade);
      this.post.flash = audio.beatPulse * 0.05 * s.intensity * s.bandFx.shake;
      this.post.flashColor[0] = this.palette[9]; this.post.flashColor[1] = this.palette[10]; this.post.flashColor[2] = this.palette[11];
      this.post.render(hdr.tex, audio, u);
    }

    updateFade(dt) {
      if (this.fadeDir > 0) {
        this.fade = Math.min(1, this.fade + dt / 0.3);
        if (this.fade >= 1) {
          if (this.pendingScene) { this.instantiate(this.pendingScene); this.pendingScene = null; }
          this.fadeDir = -1;
        }
      } else if (this.fadeDir < 0) {
        this.fade = Math.max(0, this.fade - dt / 0.45);
        if (this.fade <= 0) this.fadeDir = 0;
      }
    }

    updateUI(dt) {
      this.fpsAcc += dt; this.fpsFrames++;
      if (this.fpsAcc >= 0.5) {
        const fps = Math.round(this.fpsFrames / this.fpsAcc);
        const scale = Math.round(this.settings.quality * (this.settings.autoQuality ? this.autoScale : 1) * 100);
        $('#fps').textContent = `${fps} / ${this.refreshHz} fps · ${this.hdr.w}×${this.hdr.h}${scale < 100 ? ' · ' + scale + '%' : ''}`;
        this.fpsAcc = 0; this.fpsFrames = 0;
        const a = this.audio;
        $('#bpmLabel').textContent = a.active && a.bpm ? `${Math.round(a.bpm)} bpm` : '— bpm';
        if (a.sourceType === 'desktop' && a.silentFor > 6 && !this.silentHintShown) {
          this.silentHintShown = true;
          this.toast('No sound is arriving. Is something playing? If you shared a window or tab, re-share "Entire screen" with "Share system audio" on.', 'error', 9000);
        }
      }
      if (this.blurbTimer > 0) { this.blurbTimer -= dt; if (this.blurbTimer <= 0) $('#sceneBlurb').textContent = ''; }
      if (this.started) {
        if (this.settings.autoCycle) {
          this.cycleTimer += dt;
          if (this.cycleTimer >= this.settings.cycleSecs) { this.cycleTimer = 0; this.stepScene(1); }
        }
        if (this.settings.autoFx) {
          this.fxTimer += dt;
          if (this.fxTimer >= this.settings.fxSecs) {
            this.fxTimer = 0;
            this.randomizeEffects(true);
            if (Math.random() < 0.35) this.newRandomPalette();
            else if (Math.random() < 0.5) { this.setSetting('palette', Math.floor(Math.random() * PALETTES.length)); this.paletteTau = 1.5; }
          }
        }
        this.uiIdle += dt;
        const panelOpen = !$('#panel').classList.contains('hidden');
        const heroOpen = !$('#hero').classList.contains('hidden');
        if (this.uiIdle > 3 && !this.uiHidden && !panelOpen && !heroOpen) {
          this.uiHidden = true;
          $('#hud').classList.add('hidden');
          document.body.classList.add('cursor-hidden');
        }
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => { window.quanta = new App(); });
})();
