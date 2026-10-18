# Quanta — a physics playground that listens to your desktop

Quanta is a real-time audio visualizer for Windows built from scratch with WebGL2 and the Web Audio
API. No installs, no frameworks, no network: double-click `Start-Quanta.cmd` and it opens in an
Edge app window, listening to whatever Windows is playing.

Instead of the usual bar spectrum, every scene is a small physics simulation that the music drives:

| Scene | What is going on | What the music does |
| --- | --- | --- |
| **Quark Soup** | A cartoon sandbox of colour-charged quarks (red / green / blue + anti-colours) bound into hadrons by gluon strings. Real QCD rules: quarks never roam free, and when a string stretches too far it snaps into a *new* quark–antiquark pair (string breaking). Crowded mesons annihilate into photon stars. | Beats pump energy into each hadron in proportion to its own frequency band; bass squeezes the bag the quarks live in; treble makes them jitter. Drag a quark with the mouse. Shake the window: the soup keeps its inertia in screen space (an homage to the gravity sandbox next door). |
| **Spacetime Fabric** | A 3D sheet of spacetime bent by gravity wells: a central mass and six bodies on Keplerian orbits (angular speed ∝ r^-1.5). | Each body weighs as much as its frequency band is loud, so the sheet sags where the music is; the central mass grows with the bass; beats launch gravitational-wave ripples. Press the mouse to drop your own mass. |
| **Wavefunction** | A genuine 2D Schrödinger equation integrated on the GPU (Visscher leapfrog, hundreds of substeps per second). Brightness is \|ψ\|², colour is the phase, drawn with cel-shaded contours. | Beats fire quantum wave packets that have to tunnel through a crystalline ring barrier whose height follows the spectrum; bass opens a well in the middle; drag to attract the wave. |
| **Starburst** | 50k–400k five-pointed stars simulated entirely on the GPU (transform feedback) with curl-noise flow. | Stars group by frequency on a breathing globe, beats shatter it into a supernova that springs back, moving the window throws the stars around. |
| **Bubble Chamber** | A particle-detector photograph that paints itself: charged tracks curl in a magnetic field (radius ∝ momentum, opposite charges curl opposite ways), lose energy and spiral inward, neutrals decay into V-shaped pairs, delta electrons spin off, and the long exposure slowly fades. | Every beat is a collision whose multiplicity follows the beat strength; the field strength follows the bass; each track glows with its own frequency band. Hold the mouse to create a magnetic anomaly. |
| **Event Horizon** | A point-mass gravitational lens bends a sky of cartoon stars around a black hole with a hot accretion disk (Doppler beaming included). | Every star twinkles to its own frequency band, the disk is heated by the music, the horizon breathes with the bass, beats flare outward through the disk. |

Everything is customizable from the settings drawer (gear icon or `S`): palette, sensitivity,
intensity, bloom, grain, render scale, auto-cycling, and per-scene parameters such as string
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
| `P` | Next palette |
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
lifting happens on the GPU, and post-processing is a six-level progressive bloom with ACES tone
mapping. On start Quanta measures the display's refresh rate; with **Adaptive quality** on it
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
js/post.js              bloom, chromatic aberration, tonemap, vignette, grain
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
provide (bands, bass/mid/high, beat envelope, palette, window motion, pointer), is documented at the
top of `js/main.js`. `js/scenes/horizon.js` is the smallest example.

## Troubleshooting

- **"No sound is arriving"** — you probably shared a window or a tab without audio. Click *change*
  next to the source name and re-share *Entire screen* with *Share system audio* on.
- **Share dialog has no audio checkbox** — use Microsoft Edge or Google Chrome; Firefox cannot
  capture system audio.
- **Black screen / "can't start"** — the browser has no WebGL2 (hardware acceleration disabled?).
- **Choppy** — lower *Render scale* in settings or turn *Adaptive quality* on; the Wavefunction
  grid and Starburst particle count are the two heaviest knobs.
