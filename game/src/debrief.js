// debrief.js — the debrief model: per-sortie breakdowns, campaign totals,
// and the glidepath analysis behind the "Touchdown." card.
// Pure functions over plain data. The drawing lives in main.js (hud); this
// module decides what the numbers mean, so the card never invents them.
'use strict';

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

// Landing bonus rows, from the real touchdown numbers (v7's formula).
// sink: vertical speed at touchdown (m/s, negative = down). centreX: metres
// off the centreline. timeB: par-time bonus in points.
export function landingRows(touchVs, centreX, timeB) {
  return {
    sink: clamp(Math.round(500 + touchVs * 60), 0, 500),
    centre: clamp(Math.round(500 - Math.abs(centreX) * 12), 0, 500),
    time: Math.max(0, timeB),
  };
}

// Glidepath analysis: the flown approach trace (array of {d, h} — distance to
// the threshold in m, height above it in m) against the ideal 3.0° line.
// Returns the RMS deviation in metres and a plain-language verdict.
export function glidepath(trace) {
  const ideal = d => d * Math.tan(3 * Math.PI / 180);
  if (!trace || trace.length < 2) return { rms: null, verdict: 'NO TRACE', onPath: false };
  let se = 0;
  for (const p of trace) { const e = p.h - ideal(p.d); se += e * e; }
  const rms = Math.sqrt(se / trace.length);
  const verdict = rms < 12 ? 'ON THE GLIDEPATH' : rms < 30 ? 'HIGH ON FINAL' : 'OFF THE GLIDEPATH';
  return { rms, verdict, onPath: rms < 12 };
}

// One sortie's debrief rows for the card: label/value pairs, in card order.
export function sortieRows(bd) {
  return [
    { label: `RINGS  ${bd.ringsHit} / ${bd.ringsTotal}`, value: `+${bd.rings}` },
    { label: `LANDING — SINK ${bd.touchVs.toFixed(1)} m/s`, value: `+${bd.sink}` },
    { label: `LANDING — CENTRELINE ${Math.abs(bd.centreX).toFixed(0)} m off`, value: `+${bd.centre}` },
    { label: 'TIME BONUS', value: `+${bd.time}` },
    ...(bd.speedBonus ? [{ label: `SPEED BONUS  ${bd.speedBonus} m/s gates`, value: `+${bd.speed}` }] : []),
    ...(bd.flare ? [{ label: 'FLARE RACK', value: `+${bd.flare}` }] : []),
  ];
}

// Campaign card rows: sortie totals + fuel reserve + feats + grand total.
import { featsEarned } from './campaign.js';

export function campaignRows(c, total) {
  const rows = c.scores.map((s, i) => ({ label: `SORTIE ${i + 1} — ${c.sortieNames[i]}`, value: String(s) }));
  rows.push({ label: `FUEL RESERVE  ${Math.max(0, Math.round(c.fuelKg))} KG × 2`, value: `+${total.fuelBonus}` });
  rows.push({ label: `FEATS  ${featsEarned(c)} / 9 × 300`, value: `+${total.featBonus}` });
  return rows;
}
