/* reaction.js — Reaction–Diffusion.
 * A Belousov–Zhabotinsky-style excitable medium in a petri dish, using Barkley's model
 *     du/dt = u (1 - u) (u - (v + b) / a) / eps + laplacian(u),     dv/dt = u - v
 * u is the excitation (the bright wave front), v the refractory chemistry behind it. Broken wave
 * fronts curl up into rotating spiral waves, the BZ reaction's signature, which keep turning and
 * colliding forever. Simulated on the GPU (ping-pong float textures, several substeps a frame);
 * the camera pans and zooms slowly over the dish.
 *   bass  -> kicks drop a catalyst bead (an expanding ring) and, every other kick, scratch a line
 *            through the waves so new spiral pairs are born
 *   mids  -> excitability: louder mids lower the threshold, waves grow fatter and faster
 *   highs -> sparks of excitation, tiny new wave sources
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const N = 384;
  const NST = 6;
  const H = 0.42;

  const SIM = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
#define NST ${NST}
uniform sampler2D uS;
uniform vec2 uTexel;
uniform float uDt;
uniform float uA;
uniform float uB;
uniform float uEps;
uniform vec4 uStim[NST];     // x, y (uv), radius, kind (1 excite, -1 erase, 0 none)
uniform vec2 uStimB[NST];    // capsule end (erase lines)
uniform int uInit;
const float H = ${H.toFixed(3)};
float capsule(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0); return length(pa - ba * h); }
void main() {
  vec2 s = texture(uS, vUv).xy;
  float dish = length(vUv - 0.5);
  if (uInit == 1) {
    // A broken wave: it curls into a spiral pair straight away.
    float u = step(abs(vUv.x - 0.5), 0.012) * step(0.5, vUv.y);
    float v = step(abs(vUv.x - 0.47), 0.02) * step(0.5, vUv.y) * 0.6;
    float u2 = step(abs(vUv.y - 0.3), 0.012) * step(vUv.x, 0.45);
    float v2 = step(abs(vUv.y - 0.33), 0.02) * step(vUv.x, 0.45) * 0.6;
    fragColor = vec4(max(u, u2), max(v, v2), 0.0, 1.0);
    return;
  }
  float u = s.x, v = s.y;
  float lap = (texture(uS, vUv + vec2(uTexel.x, 0.0)).x + texture(uS, vUv - vec2(uTexel.x, 0.0)).x +
               texture(uS, vUv + vec2(0.0, uTexel.y)).x + texture(uS, vUv - vec2(0.0, uTexel.y)).x - 4.0 * u) / (H * H);
  float uth = (v + uB) / uA;
  u += uDt * (u * (1.0 - u) * (u - uth) / uEps + lap);
  v += uDt * (u - v);
  for (int i = 0; i < NST; i++) {
    vec4 st = uStim[i];
    if (st.w == 0.0) continue;
    if (st.w > 0.0) { if (length(vUv - st.xy) < st.z) u = 1.0; }
    else if (capsule(vUv, st.xy, uStimB[i]) < st.z) { u = 0.0; v = 0.0; }
  }
  if (dish > 0.49) { u = 0.0; v = 0.0; }
  fragColor = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 2.0), 0.0, 1.0);
}`;

  const DRAW = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
uniform sampler2D uS;
uniform vec2 uCenter;
uniform float uZoom;
uniform float uRot;
uniform vec2 uTexel;
void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float c = cos(uRot), s = sin(uRot);
  vec2 q = uCenter + mat2(c, -s, s, c) * p * uZoom;
  vec3 col = palette(0.0) * 0.05;
  float dish = length(q - 0.5);
  if (dish < 0.5) {
    vec2 st = texture(uS, q).xy;
    float u = st.x, v = st.y;
    // Relief from the excitation gradient: the gel looks embossed.
    float ux = texture(uS, q + vec2(uTexel.x, 0.0)).x - texture(uS, q - vec2(uTexel.x, 0.0)).x;
    float uy = texture(uS, q + vec2(0.0, uTexel.y)).x - texture(uS, q - vec2(0.0, uTexel.y)).x;
    vec3 n = normalize(vec3(-ux, -uy, 0.6));
    float lit = 0.6 + 0.6 * max(dot(n, normalize(vec3(-0.5, 0.6, 0.6))), 0.0);
    vec3 gel = mix(palette(0.0) * 0.5 + 0.01, palette(0.45) * 0.8, smoothstep(0.0, 0.8, v));
    gel = mix(gel, palette(0.95) * (1.2 + 1.5 * uMid), smoothstep(0.2, 0.9, u));
    col = gel * lit;
    col += vec3(1.0) * pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), n), normalize(vec3(-0.5, 0.6, 0.6))), 0.0), 40.0) * 0.3;
    // The dish wall.
    col = mix(col, vec3(0.5, 0.6, 0.7) * 0.4, smoothstep(0.47, 0.5, dish));
    col += vec3(0.7, 0.8, 1.0) * exp(-pow((dish - 0.485) / 0.004, 2.0)) * 0.3;
  }
  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class ReactionScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.sim = ctx.fsProgram(SIM, 'reaction-sim');
      this.draw = ctx.fsProgram(DRAW, 'reaction-draw');
      this.rt = [0, 1].map(() => ctx.createTarget(N, N, { hdr: true, filter: gl.LINEAR }));
      this.cur = 0;
      this.trig = new VIZ.KickTrigger(0.35);
      this.stim = new Float32Array(NST * 4);
      this.stimB = new Float32Array(NST * 2);
      this.nextS = 0;
      this.kicks = 0;
      this.init = true;
      this.acc = 0;
      if (!this.rt[0].hdr) throw new Error('needs float render targets');
    }
    _stim(kind, x, y, r, bx, by) {
      const i = this.nextS;
      this.nextS = (this.nextS + 1) % NST;
      this.stim.set([x, y, r, kind], i * 4);
      this.stimB.set([bx === undefined ? x : bx, by === undefined ? y : by], i * 2);
    }
    _inDish() {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.38;
      return [0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r];
    }
    resize() { /* fixed grid */ }
    render(target, audio, u) {
      const gl = this.gl, ctx = this.ctx;
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const hit = this.trig.update(audio.kick);
      if (hit && P.kicks > 0) {
        this.kicks++;
        const [x, y] = this._inDish();
        if (this.kicks % 2 === 0) {
          const a = Math.random() * Math.PI, l = 0.08 + 0.12 * hit;
          this._stim(-1, x, y, 0.012, x + Math.cos(a) * l, y + Math.sin(a) * l);
        } else {
          this._stim(1, x, y, (0.008 + 0.012 * hit) * P.kicks);
        }
      }
      if (audio.highOnset && Math.random() < 0.6 * P.sparks) { const [x, y] = this._inDish(); this._stim(1, x, y, 0.004); }
      // Substeps scale with real time so the chemistry runs at the same pace at any frame rate.
      this.acc += dt * 60 * 7 * P.speed;
      const steps = Math.min(16, Math.floor(this.acc));
      this.acc = Math.min(this.acc - steps, 2);   // never build up a backlog
      const b = 0.07 - 0.04 * Math.min(1, audio.mid * 1.2) * P.excite;
      gl.disable(gl.BLEND);
      for (let i = 0; i < Math.max(steps, this.init ? 1 : 0); i++) {
        const src = this.rt[this.cur], dst = this.rt[1 - this.cur];
        dst.bind();
        const sp = this.sim.use();
        sp.tex('uS', src.tex).f2('uTexel', 1 / N, 1 / N).f('uDt', 0.014).f('uA', 0.75).f('uB', b).f('uEps', 0.02)
          .f4v('uStim', this.stim).f2v('uStimB', this.stimB).i('uInit', this.init ? 1 : 0);
        ctx.drawQuad();
        this.cur = 1 - this.cur;
        this.init = false;
        if (i === 0) this.stim.fill(0);   // stimuli apply once
      }
      target.bind();
      const t = u.time;
      const zoom = (0.85 + 0.25 * Math.sin(t * 0.04)) / P.zoom * (u.width < u.height ? 1.0 : 1.12);
      const p = this.draw.use();
      ctx.setCommon(p, audio, u);
      p.tex('uS', this.rt[this.cur].tex).f2('uCenter', 0.5 + 0.08 * Math.sin(t * 0.031), 0.5 + 0.08 * Math.cos(t * 0.027))
        .f('uZoom', zoom).f('uRot', t * 0.015).f2('uTexel', 1 / N, 1 / N);
      ctx.drawQuad();
    }
    dispose() { this.sim.dispose(); this.draw.dispose(); this.rt.forEach((r) => r.dispose()); }
  }

  VIZ.registerScene({
    id: 'reaction',
    name: 'Reaction–Diffusion',
    blurb: 'Spiral chemical waves in a petri dish (the BZ reaction). Kicks drop catalyst and scratch new spirals into being; the mids make the medium more excitable.',
    params: [
      { key: 'speed', label: 'Reaction speed', min: 0.2, max: 2, step: 0.05, value: 1 },
      { key: 'kicks', label: 'Catalyst on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'excite', label: 'Excitability from mids', min: 0, max: 1.5, step: 0.05, value: 1 },
      { key: 'sparks', label: 'Sparks on highs', min: 0, max: 1.5, step: 0.05, value: 1 },
      { key: 'zoom', label: 'Zoom', min: 0.7, max: 2.5, step: 0.05, value: 1 },
    ],
    create: (ctx) => new ReactionScene(ctx),
  });
})();
