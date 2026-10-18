/* post.js — HDR post-processing and the layered effects stack.
 *
 * Scene (linear HDR) -> bloom chain -> pass A (UV warps: bass shake, bulge, kaleidoscope, mirror;
 * chromatic aberration; fractal tiling; echo trails) -> pass B (ACES tonemap, cel shading + ink,
 * halftone, scanlines, negative flash, vignette, grain) -> screen.
 *
 * The universal band rule is applied here for every scene:
 *   bass  -> shake (zoom punch + nudge on kicks), and pulses any bulge
 *   mid   -> glow (bloom strength)
 *   high  -> sparkle (chromatic aberration + grain)
 */
(function () {
  'use strict';
  const VIZ = (window.VIZ = window.VIZ || {});
  const TAU = Math.PI * 2;
  const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  const SAMPLE13 = `
vec3 sample13(sampler2D t, vec2 uv, vec2 texel) {
  vec3 a = texture(t, uv + texel * vec2(-2.0, -2.0)).rgb;
  vec3 b = texture(t, uv + texel * vec2( 0.0, -2.0)).rgb;
  vec3 c = texture(t, uv + texel * vec2( 2.0, -2.0)).rgb;
  vec3 d = texture(t, uv + texel * vec2(-2.0,  0.0)).rgb;
  vec3 e = texture(t, uv).rgb;
  vec3 f = texture(t, uv + texel * vec2( 2.0,  0.0)).rgb;
  vec3 g = texture(t, uv + texel * vec2(-2.0,  2.0)).rgb;
  vec3 h = texture(t, uv + texel * vec2( 0.0,  2.0)).rgb;
  vec3 i = texture(t, uv + texel * vec2( 2.0,  2.0)).rgb;
  vec3 j = texture(t, uv + texel * vec2(-1.0, -1.0)).rgb;
  vec3 k = texture(t, uv + texel * vec2( 1.0, -1.0)).rgb;
  vec3 l = texture(t, uv + texel * vec2(-1.0,  1.0)).rgb;
  vec3 m = texture(t, uv + texel * vec2( 1.0,  1.0)).rgb;
  return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}`;

  const PREFILTER_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
${SAMPLE13}
void main() {
  vec3 c = max(sample13(uSrc, vUv, uTexel), 0.0);
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  fragColor = vec4(c * contrib, 1.0);
}`;

  const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
${SAMPLE13}
void main() { fragColor = vec4(sample13(uSrc, vUv, uTexel), 1.0); }`;

  const UP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uRadius;
void main() {
  vec2 d = uTexel * uRadius;
  vec3 s =
      texture(uSrc, vUv + vec2(-d.x, -d.y)).rgb + 2.0 * texture(uSrc, vUv + vec2(0.0, -d.y)).rgb + texture(uSrc, vUv + vec2(d.x, -d.y)).rgb
    + 2.0 * texture(uSrc, vUv + vec2(-d.x, 0.0)).rgb + 4.0 * texture(uSrc, vUv).rgb + 2.0 * texture(uSrc, vUv + vec2(d.x, 0.0)).rgb
    + texture(uSrc, vUv + vec2(-d.x, d.y)).rgb + 2.0 * texture(uSrc, vUv + vec2(0.0, d.y)).rgb + texture(uSrc, vUv + vec2(d.x, d.y)).rgb;
  fragColor = vec4(s / 16.0, 1.0);
}`;

  // Pass A: warps, aberration, fractal, trails. Output stays linear HDR.
  const FX_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uPrev;
uniform vec2 uRes;
uniform float uTime;
uniform float uBloomStrength;
uniform float uAberration;
uniform float uShake;
uniform vec2 uShakeDir;
uniform float uRotAngle;
uniform int uMirror;
uniform float uMirrorMix;
uniform float uKaleido;
uniform float uKaleidoMix;
uniform float uFractal;
uniform float uBulge;
uniform float uTrails;
uniform float uFlash;
uniform vec3 uFlashColor;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
vec2 mirrorUv(vec2 uv) { return 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0); }

vec2 warp(vec2 uv) {
  float asp = uRes.x / uRes.y;
  vec2 c = (uv - 0.5) * vec2(asp, 1.0);
  // Bass punch: the whole frame zooms in with the kick envelope, plus a small directional nudge.
  c *= 1.0 - 0.085 * uShake;
  c += uShakeDir * 0.01 * uShake;
  // Rotation of the whole frame.
  if (abs(uRotAngle) > 0.0001) c = rot(uRotAngle) * c;
  // Bulge / pinch.
  if (abs(uBulge) > 0.001) {
    float r2 = dot(c, c);
    c *= 1.0 + uBulge * (0.35 - r2) * 0.9;
  }
  // Kaleidoscope (cross-faded in UV space so it eases in and out).
  if (uKaleido > 2.5 && uKaleidoMix > 0.001) {
    float n = floor(uKaleido + 0.5);
    float seg = 6.28318530718 / n;
    float a = atan(c.y, c.x) + uTime * 0.05;
    float r = length(c);
    a = mod(a, seg);
    a = abs(a - seg * 0.5);
    c = mix(c, vec2(cos(a), sin(a)) * r, uKaleidoMix);
  }
  // Mirror (same cross-fade).
  if (uMirror > 0 && uMirrorMix > 0.001) {
    vec2 m = c;
    if (uMirror == 1) m.x = -abs(c.x);
    else if (uMirror == 2) m.y = abs(c.y);
    else m = vec2(-abs(c.x), abs(c.y));
    c = mix(c, m, uMirrorMix);
  }
  return c / vec2(asp, 1.0) + 0.5;
}

vec3 sampleScene(vec2 uv) {
  uv = mirrorUv(uv);
  vec2 c = uv - 0.5;
  vec2 d = c * dot(c, c) * uAberration * 0.035;
  vec3 col;
  col.r = texture(uScene, uv + d).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - d).b;
  col += texture(uBloom, uv).rgb * uBloomStrength;
  return col;
}

void main() {
  vec2 uv = warp(vUv);
  vec3 col = sampleScene(uv);
  if (uFractal > 0.001) {
    float asp = uRes.x / uRes.y;
    vec2 c = (uv - 0.5) * vec2(asp, 1.0);
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    for (int i = 1; i <= 3; i++) {
      float fi = float(i);
      float s = pow(1.0 + 0.9 * uFractal, fi);
      vec2 q = rot(fi * 0.35 * uFractal + uTime * 0.03 * fi) * c * s;
      float w = pow(0.62, fi);
      acc += sampleScene(q / vec2(asp, 1.0) + 0.5) * w;
      wsum += w;
    }
    col = mix(col, (col + acc) / (1.0 + wsum) * 1.6, uFractal);
  }
  if (uTrails > 0.001) {
    vec2 c = vUv - 0.5;
    c = rot(0.002 * uTrails) * c * (1.0 - 0.004 * uTrails);
    // Clamp the echo so HDR peaks don't smear into a grey wash; keep decays 20%..3% per frame.
    vec3 prev = min(texture(uPrev, c + 0.5).rgb, vec3(1.3));
    float keep = 0.80 + 0.17 * uTrails;
    col = mix(col, max(col, prev * keep), min(1.0, uTrails * 2.0));
  }
  col += uFlashColor * uFlash;
  fragColor = vec4(col, 1.0);
}`;

  // Pass B: tonemap and the colour-space effects.
  const OUT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uTime;
uniform float uExposure;
uniform float uVignette;
uniform float uGrain;
uniform float uPosterize;
uniform float uHalftone;
uniform float uScanlines;
uniform float uInvert;
${VIZ.glsl.tonemap}
const vec3 LUM = vec3(0.299, 0.587, 0.114);
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 tm(vec2 uv) { return aces(texture(uSrc, uv).rgb * uExposure); }
void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  vec3 col = tm(uv);
  if (uPosterize > 0.001) {
    float levels = mix(10.0, 4.0, uPosterize);
    vec3 q = floor(col * levels + 0.5) / levels;
    vec2 px = 1.5 / uRes;
    float gx = dot(tm(uv + vec2(px.x, 0.0)), LUM) - dot(tm(uv - vec2(px.x, 0.0)), LUM);
    float gy = dot(tm(uv + vec2(0.0, px.y)), LUM) - dot(tm(uv - vec2(0.0, px.y)), LUM);
    float edge = clamp(length(vec2(gx, gy)) * 5.0, 0.0, 1.0);
    col = mix(col, q * (1.0 - 0.85 * edge), uPosterize);
  }
  if (uHalftone > 0.001) {
    float cell = mix(16.0, 7.0, uHalftone) * max(uRes.y / 1080.0, 0.5);
    vec2 g = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / cell;
    vec2 f = fract(g) - 0.5;
    float l = dot(col, LUM);
    float rad = sqrt(clamp(l, 0.0, 1.0)) * 0.68;
    float dotm = 1.0 - smoothstep(rad - 0.1, rad + 0.1, length(f));
    vec3 ht = col * (0.45 + 0.85 * dotm) + col * col * 0.3;
    col = mix(col, ht, uHalftone);
  }
  if (uScanlines > 0.001) {
    float s = 0.5 + 0.5 * sin(gl_FragCoord.y * 1.2);
    col *= (1.0 - uScanlines * 0.4 * s) * (1.0 + uScanlines * 0.15);
  }
  if (uInvert > 0.001) col = mix(col, 1.0 - col, uInvert);
  col *= 1.0 - uVignette * smoothstep(0.15, 0.75, r2 * 2.0);
  float g = hash12(gl_FragCoord.xy + vec2(fract(uTime * 7.31) * 311.0, fract(uTime * 3.17) * 173.0)) - 0.5;
  col += g * uGrain;
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  fragColor = vec4(col, 1.0);
}`;

  const EFFECT_DEFAULTS = {
    mirror: 0, kaleido: 0, fractal: 0, bulge: 0, trails: 0, rotate: 0,
    posterize: 0, halftone: 0, scanlines: 0, aberration: 1, invert: 0, hueDrift: 0,
  };

  class Post {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.levels = 6;
      this.mips = [];
      this.hist = [null, null];
      this.histCur = 0;
      this.histValid = false;
      this.progPre = ctx.fsProgram(PREFILTER_FS, 'bloom-prefilter');
      this.progDown = ctx.fsProgram(DOWN_FS, 'bloom-down');
      this.progUp = ctx.fsProgram(UP_FS, 'bloom-up');
      this.progFx = ctx.fsProgram(FX_FS, 'post-fx');
      this.progOut = ctx.fsProgram(OUT_FS, 'post-out');
      this.params = { bloom: 0.9, threshold: 0.75, knee: 0.5, radius: 1.0, vignette: 0.4, grain: 0.035, exposure: 1.0 };
      this.effects = Object.assign({}, EFFECT_DEFAULTS, { mirrorMix: 0, kaleidoMix: 0 });
      this.bands = { shake: 1, glow: 1, sparkle: 1 };
      this.flash = 0;
      this.flashColor = [1, 1, 1];
      this.shakeDir = [1, 0];
      this.w = 0; this.h = 0;
      void gl;
    }

    resize(w, h) {
      if (w === this.w && h === this.h) return;
      this.w = w; this.h = h;
      let mw = Math.max(1, w >> 1), mh = Math.max(1, h >> 1);
      for (let i = 0; i < this.levels; i++) {
        if (!this.mips[i]) this.mips[i] = this.ctx.createTarget(mw, mh, { hdr: true });
        else this.mips[i].resize(mw, mh);
        mw = Math.max(1, mw >> 1); mh = Math.max(1, mh >> 1);
      }
      for (let i = 0; i < 2; i++) if (this.hist[i]) this.hist[i].resize(w, h);
      this.histValid = false;
    }

    _hist(i) {
      if (!this.hist[i]) {
        this.hist[i] = this.ctx.createTarget(this.w, this.h, { hdr: true });
        this.hist[i].bind();
        this.hist[i].clear(0, 0, 0, 1);
      }
      return this.hist[i];
    }

    /** Draw the final frame to the default framebuffer. */
    render(sceneTex, audio, u) {
      const gl = this.gl, ctx = this.ctx, p = this.params, e = this.effects, b = this.bands;
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      // --- bloom ---
      const m0 = this.mips[0];
      m0.bind();
      this.progPre.use().tex('uSrc', sceneTex).f2('uTexel', 1 / this.w, 1 / this.h).f('uThreshold', p.threshold).f('uKnee', p.knee);
      ctx.drawQuad();
      for (let i = 1; i < this.levels; i++) {
        const src = this.mips[i - 1], dst = this.mips[i];
        dst.bind();
        this.progDown.use().tex('uSrc', src.tex).f2('uTexel', 1 / src.w, 1 / src.h);
        ctx.drawQuad();
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = this.levels - 2; i >= 0; i--) {
        const src = this.mips[i + 1], dst = this.mips[i];
        dst.bind();
        this.progUp.use().tex('uSrc', src.tex).f2('uTexel', 1 / src.w, 1 / src.h).f('uRadius', p.radius);
        ctx.drawQuad();
      }
      gl.disable(gl.BLEND);

      // --- the universal band couplings ---
      if (audio.onset) { const a = Math.random() * TAU; this.shakeDir[0] = Math.cos(a); this.shakeDir[1] = Math.sin(a); }
      const shake = Math.min(1, b.shake * audio.kick);
      const glow = 1 + b.glow * (0.5 * audio.mid + 0.4 * audio.midPulse);
      const sparkle = b.sparkle * (0.7 * audio.high + 1.2 * audio.highPulse);
      const bulge = e.bulge !== 0 ? e.bulge * (1 + 0.6 * b.shake * audio.kick) : 0;

      // --- pass A ---
      const useTrails = e.trails > 0.001;
      const trails = useTrails && this.histValid ? e.trails : 0;
      const dst = this._hist(useTrails ? this.histCur : 0);
      // Never bind the destination as uPrev: WebGL treats that as a feedback loop and drops the draw.
      const prevTex = useTrails ? this._hist(1 - this.histCur).tex : sceneTex;
      dst.bind();
      this.progFx.use()
        .tex('uScene', sceneTex).tex('uBloom', m0.tex).tex('uPrev', prevTex)
        .f2('uRes', this.w, this.h).f('uTime', u.time)
        .f('uBloomStrength', p.bloom * 0.35 * glow)
        .f('uAberration', e.aberration * (0.2 + sparkle))
        .f('uShake', shake).f2('uShakeDir', this.shakeDir[0], this.shakeDir[1])
        .f('uRotAngle', e.rotAngle || 0)
        .i('uMirror', e.mirror | 0).f('uMirrorMix', e.mirrorMix === undefined ? 1 : e.mirrorMix)
        .f('uKaleido', e.kaleido).f('uKaleidoMix', e.kaleidoMix === undefined ? 1 : e.kaleidoMix)
        .f('uFractal', e.fractal).f('uBulge', bulge)
        .f('uTrails', trails).f('uFlash', this.flash)
        .f3('uFlashColor', this.flashColor[0], this.flashColor[1], this.flashColor[2]);
      ctx.drawQuad();

      // --- pass B ---
      ctx.bindScreen();
      this.progOut.use()
        .tex('uSrc', dst.tex)
        .f2('uRes', this.w, this.h).f('uTime', u.time)
        .f('uExposure', p.exposure).f('uVignette', p.vignette)
        .f('uGrain', p.grain * (1 + 0.8 * sparkle))
        .f('uPosterize', e.posterize).f('uHalftone', e.halftone).f('uScanlines', e.scanlines)
        .f('uInvert', e.invert * smoothstep(0.55, 0.95, audio.beatPulse));
      ctx.drawQuad();

      if (e.trails > 0.001) { this.histCur = 1 - this.histCur; this.histValid = true; }
      else this.histValid = false;
    }

    dispose() {
      this.mips.forEach((m) => m.dispose());
      this.mips = [];
      this.hist.forEach((h) => h && h.dispose());
      this.hist = [null, null];
      [this.progPre, this.progDown, this.progUp, this.progFx, this.progOut].forEach((p) => p.dispose());
    }
  }

  VIZ.Post = Post;
  VIZ.EFFECT_DEFAULTS = EFFECT_DEFAULTS;
})();
