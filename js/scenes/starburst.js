/* starburst.js — Starburst.
 * 100k-400k five-pointed star sprites simulated entirely on the GPU with WebGL2 transform feedback.
 * Every star belongs to a frequency band; stars of one band share a longitude wedge of a breathing
 * sphere shell whose radius follows bass + that band's energy (so the spectrum becomes a bumpy,
 * colour-graded globe). A curl-noise flow swirls the shell, beats shatter it into a supernova that
 * springs back, treble adds sparkle jitter, and moving the browser window throws the stars around
 * (inertia). Additive HDR point sprites; the star shape is an exact SDF evaluated per fragment.
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const TAU = Math.PI * 2;

  /* ------------------------------------------------------------------ */
  /* Simulation: transform-feedback update pass (vertex stage only).     */
  /* aSeed = (random 0..1, frequency band 0..1, size factor, spin angle) */
  /* ------------------------------------------------------------------ */
  const SIM_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aVel;
layout(location = 2) in vec4 aSeed;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform float uSimDt;
uniform float uSpin;
uniform float uSwirl;
uniform float uBurst;
uniform float uSpread;
uniform float uBeatId;
uniform float uTick;
uniform vec3 uShove;
out vec3 vPos;
out vec3 vVel;
out vec4 vSeed;

const float TAU = 6.28318530718;

vec3 potential(vec3 p) {
  return vec3(noise3(p),
              noise3(p + vec3(31.4, 17.1, 5.3)),
              noise3(p + vec3(7.7, 53.9, 23.1)));
}

// curl of a noise vector potential (forward differences): divergence free swirling flow
vec3 curlNoise(vec3 p) {
  const float e = 0.15;
  vec3 a0 = potential(p);
  vec3 ax = potential(p + vec3(e, 0.0, 0.0));
  vec3 ay = potential(p + vec3(0.0, e, 0.0));
  vec3 az = potential(p + vec3(0.0, 0.0, e));
  return vec3((ay.z - a0.z) - (az.y - a0.y),
              (az.x - a0.x) - (ax.z - a0.z),
              (ax.y - a0.y) - (ay.x - a0.x)) / e;
}

void main() {
  float dt = min(uSimDt, 0.05);
  vec3 pos = aPos;
  vec3 vel = aVel;
  float sx = aSeed.x;
  float bt = aSeed.y;

  float h1 = hash11(sx * 91.37 + 1.0);
  float h2 = hash11(sx * 57.13 + 7.0);
  float h3 = hash11(sx * 33.71 + 3.0);
  float h4 = hash11(sx * 123.9 + 11.0);

  // Home direction: latitude from the seed, longitude follows the frequency band (plus jitter),
  // and the whole shell slowly rotates (uSpin) so particles chase their home and swirl.
  float cz = sx * 2.0 - 1.0;
  float bx = (bt - 0.25) / 0.43;                       // position of this star's band inside the mids
  float ph = TAU * (bx + (h1 - 0.5) * 0.30) + uSpin;
  float sr = sqrt(max(1.0 - cz * cz, 0.0));
  vec3 dir = vec3(sr * cos(ph), cz, sr * sin(ph));

  // Shell radius: breathes with bass, bulges with this particle's own band.
  float b = band(bt);
  float shell = (0.6 + 0.3 * uBass + 0.5 * b) * uSpread * (0.86 + 0.28 * h2);
  vec3 home = dir * shell;

  float len = length(pos);
  vec3 n = len > 0.02 ? pos / len : dir;

  // Springs: stiff radial (snappy breathing), soft tangential (k about 3, lets the flow bend the shell).
  vec3 toHome = home - pos;
  vec3 acc = n * ((shell - len) * 14.0) + (toHome - n * dot(toHome, n)) * 3.0;

  // Curl-noise swirl, stronger with mids.
  vec3 cp = pos * 1.2 + vec3(0.0, uTime * 0.15, uTime * 0.10);
  acc += curlNoise(cp) * ((0.4 + uMid) * uSwirl * 1.1);

  // Beat: sharp outward supernova kick, different random strength for every particle and every beat.
  if (uPulse > 0.05) {
    float rnd = hash12(vec2(sx * 311.7, uBeatId * 1.37 + 0.5));
    rnd = rnd * rnd;
    vec3 jd = hash33(vec3(sx * 17.0, uBeatId, 3.0)) - 0.5;
    vec3 kdir = normalize(n + jd * 0.6);
    acc += kdir * (90.0 * uPulse * uPulse * uBeat * uBurst * (0.15 + rnd));
  }

  // Treble: sparkle jitter.
  vec3 jit = hash33(vec3(sx * 1013.0, bt * 777.0, uTick)) - 0.5;
  acc += jit * (uHigh * 12.0);

  // Window movement: stars lag behind like loose objects (lighter ones move more).
  acc += uShove * (0.5 + h3);

  // Integrate (semi-implicit Euler) with anisotropic damping: radial is damped harder than tangential.
  vel += acc * dt;
  float vr = dot(vel, n);
  vec3 vt = vel - n * vr;
  vr *= exp(-dt * 3.4);
  vt *= exp(-dt * 1.0);
  vel = vt + n * vr;
  float vl = length(vel);
  if (vl > 20.0) vel *= 20.0 / vl;
  pos += vel * dt;

  // Safety net: a NaN or a runaway particle respawns on its home spot.
  if (!(length(pos) < 30.0) || !(vl < 1000.0)) {
    pos = home;
    vel = vec3(0.0);
  }

  // Sprite spin angle lives in seed.w; stars spin faster with loudness and beats.
  float spinRate = (h4 * 2.0 - 1.0) * (0.5 + 2.0 * uLevel + 1.5 * uPulse);
  float w = mod(aSeed.w + spinRate * dt, TAU);

  vPos = pos;
  vVel = vel;
  vSeed = vec4(aSeed.x, aSeed.y, aSeed.z, w);
}`;

  const SIM_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(0.0); }`;

  /* ------------------------------------------------------------------ */
  /* Rendering: additive point sprites shaped as 5-pointed stars.        */
  /* ------------------------------------------------------------------ */
  const DRAW_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aVel;
layout(location = 2) in vec4 aSeed;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform mat4 uViewProj;
uniform float uSize;
uniform float uBright;
uniform float uCamDist;
uniform float uMaxPx;
out vec3 vCol;
out float vAng;
out float vPx;
out float vInner;

void main() {
  vec4 clip = uViewProj * vec4(aPos, 1.0);
  float w = max(clip.w, 0.001);
  float b = band(aSeed.y);
  float spd = length(aVel);
  float h1 = hash11(aSeed.x * 71.3 + 5.0);
  float h2 = hash11(aSeed.x * 29.9 + 9.0);

  // Point size in pixels (seed.z is 0.4..1.3 for most stars, 1.6..3.6 for the big ones).
  float raw = uSize * aSeed.z * (1.0 + 2.0 * b + 0.25 * spd) * (1.0 + 0.8 * uHighPulse * h2) * (uRes.y / 1080.0) * 7.0 / w;
  float px = clamp(raw, 1.0, uMaxPx);
  float dimm = min(raw, 1.0);
  dimm *= dimm;   // sub-pixel stars fade out instead of flickering

  // Per-star twinkle, deeper with treble.
  float s = 0.5 + 0.5 * sin(uTime * (1.5 + 5.0 * h1) + h2 * 6.2831853);
  float amp = 0.35 + 0.5 * uHigh;
  float tw = 1.0 - amp * (1.0 - s);

  float ct = 0.3 + 0.7 * fract(aSeed.y * 1.3 + aSeed.x * 0.2);
  vec3 col = palette(ct) * (0.3 + 1.4 * b + 0.18 * spd) * tw;
  col *= uBright * (0.6 + 0.6 * uIntensity) * (1.0 + 0.5 * uPulse);
  float cue = 1.0 + 0.3 * clamp((uCamDist - w) / 1.4, -1.0, 1.0);   // nearer stars a bit brighter
  col *= cue * smoothstep(0.25, 1.0, w) * dimm;

  vCol = min(col, vec3(8.0));
  vAng = aSeed.w;
  vPx = px;
  vInner = 0.42 + 0.18 * b;
  gl_Position = clip;
  gl_PointSize = px;
}`;

  const DRAW_FS = `#version 300 es
precision highp float;
in vec3 vCol;
in float vAng;
in float vPx;
in float vInner;
out vec4 fragColor;

// Five-pointed star signed distance (Inigo Quilez). r = outer radius, rf = inner/outer ratio.
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}

void main() {
  vec2 p = (gl_PointCoord - 0.5) * 2.0;
  p.y = -p.y;
  float r2 = dot(p, p);
  float rl = sqrt(r2);

  // Tiny sprites are just soft round dots (cheap).
  float inten = exp(-r2 * 3.5) * (1.0 - smoothstep(0.6, 1.0, rl));
  float hot = 0.0;

  // Bigger sprites fade into the real star shape.
  float m = smoothstep(2.5, 6.0, vPx);
  if (m > 0.0) {
    float c = cos(vAng);
    float s = sin(vAng);
    vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    float d = sdStar5(q, 0.6, vInner);
    float aa = 1.5 / vPx + 0.015;
    float fill = 1.0 - smoothstep(-aa, aa, d);
    float rim = exp(min(d, 0.0) * 12.0);                 // brighter toward the outline: cartoon edge light
    float core = exp(-r2 * 7.0);                         // hot centre
    float win = 1.0 - smoothstep(0.7, 1.0, rl);          // keeps the glow inside the sprite quad
    float glow = exp(-max(d, 0.0) * 8.0) * 0.3 * win;
    float star = fill * (0.62 + 0.55 * rim + 0.5 * core) + glow;
    inten = mix(inten, star, m);
    hot = fill * core * m;
  }
  if (inten < 0.004) discard;

  float lum = dot(vCol, vec3(0.3333));
  fragColor = vec4(vCol * inten + vec3(hot * 0.3 * lum), 1.0);
}`;

  /* ------------------------------------------------------------------ */
  /* Helpers (CPU init only)                                             */
  /* ------------------------------------------------------------------ */
  const fract = (x) => x - Math.floor(x);
  function hash11(p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

  class StarburstScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.simProg = ctx.program(SIM_VS, SIM_FS, { label: 'starburst-sim', varyings: ['vPos', 'vVel', 'vSeed'] });
      try {
        this.drawProg = ctx.program(DRAW_VS, DRAW_FS, { label: 'starburst-draw' });
      } catch (e) {
        this.simProg.dispose();
        throw e;
      }
      this.tf = gl.createTransformFeedback();
      this.posB = this.velB = this.seedB = this.vaos = null;
      this.count = 0;
      this.cur = 0;            // index of the buffer set that holds the latest state
      this.spin = 0;
      this.vp = new Float32Array(16);
      let maxPx = 48;
      try {
        const r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
        if (r && r[1] > 1) maxPx = Math.min(48, r[1]);
      } catch (e) { /* keep default */ }
      this.maxPx = maxPx;
      this._alloc(200000);
    }

    _free() {
      const gl = this.gl;
      if (this.vaos) this.vaos.forEach((v) => gl.deleteVertexArray(v));
      [this.posB, this.velB, this.seedB].forEach((arr) => { if (arr) arr.forEach((b) => gl.deleteBuffer(b)); });
      this.vaos = this.posB = this.velB = this.seedB = null;
    }

    /** (Re)create the two ping-pong buffer sets and VAOs with `count` particles on the shell. */
    _alloc(count) {
      const gl = this.gl;
      this._free();
      this.count = count;
      this.cur = 0;
      const pos = new Float32Array(count * 3);
      const vel = new Float32Array(count * 3);
      const seed = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const sx = Math.random();
        // Frequency band: stars live in the mids (0.25..0.68 of the spectrum), slightly biased low.
        const bt = 0.25 + 0.43 * Math.pow(Math.random(), 1.1);
        // Size factor: mostly small sparkles, ~10% big, clearly star-shaped ones.
        const ru = Math.random();
        const sz = Math.random() < 0.9 ? 0.4 + 0.9 * ru * ru : 1.6 + 2.0 * ru;
        // Same home-direction formula as the update shader (spin = 0).
        const cz = sx * 2 - 1;
        const ph = TAU * ((bt - 0.25) / 0.43 + (hash11(sx * 91.37 + 1.0) - 0.5) * 0.30);
        const sr = Math.sqrt(Math.max(1 - cz * cz, 0));
        const r0 = 0.8 * (0.86 + 0.28 * hash11(sx * 57.13 + 7.0));
        pos[i * 3] = sr * Math.cos(ph) * r0 + (Math.random() - 0.5) * 0.04;
        pos[i * 3 + 1] = cz * r0 + (Math.random() - 0.5) * 0.04;
        pos[i * 3 + 2] = sr * Math.sin(ph) * r0 + (Math.random() - 0.5) * 0.04;
        vel[i * 3] = (Math.random() - 0.5) * 0.2;
        vel[i * 3 + 1] = (Math.random() - 0.5) * 0.2;
        vel[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
        seed[i * 4] = sx;
        seed[i * 4 + 1] = bt;
        seed[i * 4 + 2] = sz;
        seed[i * 4 + 3] = Math.random() * TAU;
      }
      const mk = (data) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_COPY);
        return b;
      };
      // Both sets start with identical data so either one is a valid source.
      this.posB = [mk(pos), mk(pos)];
      this.velB = [mk(vel), mk(vel)];
      this.seedB = [mk(seed), mk(seed)];
      // One VAO per set; the same layout (locations 0,1,2) serves the update and the render pass.
      this.vaos = [0, 1].map((s) => {
        const v = gl.createVertexArray();
        gl.bindVertexArray(v);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.posB[s]);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.velB[s]);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.seedB[s]);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        return v;
      });
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    resize() { /* resolution is read from u.width / u.height each frame */ }

    render(target, audio, u) {
      const gl = this.gl, ctx = this.ctx, mat4 = VIZ.mat4;
      const P = u.params || {};
      const pv = (k, d) => (P[k] === undefined ? d : +P[k]);
      const want = Math.max(1000, Math.round(pv('count', 200000)));
      if (want !== this.count) this._alloc(want);
      const size = pv('size', 1), burst = pv('burst', 1), swirl = pv('swirl', 1), spread = pv('spread', 1);
      const dt = Math.min(Math.max(u.dt || 0.016, 0.0005), 0.05);

      // The shell slowly rotates; louder mids spin it faster.
      this.spin = (this.spin + dt * (0.10 + 0.30 * audio.mid * swirl + 0.15 * audio.level)) % TAU;

      // Camera: slow orbit with a gentle vertical bob, backs off when the shell is spread wide.
      const t = u.time;
      const az = t * 0.12;
      const el = 0.10 + 0.22 * Math.sin(t * 0.21);
      const dist = (4.2 + 1.3 * (spread - 1.0)) * (u.width < u.height ? 1.35 : 1.0);
      const ce = Math.cos(el);
      const eye = [Math.sin(az) * ce * dist, Math.sin(el) * dist, Math.cos(az) * ce * dist];
      const view = mat4.lookAt(eye, [0, 0, 0], [0, 1, 0]);
      const proj = mat4.perspective(50 * Math.PI / 180, u.width / Math.max(1, u.height), 0.05, 40);
      mat4.multiply(proj, view, this.vp);

      // Window movement -> world-space acceleration along the camera's screen axes.
      // Moving the window right throws stars left, moving it up throws them down (inertia).
      const mo = u.motion || {};
      let sx = -(mo.vx || 0) * 0.0015, sy = (mo.vy || 0) * 0.0015;
      const sm = Math.hypot(sx, sy);
      if (sm > 9) { sx *= 9 / sm; sy *= 9 / sm; }
      const shx = view[0] * sx + view[1] * sy;   // camera right = (view[0], view[4], view[8])
      const shy = view[4] * sx + view[5] * sy;   // camera up    = (view[1], view[5], view[9])
      const shz = view[8] * sx + view[9] * sy;

      // ---- update pass: read set `src`, write set `dst` through transform feedback ----
      const src = this.cur, dst = 1 - src;
      const sp = this.simProg.use();
      ctx.setCommon(sp, audio, u);
      sp.f('uSimDt', dt)
        .f('uSpin', this.spin)
        .f('uSwirl', swirl)
        .f('uBurst', burst)
        .f('uSpread', spread)
        .f('uBeatId', (audio.beatCount | 0) % 4096)
        .f('uTick', (u.time * 60.0) % 997.0)
        .f3('uShove', shx, shy, shz);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.bindVertexArray(this.vaos[src]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.tf);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.posB[dst]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, this.velB[dst]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 2, this.seedB[dst]);
      gl.beginTransformFeedback(gl.POINTS);
      gl.drawArrays(gl.POINTS, 0, this.count);
      gl.endTransformFeedback();
      for (let i = 0; i < 3; i++) gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, i, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
      gl.disable(gl.RASTERIZER_DISCARD);
      this.cur = dst;

      // ---- render pass: additive star sprites from the freshly written set ----
      const dp = this.drawProg.use();
      ctx.setCommon(dp, audio, u);
      dp.m4('uViewProj', this.vp)
        .f('uSize', size)
        .f('uBright', 0.075 * Math.sqrt(150000 / this.count))
        .f('uCamDist', dist)
        .f('uMaxPx', this.maxPx);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.bindVertexArray(this.vaos[this.cur]);
      gl.drawArrays(gl.POINTS, 0, this.count);

      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    dispose() {
      const gl = this.gl;
      this._free();
      if (this.tf) gl.deleteTransformFeedback(this.tf);
      this.tf = null;
      this.simProg.dispose();
      this.drawProg.dispose();
    }
  }

  VIZ.registerScene({
    id: 'starburst',
    name: 'Starburst',
    blurb: 'A swarm of GPU-simulated stars forms a breathing, frequency-coloured globe; beats shatter it into a supernova.',
    params: [
      { key: 'count', label: 'Particles', min: 50000, max: 400000, step: 50000, value: 200000, fmt: (v) => Math.round(v / 1000) + 'k' },
      { key: 'size', label: 'Star size', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'burst', label: 'Beat burst', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'swirl', label: 'Swirl', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'spread', label: 'Shell spread', min: 0.5, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new StarburstScene(ctx),
  });
})();
