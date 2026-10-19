/* audio.js — audio capture + analysis.
 * Sources: desktop (screen-share system audio), microphone, audio file, built-in demo synth.
 * Produces per-frame features: 128 log-spaced bands (smoothed / raw / peak-hold), a 512-sample
 * waveform, bass/mid/high energies, level, beat envelope + pulse, and a rough BPM estimate.
 */
(function () {
  'use strict';
  const VIZ = (window.VIZ = window.VIZ || {});

  const NUM_BANDS = 128;
  const WAVE_LEN = 512;
  const FFT_SIZE = 2048;        // 43 ms window at 48 kHz: snappy, still ~23 Hz resolution
  const F_MIN = 32;
  const F_MAX = 16000;
  const MIN_DB = -88;
  const MAX_DB = -18;
  const TILT_DB_PER_OCT = 2.6;   // pink-noise style compensation so highs are visible
  const FLUX_HISTORY = 48;
  // Band energies are linear in dB (0.1 = 7 dB), so attacks are dB jumps: a kick on top of a sustained
  // bassline adds only 5-12 dB (0.07-0.17), an isolated kick 30-40 dB (0.4-0.6). The floor is ~2 dB,
  // the smallest measured rise that may count (noise wobble stays below it).
  const HIT_FLOOR = 0.03;
  // Band sub-ranges in texture coordinate t (log frequency): bass 32–150 Hz, mid 150–2200 Hz, high 2200–16000 Hz.
  const RANGE_T = { bass: [0, 0.25], mid: [0.25, 0.68], high: [0.68, 1] };

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

  /* ------------------------------------------------------------------ */
  /* Demo synth: a small sequenced synthwave loop so the visualizer can  */
  /* be tried without any capture permission.                           */
  /* ------------------------------------------------------------------ */
  class DemoSynth {
    constructor(ctx) {
      this.ctx = ctx;
      this.out = ctx.createGain();
      this.out.gain.value = 0.8;
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.ratio.value = 4;
      this.comp.attack.value = 0.004;
      this.comp.release.value = 0.12;
      this.bus = ctx.createGain();
      this.bus.gain.value = 0.9;
      this.bus.connect(this.comp);
      this.comp.connect(this.out);
      this.noise = this._noiseBuffer();
      this.bpm = 124;
      this.step = 0;
      this.next = 0;
      this.timer = null;
    }
    get output() { return this.out; }
    _noiseBuffer() {
      const sr = this.ctx.sampleRate, len = sr * 2;
      const buf = this.ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }
    start() {
      this.step = 0;
      this.next = this.ctx.currentTime + 0.05;
      this.timer = setInterval(() => this._tick(), 25);
    }
    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      try { this.out.disconnect(); } catch (e) { /* ignore */ }
    }
    _tick() {
      const stepDur = 60 / this.bpm / 4;
      // Background tabs throttle timers to ~1 s, so schedule further ahead there.
      const ahead = document.hidden ? 1.4 : 0.2;
      while (this.next < this.ctx.currentTime + ahead) {
        this._playStep(this.step, this.next, stepDur);
        this.step = (this.step + 1) % 128;
        this.next += stepDur;
      }
    }
    _env(gainNode, t, peak, decay, attack = 0.003) {
      const g = gainNode.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(0.0001, t);
      g.linearRampToValueAtTime(peak, t + attack);
      g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }
    _noiseHit(t, vel, decay, filterType, freq, q) {
      const ctx = this.ctx;
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = filterType; f.frequency.value = freq; f.Q.value = q || 0.7;
      const g = ctx.createGain();
      this._env(g, t, vel, decay);
      n.connect(f).connect(g).connect(this.bus);
      n.start(t, Math.random() * 1.5);
      n.stop(t + decay + 0.05);
    }
    _kick(t, vel) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(175, t);
      o.frequency.exponentialRampToValueAtTime(44, t + 0.1);
      const g = ctx.createGain();
      this._env(g, t, vel, 0.4);
      o.connect(g).connect(this.bus);
      o.start(t); o.stop(t + 0.5);
      this._noiseHit(t, vel * 0.3, 0.02, 'highpass', 2500);
    }
    _snare(t, vel) {
      this._noiseHit(t, vel * 0.6, 0.18, 'bandpass', 1900, 0.8);
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
      const g = ctx.createGain();
      this._env(g, t, vel * 0.35, 0.09);
      o.connect(g).connect(this.bus);
      o.start(t); o.stop(t + 0.15);
    }
    _hat(t, vel, decay) { this._noiseHit(t, vel, decay, 'highpass', 7500); }
    _bass(t, note, dur) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(note);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 7;
      f.frequency.setValueAtTime(1500, t);
      f.frequency.exponentialRampToValueAtTime(160, t + dur * 0.7);
      const g = ctx.createGain();
      this._env(g, t, 0.42, dur);
      o.connect(f).connect(g).connect(this.bus);
      o.start(t); o.stop(t + dur + 0.05);
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = mtof(note - 12);
      const sg = ctx.createGain();
      this._env(sg, t, 0.38, dur);
      sub.connect(sg).connect(this.bus);
      sub.start(t); sub.stop(t + dur + 0.05);
    }
    _pad(t, notes, dur, bright) {
      const ctx = this.ctx;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 1.5;
      f.frequency.setValueAtTime(bright ? 2600 : 700, t);
      f.frequency.linearRampToValueAtTime(bright ? 900 : 1500, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.055, t + 0.35);
      g.gain.setValueAtTime(0.055, t + dur - 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      f.connect(g).connect(this.bus);
      for (const n of notes) {
        for (const det of [-9, 8]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(n);
          o.detune.value = det;
          o.connect(f);
          o.start(t); o.stop(t + dur + 0.05);
        }
      }
    }
    _pluck(t, note, vel) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = mtof(note);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.Q.value = 4;
      f.frequency.setValueAtTime(3800, t);
      f.frequency.exponentialRampToValueAtTime(500, t + 0.14);
      const g = ctx.createGain();
      this._env(g, t, vel, 0.24);
      o.connect(f).connect(g).connect(this.bus);
      o.start(t); o.stop(t + 0.3);
    }
    _playStep(step, t, dur) {
      const s = step % 16;
      const bar = Math.floor(step / 16) % 8;
      const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]];
      const chord = chords[bar % 4];
      const breakdown = bar === 6;
      const fill = bar === 7;
      if (!breakdown) {
        if (s % 4 === 0) this._kick(t, 1.0);
        if (bar === 3 && s === 14) this._kick(t, 0.7);
        if (fill && s >= 12) this._snare(t, 0.5 + (s - 12) * 0.15);
      }
      if (s === 4 || s === 12) this._snare(t, 1.0);
      if (s % 2 === 0) this._hat(t, breakdown ? 0.1 : 0.22, 0.045); else this._hat(t, 0.09, 0.03);
      if (s === 10) this._hat(t, 0.3, 0.22);
      const bassPat = [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0];
      if (!breakdown && bassPat[s]) this._bass(t, chord[0] - 12 + (s === 14 ? 12 : 0), dur * 1.6);
      if (s === 0) this._pad(t, chord, dur * 16, breakdown || fill);
      if (s % 2 === 1) this._pluck(t, chord[((s >> 1) + (bar & 1)) % 4] + 12, 0.13 + (s === 7 ? 0.08 : 0));
    }
  }

  /* ------------------------------------------------------------------ */
  /* AudioEngine                                                         */
  /* ------------------------------------------------------------------ */
  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.analyser = null;
      this.monitor = null;   // to speakers (file + demo only)
      this.silence = null;   // zero-gain sink that keeps the analyser pulled
      this.node = null;      // current source node
      this.stream = null;
      this.mediaEl = null;
      this.mediaNode = null;
      this.demo = null;
      this.sourceType = 'none';
      this.sourceLabel = 'No source';
      this.active = false;

      this.bands = new Float32Array(NUM_BANDS);
      this.bandsRaw = new Float32Array(NUM_BANDS);
      this.peaks = new Float32Array(NUM_BANDS);
      this.bandBytes = new Uint8Array(NUM_BANDS * 4);
      this.wave = new Float32Array(WAVE_LEN);
      this.waveBytes = new Uint8Array(WAVE_LEN);

      // Three independent band signals. Every scene binds to them the same way:
      //   bass  -> motion / shake / force       (kicks, squeezes, ripples, field strength)
      //   mid   -> light / body                 (brightness, size and colour energy of the main bodies)
      //   high  -> sparkle / detail             (twinkle, jitter, fine particles, ink shimmer)
      this.bass = 0; this.mid = 0; this.high = 0; this.level = 0;
      // Onsets per band: `beat`/`beatPulse`/`onset` are the BASS ones (kick drums); mid/high have their own.
      this.beat = 0; this.beatPulse = 0; this.onset = false; this.beatCount = 0;
      this.midPulse = 0; this.midOnset = false;
      this.highPulse = 0; this.highOnset = false;
      // Range-normalised hit envelopes: 0 at the band's recent quiet level, 1 at its recent loud
      // level, fast attack / ~150 ms release. `kick` is the bass one: an 808 pushes it to 1 and it
      // follows the note down. Scenes use it for their big visible bass response.
      this.kick = 0; this.midHit = 0; this.highHit = 0; this.kickRaw = 0;
      this.hitRelease = 0.18;   // seconds a hit takes to fade (user: Kick decay)
      this.hitThreshold = 0.35; // attacks below this fraction of a typical one are ignored (user: Kick threshold)
      this.kickGateDb = -46;    // kick band must be at least this loud (dBFS) for a hit to count (user: Kick level gate)
      this.hitFloor = 0.05;     // smallest attack that can count or train the reference (~3.5 dB)
      this.refFloor = 0.075;    // the typical-attack reference never drops below this (~5 dB)
      this.rearmDb = 4;         // after a hit the band must dip this many dB before another hit (one hit per note)
      this._hit = {
        bass: { fast: undefined, slow: undefined, ref: 0.2, cur: 0, raw: 0 },
        mid: { fast: undefined, slow: undefined, ref: 0.2, cur: 0, raw: 0 },
        high: { fast: undefined, slow: undefined, ref: 0.2, cur: 0, raw: 0 },
      };
      this.recentBeats = new Float32Array(8).fill(-100); // bass beat timestamps (seconds, same clock as update's `now`)
      this.recentBeatAmp = new Float32Array(8);          // strength (0..1) of each of those hits
      this.bpm = 0;
      this.gain = 1;
      this.sensitivity = 1.0;
      this.drive = { bass: 1, mid: 1, high: 1 };   // per-band multipliers (user "band response")
      this._bandDrive = new Float32Array(NUM_BANDS).fill(1);
      this.monitorVolume = 0.6;
      this.silentFor = 0;

      this._fft = null; this._time = null;
      this._bLo = new Float32Array(NUM_BANDS);
      this._bHi = new Float32Array(NUM_BANDS);
      this._bC = new Float32Array(NUM_BANDS);
      this._tilt = new Float32Array(NUM_BANDS);
      this._norm = new Float32Array(NUM_BANDS);
      this._prevNorm = new Float32Array(NUM_BANDS);
      this._fluxHist = new Float32Array(FLUX_HISTORY);
      this._fluxIdx = 0;
      this._lastBeat = -10;
      this._fluxHistM = new Float32Array(FLUX_HISTORY);
      this._fluxHistH = new Float32Array(FLUX_HISTORY);
      this._lastMid = -10;
      this._lastHigh = -10;
      // Onset-strength envelope sampled at 100 Hz over 8 s, for tempo autocorrelation.
      this._env = new Float32Array(800);
      this._envLin = new Float32Array(800);
      this._envPos = 0;
      this._envAcc = 0;
      this._envAccT = 0;
      this._envFilled = 0;
      this._bpmTimer = 0;
      this._agcPeak = 0.6;
      this._ranges = null;
      this._listeners = {};
    }

    on(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); return this; }
    emit(evt, data) { (this._listeners[evt] || []).forEach((fn) => fn(data)); }

    ensureContext() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = FFT_SIZE;
        this.analyser.smoothingTimeConstant = 0;
        this.silence = this.ctx.createGain();
        this.silence.gain.value = 0;
        this.analyser.connect(this.silence);
        this.silence.connect(this.ctx.destination);
        this.monitor = this.ctx.createGain();
        this.monitor.gain.value = this.monitorVolume;
        this.monitor.connect(this.ctx.destination);
        this._fft = new Float32Array(this.analyser.frequencyBinCount);
        this._time = new Float32Array(FFT_SIZE);
        this._computeBandMap();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    _computeBandMap() {
      const binW = this.ctx.sampleRate / FFT_SIZE;
      const ratio = F_MAX / F_MIN;
      for (let k = 0; k < NUM_BANDS; k++) {
        const f0 = F_MIN * Math.pow(ratio, k / NUM_BANDS);
        const f1 = F_MIN * Math.pow(ratio, (k + 1) / NUM_BANDS);
        this._bLo[k] = f0 / binW;
        this._bHi[k] = f1 / binW;
        this._bC[k] = Math.sqrt(f0 * f1) / binW;
        this._tilt[k] = TILT_DB_PER_OCT * Math.log2(Math.sqrt(f0 * f1) / F_MIN);
      }
      const idx = (f) => clamp(Math.round(Math.log(f / F_MIN) / Math.log(ratio) * NUM_BANDS), 0, NUM_BANDS - 1);
      this._ranges = {
        bass: [idx(32), idx(150)],
        kick: [idx(35), idx(100)],      // kick drum + sub: below where guitars and vocals muddy the band
        mid: [idx(150), idx(2200)],
        high: [idx(2200), idx(16000)],
        flux: [idx(32), idx(260)],
        fluxMid: [idx(300), idx(2200)],
        fluxHigh: [idx(2500), idx(14000)],
      };
      this.ranges = this._ranges;
      const i0 = Math.max(1, Math.ceil(35 / binW)), i1 = Math.max(i0, Math.floor(100 / binW));
      this._kickBins = [i0, i1];
    }

    /** Smoothed band energy at t in [0,1] (log frequency, 32 Hz .. 16 kHz). */
    bandAt(t) { return this.bands[clamp(Math.round(t * (NUM_BANDS - 1)), 0, NUM_BANDS - 1)]; }
    /** Same, but t spans only the bass / mid / high sub-range. */
    bandLow(x) { return this.bandAt(RANGE_T.bass[0] + (RANGE_T.bass[1] - RANGE_T.bass[0]) * clamp(x, 0, 1)); }
    bandMid(x) { return this.bandAt(RANGE_T.mid[0] + (RANGE_T.mid[1] - RANGE_T.mid[0]) * clamp(x, 0, 1)); }
    bandHigh(x) { return this.bandAt(RANGE_T.high[0] + (RANGE_T.high[1] - RANGE_T.high[0]) * clamp(x, 0, 1)); }

    _updateDrive() {
      const r = this._ranges, d = this.drive, bd = this._bandDrive;
      for (let k = 0; k < NUM_BANDS; k++) {
        let v;
        if (k <= r.bass[1]) v = d.bass;
        else if (k <= r.mid[1]) v = d.mid;
        else v = d.high;
        // Blend across the two boundaries so a drive change doesn't create a step in the spectrum.
        if (k > r.bass[1] - 3 && k < r.bass[1] + 3) v = d.bass + (d.mid - d.bass) * ((k - (r.bass[1] - 3)) / 6);
        if (k > r.mid[1] - 4 && k < r.mid[1] + 4) v = d.mid + (d.high - d.mid) * ((k - (r.mid[1] - 4)) / 8);
        bd[k] = v;
      }
    }

    _flux(norm, prev, range) {
      let f = 0;
      for (let k = range[0]; k <= range[1]; k++) { const d = norm[k] - prev[k]; if (d > 0) f += d; }
      return f / (range[1] - range[0] + 1);
    }
    _threshold(hist, idx, flux, mult, floor) {
      let mean = 0;
      for (let i = 0; i < FLUX_HISTORY; i++) mean += hist[i];
      mean /= FLUX_HISTORY;
      hist[idx] = flux;
      return mean * mult + floor;
    }

    setMonitorVolume(v) {
      this.monitorVolume = v;
      if (this.monitor) this.monitor.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }

    _detach() {
      if (this.node) { try { this.node.disconnect(); } catch (e) { /* ignore */ } }
      this.node = null;
      if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
      if (this.demo) { this.demo.stop(); this.demo = null; }
      if (this.mediaEl && !this.mediaEl.paused) this.mediaEl.pause();
      this.active = false;
      // Forget the hit detectors' last values so a new source doesn't start with a false hit.
      for (const k of Object.keys(this._hit)) { const h = this._hit[k]; h.fast = undefined; h.slow = undefined; h.ref = 0.2; h.cur = 0; h.raw = 0; h.armed = true; }
      this._kickEnv = 0;
    }

    stop(reason) {
      this._detach();
      this.sourceType = 'none';
      this.sourceLabel = reason || 'Stopped';
      this.emit('source', { type: 'none', label: this.sourceLabel });
    }

    _attachStream(stream, type, label) {
      this._detach();
      this.stream = stream;
      this.node = this.ctx.createMediaStreamSource(stream);
      this.node.connect(this.analyser);
      this.sourceType = type;
      this.sourceLabel = label;
      this.active = true;
      this.silentFor = 0;
      this.emit('source', { type, label });
    }

    /** Desktop / system audio via the browser's screen-share picker. */
    async useDesktop() {
      this.ensureContext();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('Screen-share audio capture is not available in this browser. Use Edge or Chrome.');
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'monitor', frameRate: { ideal: 1, max: 5 }, width: { max: 640 }, height: { max: 360 } },
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } },
          systemAudio: 'include',
          monitorTypeSurfaces: 'include',
          selfBrowserSurface: 'exclude',
          surfaceSwitching: 'include',
          preferCurrentTab: false,
        });
      } catch (e) {
        if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) throw new Error('Share dialog was cancelled.');
        throw new Error('Could not start desktop capture: ' + (e && e.message ? e.message : e));
      }
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error('The shared source had no audio. Pick "Entire screen" and turn on "Share system audio".');
      }
      // The video track is only the vehicle for the audio permission. It is kept alive (disabled,
      // tiny, ~1 fps) because some browsers end the whole capture when the video track stops.
      stream.getVideoTracks().forEach((t) => { t.enabled = false; });
      this._attachStream(stream, 'desktop', 'Desktop audio');
      stream.getTracks().forEach((t) => t.addEventListener('ended', () => {
        if (this.stream === stream) this.stop('Desktop sharing ended');
      }));
    }

    async useMic() {
      this.ensureContext();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone capture is not available in this browser.');
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
      } catch (e) {
        throw new Error('Microphone access was denied or no microphone was found.');
      }
      this._attachStream(stream, 'mic', 'Microphone');
      stream.getAudioTracks()[0].addEventListener('ended', () => {
        if (this.stream === stream) this.stop('Microphone disconnected');
      });
    }

    async useFile(file) {
      this.ensureContext();
      this._detach();
      if (!this.mediaEl) {
        this.mediaEl = document.createElement('audio');
        this.mediaEl.loop = true;
        this.mediaEl.crossOrigin = 'anonymous';
        this.mediaNode = this.ctx.createMediaElementSource(this.mediaEl);
      }
      if (this._fileUrl) URL.revokeObjectURL(this._fileUrl);
      this._fileUrl = URL.createObjectURL(file);
      this.mediaEl.src = this._fileUrl;
      this.mediaNode.connect(this.analyser);
      this.mediaNode.connect(this.monitor);
      this.node = this.mediaNode;
      try {
        await this.mediaEl.play();
      } catch (e) {
        this.node = null;
        throw new Error('Could not play that file (' + (e && e.message ? e.message : 'unsupported format') + ').');
      }
      this.sourceType = 'file';
      this.sourceLabel = file.name;
      this.active = true;
      this.silentFor = 0;
      this.emit('source', { type: 'file', label: file.name });
    }

    useDemo() {
      this.ensureContext();
      this._detach();
      this.demo = new DemoSynth(this.ctx);
      this.demo.output.connect(this.analyser);
      this.demo.output.connect(this.monitor);
      this.node = this.demo.output;
      this.demo.start();
      this.sourceType = 'demo';
      this.sourceLabel = 'Demo track';
      this.active = true;
      this.silentFor = 0;
      this.emit('source', { type: 'demo', label: this.sourceLabel });
    }

    /** Pull fresh data and recompute features. dt in seconds, now in seconds. */
    update(dt, now) {
      dt = clamp(dt, 0.001, 0.1);
      const decayB = Math.exp(-dt / 0.3);
      const decayP = Math.exp(-dt / 0.11);
      this.onset = false;
      this.midOnset = false;
      this.highOnset = false;
      if (!this.active || !this.analyser) {
        // Idle: let everything settle to zero.
        const k = Math.exp(-dt / 0.25);
        for (let i = 0; i < NUM_BANDS; i++) { this.bands[i] *= k; this.peaks[i] *= k; this.bandsRaw[i] *= k; }
        this.bass *= k; this.mid *= k; this.high *= k; this.level *= k;
        this.kick *= k; this.midHit *= k; this.highHit *= k; this._kickEnv = (this._kickEnv || 0) * k;
        this.beat *= decayB; this.beatPulse *= decayP; this.midPulse *= decayP; this.highPulse *= decayP;
        this.wave.fill(0);
        this._packBytes();
        return;
      }
      this._updateDrive();
      const an = this.analyser;
      an.getFloatFrequencyData(this._fft);
      an.getFloatTimeDomainData(this._time);

      // --- raw log-spaced bands ---
      const fft = this._fft, nb = fft.length;
      let pk = 0;
      for (let k = 0; k < NUM_BANDS; k++) {
        const lo = this._bLo[k], hi = this._bHi[k];
        let db;
        if (hi - lo < 1.0) {
          const c = this._bC[k];
          const i = Math.min(nb - 2, Math.max(0, Math.floor(c)));
          const f = clamp(c - i, 0, 1);
          db = fft[i] * (1 - f) + fft[i + 1] * f;
        } else {
          let s = 0, n = 0;
          const i0 = Math.floor(lo), i1 = Math.min(nb, Math.ceil(hi));
          for (let i = i0; i < i1; i++) { s += fft[i]; n++; }
          db = n ? s / n : -200;
        }
        if (!(db > -200)) db = -200;
        let v = (db + this._tilt[k] - MIN_DB) / (MAX_DB - MIN_DB);
        if (v < 0) v = 0;
        this.bandsRaw[k] = v;
        if (v > pk) pk = v;
      }

      // --- slow automatic gain so quiet and loud sources both fill the range ---
      this._agcPeak = Math.max(pk, this._agcPeak * Math.exp(-dt / 6));
      const targetGain = clamp(0.95 / Math.max(this._agcPeak, 0.2), 0.6, 3.5);
      this.gain += (targetGain - this.gain) * (1 - Math.exp(-dt / 2.0));
      const g = this.gain * this.sensitivity;

      // --- normalise, smooth (fast attack / slower release), peak-hold ---
      const aA = 1 - Math.exp(-dt / 0.022);
      const aR = 1 - Math.exp(-dt / 0.11);
      const norm = this._norm;
      const bd = this._bandDrive;
      for (let k = 0; k < NUM_BANDS; k++) {
        let v = this.bandsRaw[k] * g * bd[k];
        v = v / (1 + 0.18 * v);       // soft knee
        if (v > 1) v = 1;
        norm[k] = v;
        const p = this.bands[k];
        this.bands[k] = p + (v - p) * (v > p ? aA : aR);
        this.peaks[k] = Math.max(this.peaks[k] - dt * 0.45, this.bands[k]);
      }

      // --- energies ---
      const r = this._ranges;
      const eBass = this._mean(norm, r.bass), eMid = this._mean(norm, r.mid), eHigh = this._mean(norm, r.high);
      const aA2 = 1 - Math.exp(-dt / 0.03), aR2 = 1 - Math.exp(-dt / 0.14);
      this.bass += (eBass - this.bass) * (eBass > this.bass ? aA2 : aR2);
      this.mid += (eMid - this.mid) * (eMid > this.mid ? aA2 : aR2);
      this.high += (eHigh - this.high) * (eHigh > this.high ? aA2 : aR2);
      // Kick detection runs on the RAW kick band (before the global auto-gain, so the mids can
      // neither shrink nor inflate it), measured as the band's total POWER in dB: a gliding 808
      // moving between FFT bins keeps a steady power, whereas the mean of per-bin dB wobbles.
      let pw = 0, cnt = 0;
      for (let i = this._kickBins[0]; i <= this._kickBins[1]; i++) { const d = this._fft[i]; if (d > -200) pw += Math.pow(10, d / 10); cnt++; }
      const kickDb = cnt && pw > 0 ? 10 * Math.log10(pw / cnt) : -200;
      const eKick = Math.max(0, (kickDb + 2 - MIN_DB) / (MAX_DB - MIN_DB));
      this._kickEnv = this._hitEnvelope(this._hit.bass, eKick, this._kickEnv || 0, dt, this.kickGateDb);
      this.kick = clamp(this._kickEnv * this.drive.bass, 0, 1);
      this.kickRaw = this._hit.bass.raw;      // same normalisation, no release: the instantaneous hit level
      this.midHit = this._hitEnvelope(this._hit.mid, eMid, this.midHit, dt);
      this.highHit = this._hitEnvelope(this._hit.high, eHigh, this.highHit, dt);

      // --- waveform + level ---
      const tm = this._time, stride = FFT_SIZE / WAVE_LEN;
      let sq = 0;
      for (let i = 0; i < FFT_SIZE; i++) sq += tm[i] * tm[i];
      const rms = Math.sqrt(sq / FFT_SIZE);
      const wg = Math.min(6, g * 1.6);
      for (let i = 0; i < WAVE_LEN; i++) this.wave[i] = clamp(tm[i * stride] * wg, -1, 1);
      let lv = rms * g * 2.2;
      lv = lv / (1 + 0.3 * lv);
      this.level += (lv - this.level) * (lv > this.level ? aA2 : aR2);
      this.silentFor = rms < 0.0015 ? this.silentFor + dt : 0;

      // --- onset detection per band (spectral flux) ---
      const flux = this._flux(norm, this._prevNorm, r.flux);
      const fluxM = this._flux(norm, this._prevNorm, r.fluxMid);
      const fluxH = this._flux(norm, this._prevNorm, r.fluxHigh);
      this._prevNorm.set(norm);
      const threshold = this._threshold(this._fluxHist, this._fluxIdx, flux, 1.55, 0.012);
      const thresholdM = this._threshold(this._fluxHistM, this._fluxIdx, fluxM, 1.7, 0.012);
      const thresholdH = this._threshold(this._fluxHistH, this._fluxIdx, fluxH, 1.7, 0.012);
      this._fluxIdx = (this._fluxIdx + 1) % FLUX_HISTORY;
      this.beat *= decayB;
      this.beatPulse *= decayP;
      this.midPulse *= decayP;
      this.highPulse *= decayP;
      if (fluxM > thresholdM && now - this._lastMid > 0.12 && this.mid > 0.06) {
        this.midOnset = true;
        this.midPulse = clamp(0.6 + (fluxM - thresholdM) / (thresholdM + 1e-4) * 0.3, 0.6, 1);
        this._lastMid = now;
      }
      if (fluxH > thresholdH && now - this._lastHigh > 0.08 && this.high > 0.05) {
        this.highOnset = true;
        this.highPulse = clamp(0.6 + (fluxH - thresholdH) / (thresholdH + 1e-4) * 0.3, 0.6, 1);
        this._lastHigh = now;
      }
      if (flux > threshold && now - this._lastBeat > 0.16 && this.bass > 0.08) {
        const strength = clamp(0.55 + (flux - threshold) / (threshold + 1e-4) * 0.3, 0.55, 1);
        this.onset = true;
        this.beatCount++;
        this.beat = Math.max(this.beat, strength);
        this.beatPulse = 1;
        this._lastBeat = now;
        this.recentBeats.copyWithin(0, 1);
        this.recentBeats[7] = now;
        this.recentBeatAmp.copyWithin(0, 1);
        this.recentBeatAmp[7] = Math.max(this._hit.bass.raw || 0, this.kick, strength * 0.6);
      }
      // Tempo envelope (max-pooled into 10 ms bins) from the kick onset signal, which is far cleaner
      // than broadband bass flux (no bassline notes in it).
      this._envAcc = Math.max(this._envAcc, this._hit.bass.raw || 0);
      this._envAccT += dt;
      while (this._envAccT >= 0.01) {
        this._env[this._envPos] = this._envAcc;
        this._envPos = (this._envPos + 1) % this._env.length;
        this._envFilled = Math.min(this._envFilled + 1, this._env.length);
        this._envAccT -= 0.01;
        this._envAcc = 0;
      }
      this._bpmTimer += dt;
      if (this._bpmTimer > 1.5 && this._envFilled >= 400) { this._bpmTimer = 0; this._estimateTempo(); }
      this._packBytes();
    }

    /** Tempo from the autocorrelation of the onset envelope (lags 70–180 bpm, with harmonic support). */
    _estimateTempo() {
      const N = this._envFilled, L = this._env.length, lin = this._envLin;
      const start = (this._envPos - N + L) % L;
      let mean = 0;
      for (let i = 0; i < N; i++) { lin[i] = this._env[(start + i) % L]; mean += lin[i]; }
      mean /= N;
      for (let i = 0; i < N; i++) lin[i] -= mean;
      const maxLag = Math.min(172, N >> 1);
      const r = new Float32Array(maxLag + 1);
      let r0 = 0;
      for (let i = 0; i < N; i++) r0 += lin[i] * lin[i];
      if (r0 < 1e-9) return;
      for (let lag = 33; lag <= maxLag; lag++) {
        let s = 0;
        for (let i = 0; i + lag < N; i++) s += lin[i] * lin[i + lag];
        r[lag] = s / (N - lag) / (r0 / N);
      }
      let best = 0, bestLag = 0;
      for (let lag = 33; lag <= 86; lag++) {
        let score = r[lag];
        if (2 * lag <= maxLag) score += 0.5 * r[2 * lag];
        if (3 * lag <= maxLag) score += 0.25 * r[3 * lag];
        score *= 1 - 0.1 * Math.abs(Math.log(lag / 50));   // mild preference for ~120 bpm
        if (score > best) { best = score; bestLag = lag; }
      }
      if (!bestLag || best < 0.08) return;
      const bpm = 6000 / bestLag;
      // Only change the reading when two consecutive estimates agree (within 3%), so octave
      // flips and one noisy window don't make the counter jump around.
      if (this._bpmCandidate && Math.abs(bpm - this._bpmCandidate) < this._bpmCandidate * 0.03) {
        this.bpm = this.bpm && Math.abs(bpm - this.bpm) < this.bpm * 0.03 ? this.bpm + (bpm - this.bpm) * 0.3 : bpm;
      }
      this._bpmCandidate = bpm;
    }

    /** Hit envelope = the band's onset strength. The attack of a hit is the gap between a fast
     *  (8 ms) and a slow (60 ms) envelope of the band energy, which is steady across frame rates
     *  and ignores jitter. Each attack is measured against the TYPICAL recent attack (a slow
     *  average of attack sizes, not the strongest one), so a whole section of strong kicks all
     *  register and one monster hit doesn't silence the rest; an absolute floor keeps low-mid
     *  bleed and quiet-passage wobble from ever counting. `hitThreshold` is the fraction of a
     *  typical attack below which a hit is ignored; a typical hit reads ~0.85, a strong one 1.
     *  Instant attack, `hitRelease` seconds of release. A sustained note counts only at its start. */
    _hitEnvelope(st, e, prev, dt, gateDb) {
      if (st.fast === undefined) {
        st.fast = e; st.slow = e; st.ref = 0.2; st.cur = 0;
        st.armed = true; st.hitLevel = 0; st.minSince = 0; st.sinceHit = 10; st.attackV = 0; st.attackLevel = 0;
      }
      const dbRange = MAX_DB - MIN_DB;
      st.fast += (e - st.fast) * (1 - Math.exp(-dt / 0.008));
      st.slow += (e - st.slow) * (1 - Math.exp(-dt / 0.09));
      const rise = Math.max(0, st.fast - st.slow);
      // Level gate: below a minimum absolute loudness the band is mostly noise, and in dB units
      // noise wobbles by tens of dB, so without this quiet passages produce phantom hits.
      let gate = 1;
      if (gateDb !== undefined) {
        const levelDb = st.fast * dbRange + MIN_DB - 2;   // fast envelope back to dBFS (tilt removed)
        const t = clamp((levelDb - (gateDb - 3)) / 6, 0, 1);
        gate = t * t * (3 - 2 * t);
      }
      const floor = this.hitFloor, refFloor = this.refFloor;
      // Learn the typical attack: follow each attack to its peak; when it has clearly ended, fold
      // its size into a running average. Smaller attacks pull the reference down faster than big
      // ones push it up, so a dense section (kicks on top of bass) is recognised within a couple of
      // bars and one huge isolated hit does not raise the bar for long.
      let attackEnded = false;
      if (rise > st.cur) st.cur = rise;
      else if (st.cur > 0 && rise < st.cur * 0.5) {
        if (st.cur > floor) st.ref += (st.cur - st.ref) * (st.cur < st.ref ? 0.3 : 0.12);
        st.cur = 0;
        attackEnded = true;
      }
      st.ref = Math.max(refFloor, st.ref * Math.exp(-dt / 20));
      const x = rise / st.ref;
      const thr = clamp(this.hitThreshold, 0, 0.95);
      let v = clamp((x - thr) / (1.15 - thr), 0, 1);
      v = v * v * (3 - 2 * v) * gate;
      // One hit per note. After a hit the detector is disarmed until the band has dipped `rearmDb`
      // below that hit's level (or a clearly bigger attack arrives), so the wobble inside a long
      // 808 can't re-trigger it: the envelope fires once at the note's onset and then relaxes.
      st.sinceHit += dt;
      st.minSince = Math.min(st.minSince, st.fast);
      if (!st.armed && (st.hitLevel - st.minSince > this.rearmDb / dbRange || x > 2.2)) st.armed = true;
      if (!st.armed) v = 0;
      if (v > st.attackV) st.attackV = v;
      if (st.fast > st.attackLevel) st.attackLevel = st.fast;
      if (attackEnded) {
        if (st.attackV > 0.3 && st.armed) { st.armed = false; st.hitLevel = st.attackLevel; st.minSince = st.fast; st.sinceHit = 0; }
        st.attackV = 0; st.attackLevel = st.fast;
      }
      st.raw = v;
      return v > prev ? v : prev + (v - prev) * (1 - Math.exp(-dt / this.hitRelease));
    }

    _mean(arr, range) {
      let s = 0, n = 0;
      for (let k = range[0]; k <= range[1]; k++) { s += arr[k]; n++; }
      return n ? s / n : 0;
    }

    /** Tempo: score candidate periods (70–180 bpm) by how well inter-onset intervals fit multiples. */
    _pushBeat(t) {
      const bt = this._beatTimes;
      bt.push(t);
      if (bt.length > 32) bt.shift();
      if (bt.length < 8) return;
      const iv = [];
      for (let i = 1; i < bt.length; i++) {
        const d = bt[i] - bt[i - 1];
        if (d > 0.12 && d < 2.2) iv.push(d);
      }
      if (iv.length < 6) return;
      let bestScore = -1, bestT = 0.5;
      for (let T = 0.333; T <= 0.86; T += 0.004) {
        let s = 0;
        for (let i = 0; i < iv.length; i++) {
          const d = iv[i];
          const n = Math.round(d / T);
          if (n < 1 || n > 4) continue;
          const err = (d - n * T) / (T * 0.07);
          s += Math.exp(-err * err) / Math.sqrt(n);
        }
        s *= 1 - 0.12 * Math.abs(Math.log(T / 0.5));   // mild preference for ~120 bpm to break octave ties
        if (s > bestScore) { bestScore = s; bestT = T; }
      }
      const bpm = 60 / bestT;
      this.bpm = this.bpm ? this.bpm + (bpm - this.bpm) * 0.25 : bpm;
    }

    _packBytes() {
      const bb = this.bandBytes;
      for (let k = 0; k < NUM_BANDS; k++) {
        bb[k * 4] = this.bands[k] * 255;
        bb[k * 4 + 1] = this.bandsRaw[k] * 255 * this.gain * this.sensitivity > 255 ? 255 : this.bandsRaw[k] * 255 * this.gain * this.sensitivity;
        bb[k * 4 + 2] = this.peaks[k] * 255;
        bb[k * 4 + 3] = 255;
      }
      const wb = this.waveBytes;
      for (let i = 0; i < WAVE_LEN; i++) wb[i] = (this.wave[i] * 0.5 + 0.5) * 255;
    }
  }

  VIZ.AudioEngine = AudioEngine;
  VIZ.AUDIO = { NUM_BANDS, WAVE_LEN, RANGE_T };
})();
