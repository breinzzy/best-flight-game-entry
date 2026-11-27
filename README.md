# SKYLINE RUNNER — Sunset Rally (v7)

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/breinzzy/best-flight-game-entry/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/breinzzy/best-flight-game-entry/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

SKYLINE RUNNER — Sunset Rally: a true-3D flight game rendered with Three.js
r160 (vendored locally, no CDN). Chase or cockpit view over a heightmap island
with mountains, forest and a village, the aircraft in frame with instruments
lit, a runway ahead, altitude, speed and heading on the HUD. Take off from
Runway 36, thread 12 glowing cyan rings, then land on the runway and stop —
beat the 180 s par for the time bonus. Free 6-DOF flight with stall, terrain
crash, working gear (G — landing with the gear up is a crash), a sunset sky
with sun glitter on the water, a real shadow under the aircraft, wingtip smoke
in turns, and a TOUCHDOWN debrief with a score breakdown and an approach-trace
graph against the ideal 3.0° glidepath. Keyboard and mouse; sounds are
synthesised in the browser, no audio files, no network requests.

Renderer (v7): terrain from the same seeded heightmap with smooth vertex
normals and a procedural grass/rock/snow/sand blend; a low warm sun with a
2048 px shadow map, Preetham sunset sky with environment reflections, Water.js
sea with a procedural tileable normal map, soft billboard clouds, warm haze
fog, and an ACES filmic warm grade with vignette. The aircraft is a Three.js
mesh hierarchy — glossy white with coral/teal livery, "SR-26" registration,
moving prop disc and control surfaces, nav + strobe lights — and the PAPI
lights read red/white from the real glidepath angle. A FPS counter is
available with `?fps=1`.

## Controls

| Key | Action |
| --- | --- |
| W / S or ↑ / ↓ | Pitch (S = nose up) |
| A / D or ← / → | Roll |
| Q / E | Rudder |
| Shift / R | Throttle up |
| Z / F or mouse wheel | Throttle down |
| G | Gear down / up |
| C | Camera (chase / cockpit) |
| Space | Brakes (on the ground) |
| P | Pause |
| M | Sound on / off |
| Enter | Start / restart |

Mouse: hold the left button and move to fly.

## Scoring

- Each ring: 250 pts + 50 per combo level (rings in a row without missing).
- Landing bonus: up to 500 for a gentle touchdown sink rate + up to 500 for
  landing close to the centreline.
- Time bonus: 5 pts per second left under the 180 s par.
- Landing with the gear up, stalling into the ground, or hitting terrain or
  water ends the run.

## Run it

Run a local server and open the canonical module entry:

```sh
node serve.ts
```

Then open http://localhost:8080 in a desktop browser, which serves
`game/index.html`. (`index.html` loads the game as ES modules and needs a
server.)

A file://-playable copy can be built locally with esbuild (the bundle is
generated output, so it is not committed — run this with three@0.160.0
installed, then double-click `game/play.html`):

```sh
npx esbuild game/src/main.js --bundle --format=iife --outfile=game/play-bundle.js
```

## Licences

- This game: MIT (see LICENSE).
- Three.js r160, vendored under `game/vendor/` (`three.module.js` + the
  `addons/` used: Sky, Water, EffectComposer, RenderPass, UnrealBloomPass,
  OutputPass, ShaderPass, CopyShader, LuminosityHighPassShader): MIT, © 2010–2023
  three.js authors. The full licence text is in `game/vendor/THREE-LICENSE`.
  Note: the addon files ship without a per-file MIT header (only
  `three.module.js` carries one); the full text is kept in `THREE-LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=rp1x5e31&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>
