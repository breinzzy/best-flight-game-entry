// SKYLINE RUNNER — Island Hopper. A complete flight game in plain canvas 2D.
// Chase view over a sunset island chain: fly the circuit, thread 12 target
// rings, then land on the runway. Keyboard + mouse, sounds synthesised live.
// No network request, no library, no asset file — everything is drawn here.
(function () {
  'use strict';
  var cv = document.getElementById('game');
  var ctx = cv.getContext('2d');
  var W = 1280, H = 720;

  // ---------- deterministic random ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(20261126);

  // ---------- track ----------
  var SEG = 40, DRAW = 150, TOTAL = 720;
  var RW_START = 600, RW_END = 690; // runway island segments
  function groundH(i) {
    // island chain: smooth bumps, sea level 0, runway island flat at 8
    if (i >= RW_START && i <= RW_END) return 8;
    var n = Math.sin(i * 0.045) * 0.5 + Math.sin(i * 0.013 + 2.1) * 0.5;
    var bump = Math.max(0, n);
    // islands cluster in bands
    var band = Math.sin(i * 0.021 + 0.7) > 0.1 ? 1 : 0.25;
    return bump * 26 * band;
  }
  var segs = [];
  for (var i = 0; i < TOTAL; i++) {
    segs.push({ i: i, h: groundH(i), runway: i >= RW_START && i <= RW_END });
  }
  // rings: 12, spaced, alternating sides and heights, last one over the runway
  var RINGS = [];
  (function () {
    var spots = [70, 130, 190, 250, 310, 365, 420, 470, 520, 560, 585, 605];
    var xs = [-0.55, 0.5, -0.2, 0.65, -0.6, 0.15, -0.45, 0.6, -0.1, 0.45, -0.35, 0];
    var alts = [55, 80, 45, 95, 60, 110, 70, 85, 50, 100, 65, 45];
    for (var k = 0; k < spots.length; k++) {
      RINGS.push({ seg: spots[k], x: xs[k], alt: alts[k], r: 1.1, hit: false, missed: false, flashT: 0 });
    }
  })();

  // ---------- state ----------
  var G = {
    screen: 'title', // title | play | crash | win | pause
    pos: 0,          // segment position (float)
    x: 0,            // lateral offset -1.4 .. 1.4
    alt: 70,         // feet above sea
    pitch: 0,        // -1 climb .. 1 dive
    roll: 0,         // -1 .. 1
    heading: 268,
    speed: 0,        // knots
    throttle: 0.55,
    score: 0, combo: 0, ringsHit: 0,
    timeLeft: 180, elapsed: 0,
    msg: '', msgT: 0, flash: 0,
    fuel: 100, vsi: 0, gear: 'DN', flaps: 2, windKt: 12, windDir: 'NW',
    muted: false, started: false,
    camBob: 0,
  };
  var keys = {};
  var mouse = { x: W / 2, y: H * 0.5, active: false };

  // clouds + mountains, precomputed so every frame is stable
  var clouds = [];
  for (var c = 0; c < 26; c++) clouds.push({ x: rng(), y: 0.04 + rng() * 0.3, s: 30 + rng() * 90, a: 0.25 + rng() * 0.5 });
  var ridge1 = [], ridge2 = [];
  for (var m = 0; m < 90; m++) {
    ridge1.push(60 + Math.sin(m * 0.35) * 26 + Math.sin(m * 0.11 + 1) * 30);
    ridge2.push(34 + Math.sin(m * 0.5 + 3) * 16 + Math.sin(m * 0.17) * 18);
  }
  var palms = []; // island palm billboards: {seg, side}
  for (var p = 0; p < 60; p++) palms.push({ seg: 20 + Math.floor(rng() * 560), side: rng() < 0.5 ? -1 : 1, s: 0.7 + rng() * 0.6 });
  var popups = []; // floating "+250" score popups: {x, y, text, t, max}
  var birds = []; // distant birds: {x, y, s, ph}
  for (var b = 0; b < 9; b++) birds.push({ x: rng(), y: 0.07 + rng() * 0.22, s: 5 + rng() * 7, ph: rng() * 6 });

  // ---------- helpers ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function fmt(n, d) { return n.toFixed(d === undefined ? 0 : d); }
  function pad3(n) { n = Math.round(n); return (n < 10 ? '00' : n < 100 ? '0' : '') + n; }

  function showMsg(t, dur) { G.msg = t; G.msgT = dur || 2.2; }

  // ---------- audio hooks ----------
  function audio() { return window.SkyAudio; }

  // ---------- reset / staging ----------
  function startGame() {
    G.screen = 'play'; G.pos = 0; G.x = 0; G.alt = 70; G.pitch = 0; G.roll = 0;
    G.heading = 268; G.speed = 120; G.throttle = 0.55;
    G.score = 0; G.combo = 0; G.ringsHit = 0; G.timeLeft = 180; G.elapsed = 0;
    G.fuel = 100; G.vsi = 0; G.gear = 'DN'; G.flaps = 2; popups.length = 0;
    RINGS.forEach(function (r) { r.hit = false; r.missed = false; r.flashT = 0; });
    showMsg('RING 1 AHEAD — THREAD THE GLOWING RINGS', 3);
    audio().unlock(); audio().click();
  }

  // ---------- update ----------
  var last = performance.now();
  function update(dt) {
    if (G.screen !== 'play') return;
    G.elapsed += dt;
    G.timeLeft -= dt;
    if (G.timeLeft <= 0) { G.timeLeft = 0; endCrash('OUT OF TIME — THE SUN SET ON YOUR CIRCUIT'); return; }

    // input: roll + pitch
    var rollIn = (keys['ArrowLeft'] || keys['KeyA'] ? -1 : 0) + (keys['ArrowRight'] || keys['KeyD'] ? 1 : 0);
    var pitchIn = (keys['ArrowUp'] || keys['KeyW'] ? -1 : 0) + (keys['ArrowDown'] || keys['KeyS'] ? 1 : 0);
    if (mouse.active) {
      rollIn = clamp((mouse.x - W / 2) / (W * 0.28), -1, 1);
      pitchIn = clamp((mouse.y - H * 0.5) / (H * 0.3), -1, 1) * 0.8;
    }
    G.roll = lerp(G.roll, rollIn, 1 - Math.pow(0.0015, dt));
    G.pitch = lerp(G.pitch, pitchIn, 1 - Math.pow(0.004, dt));

    // throttle
    if (keys['ShiftLeft'] || keys['ShiftRight'] || keys['Equal']) G.throttle = clamp(G.throttle + dt * 0.5, 0, 1);
    if (keys['ControlLeft'] || keys['ControlRight'] || keys['Minus']) G.throttle = clamp(G.throttle - dt * 0.5, 0, 1);

    // speed follows throttle, eased
    var targetSpeed = 90 + G.throttle * 190;
    G.speed = lerp(G.speed, targetSpeed, 1 - Math.pow(0.2, dt));
    var speed01 = clamp((G.speed - 90) / 190, 0, 1);

    // lateral + heading from bank
    G.x = clamp(G.x + G.roll * speed01 * dt * 0.9, -1.5, 1.5);
    G.heading = (G.heading + G.roll * speed01 * dt * 14 + 360) % 360;

    // altitude from pitch (climb costs speed a touch)
    G.alt += -G.pitch * (60 + speed01 * 120) * dt;
    G.alt = clamp(G.alt, 4, 420);

    // advance along the circuit
    G.pos += (G.speed * dt) / SEG * 0.9;
    G.camBob += dt * 6;
    // fuel burn + vertical speed
    G.fuel = Math.max(0, G.fuel - dt * (0.05 + G.throttle * 0.10));
    G.vsi = lerp(G.vsi, -G.pitch * (60 + speed01 * 120) * 12, 1 - Math.pow(0.05, dt));
    // ring flash + score popups decay
    RINGS.forEach(function (r) { if (r.flashT > 0) r.flashT -= dt; });
    for (var pi = popups.length - 1; pi >= 0; pi--) { popups[pi].t -= dt; if (popups[pi].t <= 0) popups.splice(pi, 1); }

    // ground collision
    var segIdx = Math.floor(G.pos) % TOTAL;
    var ground = segs[segIdx].h;
    if (G.alt <= ground + 3) {
      if (segs[segIdx].runway && G.speed < 150 && Math.abs(G.x) < 0.55 && G.ringsHit >= 12) {
        endWin(); return;
      }
      endCrash(ground > 2 ? 'TERRAIN STRIKE — YOU CLIPPED THE ISLAND' : 'DITCHED IN THE SEA — WATCH YOUR ALTITUDE');
      return;
    }
    // ran out of runway island
    if (G.pos > RW_END + 4) { endCrash('OVERRAN THE RUNWAY — CIRCUIT COMPLETE, TOO LATE TO LAND'); return; }

    // rings
    RINGS.forEach(function (r) {
      if (r.hit || r.missed) return;
      if (G.pos > r.seg + 1) { r.missed = true; G.combo = 0; audio().miss(); showMsg('RING MISSED — COMBO LOST', 1.6); return; }
      if (Math.abs(G.pos - r.seg) < 1.2) {
        var dx = (G.x - r.x), dy = (G.alt - r.alt) / 50;
        if (Math.sqrt(dx * dx + dy * dy) < r.r + 0.35) {
          r.hit = true; G.ringsHit++; G.combo++;
          var pts = 250 + (G.combo - 1) * 50;
          G.score += pts;
          r.flashT = 0.9;
          var rp = project((r.seg - G.pos) * SEG, r.alt / 50, r.x, G.alt / 50 + 0.35);
          popups.push({ x: rp.x, y: rp.y, text: '+' + pts, t: 1.4, max: 1.4 });
          audio().ring();
          showMsg('RING ' + G.ringsHit + ' / 12  +' + pts + (G.combo > 1 ? '  COMBO x' + G.combo : ''), 1.8);
          if (G.ringsHit === 12) showMsg('ALL RINGS CLEAR — FINAL APPROACH: LAND ON THE RUNWAY', 3.5);
        }
      }
    });

    audio().engine(G.throttle, speed01);
  }

  function endCrash(why) {
    G.screen = 'crash'; G.crashWhy = why; audio().crash(); audio().engine(0, 0);
  }
  function endWin() {
    var bonus = 1000 + Math.round(G.timeLeft) * 5;
    G.score += bonus; G.landBonus = bonus;
    G.screen = 'win'; audio().win(); audio().engine(0, 0);
  }

  // ---------- projection ----------
  var camDepth = 0.84;
  var M_PER_UNIT = 15.24; // 1 world unit ~ 50 ft; z arrives in metres, convert
  // World units: 1 unit ~ 50 ft. Corridor half-width 2 units, rings ~1.1 units.
  function project(z, worldY, worldX, camY) {
    var scale = camDepth / Math.max(z / M_PER_UNIT, 0.001);
    return {
      x: W / 2 + scale * (worldX - G.x) * (W / 2),
      y: horizonY() - scale * (worldY - camY) * (H / 2),
      scale: scale,
      w: scale * (W / 2),
    };
  }
  function horizonY() { return H * 0.42 - G.pitch * 46 + Math.sin(G.camBob * 0.5) * 1.2; }

  // ---------- drawing ----------
  function drawSky() {
    var hy = horizonY();
    var g = ctx.createLinearGradient(0, 0, 0, hy + 60);
    g.addColorStop(0, '#1b2a5e'); g.addColorStop(0.45, '#7a4a8f');
    g.addColorStop(0.75, '#e8703f'); g.addColorStop(1, '#ffc46b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, hy + 60);
    // sun
    var sx = W * 0.72, sy = hy - 96;
    var sg = ctx.createRadialGradient(sx, sy, 4, sx, sy, 150);
    sg.addColorStop(0, 'rgba(255,236,170,0.95)'); sg.addColorStop(0.25, 'rgba(255,190,90,0.55)');
    sg.addColorStop(1, 'rgba(255,150,60,0)');
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sx, sy, 150, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.arc(sx, sy, 34, 0, 7); ctx.fill();
    // clouds
    clouds.forEach(function (cl, i) {
      var cx = ((cl.x * W + G.elapsed * (4 + i % 5) * 0.4 + G.heading * 2) % (W + 260)) - 130;
      var cy = cl.y * H * 0.9;
      ctx.fillStyle = 'rgba(255,214,180,' + cl.a * 0.55 + ')';
      ctx.beginPath();
      ctx.ellipse(cx, cy, cl.s, cl.s * 0.32, 0, 0, 7);
      ctx.ellipse(cx + cl.s * 0.5, cy + 4, cl.s * 0.6, cl.s * 0.26, 0, 0, 7);
      ctx.fill();
    });
    // far mountain ridges (parallax with heading)
    drawRidge(ridge2, hy, '#5d3f78', 0.35, 56);
    drawRidge(ridge1, hy, '#3c2a5e', 0.7, 92);
    // distant birds
    birds.forEach(function (bd, i) {
      var bx = ((bd.x * W + G.elapsed * (10 + i % 4) * 1.2) % (W + 120)) - 60;
      var by = bd.y * H + Math.sin(G.elapsed * 2 + bd.ph) * 4;
      var flap = Math.sin(G.elapsed * 6 + bd.ph) * bd.s * 0.3;
      ctx.strokeStyle = 'rgba(40,24,52,0.75)'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx - bd.s, by - flap);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + bd.s, by - flap);
      ctx.stroke();
    });
  }
  function drawRidge(ridge, hy, color, par, snowLine) {
    var off = (G.heading * par * 6) % 90;
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-4, hy + 2);
    for (var i = 0; i < 90; i++) {
      var x = (i * (W + 8) / 89) - off;
      ctx.lineTo(x, hy - ridge[(i + Math.floor(off / 1)) % 90] * 0.9);
    }
    ctx.lineTo(W + 4, hy + 2); ctx.closePath(); ctx.fill();
    // snow caps on the tallest peaks
    if (snowLine) {
      ctx.fillStyle = 'rgba(255,244,230,0.92)';
      for (var j = 0; j < 90; j++) {
        var idx = (j + Math.floor(off)) % 90;
        var h = ridge[idx];
        if (h > snowLine && h > ridge[(idx + 89) % 90] && h >= ridge[(idx + 1) % 90]) {
          var px = (j * (W + 8) / 89) - off;
          var py = hy - h * 0.9;
          ctx.beginPath();
          ctx.moveTo(px - 9, py + 4); ctx.lineTo(px, py - 8); ctx.lineTo(px + 9, py + 4);
          ctx.closePath(); ctx.fill();
        }
      }
    }
  }

  // ---------- landmarks ----------
  function drawLighthouse(ix, iy, w, ih) {
    var baseY = iy - ih * 0.45;
    var lh = Math.max(30, w * 4.2), tw = Math.max(8, w * 0.5);
    // rock base
    ctx.fillStyle = '#5a5148';
    ctx.beginPath(); ctx.ellipse(ix, baseY, tw * 1.6, tw * 0.5, 0, 0, 7); ctx.fill();
    // striped tower
    ctx.fillStyle = '#f7f9ff'; ctx.fillRect(ix - tw / 2, baseY - lh, tw, lh);
    ctx.fillStyle = '#e2574c';
    ctx.fillRect(ix - tw / 2, baseY - lh * 0.72, tw, lh * 0.2);
    ctx.fillRect(ix - tw / 2, baseY - lh * 0.32, tw, lh * 0.2);
    // gallery + lamp
    ctx.fillStyle = '#23262e'; ctx.fillRect(ix - tw * 0.8, baseY - lh - lh * 0.1, tw * 1.6, lh * 0.1);
    ctx.save();
    ctx.shadowColor = '#ffe9a8'; ctx.shadowBlur = 16;
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath(); ctx.arc(ix, baseY - lh - lh * 0.05, Math.max(3, tw * 0.42), 0, 7); ctx.fill();
    ctx.restore();
    // sweeping beam
    var ba = -0.55 + Math.sin(G.elapsed * 0.6) * 0.45;
    var bl = w * 9, bw = w * 2.0;
    ctx.save();
    ctx.translate(ix, baseY - lh - lh * 0.05); ctx.rotate(ba);
    var bg = ctx.createLinearGradient(0, 0, bl, 0);
    bg.addColorStop(0, 'rgba(255,233,168,0.20)'); bg.addColorStop(1, 'rgba(255,233,168,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.moveTo(0, -bw * 0.12); ctx.lineTo(bl, -bw * 0.5); ctx.lineTo(bl, bw * 0.5); ctx.lineTo(0, bw * 0.12); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function drawTown(ix, iy, w, ih) {
    var baseY = iy - ih * 0.4;
    var spans = [1.4, 2.6, 1.9, 3.1, 2.2, 1.3, 2.5];
    var totalW = spans.length * w * 0.55;
    var bx = ix - totalW / 2;
    spans.forEach(function (hf, k) {
      var bw = w * 0.55, bh = Math.max(6, hf * w);
      ctx.fillStyle = k % 2 ? '#241f33' : '#2e2742';
      ctx.fillRect(bx, baseY - bh, bw - 1, bh);
      // lit windows
      ctx.fillStyle = 'rgba(255,210,122,0.95)';
      var rows = Math.max(1, Math.floor(bh / (w * 0.55)));
      for (var r = 0; r < rows; r++) {
        var wy = baseY - bh + w * 0.2 + r * w * 0.55;
        if (wy + w * 0.16 > baseY) continue;
        if ((k + r) % 2 === 0) ctx.fillRect(bx + bw * 0.2, wy, Math.max(1.5, w * 0.1), Math.max(1.5, w * 0.14));
        if ((k + r) % 3 === 0) ctx.fillRect(bx + bw * 0.6, wy + w * 0.12, Math.max(1.5, w * 0.1), Math.max(1.5, w * 0.14));
      }
      bx += bw;
    });
  }
  function drawRunwayExtras(camY) {
    // PAPI: 4 lights left of the runway, 2 red + 2 white on glidepath
    var rel = 608 - G.pos;
    if (rel > 2 && rel < 70) {
      var p = project(rel * SEG, 8 / 25, 0, camY);
      for (var i = 0; i < 4; i++) {
        var lx = p.x - p.w * 1.5 - i * p.w * 0.34;
        var ly = p.y - p.w * 0.55;
        var ls = Math.max(2.5, p.w * 0.22);
        ctx.save();
        ctx.shadowColor = i < 2 ? '#ff3b30' : '#ffffff'; ctx.shadowBlur = 8;
        ctx.fillStyle = i < 2 ? '#ff3b30' : '#ffffff';
        ctx.fillRect(lx - ls / 2, ly - ls / 2, ls, ls);
        ctx.restore();
      }
    }
    // windsock right of the runway
    var rel2 = 640 - G.pos;
    if (rel2 > 2 && rel2 < 70) {
      var p2 = project(rel2 * SEG, 8 / 25, 1.7, camY);
      var hgt = Math.max(10, p2.w * 2.6);
      ctx.strokeStyle = '#d8d8d8'; ctx.lineWidth = Math.max(1.5, p2.w * 0.08);
      ctx.beginPath(); ctx.moveTo(p2.x, p2.y); ctx.lineTo(p2.x, p2.y - hgt); ctx.stroke();
      var sl = Math.max(10, p2.w * 1.8);
      ctx.save(); ctx.translate(p2.x, p2.y - hgt); ctx.rotate(0.35);
      ctx.fillStyle = '#ff7a2a';
      ctx.beginPath(); ctx.moveTo(0, -sl * 0.18); ctx.lineTo(sl, -sl * 0.05); ctx.lineTo(sl, sl * 0.05); ctx.lineTo(0, sl * 0.18); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(sl * 0.45, -sl * 0.13, sl * 0.2, sl * 0.26);
      ctx.restore();
    }
  }

  function drawWorld() {
    var hy = horizonY();
    var camY = G.alt / 50 + 0.35;
    var base = Math.floor(G.pos);
    var sea = ctx.createLinearGradient(0, hy, 0, H);
    sea.addColorStop(0, '#e8955a'); sea.addColorStop(0.25, '#7a5a7e');
    sea.addColorStop(0.6, '#274b73'); sea.addColorStop(1, '#12294a');
    ctx.fillStyle = sea; ctx.fillRect(0, hy, W, H - hy);

    // sun reflection column on the water
    var refl = ctx.createLinearGradient(0, hy, 0, H);
    refl.addColorStop(0, 'rgba(255,190,100,0.22)'); refl.addColorStop(1, 'rgba(255,190,100,0)');
    ctx.fillStyle = refl; ctx.fillRect(W * 0.72 - 140, hy, 280, H - hy);
    // soft cloud shadows drifting on the sea
    clouds.forEach(function (cl, i) {
      var cx = ((cl.x * W + G.elapsed * (4 + i % 5) * 0.4 + G.heading * 2) % (W + 260)) - 130;
      var sy = hy + 26 + ((i * 67) % Math.max(40, (H - hy - 40)));
      ctx.fillStyle = 'rgba(8,16,44,0.13)';
      ctx.beginPath(); ctx.ellipse(cx, sy, cl.s * 0.85, cl.s * 0.18, 0, 0, 7); ctx.fill();
    });

    // sun glitter on the sea
    ctx.fillStyle = 'rgba(255,200,110,0.20)';
    for (var gl = 0; gl < 40; gl++) {
      var gx = W * 0.72 + Math.sin(gl * 12.9898) * 190 * ((gl % 7) / 7 + 0.2);
      var gy = hy + 12 + ((gl * 37) % (H - hy - 20));
      ctx.fillRect(gx, gy, 26 - (gl % 5) * 4, 2);
    }

    // segments far -> near (skip the nearest ones: the lane would fill the
    // whole bottom of the frame; the sea gradient carries the foreground)
    for (var n = DRAW - 1; n >= 0; n--) {
      var idx = (base + n) % TOTAL;
      var s1 = segs[idx], s2 = segs[(idx + 1) % TOTAL];
      var z1 = (n + (base - G.pos) + 1) * SEG;
      var z2 = z1 + SEG;
      if (z1 < 100) continue;
      var p1 = project(z1, s1.h / 25, 0, camY);
      var p2 = project(z2, s2.h / 25, 0, camY);
      var halfW = 0.9; // half-width of the flight lane in world units (sea fills the rest)
      var x1l = p1.x - p1.w * halfW, x1r = p1.x + p1.w * halfW;
      var x2l = p2.x - p2.w * halfW, x2r = p2.x + p2.w * halfW;
      var land = s1.h > 2;
      // the lane itself stays sea; islands flank it as separate blobs
      if (land && !s1.runway && n < 70) {
        [-1, 1].forEach(function (side) {
          var ix = p1.x + side * p1.w * 2.6;
          var iw = p1.w * 1.5, ih = Math.max(2, (p2.y - p1.y) * 1.1 + p1.w * 0.35);
          ctx.fillStyle = '#d9c27a';
          ctx.beginPath(); ctx.ellipse(ix, p1.y, iw, ih, 0, 0, 7); ctx.fill();
          ctx.fillStyle = '#4d7a3f';
          ctx.beginPath(); ctx.ellipse(ix, p1.y, iw * 0.78, ih * 0.72, 0, 0, 7); ctx.fill();
          if (idx === 318 && side === -1) drawLighthouse(ix, p1.y, p1.w, ih);
          if (idx === 452 && side === 1) drawTown(ix, p1.y, p1.w, ih);
        });
      }
      // ground strip (sea lane — always water, islands sit beside it)
      ctx.fillStyle = n % 2 ? '#1d4d6e' : '#1a4666';
      ctx.beginPath();
      ctx.moveTo(x1l, p1.y); ctx.lineTo(x1r, p1.y); ctx.lineTo(x2r, p2.y); ctx.lineTo(x2l, p2.y);
      ctx.closePath(); ctx.fill();
      if (s1.runway) {
        // runway: dark strip down the middle with centre dashes + threshold
        var rw = p1.w * 0.9;
        ctx.fillStyle = '#23262e';
        ctx.beginPath();
        ctx.moveTo(p1.x - rw, p1.y); ctx.lineTo(p1.x + rw, p1.y);
        ctx.lineTo(p2.x + p2.w * 0.9, p2.y); ctx.lineTo(p2.x - p2.w * 0.9, p2.y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#f5f0dc';
        if (n % 4 < 2) {
          var dw = p1.w * 0.12;
          ctx.fillRect(p1.x - dw, p1.y, dw * 2, Math.max(2, p2.y - p1.y));
        }
        // runway edge lights
        ctx.fillStyle = (Math.floor(G.elapsed * 2) % 2) ? '#7dff9e' : '#9dffb8';
        ctx.beginPath(); ctx.arc(p1.x - rw, p1.y, Math.max(1.5, p1.w * 0.09), 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(p1.x + rw, p1.y, Math.max(1.5, p1.w * 0.09), 0, 7); ctx.fill();
      }
    }
    // runway extras: PAPI lights + windsock (billboards near the runway)
    drawRunwayExtras(camY);
    // palms on near island segments
    palms.forEach(function (pl) {
      var rel = pl.seg - G.pos;
      if (rel < 2 || rel > 60) return;
      var z = rel * SEG;
      var s = segs[pl.seg % TOTAL];
      if (s.h <= 2) return;
      var p = project(z, s.h / 25, pl.side * 1.8, camY);
      var hgt = p.w * 1.3 * pl.s;
      if (hgt < 3 || hgt > 200) return;
      ctx.strokeStyle = '#2c1e12'; ctx.lineWidth = Math.max(1.5, hgt * 0.06);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(p.x + hgt * 0.12, p.y - hgt * 0.6, p.x + hgt * 0.2, p.y - hgt); ctx.stroke();
      ctx.fillStyle = '#2f6b2a';
      for (var f = 0; f < 5; f++) {
        var a = -0.4 - f * 0.55;
        ctx.beginPath();
        ctx.ellipse(p.x + hgt * 0.2 + Math.cos(a) * hgt * 0.3, p.y - hgt + Math.sin(a) * hgt * 0.18, hgt * 0.3, hgt * 0.08, a, 0, 7);
        ctx.fill();
      }
    });
    // rings far -> near
    for (var ri = RINGS.length - 1; ri >= 0; ri--) {
      var r = RINGS[ri];
      if (r.hit) {
        // just-passed ring flashes gold briefly
        if (r.flashT > 0) {
          var fz = (r.seg - G.pos) * SEG;
          if (fz > 6 && fz < DRAW * SEG) {
            var fp = project(fz, r.alt / 50, r.x, camY);
            var fr = fp.w * r.r;
            if (fr >= 2) {
              ctx.save();
              ctx.globalAlpha = clamp(r.flashT / 0.9, 0, 1);
              ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 30;
              ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = Math.max(3, fr * 0.12);
              ctx.beginPath(); ctx.arc(fp.x, fp.y, fr, 0, 7); ctx.stroke();
              ctx.restore();
            }
          }
        }
        continue;
      }
      var rz = (r.seg - G.pos) * SEG;
      if (rz < 6 || rz > DRAW * SEG) continue;
      var rp = project(rz, r.alt / 50, r.x, camY);
      var rr = rp.w * r.r;
      if (rr < 2) continue;
      var pulse = 0.75 + Math.sin(G.elapsed * 4 + ri) * 0.25;
      ctx.save();
      ctx.shadowColor = r.missed ? '#ff5544' : '#37f2ff';
      ctx.shadowBlur = 26 * pulse;
      ctx.strokeStyle = r.missed ? 'rgba(255,90,70,0.9)' : 'rgba(80,240,255,0.95)';
      ctx.lineWidth = Math.max(2, rr * 0.09);
      ctx.beginPath(); ctx.arc(rp.x, rp.y, rr, 0, 7); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(80,240,255,0.10)';
      ctx.beginPath(); ctx.arc(rp.x, rp.y, rr, 0, 7); ctx.fill();
      // chevrons inside the ring
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = 'bold ' + Math.max(10, rr * 0.42) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('' + (ri + 1), rp.x, rp.y + 1);
      ctx.restore();
    }
  }

  function drawPlane() {
    var px = W / 2 + G.roll * 26;
    var py = H * 0.66 + G.pitch * 22;
    var bank = G.roll * 0.42 + (mouse.active ? 0 : 0);
    // soft shadow on the sea below the aircraft
    ctx.fillStyle = 'rgba(10,20,50,0.22)';
    ctx.beginPath(); ctx.ellipse(px + 34, py + 118, 120, 16, 0, 0, 7); ctx.fill();
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(bank);
    ctx.scale((1 + Math.abs(G.roll) * 0.06) * 1.28, 1.28);
    // spinning prop at the nose: blur disc + blades + spinner
    ctx.fillStyle = 'rgba(225,235,255,0.20)';
    ctx.beginPath(); ctx.ellipse(0, -46, 54, 12, 0, 0, 7); ctx.fill();
    var pa = G.elapsed * 18;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-Math.cos(pa) * 50, -46 - Math.sin(pa) * 10);
    ctx.lineTo(Math.cos(pa) * 50, -46 + Math.sin(pa) * 10);
    ctx.moveTo(-Math.cos(pa + 1.57) * 50, -46 - Math.sin(pa + 1.57) * 10);
    ctx.lineTo(Math.cos(pa + 1.57) * 50, -46 + Math.sin(pa + 1.57) * 10);
    ctx.stroke();
    ctx.fillStyle = '#e2574c';
    ctx.beginPath(); ctx.arc(0, -52, 6, 0, 7); ctx.fill();
    // wings
    ctx.fillStyle = '#e8ecf4';
    ctx.beginPath(); ctx.moveTo(-14, -2); ctx.lineTo(-168, 26); ctx.lineTo(-168, 40); ctx.lineTo(-10, 16); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(14, -2); ctx.lineTo(168, 26); ctx.lineTo(168, 40); ctx.lineTo(10, 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#c33';
    ctx.fillRect(-174, 24, 14, 8); ctx.fillRect(160, 24, 14, 8);
    // wing stripes
    ctx.fillStyle = 'rgba(226,87,76,0.85)';
    ctx.fillRect(-128, 20, 8, 12); ctx.fillRect(120, 20, 8, 12);
    // fuselage
    var fg = ctx.createLinearGradient(0, -26, 0, 26);
    fg.addColorStop(0, '#f7f9ff'); fg.addColorStop(0.5, '#dfe6f2'); fg.addColorStop(1, '#9fb0c9');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(0, -52);
    ctx.quadraticCurveTo(20, -30, 17, 6);
    ctx.quadraticCurveTo(15, 30, 0, 44);
    ctx.quadraticCurveTo(-15, 30, -17, 6);
    ctx.quadraticCurveTo(-20, -30, 0, -52);
    ctx.fill();
    // stripe
    ctx.fillStyle = '#e2574c';
    ctx.beginPath(); ctx.moveTo(-16, -6); ctx.quadraticCurveTo(0, -2, 16, -6); ctx.lineTo(15, 2); ctx.quadraticCurveTo(0, 6, -15, 2); ctx.closePath(); ctx.fill();
    // fuselage panel lines
    ctx.strokeStyle = 'rgba(60,70,100,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-14, 12); ctx.lineTo(14, 12); ctx.moveTo(-13, 22); ctx.lineTo(13, 22); ctx.stroke();
    // cockpit windows, lit
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath(); ctx.ellipse(-7, -30, 6, 9, -0.25, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.ellipse(7, -30, 6, 9, 0.25, 0, 7); ctx.fill();
    // tail
    ctx.fillStyle = '#e2574c';
    ctx.beginPath(); ctx.moveTo(-12, 34); ctx.lineTo(-26, 62); ctx.lineTo(-6, 58); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(12, 34); ctx.lineTo(26, 62); ctx.lineTo(6, 58); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f7f9ff';
    ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(-9, 66); ctx.lineTo(9, 66); ctx.closePath(); ctx.fill();
    // nav lights
    var blink = Math.floor(G.elapsed * 2.4) % 2 === 0;
    ctx.fillStyle = blink ? '#ff4040' : '#881111';
    ctx.beginPath(); ctx.arc(-168, 33, 4, 0, 7); ctx.fill();
    ctx.fillStyle = blink ? '#39ff88' : '#0e5c2e';
    ctx.beginPath(); ctx.arc(168, 33, 4, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawMinimap() {
    var mx = W - 182, my = 74, mw = 168, mh = 110;
    ctx.fillStyle = 'rgba(8,14,34,0.62)';
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.strokeRect(mx + 0.5, my + 0.5, mw - 1, mh - 1);
    ctx.fillStyle = 'rgba(120,240,255,0.9)'; ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('MAP', mx + 8, my + 14);
    var px0 = mx + 10, px1 = mx + mw - 10, py = my + 58;
    function mapX(seg) { return px0 + (seg / TOTAL) * (px1 - px0); }
    // island dots along the chain
    ctx.fillStyle = 'rgba(120,200,110,0.85)';
    for (var s = 0; s < TOTAL; s += 12) {
      if (segs[s].h > 2) { ctx.beginPath(); ctx.arc(mapX(s), py + Math.sin(s * 0.11) * 12, 2.2, 0, 7); ctx.fill(); }
    }
    // runway
    ctx.fillStyle = '#7dff9e';
    ctx.fillRect(mapX(RW_START), py - 3, mapX(RW_END) - mapX(RW_START), 6);
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '9px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('RWY', mapX((RW_START + RW_END) / 2), py + 20);
    // rings: hit gold, next pulsing cyan, future dim
    RINGS.forEach(function (r, i) {
      var rx = mapX(r.seg), ry = py + Math.sin(r.seg * 0.11) * 12;
      if (r.hit) { ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(rx, ry, 2.6, 0, 7); ctx.fill(); }
      else if (i === G.ringsHit) {
        var pulse = 3.5 + Math.sin(G.elapsed * 5) * 1.2;
        ctx.strokeStyle = '#37f2ff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(rx, ry, pulse, 0, 7); ctx.stroke();
        ctx.fillStyle = '#37f2ff'; ctx.beginPath(); ctx.arc(rx, ry, 2.2, 0, 7); ctx.fill();
      } else { ctx.fillStyle = 'rgba(120,240,255,0.5)'; ctx.beginPath(); ctx.arc(rx, ry, 2, 0, 7); ctx.fill(); }
    });
    // plane marker
    var plx = mapX(G.pos), ply = py + Math.sin(G.pos * 0.11) * 12;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(plx + 6, ply); ctx.lineTo(plx - 4, ply - 4); ctx.lineTo(plx - 4, ply + 4); ctx.closePath(); ctx.fill();
  }

  function drawHUD() {
    ctx.textBaseline = 'alphabetic';
    // top bar
    ctx.fillStyle = 'rgba(8,14,34,0.55)';
    ctx.fillRect(0, 0, W, 64);
    ctx.fillStyle = 'rgba(120,240,255,0.9)';
    ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('ALT', 22, 22); ctx.fillText('SPD', 172, 22); ctx.fillText('HDG', 322, 22);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px "SF Mono", Consolas, monospace';
    ctx.fillText(pad3(Math.max(0, G.alt * 12)) + ' FT', 22, 52);
    ctx.fillText(fmt(G.speed) + ' KT', 172, 52);
    ctx.fillText(pad3(G.heading) + '°', 322, 52);
    // compass tape
    ctx.save();
    ctx.beginPath(); ctx.rect(455, 8, 370, 48); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.moveTo(470, 32); ctx.lineTo(810, 32); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
    var card = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (var k = -4; k <= 4; k++) {
      var hv = Math.round((G.heading + k * 15) / 15) * 15;
      var hx = 640 + k * 36 - ((G.heading % 15) / 15) * 36;
      var hvn = ((hv % 360) + 360) % 360;
      var label = hvn % 45 === 0 ? card[(hvn / 45) % 8] : String(hvn);
      ctx.fillText(label, hx, 50);
      ctx.fillRect(hx, 14, 1, hvn % 45 === 0 ? 12 : 6);
    }
    ctx.restore();
    ctx.fillStyle = '#ff5a4e';
    ctx.beginPath(); ctx.moveTo(640, 8); ctx.lineTo(634, 20); ctx.lineTo(646, 20); ctx.closePath(); ctx.fill();
    // score / rings / timer right
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(120,240,255,0.9)'; ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('SCORE', W - 22, 22); ctx.fillText('RINGS  ' + G.ringsHit + ' / 12', W - 150, 22);
    ctx.fillStyle = G.timeLeft < 30 ? '#ff6a5e' : '#fff';
    ctx.font = 'bold 26px "SF Mono", Consolas, monospace';
    ctx.fillText(fmt(G.score), W - 22, 52);
    ctx.font = 'bold 20px "SF Mono", Consolas, monospace';
    ctx.fillText(fmt(Math.max(0, G.timeLeft)) + 's', W - 150, 50);
    // mission header (left, under the top bar)
    var nextRing = G.ringsHit >= 12 ? 12 : G.ringsHit + 1;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffd27a'; ctx.font = 'bold 21px system-ui, sans-serif';
    ctx.fillText('ISLAND HOPPER', 22, 100);
    var hw = ctx.measureText('ISLAND HOPPER').width;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 27px system-ui, sans-serif';
    ctx.fillText(G.ringsHit >= 12 ? '— MISSION COMPLETE' : '— RING ' + nextRing + ' / 12', 22 + hw + 12, 100);
    ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.font = '14px system-ui, sans-serif';
    ctx.fillText('SCORE ' + G.score.toLocaleString('en-US') + '   ·   WIND ' + G.windKt + ' KT ' + G.windDir + '   ·   GEAR ' + G.gear + '   ·   FLAPS ' + G.flaps + '   ·   THR ' + fmt(G.throttle * 100) + '%   ·   FUEL ' + fmt(G.fuel) + '%', 22, 122);
    // minimap (top-right, under the top bar)
    drawMinimap();
    // six-gauge strip along the bottom
    var stripY = H - 86, stripH = 80;
    ctx.fillStyle = 'rgba(8,14,34,0.62)';
    ctx.fillRect(W / 2 - 312, stripY, 624, stripH);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
    ctx.strokeRect(W / 2 - 311.5, stripY + 0.5, 623, stripH - 1);
    var gauges = [
      { label: 'ALT', frac: clamp(G.alt / 420, 0, 1), value: fmt(Math.max(0, G.alt * 12)), color: '#ffc46b', mode: 'std' },
      { label: 'SPD', frac: clamp(G.speed / 300, 0, 1), value: fmt(G.speed), color: '#37f2ff', mode: 'std' },
      { label: 'HDG', frac: G.heading / 360, value: pad3(G.heading), color: '#aef4ff', mode: 'hdg' },
      { label: 'VSI', frac: clamp(G.vsi / 2000, -1, 1), value: (G.vsi >= 0 ? '+' : '') + fmt(G.vsi), color: '#7dff9e', mode: 'vsi' },
      { label: 'THR', frac: G.throttle, value: fmt(G.throttle * 100) + '%', color: '#7dff9e', mode: 'std' },
      { label: 'FUEL', frac: clamp(G.fuel / 100, 0, 1), value: fmt(G.fuel) + '%', color: G.fuel < 25 ? '#ff5a4e' : '#ffb347', mode: 'std' },
    ];
    gauges.forEach(function (g, i) {
      var gx = W / 2 - 260 + i * 104, gy = H - 44, gr = 23;
      ctx.fillStyle = 'rgba(120,240,255,0.9)'; ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(g.label, gx, gy - gr - 6);
      ctx.fillStyle = 'rgba(4,8,22,0.72)';
      ctx.beginPath(); ctx.arc(gx, gy, gr, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(gx, gy, gr, 0, 7); ctx.stroke();
      var tickAngles = [];
      if (g.mode === 'hdg') tickAngles = [-90, 0, 90, 180];
      else if (g.mode === 'vsi') tickAngles = [-210, -150, -90, -30, 30];
      else for (var t = 0; t <= 8; t++) tickAngles.push(135 + t * 33.75);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      tickAngles.forEach(function (deg) {
        var ta = deg * Math.PI / 180;
        ctx.beginPath();
        ctx.moveTo(gx + Math.cos(ta) * (gr - 4), gy + Math.sin(ta) * (gr - 4));
        ctx.lineTo(gx + Math.cos(ta) * (gr - 1), gy + Math.sin(ta) * (gr - 1));
        ctx.stroke();
      });
      var na;
      if (g.mode === 'hdg') na = (G.heading - 90) * Math.PI / 180;
      else if (g.mode === 'vsi') na = (-90 + g.frac * 120) * Math.PI / 180;
      else na = (135 + g.frac * 270) * Math.PI / 180;
      ctx.strokeStyle = g.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + Math.cos(na) * (gr - 6), gy + Math.sin(na) * (gr - 6)); ctx.stroke();
      ctx.fillStyle = g.color; ctx.beginPath(); ctx.arc(gx, gy, 2.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px "SF Mono", Consolas, monospace';
      ctx.fillText(g.value, gx, gy + 13);
    });
    // artificial horizon mini-gauge (bottom centre-left)
    var gx = 150, gy = H - 96, gr = 42;
    ctx.save(); ctx.beginPath(); ctx.arc(gx, gy, gr, 0, 7); ctx.clip();
    ctx.translate(gx, gy); ctx.rotate(-G.roll * 0.5); ctx.translate(0, G.pitch * 22);
    ctx.fillStyle = '#3a6ea8'; ctx.fillRect(-gr, -gr, gr * 2, gr);
    ctx.fillStyle = '#c97b3d'; ctx.fillRect(-gr, 0, gr * 2, gr);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(gx, gy, gr, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx - 18, gy); ctx.lineTo(gx + 18, gy); ctx.stroke();
    // centre reticle
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(W / 2, H * 0.42, 14, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2 - 22, H * 0.42); ctx.lineTo(W / 2 - 14, H * 0.42); ctx.moveTo(W / 2 + 14, H * 0.42); ctx.lineTo(W / 2 + 22, H * 0.42); ctx.stroke();
    // low altitude warning
    if (G.screen === 'play' && G.alt < 30) {
      var fl = Math.floor(G.elapsed * 3) % 2 === 0;
      if (fl) {
        ctx.fillStyle = '#ff3b30'; ctx.font = 'bold 26px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('⚠ PULL UP — TERRAIN ⚠', W / 2, 168);
      }
    }
    // message banner
    if (G.msgT > 0) {
      G.msgT -= 1 / 60;
      ctx.fillStyle = 'rgba(8,14,34,0.6)';
      var mw = ctx.measureText(G.msg).width + 36;
      ctx.fillRect(W / 2 - mw / 2, 132, mw, 34);
      ctx.fillStyle = '#aef4ff'; ctx.font = 'bold 16px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(G.msg, W / 2, 155);
    }
    // floating score popups
    popups.forEach(function (p) {
      var a = clamp(p.t / p.max, 0, 1);
      var py = p.y - (p.max - p.t) * 34;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffd24a';
      ctx.font = 'bold 30px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(p.text, p.x, py);
      ctx.restore();
    });
    // controls hint
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('← → bank   ↑ ↓ climb / descend   SHIFT throttle up   CTRL throttle down   M sound   P pause   R restart', W / 2, H - 94);
  }

  function overlayPanel(title, lines, accent) {
    ctx.fillStyle = 'rgba(6,10,28,0.72)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,18,44,0.92)';
    var bw = 640, bh = 300 + lines.length * 30;
    ctx.fillRect(W / 2 - bw / 2, H / 2 - bh / 2, bw, bh);
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.strokeRect(W / 2 - bw / 2, H / 2 - bh / 2, bw, bh);
    ctx.textAlign = 'center';
    ctx.fillStyle = accent; ctx.font = 'bold 44px system-ui, sans-serif';
    ctx.fillText(title, W / 2, H / 2 - bh / 2 + 74);
    ctx.fillStyle = '#fff'; ctx.font = '20px system-ui, sans-serif';
    lines.forEach(function (ln, i) { ctx.fillText(ln, W / 2, H / 2 - bh / 2 + 128 + i * 32); });
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('Press ENTER to fly again  ·  R to restart', W / 2, H / 2 + bh / 2 - 26);
  }

  function drawTitle() {
    // scenic backdrop: slow drift over the islands
    G.elapsed += 1 / 60;
    G.pos += 0.12; G.alt = 90 + Math.sin(G.elapsed * 0.3) * 8; G.roll = Math.sin(G.elapsed * 0.4) * 0.12;
    drawSky(); drawWorld(); drawPlane();
    ctx.fillStyle = 'rgba(6,10,28,0.45)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd27a'; ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText('A SUNSET CIRCUIT OVER THE ISLANDS', W / 2, 132);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.fillText('SKYLINE RUNNER', W / 2, 212);
    ctx.fillStyle = '#aef4ff'; ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillText('— ISLAND HOPPER —', W / 2, 252);
    ctx.fillStyle = '#fff'; ctx.font = '19px system-ui, sans-serif';
    ctx.fillText('Thread 12 glowing rings over the island chain, then land on the runway before sunset.', W / 2, 306);
    ctx.fillText('Bank with ← → or the mouse, climb and dive with ↑ ↓, throttle with SHIFT / CTRL.', W / 2, 336);
    ctx.fillStyle = '#37f2ff'; ctx.font = 'bold 22px system-ui, sans-serif';
    var blink = Math.floor(G.elapsed * 1.6) % 2 === 0;
    if (blink) ctx.fillText('PRESS ENTER OR CLICK TO TAKE OFF', W / 2, 392);
    ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '15px system-ui, sans-serif';
    ctx.fillText('Best run wins the circuit · rings 250 pts · combo bonus · landing bonus 1000 + time', W / 2, 660);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    if (G.screen === 'title') { drawTitle(); return; }
    drawSky(); drawWorld(); drawPlane(); drawHUD();
    if (G.screen === 'crash') {
      overlayPanel('CRASHED', [G.crashWhy || '', 'Score ' + G.score + '  ·  Rings ' + G.ringsHit + ' / 12'], '#ff5a4e');
    } else if (G.screen === 'win') {
      overlayPanel('TOUCHDOWN!', ['You landed the Island Hopper circuit.', 'Landing bonus +' + (G.landBonus || 0), 'Final score ' + G.score + '  ·  Rings 12 / 12'], '#7dff9e');
    } else if (G.screen === 'pause') {
      overlayPanel('PAUSED', ['Take a breath, pilot.'], '#aef4ff');
    }
  }

  // ---------- input ----------
  window.addEventListener('keydown', function (e) {
    keys[e.code] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
    if (e.code === 'Enter' || e.code === 'Space') {
      if (G.screen === 'title' || G.screen === 'crash' || G.screen === 'win') startGame();
      else if (G.screen === 'pause') G.screen = 'play';
    }
    if (e.code === 'KeyR') startGame();
    if (e.code === 'KeyP') { if (G.screen === 'play') G.screen = 'pause'; else if (G.screen === 'pause') G.screen = 'play'; }
    if (e.code === 'KeyM') { G.muted = audio().toggleMute(); }
  });
  window.addEventListener('keyup', function (e) { keys[e.code] = false; });
  cv.addEventListener('mousemove', function (e) {
    var r = cv.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (W / r.width);
    mouse.y = (e.clientY - r.top) * (H / r.height);
    mouse.active = true;
  });
  cv.addEventListener('mousedown', function () {
    audio().unlock();
    if (G.screen === 'title' || G.screen === 'crash' || G.screen === 'win') startGame();
  });
  document.addEventListener('visibilitychange', function () { if (document.hidden && G.screen === 'play') G.screen = 'pause'; });

  // ---------- shots (deterministic staged scenes for screenshots) ----------
  window.SkyShots = {
    stage: function (name) {
      // called by shots.js after load when ?shot= is present
      G.started = true;
      window.__shotMode = true; // freeze the sim: the staged frame is the shot
      if (name === 'start') { G.screen = 'title'; G.elapsed = 6; G.pos = 180; return; }
      startGame();
      if (name === 'cover') {
        // final-ring close pass: ring 12 huge ahead, runway + PAPI behind it
        G.pos = 603; G.alt = 45; G.x = 0; G.roll = 0.06; G.pitch = 0.02;
        G.throttle = 0.78; G.speed = 212; G.ringsHit = 11; G.combo = 3; G.score = 4850;
        G.timeLeft = 58; G.elapsed = 142; G.fuel = 82; G.vsi = 120;
        RINGS.forEach(function (r, i) { if (i < 11) r.hit = true; });
        popups.push({ x: 830, y: 400, text: '+300', t: 1.0, max: 1.4 });
        showMsg('FINAL RING — THREAD IT AND LAND', 99);
      } else if (name === 'play') {
        // mid-circuit sunset: coastal town lit on the right, snowy ridges
        G.pos = 444; G.alt = 62; G.x = -0.3; G.roll = -0.28; G.pitch = -0.06;
        G.throttle = 0.8; G.speed = 235; G.ringsHit = 9; G.combo = 3; G.score = 2650;
        G.timeLeft = 96; G.elapsed = 84; G.fuel = 74; G.vsi = 180;
        RINGS.forEach(function (r, i) { if (i < 9) r.hit = true; });
        showMsg('RING 10 / 12  +300  COMBO x3', 99);
      } else if (name === 'ring') {
        // low pass on the coast: ring 5 close, lighthouse island on the left
        G.pos = 306; G.alt = 55; G.x = -0.55; G.roll = 0.3; G.pitch = 0.04;
        G.throttle = 0.72; G.speed = 218; G.ringsHit = 4; G.combo = 2; G.score = 1150;
        G.timeLeft = 131; G.elapsed = 52; G.fuel = 88; G.vsi = -150;
        RINGS.forEach(function (r, i) { if (i < 4) r.hit = true; });
        popups.push({ x: 745, y: 385, text: '+300', t: 0.8, max: 1.4 });
        showMsg('RING 5 / 12  +300  COMBO x2', 99);
      } else if (name === 'end') {
        G.screen = 'win'; G.score = 5420; G.ringsHit = 12; G.landBonus = 1480;
        G.pos = 600; G.alt = 10; G.throttle = 0.2; G.speed = 118; G.timeLeft = 58;
        G.fuel = 61; G.vsi = -220; G.elapsed = 150;
        RINGS.forEach(function (r) { r.hit = true; });
        G.msg = ''; G.msgT = 0;
      }
      render();
    },
  };

  // ---------- main loop ----------
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!window.__shotMode && (G.screen === 'play' || G.screen === 'title')) update(dt);
    render();
    requestAnimationFrame(frame);
  }
  // staged screenshot mode: render the staged scene at once, then keep animating
  var params = new URLSearchParams(location.search);
  var shot = params.get('shot');
  if (shot && window.SkyShots) {
    // shots.js stages after its own load; fall back to staging here
    setTimeout(function () {
      if (window.__shotStaged) return;
      window.SkyShots.stage(shot);
    }, 60);
  }
  requestAnimationFrame(frame);
})();
