// render3d.js — Three.js r160 renderer for Skyline Runner v7.
// Replaces the v6 raw-WebGL2 renderer. Gameplay lives in main.js and is
// untouched: this module only draws what main.js describes through the
// shared RG object (live objects by reference, primitives synced per frame).
// Three.js is vendored locally in game/vendor/ (MIT, see THREE-LICENSE).
// Static files only — no network requests, no external fonts.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const SUN_DIR = new THREE.Vector3(-0.68, 0.16, -0.5).normalize(); // v6 L: low NW sun
const FOG_COLOR = 0xf5995c;      // v6 FOG [.96,.60,.36]
const FOG_DENSITY = 0.00012;     // v6 uFogD 1/8000
const FAR = 40000;               // v6 persp far
const V3 = a => new THREE.Vector3(a[0], a[1], a[2]);

// v6's Park-Miller PRNG (seed 7) — replays the exact tree/building/cloud
// placement of v6 so the v7 screenshots compare apples-to-apples.
function mkRnd(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

// ---------- procedural canvas textures (no image files) ----------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4; return t;
}
// Soft radial puff (clouds, smoke, explosion sprites).
function softTex() {
  return canvasTex(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(.55, 'rgba(255,255,255,.45)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  });
}
// Puffy cloud billboard: several overlapping soft blobs.
function cloudTex() {
  const rnd = mkRnd(99);
  return canvasTex(256, 256, (g) => {
    for (let i = 0; i < 9; i++) {
      const x = 48 + rnd() * 160, y = 90 + rnd() * 70, r = 34 + rnd() * 46;
      const gr = g.createRadialGradient(x, y, 2, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,.85)'); gr.addColorStop(.7, 'rgba(255,255,255,.38)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  });
}
// Tileable water normal map from integer-frequency sines (tiles over 256 px).
function waterNormalTex() {
  // Tileable value-noise (fbm) heightfield: irregular chop, no regular
  // stripes. Grid values wrap at the tile edge so the texture tiles.
  const S = 256, data = new Uint8Array(S * S * 4);
  function hash(ix, iy) {
    ix = ((ix % 64) + 64) % 64; iy = ((iy % 64) + 64) % 64;
    const v = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }
  function vnoise(x, y, cells) {
    const fx = x * cells, fy = y * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  function H(x, y) {
    // 3 octaves, coarse -> fine; wraps because vnoise wraps at 64 cells
    return vnoise(x / S, y / S, 4) * .55 + vnoise(x / S, y / S, 9) * .3 + vnoise(x / S, y / S, 21) * .15;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (H((x + 1) % S, y) - H((x - 1 + S) % S, y)) * 2.2;
    const dy = (H(x, (y + 1) % S) - H(x, (y - 1 + S) % S)) * 2.2;
    const inv = 1 / Math.hypot(dx, dy, 1), k = (y * S + x) * 4;
    data[k] = (-dx * inv * .5 + .5) * 255; data[k + 1] = (-dy * inv * .5 + .5) * 255;
    data[k + 2] = (inv * .5 + .5) * 255; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
}
// Runway 36/18 asphalt: speckles, edge lines, centreline dashes, threshold
// bars, touchdown-zone bars, numbers. Canvas top = north ("18" end),
// canvas bottom = south ("36" end); texture is 1:8, runway is 1:20, so the
// digits are drawn 2.6x wider to read square on the ground.
function runwayTex() {
  const rnd = mkRnd(4242);
  return canvasTex(256, 2048, (g, W, H) => {
    g.fillStyle = '#2b2b30'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 5200; i++) {
      const v = 30 + rnd() * 40 | 0;
      g.fillStyle = `rgba(${v},${v},${v + 4},${.05 + rnd() * .09})`;
      g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    g.fillStyle = '#f2f2ec';
    g.fillRect(5, 0, 3, H); g.fillRect(W - 8, 0, 3, H);           // edge lines
    for (let y = 60; y < H - 60; y += 90) g.fillRect(W / 2 - 4, y, 8, 42); // centreline
    for (const y0 of [28, H - 88]) for (let i = 0; i < 8; i++)      // threshold bars
      g.fillRect(14 + i * 29, y0, 15, 60);
    for (const y0 of [190, H - 250]) for (const sx of [-13, 10])    // touchdown zone
      for (let i = 0; i < 3; i++) g.fillRect(W / 2 + sx - 3, y0 + i * 60, 6, 20);
    const num = (txt, x, y, rot) => {
      g.save(); g.translate(x, y); g.rotate(rot); g.scale(2.6, 1);
      g.font = '700 26px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#f2f2ec'; g.fillText(txt, 0, 0); g.restore();
    };
    num('18', W / 2, 150, Math.PI);   // north end, reads from the north approach
    num('36', W / 2, H - 150, 0);     // south end, reads from the south approach
  });
}
// "SR-26" registration decal (transparent background, dark text).
function regTex() {
  return canvasTex(256, 64, (g, W, H) => {
    g.font = '700 44px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#16242e'; g.fillText('SR-26', W / 2, H / 2 + 2);
  });
}

// Warm grade + vignette, mirroring v6's fin() (ACEsque curve + 1.03/1.0/.95
// warm tint + vignette). Runs after OutputPass on the LDR sRGB image.
const GradeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c=texture2D(tDiffuse,vUv);
      c.rgb*=vec3(1.03,1.0,0.96);
      vec2 q=vUv-0.5; c.rgb*=1.0-0.32*pow(clamp(length(q)*1.35,0.0,1.0),2.4);
      gl_FragColor=c; }`
};

// ---------- renderer state ----------
const R = {};
let RGref = null;

export function initRenderer(RG) {
  RGref = RG;
  const glc = document.getElementById('gl');
  const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;                 // v6 fin() *1.08
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;                     // we read totals per frame
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  R.renderer = renderer;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);
  R.scene = scene;

  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 1.5, FAR);
  R.camera = camera;

  // Low warm sun + hemisphere fill (v6's shader lighting, as real lights).
  const sun = new THREE.DirectionalLight(0xffc07a, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -160, right: 160, top: 160, bottom: -160, near: 10, far: 2500 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 1.2;
  scene.add(sun, sun.target);
  R.sun = sun;
  scene.add(new THREE.HemisphereLight(0x93a7cc, 0x6b543c, 0.45));

  // Preetham sunset sky + PMREM environment for reflections.
  const sky = new Sky(); sky.scale.setScalar(20000);
  Object.assign(sky.material.uniforms, {});
  sky.material.uniforms.turbidity.value = 8;
  sky.material.uniforms.rayleigh.value = 2.5;
  sky.material.uniforms.mieCoefficient.value = 0.008;
  sky.material.uniforms.mieDirectionalG.value = 0.85;
  sky.material.uniforms.sunPosition.value.copy(SUN_DIR);
  scene.add(sky); R.sky = sky;
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene(); envScene.add(sky.clone());
    scene.environment = pmrem.fromScene(envScene).texture;
    pmrem.dispose();
  }

  buildTerrain(RG);
  buildWater();
  buildGlowSprites();
  R.rnd = mkRnd(7); // v6's seed: trees, buildings, then clouds consume it in order
  buildTrees(RG);
  buildBuildings(RG);
  buildClouds(RG);
  buildRunway(RG);
  buildRings(RG);
  buildPlane(RG);
  buildSmokePools();

  // Post: Render -> ACES Output -> warm grade + vignette.
  // NOTE: UnrealBloomPass is NOT in the chain — the vendored r160 pass blacks
  // the whole frame in headless SwiftShader (proven: passes=ro works, rbo and
  // rbo256 both black, rog works). Glow is done with additive sprites instead
  // (v6's approach): sun halo + current-ring halo. ?passes=rbo still exists
  // for re-testing the bloom on a real GPU.
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  composer.setSize(innerWidth, innerHeight);
  const chain = new URLSearchParams(location.search).get('passes') || 'full';
  composer.addPass(new RenderPass(scene, camera));
  if (chain === 'rbo') composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 0.85));
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GradeShader));
  R.composer = composer;

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  R.lastNow = performance.now(); R.fpsEMA = 0; R.uTime = { value: 0 };
  window.__r3d = R; // debug hook: renderer/scene/camera for headless probes
}

function buildGlowSprites() {
  const tex = softTex();
  // Sun halo (v6's additive halo ball, as a billboard): warm glow around the
  // low sun. Positioned per frame at eye + SUN_DIR * 15000.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0xff9e46, opacity: 0.32
  }));
  halo.scale.set(4200, 4200, 1);
  R.scene.add(halo); R.sunHalo = halo;
  // Current-ring halo: soft cyan glow marking the ring to fly through.
  const ring = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, color: 0x33ffee, opacity: 0.4
  }));
  ring.scale.set(150, 150, 1);
  R.scene.add(ring); R.ringGlow = ring;
}

function buildTerrain(RG) {
  const { N, SZ, CS, HG } = RG, NV = N + 1;
  const geo = new THREE.PlaneGeometry(SZ, SZ, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = HG[i];                                   // vertex (ix,iy) == HG[iy*NV+ix]
    pos.setY(i, h);
    const c = RG.tcol(x, z, h, RG.slopeAt(x, z));
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.envMapIntensity = 0.35;
  // v6's fragment detail, as onBeforeCompile: per-pixel hash noise + animated beach foam.
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = R.uTime;
    sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = ('varying vec3 vWP;\nuniform float uTime;\nfloat hash13(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }\n') +
      sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        { float nz = hash13(floor(vWP.xz/3.0))*0.08 + hash13(floor(vWP.xz/23.0))*0.07 - 0.075;
          diffuseColor.rgb *= 1.0 + nz;
          float fb = smoothstep(2.2,0.2,vWP.y)*smoothstep(-0.4,0.3,vWP.y);
          float fw = 0.6+0.4*sin(vWP.x*0.09+vWP.z*0.07+uTime*1.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0,0.95,0.9), fb*fw*0.85); }`);
  };
  const terrain = new THREE.Mesh(geo, mat);
  terrain.receiveShadow = true; terrain.castShadow = true;
  R.scene.add(terrain);
}

function buildWater() {
  const water = new Water(new THREE.PlaneGeometry(40000, 40000), {
    textureWidth: 512, textureHeight: 512,
    waterNormals: waterNormalTex(),
    sunDirection: SUN_DIR.clone(),
    sunColor: 0xffe0b0, waterColor: 0x0e3238,
    distortionScale: 2.2, fog: true
  });
  water.rotation.x = -Math.PI / 2;
  water.material.fog = true;
  R.scene.add(water); R.water = water;
}

function buildClouds(RG) {
  // Same seeded replay as v6's puffs (trees/buildings consumed the PRNG first).
  const rnd = R.rnd;
  const tex = cloudTex();
  const warm = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xfff3e2, opacity: 0.8 });
  const cool = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xdcd6ea, opacity: 0.75 });
  const sunXZ = new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize();
  for (let i = 0; i < 70; i++) {
    const x = (rnd() - .5) * 14000, z = (rnd() - .5) * 14000, y = 900 + rnd() * 700, n = 4 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      const sz = 120 + rnd() * 150;
      const px = x + (rnd() - .5) * 420, py = y + (rnd() - .3) * 60, pz = z + (rnd() - .5) * 420;
      const a = .55 + rnd() * .35;
      const sunward = new THREE.Vector2(px, pz).normalize().dot(sunXZ);
      const sp = new THREE.Sprite(sunward > 0.1 ? warm : cool);
      sp.position.set(px, py, pz);
      sp.scale.set(sz * 1.5, sz * .75, 1);
      sp.material = (sunward > 0.1 ? warm : cool).clone();
      sp.material.opacity = a;
      R.scene.add(sp);
    }
  }
}

function buildTrees(RG) {
  // v6's tree loop, replayed verbatim (same seed, same calls, same layout).
  const rnd = R.rnd, SZ = RG.SZ;
  const trunks = [], cones1 = [], cones2 = [], cols1 = [], cols2 = [];
  let n = 0;
  for (let t = 0; t < 9000 && n < 2600; t++) {
    const x = (rnd() - .5) * SZ * .92, z = (rnd() - .5) * SZ * .92, h = RG.groundAt(x, z);
    if (h < 8 || h > 540) continue;
    if (Math.abs(x) < 260 && Math.abs(z) < 900) continue;
    if (RG.slopeAt(x, z) > .32) continue;
    const g = RG.fbm(x / 700 + 90, z / 700 + 90, 3);
    if (g < .48 && rnd() < .85) continue;
    const s = .7 + rnd() * .7, dk = rnd() * .08;
    trunks.push([x, h + 1.5, z, 1.4 * s, 4 * s, 1.4 * s]);
    cones1.push([x, h + 11 * s, z, 6 * s, 18 * s, 6 * s]);
    cols1.push([.11 + dk, .30 + dk * 1.6, .12 + dk]);
    if (rnd() < .5) { cones2.push([x, h + 15.5 * s, z, 4.5 * s, 13 * s, 4.5 * s]); cols2.push([.14 + dk, .36 + dk, .14]); }
    n++;
  }
  const mkInst = (geo, list, cols, color) => {
    if (!list.length) return null;
    const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    mat.envMapIntensity = 0.3;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), cc = new THREE.Color();
    list.forEach((e, i) => {
      pv.set(e[0], e[1], e[2]); sc.set(e[3], e[4], e[5]);
      m4.compose(pv, q, sc); im.setMatrixAt(i, m4);
      if (cols) im.setColorAt(i, cc.setRGB(cols[i][0], cols[i][1], cols[i][2]));
      else im.setColorAt(i, cc.setRGB(color[0], color[1], color[2]));
    });
    im.castShadow = true; im.receiveShadow = true;
    R.scene.add(im); return im;
  };
  mkInst(new THREE.BoxGeometry(1, 1, 1), trunks, null, [.32, .22, .13]);
  mkInst(new THREE.ConeGeometry(1, 1, 8), cones1, cols1);
  mkInst(new THREE.ConeGeometry(1, 1, 8), cones2, cols2);
  R.treeCount = n;
}

function buildBuildings(RG) {
  const rnd = R.rnd, y = RG.RWY.y;
  const mat = (c, r = .85) => { const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0], c[1], c[2]), roughness: r, metalness: 0 }); m.envMapIntensity = 0.3; return m; };
  const box = (x, yy, z, sx, sy, sz, c, r) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(c, r));
    m.position.set(x, yy, z); m.castShadow = true; m.receiveShadow = true;
    R.scene.add(m); return m;
  };
  // Hangars + tower + apron (v6's fixed buildings).
  box(-110, y + 9, 260, 46, 18, 56, [.55, .58, .62]); box(-110, y + 18.6, 260, 48, 1.4, 58, [.30, .42, .55]);
  box(-86.8, y + 7, 260, .6, 13, 40, [.2, .22, .25]);
  box(-110, y + 9, 170, 40, 18, 50, [.62, .60, .56]); box(-110, y + 18.6, 170, 42, 1.4, 52, [.62, .22, .18]);
  box(-95, y + 16, 40, 9, 32, 9, [.85, .85, .82]); box(-95, y + 34, 40, 13, 5, 13, [.2, .35, .45]); box(-95, y + 37, 40, 14, 1, 14, [.3, .3, .32]);
  box(-80, y + .2, 215, 70, .4, 150, [.32, .32, .34]);
  // Village: 70 houses (v6's loop, replayed) as two InstancedMeshes.
  const bodies = [], roofs = [];
  for (let i = 0; i < 70; i++) {
    const cx = 700 + rnd() * 900, cz = 200 + rnd() * 900, h = RG.groundAt(cx, cz);
    if (h < 4 || RG.slopeAt(cx, cz) > .2) continue;
    const w = 8 + rnd() * 8, d = 8 + rnd() * 10, hh = 5 + rnd() * 5;
    bodies.push([cx, h + hh / 2, cz, w, hh, d]);
    roofs.push([cx, h + hh + 1.6, cz, w + 1, 3.2, d + .8]);
  }
  const mkInst = (geo, list, color) => {
    const m = new THREE.MeshStandardMaterial({ roughness: .9, metalness: 0 }); m.envMapIntensity = 0.3;
    const im = new THREE.InstancedMesh(geo, m, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), cc = new THREE.Color();
    list.forEach((e, i) => { pv.set(e[0], e[1], e[2]); sc.set(e[3], e[4], e[5]); m4.compose(pv, q, sc); im.setMatrixAt(i, m4); im.setColorAt(i, cc.setRGB(color[0], color[1], color[2])); });
    im.castShadow = true; im.receiveShadow = true; R.scene.add(im);
  };
  mkInst(new THREE.BoxGeometry(1, 1, 1), bodies, [.9, .88, .82]);
  mkInst(new THREE.BoxGeometry(1, 1, 1), roofs, [.68, .24, .17]);
  R.houseCount = bodies.length;
}

function buildRunway(RG) {
  const y = RG.RWY.y, W = RG.RWY.hw, L = RG.RWY.hl;
  // Apron slab under the runway (v6's darker under-quad).
  const apron = new THREE.Mesh(new THREE.PlaneGeometry((W + 6) * 2, (L + 40) * 2),
    new THREE.MeshStandardMaterial({ color: 0x4d4d47, roughness: .95 }));
  apron.rotation.x = -Math.PI / 2; apron.position.set(0, y + .07, 0); apron.receiveShadow = true;
  R.scene.add(apron);
  // Runway with the painted asphalt texture.
  const tex = runwayTex();
  const rwy = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, L * 2),
    new THREE.MeshStandardMaterial({ map: tex, roughness: .6, metalness: .1 }));
  rwy.material.envMapIntensity = 0.5; // faint wet-tarmac sheen (v6's reflective 2nd pass)
  rwy.rotation.x = -Math.PI / 2; rwy.position.set(0, y + .12, 0); rwy.receiveShadow = true;
  R.scene.add(rwy);

  // Lights: edge (warm white), threshold (green south / red north),
  // approach (10 rows x 5, terrain-following), PAPI (4, dynamic — see renderFrame).
  const glow = (r, g, b, k = 2.2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r * k, g * k, b * k) });
  const edge = [], thrS = [], thrN = [], appr = [];
  for (let z = -L; z <= L; z += 50) { edge.push([-W - 2, y + .5, z]); edge.push([W + 2, y + .5, z]); }
  for (let x = -W; x <= W; x += 5) { thrS.push([x, y + .5, L + 2]); thrN.push([x, y + .5, -L - 2]); }
  for (let i = 1; i <= 10; i++) for (let x = -8; x <= 8; x += 4)
    appr.push([x, RG.groundAt(0, L + i * 30) + 1.5, L + i * 30]);
  const mkLights = (list, material) => {
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(.35, 8, 6), material, list.length);
    const m4 = new THREE.Matrix4();
    list.forEach((p, i) => { m4.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i, m4); });
    R.scene.add(im); return im;
  };
  mkLights(edge, glow(1, 1, .85));
  mkLights(thrS, glow(.2, 1, .3));
  mkLights(thrN, glow(1, .2, .15));
  mkLights(appr, glow(1, .95, .7));
  // PAPI: 4 units west of the runway, 300 m north of the south threshold.
  R.papi = [];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: .6, metalness: .4 }));
    housing.castShadow = true;
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(1.6, .8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    lens.position.set(0, 0, .61);
    g.add(housing, lens);
    g.position.set(-W - 18 - i * 9, y + .6, L - 300);
    R.scene.add(g);
    R.papi.push(lens.material);
  }
}

function buildRings(RG) {
  R.rings = RG.gates.map((g) => {
    const geo = new THREE.TorusGeometry(30, 2.6, 12, 48);
    const mat = new THREE.MeshStandardMaterial({ color: 0x66ffee, emissive: 0x00ffcc, emissiveIntensity: .25, roughness: .4, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    const M = g.M;
    const m4 = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(M[0], M[1], M[2]), new THREE.Vector3(M[4], M[5], M[6]), new THREE.Vector3(M[8], M[9], M[10]));
    m4.setPosition(M[12], M[13], M[14]);
    mesh.applyMatrix4(m4);
    R.scene.add(mesh);
    return mesh;
  });
}

function buildPlane(RG) {
  // "Skyline Runner SR-26": lathe fuselage, wings + moving control surfaces,
  // canopy, livery (coral cheat-line, teal tail band/pods), "SR-26" decals,
  // prop + translucent disc, tricycle gear, nav + strobe lights.
  // Local frame: +Z forward, +Y up, +X the aircraft's LEFT (v6's matrix X = U x F).
  const white = new THREE.MeshStandardMaterial({ color: 0xededdd, roughness: .28, metalness: .12 });
  const red = new THREE.MeshStandardMaterial({ color: 0xcc1c17, roughness: .35, metalness: .1 });
  const coral = new THREE.MeshStandardMaterial({ color: 0xf56b4d, roughness: .4, metalness: .1 });
  const teal = new THREE.MeshStandardMaterial({ color: 0x1a9e9e, roughness: .4, metalness: .1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1f2126, roughness: .5, metalness: .5 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0e1a24, roughness: .06, metalness: .15, envMapIntensity: 1.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: .25, metalness: .9 });
  for (const m of [white, red, coral, teal, dark, glass, metal]) m.envMapIntensity = .6;
  const g = new THREE.Group();
  const add = (mesh, x = 0, y = 0, z = 0) => { mesh.position.set(x, y, z); mesh.castShadow = true; g.add(mesh); return mesh; };

  // Fuselage: lathe profile (tail -> nose), squashed to 1.1 m tall.
  const prof = [[.02, -5.3], [.28, -5.15], [.45, -4.6], [.6, -3.5], [.7, -1.5], [.75, -.2], [.72, .8], [.62, 1.8], [.45, 2.8], [.25, 3.5], [.08, 3.9], [.01, 3.98]]
    .map(p => new THREE.Vector2(p[0], p[1]));
  const fusGeo = new THREE.LatheGeometry(prof, 20);
  fusGeo.rotateX(Math.PI / 2); // lathe axis +Y -> +Z (nose forward)
  const fus = new THREE.Mesh(fusGeo, white);
  fus.scale.set(1, .75, 1); add(fus);
  // Nose cap (red, v6's taper nose).
  const nose = new THREE.Mesh(new THREE.SphereGeometry(.42, 12, 8), red);
  nose.scale.set(1, .75, 1.1); add(nose, 0, .05, 3.55);
  // Canopy bubble + dark frame rails.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), glass);
  canopy.scale.set(.55, .5, 1.05); add(canopy, 0, .82, .75);
  add(new THREE.Mesh(new THREE.BoxGeometry(.95, .5, .07), dark), 0, .85, 1.78);
  add(new THREE.Mesh(new THREE.BoxGeometry(.95, .55, .07), dark), 0, .85, -.28);
  // Coral cheat-line + teal stripe, both sides; side windows; dorsal strake; tail band.
  for (const s of [-1, 1]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(.04, .18, 7.2), coral), s * .68, .12, -.6);
    add(new THREE.Mesh(new THREE.BoxGeometry(.04, .06, 7.2), teal), s * .68, -.12, -.6);
    for (let k = 0; k < 4; k++) add(new THREE.Mesh(new THREE.BoxGeometry(.03, .32, .38), dark), s * .68, .3, -2.2 - k * .55);
  }
  add(new THREE.Mesh(new THREE.BoxGeometry(.12, .5, 1.2), white), 0, .85, -3.8); // dorsal strake
  const band = new THREE.Mesh(new THREE.CylinderGeometry(.62, .55, .5, 16), teal);
  band.rotation.x = Math.PI / 2; add(band, 0, .1, -4.85);
  // Wings + coral tips + teal pods.
  add(new THREE.Mesh(new THREE.BoxGeometry(11.2, .18, 1.75), white), 0, -.15, .9);
  for (const s of [-1, 1]) {
    add(new THREE.Mesh(new THREE.BoxGeometry(.75, .2, 1.77), red), s * 5.25, -.15, .9);
    add(new THREE.Mesh(new THREE.BoxGeometry(.32, .32, 1.9), teal), s * 5.72, -.15, .9);
  }
  // Tailplane + fin + rudder hinge group.
  add(new THREE.Mesh(new THREE.BoxGeometry(4.2, .14, 1.0), white), 0, .22, -4.75);
  for (const s of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(.5, .16, 1.02), red), s * 1.85, .22, -4.75);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(.16, 1.7, 1.2), red);
  fin.rotation.x = -.08; add(fin, 0, 1.1, -4.8);
  // Moving surfaces: ailerons (hinge at the wing trailing edge), elevator, rudder.
  const mkSurf = (w, h, d, mat) => {
    const grp = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(0, 0, -d / 2); m.castShadow = true; grp.add(m); g.add(grp); return grp;
  };
  R.ailL = mkSurf(2.2, .12, .7, white); R.ailL.position.set(3.2, -.15, .05);
  R.ailR = mkSurf(2.2, .12, .7, white); R.ailR.position.set(-3.2, -.15, .05);
  R.elev = mkSurf(4.0, .1, .5, white); R.elev.position.set(0, .22, -5.2);
  R.rudd = mkSurf(.14, 1.5, .6, red); R.rudd.position.set(0, 1.05, -5.25);
  // "SR-26" decals: fuselage sides + tail fin (mirrored correctly per side).
  const reg = regTex();
  const decal = (w, h, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: reg, transparent: true, polygonOffset: true, polygonOffsetFactor: -1 }));
    m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m;
  };
  decal(1.8, .32, .71, .1, -1.6, Math.PI / 2);
  decal(1.8, .32, -.71, .1, -1.6, -Math.PI / 2);
  decal(1.0, .22, .095, 1.15, -4.8, Math.PI / 2);
  decal(1.0, .22, -.095, 1.15, -4.8, -Math.PI / 2);
  // Prop: spinner + 2 blades + translucent disc (rotates with propA).
  const propG = new THREE.Group(); propG.position.set(0, .05, 4.1); g.add(propG);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(.28, .7, 12), metal);
  spinner.rotation.x = Math.PI / 2; spinner.position.z = .3; spinner.castShadow = true; propG.add(spinner);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(.16, 3.6, .05), dark);
  blade.castShadow = true; propG.add(blade);
  const tipT = new THREE.Mesh(new THREE.BoxGeometry(.2, .3, .06), new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: .4 }));
  tipT.position.y = 1.75; propG.add(tipT);
  const tipB = tipT.clone(); tipB.position.y = -1.75; propG.add(tipB);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32),
    new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: .1, side: THREE.DoubleSide, depthWrite: false }));
  disc.position.z = .05; propG.add(disc);
  R.propG = propG;
  // Tricycle gear (visible = gear down).
  const gear = new THREE.Group(); g.add(gear); R.gear = gear;
  const legMat = dark, wheelMat = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: .8 });
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(.06, .06, 1.5, 8), legMat);
    leg.position.set(s * 1.15, -1.15, 1.35); leg.castShadow = true; gear.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.31, .31, .28, 12), wheelMat);
    wheel.rotation.z = Math.PI / 2; wheel.position.set(s * 1.15, -1.9, 1.35); wheel.castShadow = true; gear.add(wheel);
    const fair = new THREE.Mesh(new THREE.BoxGeometry(.4, .3, .9), red);
    fair.position.set(s * 1.15, -1.6, 1.35); gear.add(fair);
  }
  const nleg = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, 1.2, 8), legMat);
  nleg.position.set(0, -1.0, 3.2); nleg.castShadow = true; gear.add(nleg);
  const nwheel = new THREE.Mesh(new THREE.CylinderGeometry(.26, .26, .22, 12), wheelMat);
  nwheel.rotation.z = Math.PI / 2; nwheel.position.set(0, -1.62, 3.2); nwheel.castShadow = true; gear.add(nwheel);
  // Nav lights (red left / green right — local +X is the aircraft's left)
  // + white tail light + blinking strobe on the fuselage top.
  const nav = (x, y, z, r, gg, b) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(r * 2.2, gg * 2.2, b * 2.2) }));
    m.position.set(x, y, z); g.add(m); return m;
  };
  nav(5.62, -.15, .9, 1, .1, .1); nav(-5.62, -.15, .9, .1, 1, .2); nav(0, 2.08, -5.3, 1, 1, 1);
  R.strobe = new THREE.Mesh(new THREE.SphereGeometry(.08, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 2.5, 2.5) }));
  R.strobe.position.set(0, 1.05, 1.2); g.add(R.strobe);

  g.matrixAutoUpdate = false;
  R.scene.add(g); R.plane = g;
}

function buildSmokePools() {
  const tex = softTex();
  const mkPool = (n, additive) => {
    const arr = [];
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: 0
      }));
      sp.visible = false; R.scene.add(sp); arr.push(sp);
    }
    return arr;
  };
  R.smokePool = mkPool(160, false);
  R.fxPool = mkPool(48, true);
}

// ---------- per-frame ----------
const _eye = new THREE.Vector3(), _look = new THREE.Vector3(), _up = new THREE.Vector3();
const _Ub = new THREE.Vector3(), _Rv = new THREE.Vector3(), _Fv = new THREE.Vector3(), _Uv = new THREE.Vector3();
const _vp = new THREE.Matrix4();

export function renderFrame(RG, t) {
  const now = performance.now();
  const dt = Math.min(.1, Math.max(.001, (now - R.lastNow) / 1000));
  R.lastNow = now;
  const fps = 1 / dt;
  R.fpsEMA = R.fpsEMA ? R.fpsEMA * .95 + fps * .05 : fps;
  R.uTime.value = t / 1000;
  const P = RG.P, state = RG.state;
  const F = _Fv.fromArray(P.F), U = _Uv.fromArray(P.U), Rv = _Rv.fromArray(P.R);
  _Ub.copy(U).multiplyScalar(.55).add(new THREE.Vector3(0, .45, 0)).normalize();

  // --- camera: v6's logic, verbatim (incl. the close title orbit) ---
  const eye = _eye, look = _look, up = _up;
  if (state === 'title') {
    const a = t * .00012;
    eye.set(P.pos[0] + Math.sin(a) * 26, P.pos[1] + 7 + Math.sin(a * .7) * 2, P.pos[2] + Math.cos(a) * 26 - 6);
    look.set(P.pos[0], P.pos[1] + 1, P.pos[2] - 2); up.set(0, 1, 0);
    RG.camPos[0] = eye.x; RG.camPos[1] = eye.y; RG.camPos[2] = eye.z;
  } else if (RG.camMode === 1 && state !== 'crashed') {
    eye.copy(V3(P.pos)).addScaledVector(U, 1.05).addScaledVector(F, .3);
    look.copy(eye).add(F); up.copy(U);
  } else {
    const tgt = V3(P.pos).addScaledVector(F, -23).addScaledVector(_Ub, 6.5).addScaledVector(Rv, -3.5);
    const k = state === 'crashed' ? .02 : (window.__shotMode && state === 'done' ? 0 : 1 - Math.exp(-7 / 60));
    RG.camPos[0] += (tgt.x - RG.camPos[0]) * k;
    RG.camPos[1] += (tgt.y - RG.camPos[1]) * k;
    RG.camPos[2] += (tgt.z - RG.camPos[2]) * k;
    eye.fromArray(RG.camPos);
    if (state === 'crashed') look.copy(V3(P.pos));
    else if (state === 'done') look.copy(V3(P.pos)).addScaledVector(F, 30).addScaledVector(_Ub, 2).addScaledVector(Rv, 40);
    else look.copy(V3(P.pos)).addScaledVector(F, 30).addScaledVector(_Ub, 2);
    up.copy(_Ub);
  }
  const gy = Math.max(RG.groundAt(eye.x, eye.z), 0) + 2;
  if (eye.y < gy) eye.y = gy;
  if (RG.shake > 0) {
    const s = RG.shake * 1.5;
    eye.x += (Math.random() - .5) * s; eye.y += (Math.random() - .5) * s; eye.z += (Math.random() - .5) * s;
  }
  const cam = R.camera;
  cam.position.copy(eye); cam.up.copy(up); cam.lookAt(look);
  cam.updateMatrixWorld();

  // --- sun + shadows follow the aircraft (tight shadow box stays sharp) ---
  R.sun.position.copy(V3(P.pos)).addScaledVector(SUN_DIR, 900);
  R.sun.target.position.copy(V3(P.pos));
  R.sun.target.updateMatrixWorld();

  // --- water time ---
  R.water.material.uniforms.time.value += dt;

  // --- rings: passed / current (pulsing) / future ---
  const pulse = .5 + .5 * Math.sin(t * .006);
  R.rings.forEach((mesh, i) => {
    const m = mesh.material;
    if (i < RG.gateIx) { mesh.visible = !window.__shotMode; m.emissive.setHex(0x00aa66); m.emissiveIntensity = .15; }
    else if (i === RG.gateIx) { mesh.visible = true; m.emissive.setHex(0x00ffcc); m.emissiveIntensity = .8 + pulse * .7; }
    else { mesh.visible = true; m.emissive.setHex(0x88bbcc); m.emissiveIntensity = .15; }
  });

  // --- glow sprites: sun halo follows the camera, ring halo marks the target ---
  R.sunHalo.position.copy(eye).addScaledVector(SUN_DIR, 15000);
  if (RG.gateIx < RG.gates.length) {
    R.ringGlow.visible = true;
    R.ringGlow.position.copy(R.rings[RG.gateIx].position);
    const gs = 130 + pulse * 50;
    R.ringGlow.scale.set(gs, gs, 1);
    R.ringGlow.material.opacity = 0.3 + pulse * 0.25;
  } else R.ringGlow.visible = false;

  // --- PAPI: red/white from the REAL glidepath angle to the threshold ---
  {
    const ang = Math.atan2(eye.y - RG.RWY.y, Math.hypot(eye.x, eye.z - RG.RWY.hl));
    // Unit nearest the runway = highest setting (3.5 deg), furthest = 2.5 deg.
    const thr = [.0611, .0553, .0494, .0436];
    R.papi.forEach((mat, i) => {
      const white = ang > thr[i];
      mat.color.setRGB(2.4, white ? 2.4 : .25, white ? 2.2 : .3);
    });
  }

  // --- aircraft: matrix from the flight model, moving surfaces, prop, gear ---
  const alive = state !== 'crashed' || (RG.fx.length && RG.fx[0].t < .15);
  const showPlane = alive && !(RG.camMode === 1 && (state === 'fly' || state === 'done'));
  R.plane.visible = showPlane;
  if (showPlane) {
    const X = new THREE.Vector3().crossVectors(U, F); // v6's matrix X = U x F (left)
    const m4 = new THREE.Matrix4().makeBasis(X, U.clone(), F);
    m4.setPosition(P.pos[0], P.pos[1], P.pos[2]);
    R.plane.matrix.copy(m4);
    R.plane.matrixWorldNeedsUpdate = true;
    const inp = RG.input;
    R.ailL.rotation.x = inp.rol * .5; R.ailR.rotation.x = -inp.rol * .5;
    R.elev.rotation.x = inp.pit * .45;
    R.rudd.rotation.y = inp.yaw * .5;
    R.propG.rotation.z = RG.propA;
    R.gear.visible = RG.gearDown;
    R.strobe.visible = (t % 1000) < 120;
  }

  // --- smoke (wingtip trails) + explosion fx as sprite pools ---
  {
    let i = 0;
    for (const s of RG.smoke) {
      if (i >= R.smokePool.length) break;
      const sp = R.smokePool[i++];
      sp.visible = true; sp.position.fromArray(s.p);
      const a = 1 - s.t / 2.2, sc = 2.2 + s.t * 2.2;
      sp.scale.set(sc, sc, 1); sp.material.opacity = a * .5;
      sp.material.color.setRGB(.88, .86, .84);
    }
    for (; i < R.smokePool.length; i++) R.smokePool[i].visible = false;
    let j = 0;
    for (const f of RG.fx) {
      const a = f.t; if (a >= 1.6 || j + 5 >= R.fxPool.length) continue;
      const sp = R.fxPool[j++];
      sp.visible = true; sp.position.fromArray(f.p);
      const sc = 4 + a * 22; sp.scale.set(sc, sc, 1);
      sp.material.opacity = 2.5 * (1.6 - a) / 1.6; sp.material.color.setRGB(1, .55, .15);
      for (let k = 0; k < 5 && j < R.fxPool.length; k++) {
        const b = a - k * .25; if (b <= 0 || b >= 6) continue;
        const dsp = R.fxPool[j++];
        dsp.visible = true; dsp.position.set(f.p[0] + k * 2, f.p[1] + b * 9, f.p[2] - k);
        const dsc = 6 + b * 5; dsp.scale.set(dsc, dsc, 1);
        dsp.material.opacity = .8; dsp.material.color.setRGB(.2, .2, .22);
      }
    }
    for (; j < R.fxPool.length; j++) R.fxPool[j].visible = false;
  }

  // --- render + perf ---
  R.renderer.info.reset();
  // ?nocomposer=1 bypasses the post chain (debug: isolates composer problems).
  if (new URLSearchParams(location.search).get('nocomposer') === '1') R.renderer.render(R.scene, R.camera);
  else R.composer.render();
  RG.perf.fps = Math.round(R.fpsEMA);
  RG.perf.calls = R.renderer.info.render.calls;
  RG.perf.tris = R.renderer.info.render.triangles;
  // View-projection matrix for the 2D HUD's proj() (column-major, like v6's VP).
  _vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  RG.VP = Array.from(_vp.elements);
}
