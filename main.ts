// SKYLINE RUNNER — Sunset Rally (v7, Three.js r160 renderer). main.ts
// The entry program (Node 22, standard library only): the game is this directory's
// game/ folder, plain static files a desktop browser loads offline (game/index.html
// loads the Three.js renderer from game/src/; Three.js r160 is vendored locally
// under game/vendor/ — no CDN, no network request), and the program hands it in.
// It copies game/ and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun
// library. The game itself: a sunset flight rally over a 3D island — chase or cockpit
// view, the aircraft in frame with instruments lit, a runway ahead, altitude,
// speed and heading on the HUD. Take off from Runway 36, thread 12 glowing target
// rings, then land on the runway — beat the 180 s par for the time bonus. Keyboard
// (arrows, Shift/R/Z/F, G, C, P, M) and mouse; sounds are synthesised in the browser,
// no audio files.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
// Screenshots (screenshots/, first by name is the cover — the judge's contact
// sheet shows it large on top): 1-cover.jpg the take-off roll on Runway 36 at
// sunset (chase view, aircraft in frame, runway lane ahead), 2-ring.jpg a banked
// ring pass over the coast with the sea and shoreline in frame and a +500 popup,
// 3-play.jpg the cockpit view over the sea toward a ring and the island,
// 4-end.jpg the "Touchdown." debrief with the landed aircraft and runway lights
// beside the score card. All four are real renders of the game's own ?shot=
// staged scenes, taken in desktop Chrome.
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
