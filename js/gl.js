/* gl.js — tiny dependency-free WebGL2 toolkit shared by every scene.
 * Exposes window.VIZ.initGL(canvas) -> ctx, plus VIZ.mat4 and VIZ.glsl snippets.
 */
(function () {
  'use strict';
  const VIZ = (window.VIZ = window.VIZ || {});

  // Fullscreen triangle: no buffers, driven by gl_VertexID.
  const FS_TRIANGLE_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  function numbered(src) {
    return src.split('\n').map((l, i) => String(i + 1).padStart(3, ' ') + ': ' + l).join('\n');
  }

  function compileShader(gl, type, src, label) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
      console.error(`[gl] ${label} ${kind} shader failed:\n${log}\n${numbered(src)}`);
      gl.deleteShader(sh);
      throw new Error(`Shader compile failed (${label}, ${kind}): ${log}`);
    }
    return sh;
  }

  class Program {
    constructor(gl, vsSrc, fsSrc, opts = {}) {
      this.gl = gl;
      this.label = opts.label || 'program';
      const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc, this.label);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc, this.label);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      if (opts.varyings) gl.transformFeedbackVaryings(prog, opts.varyings, gl.SEPARATE_ATTRIBS);
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(prog);
        gl.deleteProgram(prog);
        throw new Error(`[gl] link failed (${this.label}): ${log}`);
      }
      this.prog = prog;
      this.uniforms = new Map();
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(prog, i);
        const base = info.name.replace(/\[0\]$/, '');
        this.uniforms.set(base, gl.getUniformLocation(prog, info.name));
      }
      this._unit = 0;
    }
    use() { this.gl.useProgram(this.prog); this._unit = 0; return this; }
    loc(name) { const l = this.uniforms.get(name); return l === undefined ? null : l; }
    f(name, x) { const l = this.loc(name); if (l) this.gl.uniform1f(l, x); return this; }
    f2(name, x, y) { const l = this.loc(name); if (l) this.gl.uniform2f(l, x, y); return this; }
    f3(name, x, y, z) { const l = this.loc(name); if (l) this.gl.uniform3f(l, x, y, z); return this; }
    f4(name, x, y, z, w) { const l = this.loc(name); if (l) this.gl.uniform4f(l, x, y, z, w); return this; }
    i(name, x) { const l = this.loc(name); if (l) this.gl.uniform1i(l, x); return this; }
    fv(name, arr) { const l = this.loc(name); if (l) this.gl.uniform1fv(l, arr); return this; }
    f2v(name, arr) { const l = this.loc(name); if (l) this.gl.uniform2fv(l, arr); return this; }
    f3v(name, arr) { const l = this.loc(name); if (l) this.gl.uniform3fv(l, arr); return this; }
    f4v(name, arr) { const l = this.loc(name); if (l) this.gl.uniform4fv(l, arr); return this; }
    m4(name, m) { const l = this.loc(name); if (l) this.gl.uniformMatrix4fv(l, false, m); return this; }
    tex(name, texture) {
      const l = this.loc(name);
      if (!l) return this;
      const gl = this.gl;
      const unit = this._unit++;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(l, unit);
      return this;
    }
    dispose() { this.gl.deleteProgram(this.prog); }
  }

  function createTexture(gl, opts = {}) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const filter = opts.filter === undefined ? gl.LINEAR : opts.filter;
    const wrap = opts.wrap === undefined ? gl.CLAMP_TO_EDGE : opts.wrap;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (opts.width) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(
        gl.TEXTURE_2D, 0,
        opts.internalFormat === undefined ? gl.RGBA8 : opts.internalFormat,
        opts.width, opts.height || 1, 0,
        opts.format === undefined ? gl.RGBA : opts.format,
        opts.type === undefined ? gl.UNSIGNED_BYTE : opts.type,
        opts.data || null
      );
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  /** Offscreen render target (colour texture + optional depth). */
  class RenderTarget {
    constructor(gl, w, h, opts = {}) {
      this.gl = gl;
      this.opts = opts;
      this.fb = gl.createFramebuffer();
      this.tex = null;
      this.depth = null;
      this.w = 0; this.h = 0;
      this.hdr = !!opts.hdr && VIZ.caps.floatFBO;
      this.resize(w, h);
    }
    resize(w, h) {
      w = Math.max(1, w | 0); h = Math.max(1, h | 0);
      if (this.w === w && this.h === h) return;
      const gl = this.gl;
      this.w = w; this.h = h;
      if (this.tex) gl.deleteTexture(this.tex);
      if (this.depth) gl.deleteRenderbuffer(this.depth);
      this.tex = createTexture(gl, {
        width: w, height: h,
        internalFormat: this.hdr ? gl.RGBA16F : gl.RGBA8,
        format: gl.RGBA,
        type: this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
        filter: this.opts.filter === undefined ? gl.LINEAR : this.opts.filter,
        wrap: this.opts.wrap === undefined ? gl.CLAMP_TO_EDGE : this.opts.wrap,
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
      if (this.opts.depth) {
        this.depth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth);
        gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      } else {
        this.depth = null;
      }
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) console.warn('[gl] framebuffer incomplete:', status);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    bind() {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
      gl.viewport(0, 0, this.w, this.h);
    }
    clear(r = 0, g = 0, b = 0, a = 1) {
      const gl = this.gl;
      gl.clearColor(r, g, b, a);
      gl.clear(gl.COLOR_BUFFER_BIT | (this.depth ? gl.DEPTH_BUFFER_BIT : 0));
    }
    dispose() {
      const gl = this.gl;
      if (this.tex) gl.deleteTexture(this.tex);
      if (this.depth) gl.deleteRenderbuffer(this.depth);
      gl.deleteFramebuffer(this.fb);
      this.tex = null; this.depth = null; this.fb = null;
    }
  }

  // ---- mat4 helpers (column-major Float32Array(16)) ----
  const mat4 = {
    identity() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    multiply(a, b, out) {
      out = out || new Float32Array(16);
      const r = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let rI = 0; rI < 4; rI++) {
        r[c * 4 + rI] = a[rI] * b[c * 4] + a[4 + rI] * b[c * 4 + 1] + a[8 + rI] * b[c * 4 + 2] + a[12 + rI] * b[c * 4 + 3];
      }
      out.set(r);
      return out;
    },
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      const m = new Float32Array(16);
      m[0] = f / aspect; m[5] = f; m[10] = (far + near) * nf; m[11] = -1; m[14] = 2 * far * near * nf;
      return m;
    },
    lookAt(eye, center, up) {
      let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
      let len = Math.hypot(zx, zy, zz) || 1; zx /= len; zy /= len; zz /= len;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      len = Math.hypot(xx, xy, xz) || 1; xx /= len; xy /= len; xz /= len;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      const m = new Float32Array(16);
      m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
      m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
      m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
      m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
      m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
      m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
      m[15] = 1;
      return m;
    },
    rotationY(a) { const m = mat4.identity(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; },
    rotationX(a) { const m = mat4.identity(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; },
    rotationZ(a) { const m = mat4.identity(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; },
    translation(x, y, z) { const m = mat4.identity(); m[12] = x; m[13] = y; m[14] = z; return m; },
    scale(x, y, z) { const m = mat4.identity(); m[0] = x; m[5] = y; m[10] = z; return m; },
  };

  // ---- shared GLSL snippets ----
  const glsl = {
    // Standard uniforms every scene program may declare (set via ctx.setCommon).
    common: `
uniform float uTime;
uniform float uDt;
uniform vec2  uRes;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uLevel;
uniform float uBeat;
uniform float uPulse;
uniform float uIntensity;
uniform vec3  uCol[4];
uniform sampler2D uBands;   // x = smoothed, y = raw, z = peak-hold (width 128)
uniform sampler2D uWave;    // r = waveform 0..1 (width 512)
float band(float t) { return texture(uBands, vec2(clamp(t, 0.0, 1.0), 0.5)).x; }
float bandRaw(float t) { return texture(uBands, vec2(clamp(t, 0.0, 1.0), 0.5)).y; }
float bandPeak(float t) { return texture(uBands, vec2(clamp(t, 0.0, 1.0), 0.5)).z; }
float wave(float t) { return texture(uWave, vec2(fract(t), 0.5)).r * 2.0 - 1.0; }
vec3 palette(float t) {
  t = clamp(t, 0.0, 1.0) * 3.0;
  float i = floor(t);
  float f = smoothstep(0.0, 1.0, t - i);
  int a = int(i);
  int b = int(min(i + 1.0, 3.0));
  return mix(uCol[a], uCol[b], f);
}
`,
    noise: `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm2(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise2(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise3(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`,
    tonemap: `
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
`,
  };

  VIZ.initGL = function (canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return null;
    VIZ.caps = {
      floatFBO: !!gl.getExtension('EXT_color_buffer_float'),
      floatLinear: !!gl.getExtension('OES_texture_float_linear'),
      maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
    const emptyVao = gl.createVertexArray();

    const ctx = {
      gl,
      caps: VIZ.caps,
      canvas,
      width: 1,
      height: 1,
      /** Draw one fullscreen triangle with the currently bound program. */
      drawQuad() {
        gl.bindVertexArray(emptyVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
      },
      /** Program whose vertex stage is the fullscreen triangle. */
      fsProgram(fsSrc, label) { return new Program(gl, FS_TRIANGLE_VS, fsSrc, { label }); },
      program(vsSrc, fsSrc, opts) { return new Program(gl, vsSrc, fsSrc, opts); },
      createTarget(w, h, opts) { return new RenderTarget(gl, w, h, opts); },
      createTexture(opts) { return createTexture(gl, opts); },
      bindScreen() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
      },
      /** Push the standard uniform block (see glsl.common) for a bound program. */
      setCommon(p, audio, u) {
        p.f('uTime', u.time).f('uDt', u.dt).f2('uRes', u.width, u.height)
          .f('uBass', audio.bass).f('uMid', audio.mid).f('uHigh', audio.high).f('uLevel', audio.level)
          .f('uBeat', audio.beat).f('uPulse', audio.beatPulse).f('uIntensity', u.intensity)
          .f3v('uCol', u.palette)
          .tex('uBands', u.bandTex).tex('uWave', u.waveTex);
      },
    };
    return ctx;
  };

  VIZ.Program = Program;
  VIZ.RenderTarget = RenderTarget;
  VIZ.mat4 = mat4;
  VIZ.glsl = glsl;
  VIZ.FS_TRIANGLE_VS = FS_TRIANGLE_VS;
})();
