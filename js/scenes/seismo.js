/* seismo.js — Seismograph.
 * A three-pen helicorder: paper wrapped round a slowly turning drum, three ink pens side by side
 * drifting along it so each writes its own lane of a helix, one row per turn. Like the multi-pen
 * recorders of old observatories each pen has its own ink and its own channel:
 *   black  lows  - earthquakes. Every kick is a quake that arrives the way real ones do: the small
 *                  fast P-wave, then the larger S-wave, then the big slow surface waves; the bass
 *                  keeps a ground rumble going between them.
 *   red    mids  - volcanic tremor. Mid onsets set off tremor bursts; the mid level is a
 *                  continuous harmonic hum.
 *   blue   highs - micro-quakes and icequakes: a sharp short spike on every high onset, fine
 *                  noise with the treble.
 * The pens clip at the edges of their travel, as pens do. The drum turns so the fresh ink rolls
 * down the front into view under the pens; the camera pans along with them.
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const W = 1024, ROWS = 14;
  const DRUM_R = 1.0, DRUM_L = 3.0;          // drum radius, half length
  const ROW_H = (2 * DRUM_L - 0.4) / ROWS;   // axial height of one row (three lanes)
  const X0 = -DRUM_L + 0.2;
  const LANES = [-0.31, 0.0, 0.31];          // lane centres within a row, in rows
  const AMP = 0.135;                         // lane amplitude, in rows (pens clip beyond this)
  const PEN_ANGLE = 0.95;                    // where the pens touch the drum (radians from the top, toward the viewer)

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define ROWS ${ROWS}.0
uniform sampler2D uTrace;   // rgb = lows, mids, highs (0..1 around 0.5), a = written; one row per turn
uniform vec3 uEye;
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uRot;          // drum rotation, so the pens' angle maps to the column being written
uniform vec2 uPenTip[3];     // pen contact points, screen coords
uniform vec2 uPenBase[3];    // pen arm pivots, screen coords
const float R = ${DRUM_R.toFixed(2)};
const float L = ${DRUM_L.toFixed(2)};
const float ROW_H = ${ROW_H.toFixed(5)};
const float X0 = ${X0.toFixed(3)};
const float AMP = ${AMP.toFixed(3)};
const vec3 LANES = vec3(${LANES.map((v) => v.toFixed(3)).join(', ')});
const float TAU = 6.2831853;

float segDist(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }

vec3 ink(int k) {
  vec3 c = k == 0 ? vec3(0.07, 0.08, 0.12) : k == 1 ? vec3(0.62, 0.08, 0.06) : vec3(0.06, 0.24, 0.6);
  return mix(c, palette(0.35 + 0.25 * float(k)) * 0.35, 0.15);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  vec3 rd = normalize(uFwd * 1.4 + uRight * p.x + uUp * p.y);
  vec3 ro = uEye;
  float lamp = 0.62 + 0.25 * uMid;
  vec3 lampDir = normalize(vec3(-0.4, 0.9, 0.5));
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
        float spec = pow(max(dot(reflect(rd, n), lampDir), 0.0), 40.0);
        col = vec3(0.32, 0.31, 0.29) * diff + vec3(1.0) * spec * 0.6;
      } else {
        float ang = atan(hp.z, hp.y);                 // 0 at the top, increasing toward the viewer
        // The drum turns so freshly inked paper rolls down the front, toward the viewer.
        float aPaper = fract((uRot - ang) / TAU);
        float rowCoord = (hp.x - X0) / ROW_H - aPaper; // the trace is a helix: one row per turn
        float row = floor(rowCoord);
        float local = fract(rowCoord) - 0.5;
        vec3 paper = vec3(0.78, 0.75, 0.66);
        float tick = 1.0 - smoothstep(0.0, 0.0015 + px * 2.0, abs(fract(aPaper * 60.0) - 0.5) - 0.497);
        paper -= vec3(0.08, 0.06, 0.02) * tick * 0.5;
        vec3 shade = paper;
        if (row >= 0.0 && row < ROWS) {
          float tr = (row + 0.5) / ROWS;
          vec4 s = texture(uTrace, vec2(aPaper, tr));
          vec4 s2 = texture(uTrace, vec2(aPaper + 1.0 / ${W}.0, tr));
          float written = step(0.004, s.a);
          float fw = max(fwidth(rowCoord), 1e-4);
          float lw = 0.007 + fw * 0.6;
          float arcPerSample = TAU * R / ${W}.0 / ROW_H;
          for (int k = 0; k < 3; k++) {
            float lane = k == 0 ? LANES.x : k == 1 ? LANES.y : LANES.z;
            // Faint lane baseline.
            shade -= vec3(0.04, 0.035, 0.0) * (1.0 - smoothstep(0.0, 0.012, abs(local - lane)));
            float v = ((k == 0 ? s.r : k == 1 ? s.g : s.b) - 0.5) * 2.0;
            float v2 = ((k == 0 ? s2.r : k == 1 ? s2.g : s2.b) - 0.5) * 2.0;
            float slope = (v2 - v) * AMP / arcPerSample;
            float d = abs(local - lane - v * AMP) / sqrt(1.0 + slope * slope);
            float inkA = (1.0 - smoothstep(lw, lw + fw * 1.2, d)) * written;
            shade = mix(shade, ink(k), inkA * 0.9);
          }
        }
        col = shade * diff * lamp;
        col += vec3(0.025) * pow(max(dot(reflect(rd, n), lampDir), 0.0), 8.0);
      }
      col *= 1.0 - 0.35 * smoothstep(2.5, 5.0, t);
    }
  }
  // The three pen arms, drawn over the drum.
  for (int k = 0; k < 3; k++) {
    float pd = segDist(p, uPenBase[k], uPenTip[k]);
    col = mix(col, vec3(0.12, 0.12, 0.13), 1.0 - smoothstep(px * 1.2, px * 2.6, pd));
    col += vec3(0.9, 0.9, 0.85) * (1.0 - smoothstep(px * 0.4, px * 1.0, pd)) * 0.12;
    float tip = length(p - uPenTip[k]);
    col = mix(col, ink(k) * 0.8, 1.0 - smoothstep(px * 2.0, px * 3.5, tip));
  }
  col *= 0.7 + 0.5 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const softClip = (v) => Math.tanh(v * 1.1) / Math.tanh(1.1);

  class SeismoScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.prog = ctx.fsProgram(FS, 'seismo');
      // rgb: the three lanes, a: written flag. One row per drum turn.
      this.data = new Uint8Array(W * ROWS * 4);
      this.tex = ctx.createTexture({ width: W, height: ROWS, data: this.data, filter: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE });
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.trig = new VIZ.KickTrigger(0.35);
      this.turns = 0;
      this.row = 0;
      this.quakes = [];     // lows: earthquakes
      this.tremors = [];    // mids: tremor bursts
      this.spikes = [];     // highs: micro-quakes
      this.t = 0;
      this.camX = null;
      this.noise = [0, 0, 0];
      this.dirtyRows = new Set();
      this.tips = new Float32Array(6);
      this.bases = new Float32Array(6);
      this.cur = [0, 0, 0];
      this._prefill();
    }

    /** The three channels at time t. */
    _signal(t, A, P, out) {
      // Lows: earthquakes (P, S and surface waves) and the bass rumble.
      let lo = 0;
      for (const q of this.quakes) {
        const tau = t - q.t0;
        if (tau < 0) continue;
        const a = q.amp * P.magnitude;
        lo += a * 0.28 * Math.exp(-tau / 0.7) * Math.sin(2 * Math.PI * 7.5 * tau + q.ph) * Math.min(1, tau / 0.05);
        const ts = tau - 0.9 * q.dist;
        if (ts > 0) lo += a * 0.65 * Math.exp(-ts / 1.1) * Math.sin(2 * Math.PI * 3.6 * ts + q.ph * 2) * Math.min(1, ts / 0.08);
        const tl = tau - 1.8 * q.dist;
        if (tl > 0) lo += a * 1.1 * Math.exp(-tl / 2.4) * Math.sin(2 * Math.PI * 1.15 * tl + q.ph * 3) * Math.min(1, tl / 0.3);
      }
      this.noise[0] += (Math.random() - 0.5) * 0.4 - this.noise[0] * 0.08;
      lo += 0.02 * Math.sin(t * 2 * Math.PI * 0.25) + 0.015 * this.noise[0] + 0.14 * A.bass * Math.sin(t * 2 * Math.PI * 2.2) * P.rumble;
      // Mids: volcanic tremor, a harmonic hum with bursts on mid onsets.
      let mi = 0.18 * A.mid * Math.sin(t * 2 * Math.PI * 4.2) * (0.7 + 0.3 * Math.sin(t * 1.3));
      for (const q of this.tremors) {
        const tau = t - q.t0;
        if (tau < 0) continue;
        mi += q.amp * Math.sin(2 * Math.PI * q.f * tau + q.ph) * Math.min(1, tau / 0.12) * Math.exp(-tau / 0.9);
      }
      this.noise[1] += (Math.random() - 0.5) * 0.3 - this.noise[1] * 0.1;
      mi = mi * P.tremor + 0.012 * this.noise[1];
      // Highs: sharp micro-quake spikes, and fine noise with the treble.
      let hi = 0;
      for (const q of this.spikes) {
        const tau = t - q.t0;
        if (tau < 0) continue;
        hi += q.amp * Math.sin(2 * Math.PI * 14 * tau + q.ph) * Math.exp(-tau / 0.09);
      }
      hi = hi * P.spikes + (Math.random() - 0.5) * (0.02 + 0.22 * A.high) * P.jitter;
      out[0] = softClip(Math.max(-1.2, Math.min(1.2, lo)));
      out[1] = softClip(Math.max(-1.2, Math.min(1.2, mi)));
      out[2] = softClip(Math.max(-1.2, Math.min(1.2, hi)));
    }

    _write(row, s, v) {
      const o = (row * W + s) * 4;
      this.data[o] = Math.round((v[0] * 0.5 + 0.5) * 255);
      this.data[o + 1] = Math.round((v[1] * 0.5 + 0.5) * 255);
      this.data[o + 2] = Math.round((v[2] * 0.5 + 0.5) * 255);
      this.data[o + 3] = 255;
    }

    /** Fill the drum with a stretch of earlier recording, so it doesn't start as blank paper. */
    _prefill() {
      const quiet = { bass: 0.15, mid: 0.2, high: 0.12 }, P = { magnitude: 1, rumble: 1, jitter: 1, tremor: 1, spikes: 1 };
      const period = 14, turnsBack = ROWS - 1;
      this.t = -turnsBack * period;
      const span = turnsBack * period;
      for (let q = 0; q < turnsBack * 1.5; q++) {
        if (Math.random() < 0.5) this.quakes.push({ t0: this.t + Math.random() * span, amp: 0.25 + 0.6 * Math.random(), ph: Math.random() * 6.28, dist: 0.7 + Math.random() * 0.8 });
      }
      for (let q = 0; q < turnsBack * 3; q++) this.tremors.push({ t0: this.t + Math.random() * span, amp: 0.2 + 0.3 * Math.random(), f: 3 + Math.random() * 3, ph: Math.random() * 6.28 });
      for (let q = 0; q < turnsBack * 10; q++) this.spikes.push({ t0: this.t + Math.random() * span, amp: 0.3 + 0.5 * Math.random(), ph: Math.random() * 6.28 });
      const v = [0, 0, 0];
      for (let i = 0; i < turnsBack * W; i++) {
        this._signal(this.t + (i / W) * period, quiet, P, v);
        this._write(Math.floor(i / W) % ROWS, i % W, v);
      }
      this.turns = turnsBack;
      this.row = turnsBack % ROWS;
      this.t = 0;
      this.quakes = []; this.tremors = []; this.spikes = [];
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, ROWS, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }

    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const gl = this.gl;
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      this.t += dt;
      const hit = this.trig.update(audio.kick);
      if (hit) this.quakes.push({ t0: this.t, amp: 0.35 + 0.65 * hit, ph: Math.random() * 6.28, dist: 0.7 + Math.random() * 0.8 });
      if (audio.midOnset) this.tremors.push({ t0: this.t, amp: 0.25 + 0.45 * audio.midPulse, f: 3 + Math.random() * 3, ph: Math.random() * 6.28 });
      if (audio.highOnset) this.spikes.push({ t0: this.t, amp: 0.35 + 0.6 * audio.highPulse, ph: Math.random() * 6.28 });
      this.quakes = this.quakes.filter((q) => this.t - q.t0 < 14);
      this.tremors = this.tremors.filter((q) => this.t - q.t0 < 5);
      this.spikes = this.spikes.filter((q) => this.t - q.t0 < 0.8);

      // The drum turns once every `period` seconds; the pens write W samples per turn.
      const period = 14 / P.speed;
      const prevTurns = this.turns;
      this.turns += dt / period;
      const t0 = this.t - dt;
      const i0 = Math.floor(prevTurns * W), i1 = Math.floor(this.turns * W);
      const v = this.cur;
      for (let i = i0 + 1; i <= i1; i++) {
        const row = Math.floor(i / W) % ROWS;
        if (row !== this.row) {
          // A new turn: clear the row the pens are about to write (it held a turn from long ago).
          this.row = row;
          this.data.fill(0, row * W * 4, (row + 1) * W * 4);
        }
        this._signal(t0 + (i - i0) / Math.max(1, i1 - i0) * dt, audio, P, v);
        this._write(row, i % W, v);
        this.dirtyRows.add(row);
      }
      if (this.dirtyRows.size) {
        gl.bindTexture(gl.TEXTURE_2D, this.tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        for (const r of this.dirtyRows) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.data, r * W * 4);
        gl.bindTexture(gl.TEXTURE_2D, null);
        this.dirtyRows.clear();
      }

      // The pens ride the helix, one row per turn, each over its own lane.
      const frac = this.turns - Math.floor(this.turns);
      const rowX = X0 + (this.row + frac + 0.5) * ROW_H;
      const rot = this.turns * Math.PI * 2;

      // Camera: in front of and above the pens, panning along the drum with them.
      if (this.camX === null) this.camX = rowX;
      this.camX += (rowX - this.camX) * (1 - Math.exp(-dt / 2.5));
      const sway = 0.25 * Math.sin(u.time * 0.05);
      const eye = [this.camX + 0.8 + sway, 1.3 * P.distance, 2.75 * P.distance];
      const look = [this.camX - 0.1, 0.35, 0.85];
      const f = norm([look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]]);
      const r = norm(cross(f, [0, 1, 0]));
      const up = cross(r, f);
      const project = (q) => {
        const d = [q[0] - eye[0], q[1] - eye[1], q[2] - eye[2]];
        const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
        return [(d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) * 1.4 / z, (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) * 1.4 / z];
      };
      for (let k = 0; k < 3; k++) {
        const x = rowX + (LANES[k] + v[k] * AMP) * ROW_H;
        const tip = project([x, DRUM_R * Math.cos(PEN_ANGLE), DRUM_R * Math.sin(PEN_ANGLE)]);
        const base = project([rowX + LANES[k] * ROW_H * 1.6 + 0.3, 1.85, 0.95]);   // holders above the drum
        this.tips.set(tip, k * 2);
        this.bases.set(base, k * 2);
      }

      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.tex('uTrace', this.tex)
        .f3('uEye', ...eye).f3('uFwd', ...f).f3('uRight', ...r).f3('uUp', ...up)
        .f('uRot', rot + PEN_ANGLE)
        .f2v('uPenTip', this.tips).f2v('uPenBase', this.bases);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); this.gl.deleteTexture(this.tex); }
  }

  VIZ.registerScene({
    id: 'seismo',
    name: 'Seismograph',
    blurb: 'A three-pen helicorder: black ink for quakes on the kicks, red for volcanic tremor in the mids, blue for micro-quake spikes on the highs.',
    params: [
      { key: 'magnitude', label: 'Quake size on kicks (black)', min: 0.2, max: 2, step: 0.05, value: 1 },
      { key: 'tremor', label: 'Tremor in the mids (red)', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'spikes', label: 'Micro-quakes on highs (blue)', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'rumble', label: 'Bass rumble', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'jitter', label: 'High-frequency noise', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'speed', label: 'Drum speed', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'distance', label: 'Camera distance', min: 0.7, max: 1.6, step: 0.05, value: 1 },
    ],
    create: (ctx) => new SeismoScene(ctx),
  });
})();
