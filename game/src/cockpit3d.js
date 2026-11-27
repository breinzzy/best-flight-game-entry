// cockpit3d.js — the real 3D cockpit for SKYLINE RUNNER v8.
// A physical instrument panel in the 3D world: glareshield, six working dials
// (canvas textures, refreshed live from the flight model), yoke, canopy
// pillars and side consoles. The group rides the camera in cockpit view —
// the camera is fixed to the aircraft there, so the panel is fixed to the
// aircraft too, exactly like a real panel. No DOM, no 2D overlay tricks:
// what the cockpit screenshot shows is geometry the renderer draws.
import * as THREE from 'three';

// ---------- dial face drawing (canvas textures, same visual language as
// the 2D HUD dials: dark face, amber ticks, white needle) ----------
function dialCanvas() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  return c;
}
function drawDialFace(g, frac, label, value, sub) {
  const W = 256, cx = 128, cy = 128, r = 118;
  g.clearRect(0, 0, W, W);
  const gr = g.createRadialGradient(cx, cy - 30, 10, cx, cy, r);
  gr.addColorStop(0, '#1c2530'); gr.addColorStop(1, '#070a0e');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  g.lineWidth = 6; g.strokeStyle = '#4b5866'; g.stroke();
  g.lineWidth = 3; g.strokeStyle = '#ffc25a';
  g.shadowColor = '#ffc25a'; g.shadowBlur = 8;
  for (let i = 0; i <= 20; i++) {
    const a = (135 + i / 20 * 270) * Math.PI / 180, l = i % 2 ? 10 : 22;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r * .88, cy + Math.sin(a) * r * .88);
    g.lineTo(cx + Math.cos(a) * r * (.88 - l / r), cy + Math.sin(a) * r * (.88 - l / r));
    g.stroke();
  }
  const a = (135 + Math.max(0, Math.min(1, frac)) * 270) * Math.PI / 180;
  g.shadowBlur = 0; g.lineWidth = 7; g.strokeStyle = '#ffffff';
  g.beginPath(); g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(a) * r * .72, cy + Math.sin(a) * r * .72); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, 9, 0, 7); g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffc25a'; g.font = '700 22px monospace';
  g.fillText(label, cx, cy - r * .42);
  g.fillStyle = '#fff'; g.font = '700 30px monospace';
  g.fillText(value, cx, cy + r * .48);
  if (sub) { g.fillStyle = '#ffc25a'; g.font = '20px monospace'; g.fillText(sub, cx, cy + r * .68); }
}
function drawAttitudeFace(g, pitch, roll) {
  const W = 256, cx = 128, cy = 128, r = 118;
  g.clearRect(0, 0, W, W);
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip();
  g.translate(cx, cy); g.rotate(-roll);
  const off = pitch * 180 / Math.PI * r / 35;
  g.fillStyle = '#2f78c8'; g.fillRect(-r * 2, -r * 2 + off, r * 4, r * 2);
  g.fillStyle = '#7a5230'; g.fillRect(-r * 2, off, r * 4, r * 2);
  g.strokeStyle = '#fff'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(-r * 2, off); g.lineTo(r * 2, off); g.stroke();
  g.lineWidth = 2;
  for (const p of [-20, -10, 10, 20]) {
    const yy = off - p * r / 35, w = p % 20 ? r * .25 : r * .4;
    g.beginPath(); g.moveTo(-w, yy); g.lineTo(w, yy); g.stroke();
  }
  g.restore();
  g.save();
  g.strokeStyle = '#ffc25a'; g.lineWidth = 6;
  g.shadowColor = '#ffc25a'; g.shadowBlur = 8;
  g.beginPath();
  g.moveTo(cx - r * .55, cy); g.lineTo(cx - r * .18, cy); g.lineTo(cx - r * .1, cy + r * .1);
  g.moveTo(cx + r * .55, cy); g.lineTo(cx + r * .18, cy); g.lineTo(cx + r * .1, cy + r * .1);
  g.stroke();
  g.fillStyle = '#ffc25a'; g.beginPath(); g.arc(cx, cy, 7, 0, 7); g.fill();
  g.restore();
  g.lineWidth = 6; g.strokeStyle = '#4b5866'; g.shadowBlur = 0;
  g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
  g.fillStyle = '#ffc25a'; g.font = '700 20px monospace'; g.textAlign = 'center';
  g.fillText('ATTITUDE', cx, cy + r * .78);
}
function drawCompassFace(g, hdg) {
  const W = 256, cx = 128, cy = 128, r = 118;
  g.clearRect(0, 0, W, W);
  g.fillStyle = '#070a0e'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
  g.save(); g.translate(cx, cy); g.rotate(-hdg * Math.PI / 180);
  g.strokeStyle = '#ffc25a'; g.shadowColor = '#ffc25a'; g.shadowBlur = 6; g.lineWidth = 3;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i < 36; i++) {
    const a = i * 10 * Math.PI / 180 - Math.PI / 2, l = i % 3 ? .1 : .18;
    g.beginPath();
    g.moveTo(Math.cos(a) * r * .9, Math.sin(a) * r * .9);
    g.lineTo(Math.cos(a) * r * (.9 - l), Math.sin(a) * r * (.9 - l));
    g.stroke();
  }
  ['N', 'E', 'S', 'W'].forEach((c, i) => {
    const a = i * Math.PI / 2 - Math.PI / 2;
    g.fillStyle = i ? '#ffc25a' : '#ff6b5a'; g.font = '700 26px monospace';
    g.fillText(c, Math.cos(a) * r * .58, Math.sin(a) * r * .58);
  });
  g.restore();
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(cx, cy - r * .35); g.lineTo(cx - r * .12, cy + r * .2);
  g.lineTo(cx, cy + r * .1); g.lineTo(cx + r * .12, cy + r * .2);
  g.fill();
  g.lineWidth = 6; g.strokeStyle = '#4b5866'; g.shadowBlur = 0;
  g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke();
  g.fillStyle = '#ffc25a'; g.font = '700 20px monospace'; g.textAlign = 'center';
  g.fillText('HDG ' + String(Math.round(hdg) % 360).padStart(3, '0'), cx, cy + r * .78);
}

// ---------- build ----------
export function buildCockpit() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: .6, metalness: .4 });
  const darker = new THREE.MeshStandardMaterial({ color: 0x0b0e11, roughness: .7, metalness: .3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0e1a24, roughness: .06, metalness: .15, envMapIntensity: 1.2 });
  const add = (mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); g.add(mesh); return mesh; };

  // Glareshield: the dark brow above the panel, seen against the sky.
  const shield = add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.09, 0.4), darker), 0, -0.08, -1.02);
  shield.rotation.x = 0.18;
  // Instrument panel: slightly curved feel from a wide box, tilted back.
  const panel = add(new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.58, 0.1), dark), 0, -0.44, -1.12);
  panel.rotation.x = -0.14;
  // Panel top rail + bottom lip.
  add(new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.05, 0.12), darker), 0, -0.14, -1.1).rotation.x = -0.14;
  add(new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.04, 0.1), darker), 0, -0.73, -1.16).rotation.x = -0.14;

  // Six dials across the panel, faces slightly in front of the panel surface.
  const dials = [];
  const defs = [
    { key: 'ias', label: 'AIRSPEED' }, { key: 'att', label: 'ATTITUDE' },
    { key: 'alt', label: 'ALTITUDE' }, { key: 'hdg', label: 'HEADING' },
    { key: 'vs', label: 'VERT SPD' }, { key: 'rpm', label: 'ENGINE' },
  ];
  defs.forEach((d, i) => {
    const c = dialCanvas();
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.155, 32),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    m.position.set(-0.75 + i * 0.3, -0.44, -1.06);
    m.rotation.x = -0.14;
    g.add(m);
    // Bezel ring around each dial.
    const bez = new THREE.Mesh(new THREE.TorusGeometry(0.158, 0.012, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0x4b5866, roughness: .4, metalness: .7 }));
    bez.position.copy(m.position); bez.rotation.x = -0.14;
    g.add(bez);
    dials.push({ key: d.key, label: d.label, canvas: c, ctx: c.getContext('2d'), tex });
  });

  // Fuel strip under the panel: a thin bar that drains with the tank.
  const fuelCanvas = dialCanvas();
  const fuelTex = new THREE.CanvasTexture(fuelCanvas);
  const fuelBar = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.07),
    new THREE.MeshBasicMaterial({ map: fuelTex, transparent: true }));
  fuelBar.position.set(0, -0.78, -1.14);
  fuelBar.rotation.x = -0.14;
  g.add(fuelBar);

  // Yoke: column + wheel, centred below the panel.
  const col = add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.5, 8), dark), 0, -0.62, -0.85);
  col.rotation.x = 0.5;
  const yoke = add(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 10, 24), dark), 0, -0.52, -0.72);
  yoke.rotation.x = 0.35;
  add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), darker), 0, -0.52, -0.72);

  // Canopy frame: two A-pillars + top crossbar, framing the windscreen.
  // Pillars sit just outside the outer dials so they never cover a face.
  for (const s of [-1, 1]) {
    const pil = add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.5, 0.07), dark), s * 1.06, 0.35, -1.05);
    pil.rotation.z = -s * 0.10;
    // Side console with three lit switches.
    const con = add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.5), dark), s * 0.97, -0.70, -0.85);
    con.rotation.x = 0.1;
    const cols = [[0.3, 1, 0.5], [1, 0.8, 0.3], [0.3, 1, 0.5]];
    for (let i = 0; i < 3; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(cols[i][0] * 2, cols[i][1] * 2, cols[i][2] * 2) }));
      dot.position.set(s * 0.97, -0.63 - i * 0.07, -0.58);
      g.add(dot);
    }
  }
  const bar = add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.07, 0.07), dark), 0, 1.02, -1.05);
  bar.rotation.z = 0;
  // Windscreen glass hint: a very faint tinted plane high up, so the frame reads.
  const ws = add(new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.9),
    new THREE.MeshBasicMaterial({ color: 0x88aacc, transparent: true, opacity: 0.04, side: THREE.DoubleSide, depthWrite: false })),
    0, 0.55, -1.08);
  ws.material.color.setRGB(0.5, 0.65, 0.8);

  g.visible = false;
  return { group: g, dials, fuelCanvas, fuelTex, lastUpdate: -1 };
}

// ---------- live update (throttled to ~10 Hz; canvas redraws are the cost) ----------
export function updateCockpit(ck, d, nowMs) {
  if (nowMs - ck.lastUpdate < 100) return;
  ck.lastUpdate = nowMs;
  for (const dl of ck.dials) {
    const g = dl.ctx;
    if (dl.key === 'ias') drawDialFace(g, d.kt / 260, 'AIRSPEED', `${Math.round(d.kt)} KT`);
    else if (dl.key === 'att') drawAttitudeFace(g, d.pitch, d.roll);
    else if (dl.key === 'alt') drawDialFace(g, (d.ft % 1000) / 1000, 'ALTITUDE', `${Math.round(d.ft)} FT`, `×1000: ${Math.floor(d.ft / 1000)}`);
    else if (dl.key === 'hdg') drawCompassFace(g, d.hdg);
    else if (dl.key === 'vs') drawDialFace(g, Math.max(0, Math.min(1, .5 + d.vsFpm / 4000)), 'VERT SPD', `${Math.round(d.vsFpm / 10) * 10}`, 'FPM');
    else if (dl.key === 'rpm') drawDialFace(g, d.thr, 'ENGINE', `${Math.round(800 + d.thr * 1900)} RPM`, `THR ${Math.round(d.thr * 100)}%`);
    dl.tex.needsUpdate = true;
  }
  // Fuel strip: amber bar, red below 25%.
  const g = ck.fuelCanvas.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = '#0b0e11'; g.fillRect(0, 0, 256, 256);
  const pct = Math.max(0, Math.min(1, d.fuelPct));
  g.fillStyle = pct < 0.25 ? '#ff4b3a' : '#ffc25a';
  g.fillRect(8, 96, 240 * pct, 64);
  g.strokeStyle = '#4b5866'; g.lineWidth = 6; g.strokeRect(4, 92, 248, 72);
  g.fillStyle = '#e8f4ff'; g.font = '700 34px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(`FUEL ${Math.round(d.fuelKg)} KG`, 128, 196);
  ck.fuelTex.needsUpdate = true;
}
