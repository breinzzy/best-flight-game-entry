// SKYLINE RUNNER — shots.js
// One job: the screenshot scenes behind ?shot=start|play|ring|end. Each scene
// sets the real game state directly — a real mid-flight moment, a real ring
// pass, a real landing panel — so every screenshot is a true render of the
// game's own code, and the same seed always gives the same frame.
(function () {
  function stage() {
    var q = new URLSearchParams(location.search);
    var shot = q.get('shot');
    if (!shot) return;
    if (window.SkyShots) {
      window.SkyShots.stage(shot);
      window.__shotStaged = true;
    }
  }
  if (document.readyState === 'complete') stage();
  else window.addEventListener('load', stage);
  // main.js also stages on a short timer as a fallback; this runs first.
})();
