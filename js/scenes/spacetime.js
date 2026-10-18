/* spacetime.js — Spacetime Fabric.
 * A 3D sheet of spacetime bent by gravity wells: a central mass that grows with the bass and six
 * bodies on Keplerian orbits, each tied to a frequency band (its mass follows that band's energy,
 * so the sheet sags where the music is). Beats launch gravitational-wave ripples from the centre.
 * Press the mouse to drop your own mass on the sheet; move the window to shake the camera.
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const mat4 = VIZ.mat4;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const EXTENT = 1.6;

  const HEIGHT_GLSL = `
uniform vec4 uMass[16];     // x, z, mass, bandT
uniform int uMassCount;
uniform float uWaveAmp;
uniform float uDepth;
uniform float uDrift;
uniform sampler2D uWaveHist;   // rolling history of the bass (kick) envelope, 120 samples/s, 512 wide
uniform float uHistHead;       // index of the newest sample
const float WAVE_C = 1.25;     // wave speed, world units per second
// The bass envelope as it was a given number of seconds ago.
float bassAgo(float ago) {
  float idx = uHistHead - ago * 120.0;
  return texture(uWaveHist, vec2((idx + 0.5) / 512.0, 0.5)).r;
}
float sheetHeight(vec2 p) {
  float y = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uMassCount) break;
    vec2 d = p - uMass[i].xy;
    y -= uMass[i].z / sqrt(dot(d, d) + 0.012);
  }
  y *= uDepth * 0.11;
  // Gravitational waves ARE the bass: the height at radius r is the bass level from the moment that
  // wave left the centre (r / c seconds ago), as a crest with a shallow trough trailing it. No carrier,
  // so one hit is exactly one ring and the gap between rings is the time between hits.
  if (uWaveAmp > 0.001) {
    float r = length(p);
    float ago = r / WAVE_C;
    float crest = bassAgo(ago);
    float trough = bassAgo(ago + 0.1);
    y += uWaveAmp * 0.08 * (crest - 0.45 * trough) * exp(-r * 0.4) * smoothstep(0.0, 0.1, r);
  }
  return y;
}`;

  const GRID_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aXZ;
${VIZ.glsl.common}
${HEIGHT_GLSL}
uniform mat4 uViewProj;
out float vDepth;
out float vFog;
void main() {
  float y = sheetHeight(aXZ);
  vec4 clip = uViewProj * vec4(aXZ.x, y, aXZ.y, 1.0);
  vDepth = y;
  vFog = clip.w;
  gl_Position = clip;
}`;

  const LINE_FS = `#version 300 es
precision highp float;
in float vDepth;
in float vFog;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
void main() {
  float d = clamp(-vDepth * 1.8, 0.0, 1.0);
  vec3 col = palette(0.3 + 0.7 * d) * (0.18 + 1.8 * d * d + 0.1 * uLevel);
  col += palette(0.95) * max(vDepth, 0.0) * 6.0;             // ripple crests flash bright (bass)
  // Highs: glints race along the grid on high-frequency onsets.
  float glint = step(0.975, hash12(floor(gl_FragCoord.xy / 3.0) + floor(uTime * 24.0)));
  col += palette(0.85) * glint * (0.5 * uHigh + 1.2 * uHighPulse);
  float fog = exp(-max(vFog - 1.6, 0.0) * 0.45);
  fragColor = vec4(col * fog, 1.0);
}`;

  const FILL_FS = `#version 300 es
precision highp float;
in float vDepth;
in float vFog;
out vec4 fragColor;
${VIZ.glsl.common}
void main() {
  float d = clamp(-vDepth * 1.8, 0.0, 1.0);
  vec3 col = uCol[0] * 0.25 + palette(0.2 + 0.6 * d) * (0.5 * d * d);
  float fog = exp(-max(vFog - 1.6, 0.0) * 0.45);
  fragColor = vec4(col * fog, 1.0);
}`;

  const BODY_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 aBody;   // x, z, mass, bandT
layout(location = 1) in float aKind;  // 0 = orbiting body, 1 = central mass, 2 = pointer mass
${VIZ.glsl.common}
${HEIGHT_GLSL}
uniform mat4 uViewProj;
out vec3 vCol;
out float vSpin;
out float vKind;
void main() {
  float y = sheetHeight(aBody.xy) + 0.02 + 0.05 * aBody.z;
  vec4 clip = uViewProj * vec4(aBody.x, y, aBody.y, 1.0);
  float e = aKind > 0.5 ? uBass : bandMid(aBody.w);                 // bodies are lit by the mids
  float px = (18.0 + 90.0 * aBody.z) * (1.0 + 0.6 * e + 0.35 * uMidPulse) * (uRes.y / 1080.0) * 2.2 / max(clip.w, 0.2);
  gl_PointSize = clamp(px, 4.0, 160.0);
  vCol = (aKind > 0.5 ? palette(0.95) : palette(0.35 + 0.65 * aBody.w)) * (0.8 + 2.5 * e);
  vSpin = uTime * (0.4 + aBody.w) + aBody.w * 6.28;
  vKind = aKind;
  gl_Position = clip;
}`;

  const BODY_FS = `#version 300 es
precision highp float;
in vec3 vCol;
in float vSpin;
in float vKind;
out vec4 fragColor;
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
  float c = cos(vSpin), s = sin(vSpin);
  vec2 q = mat2(c, -s, s, c) * p;
  float d = sdStar5(q, 0.55, 0.5);
  float aa = fwidth(d) * 1.5 + 0.01;
  float fill = 1.0 - smoothstep(-aa, aa, d);
  float rim = 1.0 - smoothstep(0.0, 0.1, abs(d));
  float glow = exp(-max(d, 0.0) * 5.0) * (1.0 - smoothstep(0.6, 1.0, length(p)));
  vec3 col = vCol * (fill * 1.6 + glow * 0.5);
  col = mix(col, vCol * 0.15, rim * fill * 0.7);
  float a = max(fill, glow * 0.6);
  if (a < 0.01) discard;
  fragColor = vec4(col, a);
}`;

  const BG_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
void main() {
  vec3 col = uCol[0] * mix(0.12, 0.45, vUv.y);
  vec2 g = vUv * vec2(uRes.x / uRes.y, 1.0) * 60.0;
  vec2 id = floor(g);
  float h = hash12(id);
  vec2 f = fract(g) - 0.5;
  float star = smoothstep(0.08, 0.0, length(f - (hash33(vec3(id, 1.0)).xy - 0.5) * 0.6)) * step(0.93, h);
  float tw = 0.5 + 0.5 * sin(uTime * (1.0 + 3.0 * h) + h * 20.0);
  col += palette(0.6 + 0.4 * h) * star * (0.3 + 0.7 * tw) * (0.6 + 0.6 * uHigh);
  fragColor = vec4(col, 1.0);
}`;

  class SpacetimeScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.progBg = ctx.fsProgram(BG_FS, 'spacetime-bg');
      this.progLine = ctx.program(GRID_VS, LINE_FS, { label: 'spacetime-lines' });
      this.progFill = ctx.program(GRID_VS, FILL_FS, { label: 'spacetime-fill' });
      this.progBody = ctx.program(BODY_VS, BODY_FS, { label: 'spacetime-bodies' });
      this.n = 0;
      this.vbo = null; this.lineIbo = null; this.fillIbo = null; this.vao = null;
      this.lineCount = 0; this.fillCount = 0;
      this.bodyBuf = gl.createBuffer();
      this.bodyVao = gl.createVertexArray();
      gl.bindVertexArray(this.bodyVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bodyBuf);
      gl.bufferData(gl.ARRAY_BUFFER, 16 * 5 * 4, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.bodies = [];
      this._setBodyCount(6);
      this.massData = new Float32Array(64);
      this.bodyData = new Float32Array(80);
      // Bass history ring buffer feeding the waves (4.3 s at 120 Hz).
      this.hist = new Uint8Array(512);
      this.histPos = 0;
      this.histAcc = 0;
      this.histTex = ctx.createTexture({ width: 512, height: 1, internalFormat: gl.R8, format: gl.RED, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR, wrap: gl.REPEAT, data: this.hist });
      this.vp = new Float32Array(16);
      this.shake = { x: 0, y: 0, vx: 0, vy: 0 };
      this.ptrMass = 0;
      this.ptrPos = [0, 0];
      this.centralMass = 0.3;
      this._buildGrid(112);
    }

    /** Deterministic orbit set: adding bodies appends, removing trims, existing orbits are untouched. */
    _setBodyCount(n) {
      n = clamp(Math.round(n), 1, 12);
      while (this.bodies.length > n) this.bodies.pop();
      while (this.bodies.length < n) {
        const i = this.bodies.length;
        const f = (k) => ((i + 1) * k) % 1;              // cheap deterministic spread
        this.bodies.push({
          r: 0.38 + 1.0 * f(0.618),
          phase: i * 2.399,
          ecc: 0.75 + 0.2 * f(0.37),
          weight: 0.6 + 0.5 * f(0.71),
          bandT: f(0.5) * 0.9 + 0.05,
        });
      }
      // Spread the bodies' mid bands evenly so each one lights up with a different part of the mix.
      this.bodies.forEach((b, i) => { b.bandT = (i + 0.5) / this.bodies.length; });
    }

    _buildGrid(n) {
      const gl = this.gl;
      if (this.vao) { gl.deleteVertexArray(this.vao); gl.deleteBuffer(this.vbo); gl.deleteBuffer(this.lineIbo); gl.deleteBuffer(this.fillIbo); }
      this.n = n;
      const verts = new Float32Array(n * n * 2);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const o = (j * n + i) * 2;
        verts[o] = (i / (n - 1) - 0.5) * 2 * EXTENT;
        verts[o + 1] = (j / (n - 1) - 0.5) * 2 * EXTENT;
      }
      const lines = new Uint32Array(2 * 2 * n * (n - 1));
      let k = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n - 1; i++) { lines[k++] = j * n + i; lines[k++] = j * n + i + 1; }
      for (let i = 0; i < n; i++) for (let j = 0; j < n - 1; j++) { lines[k++] = j * n + i; lines[k++] = (j + 1) * n + i; }
      const tris = new Uint32Array(6 * (n - 1) * (n - 1));
      k = 0;
      for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        tris[k++] = a; tris[k++] = c; tris[k++] = b;
        tris[k++] = b; tris[k++] = c; tris[k++] = d;
      }
      this.vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
      this.lineIbo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, lines, gl.STATIC_DRAW);
      this.fillIbo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fillIbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tris, gl.STATIC_DRAW);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      this.lineCount = lines.length;
      this.fillCount = tris.length;
    }

    resize() { /* camera uses u.aspect */ }

    render(target, audio, u) {
      const gl = this.gl, ctx = this.ctx, P = u.params;
      const dt = Math.min(u.dt, 0.05);
      const grid = clamp(Math.round(P.grid / 16) * 16, 48, 192);
      if (grid !== this.n) this._buildGrid(grid);
      if (Math.round(P.bodies) !== this.bodies.length) this._setBodyCount(P.bodies);

      // Orbits (Kepler: angular speed ~ r^-1.5). With idle motion at 0 nothing moves without music.
      const drift = P.drift;
      const speed = P.speed * (0.55 * drift + 0.5 * audio.mid + 0.3 * audio.level);
      let mc = 0;
      // Record the bass hit level at 120 Hz (short release, so each hit is a crisp ring); the waves
      // read it back delayed by distance.
      const kick = audio.kick;
      const raw = audio.kickRaw || 0;
      this.waveEnv = (this.waveEnv || 0) + (raw - (this.waveEnv || 0)) * (1 - Math.exp(-dt / (raw > (this.waveEnv || 0) ? 0.008 : 0.06)));
      this.histAcc += dt;
      const step = 1 / 120;
      while (this.histAcc >= step) {
        this.hist[this.histPos] = Math.round(clamp(this.waveEnv, 0, 1) * 255);
        this.histPos = (this.histPos + 1) % 512;
        this.histAcc -= step;
      }
      gl.bindTexture(gl.TEXTURE_2D, this.histTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 1, gl.RED, gl.UNSIGNED_BYTE, this.hist);
      gl.bindTexture(gl.TEXTURE_2D, null);
      const histHead = (this.histPos + 511) % 512 + this.histAcc / step;

      // Wells deepen with the bass hit, scaled by its loudness (a loud drop digs deeper than a quiet
      // verse) and by the Bass depth slider.
      const dig = kick * (0.55 + 0.75 * audio.bass) * P.bassDepth;
      this.centralMass += ((0.2 + 0.15 * drift + 0.5 * dig) - this.centralMass) * (1 - Math.exp(-dt / 0.05));
      this.massData[0] = 0; this.massData[1] = 0; this.massData[2] = this.centralMass; this.massData[3] = 0; mc++;
      for (const b of this.bodies) {
        b.phase += dt * speed * 0.75 * Math.pow(b.r, -1.5);
        b.mass = (0.05 * drift + 0.1 + 0.2 * dig) * b.weight;      // wells: bass; the sprites' light: mids (shader)
        b.x = Math.cos(b.phase) * b.r;
        b.z = Math.sin(b.phase) * b.r * b.ecc;
        const o = mc * 4;
        this.massData[o] = b.x; this.massData[o + 1] = b.z; this.massData[o + 2] = b.mass; this.massData[o + 3] = b.bandT;
        mc++;
      }

      // Camera: slow orbit, shaken by window motion (damped spring).
      const sk = this.shake;
      sk.vx += (-u.motion.vx * 0.0012 - sk.x * 40 - sk.vx * 7) * dt;
      sk.vy += (u.motion.vy * 0.0012 - sk.y * 40 - sk.vy * 7) * dt;
      sk.x += sk.vx * dt; sk.y += sk.vy * dt;
      const az = u.time * (0.03 + 0.05 * drift) + sk.x * 0.6;
      const el = 0.5 + drift * 0.1 * Math.sin(u.time * 0.19) + sk.y * 0.6;
      const dist = 2.9 + (u.aspect < 1 ? 0.9 : 0);
      const eye = [Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.sin(az) * Math.cos(el) * dist];
      const view = mat4.lookAt(eye, [0, -0.1, 0], [0, 1, 0]);
      const fov = 48 * Math.PI / 180;
      const proj = mat4.perspective(fov, u.aspect, 0.1, 30);
      mat4.multiply(proj, view, this.vp);

      // Pointer mass: unproject onto the y = 0 plane.
      const target01 = u.pointer.down ? 1 : 0;
      this.ptrMass += (target01 - this.ptrMass) * (1 - Math.exp(-dt / 0.15));
      if (u.pointer.down) {
        const fwd = [-eye[0], -0.1 - eye[1], -eye[2]];
        const fl = Math.hypot(fwd[0], fwd[1], fwd[2]); fwd[0] /= fl; fwd[1] /= fl; fwd[2] /= fl;
        const right = [fwd[2], 0, -fwd[0]];
        const rl = Math.hypot(right[0], right[2]) || 1; right[0] /= rl; right[2] /= rl;
        const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
        const th = Math.tan(fov / 2);
        const nx = (u.pointer.x - 0.5) * 2 * th * u.aspect, ny = (u.pointer.y - 0.5) * 2 * th;
        const dir = [fwd[0] + right[0] * nx + up[0] * ny, fwd[1] + right[1] * nx + up[1] * ny, fwd[2] + right[2] * nx + up[2] * ny];
        if (dir[1] < -1e-4) {
          const t = -eye[1] / dir[1];
          this.ptrPos[0] = clamp(eye[0] + dir[0] * t, -EXTENT, EXTENT);
          this.ptrPos[1] = clamp(eye[2] + dir[2] * t, -EXTENT, EXTENT);
        }
      }
      if (this.ptrMass > 0.01 && mc < 16) {
        const o = mc * 4;
        this.massData[o] = this.ptrPos[0]; this.massData[o + 1] = this.ptrPos[1]; this.massData[o + 2] = 0.7 * this.ptrMass; this.massData[o + 3] = 0.5;
        mc++;
      }

      // Body sprites: orbiting bodies, central mass, pointer mass.
      const bd = this.bodyData;
      let nb = 0;
      for (let i = 0; i < mc; i++) {
        const o = nb * 5;
        bd[o] = this.massData[i * 4]; bd[o + 1] = this.massData[i * 4 + 1]; bd[o + 2] = this.massData[i * 4 + 2]; bd[o + 3] = this.massData[i * 4 + 3];
        bd[o + 4] = i === 0 ? 1 : (i === mc - 1 && this.ptrMass > 0.01 ? 2 : 0);
        nb++;
      }

      const setHeight = (p) => {
        ctx.setCommon(p, audio, u);
        p.m4('uViewProj', this.vp).f4v('uMass', this.massData).i('uMassCount', mc)
          .tex('uWaveHist', this.histTex).f('uHistHead', histHead)
          .f('uWaveAmp', P.wave).f('uDepth', P.depth).f('uDrift', drift);
      };

      // --- draw ---
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      const bg = this.progBg.use();
      ctx.setCommon(bg, audio, u);
      ctx.drawQuad();

      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.bindVertexArray(this.vao);
      // Opaque surface, pushed back so the lines win the depth test.
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.5, 2.0);
      const fp = this.progFill.use();
      setHeight(fp);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fillIbo);
      gl.drawElements(gl.TRIANGLES, this.fillCount, gl.UNSIGNED_INT, 0);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      // Glowing grid lines (additive).
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      const lp = this.progLine.use();
      setHeight(lp);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIbo);
      gl.drawElements(gl.LINES, this.lineCount, gl.UNSIGNED_INT, 0);
      // Bodies as cartoon stars.
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bodyBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, bd, 0, nb * 5);
      const bp = this.progBody.use();
      setHeight(bp);
      gl.bindVertexArray(this.bodyVao);
      gl.drawArrays(gl.POINTS, 0, nb);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(true);
    }

    dispose() {
      const gl = this.gl;
      [this.progBg, this.progLine, this.progFill, this.progBody].forEach((p) => p.dispose());
      if (this.vao) { gl.deleteVertexArray(this.vao); gl.deleteBuffer(this.vbo); gl.deleteBuffer(this.lineIbo); gl.deleteBuffer(this.fillIbo); }
      gl.deleteVertexArray(this.bodyVao);
      gl.deleteBuffer(this.bodyBuf);
      gl.deleteTexture(this.histTex);
    }
  }

  VIZ.registerScene({
    id: 'spacetime',
    name: 'Spacetime Fabric',
    blurb: 'A sheet of spacetime bent by orbiting bodies. The gravitational waves are the bass itself travelling outward: a kick is one ring, an 808 a band of them. Bodies glow with the mids. Press to drop a mass.',
    params: [
      { key: 'depth', label: 'Gravity well depth', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'bassDepth', label: 'Bass depth (how far hits dig)', min: 0, max: 4, step: 0.05, value: 1.3 },
      { key: 'wave', label: 'Gravitational waves (bass)', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'speed', label: 'Orbit speed', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'bodies', label: 'Bodies (stars)', min: 1, max: 12, step: 1, value: 6, fmt: (v) => String(Math.round(v)) },
      { key: 'drift', label: 'Idle motion (without music)', min: 0, max: 1, step: 0.01, value: 0 },
      { key: 'grid', label: 'Grid density', min: 48, max: 192, step: 16, value: 112, fmt: (v) => v + ' × ' + v },
    ],
    create: (ctx) => new SpacetimeScene(ctx),
  });
})();
