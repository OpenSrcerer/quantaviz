/* plasma.js — Plasma Globe.
 * The novelty lamp: a high-voltage electrode ball inside a glass sphere of low-pressure noble
 * gas. Ionised channels run from all over the electrode's surface out to the glass as smooth,
 * gently curving strings, each with a thin hot core inside a soft glowing sheath, splitting into
 * finer tendrils as they reach the glass. They drift and lean as the hot gas convects, shimmer,
 * fade and are replaced, and they gather where you touch the glass (hold the mouse on it). The
 * whole globe is filled with a faint plasma haze, densest round the electrode.
 * Each filament is a polar curve (its angle varies smoothly with radius), so a pixel only has to
 * check each filament once.
 *   mids  -> the filaments: each one is a mid band, brighter when its band is loud; the gas glow
 *   bass  -> the bass speeds everything up (sway, drift, jumps, turnover); kicks surge the
 *            voltage: everything flares, and a few fresh filaments leap out
 *   highs -> a fast shimmer on the filaments and sparkles where they meet the glass
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const NF = 14;
  const TAU = Math.PI * 2;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define NF ${NF}
uniform vec4 uFilA[NF];   // root angle (on the electrode), tip angle (on the glass), tip radius, seed
uniform vec2 uFilB[NF];   // brightness (lifecycle * depth), band 0..1
uniform float uR;
uniform float uBurst;
uniform float uClock;     // motion clock: runs faster with the bass
const float TAU = 6.2831853;
const float RE = 0.14;    // electrode radius, in globe radii

float adiff(float a, float b) { return mod(a - b + 3.14159265, TAU) - 3.14159265; }

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  p.y -= 0.03;
  float px = 1.0 / uRes.y;
  float R = uR;
  float r = length(p);
  float rn = r / R;
  float phi = atan(p.y, p.x);
  vec3 col = mix(palette(0.0) * 0.1, palette(0.0) * 0.02, vUv.y);

  // The stand.
  float base = step(p.y, -R * 0.92) * (1.0 - smoothstep(R * 0.42, R * 0.45, abs(p.x) + (p.y + R) * 0.4)) * step(-R * 1.25, p.y);
  col = mix(col, palette(0.0) * 0.2 + 0.02 + palette(0.6) * 0.06 * uBurst, base);

  if (rn < 1.0) {
    vec3 glow = vec3(0.0);
    // Plasma haze: the ionised gas glows faintly everywhere, more round the electrode.
    float haze = fbm2(p / R * 2.5 + vec2(uClock * 0.05, -uClock * 0.04));
    glow += palette(0.55) * (0.015 + 0.035 * haze * haze) * (1.0 - rn * 0.6) * (0.5 + 0.9 * uMid + 0.8 * uBurst);
    glow += palette(0.6) * exp(-(rn - RE) / 0.12) * 0.12 * (0.6 + uMid + uBurst) * step(RE, rn);

    for (int i = 0; i < NF; i++) {
      vec4 a = uFilA[i];
      vec2 b = uFilB[i];
      if (b.x <= 0.002) continue;
      float tipR = a.z;
      float s = (rn - RE) / (tipR - RE);          // 0 at the electrode .. 1 at the glass
      if (s < -0.02 || s > 1.03) continue;
      float sc = clamp(s, 0.0, 1.0);
      float seed = a.w;
      // A smooth string: eased from root angle to tip angle, plus a slow, gentle sway.
      float ease = sc * sc * (3.0 - 2.0 * sc);
      float th = a.x + adiff(a.y, a.x) * ease;
      float sway = (noise2(vec2(sc * 1.8 + uClock * 0.45, seed)) - 0.5) * 0.35 * sin(3.14159 * sc);
      th += sway / max(rn, 0.2);
      float d = r * adiff(phi, th);
      float e = bandMid(b.y);
      float shimmer = 0.8 + 0.2 * noise2(vec2(uTime * 22.0, seed)) + (uHigh * 0.5 + uHighPulse) * (noise2(vec2(sc * 12.0, uTime * 30.0 + seed)) - 0.5) * 0.8;
      float lit = b.x * (0.35 + 0.9 * e + 0.8 * uBurst) * shimmer;
      float ends = smoothstep(-0.02, 0.06, s) * (1.0 - smoothstep(0.98, 1.03, s));
      // Core + plasma sheath; the core thins and the sheath widens toward the glass.
      float w = R * (0.0042 - 0.0018 * sc);
      float sheath = R * (0.03 + 0.04 * sc);
      float f = exp(-d * d / (w * w)) + exp(-abs(d) / sheath) * 0.14;
      // Tendrils: near the glass the channel frays into a few finer strands.
      float fray = smoothstep(0.55, 1.0, sc);
      for (int j = -1; j <= 1; j += 2) {
        float off = float(j) * fray * fray * R * (0.035 + 0.03 * fract(seed * 3.7))
                  + (noise2(vec2(sc * 3.0 + uClock * 0.7, seed + float(j) * 5.0)) - 0.5) * fray * R * 0.03;
        float dj = d - off;
        f += exp(-dj * dj / (w * w * 0.45)) * 0.7 * fray;
      }
      vec3 c = mix(vec3(0.95, 0.85, 1.0), palette(0.5 + 0.4 * b.y), 0.35 + 0.45 * sc);
      glow += c * f * ends * lit;
      // Where it touches the glass: a soft bright patch.
      vec2 tip = vec2(cos(a.y), sin(a.y)) * tipR * R;
      float dt2 = dot(p - tip, p - tip);
      glow += palette(0.85) * (exp(-dt2 / (R * R * 0.0012)) * 0.35 + exp(-dt2 / (R * R * 0.01)) * 0.08) * lit * (0.6 + 1.6 * uHighPulse);
      // Where it leaves the electrode: a hot spot on the ball.
      vec2 root = vec2(cos(a.x), sin(a.x)) * RE * R;
      glow += vec3(1.0, 0.9, 1.0) * exp(-dot(p - root, p - root) / (R * R * 0.0006)) * 0.5 * lit;
    }

    // The electrode: a glassy ball, lit from inside.
    float re = rn / RE;
    if (re < 1.0) {
      vec3 n = vec3(p / (R * RE), sqrt(max(0.0, 1.0 - re * re)));
      float rim = pow(1.0 - n.z, 2.0);
      vec3 ball = palette(0.3) * 0.12 + palette(0.7) * rim * 0.6 * (0.6 + uMid + uBurst) + vec3(1.0) * pow(max(dot(n, normalize(vec3(-0.4, 0.5, 0.75))), 0.0), 20.0) * 0.4;
      glow = mix(glow, ball + glow * 0.3, smoothstep(1.0, 0.94, re));
    }
    // Glass: rim reflection and a window highlight.
    glow += vec3(0.6, 0.7, 0.9) * pow(rn, 18.0) * 0.3;
    vec2 hl = p - vec2(-0.35, 0.4) * R;
    glow += vec3(1.0) * exp(-dot(hl, hl) / (R * R * 0.012)) * 0.12;
    col += glow;
  }
  col += vec3(0.5, 0.6, 0.8) * exp(-pow((r - R) / (1.5 * px), 2.0)) * 0.35;
  col *= 0.6 + 0.6 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  class PlasmaScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'plasma');
      this.trig = new VIZ.KickTrigger(0.35);
      this.fil = [];
      for (let i = 0; i < NF; i++) { const f = {}; this._spawn(f, undefined, i); f.age = Math.random() * f.life * 0.8; this.fil.push(f); }
      this.dataA = new Float32Array(NF * 4);
      this.dataB = new Float32Array(NF * 2);
      this.burst = 0;
      this.touch = 0;
      this.clock = 0;
    }
    /** A new filament: a tip on the glass, a root on the electrode somewhere behind it. */
    _spawn(f, near, i) {
      f.tip = near === undefined ? Math.random() * TAU : near + (Math.random() - 0.5) * 0.4;
      f.lean = (Math.random() - 0.5) * 1.6;            // root angle offset: roots are all over the ball
      f.drift = (Math.random() - 0.5) * 0.18;
      f.age = 0;
      // Mostly short and varied, now and then a brief bright strike.
      f.strike = Math.random() < 0.3;
      f.life = f.strike ? 0.15 + Math.random() * 0.35 : 0.6 + Math.pow(Math.random(), 1.6) * 3.5;
      f.goal = f.tip;
      f.seed = Math.random() * 100;
      f.ph = Math.random() * TAU;
      f.band = i === undefined ? Math.random() : i / (NF - 1);
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const asp = u.width / u.height;
      const R = 0.38 * Math.min(1, asp * 0.8);
      const ptx = (u.pointer.x - 0.5) * asp, pty = u.pointer.y - 0.5 - 0.03;
      const inside = Math.hypot(ptx, pty) < R * 1.05;
      this.touch += ((u.pointer.down && inside ? 1 : 0) - this.touch) * (1 - Math.exp(-dt / 0.2));
      const ta = Math.atan2(pty, ptx);
      const hit = this.trig.update(audio.kick);
      if (hit) {
        this.burst = Math.max(this.burst, hit * P.burst);
        // A few of the oldest filaments are replaced by fresh ones leaping out.
        const order = this.fil.map((f, i) => [f.age / f.life, i]).sort((a, b) => b[0] - a[0]);
        for (let k = 0; k < 3; k++) this._spawn(this.fil[order[k][1]], undefined, order[k][1]);
      }
      this.burst *= Math.exp(-dt / 0.25);
      // Bass speeds everything up: the motion clock, the drift, the jumps, the turnover.
      const speed = P.crawl * (1 + 2.5 * audio.bass + 3.5 * this.burst);
      this.clock += dt * speed;
      for (let i = 0; i < NF; i++) {
        const f = this.fil[i];
        f.age += dt * (1 + 1.5 * audio.bass);
        if (f.age > f.life) this._spawn(f, this.touch > 0.3 && i % 2 === 0 ? ta : undefined, i);
        // Now and then a filament whips to a new spot on the glass.
        if (Math.random() < dt * 0.35 * speed) f.goal = f.tip + (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.6);
        f.goal += dt * speed * (f.drift + 0.12 * Math.sin(this.clock * 0.31 + f.ph) + 0.05 * Math.cos(f.goal));
        f.tip += wrapPi(f.goal - f.tip) * (1 - Math.exp(-dt / 0.09));
        if (this.touch > 0.01 && i % 2 === 0) { f.goal += wrapPi(ta - f.goal) * this.touch * (1 - Math.exp(-dt / 0.3)); }
        const lean = f.lean + 0.3 * Math.sin(this.clock * 0.4 + f.ph);
        const fadeIn = f.strike ? 0.03 : 0.15, fadeOut = f.strike ? 0.1 : 0.3;
        const life = Math.min(1, f.age / fadeIn) * Math.min(1, (f.life - f.age) / fadeOut) * (f.strike ? 1.4 : 1);
        const depth = 0.55 + 0.45 * Math.sin(u.time * 0.17 + f.ph);   // turning toward / away from us
        this.dataA[i * 4] = f.tip + lean;
        this.dataA[i * 4 + 1] = f.tip;
        this.dataA[i * 4 + 2] = 0.9 + 0.08 * depth;
        this.dataA[i * 4 + 3] = f.seed;
        this.dataB[i * 2] = Math.max(0, life) * (0.35 + 0.65 * depth);
        this.dataB[i * 2 + 1] = f.band;
      }
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f4v('uFilA', this.dataA).f2v('uFilB', this.dataB).f('uR', R).f('uBurst', this.burst).f('uClock', this.clock);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'plasma',
    name: 'Plasma Globe',
    blurb: 'Glowing plasma strings reach from the electrode to the glass through a haze of ionised gas, one per mid band. Kicks surge the voltage; hold the mouse on the glass to draw them.',
    params: [
      { key: 'burst', label: 'Voltage surge on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'crawl', label: 'Activity', min: 0.2, max: 3, step: 0.05, value: 1 },
    ],
    create: (ctx) => new PlasmaScene(ctx),
  });
})();
