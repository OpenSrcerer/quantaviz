/* jupiter.js — Jupiter.
 * A low flight over Jupiter's cloud deck, heading across the latitudes so the zones and belts
 * slide toward you and over the curved horizon. Each band flows along its jet stream (alternating
 * east and west, the way the real zonal winds do), drawn with two-phase flow noise so the clouds
 * genuinely stream instead of sliding as a picture. Storms are vortices that twist the clouds
 * around them and drift with their band; Io crosses the black sky above the limb.
 *   bass  -> kicks spawn new storms ahead of you and nudge the flight faster
 *   mids  -> each latitude is one mid band and its clouds brighten with it
 *   highs -> lightning flashes deep in the belts (Jupiter has plenty)
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const NS = 6, NL = 4;
  const RP = 7.0;           // planet radius in scene units (horizon curvature)
  const ALT = 0.42;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
#define NS ${NS}
#define NL ${NL}
uniform vec2 uCam;          // camera position over the surface (x, z)
uniform vec2 uHeading;      // flight direction (unit, xz)
uniform float uFlow;        // flow clock
uniform vec4 uStorms[NS];   // x, z, radius, strength (signed spin; 0 = none)
uniform vec3 uFlashes[NL];  // x, z, age
uniform float uPitch;
uniform float uBandDensity;
const float RP = ${RP.toFixed(2)};
const float ALT = ${ALT.toFixed(2)};

float jet(float lat) { return 0.55 * sin(lat * 6.0 * uBandDensity) + 0.2 * sin(lat * 13.0 * uBandDensity + 1.0); }

vec2 swirl(vec2 s) {
  for (int i = 0; i < NS; i++) {
    vec4 st = uStorms[i];
    if (st.w == 0.0) continue;
    vec2 d = s - st.xy;
    float f = exp(-dot(d, d) / (st.z * st.z));
    float a = st.w * f * 4.0;
    float c = cos(a), sn = sin(a);
    s = st.xy + mat2(c, -sn, sn, c) * d;
  }
  return s;
}

vec3 clouds(vec2 s) {
  vec2 w = swirl(s);
  float lat = w.y;
  float v = jet(lat);
  // Two-phase flow noise: two copies advected along the jet, cross-faded so neither smears out.
  float t1 = fract(uFlow), t2 = fract(uFlow + 0.5);
  float wt = abs(t1 * 2.0 - 1.0);
  vec2 a1 = vec2(w.x - v * t1 * 3.0, lat), a2 = vec2(w.x - v * t2 * 3.0, lat);
  float n1 = fbm2(vec2(a1.x * 4.0, a1.y * 12.0) + fbm2(a1 * 6.0) * 0.8);
  float n2 = fbm2(vec2(a2.x * 4.0, a2.y * 12.0) + fbm2(a2 * 6.0 + 5.0) * 0.8);
  float turb = mix(n1, n2, wt);
  float zone = sin(lat * 6.0 * uBandDensity + 0.6 * sin(lat * 2.7)) + 1.1 * (turb - 0.5);
  float e = bandMid(fract(lat * 0.7 + 0.5));
  vec3 belt = palette(0.25) * 0.3 + vec3(0.07, 0.03, 0.012);
  vec3 zoneC = palette(0.85) * 0.45 + vec3(0.11, 0.1, 0.07);
  vec3 col = mix(belt, zoneC, smoothstep(-0.35, 0.45, zone));
  col *= 0.45 + 0.45 * turb + 0.7 * e;
  // Storm ovals: a bright rim and a tinted eye.
  for (int i = 0; i < NS; i++) {
    vec4 st = uStorms[i];
    if (st.w == 0.0) continue;
    float r = length((s - st.xy) * vec2(0.7, 1.0)) / st.z;
    col = mix(col, palette(st.w > 0.0 ? 1.0 : 0.6) * (0.9 + 0.6 * e), exp(-pow((r - 0.8) / 0.25, 2.0)) * 0.5 * min(abs(st.w) * 2.0, 1.0));
    col = mix(col, palette(0.7) * 0.9, exp(-r * r * 3.0) * 0.35 * min(abs(st.w) * 2.0, 1.0));
  }
  // Highs: lightning glowing up through the clouds.
  for (int i = 0; i < NL; i++) {
    vec3 fl = uFlashes[i];
    if (fl.z > 0.6) continue;
    vec2 d = s - fl.xy;
    float g = exp(-dot(d, d) / 0.004) * 3.0 + exp(-dot(d, d) / 0.06) * 0.6;
    col += vec3(0.75, 0.85, 1.0) * g * exp(-fl.z * 9.0) * (0.6 + 0.6 * sin(fl.z * 90.0));
  }
  return col;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 fwd = normalize(vec3(uHeading.x, uPitch, uHeading.y));
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd * 1.3 + right * p.x + up * p.y);
  // Camera above a sphere whose top is directly below it.
  vec3 ro = vec3(0.0, ALT, 0.0);
  vec3 cen = vec3(0.0, -RP, 0.0);
  vec3 oc = ro - cen;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - RP * RP;
  float disc = b * b - c;
  vec3 col;
  vec3 sunDir = normalize(vec3(-0.5, 0.6, 0.6));
  if (disc > 0.0 && -b - sqrt(disc) > 0.0) {
    float t = -b - sqrt(disc);
    vec3 hp = ro + rd * t;
    vec3 n = normalize(hp - cen);
    // Surface coordinates: arc length on the sphere from the point below the camera.
    vec2 s = uCam + vec2(atan(n.x, n.y), atan(n.z, n.y)) * RP;
    col = clouds(s);
    float diff = 0.3 + 0.6 * max(dot(n, sunDir), 0.0);
    col *= diff;
    // Haze toward the limb.
    float limb = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    col = mix(col, palette(0.45) * 0.35 + vec3(0.03, 0.025, 0.02), limb * 0.6);
    col *= exp(-t * 0.04);
  } else {
    // Space above the limb: stars, a thin haze line, and Io crossing.
    vec2 g = rd.xy / max(rd.z + 1.5, 0.1) * 80.0 + vec2(uCam.x * 0.3, 0.0);
    vec3 h = hash33(vec3(floor(g), 3.0));
    float d = length(fract(g) - 0.5 - (h.xy - 0.5) * 0.7);
    col = palette(0.0) * 0.03 + vec3(0.9) * step(0.92, h.z) * exp(-d * d * 900.0) * (0.6 + 0.6 * uHigh);
    float above = disc > 0.0 ? 0.0 : (b * b - c);
    col += palette(0.45) * exp(above * 6.0) * 0.5;
    vec3 ioDir = normalize(vec3(sin(uTime * 0.012 + 1.0), 0.22, cos(uTime * 0.012 + 1.0)));
    float io = dot(rd, ioDir);
    float ioR = 0.9993;
    if (io > ioR) {
      float rr = sqrt(max(0.0, 1.0 - (1.0 - io) / (1.0 - ioR)));
      col = mix(col, vec3(0.9, 0.7, 0.3) * (0.3 + 0.9 * rr) * (0.6 + 0.6 * fbm2(rd.xy * 900.0)), smoothstep(ioR, ioR + 0.00005, io));
    }
  }
  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class JupiterScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'jupiter');
      this.trig = new VIZ.KickTrigger(0.35);
      this.cam = [0, 0];
      this.headA = 0.35;
      this.flow = 0;
      this.boost = 0;
      this.storms = new Float32Array(NS * 4);
      this.stormAge = new Float32Array(NS).fill(99);
      this.stormLife = new Float32Array(NS).fill(1);
      this.nextS = 0;
      this.flashes = new Float32Array(NL * 3);
      for (let i = 0; i < NL; i++) this.flashes[i * 3 + 2] = 9;
      this.nextL = 0;
      // A couple of storms to start with.
      this._storm(0.8, 1.5, 0.5); this._storm(0.5, 3.5, -0.8);
    }
    _jet(lat, bands) { return 0.55 * Math.sin(lat * 6.0 * bands) + 0.2 * Math.sin(lat * 13.0 * bands + 1.0); }
    _storm(strength, ahead, side) {
      const i = this.nextS;
      this.nextS = (this.nextS + 1) % NS;
      const hx = Math.sin(this.headA), hz = Math.cos(this.headA);
      const d = ahead === undefined ? 1.5 + Math.random() * 2.5 : ahead;
      const sd = side === undefined ? (Math.random() - 0.5) * 2.5 : side;
      this.storms[i * 4] = this.cam[0] + hx * d + hz * sd;
      this.storms[i * 4 + 1] = this.cam[1] + hz * d - hx * sd;
      this.storms[i * 4 + 2] = 0.12 + 0.18 * Math.random() * strength + 0.08;
      this.storms[i * 4 + 3] = 0;
      this.stormAge[i] = 0;
      this.stormLife[i] = 22 + Math.random() * 10;
      this.stormStr = this.stormStr || new Float32Array(NS);
      this.stormStr[i] = (Math.random() < 0.6 ? 1 : -1) * (0.35 + 0.5 * strength);
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const k = audio.kick;
      this.boost += (k - this.boost) * (1 - Math.exp(-dt / (k > this.boost ? 0.05 : 0.6)));
      // Heading wanders slowly; the flight never stops.
      this.headA += dt * 0.05 * Math.sin(u.time * 0.03);
      const hx = Math.sin(this.headA), hz = Math.cos(this.headA);
      const sp = 0.13 * P.speed * (1 + 0.8 * this.boost);
      this.cam[0] += hx * sp * dt;
      this.cam[1] += hz * sp * dt;
      this.flow += dt * 0.07 * P.wind;
      if (this.trig.update(k)) this._storm(audio.kick);
      // Storms drift with their band's jet, swell in, live a while, fade out.
      this.stormStr = this.stormStr || new Float32Array(NS);
      for (let i = 0; i < NS; i++) {
        this.stormAge[i] += dt;
        const a = this.stormAge[i], life = this.stormLife[i];
        const env = Math.min(1, a / 2) * Math.max(0, Math.min(1, (life - a) / 4));
        this.storms[i * 4 + 3] = a < life ? this.stormStr[i] * env * P.storms : 0;
        this.storms[i * 4] += this._jet(this.storms[i * 4 + 1], P.bands) * 0.07 * P.wind * dt * 3;
      }
      // Lightning on high onsets, somewhere ahead in view.
      for (let i = 0; i < NL; i++) this.flashes[i * 3 + 2] += dt;
      if (audio.highOnset && audio.highPulse * P.lightning > 0.3) {
        const i = this.nextL;
        this.nextL = (this.nextL + 1) % NL;
        const d = 0.6 + Math.random() * 2.2, sd = (Math.random() - 0.5) * d * 1.2;
        this.flashes[i * 3] = this.cam[0] + hx * d + hz * sd;
        this.flashes[i * 3 + 1] = this.cam[1] + hz * d - hx * sd;
        this.flashes[i * 3 + 2] = 0;
      }
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f2('uCam', this.cam[0], this.cam[1]).f2('uHeading', hx, hz).f('uFlow', this.flow)
        .f4v('uStorms', this.storms).f3v('uFlashes', this.flashes)
        .f('uPitch', -0.32 + 0.04 * Math.sin(u.time * 0.07) - 0.03 * this.boost)
        .f('uBandDensity', P.bands);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'jupiter',
    name: 'Jupiter',
    blurb: 'A low flight over Jupiter: cloud bands stream along their jets, kicks spin up new storms ahead, and lightning flickers in the belts with the highs.',
    params: [
      { key: 'speed', label: 'Flight speed', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'wind', label: 'Jet-stream speed', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'storms', label: 'Storm strength', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'lightning', label: 'Lightning on highs', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'bands', label: 'Band density', min: 0.5, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new JupiterScene(ctx),
  });
})();
