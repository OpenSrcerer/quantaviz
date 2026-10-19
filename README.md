# Quanta — a physics playground that listens to your desktop

Quanta is a real-time audio visualizer built from scratch with WebGL2 and the Web Audio API. It
runs in the browser on Windows, Linux and macOS. No installs, no frameworks, no network: on Windows
double-click `Start-Quanta.cmd`, on Linux or macOS run `./start-quanta.sh`, and it opens in a
browser app window, listening to whatever your computer is playing.

Instead of the usual bar spectrum, every scene is a small physics simulation that the music drives:

| Scene | What is going on | What the music does |
| --- | --- | --- |
| **Quark Soup** | A cartoon sandbox of colour-charged quarks (red / green / blue + anti-colours) bound into hadrons by gluon strings. Real QCD rules: quarks never roam free, and when a string stretches too far it snaps into a *new* quark–antiquark pair (string breaking). Crowded mesons annihilate into photon stars. | Beats pump energy into each hadron in proportion to its own frequency band; bass squeezes the bag the quarks live in; treble makes them jitter. Drag a quark with the mouse. Shake the window: the soup keeps its inertia in screen space (an homage to the gravity sandbox next door). |
| **Spacetime Fabric** | A 3D sheet of spacetime bent by gravity wells: a central mass and six bodies on Keplerian orbits (angular speed ∝ r^-1.5). | The gravitational waves are the bass signal itself travelling outward at a fixed speed: the ring at a given radius carries the bass level from the moment it left the centre, so a kick is one ring, an 808 a band of rings and silence a flat sheet. The wells deepen a little with the bass. Bodies glow and size with the mids; treble sends glints along the grid. With no music it sits still (raise *Idle motion* for ambient drift). Press the mouse to drop your own mass. |
| **Wavefunction** | A genuine 2D Schrödinger equation integrated on the GPU (Visscher leapfrog, hundreds of substeps per second). Brightness is \|ψ\|², colour is the phase, drawn with cel-shaded contours. | Beats fire quantum wave packets that have to tunnel through a crystalline ring barrier whose height follows the spectrum; bass opens a well in the middle; drag to attract the wave. |
| **Starburst** | 20k–400k five-pointed stars simulated entirely on the GPU (transform feedback) with curl-noise flow, arranged on a thin hollow globe split into eight frequency wedges. | Each wedge bulges and glows with its slice of the mids, bass breathes the globe and kicks swell it outward, treble twinkles; moving the window throws the stars around. |
| **Bubble Chamber** | A particle-detector photograph that paints itself: charged tracks curl in a magnetic field (radius ∝ momentum, opposite charges curl opposite ways), lose energy and spiral inward, neutrals decay into V-shaped pairs, delta electrons spin off, and the long exposure slowly fades. | Every significant kick is one collision at the centre, sized by the hit (a soft one a few tracks, a hard one a spray); the field strength follows the kick envelope; each track glows with its own mid band. *Idle spawn rate* adds background collisions from the edge (default 0: kicks only). Hold the mouse to create a magnetic anomaly. |
| **Event Horizon** | A point-mass gravitational lens bends a sky of cartoon stars around a black hole with a hot accretion disk (Doppler beaming included). | Every star twinkles to its own frequency band, the disk is heated by the music, the horizon breathes with the bass, beats flare outward through the disk. |
| **Supernova** | A massive star collapses and explodes: the shock front grows like a Sedov–Taylor blast wave (R ∝ t^0.4), breaks up into Rayleigh–Taylor fingers, bends the starlight behind it and leaves a fading remnant. | **Bass-led.** Every kick collapses the core (the star shrinks and goes white-hot) and launches one blast sized by the hit, and the camera recoils on a spring. Mids light the boiling surface and the ejecta filaments; highs throw sparks in the ejecta. |
| **Pulsar** | A neutron star with its magnetic axis tilted against its spin axis, so two radio beams sweep the sky like a lighthouse; each pass over the line of sight is a pulse (a flash and an expanding radio ring). Dipole field lines and a pulsar-wind nebula surround it. | **Treble-led.** Every snare is a *glitch*: a sudden spin-up that magnetic braking bleeds off, so the star lurches round on each hit (with *Snares only* on, hi-hats just nudge it). Starquake cracks glow after a glitch; highs stream sparks along the beams and glints along the field lines. Mids brighten the beams and nebula. |
| **Aurora** | Curtains of light over a mountain lake: a sharp lower edge, rays along the field lines, oxygen green fading to oxygen red, a nitrogen-violet fringe, mirrored in the water. | **Mid-led.** Each stretch of curtain is one mid band and rises and brightens with it; a mid onset sets off a substorm that spreads along the curtains. Highs make the rays flicker (pulsating aurora) and the stars twinkle; kicks send a sway through the curtains. |
| **Ferrofluid** | A puddle of magnetic liquid over an electromagnet. Above a critical field it stands up in a hexagonal lattice of spikes (the Rosensweig instability) and heaps up over the magnet. Raymarched, shaded as black mirror-glossy liquid in a studio. | Kicks surge the coil current, so the spikes leap out across the puddle and relax. Mids set each spike's height around its field value and light the studio it reflects; highs flicker glints on the tips. Drag to move the magnet. |
| **Wormhole** | An endless flight down a curving Einstein–Rosen throat ruled like spacetime, with light from the other universe at the far end. | Always flying forward; kicks hit the throttle, squeeze the throat and release a gravitational-wave ring that rushes past. Around each wall ring the mid spectrum runs once; highs streak star dust past the camera. |
| **Double Slit** | Waves through two slits interfere; single photons land on the detector one by one (drawn from \|ψ\|²) and a long exposure builds the fringes from dots. The live \|ψ\|² curve sits beside the screen. | Every kick is a *which-way measurement*: detectors at the slits light up, the interference term vanishes, the wave behind the barrier splits in two and photons land in two plain bands, until the fringes return. The mid centroid sets the wavelength (fringe spacing and colour) and mids the wave brightness; highs fire bursts of photons. |
| **Galaxy Collision** | Two spiral galaxies on a bound elliptical orbit fly through each other, Toomre-style: heavy cores plus 64k massless stars integrated on the GPU, so the passing core's tide tears out tails and bridges. A new pair replaces them after a couple of passages; the camera orbits. | Kicks fast-forward the encounter and flare the cores. Every star belongs to a mid band and glows with it; young blue stars sparkle with the highs. |
| **Black Hole Merger** | Two black holes spiral in (separation follows Peters' a⁴ ∝ t law, so the orbit chirps), lens the stars behind them and radiate a two-armed gravitational-wave spiral; at contact a flash, a ring of radiation and a ringdown, then a new pair. A LIGO-style strain trace scrolls along the bottom. | Every kick bleeds orbital energy (the pair steps closer), so heavy music merges faster. Mids heat the gas around each hole; highs twinkle the stars and glint in the wave crests. |
| **Comet** | We ride along a comet on an e = 0.75 Kepler orbit: the blue ion tail points straight away from the sun, the yellow dust tail curves back along the orbit, and both swing round through perihelion while the stars stream past. | Kicks are solar-wind gusts: a disconnection kink races down the ion tail and it flaps with the bass. Mids light the coma and dust; highs shed sparkling fragments down the dust tail. |
| **Jupiter** | A low flight over the cloud deck toward the curved horizon. Bands stream along alternating jets (two-phase flow noise, so the clouds really flow), storms twist the clouds round them and drift with their band, Io crosses the sky. | Kicks spin up new storms ahead and nudge the flight. Each latitude is a mid band; highs fire lightning deep in the belts. |
| **Lorenz Attractor** | Three tracers on Lorenz's chaotic system draw the butterfly as glowing ribbons; they start a hair apart and diverge (the butterfly effect), and are periodically dropped back together to do it again. The camera orbits. | Kicks push ρ up so the attractor swells and races. The ribbon is painted with the mids as it is drawn, a history of the music; high onsets nudge the tracers apart. |
| **Pendulum Wave** | 24 pendulums tuned so the n-th swings K + n times per minute drift through travelling snakes, standing waves and apparent chaos and realign, with motion trails, from a slowly drifting camera. | Kicks swing them wider. The row is a spectrum: each bob glows with its own mid band. A high onset sends a ripple of light along the row. |
| **Plasma Globe** | Filaments of ionised gas crawl from the electrode to the glass, fork near it and gather where you hold the mouse. | Each filament is a mid band. Kicks fire an arc burst that flares them and makes them jump; highs crackle along them and spark at the glass. |
| **Tokamak** | An open-frame fusion reactor (16 D-shaped field coils, central solenoid, poloidal rings) with a D-shaped plasma ring whose helical field lines (pitch set by the safety factor q) flow round. Raymarched coils, volumetric plasma; the camera circles. | Every kick is an edge-localised mode: the plasma edge erupts in filaments toward the wall and the core crashes briefly. Mids set the temperature; highs flicker edge turbulence. |
| **Feynman Diagrams** | Spacetime scrolls by (time runs left to right) and particle interactions are written onto it in Feynman's notation, each drawing itself in time order with a quantum riding every line. | Kicks write annihilations and exchanges and surge the scroll; mid onsets write emissions and vacuum-polarisation loops; highs pop virtual-pair bubbles. |
| **Reaction–Diffusion** | A BZ-style excitable medium (Barkley's model) on the GPU: broken wave fronts curl into rotating spirals that turn and collide forever, in a petri dish the camera pans across. | Kicks drop catalyst (expanding rings) and scratch lines that birth spiral pairs. Mids raise excitability; highs spark tiny new sources. |
| **Penrose Diagram** | The conformal diagram of a charged, maximally extended black hole (Reissner–Nordström): time runs up, light at exactly 45°, infinity squeezed into finite edges, and it never ends — universe, black-hole interior, the regions beside the jagged timelike singularities, a white hole, a new universe, and again. A traveller follows a genuine timelike worldline through it (never flatter than 45°), exiting left or right into each new universe, with their light cone riding along; the view scrolls up with them forever. | Kicks fire light rays from the traveller along both sides of the light cone (they stop where they hit a singularity or infinity) and hurry them on; the horizons pulse. Each universe is a mid band and glows with it; highs crackle the singularities and spark along the horizons. |

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
fast and a slow envelope of the band's power in dB, so a kick riding on a loud bassline counts just
like an isolated one and a gliding 808 doesn't read as repeated hits), measured against the
*typical* recent attack rather than the strongest, with a ~3.5 dB noise floor, an instant attack
and a short release. One note is one event: after a hit the detector stays disarmed until the
band has dipped a few dB below that hit, so a long 808 fires once at its onset and then relaxes. *Kick threshold* (default 35%)
sets how small a hit may be relative to a typical one before it is ignored, *Kick level gate*
(default −46 dBFS) the minimum bass loudness below which nothing counts (quiet passages are mostly
noise, which wobbles wildly in dB), and *Kick decay* how long a hit shows. A typical hit reads about 0.85, a hard one 1, and a sustained note counts only when
it starts. Onsets are detected
per band too: kick drums shake, mid onsets flash the bodies, treble onsets sparkle. The *Band
response* section of the settings drawer has a drive slider for each band and for each of the
three global couplings (shake, glow, sparkle), so you can push or mute any of them.

## Effects and palettes

Twenty-three scenes become hundreds of looks: the *Effects* section layers independent post effects, each
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

### Windows

1. Double-click **`Start-Quanta.cmd`** (or run `serve.ps1` in PowerShell). A tiny localhost web
   server starts (built into Windows PowerShell, nothing to install) and Edge opens an app window.
2. Click **Desktop audio**. In the share dialog pick **Entire screen** and switch on
   **Share system audio**, then **Share**. Quanta only reads the audio; the video track is disabled.
   Edge shows a small "sharing your screen" bar which you can hide.
3. Play music anywhere on your PC. Press `F` for fullscreen and `H` to hide the interface.

Other sources: **Microphone**, an **audio file** (or drop one on the window), or the built-in
**demo track** (a small synthwave loop synthesized live) if you just want to look.

### Linux (and macOS)

1. Run **`./start-quanta.sh`** from a terminal (options: `--port N`, `--no-browser`). It needs only
   `python3`, which every mainstream distribution ships. A localhost server starts and Chrome,
   Chromium, Edge or Brave opens in an app window (falling back to your default browser).
2. Pick a source as above. Desktop audio on Linux depends on the browser:
   - **Screen share with system audio.** The launcher starts the browser with PulseAudio /
     PipeWire loopback enabled, so recent Chrome and Chromium offer *Share system audio* when you
     pick *Entire screen*. This only applies if the browser was not already running when the
     launcher opened it; close other browser windows first if the checkbox is missing.
   - **Monitor source as a microphone** (works in every browser, Firefox included). Click
     **Microphone**, then route the browser to your output's monitor: in `pavucontrol`, on the
     *Recording* tab, switch the browser's stream to *Monitor of …*, or make the monitor the
     default input before you click:
     `pactl set-default-source "$(pactl get-default-sink).monitor"`.
3. Press `Ctrl+C` in the terminal to stop the server.

On macOS Chrome cannot capture system audio; use a loopback device (e.g. BlackHole) as the
microphone, or share a single browser tab with its audio.

On Wayland, browsers do not report the window position, so *move the window* physics stay idle;
everything else is the same.

Closing the browser window and the console window stops everything. The server only serves the files
in this folder, only to this machine. Nothing is recorded or sent anywhere.

> `index.html` can also be opened directly, but browsers are stricter about capture permissions on
> `file://` pages, so the launcher is the supported route.

## Controls

| Key | Action |
| --- | --- |
| `Space` / `→` / `←` | Next / previous scene |
| `1`–`9`, `0` (+`Shift` for 11–20, +`Alt` for 21–23) | Pick a scene directly |
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

URL parameters: `?scene=quarks|spacetime|wavefunction|starburst|chamber|horizon|supernova|pulsar|aurora|ferrofluid|wormhole|doubleslit|galaxies|merger|comet|jupiter|lorenz|pendulum|plasma|tokamak|feynman|reaction|penrose`, `?mute=1`.

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
Start-Quanta.cmd        Windows double-click launcher (calls serve.ps1)
serve.ps1               Windows localhost static server (HttpListener) + opens Edge in app mode
start-quanta.sh         Linux / macOS launcher: python3 localhost server + Chromium app window
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
js/scenes/supernova.js  Supernova (single fragment shader, kick-triggered blasts)
js/scenes/pulsar.js     Pulsar (single fragment shader, spin integrated in JS)
js/scenes/aurora.js     Aurora (single fragment shader)
js/scenes/ferrofluid.js Ferrofluid (raymarched heightfield)
js/scenes/wormhole.js   Wormhole (polar tunnel mapping)
js/scenes/doubleslit.js Double Slit (analytic waves + photon exposure buffer)
js/scenes/galaxies.js   Galaxy Collision (transform-feedback N-body stars)
js/scenes/merger.js     Black Hole Merger (single fragment shader, inspiral in JS)
js/scenes/comet.js      Comet (single fragment shader, Kepler orbit in JS)
js/scenes/jupiter.js    Jupiter (ray-sphere flyover, two-phase flow noise)
js/scenes/lorenz.js     Lorenz Attractor (RK4 in JS, instanced ribbons)
js/scenes/pendulum.js   Pendulum Wave (projected in JS, float data texture)
js/scenes/plasma.js     Plasma Globe (polar filament curves)
js/scenes/tokamak.js    Tokamak (raymarched coils + volumetric plasma)
js/scenes/feynman.js    Feynman Diagrams (SDF line styles from uniform arrays)
js/scenes/reaction.js   Reaction–Diffusion (Barkley model, ping-pong float targets)
js/scenes/penrose.js    Penrose Diagram (analytic Reissner–Nordström tiling, worldline in JS)
```

### Adding a scene

Create `js/scenes/myscene.js`, register it with `VIZ.registerScene({ id, name, blurb, params, create })`
and add a `<script>` tag to `index.html`. A scene instance implements `resize(w, h)`,
`render(target, audio, u)` and `dispose()`; the full contract, including what `audio` and `u`
provide (bands, bass/mid/high, per-band onsets, palette, window motion, pointer), is documented at
the top of `js/main.js`, together with the band rule every scene must follow. `js/scenes/horizon.js`
is the smallest example. To fire one event per kick (as Supernova and Wormhole do), use
`new VIZ.KickTrigger()` and call `update(audio.kick)` each frame: it returns the hit's peak on the frame it tops out. In GLSL use `bandLow(x)` / `bandMid(x)` / `bandHigh(x)`, the hit
envelopes `uKick` / `uMidHit` / `uHighHit` and the sharp onsets `uPulse` / `uMidPulse` /
`uHighPulse`; in JS `audio.kick`, `audio.bandMid(x)` etc. Rule of thumb: the scene's largest
visible change must be driven by `uKick`.

## Troubleshooting

- **"No sound is arriving"** — you probably shared a window or a tab without audio. Click *change*
  next to the source name and re-share *Entire screen* with *Share system audio* on.
- **Share dialog has no audio checkbox on Linux** — see the Linux section above: close all
  browser windows and relaunch with `./start-quanta.sh`, or use the monitor source as a microphone.
- **Share dialog has no audio checkbox** — use Microsoft Edge or Google Chrome; Firefox cannot
  capture system audio.
- **Black screen / "can't start"** — the browser has no WebGL2 (hardware acceleration disabled?).
- **Choppy** — lower *Render scale* in settings or turn *Adaptive quality* on; the Wavefunction
  grid and Starburst particle count are the two heaviest knobs.
