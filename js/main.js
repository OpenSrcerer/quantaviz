/* main.js — Quanta app shell: scene registry, settings, UI, render loop.
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
 *           bass, mid, high, level (0..1), beat (envelope 0..1), beatPulse (sharp 0..1),
 *           onset (true on the frame a beat was detected), beatCount, bpm, recentBeats[8] (times)
 * `u`     : { time, dt, width, height, intensity, palette (Float32Array 12 = 4 linear RGB colours,
 *           [0]=dark, [1..3]=accents), bandTex, waveTex, params ({key:value} of this scene's
 *           params), motion {dx,dy,vx,vy} (window movement, CSS px and px/s),
 *           pointer {x,y,down} (0..1, y up), aspect }
 * Shader programs may include VIZ.glsl.common and use ctx.setCommon(prog, audio, u) to fill
 * uTime/uRes/uBass/uMid/uHigh/uLevel/uBeat/uPulse/uIntensity/uCol[4]/uBands/uWave.
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

  const PALETTES = [
    { name: 'Aurora', colors: ['#0a1430', '#1de9b6', '#7c4dff', '#ff4fd8'] },
    { name: 'Solar', colors: ['#2a0a00', '#ff5a1f', '#ffc53d', '#fff2c7'] },
    { name: 'Glacier', colors: ['#061a33', '#2f7bff', '#7df3ff', '#f4fbff'] },
    { name: 'Candy', colors: ['#2b0b3a', '#ff4ecd', '#ffe14f', '#4ff0ff'] },
    { name: 'Quark', colors: ['#120c2a', '#ff3b5c', '#3bff7a', '#4f8dff'] },
    { name: 'Ember', colors: ['#160606', '#ff2d55', '#ff9f1c', '#ffe9a8'] },
    { name: 'Mono', colors: ['#0a0a0c', '#5a5f6e', '#c4c9d6', '#ffffff'] },
  ];

  const DEFAULTS = {
    scene: 'quarks',
    palette: 0,
    sensitivity: 1.0,
    intensity: 1.0,
    bloom: 1.0,
    grain: 1.0,
    quality: 1.0,
    autoQuality: true,
    autoCycle: false,
    cycleSecs: 45,
    volume: 0.6,
    sceneParams: {},
  };
  const STORAGE_KEY = 'quanta.settings.v1';
  const GENERAL_SLIDERS = {
    generalAudio: [
      { key: 'sensitivity', label: 'Sensitivity', min: 0.3, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'volume', label: 'Playback volume (file / demo)', min: 0, max: 1, step: 0.01, fmt: (v) => Math.round(v * 100) + '%' },
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
  };

  const $ = (sel) => document.querySelector(sel);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function hexToLinear(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2));
  }

  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (e) { s = {}; }
    const out = Object.assign({}, DEFAULTS, s);
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
      this.paletteTarget = new Float32Array(12);

      this.scene = null;
      this.sceneDef = null;
      this.broken = new Set();
      this.fade = 0;          // 0 = visible, 1 = black
      this.fadeDir = 0;
      this.pendingScene = null;
      this.cycleTimer = 0;
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
      document.addEventListener('visibilitychange', () => { this.last = 0; });
      requestAnimationFrame((t) => this.frame(t));
    }

    fatal(msg) {
      const hero = $('#hero');
      hero.innerHTML = `<div class="hero-card"><h1 style="margin:0 0 10px;font-size:22px">Quanta can't start</h1><p class="hint">${msg}</p></div>`;
    }

    /* ---------------- settings ---------------- */
    saveSettings() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch (e) { /* ignore */ }
    }
    setSetting(key, value) {
      this.settings[key] = value;
      this.applySettings();
      this.saveSettings();
      this.syncControls();
    }
    applySettings() {
      const s = this.settings;
      this.audio.sensitivity = s.sensitivity;
      this.audio.setMonitorVolume(s.volume);
      const pal = PALETTES[clamp(s.palette | 0, 0, PALETTES.length - 1)];
      pal.colors.forEach((hex, i) => { const c = hexToLinear(hex); this.paletteTarget.set(c, i * 3); });
      document.documentElement.style.setProperty('--accent', pal.colors[2]);
      document.documentElement.style.setProperty('--accent2', pal.colors[1]);
    }
    sceneParamValues(def) {
      const out = {};
      if (!def || !def.params) return out;
      const saved = this.settings.sceneParams[def.id] || {};
      for (const p of def.params) out[p.key] = saved[p.key] !== undefined ? saved[p.key] : p.value;
      return out;
    }

    /* ---------------- UI ---------------- */
    buildUI() {
      const s = this.settings;
      // Source buttons.
      document.querySelectorAll('.src').forEach((b) => b.addEventListener('click', () => this.selectSource(b.dataset.src)));
      $('#btnSource').addEventListener('click', () => this.showHero());
      $('#fileInput').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) this.selectSource('file', f);
        e.target.value = '';
      });
      // Drag and drop.
      let dragDepth = 0;
      window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('#dropHint').classList.remove('hidden'); });
      window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropHint').classList.add('hidden'); });
      window.addEventListener('dragover', (e) => e.preventDefault());
      window.addEventListener('drop', (e) => {
        e.preventDefault(); dragDepth = 0; $('#dropHint').classList.add('hidden');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this.selectSource('file', f);
      });

      // HUD buttons.
      $('#btnSettings').addEventListener('click', () => this.togglePanel());
      $('#btnClosePanel').addEventListener('click', () => this.togglePanel(false));
      $('#btnFull').addEventListener('click', () => this.toggleFullscreen());
      $('#btnPrev').addEventListener('click', () => this.stepScene(-1));
      $('#btnNext').addEventListener('click', () => this.stepScene(1));
      $('#btnReset').addEventListener('click', () => {
        const keepScene = this.settings.scene;
        this.settings = Object.assign({}, DEFAULTS, { scene: keepScene, sceneParams: {} });
        this.applySettings(); this.saveSettings(); this.syncControls(); this.buildSceneParams();
        this.toast('Settings reset');
      });

      // Scene chips.
      const list = $('#sceneList');
      list.innerHTML = '';
      VIZ.scenes.forEach((def) => {
        const b = document.createElement('button');
        b.className = 'chip'; b.textContent = def.name; b.dataset.id = def.id;
        b.addEventListener('click', () => this.selectScene(def.id));
        list.appendChild(b);
      });
      // Palette swatches.
      const pl = $('#paletteList');
      pl.innerHTML = '';
      PALETTES.forEach((p, i) => {
        const b = document.createElement('button');
        b.className = 'swatch'; b.title = p.name; b.dataset.index = i;
        p.colors.forEach((c) => { const sp = document.createElement('span'); sp.style.background = c; b.appendChild(sp); });
        b.addEventListener('click', () => this.setSetting('palette', i));
        pl.appendChild(b);
      });
      // General sliders.
      this.controls = {};
      for (const containerId of Object.keys(GENERAL_SLIDERS)) {
        const host = document.getElementById(containerId);
        for (const def of GENERAL_SLIDERS[containerId]) {
          host.appendChild(this.makeSlider(def, s[def.key], (v) => this.setSetting(def.key, v)));
        }
      }
      $('#autoCycle').addEventListener('change', (e) => { this.cycleTimer = 0; this.setSetting('autoCycle', e.target.checked); });
      $('#autoQuality').addEventListener('change', (e) => { this.autoScale = 1; this.setSetting('autoQuality', e.target.checked); });

      // Keyboard.
      window.addEventListener('keydown', (e) => this.onKey(e));
      // Pointer / idle.
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
        const c = this.controls[key];
        if (s[key] !== undefined && +c.input.value !== s[key]) { c.input.value = s[key]; c.out.textContent = c.fmt(s[key]); }
      }
      $('#autoCycle').checked = !!s.autoCycle;
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
      // A button that was just clicked keeps focus; Space/Enter would re-trigger it.
      if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
      const k = e.key;
      if (k === ' ' || k === 'ArrowRight') { e.preventDefault(); this.stepScene(1); }
      else if (k === 'ArrowLeft') { e.preventDefault(); this.stepScene(-1); }
      else if (k >= '1' && k <= '9') { const d = VIZ.scenes[+k - 1]; if (d) this.selectScene(d.id); }
      else if (k === 'f' || k === 'F') this.toggleFullscreen();
      else if (k === 'h' || k === 'H') { this.uiForceHidden = !this.uiForceHidden; $('#hud').classList.toggle('hidden', this.uiForceHidden); if (this.uiForceHidden) this.togglePanel(false); }
      else if (k === 's' || k === 'S') this.togglePanel();
      else if (k === 'p' || k === 'P') this.setSetting('palette', (this.settings.palette + 1) % PALETTES.length);
      else if (k === 'a' || k === 'A') { this.cycleTimer = 0; this.setSetting('autoCycle', !this.settings.autoCycle); this.toast('Auto-cycle ' + (this.settings.autoCycle ? 'on' : 'off')); }
      else if (k === 'Escape') { this.togglePanel(false); }
      else if (k === 'm' || k === 'M') { this.setSetting('volume', this.settings.volume > 0 ? 0 : 0.6); }
    }

    /* ---------------- sources ---------------- */
    async selectSource(kind, file) {
      try {
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
        this.broken.add(def.id);
        this.toast(`Scene "${def.name}" failed: ${e.message}`, 'error', 6000);
        this.scene = null;
        const alt = VIZ.scenes.find((s) => !this.broken.has(s.id));
        if (alt) { this.settings.scene = alt.id; return this.instantiate(alt); }
      }
      $('#sceneName').textContent = def.name;
      $('#sceneBlurb').textContent = def.blurb || '';
      this.blurbTimer = 6;
      this.buildSceneParams();
      this.syncControls();
      // Reset the GL state scenes rely on.
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindVertexArray(null);
    }
    sceneCrashed(e) {
      console.error(`[quanta] scene "${this.sceneDef.id}" crashed while rendering`, e);
      this.broken.add(this.sceneDef.id);
      this.toast(`Scene "${this.sceneDef.name}" crashed: ${e.message}`, 'error', 6000);
      try { this.scene.dispose(); } catch (err) { /* ignore */ }
      this.scene = null;
      const alt = VIZ.scenes.find((s) => !this.broken.has(s.id));
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
      if (Math.abs(m.dx) > 600 || Math.abs(m.dy) > 600) { m.dx = 0; m.dy = 0; } // monitor hop, not a shove
      m.x = x; m.y = y;
      const a = 1 - Math.exp(-dt / 0.08);
      m.vx += (m.dx / dt - m.vx) * a;
      m.vy += (m.dy / dt - m.vy) * a;
    }

    updateQuality(dt, frameMs) {
      // Warm-up: render tiny for the first frames so we can measure the display's refresh interval.
      if (this.frameCount < 45) {
        this.frameCount++;
        this.autoScale = 0.35;
        if (this.frameCount > 8 && frameMs > 3) this.refreshMs = Math.min(this.refreshMs, frameMs);
        if (this.frameCount === 45) {
          // Snap to a plausible refresh rate (60/75/90/120/144/165/240 Hz).
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
      if (!this.settings.autoQuality) return;
      this.qualityTimer += dt;
      this.qualityCooldown = Math.max(0, this.qualityCooldown - dt);
      if (this.qualityTimer < 1.0 || this.qualityCooldown > 0) return;
      this.qualityTimer = 0;
      const budget = this.refreshMs;
      if (this.frameAvg > budget * 1.22 + 0.5 && this.autoScale > 0.5) { this.autoScale = Math.max(0.5, this.autoScale - 0.1); this.qualityCooldown = 1.5; }
      else if (this.frameAvg < budget * 1.1 && this.autoScale < 1) { this.autoScale = Math.min(1, this.autoScale + 0.05); this.qualityCooldown = 5; }
    }

    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      const t = now / 1000;
      let dt = this.last ? t - this.last : 1 / 60;
      const frameMs = this.last ? (t - this.last) * 1000 : 16.7;
      this.last = t;
      dt = clamp(dt, 0.0005, 0.1);
      this.time = t;   // same clock as audio.recentBeats

      this.updateMotion(dt);
      this.audio.update(dt, t);
      this.updateFade(dt);
      this.updateUI(dt);
      if (document.hidden) return;
      this.updateQuality(dt, frameMs);
      this.resize();

      // Palette eases toward the selected one so switching feels smooth.
      const pe = 1 - Math.exp(-dt / 0.35);
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
      this.post.flash = audio.beatPulse * 0.05 * s.intensity;
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
      // FPS readout.
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
      // Blurb under the scene name fades away.
      if (this.blurbTimer > 0) { this.blurbTimer -= dt; if (this.blurbTimer <= 0) $('#sceneBlurb').textContent = ''; }
      // Auto-cycle.
      if (this.settings.autoCycle && this.started) {
        this.cycleTimer += dt;
        if (this.cycleTimer >= this.settings.cycleSecs) { this.cycleTimer = 0; this.stepScene(1); }
      }
      // Idle UI hiding.
      if (this.started) {
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
