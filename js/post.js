/* post.js — HDR post-processing: progressive bloom, chromatic aberration, ACES tonemap,
 * vignette and film grain. Scenes render linear HDR colour into a RenderTarget; Post.render()
 * takes that texture and writes the final image to the screen.
 */
(function () {
  'use strict';
  const VIZ = (window.VIZ = window.VIZ || {});

  const PREFILTER_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
vec3 sample13(vec2 uv) {
  vec2 t = uTexel;
  vec3 a = texture(uSrc, uv + t * vec2(-2.0, -2.0)).rgb;
  vec3 b = texture(uSrc, uv + t * vec2( 0.0, -2.0)).rgb;
  vec3 c = texture(uSrc, uv + t * vec2( 2.0, -2.0)).rgb;
  vec3 d = texture(uSrc, uv + t * vec2(-2.0,  0.0)).rgb;
  vec3 e = texture(uSrc, uv).rgb;
  vec3 f = texture(uSrc, uv + t * vec2( 2.0,  0.0)).rgb;
  vec3 g = texture(uSrc, uv + t * vec2(-2.0,  2.0)).rgb;
  vec3 h = texture(uSrc, uv + t * vec2( 0.0,  2.0)).rgb;
  vec3 i = texture(uSrc, uv + t * vec2( 2.0,  2.0)).rgb;
  vec3 j = texture(uSrc, uv + t * vec2(-1.0, -1.0)).rgb;
  vec3 k = texture(uSrc, uv + t * vec2( 1.0, -1.0)).rgb;
  vec3 l = texture(uSrc, uv + t * vec2(-1.0,  1.0)).rgb;
  vec3 m = texture(uSrc, uv + t * vec2( 1.0,  1.0)).rgb;
  return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}
void main() {
  vec3 c = max(sample13(vUv), 0.0);
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
void main() {
  vec2 t = uTexel;
  vec3 a = texture(uSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 b = texture(uSrc, vUv + t * vec2( 0.0, -2.0)).rgb;
  vec3 c = texture(uSrc, vUv + t * vec2( 2.0, -2.0)).rgb;
  vec3 d = texture(uSrc, vUv + t * vec2(-2.0,  0.0)).rgb;
  vec3 e = texture(uSrc, vUv).rgb;
  vec3 f = texture(uSrc, vUv + t * vec2( 2.0,  0.0)).rgb;
  vec3 g = texture(uSrc, vUv + t * vec2(-2.0,  2.0)).rgb;
  vec3 h = texture(uSrc, vUv + t * vec2( 0.0,  2.0)).rgb;
  vec3 i = texture(uSrc, vUv + t * vec2( 2.0,  2.0)).rgb;
  vec3 j = texture(uSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 k = texture(uSrc, vUv + t * vec2( 1.0, -1.0)).rgb;
  vec3 l = texture(uSrc, vUv + t * vec2(-1.0,  1.0)).rgb;
  vec3 m = texture(uSrc, vUv + t * vec2( 1.0,  1.0)).rgb;
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  fragColor = vec4(col, 1.0);
}`;

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

  const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uAberration;
uniform float uVignette;
uniform float uGrain;
uniform float uExposure;
uniform float uTime;
uniform float uFlash;
uniform vec3 uFlashColor;
${VIZ.glsl.tonemap}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  vec2 dir = c * r2 * uAberration * 0.035;
  vec3 col;
  col.r = texture(uScene, uv + dir).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - dir).b;
  vec3 bloom = texture(uBloom, uv).rgb;
  col += bloom * uBloomStrength;
  col += uFlashColor * uFlash;
  col *= uExposure;
  col = aces(col);
  col *= 1.0 - uVignette * smoothstep(0.15, 0.75, r2 * 2.0);
  float g = hash12(gl_FragCoord.xy + vec2(fract(uTime * 7.31) * 311.0, fract(uTime * 3.17) * 173.0)) - 0.5;
  col += g * uGrain;
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  fragColor = vec4(col, 1.0);
}`;

  class Post {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = ctx.gl;
      this.gl = gl;
      this.levels = 6;
      this.mips = [];
      this.progPre = ctx.fsProgram(PREFILTER_FS, 'bloom-prefilter');
      this.progDown = ctx.fsProgram(DOWN_FS, 'bloom-down');
      this.progUp = ctx.fsProgram(UP_FS, 'bloom-up');
      this.progComp = ctx.fsProgram(COMPOSITE_FS, 'composite');
      this.params = {
        bloom: 0.9,
        threshold: 0.75,
        knee: 0.5,
        radius: 1.0,
        aberration: 1.0,
        vignette: 0.4,
        grain: 0.035,
        exposure: 1.0,
      };
      this.flash = 0;
      this.flashColor = [1, 1, 1];
      this.w = 0; this.h = 0;
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
    }

    /** Draw the final frame to the default framebuffer. */
    render(sceneTex, audio, u) {
      const gl = this.gl, ctx = this.ctx, p = this.params;
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);

      // Bright-pass + first downsample.
      const m0 = this.mips[0];
      m0.bind();
      this.progPre.use()
        .tex('uSrc', sceneTex)
        .f2('uTexel', 1 / this.w, 1 / this.h)
        .f('uThreshold', p.threshold)
        .f('uKnee', p.knee);
      ctx.drawQuad();

      // Downsample chain.
      for (let i = 1; i < this.levels; i++) {
        const src = this.mips[i - 1], dst = this.mips[i];
        dst.bind();
        this.progDown.use().tex('uSrc', src.tex).f2('uTexel', 1 / src.w, 1 / src.h);
        ctx.drawQuad();
      }

      // Upsample + accumulate (additive).
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = this.levels - 2; i >= 0; i--) {
        const src = this.mips[i + 1], dst = this.mips[i];
        dst.bind();
        this.progUp.use().tex('uSrc', src.tex).f2('uTexel', 1 / src.w, 1 / src.h).f('uRadius', p.radius);
        ctx.drawQuad();
      }
      gl.disable(gl.BLEND);

      // Composite to screen.
      ctx.bindScreen();
      this.progComp.use()
        .tex('uScene', sceneTex)
        .tex('uBloom', m0.tex)
        .f('uBloomStrength', p.bloom * 0.35)
        .f('uAberration', p.aberration * (0.25 + audio.beatPulse * 1.6))
        .f('uVignette', p.vignette)
        .f('uGrain', p.grain)
        .f('uExposure', p.exposure)
        .f('uTime', u.time)
        .f('uFlash', this.flash)
        .f3('uFlashColor', this.flashColor[0], this.flashColor[1], this.flashColor[2]);
      ctx.drawQuad();
    }

    dispose() {
      this.mips.forEach((m) => m.dispose());
      this.mips = [];
      this.progPre.dispose(); this.progDown.dispose(); this.progUp.dispose(); this.progComp.dispose();
    }
  }

  VIZ.Post = Post;
})();
