/* warp.js — Warp Drive.
 * First person inside an Alcubierre warp bubble. Below light speed the sky is what special
 * relativity says you would see: aberration crowds the stars toward the direction of travel
 * (cos th_src = (cos th - b) / (1 - b cos th)), Doppler shifts them blue ahead and red behind and
 * beaming brightens the forward sky (~D^3). Past light speed the bubble takes over: space ahead
 * contracts and behind expands, the stars smear into streaks, the bubble wall shimmers round the
 * edge of view and blueshifted particles pile up and flash on its front wall (a real prediction
 * of the Alcubierre metric).
 * In the corner a spacetime diagram (time up, light cones at 45°) plots your worldline in the
 * outside world's frame: while you are slower than light it stays inside the cone; at warp it
 * tips flatter than 45° into the forbidden "elsewhere".
 *   bass  -> kicks charge the drive: warp jumps that surge you past c and coast back down
 *   mids  -> the bubble wall's glow
 *   highs -> particle impacts flashing on the front of the bubble
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const NWL = 24, NIMP = 8;
  const WL_DT = 0.15;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define NWL ${NWL}
#define NIMP ${NIMP}
uniform float uBeta;       // aberration speed (< 1)
uniform float uWarp;       // 0 sublight .. 1 deep warp
uniform float uSpeed;      // speed in units of c (for the diagram)
uniform float uDist;
uniform vec3 uYPR;         // yaw, pitch, roll
uniform vec2 uWL[NWL];     // worldline points (x, t), relative to now, in c = 1 units
uniform vec3 uImp[NIMP];   // screen x, y, age
uniform float uWT;         // diagram half range (s)

mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

// Star temperature colour, shifted by the Doppler factor D (D > 1 bluer).
vec3 starColor(float temp, float D) {
  float t = clamp(temp * D, 0.2, 2.5);
  vec3 red = vec3(1.0, 0.45, 0.25), white = vec3(1.0, 0.95, 0.9), blue = vec3(0.55, 0.7, 1.0);
  return t < 1.0 ? mix(red, white, (t - 0.2) / 0.8) : mix(white, blue, min((t - 1.0) / 1.5, 1.0));
}

vec3 sky(vec3 d, float px) {
  vec3 col = vec3(0.0);
  for (int l = 0; l < 2; l++) {
    float sc = l == 0 ? 34.0 : 70.0;
    vec3 g = d * sc;
    vec3 id = floor(g);
    vec3 h = hash33(id + float(l) * 17.0);
    if (h.z > (l == 0 ? 0.2 : 0.1)) continue;
    vec3 sp = normalize((id + 0.2 + 0.6 * h) / sc);
    float ang = acos(clamp(dot(d, sp), -1.0, 1.0));
    float size = (0.0009 + 0.0012 * h.x) * (l == 0 ? 1.4 : 1.0);
    float b = exp(-ang * ang / (size * size)) * (0.6 + 1.2 * h.y);
    col += vec3(b) * (0.5 + h.x);
  }
  return col;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  float cr = cos(uYPR.z), sr = sin(uYPR.z);
  vec2 pr = mat2(cr, -sr, sr, cr) * p;
  float r = length(pr);
  // Bubble wall: a refracting, shimmering ring round the edge of view at warp.
  float wallR = 0.62;
  float wall = exp(-pow((r - wallR) / 0.05, 2.0)) * uWarp;
  float shimmer = noise3(vec3(pr * 8.0, uTime * 1.5));
  vec2 pw = pr * (1.0 + wall * 0.06 * (shimmer - 0.3));
  // Warp contraction ahead: the forward view is squeezed inward.
  pw *= 1.0 + 0.35 * uWarp * smoothstep(0.0, 0.5, r);
  vec3 dc = normalize(vec3(pw, 1.25));
  mat3 R = rotY(uYPR.x) * rotX(uYPR.y);

  vec3 col = vec3(0.0);
  // Motion blur along the aberration: several betas, more spread at warp.
  float spread = 0.02 + 0.5 * uWarp;
  for (int k = 0; k < 4; k++) {
    float b = clamp(uBeta - spread * float(k) / 3.0, 0.0, 0.995);
    float ct = dc.z;
    float cs = (ct - b) / (1.0 - b * ct);
    float sn = sqrt(max(0.0, 1.0 - cs * cs));
    vec2 az = normalize(dc.xy + 1e-6);
    vec3 src = R * vec3(az * sn, cs);
    float g = 1.0 / sqrt(1.0 - b * b);
    float D = g * (1.0 + b * ct);
    float temp = 0.6 + 0.8 * hash13(floor(src * 40.0));
    vec3 s = sky(src, px);
    col += s * starColor(temp, D) * pow(min(D, 6.0), 1.5) * 0.12;
  }
  // Galactic glow, aberrated with the stars.
  {
    float b = uBeta;
    float cs = (dc.z - b) / (1.0 - b * dc.z);
    vec3 src = R * vec3(normalize(dc.xy + 1e-6) * sqrt(max(0.0, 1.0 - cs * cs)), cs);
    float band = exp(-pow(src.y * 3.0 + 0.4 * src.x, 2.0));
    col += palette(0.3) * band * (0.5 + 0.5 * fbm3(src * 3.0)) * 0.035 * (1.0 + uBeta);
  }
  // Dust rushing past (tunnel mapping), long streaks at warp.
  {
    float dd = 0.35 / max(r, 1e-3);
    float a = atan(pr.y, pr.x);
    vec2 gc = vec2(a / 6.2831853 * 60.0, dd * 3.0 + uDist * 3.0);
    vec2 id = floor(gc);
    vec3 h = hash33(vec3(id, 1.0));
    vec2 f = fract(gc) - 0.5 - (h.xy - 0.5) * 0.5;
    float len = 0.05 + 1.0 * uWarp + 0.2 * uBeta;
    float streak = exp(-f.x * f.x * 40.0 - f.y * f.y / (len * len) * 2.0) * step(0.96, h.z);
    col += mix(vec3(0.7, 0.8, 1.0), palette(0.9), 0.4) * streak * smoothstep(0.08, 0.4, r) * (0.15 + 0.4 * uBeta + 0.5 * uWarp);
  }
  // The bubble wall and the blueshift pile-up on its front.
  col += palette(0.55 + 0.4 * shimmer) * wall * (0.25 + 1.2 * uMid + 0.5 * uMidPulse);
  col += (palette(1.0) + vec3(0.2, 0.3, 0.5)) * exp(-r * 9.0) * uWarp * (0.15 + 0.3 * uLevel);
  for (int i = 0; i < NIMP; i++) {
    vec3 im = uImp[i];
    if (im.z > 0.5) continue;
    float d = length(pr - im.xy);
    float ring = exp(-pow((d - im.z * 0.12) / 0.006, 2.0)) * (1.0 - im.z * 2.0);
    col += (palette(1.0) + 0.5) * (exp(-d * d / 0.00015) * (1.0 - im.z * 2.0) * 2.0 + ring) * (0.4 + uWarp);
  }

  // Spacetime diagram inset: time up, light cones at 45 degrees.
  vec2 bc = vec2(-0.5 * uRes.x / uRes.y + 0.17, -0.33);
  float hs = 0.13;
  vec2 l = (p - bc) / hs;
  if (abs(l.x) < 1.08 && abs(l.y) < 1.08) {
    col *= 0.25;
    vec3 ink = vec3(0.0);
    float fw = px / hs * 1.5;
    float frame = 1.0 - smoothstep(0.0, fw, abs(max(abs(l.x), abs(l.y)) - 1.04));
    ink += vec3(0.5) * frame * 0.5;
    if (abs(l.x) < 1.0 && abs(l.y) < 1.0) {
      float cone = 1.0 - smoothstep(0.0, fw, abs(abs(l.x) - abs(l.y)) * 0.7071);
      ink += palette(0.5) * cone * 0.7;
      ink += palette(0.4) * 0.07 * step(abs(l.x), abs(l.y));       // inside the cone: timelike
      ink += vec3(1.0, 0.25, 0.2) * 0.04 * step(abs(l.y), abs(l.x)); // elsewhere: spacelike
      float axis = 1.0 - smoothstep(0.0, fw, abs(l.x));
      ink += vec3(0.3) * axis * 0.3;
      // The worldline.
      for (int i = 0; i < NWL - 1; i++) {
        vec2 a = uWL[i] / uWT, b = uWL[i + 1] / uWT;
        vec2 pa = l - a, ba = b - a;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
        float d = length(pa - ba * h);
        float fast = step(abs(ba.y) + 1e-5, abs(ba.x));                 // flatter than 45°: faster than light
        vec3 c = mix(palette(0.95), vec3(1.0, 0.3, 0.2), fast);
        ink += c * (1.0 - smoothstep(fw * 0.6, fw * 1.6, d)) * 1.4;
      }
      ink += vec3(1.0) * exp(-dot(l, l) / (fw * fw * 4.0)) * 2.0;     // now
    }
    col += ink;
  }
  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class WarpScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'warp');
      this.trig = new VIZ.KickTrigger(0.35);
      this.charge = 0;
      this.speed = 0.3;
      this.vel = 0;
      this.dist = 0;
      this.hist = new Float32Array(NWL).fill(0.3);   // speed samples, newest last
      this.histT = 0;
      this.wl = new Float32Array(NWL * 2);
      this.imp = new Float32Array(NIMP * 3);
      for (let i = 0; i < NIMP; i++) this.imp[i * 3 + 2] = 9;
      this.nextI = 0;
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const hit = this.trig.update(audio.kick);
      if (hit) this.charge = Math.min(3.5, this.charge + hit * 0.9 * P.jump);
      this.charge *= Math.exp(-dt / (2.2 * P.coast));
      // Speed follows cruise + charge through a soft spring (it accelerates, never snaps).
      const goal = P.cruise + this.charge;
      const Kp = 14, C = 2 * Math.sqrt(Kp) * 0.9;
      this.vel += (Kp * (goal - this.speed) - C * this.vel) * dt;
      this.speed = Math.max(0, this.speed + this.vel * dt);
      const s = this.speed;
      const beta = Math.min(s, 0.97);
      const warp = Math.min(1, Math.max(0, (s - 0.95) / 0.8));
      this.dist += dt * (0.05 + 0.25 * Math.min(s, 1) + 0.8 * warp);
      // Worldline history.
      this.histT += dt;
      while (this.histT > WL_DT) {
        this.histT -= WL_DT;
        this.hist.copyWithin(0, 1);
        this.hist[NWL - 1] = s;
      }
      // Points from the past (bottom) up to now (centre).
      let x = 0;
      this.wl[(NWL - 1) * 2] = 0; this.wl[(NWL - 1) * 2 + 1] = 0;
      for (let i = NWL - 2; i >= 0; i--) {
        x -= this.hist[i + 1] * WL_DT;
        this.wl[i * 2] = x;
        this.wl[i * 2 + 1] = -(NWL - 1 - i) * WL_DT;
      }
      // Highs: impacts on the bubble's front wall.
      for (let i = 0; i < NIMP; i++) this.imp[i * 3 + 2] += dt;
      if (audio.highOnset && Math.random() < P.impacts) {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 0.22;
        this.imp.set([Math.cos(a) * rr, Math.sin(a) * rr, 0], this.nextI * 3);
        this.nextI = (this.nextI + 1) % NIMP;
      }
      const t = u.time;
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f('uBeta', beta).f('uWarp', warp).f('uSpeed', s).f('uDist', this.dist)
        .f3('uYPR', 0.18 * Math.sin(t * 0.04) + 0.6, 0.1 * Math.sin(t * 0.031), 0.12 * Math.sin(t * 0.027))
        .f2v('uWL', this.wl).f3v('uImp', this.imp).f('uWT', (NWL - 1) * WL_DT);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'warp',
    name: 'Warp Drive',
    blurb: 'Inside an Alcubierre warp bubble. Kicks charge the drive past light speed; the stars crowd forward and streak. The spacetime diagram shows your worldline leaving the light cone.',
    params: [
      { key: 'cruise', label: 'Cruise speed (c)', min: 0, max: 0.95, step: 0.01, value: 0.35, fmt: (v) => v.toFixed(2) + ' c' },
      { key: 'jump', label: 'Warp charge per kick', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'coast', label: 'Coast time', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'impacts', label: 'Impacts on highs', min: 0, max: 1, step: 0.05, value: 0.8 },
    ],
    create: (ctx) => new WarpScene(ctx),
  });
})();
