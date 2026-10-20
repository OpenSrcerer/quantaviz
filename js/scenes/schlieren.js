/* schlieren.js — Schlieren Camera.
 * Schlieren photography makes invisible changes in air density visible: light from a point
 * source bounces off a parabolic mirror past a knife edge, so anything that bends the light
 * (a pressure wave, warm air) shows up bright on one side and dark on the other. Colour
 * schlieren swaps the knife for a colour filter, so the direction of the bend becomes a hue.
 * Here a speaker fires sound into the field: a real 2D acoustic wave equation runs on the GPU,
 * so the waves spread, reflect off the speaker and the candle and interfere. A candle's heat
 * plume rises and churns on the other side. You see both through the round mirror.
 *   bass  -> the speaker cone: a tone at the bass level, and every kick a pressure pulse
 *            (a compression ring followed by a rarefaction)
 *   mids  -> the candle burns hotter: a stronger, more turbulent plume
 *   highs -> the tweeter: fine high-frequency ripples
 */
(function () {
  'use strict';
  const VIZ = window.VIZ;
  const GW = 512, GH = 288;
  const SIM_ASP = GW / GH;       // the sim covers a 16:9 box, one screen unit tall
  const C2 = 0.38;               // (c dt / dx)^2, stable below 0.5
  const NPULSE = 6;

  // Geometry in sim uv.
  const SPK_X = 0.30, SPK_H = 0.075;          // cone face, half height
  const CAN_X = 0.60, CAN_W = 0.009, CAN_Y0 = 0.08, CAN_Y1 = 0.2;

  const SIM = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uS;
uniform float uDrive;
const vec2 G = vec2(${GW}.0, ${GH}.0);
float at(ivec2 c) { c = clamp(c, ivec2(0), ivec2(G) - 1); return texelFetch(uS, c, 0).r; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(c) + 0.5) / G;
  vec4 s = texelFetch(uS, c, 0);
  float u = s.r, up = s.g;
  float lap = at(c + ivec2(1, 0)) + at(c - ivec2(1, 0)) + at(c + ivec2(0, 1)) + at(c - ivec2(0, 1)) - 4.0 * u;
  float un = (2.0 * u - up + ${C2} * lap) * 0.9996;
  // Absorbing border so waves leave instead of ringing round the box.
  float e = min(min(uv.x, 1.0 - uv.x) * ${SIM_ASP.toFixed(4)}, min(uv.y, 1.0 - uv.y));
  un *= 1.0 - 0.07 * (1.0 - smoothstep(0.0, 0.07, e));
  // The speaker: cone face driven, cabinet behind it rigid.
  if (abs(uv.y - 0.5) < ${SPK_H} && abs(uv.x - ${SPK_X}) < 1.0 / G.x) un = uDrive;
  if (uv.x < ${SPK_X} - 1.0 / G.x && uv.x > ${SPK_X - 0.06} && abs(uv.y - 0.5) < ${SPK_H + 0.04}) un = 0.0;
  // The candle is solid.
  if (abs(uv.x - ${CAN_X}) < ${CAN_W} && uv.y > ${CAN_Y0} && uv.y < ${CAN_Y1}) un = 0.0;
  fragColor = vec4(un, u, 0.0, 1.0);
}`;

  const FINAL = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${VIZ.glsl.common}
${VIZ.glsl.noise}
uniform sampler2D uS;
uniform float uColour;
uniform float uSens;
uniform float uHeat;
const float SA = ${SIM_ASP.toFixed(4)};
const vec2 G = vec2(${GW}.0, ${GH}.0);

vec2 toUv(vec2 p) { return vec2(p.x / SA + 0.5, p.y + 0.5); }
vec2 flamePos() { return vec2((${CAN_X} - 0.5) * SA, ${CAN_Y1} - 0.5 + 0.035); }

// Refractive change from the candle's heat: a plume that widens, drifts and churns as it rises.
float plume(vec2 p) {
  vec2 f = flamePos();
  float y = p.y - f.y;
  if (y < -0.02) return 0.0;
  float drift = 0.04 * sin(y * 5.0 - uTime * 0.7) * smoothstep(0.0, 0.4, y);
  float w = 0.012 + 0.22 * y;
  float x = (p.x - f.x - drift) / w;
  float body = exp(-x * x) * smoothstep(-0.02, 0.02, y) * (1.0 - smoothstep(0.55, 0.95, y));
  float turb = fbm2(vec2(p.x * 9.0, p.y * 6.0 - uTime * 1.7)) - 0.5;
  turb += (noise2(vec2(p.x * 30.0, p.y * 24.0 - uTime * 3.0)) - 0.5) * 0.4 * (0.4 + uHigh);
  return body * (0.5 + 1.6 * turb * smoothstep(0.03, 0.3, y)) * uHeat * (0.45 + 1.3 * uMid);
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float px = 1.0 / uRes.y;
  vec3 col = vec3(0.0);
  float r = length(p);
  const float AP = 0.46;            // the mirror's aperture
  if (r < AP) {
    vec2 uv = toUv(p);
    vec2 tx = vec2(1.0 / G.x, 0.0), ty = vec2(0.0, 1.0 / G.y);
    vec2 gw = vec2(texture(uS, uv + tx).r - texture(uS, uv - tx).r, texture(uS, uv + ty).r - texture(uS, uv - ty).r) * 12.0;
    const float e = 0.004;
    vec2 gp = vec2(plume(p + vec2(e, 0.0)) - plume(p - vec2(e, 0.0)), plume(p + vec2(0.0, e)) - plume(p - vec2(0.0, e))) / (2.0 * e) * 0.012;
    vec2 g = (gw + gp) * uSens;
    // Knife-edge (horizontal cut): grey, brighter where light is bent one way.
    vec3 knife = vec3(clamp(0.14 + g.x * 0.9, 0.0, 0.85));
    // Colour schlieren: the bend's direction picks the hue, its strength the saturation.
    float hue = atan(g.y, g.x) / 6.2831853 + 0.5;
    float m = 1.0 - exp(-length(g) * 0.9);
    vec3 colour = mix(vec3(0.03, 0.03, 0.04), palette(0.25 + 0.75 * hue) * 0.75, m);
    col = mix(knife, colour, uColour);
    // Silhouettes: the speaker cabinet and cone, the candle; the flame glows.
    vec2 s0 = toUv(p);
    float cab = step(${SPK_X - 0.06}, s0.x) * step(s0.x, ${SPK_X}) * step(abs(s0.y - 0.5), ${SPK_H + 0.04});
    float cone = step(abs(s0.x - ${SPK_X} - 0.004), 0.004) * step(abs(s0.y - 0.5), ${SPK_H});
    float can = step(abs(s0.x - ${CAN_X}), ${CAN_W}) * step(${CAN_Y0}, s0.y) * step(s0.y, ${CAN_Y1});
    col = mix(col, vec3(0.03), max(cab, can));
    col = mix(col, vec3(0.1, 0.1, 0.11) + 0.05 * uKick, cone);
    vec2 fd = (p - flamePos()) * vec2(1.6, 0.8);
    float flame = exp(-dot(fd, fd) / 0.00012) * (0.9 + 0.2 * noise2(vec2(uTime * 9.0, 1.0)));
    col += vec3(1.0, 0.7, 0.3) * flame * 1.6 + vec3(1.0, 0.55, 0.2) * exp(-length(fd) / 0.02) * 0.15 * (0.6 + uMid);
    // Vignette toward the mirror's rim.
    col *= 1.0 - 0.35 * smoothstep(AP * 0.7, AP, r);
  }
  // The mirror's rim.
  col += vec3(0.35, 0.36, 0.38) * exp(-pow((r - AP) / (1.5 * px), 2.0)) * 0.6;
  col *= 0.65 + 0.55 * uIntensity;
  fragColor = vec4(col, 1.0);
}`;

  class SchlierenScene {
    constructor(ctx) {
      this.ctx = ctx;
      const gl = (this.gl = ctx.gl);
      this.sim = ctx.fsProgram(SIM, 'schlieren-sim');
      this.final = ctx.fsProgram(FINAL, 'schlieren');
      this.rt = [0, 1].map(() => ctx.createTarget(GW, GH, { hdr: true, filter: gl.LINEAR }));
      if (!this.rt[0].hdr) throw new Error('needs float render targets');
      for (const t of this.rt) { t.bind(); t.clear(0, 0, 0, 1); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.cur = 0;
      this.trig = new VIZ.KickTrigger(0.35);
      this.pulses = [];
      this.step = 0;
      this.acc = 0;
      this.phase = 0;
      this.phaseH = 0;
    }
    resize() { /* fixed-size simulation */ }
    render(target, audio, u) {
      const gl = this.gl, ctx = this.ctx;
      const dt = Math.min(u.dt, 0.05);
      const P = u.params;
      const hit = this.trig.update(audio.kick);
      if (hit) this.pulses.push({ s0: this.step, amp: (0.6 + 0.8 * hit) * P.pulse });
      this.pulses = this.pulses.filter((q) => this.step - q.s0 < 60);
      // Three substeps per 60 Hz frame, in real time.
      this.acc += dt * 60 * 3 * P.speed;
      const steps = Math.min(12, Math.floor(this.acc));
      this.acc = Math.min(this.acc - steps, 3);
      gl.disable(gl.BLEND);
      for (let i = 0; i < steps; i++) {
        // The cone: a bass tone, a Ricker wavelet per kick (push then pull), a tweeter ripple.
        this.phase += (Math.PI * 2) / 110;
        this.phaseH += (Math.PI * 2) / 9;
        let drive = 0.07 * audio.bass * P.tone * Math.sin(this.phase);
        drive += 0.025 * (audio.high + audio.highPulse) * P.tweeter * Math.sin(this.phaseH);
        for (const q of this.pulses) {
          const x = (this.step - q.s0 - 10) / 3.2;
          drive += q.amp * (1 - 2 * x * x) * Math.exp(-x * x);
        }
        const src = this.rt[this.cur], dst = this.rt[1 - this.cur];
        dst.bind();
        this.sim.use().tex('uS', src.tex).f('uDrive', drive);
        ctx.drawQuad();
        this.cur = 1 - this.cur;
        this.step++;
      }
      target.bind();
      const p = this.final.use();
      ctx.setCommon(p, audio, u);
      p.tex('uS', this.rt[this.cur].tex).f('uColour', P.colour).f('uSens', P.sensitivity).f('uHeat', P.heat);
      ctx.drawQuad();
    }
    dispose() { this.sim.dispose(); this.final.dispose(); this.rt.forEach((t) => t.dispose()); }
  }

  VIZ.registerScene({
    id: 'schlieren',
    name: 'Schlieren Camera',
    blurb: 'Sound made visible: a speaker pushes pressure waves across the field on every kick, past a candle\'s churning heat plume that burns hotter with the mids.',
    params: [
      { key: 'pulse', label: 'Pressure pulse on kicks', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'tone', label: 'Bass tone', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'tweeter', label: 'Tweeter ripples on highs', min: 0, max: 3, step: 0.05, value: 1 },
      { key: 'heat', label: 'Candle heat', min: 0, max: 2, step: 0.05, value: 1 },
      { key: 'colour', label: 'Colour schlieren (knife edge .. colour)', min: 0, max: 1, step: 0.01, value: 0.9 },
      { key: 'sensitivity', label: 'Sensitivity', min: 0.3, max: 3, step: 0.05, value: 1 },
      { key: 'speed', label: 'Speed of sound', min: 0.3, max: 2, step: 0.05, value: 1 },
    ],
    create: (ctx) => new SchlierenScene(ctx),
  });
})();
