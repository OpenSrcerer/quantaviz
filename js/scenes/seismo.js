/* seismo.js — Seismograph.
 * A helicorder: paper wrapped round a slowly turning drum, an ink pen drifting along it so the
 * trace runs as a helix, one row per turn, the row's ink colour cycling as on the old
 * multi-pen recorders. The camera hangs over the pen and pans along the drum with it.
 * Every kick is an earthquake, written the way a real one arrives: the small, fast P-wave
 * first, then the larger S-wave, then the big slow surface waves, each decaying; harder kicks
 * are bigger quakes. Between them the needle never rests: microseisms (the ocean's hum) and
 * the bass's rumble keep it trembling. The pen clips at the edge of its travel, as pens do.
 *   bass  -> quakes on kicks, a ground rumble with the bass level
 *   mids  -> the desk lamp's light and the ink's warmth
 *   highs -> pen jitter and fine microseismic noise
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const W = 1024, ROWS = 24;
  const DRUM_R = 1.0, DRUM_L = 3.0;          // drum radius, half length
  const ROW_H = (2 * DRUM_L - 0.4) / ROWS;   // axial height of one row
  const X0 = -DRUM_L + 0.2;
  const AMP = 0.42;                          // trace amplitude, in rows
  const PEN_ANGLE = 0.35;                    // where the pen touches the drum (radians above the front)

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define ROWS ${ROWS}.0
uniform sampler2D uTrace;   // r = value (0..1 around 0.5), one row per drum turn
uniform vec3 uEye;
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uRot;          // drum rotation, so the pen's angle maps to the column being written
uniform vec2 uPenTip;        // pen contact point, screen coords
uniform vec2 uPenBase;       // pen arm pivot, screen coords
uniform float uCurRow;
const float R = ${DRUM_R.toFixed(2)};
const float L = ${DRUM_L.toFixed(2)};
const float ROW_H = ${ROW_H.toFixed(5)};
const float X0 = ${X0.toFixed(3)};
const float AMP = ${AMP.toFixed(3)};
const float TAU = 6.2831853;

float segDist(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }

vec3 inkColor(float row) {
  float k = mod(row, 4.0);
  vec3 c = k < 1.0 ? vec3(0.08, 0.1, 0.22) : k < 2.0 ? vec3(0.55, 0.08, 0.06) : k < 3.0 ? vec3(0.05, 0.25, 0.45) : vec3(0.08, 0.32, 0.12);
  return mix(c, palette(0.3 + 0.2 * k) * 0.35, 0.25);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  vec3 rd = normalize(uFwd * 1.4 + uRight * p.x + uUp * p.y);
  vec3 ro = uEye;
  float lamp = 0.62 + 0.25 * uMid;
  vec3 lampDir = normalize(vec3(-0.4, 0.9, 0.5));
  // The bench: a dark surface, lit in a pool.
  vec3 col = mix(vec3(0.05, 0.045, 0.04), vec3(0.11, 0.1, 0.09), smoothstep(-0.6, 0.4, p.y)) * lamp;

  // Ray against the drum: a cylinder along x.
  float a = dot(rd.yz, rd.yz);
  float b = dot(ro.yz, rd.yz);
  float c = dot(ro.yz, ro.yz) - R * R;
  float disc = b * b - a * c;
  if (disc > 0.0) {
    float t = (-b - sqrt(disc)) / a;
    vec3 hp = ro + rd * t;
    if (t > 0.0 && abs(hp.x) < L) {
      vec3 n = normalize(vec3(0.0, hp.yz));
      float diff = 0.3 + 0.55 * max(dot(n, lampDir), 0.0);
      if (abs(hp.x) > L - 0.12) {
        // Metal end bands.
        float spec = pow(max(dot(reflect(rd, n), lampDir), 0.0), 40.0);
        col = vec3(0.32, 0.31, 0.29) * diff + vec3(1.0) * spec * 0.6;
      } else {
        // Paper coordinates: around the drum (one turn = 0..1) and along it.
        float ang = atan(hp.z, hp.y);                 // 0 at the top, increasing toward the viewer
        float aPaper = fract((ang + uRot) / TAU);
        float rowCoord = (hp.x - X0) / ROW_H - aPaper; // the trace is a helix: one row per turn
        float row = floor(rowCoord);
        float local = fract(rowCoord) - 0.5;
        vec3 paper = vec3(0.78, 0.75, 0.66);
        // Faint time ticks and row baselines.
        float tick = 1.0 - smoothstep(0.0, 0.0015 + px * 2.0, abs(fract(aPaper * 60.0) - 0.5) - 0.497);
        paper -= vec3(0.08, 0.06, 0.02) * tick * 0.5;
        paper -= vec3(0.05, 0.04, 0.0) * (1.0 - smoothstep(0.0, 0.02, abs(local)));
        vec3 ink = vec3(0.0);
        float inkA = 0.0;
        if (row >= 0.0 && row < ROWS) {
          float tr = (row + 0.5) / ROWS;
          float v = (texture(uTrace, vec2(aPaper, tr)).r - 0.5) * 2.0;
          float v2 = (texture(uTrace, vec2(aPaper + 1.0 / ${W}.0, tr)).r - 0.5) * 2.0;
          // Distance to the trace in row units, corrected for its slope.
          float arcPerSample = TAU * R / ${W}.0 / ROW_H;
          float slope = (v2 - v) * AMP / arcPerSample;
          float d = abs(local - v * AMP) / sqrt(1.0 + slope * slope);
          float fw = max(fwidth(rowCoord), 1e-4);
          float lw = 0.012 + fw * 0.7;
          inkA = 1.0 - smoothstep(lw, lw + fw * 1.2, d);
          inkA *= step(0.001, abs(texture(uTrace, vec2(aPaper, tr)).g));   // only where the pen has been
          ink = inkColor(row);
        }
        col = mix(paper, ink, inkA * 0.9) * diff * lamp;
        col += vec3(0.025) * pow(max(dot(reflect(rd, n), lampDir), 0.0), 8.0);
      }
      // Distance fog toward the far end.
      col *= 1.0 - 0.35 * smoothstep(2.5, 5.0, t);
    }
  }
  // The pen arm, drawn over the drum.
  float pd = segDist(p, uPenBase, uPenTip);
  col = mix(col, vec3(0.12, 0.12, 0.13), 1.0 - smoothstep(px * 1.5, px * 3.0, pd));
  col += vec3(0.9, 0.9, 0.85) * (1.0 - smoothstep(px * 0.5, px * 1.2, pd)) * 0.15;
  float tip = length(p - uPenTip);
  col = mix(col, vec3(0.05), 1.0 - smoothstep(px * 2.0, px * 3.5, tip));
  col += palette(0.9) * exp(-tip / 0.01) * 0.05 * (0.5 + uHigh);
  col *= 0.7 + 0.5 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  class SeismoScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.prog = ctx.fsProgram(FS, 'seismo');
      // r: value, g: "written" flag. One row per drum turn.
      this.data = new Uint8Array(W * ROWS * 4);
      this.tex = ctx.createTexture({ width: W, height: ROWS, data: this.data, filter: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE });
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.trig = new VIZ.KickTrigger(0.35);
      this.turns = 0;           // drum turns, fractional
      this.lastIdx = -1;
      this.row = 0;
      this.quakes = [];
      this.t = 0;
      this.camX = null;
      this.noise = 0;
      this.dirtyRows = new Set();
      this._prefill();
    }
    /** Fill the drum with a stretch of earlier recording, so it doesn't start as blank paper. */
    _prefill() {
      const quiet = { bass: 0.15, high: 0.1 }, P = { magnitude: 1, rumble: 1, jitter: 1 };
      const period = 14;
      const turnsBack = ROWS - 1;
      this.t = -turnsBack * period;
      for (let q = 0; q < turnsBack * 2; q++) {
        if (Math.random() < 0.45) this.quakes.push({ t0: this.t + Math.random() * turnsBack * period, amp: 0.25 + 0.6 * Math.random(), ph: Math.random() * 6.28, dist: 0.7 + Math.random() * 0.8 });
      }
      for (let i = 0; i < turnsBack * W; i++) {
        const tt = this.t + (i / W) * period;
        const v = this._signal(tt, quiet, P);
        const row = Math.floor(i / W) % ROWS, s = i % W;
        const o = (row * W + s) * 4;
        this.data[o] = Math.round((v * 0.5 + 0.5) * 255);
        this.data[o + 1] = 255;
      }
      this.turns = turnsBack;
      this.row = turnsBack % ROWS;
      this.t = 0;
      this.quakes = [];
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, ROWS, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    _signal(t, audio, P) {
      let v = 0;
      for (const q of this.quakes) {
        const tau = t - q.t0;
        if (tau < 0) continue;
        const A = q.amp * P.magnitude;
        // P-wave: small and fast; S-wave ~0.9 s later, larger; surface waves last, largest and slowest.
        v += A * 0.28 * Math.exp(-tau / 0.7) * Math.sin(2 * Math.PI * 7.5 * tau + q.ph) * Math.min(1, tau / 0.05);
        const ts = tau - 0.9 * q.dist;
        if (ts > 0) v += A * 0.65 * Math.exp(-ts / 1.1) * Math.sin(2 * Math.PI * 3.6 * ts + q.ph * 2) * Math.min(1, ts / 0.08);
        const tl = tau - 1.8 * q.dist;
        if (tl > 0) v += A * 1.1 * Math.exp(-tl / 2.4) * Math.sin(2 * Math.PI * 1.15 * tl + q.ph * 3) * Math.min(1, tl / 0.3);
      }
      // Microseism + bass rumble + high-frequency jitter.
      this.noise += (Math.random() - 0.5) * 0.4 - this.noise * 0.08;
      v += 0.025 * Math.sin(t * 2 * Math.PI * 0.25) + 0.02 * this.noise;
      v += 0.12 * audio.bass * Math.sin(t * 2 * Math.PI * 2.2) * P.rumble;
      v += (Math.random() - 0.5) * (0.01 + 0.08 * audio.high) * P.jitter;
      return Math.max(-1, Math.min(1, v));   // the pen hits its stops
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const gl = this.gl;
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      this.t += dt;
      const hit = this.trig.update(audio.kick);
      if (hit) this.quakes.push({ t0: this.t, amp: 0.35 + 0.65 * hit, ph: Math.random() * 6.28, dist: 0.7 + Math.random() * 0.8 });
      this.quakes = this.quakes.filter((q) => this.t - q.t0 < 14);

      // The drum turns once every `period` seconds; the pen writes W samples per turn.
      const period = 14 / P.speed;
      const prevTurns = this.turns;
      this.turns += dt / period;
      const t0 = this.t - dt;
      const i0 = Math.floor(prevTurns * W), i1 = Math.floor(this.turns * W);
      for (let i = i0 + 1; i <= i1; i++) {
        const turn = Math.floor(i / W);
        const row = turn % ROWS;
        if (row !== this.row) {
          // A new turn: clear the row the pen is about to write (it held a turn from long ago).
          this.row = row;
          this.data.fill(0, row * W * 4, (row + 1) * W * 4);
          this.dirtyRows.add(row);
        }
        const s = i % W;
        const tt = t0 + (i - i0) / Math.max(1, i1 - i0) * dt;
        const v = this._signal(tt, audio, P);
        const o = (row * W + s) * 4;
        this.data[o] = Math.round((v * 0.5 + 0.5) * 255);
        this.data[o + 1] = 255;
        this.dirtyRows.add(row);
      }
      if (this.dirtyRows.size) {
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        for (const r of this.dirtyRows) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.data, r * W * 4);
        gl.bindTexture(gl.TEXTURE_2D, null);
        this.dirtyRows.clear();
      }

      // Pen position: the helix advances one row per turn.
      const frac = this.turns - Math.floor(this.turns);
      const penX = X0 + (this.row + frac + 0.5) * ROW_H;
      const curV = this.data[(this.row * W + (i1 % W)) * 4] / 255 * 2 - 1;
      const penXv = penX + curV * AMP * ROW_H;
      // The drum turns so the freshly inked paper moves away from the pen, over the top.
      const rot = this.turns * Math.PI * 2;

      // Camera: in front of and above the pen, panning along the drum with it.
      if (this.camX === null) this.camX = penX;
      this.camX += (penX - this.camX) * (1 - Math.exp(-dt / 2.5));
      const sway = 0.25 * Math.sin(u.time * 0.05);
      const eye = [this.camX + 0.8 + sway, 1.45 * P.distance, 2.5 * P.distance];
      const look = [this.camX - 0.15, 0.45, 0.75];
      const f = norm([look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]]);
      const r = norm(cross(f, [0, 1, 0]));
      const up = cross(r, f);
      const project = (q) => {
        const d = [q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]];
        const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
        return [(d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) * 1.4 / z, (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) * 1.4 / z];
      };
      const tipW = [penXv, DRUM_R * Math.cos(PEN_ANGLE), DRUM_R * Math.sin(PEN_ANGLE)];
      const baseW = [penX + 0.15, 1.75, 0.95];
      const tip = project(tipW), base = project(baseW);

      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.tex('uTrace', this.tex)
        .f3('uEye', ...eye).f3('uFwd', ...f).f3('uRight', ...r).f3('uUp', ...up)
        .f('uRot', rot - PEN_ANGLE)
        .f2('uPenTip', tip[0], tip[1]).f2('uPenBase', base[0], base[1])
        .f('uCurRow', this.row);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); this.gl.deleteTexture(this.tex); }
  }

  VIZ.registerScene({
    id: 'seismo',
    name: 'Seismograph',
    blurb: 'A helicorder drum inking the ground. Every kick is a quake: the P-wave first, then the S-wave, then the big surface waves.',
    params: [
      { key: 'magnitude', label: 'Quake size on kicks', min: 0.2, max: 2, step: 0.05, value: 1 },
      { key: 'rumble', label: 'Bass rumble', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'jitter', label: 'Pen jitter on highs', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'speed', label: 'Drum speed', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'distance', label: 'Camera distance', min: 0.7, max: 1.6, step: 0.05, value: 1 },
    ],
    create: (ctx) => new SeismoScene(ctx),
  });
})();
