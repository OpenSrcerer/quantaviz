# Quanta — a physics playground that listens to your desktop

Quanta is a real-time audio visualizer for Windows built from scratch with WebGL2 and the Web Audio
API. No installs, no frameworks, no network: double-click `Start-Quanta.cmd` and it opens in an
Edge app window, listening to whatever Windows is playing.

Instead of the usual bar spectrum, every scene is a small physics simulation that the music drives:

| Scene | What is going on | What the music does |
| --- | --- | --- |
| **Quark Soup** | A cartoon sandbox of colour-charged quarks (red / green / blue + anti-colours) bound into hadrons by gluon strings. Real QCD rules: quarks never roam free, and when a string stretches too far it snaps into a *new* quark–antiquark pair (string breaking). Crowded mesons annihilate into photon stars. | Beats pump energy into each hadron in proportion to its own frequency band; bass squeezes the bag the quarks live in; treble makes them jitter. Drag a quark with the mouse. Shake the window: the soup keeps its inertia in screen space (an homage to the gravity sandbox next door). |
| **Spacetime Fabric** | A 3D sheet of spacetime bent by gravity wells: a central mass and six bodies on Keplerian orbits (angular speed ∝ r^-1.5). | The gravitational waves are the bass signal itself travelling outward at a fixed speed: the ring at a given radius carries the bass level from the moment it left the centre, so a kick is one ring, an 808 a band of rings and silence a flat sheet. The wells deepen a little with the bass. Bodies glow and size with the mids; treble sends glints along the grid. With no music it sits still (raise *Idle motion* for ambient drift). Press the mouse to drop your own mass. |
| **Wavefunction** | A genuine 2D Schrödinger equation integrated on the GPU (Visscher leapfrog, hundreds of substeps per second). Brightness is \|ψ\|², colour is the phase, drawn with cel-shaded contours. | Beats fire quantum wave packets that have to tunnel through a crystalline ring barrier whose height follows the spectrum; bass opens a well in the middle; drag to attract the wave. |
| **Starburst** | 20k–400k five-pointed stars simulated entirely on the GPU (transform feedback) with curl-noise flow, arranged on a thin hollow globe split into eight frequency wedges. | Each wedge bulges and glows with its slice of the mids, bass breathes the globe and kicks swell it outward, treble twinkles; moving the window throws the stars around. |
| **Bubble Chamber** | A particle-detector photograph that paints itself: charged tracks curl in a magnetic field (radius ∝ momentum, opposite charges curl opposite ways), lose energy and spiral inward, neutrals decay into V-shaped pairs, delta electrons spin off, and the long exposure slowly fades. | Every significant kick is one collision at the centre, sized by the hit (a soft one a few tracks, a hard one a spray); the field strength follows the kick envelope; each track glows with its own mid band. *Idle spawn rate* adds background collisions from the edge (default 0: kicks only). Hold the mouse to create a magnetic anomaly. |
| **Event Horizon** | A point-mass gravitational lens bends a sky of cartoon stars around a black hole with a hot accretion disk (Doppler beaming included). | Every star twinkles to its own frequency band, the disk is heated by the music, the horizon breathes with the bass, beats flare outward through the disk. |

## The band rule

Every scene maps the spectrum the same way, so what you see always means the same thing:

| Band | Drives | Examples |
| --- | --- | --- |
| **Bass** (32–150 Hz) | motion, shake, force | kicks that stretch the quark strings, the bag squeeze, gravitational-wave ripples, the breathing shell and horizon, the magnetic field, the global screen shake on kicks |
| **Mids** (150–2200 Hz) | light and body | brightness, size and colour energy of the quarks, the orbiting bodies, the stars, the tracks, the wave packets and the accretion disk; the global bloom |
| **Highs** (2200 Hz–16 kHz) | sparkle and detail | twinkle, jitter, photon stars, grid glints, delta electrons, ink shimmer, chromatic fringing and grain |

The big visible bass response in every scene (horizon and disk size, globe radius, bag squeeze,
spacetime depth and waves, magnetic field, the global zoom punch) uses a *kick envelope* that
reacts to change, not level: the attack of each hit in the 35–100 Hz kick band (the gap between a
fast and a slow envelope of the band's dB level, so a kick riding on a loud bassline counts just
like an isolated one), measured against the *typical* recent attack rather than the strongest,
with a 2 dB noise floor, an instant attack and a short release. *Kick threshold* (default 35%)
sets how small a hit may be relative to a typical one before it is ignored, *Kick level gate*
(default −46 dBFS) the minimum bass loudness below which nothing counts (quiet passages are mostly
noise, which wobbles wildly in dB), and *Kick decay* how long a hit shows. A typical hit reads about 0.85, a hard one 1, and a sustained note counts only when
it starts. Onsets are detected
per band too: kick drums shake, mid onsets flash the bodies, treble onsets sparkle. The *Band
response* section of the settings drawer has a drive slider for each band and for each of the
three global couplings (shake, glow, sparkle), so you can push or mute any of them.

## Effects and palettes

Six scenes become hundreds of looks: the *Effects* section layers independent post effects, each
with its own slider, all persisted:

mirror (horizontal / vertical / quad) · kaleidoscope (3–12 segments) · fractal tiling · space
bend (pinch ↔ bulge, pulses with kicks) · echo trails · rotation · cel shading & ink outlines ·
halftone print · scanlines · chromatic aberration · negative flash on kicks · palette cycling
(hue drift)

`E` shuffles a tasteful random combination, `C` clears them, and *Auto-shuffle* reshuffles effects
and palettes on a timer. Changes never snap: every effect glides to its new value over a second or
two (mirror and kaleidoscope cross-fade in and out), and palettes blend. There are 14 hand-picked palettes plus a ✦ random palette generator
(`R`) that builds a harmonious scheme every time you press it.

Everything else is customizable from the same drawer (gear icon or `S`): sensitivity, intensity,
bloom, grain, render scale, auto-cycling scenes, and per-scene parameters such as string
toughness, gravity-well depth, grid resolution or particle count. Settings persist in the browser.

## Running it

1. Double-click **`Start-Quanta.cmd`** (or run `serve.ps1` in PowerShell). A tiny localhost web
   server starts (built into Windows PowerShell, nothing to install) and Edge opens an app window.
2. Click **Desktop audio**. In the share dialog pick **Entire screen** and switch on
   **Share system audio**, then **Share**. Quanta only reads the audio; the video track is disabled.
   Edge shows a small "sharing your screen" bar which you can hide.
3. Play music anywhere on your PC. Press `F` for fullscreen and `H` to hide the interface.

Other sources: **Microphone**, an **audio file** (or drop one on the window), or the built-in
**demo track** (a small synthwave loop synthesized live) if you just want to look.

Closing the Edge window and the console window stops everything. The server only serves the files
in this folder, only to this machine. Nothing is recorded or sent anywhere.

> `index.html` can also be opened directly, but browsers are stricter about capture permissions on
> `file://` pages, so the launcher is the supported route.

## Controls

| Key | Action |
| --- | --- |
| `Space` / `→` / `←` | Next / previous scene |
| `1`–`6` | Pick a scene directly |
| `P` / `Shift+P` | Next / previous palette |
| `R` | New random palette |
| `E` / `C` | Shuffle effects / clear effects |
| `X` | Toggle auto-shuffle of effects and palettes |
| `S` / `Esc` | Open / close settings |
| `A` | Toggle auto-cycling scenes |
| `F` or double-click | Fullscreen |
| `H` | Hide / show the interface |
| `M` | Mute playback of file / demo sources |
| Mouse drag | Grab a quark / drop a mass / attract the wavefunction |
| Move the window | Shove the physics (Quark Soup, Starburst, Spacetime) |

URL parameters: `?scene=quarks|spacetime|wavefunction|starburst|chamber|horizon`, `?mute=1`.

## Performance

Designed for 144 Hz. The audio analysis is a few thousand operations per frame (128 log-spaced bands
from a 2048-point FFT, onset detection by spectral flux, tempo by autocorrelation), the heavy
lifting happens on the GPU, and post-processing is a six-level progressive bloom, the effects
stack and ACES tone mapping. On start Quanta measures the display's refresh rate; with **Adaptive quality** on it
lowers the internal render scale when frames exceed the budget and raises it again when there is
headroom. The frame counter at the bottom right shows achieved / target fps and the current
resolution.

## Project layout

```
Start-Quanta.cmd        double-click launcher (calls serve.ps1)
serve.ps1               localhost static server (HttpListener) + opens Edge in app mode
index.html              page shell, start screen, HUD, settings drawer
css/style.css
js/gl.js                WebGL2 toolkit: programs, render targets, mat4, shared GLSL snippets
js/audio.js             capture (desktop / mic / file / demo synth) + analysis
js/post.js              bloom, the layered effects stack, band couplings, tonemap, vignette, grain
js/main.js              app: scene registry, settings, UI, render loop, adaptive quality
js/scenes/quarks.js     Quark Soup (CPU physics, instanced SDF sprites)
js/scenes/spacetime.js  Spacetime Fabric (displaced grid mesh)
js/scenes/wavefunction.js  Schrödinger simulation (ping-pong float targets)
js/scenes/starburst.js  GPU particles (transform feedback)
js/scenes/chamber.js    Bubble Chamber (CPU tracks, long-exposure accumulation buffer)
js/scenes/horizon.js    Event Horizon (single fragment shader)
```

### Adding a scene

Create `js/scenes/myscene.js`, register it with `VIZ.registerScene({ id, name, blurb, params, create })`
and add a `<script>` tag to `index.html`. A scene instance implements `resize(w, h)`,
`render(target, audio, u)` and `dispose()`; the full contract, including what `audio` and `u`
provide (bands, bass/mid/high, per-band onsets, palette, window motion, pointer), is documented at
the top of `js/main.js`, together with the band rule every scene must follow. `js/scenes/horizon.js`
is the smallest example. In GLSL use `bandLow(x)` / `bandMid(x)` / `bandHigh(x)`, the hit
envelopes `uKick` / `uMidHit` / `uHighHit` and the sharp onsets `uPulse` / `uMidPulse` /
`uHighPulse`; in JS `audio.kick`, `audio.bandMid(x)` etc. Rule of thumb: the scene's largest
visible change must be driven by `uKick`.

## Troubleshooting

- **"No sound is arriving"** — you probably shared a window or a tab without audio. Click *change*
  next to the source name and re-share *Entire screen* with *Share system audio* on.
- **Share dialog has no audio checkbox** — use Microsoft Edge or Google Chrome; Firefox cannot
  capture system audio.
- **Black screen / "can't start"** — the browser has no WebGL2 (hardware acceleration disabled?).
- **Choppy** — lower *Render scale* in settings or turn *Adaptive quality* on; the Wavefunction
  grid and Starburst particle count are the two heaviest knobs.
