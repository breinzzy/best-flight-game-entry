# SKYLINE RUNNER — Campaign (v8)

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/breinzzy/best-flight-game-entry/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/breinzzy/best-flight-game-entry/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

SKYLINE RUNNER — Campaign: a true-3D flight campaign rendered with Three.js
r160 (vendored locally, no CDN). Three sorties, one tank of fuel, airframe
damage, turnaround refits and 9 feats — chase or real 3D cockpit view over a
heightmap island with mountains, forest and a village, the aircraft in frame
with instruments lit, a runway ahead, altitude, speed and heading on the HUD.
Sortie 1 Sunset Rally: thread 12 glowing rings, beat the 180 s par. Sortie 2
North Coast Slalom: 10 low gates along the north coast, +100 per gate passed over
50 m/s. Sortie 3 Storm Approach: 6 rings in a 7 m/s crosswind with rain and
low cloud, then a PAPI landing. Between sorties, pick 1 of 3 refits in Pak
Dar's hangar (lean mixture, long legs, storm eyes, flare rack…). Fuel runs
out and the engine quits; a BINGO FUEL call forces a decision — straight in
or press on. Every sortie ends with a debrief and an approach-trace graph
against the ideal 3.0° glidepath; the campaign ends with a grand total. Free
6-DOF flight with stall, terrain crash, working gear (G — landing with the
gear up is a crash), a sunset sky with sun glitter on the water, a real shadow
under the aircraft, wingtip smoke in turns. Keyboard and mouse; sounds are
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
| C | Camera (chase / 3D cockpit) |
| 1 / 2 / 3 | Pick a refit · answer the BINGO FUEL call |
| Space | Brakes (on the ground) |
| P | Pause |
| M | Sound on / off |
| Enter | Start / restart |

Mouse: hold the left button and move to fly.

## Scoring

- Each ring: 250 pts + 50 per combo level (rings in a row without missing),
  +25 with the Radio Relay refit.
- Canyon Slalom speed bonus: +100 per gate passed over 50 m/s.
- Landing bonus: up to 500 for a gentle touchdown sink rate + up to 500 for
  landing close to the centreline (+250 with the Flare Rack refit).
- Time bonus: 5 pts per second left under the sortie's par (180 / 150 / 200 s).
- Campaign end: +2 per kg of fuel left in the tank, +300 per feat (9 feats).
- Landing with the gear up, stalling into the ground, or hitting terrain or
  water ends the sortie; a hard landing costs 15% airframe, and 0% airframe
  grounds the campaign.

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
