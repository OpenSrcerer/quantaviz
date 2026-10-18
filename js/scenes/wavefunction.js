/* wavefunction.js — Wavefunction.
 * A real-time 2D Schrödinger equation (hbar = m = 1) integrated on the GPU with the Visscher
 * leapfrog scheme: psi = R + iI lives in an RGBA16F texture (R in .r, I in .g, the potential V in
 * .b), and every substep is two fullscreen passes
 *     R += dt * H(I)        then        I -= dt * H(R)
 * with H phi = -1/2 laplacian(phi) + V phi.  The potential is rebuilt once per frame from the music:
 *   - a ring barrier whose height around the ring follows the spectrum (a crystalline ring the wave
 *     has to tunnel through — mirrored 4-fold so bass sits left/right and treble top/bottom),
 *   - a central well that deepens with the bass,
 *   - a well under the pointer while it is pressed.
 * Beats inject Gaussian wave packets (momentum e^{ik.x}); the app shows |psi|^2 as brightness and
 * arg(psi) as colour, with a cel-shaded / inked look.
 *
 * The physics is resolution independent: the domain is 256 physical units wide, and a grid of
 * n cells has spacing 256/n, so packet size, wave speed and the shape of the potential look the
 * same at every grid size (finer grids just cost more substeps).
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const MIN_VIEW = 0.78;      // smallest visible grid extent on the short screen axis (keeps the whole ring in frame)
  const MAX_SUBSTEPS = 48;    // hard cap on leapfrog substeps per frame
  const DT_REF = 0.12;        // time step at the reference 256 grid
  const MAX_PACKETS = 3;      // packets injected per frame (uniform array size in the shader)

  /* ---------------------------------------------------------------- */
  /* shared potential (used by the inject pass and by the drawing pass) */
  /* ---------------------------------------------------------------- */
  const POT = `
uniform float uBarrier;
uniform vec2  uPtr;      // pointer in grid uv (y up)
uniform float uPtrOn;    // 0..1, eased
const float RING_R = 0.33;
float sq(float x) { return x * x; }
// Spectrum coordinate around the ring: triangle wave, bass on the +-x axis, treble on the +-y axis.
float ringT(vec2 p) {
  float a = atan(p.y, p.x + 1.0e-6) * 0.15915494;
  return abs(fract(a * 2.0 + 0.5) * 2.0 - 1.0) * 0.85;
}
float barrierAmp(vec2 p) {
  float b = band(ringT(p));
  return uBarrier * (0.03 + 0.97 * pow(b, 1.25));
}
float potential(vec2 p) {
  float r2 = dot(p, p);
  float r = sqrt(r2);
  float v = barrierAmp(p) * exp(-sq((r - RING_R) / 0.025));
  v -= 0.6 * uBass * exp(-r2 / 0.0144);
  vec2 dp = p - (uPtr - 0.5);
  v -= 0.8 * uPtrOn * exp(-dot(dp, dp) / 0.0036);
  return clamp(v, -1.0, 1.5);
}
`;

  /* ---------------------------------------------------------------- */
  /* leapfrog half-step (phase 0: R from I, phase 1: I from R)          */
  /* ---------------------------------------------------------------- */
  const STEP_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uState;
uniform float uN;
uniform float uS2;     // (n/256)^2 : laplacian scale so physics is independent of grid size
uniform float uDt;
uniform float uDamp;   // dt / 0.12 : keeps absorption time-based
uniform int uPhase;

vec2 fetchPsi(ivec2 q, int hi) {
  return texelFetch(uState, clamp(q, ivec2(0), ivec2(hi)), 0).rg;
}

void main() {
  int n = int(uN + 0.5);
  int hi = n - 1;
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uState, ip, 0);
  vec2 psi = c.rg;
  vec2 lap = fetchPsi(ip + ivec2(-1, 0), hi) + fetchPsi(ip + ivec2(1, 0), hi)
           + fetchPsi(ip + ivec2(0, -1), hi) + fetchPsi(ip + ivec2(0, 1), hi) - 4.0 * psi;
  vec2 h = -0.5 * uS2 * lap + c.b * psi;       // (H R, H I)
  if (uPhase == 0) {
    psi.x += uDt * h.y;                          // R_new = R + dt H(I)
  } else {
    psi.y -= uDt * h.x;                          // I_new = I - dt H(R_new)
  }
  // Absorbing boundary: outer 8% of the grid.
  vec2 uv = (vec2(ip) + 0.5) / uN;
  vec2 e2 = min(uv, 1.0 - uv);
  float e = clamp(1.0 - min(e2.x, e2.y) / 0.08, 0.0, 1.0);
  psi *= 1.0 - (0.08 * e * e + 0.00002) * uDamp;
  if (!(abs(psi.x) < 1000.0 && abs(psi.y) < 1000.0)) psi = vec2(0.0);   // NaN / blow-up guard
  fragColor = vec4(psi, c.b, 1.0);
}`;

  /* ---------------------------------------------------------------- */
  /* once per frame: rebuild V, optionally inject packets / boost psi    */
  /* ---------------------------------------------------------------- */
  const INJECT_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${POT}
uniform sampler2D uState;
uniform float uN;
uniform float uKeep;           // 0.75 on injection frames, else 1.0
uniform int uPkCount;
uniform vec4 uPkA[3];          // xy = centre (grid uv), z = amplitude, w = sigma (physical units)
uniform vec2 uPkK[3];          // wave vector (rad per physical unit)
uniform vec2 uKick;            // phase gradient from window motion (rad per physical unit)

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uState, ip, 0);
  vec2 uv = (vec2(ip) + 0.5) / uN;
  vec2 p = uv - 0.5;
  vec2 psi = c.rg * uKeep;

  // Galilean boost: the wave sloshes opposite to the window motion.
  float kp = dot(uKick, p * 256.0);
  float ck = cos(kp);
  float sk = sin(kp);
  psi = vec2(psi.x * ck - psi.y * sk, psi.x * sk + psi.y * ck);

  for (int i = 0; i < 3; i++) {
    if (i >= uPkCount) break;
    vec4 a = uPkA[i];
    vec2 d = (uv - a.xy) * 256.0;
    float g = a.z * exp(-dot(d, d) / (2.0 * a.w * a.w));
    float ph = dot(uPkK[i], d);
    psi += g * vec2(cos(ph), sin(ph));
  }

  float V = potential(p);
  if (!(abs(psi.x) < 1000.0 && abs(psi.y) < 1000.0)) psi = vec2(0.0);
  if (!(abs(V) < 10.0)) V = 0.0;
  fragColor = vec4(psi, V, 1.0);
}`;

  /* ---------------------------------------------------------------- */
  /* final image                                                        */
  /* ---------------------------------------------------------------- */
  const DRAW_FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${POT}
uniform sampler2D uState;
uniform float uN;
uniform vec2 uView;        // visible extent in grid-uv units (screen uv 0..1 -> grid uv)
uniform float uContours;

// Cubic B-spline reconstruction of (R, I) with 4 bilinear fetches: smooth contour lines.
vec2 cubicPsi(vec2 uv) {
  vec2 sz = vec2(uN);
  vec2 c = uv * sz - 0.5;
  vec2 i = floor(c);
  vec2 f = c - i;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1;
  vec2 g1 = w2 + w3;
  vec2 p0 = (i - 1.0 + w1 / g0 + 0.5) / sz;
  vec2 p1 = (i + 1.0 + w3 / g1 + 0.5) / sz;
  vec2 ta = texture(uState, vec2(p0.x, p0.y)).rg;
  vec2 tb = texture(uState, vec2(p1.x, p0.y)).rg;
  vec2 td = texture(uState, vec2(p0.x, p1.y)).rg;
  vec2 te = texture(uState, vec2(p1.x, p1.y)).rg;
  return mix(mix(te, td, g0.x), mix(tb, ta, g0.x), g0.y);
}

void main() {
  vec2 g = 0.5 + (vUv - 0.5) * uView;      // grid uv
  vec2 p = g - 0.5;
  float dEdge = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
  float inside = smoothstep(0.0, 0.07, dEdge);

  vec2 psi = cubicPsi(g) * inside;
  float prob = dot(psi, psi);
  float amp = sqrt(prob);
  float phase = prob > 1.0e-9 ? atan(psi.y, psi.x) : 0.0;

  // Colour from phase (triangle wave so the hue wheel has no seam), brightness from |psi|.
  float hh = abs(fract(phase * 0.15915494 + 0.1 * uTime) * 2.0 - 1.0);
  vec3 hue = palette(0.28 + 0.72 * hh);

  float tv = 1.0 - exp(-1.3 * amp);
  float x = tv * 5.0;                              // five cel-shading steps
  float fw = max(fwidth(x), 1.0e-4);
  float fl = floor(x);
  float fr = x - fl;
  float st = fl + smoothstep(1.0 - min(1.5 * fw, 0.5), 1.0, fr);
  float level = mix(tv, (st + 0.5) / 5.0, uContours);
  float B = 0.07 + 2.75 * pow(level, 1.7);         // fresh packet peaks ~2 -> blooms
  float presence = smoothstep(0.015, 0.05, amp);

  // Ink lines at the step boundaries and a soft outline where |psi| crosses a low threshold.
  float nb = floor(x + 0.5);
  float lm = step(1.0, nb) * (1.0 - step(5.0, nb));
  float lineStep = (1.0 - smoothstep(0.6, 1.6, abs(x - nb) / fw)) * lm;
  float fa = max(fwidth(amp), 1.0e-5);
  float lowLine = 1.0 - smoothstep(1.0, 3.0, abs(amp - 0.045) / fa);

  // Background + bass pool.
  vec3 col = palette(0.05) * 0.15;
  float r2 = dot(p, p);
  float pool = exp(-r2 / 0.0144) * uBass;
  col *= 1.0 - 0.45 * pool;

  vec3 wcol = hue * (B * presence);
  wcol *= 1.0 - 0.9 * uContours * lineStep;
  col += wcol;
  col *= 1.0 - 0.6 * uContours * lowLine;

  // Topographic contours of the bass well (faint).
  float pl = pool * 4.0;
  float pd = abs(pl - floor(pl + 0.5)) / max(fwidth(pl), 1.0e-4);
  float pline = (1.0 - smoothstep(0.6, 1.6, pd)) * step(0.5, pl);
  col += palette(0.55) * pline * 0.06;

  // Crystalline ring ridge, brightness driven by the same spectrum that shapes the barrier.
  float xr = sqrt(r2) - RING_R;
  float bn = pow(band(ringT(p)), 3.0);
  float facet = 0.7 + 0.6 * abs(fract(atan(p.y, p.x + 1.0e-6) * 6.3661977) - 0.5);
  float glow = exp(-sq(xr / 0.025)) * (0.015 + 0.3 * bn);
  float core = exp(-sq(xr / 0.005)) * (0.03 + 1.2 * bn) * facet;
  col += palette(0.9) * (glow + core) * min(uBarrier, 1.5) * (0.8 + 0.6 * uPulse);

  // Pointer well marker.
  vec2 pp = p - (uPtr - 0.5);
  col += palette(0.7) * exp(-sq((length(pp) - 0.05) / 0.004)) * uPtrOn * 0.5;

  col *= 0.5 + 0.7 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  /* ---------------------------------------------------------------- */

  // Visible extent of the grid on screen: "cover" scaling, but never zoomed in so far that the
  // ring is cropped on the short axis (on wide screens the grid then no longer reaches the
  // left/right edges; its borders are faded out so no seam shows).
  function viewExtent(w, h) {
    const aspect = w / Math.max(1, h);
    let vx, vy;
    if (aspect >= 1) { vy = Math.max(1 / aspect, MIN_VIEW); vx = vy * aspect; }
    else { vx = Math.max(aspect, MIN_VIEW); vy = vx / aspect; }
    return [vx, vy];
  }

  class WavefunctionScene {
    constructor(ctx) {
      if (!VIZ.caps || !VIZ.caps.floatFBO) throw new Error('Wavefunction needs float render targets');
      this.ctx = ctx;
      this.gl = ctx.gl;
      this.stepProg = null; this.injectProg = null; this.drawProg = null;
      try {
        this.stepProg = ctx.fsProgram(STEP_FS, 'wavefunction-step');
        this.injectProg = ctx.fsProgram(INJECT_FS, 'wavefunction-inject');
        this.drawProg = ctx.fsProgram(DRAW_FS, 'wavefunction-draw');
      } catch (e) {
        if (this.stepProg) this.stepProg.dispose();
        if (this.injectProg) this.injectProg.dispose();
        throw e;
      }
      this.rt = null;
      this.n = 0;
      this.cur = 0;
      this.acc = 0;
      this.pending = 2;
      this.lastEvent = null;
      this.ptrAmt = 0;
      this.pkA = new Float32Array(MAX_PACKETS * 4);
      this.pkK = new Float32Array(MAX_PACKETS * 2);
      this.pkCount = 0;
      this.counter = 0;
      this.lastAng = Math.random() * Math.PI * 2;
    }

    resize() { /* the simulation grid is independent of the screen size */ }

    freeTargets() {
      if (this.rt) this.rt.forEach((t) => t.dispose());
      this.rt = null;
    }

    allocate(n, now) {
      const gl = this.gl;
      this.freeTargets();
      this.rt = [0, 1].map(() => this.ctx.createTarget(n, n, { hdr: true, filter: gl.LINEAR, wrap: gl.CLAMP_TO_EDGE }));
      for (const t of this.rt) { t.bind(); t.clear(0, 0, 0, 1); }
      this.n = n;
      this.cur = 0;
      this.acc = 0;
      this.pending = 2;       // two packets at scene start
      this.lastEvent = now;
      this.ptrAmt = 0;
    }

    /** Queue one packet in the uniform arrays. Every third one is born inside the ring, moving outward. */
    addPacket(amp) {
      if (this.pkCount >= MAX_PACKETS) return;
      const i = this.pkCount++;
      this.counter++;
      const inner = this.counter % 3 === 0;
      this.lastAng += Math.PI * (0.45 + 1.1 * Math.random());
      const ang = this.lastAng;
      const rad = inner ? 0.16 + 0.05 * Math.random() : 0.38;
      const k = 0.55 + 0.45 * Math.random();
      const dir = inner ? ang + (Math.random() - 0.5) * 1.2 : ang + Math.PI + (Math.random() - 0.5) * 0.3;
      const o = i * 4;
      this.pkA[o] = 0.5 + rad * Math.cos(ang);
      this.pkA[o + 1] = 0.5 + rad * Math.sin(ang);
      this.pkA[o + 2] = amp;
      this.pkA[o + 3] = 8.5 * (0.9 + 0.3 * Math.random());
      this.pkK[i * 2] = k * Math.cos(dir);
      this.pkK[i * 2 + 1] = k * Math.sin(dir);
    }

    render(target, audio, u) {
      const gl = this.gl, ctx = this.ctx;
      const P = u.params || {};
      const num = (key, d) => { const v = P[key]; return typeof v === 'number' && isFinite(v) ? v : d; };
      const maxN = Math.min(1024, (ctx.caps && ctx.caps.maxTex) || 1024);
      const n = clamp(Math.round(num('grid', 256) / 16) * 16, 64, maxN);
      const speed = clamp(num('speed', 8), 2, 16);
      const barrier = clamp(num('barrier', 1), 0, 2);
      const packets = clamp(num('packets', 1), 0, 2);
      const contours = clamp(num('contours', 0.7), 0, 1);
      const now = u.time;
      const dtf = clamp(u.dt || 1 / 60, 0.002, 0.05);

      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      if (!this.rt || n !== this.n) this.allocate(n, now);

      /* ---- decide what to inject this frame ---- */
      this.pkCount = 0;
      if (packets > 0.02) {
        let wanted = 0;
        let strength = 0.6;
        if (this.pending > 0) { wanted = this.pending; this.pending = 0; this.lastEvent = now; }
        if (audio.onset) {
          wanted = Math.max(wanted, packets < 1.5 ? 1 : 2);
          strength = clamp(audio.beat, 0.4, 1);
          this.lastEvent = now;
        } else if (wanted === 0 && now - this.lastEvent > 4.0) {
          wanted = 1; strength = 0.4; this.lastEvent = now;      // never let the scene go empty
        }
        const amp = (0.95 + 0.7 * strength) * clamp(packets, 0.2, 2) * (wanted > 1 && packets >= 1.5 ? 0.75 : 1);
        for (let i = 0; i < wanted; i++) this.addPacket(amp);
      }
      const keep = this.pkCount > 0 ? 0.75 : 1.0;

      /* ---- window motion -> phase gradient, pointer -> grid coordinates ---- */
      const m = u.motion || {};
      let kx = 0, ky = 0;
      if (Math.hypot(m.vx || 0, m.vy || 0) > 40) {
        const f = dtf * 60 * 4e-5;
        kx = clamp(-(m.vx || 0) * f, -0.03, 0.03);
        ky = clamp((m.vy || 0) * f, -0.03, 0.03);
      }
      const view = viewExtent(u.width, u.height);
      const ptr = u.pointer || { x: 0.5, y: 0.5, down: false };
      const gx = 0.5 + (ptr.x - 0.5) * view[0];
      const gy = 0.5 + (ptr.y - 0.5) * view[1];
      this.ptrAmt += ((ptr.down ? 1 : 0) - this.ptrAmt) * (1 - Math.exp(-dtf / 0.1));
      if (!ptr.down && this.ptrAmt < 0.002) this.ptrAmt = 0;

      /* ---- inject pass: V(x,y) from the audio, packets, window kick ---- */
      const ip = this.injectProg.use();
      ctx.setCommon(ip, audio, u);
      ip.f('uN', n).f('uKeep', keep).i('uPkCount', this.pkCount)
        .f('uBarrier', barrier).f2('uPtr', gx, gy).f('uPtrOn', this.ptrAmt)
        .f2('uKick', kx, ky).i('uState', 2);
      const locA = ip.loc('uPkA');
      if (locA) gl.uniform4fv(locA, this.pkA);
      ip.f2v('uPkK', this.pkK);
      gl.activeTexture(gl.TEXTURE0 + 2);
      gl.bindTexture(gl.TEXTURE_2D, this.rt[this.cur].tex);
      this.rt[1 - this.cur].bind();
      ctx.drawQuad();
      this.cur = 1 - this.cur;

      /* ---- Schrödinger leapfrog substeps ---- */
      const s = n / 256;
      const s2 = s * s;
      const dt = Math.min(DT_REF, 0.66 / (4 * s2 + 1.5));      // dt * (4 s^2 + Vmax) stays well below 2
      this.acc += (speed * DT_REF * 60 * dtf) / dt;              // constant physical time per second
      let steps = Math.floor(this.acc);
      this.acc -= steps;
      if (steps > MAX_SUBSTEPS) { steps = MAX_SUBSTEPS; this.acc = 0; }
      if (steps > 0) {
        const sp = this.stepProg.use();
        sp.f('uN', n).f('uS2', s2).f('uDt', dt).f('uDamp', dt / DT_REF).i('uState', 2);
        gl.activeTexture(gl.TEXTURE0 + 2);
        for (let i = 0; i < steps; i++) {
          for (let ph = 0; ph < 2; ph++) {
            gl.bindTexture(gl.TEXTURE_2D, this.rt[this.cur].tex);
            this.rt[1 - this.cur].bind();
            sp.i('uPhase', ph);
            ctx.drawQuad();
            this.cur = 1 - this.cur;
          }
        }
      }

      /* ---- draw ---- */
      target.bind();
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      const dp = this.drawProg.use();
      ctx.setCommon(dp, audio, u);
      dp.f('uN', n).f2('uView', view[0], view[1]).f('uContours', contours)
        .f('uBarrier', barrier).f2('uPtr', gx, gy).f('uPtrOn', this.ptrAmt).i('uState', 2);
      gl.activeTexture(gl.TEXTURE0 + 2);
      gl.bindTexture(gl.TEXTURE_2D, this.rt[this.cur].tex);
      ctx.drawQuad();

      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindVertexArray(null);
    }

    dispose() {
      this.freeTargets();
      if (this.stepProg) this.stepProg.dispose();
      if (this.injectProg) this.injectProg.dispose();
      if (this.drawProg) this.drawProg.dispose();
      this.stepProg = this.injectProg = this.drawProg = null;
    }
  }

  VIZ.registerScene({
    id: 'wavefunction',
    name: 'Wavefunction',
    blurb: 'A live Schrödinger equation: beats fire quantum wave packets that must tunnel through a ring shaped by the spectrum. Drag to attract the wave.',
    params: [
      { key: 'grid', label: 'Grid resolution', min: 128, max: 512, step: 64, value: 256, fmt: (v) => v + ' × ' + v },
      { key: 'speed', label: 'Time flow (substeps)', min: 2, max: 16, step: 1, value: 8, fmt: (v) => String(Math.round(v)) },
      { key: 'barrier', label: 'Spectrum barrier', min: 0, max: 2, step: 0.01, value: 1 },
      { key: 'packets', label: 'Wave packets', min: 0, max: 2, step: 0.01, value: 1 },
      { key: 'contours', label: 'Cartoon contours', min: 0, max: 1, step: 0.01, value: 0.7 },
    ],
    create: (ctx) => new WavefunctionScene(ctx),
  });
})();
