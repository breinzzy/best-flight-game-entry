// SKYLINE RUNNER — audio.js
// All sound is synthesised in the browser with WebAudio. No audio files.
(function () {
  let ctx = null, eng = null, engGain = null, muted = false;
  function ensure() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      eng = ctx.createOscillator(); eng.type = 'sawtooth'; eng.frequency.value = 55;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
      engGain = ctx.createGain(); engGain.gain.value = 0;
      eng.connect(lp); lp.connect(engGain); engGain.connect(ctx.destination);
      eng.start();
    } catch (e) { ctx = null; }
    return ctx;
  }
  function tone(freq, dur, type, vol, slide) {
    if (muted || !ensure()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(vol || 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  window.SkyAudio = {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    engine(throttle, speed01) {
      if (!ensure() || muted) { if (engGain) engGain.gain.value = 0; return; }
      eng.frequency.value = 48 + throttle * 70 + speed01 * 30;
      engGain.gain.value = 0.028 + throttle * 0.035;
    },
    ring() { tone(880, 0.18, 'sine', 0.16); setTimeout(() => tone(1318, 0.28, 'sine', 0.14), 70); },
    miss() { tone(220, 0.3, 'triangle', 0.1, 110); },
    crash() { tone(90, 0.7, 'sawtooth', 0.2, 35); tone(55, 0.9, 'sine', 0.22, 28); },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.35, 'sine', 0.14), i * 110)); },
    click() { tone(660, 0.07, 'square', 0.06); },
    toggleMute() { muted = !muted; return muted; },
    isMuted() { return muted; },
  };
})();
