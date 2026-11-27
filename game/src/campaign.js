// campaign.js — the SKYLINE RUNNER campaign: 3 sorties, fuel, damage, refits, feats.
// Pure data + rules. No DOM, no THREE, no network. main.js owns the flight
// loop and calls into this module; the renderer only reads the weather flag.
// Written fresh for v8 (the v3/v4 campaign was Canvas 2D and is gone); the
// numbers below are the v8 campaign's own: 3 sorties, 28 rings, 9 refits,
// 9 feats, one tank of fuel shared across the whole campaign.
'use strict';

// ---------- sorties ----------
// gp holds [x,z] pairs only; gate heights are computed from the terrain at
// build time (main.js buildGates): last gate low over the threshold, the rest
// high — except the slalom, whose gates sit low (90 m) for the low-level run.
export const SORTIES = [
  { id: 'sunset-rally', name: 'SUNSET RALLY', place: 'RUNWAY 36 · GOLDEN HOUR',
    par: 180, weather: 'clear', wind: [0, 0], low: false,
    gp: [[0,-1500],[800,-2700],[2200,-3300],[3500,-2400],[3900,-800],[3200,800],[2000,1900],[400,2700],[-1300,2500],[-2600,1200],[-2400,-800],[0,800]],
    brief: 'Thread 12 glowing rings over the island at golden hour, then land on Runway 36.',
    goals: ['THREAD 12 RINGS', 'LAND ON RUNWAY 36', 'BEAT THE 180 S PAR'] },
  { id: 'canyon-slalom', name: 'NORTH COAST SLALOM', place: 'NORTH COAST · LOW LEVEL',
    par: 150, weather: 'clear', wind: [0, 0], low: true, speedBonus: true,
    gp: [[-3000,-5000],[-2000,-5400],[-1000,-5000],[0,-5400],[1000,-5000],[2000,-5400],[3000,-5000],[0,-4000],[0,-3000],[0,800]],
    brief: 'Low gates over the north sea — flat water, no terrain under you. Over 50 m/s through a gate pays +100.',
    goals: ['THREAD 10 GATES', 'SPEED BONUS OVER 50 M/S', 'LAND ON RUNWAY 36'] },
  { id: 'storm-approach', name: 'STORM APPROACH', place: 'RUNWAY 36 · SQUALL LINE',
    par: 200, weather: 'storm', wind: [7, 0], low: false,
    gp: [[-800,-3500],[-400,-2800],[800,-2000],[1200,-1200],[500,-400],[0,800]],
    brief: 'The squall line is on the field. Six rings in a 7 m/s crosswind — swing west around the headland, then a PAPI landing in the rain.',
    goals: ['THREAD 6 RINGS', 'HOLD THE GLIDEPATH', 'LAND IN CROSSWIND'] },
];

// ---------- refits ----------
// Offered pick-1-of-3 at each turnaround (two turnarounds in a campaign).
// Each one changes a real number in the flight model — see the flag it sets.
export const REFITS = [
  { id: 'lean-mixture',  name: 'LEAN MIXTURE',   desc: 'Fuel burn −15%' },
  { id: 'long-legs',     name: 'LONG LEGS',      desc: '+60 kg tank capacity' },
  { id: 'soft-springs',  name: 'SOFT SPRINGS',   desc: 'Hard-landing damage −50%' },
  { id: 'hot-props',     name: 'HOT PROPS',      desc: 'Thrust +15%' },
  { id: 'storm-eyes',    name: 'STORM EYES',     desc: 'Crosswind push −30%' },
  { id: 'flare-rack',    name: 'FLARE RACK',     desc: 'Landing bonus +250' },
  { id: 'wing-tanks',    name: 'WING TANKS',     desc: '+60 kg fuel, right now' },
  { id: 'gyro-stab',     name: 'GYRO STABILISER',desc: 'Stall speed −5 m/s' },
  { id: 'radio-relay',   name: 'RADIO RELAY',    desc: 'Ring points +25 each' },
];

// ---------- feats ----------
// Unlock on real events only. +300 each at the campaign debrief.
export const FEATS = [
  { id: 'first-light',   icon: '☀', name: 'FIRST LIGHT',   desc: 'Finish Sortie 1' },
  { id: 'on-rails',      icon: '◎', name: 'ON RAILS',      desc: 'Ring streak ≥ 5' },
  { id: 'eight-in-a-row',icon: '∞', name: 'EIGHT IN A ROW',desc: 'Ring streak ≥ 8' },
  { id: 'greaser',       icon: '✦', name: 'GREASER',       desc: 'Land softer than 200 fpm' },
  { id: 'storm-rider',   icon: '⚡', name: 'STORM RIDER',   desc: 'Finish Sortie 3 in the storm' },
  { id: 'bingo-call',    icon: '⛽', name: 'BINGO CALL',    desc: 'Answer a BINGO FUEL call' },
  { id: 'press-on',      icon: '»', name: 'PRESS ON',      desc: 'Press on past BINGO and finish' },
  { id: 'clean-sheet',   icon: '✓', name: 'CLEAN SHEET',   desc: 'Finish a sortie, zero incidents' },
  { id: 'all-home',      icon: '★', name: 'ALL HOME',      desc: 'Bring all 3 sorties home' },
];

export const BINGO_KG = 60;      // BINGO FUEL call below this
export const FEAT_POINTS = 300;  // each feat at the campaign debrief
export const FUEL_START_KG = 420;

// ---------- campaign state ----------
export function newCampaign() {
  return {
    sortie: 0,                                   // index into SORTIES
    sortieNames: SORTIES.map(s => s.name),
    status: ['NEXT', 'LOCKED', 'LOCKED'],        // per sortie: NEXT / FLOWN / LOCKED
    scores: [0, 0, 0],                           // per-sortie totals
    grades: ['—', '—', '—'],
    fuelKg: FUEL_START_KG, tankKg: FUEL_START_KG,
    airframe: 100,                               // % — 0 grounds the aircraft
    refits: [], feats: {},
    incidents: 0,                                // this sortie: hard landings + BINGO
    bingoAnswered: false, bingoPressedOn: false,
    straightIn: false,                           // BINGO choice: skip to landing
    maxCombo: 0,
    over: false, failed: false,                  // campaign done / grounded
  };
}

export const hasRefit = (c, id) => c.refits.includes(id);
// Multipliers the flight model reads every frame.
export const burnMul    = c => hasRefit(c, 'lean-mixture') ? 0.85 : 1;
export const thrustMul  = c => hasRefit(c, 'hot-props') ? 1.15 : 1;
export const windMul    = c => hasRefit(c, 'storm-eyes') ? 0.7 : 1;
export const damageMul  = c => hasRefit(c, 'soft-springs') ? 0.5 : 1;
export const stallDelta = c => hasRefit(c, 'gyro-stab') ? -5 : 0;
export const ringBonus  = c => hasRefit(c, 'radio-relay') ? 25 : 0;
export const flareBonus = c => hasRefit(c, 'flare-rack') ? 250 : 0;

// Fuel burn: 0.15 kg/s idling + 0.45 kg/s at full throttle, times the refit mul.
export const fuelBurnRate = (c, thr) => (0.15 + thr * 0.45) * burnMul(c);

// Turnaround offer: 3 refits the campaign does not own yet, rotating by
// sortie so the two turnarounds offer different sets (deterministic).
export function refitOffer(c) {
  const pool = REFITS.filter(r => !c.refits.includes(r.id));
  const off = (c.sortie * 3) % Math.max(1, pool.length);
  const out = [];
  for (let i = 0; i < 3 && pool.length; i++) out.push(pool[(off + i) % pool.length]);
  return out;
}
export function applyRefit(c, refit) {
  if (!refit || c.refits.includes(refit.id)) return false;
  c.refits.push(refit.id);
  if (refit.id === 'long-legs') c.tankKg += 60;
  if (refit.id === 'wing-tanks') c.fuelKg = Math.min(c.tankKg, c.fuelKg + 60);
  return true;
}

// Feats: returns true only the first time a feat is earned.
export function awardFeat(c, id) {
  if (c.feats[id]) return false;
  c.feats[id] = true;
  return true;
}
export const featsEarned = c => FEATS.filter(f => c.feats[f.id]).length;
export const featById = id => FEATS.find(f => f.id === id);

// Campaign totals: sortie scores + fuel reserve + feats.
export function campaignTotal(c) {
  const sortieSum = c.scores.reduce((a, b) => a + b, 0);
  const fuelBonus = Math.max(0, Math.round(c.fuelKg)) * 2;
  const featBonus = featsEarned(c) * FEAT_POINTS;
  return { sortieSum, fuelBonus, featBonus, total: sortieSum + fuelBonus + featBonus };
}
