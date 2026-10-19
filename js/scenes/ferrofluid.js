/* ferrofluid.js — Ferrofluid.
 * A puddle of magnetic liquid on a plate with an electromagnet underneath. Above a critical
 * field the flat surface is unstable (the Rosensweig instability) and the liquid stands up in a
 * hexagonal lattice of sharp spikes; the stronger the field, the taller the spikes and the wider
 * the patch that has gone spiky. The liquid also heaps up over the magnet. Raymarched heightfield,
 * shaded as a black mirror-glossy liquid reflecting a studio.
 *   bass  -> the magnet: kicks switch the field up so the spikes leap out across the puddle
 *   mids  -> each spike's height around its field value, the studio lights it reflects, the
 *            puddle's wobbling rim
 *   highs -> glints flickering on the spike tips, a fine tremble
 * Press the mouse to drag the magnet under the plate.
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;

  const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform vec3 uEye;
uniform vec3 uFwd;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec2 uMagnet;
uniform float uField;
uniform float uSpikeH;
uniform float uSpacing;
const float HMAX = 0.55;
const float FL = 1.6;

float fieldAt(vec2 x) { vec2 d = x - uMagnet; return uField * exp(-dot(d, d) / 0.26); }

// Offset from the nearest centre of a hexagonal lattice with unit neighbour distance.
vec2 hexOffset(vec2 x, out vec2 centre) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 h = s * 0.5;
  vec2 a = mod(x, s) - h;
  vec2 b = mod(x - h, s) - h;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  centre = x - g;
  return g;
}

float puddleR(vec2 x) {
  float ang = atan(x.y, x.x);
  return 0.78 * (1.0 + 0.035 * (noise2(vec2(ang * 2.5 + 7.0, uTime * 0.35)) - 0.5) * (1.0 + 2.5 * uMid));
}

// x: plate coordinates. Returns height; info = (distance to spike centre, spike hash, spike height).
float H(vec2 x, out vec3 info) {
  info = vec3(1.0, 0.0, 0.0);
  float r = length(x);
  float R = puddleR(x);
  float q = clamp(1.0 - (r * r) / (R * R), 0.0, 1.0);
  if (q <= 0.0) return 0.0;
  float F = fieldAt(x);
  float dome = 0.05 * sqrt(q) * (1.0 + 1.4 * F);   // heaps up over the magnet
  vec2 c;
  vec2 g = hexOffset(x / uSpacing, c);
  c *= uSpacing;
  float d = length(g);
  float hc = hash12(c * 13.1 + 0.37);
  float e = bandMid(hc);
  float rim = smoothstep(R * 0.96, R * 0.72, length(c));
  float hs = uSpikeH * smoothstep(0.2, 0.9, fieldAt(c)) * rim * (0.6 + 0.75 * e);
  hs *= 1.0 + 0.05 * uHigh * sin(uTime * 41.0 + hc * 30.0);
  float prof = pow(max(0.0, 1.0 - d * 2.0), 2.2);   // concave cone, meets the neighbours at the cell edge
  info = vec3(d, hc, hs);
  return dome + hs * prof;
}
float H(vec2 x) { vec3 i; return H(x, i); }

vec3 env(vec3 d) {
  // A studio: a glowing backdrop sweep low on the horizon, small hard lights above. The liquid
  // is black, so what you see of it is these reflections tracing the spikes' flanks.
  float lit = 1.0 + 3.0 * uMid + 1.5 * uMidPulse;
  vec3 c = palette(0.0) * 0.12 + palette(0.4) * exp(-abs(d.y - 0.03) * 11.0) * (0.1 + 0.25 * uMid);
  float ring = smoothstep(0.03, 0.01, abs(d.y - 0.45));                        // a ring light all around
  float s1 = smoothstep(0.975, 0.99, dot(d, normalize(vec3(-0.6, 0.7, 0.4))));
  float s2 = smoothstep(0.98, 0.992, dot(d, normalize(vec3(0.65, 0.55, 0.55))));
  float strip = smoothstep(0.03, 0.012, abs(d.x + 0.15 * d.z)) * smoothstep(0.65, 0.8, d.y);
  float ang = atan(d.z, d.x) / 6.2831853 + 0.5;
  c += palette(0.45 + 0.5 * ang) * ring * lit * 1.2;
  c += palette(0.35) * s1 * lit * 2.0 + palette(0.75) * s2 * lit * 2.0 + palette(1.0) * strip * lit * 1.5;
  return c;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  vec3 rd = normalize(uFwd * FL + uRight * p.x + uUp * p.y);
  vec3 ro = uEye;
  vec3 col;
  if (rd.y >= -1e-3) {
    col = env(rd);
  } else {
    float t = max(0.0, (HMAX - ro.y) / rd.y);
    float tPlate = -ro.y / rd.y;
    float tPrev = t;
    for (int i = 0; i < 160; i++) {
      vec3 pos = ro + rd * t;
      float dy = pos.y - H(pos.xz);
      if (dy < 4e-4 || t > tPlate) break;
      tPrev = t;
      t += max(dy * 0.32, 0.0012);
    }
    // Refine the crossing.
    float a = tPrev, b = min(t, tPlate);
    for (int i = 0; i < 6; i++) {
      float m = 0.5 * (a + b);
      vec3 pos = ro + rd * m;
      if (pos.y > H(pos.xz)) a = m; else b = m;
    }
    t = b;
    vec3 pos = ro + rd * t;
    vec3 info;
    float h = H(pos.xz, info);
    float fog = exp(-max(t - 1.8, 0.0) * 0.45);
    if (h > 1e-4) {
      const float e = 0.0015;
      vec3 n = normalize(vec3(H(pos.xz - vec2(e, 0.0)) - H(pos.xz + vec2(e, 0.0)), 2.0 * e,
                              H(pos.xz - vec2(0.0, e)) - H(pos.xz + vec2(0.0, e))));
      vec3 refl = reflect(rd, n);
      float fres = 0.06 + 0.94 * pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
      float ao = 0.45 + 0.55 * smoothstep(0.0, 0.5, info.z > 0.0 ? 1.0 - info.x * 2.0 : 1.0);
      col = palette(0.0) * 0.03 + env(refl) * (0.25 + 0.75 * fres) * ao;
      // Highs: glints flicker on the tips.
      float tip = 1.0 - smoothstep(0.0, 0.12, info.x);
      float fl = step(0.55, fract(info.y * 7.3 + floor(uTime * 12.0) * 0.618));
      col += palette(1.0) * tip * fl * step(0.01, info.z) * (0.4 * uHigh + 2.5 * uHighPulse) * 2.0;
    } else {
      // The plate: dark and slightly glossy, darker under the liquid's rim, a glow over the magnet.
      vec2 x = pos.xz;
      float r = length(x);
      float R = puddleR(x);
      vec2 gl = abs(fract(x * 5.0) - 0.5);
      float grid = 1.0 - smoothstep(0.0, 0.02 * t, min(gl.x, gl.y));
      col = palette(0.0) * (0.3 + 0.1 * grid) + env(reflect(rd, vec3(0.0, 1.0, 0.0))) * 0.12;
      col *= 0.3 + 0.7 * smoothstep(R, R + 0.15, r);
      vec2 dm = x - uMagnet;
      col += palette(0.6) * exp(-dot(dm, dm) / 0.03) * 0.12 * uField;
    }
    col = mix(env(vec3(rd.x, 0.05, rd.z)), col, fog);
  }
  col *= 0.65 + 0.6 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  class FerrofluidScene {
    constructor(ctx) {
      this.ctx = ctx;
      this.prog = ctx.fsProgram(FS, 'ferrofluid');
      this.surge = 0;
      this.mag = [0, 0];
    }
    resize() { /* fullscreen shader */ }
    render(target, audio, u) {
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const z = P.zoom;
      const eye = [0, 0.72 * z, -1.85 * z];
      const f = norm([-eye[0], 0.1 - eye[1], -eye[2]]);
      const r = norm(cross([0, 1, 0], f));
      const up = cross(f, r);
      // The magnet follows a pressed pointer (raycast onto the plate), else drifts home.
      let tx = 0, ty = 0;
      if (u.pointer.down) {
        const sx = (u.pointer.x - 0.5) * u.aspect, sy = u.pointer.y - 0.5;
        const rd = norm([f[0] * 1.6 + r[0] * sx + up[0] * sy, f[1] * 1.6 + r[1] * sx + up[1] * sy, f[2] * 1.6 + r[2] * sx + up[2] * sy]);
        if (rd[1] < -1e-3) {
          const t = -eye[1] / rd[1];
          tx = eye[0] + rd[0] * t; ty = eye[2] + rd[2] * t;
          const l = Math.hypot(tx, ty);
          if (l > 0.6) { tx *= 0.6 / l; ty *= 0.6 / l; }
        }
      }
      const ease = 1 - Math.exp(-dt / (u.pointer.down ? 0.12 : 0.6));
      this.mag[0] += (tx - this.mag[0]) * ease;
      this.mag[1] += (ty - this.mag[1]) * ease;
      // Bass: the kick surges the coil current; quick on, softer off, like liquid catching up.
      const k = audio.kick;
      this.surge += (k - this.surge) * (1 - Math.exp(-dt / (k > this.surge ? 0.025 : 0.28)));
      const field = P.strength * (0.42 + 0.35 * audio.bass + 0.95 * this.surge * P.pump);
      const p = this.prog.use();
      this.ctx.setCommon(p, audio, u);
      p.f3('uEye', eye[0], eye[1], eye[2])
        .f3('uFwd', f[0], f[1], f[2])
        .f3('uRight', r[0], r[1], r[2])
        .f3('uUp', up[0], up[1], up[2])
        .f2('uMagnet', this.mag[0], this.mag[1])
        .f('uField', field)
        .f('uSpikeH', 0.26 * P.spikes)
        .f('uSpacing', 0.105 * P.spacing);
      this.ctx.drawQuad();
    }
    dispose() { this.prog.dispose(); }
  }

  VIZ.registerScene({
    id: 'ferrofluid',
    name: 'Ferrofluid',
    blurb: 'Magnetic liquid over an electromagnet. Kicks surge the field and the puddle bristles into a lattice of spikes. Drag to move the magnet.',
    params: [
      { key: 'strength', label: 'Magnet strength', min: 0.3, max: 2, step: 0.05, value: 1 },
      { key: 'pump', label: 'Kick surge', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'spikes', label: 'Spike height', min: 0.3, max: 1.8, step: 0.05, value: 1 },
      { key: 'spacing', label: 'Spike spacing', min: 0.7, max: 1.6, step: 0.05, value: 1 },
      { key: 'zoom', label: 'Camera distance', min: 0.7, max: 1.5, step: 0.05, value: 1 },
    ],
    create: (ctx) => new FerrofluidScene(ctx),
  });
})();
