/* meteors.js — Meteor Shower.
 * A dark-sky site under a meteor shower. Every meteor of a shower comes from the same point in
 * the sky, the radiant (the direction the Earth is ploughing into the comet's debris stream), so
 * the streaks fan outward from it; the radiant and the stars wheel slowly round the pole as the
 * night turns. Colour follows chemistry and speed: fast ones burn blue-green (magnesium, oxygen),
 * slow ones orange (sodium). Fireballs flare, break apart, and leave a persistent train, a
 * glowing trail of ionised air that the high-altitude wind slowly twists out of shape.
 *   bass  -> every kick is a fireball
 *   mids  -> the Milky Way and the airglow brighten
 *   highs -> faint, quick meteors; star twinkle
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const NM = 28, NT = 6;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define NM ${NM}
#define NT ${NT}
uniform vec4 uM[NM];      // start x, y, direction x, y
uniform vec4 uM2[NM];     // age, life, speed, brightness (negative = unused)
uniform vec4 uM3[NM];     // length, colour 0..1 (orange .. green), fireball flag, flare time
uniform vec4 uT[NT];      // train start, end
uniform vec2 uT2[NT];     // age, life
uniform float uSkyRot;
uniform vec2 uPole;
uniform vec2 uRadiant;

vec2 rot(vec2 p, vec2 c, float a) { float cs = cos(a), s = sin(a); p -= c; return c + vec2(cs * p.x - s * p.y, s * p.x + cs * p.y); }
float segDist(vec2 p, vec2 a, vec2 b, out float h) { vec2 pa = p - a, ba = b - a; h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0); return length(pa - ba * h); }
vec3 meteorColour(float c) { return mix(vec3(1.0, 0.62, 0.3), vec3(0.55, 1.0, 0.75), c); }

float ground(float x) {
  float ridge = 0.06 + 0.05 * fbm2(vec2(x * 1.3, 2.0)) - 0.03 * noise2(vec2(x * 5.0, 7.0));
  // Pine trees along the ridge.
  float cell = floor(x * 26.0);
  float h = hash11(cell * 1.7 + 3.0);
  float fx = fract(x * 26.0) - 0.5;
  float tree = h > 0.45 ? max(0.0, (0.035 + 0.05 * h) * (1.0 - abs(fx) * 2.6)) : 0.0;
  return ridge + tree;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  float horizon = -0.33;
  vec2 q = vec2(p.x, p.y - horizon);
  vec3 col = mix(palette(0.0) * 0.25 + vec3(0.01, 0.015, 0.03), palette(0.0) * 0.05 + vec3(0.0, 0.0, 0.01), smoothstep(0.0, 0.8, q.y));
  // Airglow near the horizon.
  col += mix(vec3(0.05, 0.12, 0.06), palette(0.4) * 0.2, 0.4) * exp(-q.y * 7.0) * (0.25 + 0.6 * uMid);

  // The sky turns round the pole: stars and the Milky Way in sky coordinates.
  vec2 s = rot(p, uPole, -uSkyRot);
  float mw = exp(-pow((s.y - 0.55 * s.x - 0.05) / 0.16, 2.0));
  float dust = fbm2(s * 4.0 + 11.0);
  col += mix(palette(0.35), vec3(0.75, 0.78, 0.9), 0.6) * mw * (0.3 + 0.7 * fbm2(s * 2.0)) * (1.0 - 0.7 * smoothstep(0.5, 0.75, dust)) * 0.07 * (0.5 + uMid);
  for (int l = 0; l < 2; l++) {
    float sc = l == 0 ? 80.0 : 160.0;
    vec2 g = s * sc;
    vec3 h = hash33(vec3(floor(g), float(l) + 7.0));
    float d = length(fract(g) - 0.5 - (h.xy - 0.5) * 0.7);
    float tw = 0.7 + 0.3 * sin(uTime * (2.0 + 6.0 * h.x) + h.y * 40.0) * (0.4 + 1.3 * uHigh);
    float on = step(l == 0 ? 0.9 : 0.8 - 0.25 * mw, h.z);
    col += mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.85, 0.7), h.y) * on * exp(-d * d * (l == 0 ? 900.0 : 1800.0)) * tw * (l == 0 ? 1.0 : 0.55);
  }

  // Persistent trains: glowing, slowly twisted by the wind.
  for (int i = 0; i < NT; i++) {
    vec2 tt = uT2[i];
    if (tt.y <= 0.0 || tt.x > tt.y) continue;
    vec4 tr = uT[i];
    float k = tt.x / tt.y;
    vec2 w = vec2(noise2(vec2(p.y * 6.0, tt.x * 0.3 + float(i))) - 0.5, noise2(vec2(p.x * 6.0, tt.x * 0.3 + float(i) * 3.0)) - 0.5) * 0.06 * k;
    float h;
    float d = segDist(p + w, tr.xy, tr.zw, h);
    float width = 0.002 + 0.012 * k;
    col += mix(vec3(0.5, 1.0, 0.7), palette(0.6), 0.3) * exp(-d * d / (width * width)) * (1.0 - k) * (1.0 - k) * 0.35 * (0.4 + h);
  }
  // Meteors: a hot head, a fading tail; fireballs flare and shed fragments.
  for (int i = 0; i < NM; i++) {
    vec4 m2 = uM2[i];
    if (m2.w <= 0.0 || m2.x > m2.y) continue;
    vec4 m = uM[i];
    vec4 m3 = uM3[i];
    float age = m2.x, life = m2.y, k = age / life;
    vec2 head = m.xy + m.zw * m2.z * age;
    float len = m3.x * smoothstep(0.0, 0.3, k);
    vec2 tail = head - m.zw * len;
    float h;
    float d = segDist(p, tail, head, h);
    float bright = m2.w * sin(3.14159 * pow(k, 0.7));
    float width = (0.0012 + 0.003 * m3.z) * (0.6 + 0.4 * h);
    vec3 c = meteorColour(m3.y);
    float core = exp(-d * d / (width * width)) * h * h;
    col += mix(c, vec3(1.0), 0.4 * h) * core * bright * 1.6;
    float hd = length(p - head);
    col += mix(c, vec3(1.0), 0.6) * exp(-hd * hd / (width * width * 6.0)) * bright * 1.2;
    if (m3.z > 0.5) {
      // Fireball: a terminal flare and a few fragments.
      float fl = exp(-pow((age - m3.w) / 0.08, 2.0));
      col += mix(c, vec3(1.0), 0.7) * exp(-hd / 0.03) * fl * 1.5;
      for (int f = 0; f < 3; f++) {
        float fa = age - m3.w;
        if (fa < 0.0) break;
        vec2 fd = m.zw + vec2(-m.w, m.z) * (float(f) - 1.0) * 0.18;
        vec2 fp = head + fd * fa * 0.12;
        col += c * exp(-length(p - fp) / 0.004) * exp(-fa * 4.0) * 0.8;
      }
    }
  }

  // The ground: a ridge of hills and pines in silhouette.
  float gh = ground(p.x);
  float land = 1.0 - smoothstep(gh - px, gh + px, q.y);
  col = mix(col, vec3(0.006, 0.008, 0.012) + col * 0.03, land);
  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class MeteorScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'meteors');
      this.trig = new VIZ.KickTrigger(0.35);
      this.m = new Float32Array(NM * 4);
      this.m2 = new Float32Array(NM * 4);
      this.m3 = new Float32Array(NM * 4);
      for (let i = 0; i < NM; i++) this.m2[i * 4 + 3] = -1;
      this.tr = new Float32Array(NT * 4);
      this.tr2 = new Float32Array(NT * 2);
      this.nextM = 0;
      this.nextT = 0;
      this.carry = 0;
      this.skyRot = 0;
      this.live = [];
    }
    _spawn(radiant, asp, fireball, strength) {
      // A slot: reuse a finished one, else the oldest.
      let i = -1;
      for (let j = 0; j < NM; j++) { const o = j * 4; if (this.m2[o + 3] <= 0 || this.m2[o] > this.m2[o + 1]) { i = j; break; } }
      if (i < 0) { i = this.nextM; this.nextM = (this.nextM + 1) % NM; }
      const o = i * 4;
      // Start somewhere away from the radiant, moving straight away from it.
      const a = Math.random() * Math.PI * 2;
      const r = (fireball ? 0.12 : 0.05) + Math.random() * 0.55;
      let sx = radiant[0] + Math.cos(a) * r * asp * 0.6, sy = radiant[1] + Math.sin(a) * r;
      sy = Math.max(-0.2, Math.min(0.48, sy));
      const dx = sx - radiant[0], dy = sy - radiant[1];
      const l = Math.hypot(dx, dy) || 1;
      const speed = fireball ? 0.35 + Math.random() * 0.2 : 0.7 + Math.random() * 0.9;
      const life = fireball ? 1.4 + Math.random() * 0.8 : 0.18 + Math.random() * 0.45;
      this.m.set([sx, sy, dx / l, dy / l], o);
      this.m2.set([0, life, speed, fireball ? 1.6 + strength : 0.25 + 0.6 * strength], o);
      this.m3.set([fireball ? 0.22 : 0.05 + 0.1 * Math.random(), Math.min(1, (speed - 0.3) / 1.3 + (Math.random() - 0.5) * 0.3), fireball ? 1 : 0, life * (0.6 + 0.25 * Math.random())], o);
      if (fireball) this.live.push(i);
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const asp = u.width / u.height;
      this.skyRot += dt * 0.012 * P.rotation;
      const pole = [-0.65 * asp, 0.62];
      const c = Math.cos(this.skyRot), s = Math.sin(this.skyRot);
      const r0 = [0.22 * asp - pole[0], 0.22 - pole[1]];
      const radiant = [pole[0] + c * r0[0] - s * r0[1], pole[1] + s * r0[0] + c * r0[1]];
      // Bass: fireballs. Highs: faint meteors, plus a background rate.
      const hit = this.trig.update(audio.kick);
      if (hit) this._spawn(radiant, asp, true, hit * P.fireballs);
      if (audio.highOnset && Math.random() < 0.8 * P.faint) this._spawn(radiant, asp, false, audio.highPulse);
      this.carry += dt * P.rate * (0.4 + audio.level);
      while (this.carry >= 1) { this.carry -= 1; this._spawn(radiant, asp, false, 0.4 + Math.random() * 0.5); }
      for (let i = 0; i < NM; i++) this.m2[i * 4] += dt;
      for (let i = 0; i < NT; i++) this.tr2[i * 2] += dt;
      // A fireball that has burned out leaves a train along its path.
      this.live = this.live.filter((i) => {
        const o = i * 4;
        if (this.m2[o] < this.m2[o + 1]) return true;
        const age = this.m2[o + 1], sp = this.m2[o + 2];
        const hx = this.m[o] + this.m[o + 2] * sp * age, hy = this.m[o + 1] + this.m[o + 3] * sp * age;
        const L = this.m3[o] * 1.6;
        const t = this.nextT;
        this.nextT = (this.nextT + 1) % NT;
        this.tr.set([hx - this.m[o + 2] * L, hy - this.m[o + 3] * L, hx, hy], t * 4);
        this.tr2.set([0, (5 + Math.random() * 4) * P.trains], t * 2);
        return false;
      });
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f4v('uM', this.m).f4v('uM2', this.m2).f4v('uM3', this.m3).f4v('uT', this.tr).f2v('uT2', this.tr2)
        .f('uSkyRot', this.skyRot).f2('uPole', pole[0], pole[1]).f2('uRadiant', radiant[0], radiant[1]);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'meteors',
    name: 'Meteor Shower',
    blurb: 'Meteors fan out from the radiant as the sky wheels overhead. Highs are faint quick ones; every kick is a fireball that flares, breaks up and leaves a glowing train.',
    params: [
      { key: 'fireballs', label: 'Fireballs on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'faint', label: 'Faint meteors on highs', min: 0, max: 1.25, step: 0.05, value: 1 },
      { key: 'rate', label: 'Background rate', min: 0, max: 8, step: 0.1, value: 1.5, fmt: (v) => v.toFixed(1) + ' / s' },
      { key: 'trains', label: 'Train lifetime', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'rotation', label: 'Sky rotation', min: 0, max: 4, step: 0.05, value: 1 },
    ],
    create: (ctx) => new MeteorScene(ctx),
  });
})();
