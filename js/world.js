/* THE TWINS — sculpted crystalline figure in a bright studio void.
   A real GLB mesh (Higgsfield image->3D) rendered as refractive ice with
   HDR bloom. Scroll drives a slow cinematic camera and a single->twin split.
   Deliberately restrained: one hero object, clean light, real material.
   Exposes window.WORLD = { ready, setProgress }. */

import * as THREE from 'three';
import { GLTFLoader } from './vendor/three-addons/loaders/GLTFLoader.js';
import { EffectComposer } from './vendor/three-addons/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/three-addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/three-addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from './vendor/three-addons/postprocessing/ShaderPass.js';
import { OutputPass } from './vendor/three-addons/postprocessing/OutputPass.js';
import { BokehPass } from './vendor/three-addons/postprocessing/BokehPass.js';

/* classify by device, not viewport: a phone opened in landscape must still
   get the mobile GPU budget (DPR cap, no bokeh, reduced particle counts) —
   screen.width/height are orientation-stable device dimensions */
const isMobile = matchMedia('(max-width: 640px)').matches ||
  (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 640);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp01 = t => Math.min(Math.max(t, 0), 1);
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const seg = (p, a, b) => smooth((p - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;

/* ---------------- height fog (global shader patch) ----------------
   FogExp2 fogs by radial distance only, so a finite ground plane tops out at
   ~85% fog and its rim prints a thin dark line against the 100%-haze sky.
   Real air extinguishes grazing rays completely. Patch the fog chunks so the
   density swells near the ground plane — a shallow haze pool: the ice fully
   dissolves before any edge can show, while dune crests above the pool keep
   their silhouettes. World-height is rebuilt from the view matrix so this
   works for EVERY fogged shader (sprites included) — one air, everywhere. */
THREE.ShaderChunk.fog_pars_vertex = THREE.ShaderChunk.fog_pars_vertex
  .replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogY;');
THREE.ShaderChunk.fog_vertex = THREE.ShaderChunk.fog_vertex
  .replace('vFogDepth = - mvPosition.z;',
    'vFogDepth = - mvPosition.z;\n\tvFogY = cameraPosition.y + dot( viewMatrix[1].xyz, mvPosition.xyz );');
THREE.ShaderChunk.fog_pars_fragment = THREE.ShaderChunk.fog_pars_fragment
  .replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vFogY;');
THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment
  .replace('float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );',
    'float fogHD = fogDensity * ( 1.0 + 1.4 * exp( - max( vFogY, 0.0 ) * 0.55 ) );\n\t\tfloat fogFactor = 1.0 - exp( - fogHD * fogHD * vFogDepth * vFogDepth );');

/* ---------------- renderer ---------------- */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (err) { window.WORLD_FAILED = true; throw err; }

const stage = document.getElementById('hero-stage');
// stage — and even the window — can transiently report 0×0 (hidden tab,
// pin refresh); never size the renderer to zero or it sticks black.
// The size is CACHED: fitToStage runs before every frame, and an offsetWidth
// read there forces a layout pass against that frame's style writes. A
// ResizeObserver (fires on observe, resizes, and pin refreshes) plus the
// window resize event keep the cache honest with zero reads on the hot path.
let stageW = 0, stageH = 0;
const refreshStageSize = () => {
  const w = stage.offsetWidth || innerWidth || 1280;
  const h = stage.offsetHeight || innerHeight || 720;
  if (w > 1 && h > 1) { stageW = w; stageH = h; }
};
refreshStageSize();
new ResizeObserver(refreshStageSize).observe(stage);
addEventListener('resize', refreshStageSize);
const stageSize = () => [stageW || 1280, stageH || 720];
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile ? 1.75 : 2));  // 1.5 read as dithered crunch on phone OLEDs
renderer.setSize(...stageSize());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.88;   // the range pano's luminous key — bright, never white-hot
/* NOT 'world' — that id belongs to the reading-deck section; a duplicate id
   here silently rewired every '#world' selector (deck reveals, the inworld
   hide rule, the fallback boundary) onto this canvas */
renderer.domElement.id = 'gl-world';
renderer.domElement.style.cssText =
  'position:absolute;inset:0;width:100%;height:100%;z-index:1;display:block;';
stage.insertBefore(renderer.domElement, stage.firstChild);

/* NOTE: the #figure particle fallback is deliberately NOT removed here.
   It stays in the DOM (hidden behind the loader) until the WebGL pipeline
   proves it can render one full frame — see the guarded boot at the end of
   this file. If anything in the setup throws, the fallback carries the hero
   instead of the visitor seeing a blank stage. */

/* ---------------- scene + sky (procedural arctic atmosphere) ----------------
   NO photo panorama anywhere: the sky is a computed atmosphere — silver haze
   at the horizon lifting into a colder zenith, faint stratus drift, one low
   arctic sun. Fog, terrain and sky all dissolve into the SAME horizon colour,
   so ground and sky can never meet at a visible line. */
const scene = new THREE.Scene();

/* THE sun: the sky's bloom, the key light and the terrain's baked shading all
   point at this one vector — a single low arctic sun, ~22° over the horizon */
const SUN = new THREE.Vector3(5, 2.6, 4).normalize();
/* THE haze colour: sky horizon, scene fog and the far dissolve share this
   exact Color instance — the "no seam anywhere" contract of the whole world */
const HAZE = new THREE.Color(0xd6dce4);   // brightened to the range pano's luminous key
const ZENITH = new THREE.Color(0xa4b4c8);
const fallSpace = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#0a0e16'); gr.addColorStop(1, '#141b28');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    uSpace: { value: 0 }, uTime: { value: 0 },
    uHorizon: { value: HAZE }, uZenith: { value: ZENITH }, uSunDir: { value: SUN },
    uCosmos: { value: fallSpace },
    uRange: { value: fallSpace }, uHasRange: { value: 0 },
    uParhelion: { value: 0 },
    /* the parhelion's own seat: dead ahead over the range (the camera faces
       -z through the whole protocol act; the true SUN sits behind it) */
    uParhDir: { value: new THREE.Vector3(0, 0.47, -1).normalize() }
  },
  vertexShader: `varying vec3 vDir;
    void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uSpace, uTime, uHasRange, uParhelion; uniform vec3 uHorizon, uZenith, uSunDir, uParhDir; uniform sampler2D uCosmos, uRange; varying vec3 vDir;
    float shash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float snoise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(shash(i), shash(i + vec2(1.0, 0.0)), u.x),
                 mix(shash(i + vec2(0.0, 1.0)), shash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float sfbm(vec2 p){
      float a = 0.0, w = 0.5;
      for (int o = 0; o < 4; o++){ a += (snoise(p) * 2.0 - 1.0) * w; p *= 2.13; w *= 0.5; }
      return a;
    }
    void main(){
      vec3 d = normalize(vDir);
      float y = d.y;
      // haze band at the horizon lifting slowly into the colder zenith;
      // below the horizon the dome is PURE haze, so anything past the
      // terrain's far dissolve reads as weather, never as an edge
      vec3 sky = mix(uHorizon, uZenith, smoothstep(0.02, 0.62, y));
      // THE RANGE — the photographic 360 panorama of jagged alpine peaks
      // (wrap-healed offline). It owns the horizon band and the lower sky:
      // its base dissolves into the haze right where our fogged plain
      // whites out (no junction can exist), and it hands the zenith back
      // to the procedural atmosphere high up.
      float elev = asin(clamp(y, -1.0, 1.0));
      float panoW = 0.0;
      if (uHasRange > 0.001 && elev > -0.06 && elev < 0.52) {
        // the seamless pano TILES 4x around the circle: each peak reads
        // ~12 deg wide, so a frame holds a whole range like the reference —
        // never one looming wall. Vertical mapping keeps the image's own
        // proportions (mountain bases at the horizon, summits ~18 deg).
        float u = (atan(d.z, d.x) / 6.2831853 + 0.5 - 0.108) * 4.0;
        float v = 0.124 + elev * 1.7;
        vec3 range = texture2D(uRange, vec2(u, clamp(v, 0.001, 0.999))).rgb;
        panoW = uHasRange
              * smoothstep(-0.045, 0.005, elev)                // base melts into the haze
              * (1.0 - smoothstep(0.38, 0.50, elev));          // sky handoff above the peaks
        sky = mix(sky, range, panoW);
      }
      // faint stratus drift on a virtual cloud plane — over the procedural
      // sky only; the pano band carries its own weather
      if (y > 0.03) {
        vec2 cp = d.xz / (y + 0.22);
        float cl = sfbm(cp * 0.6 + vec2(uTime * 0.004, 0.0))
                 + 0.5 * sfbm(cp * 1.9 - vec2(uTime * 0.0062, 3.7));
        sky += cl * 0.075 * smoothstep(0.07, 0.30, y) * (1.0 - smoothstep(0.55, 0.95, y)) * (1.0 - panoW);
      }
      // the arctic sun: a broad silver bloom + a tight veiled disc — eased
      // where the pano band carries its own radiance
      float sd = max(dot(d, uSunDir), 0.0);
      float sunEase = 1.0 - panoW * 0.65;
      sky += vec3(0.28, 0.25, 0.20) * pow(sd, 7.0) * sunEase;
      sky += vec3(0.95, 0.88, 0.74) * pow(sd, 110.0) * 0.85 * sunEase;
      // THE PARHELION — the sky answers the protocol: a faint 22-deg halo,
      // two sun dogs where the halo crosses the sun's elevation, one thin
      // light pillar. Procedural on the ONE true sun (the 4x-tiled pano
      // could only ever repeat a baked halo four times around the circle).
      // Champagne-silver — inside the ratified gold family, never a new hue.
      if (uParhelion > 0.001) {
        float ang = acos(clamp(dot(d, uParhDir), -1.0, 1.0));
        float halo = exp(-pow((ang - 0.384) * 24.0, 2.0));
        // contrast, not addition: on a sky already near white, added light
        // clips invisibly (jury-verified sub-threshold by construction) —
        // so first CARVE a soft dim annulus, then let the halo burn inside it
        float carve = exp(-pow((ang - 0.384) * 13.0, 2.0));
        sky *= 1.0 - carve * 0.075 * uParhelion * (1.0 - panoW * 0.35);
        float dogs = halo * exp(-pow((d.y - uParhDir.y) * 7.0, 2.0)) * 1.7;
        float azD = atan(d.z, d.x) - atan(uParhDir.z, uParhDir.x);
        azD = abs(mod(azD + 3.14159265, 6.2831853) - 3.14159265);
        float pillar = exp(-pow(azD * 22.0, 2.0))
                     * (1.0 - smoothstep(0.05, 0.42, abs(d.y - uParhDir.y)));
        sky += vec3(1.0, 0.93, 0.72)
             * (halo * 0.30 + dogs * 0.34 + pillar * 0.16)
             * uParhelion * (1.0 - panoW * 0.22);
      }
      // cosmos arm kept for the (retired) space mode
      if (uSpace > 0.001) {
        vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5);
        vec3 cosv = texture2D(uCosmos, uv).rgb;
        float lc = dot(cosv, vec3(0.299, 0.587, 0.114));
        sky = mix(sky, mix(cosv, vec3(lc), 0.55), uSpace);   // monochrome discipline
      }
      // TEMPORAL dither: the pattern shifts every frame (via uTime) so gradient
      // banding can never lock into visible grey lines, at any precision
      float dth = fract(sin(dot(gl_FragCoord.xy + uTime * vec2(53.0, 29.0), vec2(12.9898, 78.233))) * 43758.5453);
      sky += (dth - 0.5) * (1.7 / 255.0);
      gl_FragColor = vec4(sky, 1.0);
    }`
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(80, 48, 24), skyMat));

/* reflection environments — built AFTER pmrem exists; the procedural
   atmosphere serves until the range pano arrives and takes over */
let iceEnvMap = null, iceEnvRT = null;
const texLoader = new THREE.TextureLoader();
/* THE RANGE — the user's chosen world: a wrap-healed 4K photographic 360 of
   jagged arctic peaks. Drives the sky's horizon band AND the reflections.
   WebP first (622KB desktop / 240KB mobile vs the 4.3MB source JPEG; the 4×
   wrap seam verified preserved at edge-delta parity) — JPEG stays as the
   onError fallback for engines without WebP. */
const applyRange = (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  skyMat.uniforms.uRange.value = t;
  skyMat.uniforms.uHasRange.value = 1;
  if (typeof pmrem !== 'undefined' && pmrem) {
    const oldRT = iceEnvRT;
    iceEnvRT = pmrem.fromEquirectangular(t);
    iceEnvMap = iceEnvRT.texture;
    scene.environment = iceEnvMap;
    if (oldRT) oldRT.dispose();       // the procedural env's cubeUV target retires
    pmrem.dispose();                  // final environment set — free the generator's scratch
  }
};
texLoader.load(
  isMobile ? 'assets/env/arctic-range-mobile.webp' : 'assets/env/arctic-range.webp',
  applyRange, undefined,
  () => texLoader.load('assets/env/arctic-range.jpg', applyRange));
/* (the cosmos pano load is retired with its space mode — uSpace is pinned 0
   and the fallSpace gradient keeps the shader branch valid) */

/* heavy arctic haze — THE depth cue of the one-world build: the dune belts
   dissolve progressively into the sky's own horizon colour (same Color
   instance, so they can never drift apart) */
/* base density is the CREST haze (what dune silhouettes swim in); the height
   patch above swells it ~2.1× at ground level so the plain fully whites out
   by its far edge — no rim, no line */
scene.fog = new THREE.FogExp2(HAZE, 0.016);

/* soft radial glow texture, shared by hearts / stars / beams */
function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const [initW, initH] = stageSize();
const camera = new THREE.PerspectiveCamera(42, initW / initH, 0.1, 100);

const pmrem = new THREE.PMREMGenerator(renderer);
/* reflections come from the SAME atmosphere the sky draws — a tiny equirect
   gradient with the low-sun bloom, PMREM'd. Every material reflects the one
   world; nothing photographic remains anywhere in the pipeline. */
{
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0.0, '#a4b4c8');    // ZENITH
  gr.addColorStop(0.48, '#d6dce4');   // HAZE horizon
  gr.addColorStop(0.56, '#c3cad5');
  gr.addColorStop(1.0, '#a8b1bf');    // snowfield bounce from below
  g.fillStyle = gr; g.fillRect(0, 0, 256, 128);
  const az = Math.atan2(SUN.z, SUN.x), el = Math.asin(SUN.y);
  const px = (az / (Math.PI * 2) + 0.5) * 256, py = (0.5 - el / Math.PI) * 128;
  const sun = g.createRadialGradient(px, py, 0, px, py, 30);
  sun.addColorStop(0, 'rgba(255,246,228,0.9)');
  sun.addColorStop(0.35, 'rgba(238,238,240,0.35)');
  sun.addColorStop(1, 'rgba(238,238,240,0)');
  g.fillStyle = sun; g.fillRect(0, 0, 256, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping;
  iceEnvRT = pmrem.fromEquirectangular(t);
  iceEnvMap = iceEnvRT.texture;
  scene.environment = iceEnvMap;
  t.dispose();                        // the 256×128 source served its one conversion
}

/* one low arctic sun: the key light sits ON the sun vector (the same one the
   sky bloom and the terrain bake use); a cold blue rim answers from the
   opposite quarter; the fill drops so figures cut harder against the snow */
const hemi = new THREE.HemisphereLight(0xedf2fa, 0x66707f, 0.34);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff6ea, 3.8);
key.position.copy(SUN).multiplyScalar(9);
scene.add(key);
const rim = new THREE.DirectionalLight(0xcfe2ff, 3.4);
rim.position.set(-4, 2.2, -5);
scene.add(rim);

/* verification pulse — cold now, so the heart stays the only color */
const amberLight = new THREE.PointLight(0xcfe0ff, 0, 14, 2);
amberLight.position.set(0, 1.2, 0.6);
scene.add(amberLight);

/* GOLDEN HOUR — while the vault stands, the world's light leans gold: the
   sun lowers, the key warms, gold catches on the ice. Scroll-driven (the
   visitor pulls the hour across the sky). Base/gold pairs are constants;
   the update loop lerps between them — fog/HAZE stay untouched (the
   one-constant contract) so no seam can open. */
const KEY_BASE  = new THREE.Color(0xfff6ea), KEY_GOLD  = new THREE.Color(0xffddab);
const RIM_BASE  = new THREE.Color(0xcfe2ff), RIM_GOLD  = new THREE.Color(0xffe7c2);
const HEMI_BASE = new THREE.Color(0x66707f), HEMI_GOLD = new THREE.Color(0x7d7259);

/* ---------------- reflective floor ---------------- */
const FLOOR_L = new THREE.Color(0xb3bcc8), FLOOR_D = new THREE.Color(0x161b23);
const floorMat = new THREE.MeshStandardMaterial({
  color: 0xb3bcc8, roughness: 0.9, metalness: 0.0, envMapIntensity: 0.6
});
/* snow-hd is fetched ONCE; late consumers (the terrain builds at module eval,
   before the texture lands) register here and clone — clone shares the decoded
   image, so the network fetch and decode are never paid twice */
let snowTex = null; const snowTexWaiters = [];
const onSnowTex = (fn) => { snowTex ? fn(snowTex) : snowTexWaiters.push(fn); };
texLoader.load('assets/env/snow-hd.jpg', (t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 14);
  floorMat.map = t;
  /* the snow grain doubles as micro-relief so the near ground reads sculpted,
     not flat — floor, lid and terrain all carry the SAME bump. Kept very
     shallow: a stronger scale speckle-aliases under the directional lights */
  floorMat.bumpMap = t; floorMat.bumpScale = 0.012;
  snowTex = t;
  for (const fn of snowTexWaiters.splice(0)) fn(t);
  floorMat.needsUpdate = true;
  /* the lid samples the same snow at matched world-scale so it reads as the
     exact same ground until it unseals */
  const lt = t.clone(); lt.needsUpdate = true;
  lt.wrapS = lt.wrapT = THREE.RepeatWrapping;
  lt.repeat.set(0.22, 0.22); lt.offset.set(0.4, 0.35);
  lidMat.map = lt; lidMat.bumpMap = lt; lidMat.bumpScale = 0.012;
  lidMat.needsUpdate = true;
});
/* the plain is a RING with a hole at the centre; a frosted ice LID sits flush
   over it as seamless, permanent ground (the vault forms in the air above). */
const VAULT_R = 0.92;
/* the rim sits past the height-fog's extinction distance (99.9% at ~66m on
   the ground), so the disc's edge is mathematically invisible — the ice ends
   INSIDE the haze, never against the sky */
const floor = new THREE.Mesh(new THREE.RingGeometry(VAULT_R, 66, 96, 1), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
scene.add(floor);

/* the sealed lid — a smooth disc of frost that reads as solid ground until
   the vault opens (a faint concentric etch hints at the seal beneath) */
const lidMat = new THREE.MeshStandardMaterial({
  color: 0xb3bcc8, roughness: 0.9, metalness: 0.0, envMapIntensity: 0.6   // MUST match floorMat or the seam shows
});
const lid = new THREE.Mesh(new THREE.CircleGeometry(VAULT_R + 0.04, 72), lidMat);
lid.rotation.x = -Math.PI / 2;
lid.position.y = 0.008;   // just under the contact shadows so figures stay grounded
scene.add(lid);

/* living snow — one injection shared by floor, lid and terrain (identical
   world-hashed patterns, so no seam can show between them):
   1. sparkle: thousands of tiny ice glints twinkling slowly
   2. wind streams: thin bright snow filaments racing along the wind — the
      surface itself is ALIVE, independent of scroll (igloo's wind_noise)
   3. cloud light: huge soft luminance patches drifting over the world
      (igloo's clouds_noise) — the overcast sky visibly moves
   4. caustics: focused light breathing slowly through the ice */
const sparkTime = { value: 0 };
function addSnowSparkle(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSparkTime = sparkTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSparkPos;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvSparkPos = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
      varying vec3 vSparkPos;
      uniform float uSparkTime;
      float wnHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float wnNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(wnHash(i), wnHash(i + vec2(1.0, 0.0)), u.x),
                   mix(wnHash(i + vec2(0.0, 1.0)), wnHash(i + vec2(1.0, 1.0)), u.x), u.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        // ice glints
        vec2 cell = floor(vSparkPos.xz * 34.0);
        float h = wnHash(cell);
        float tw = 0.5 + 0.5 * sin(uSparkTime * (1.2 + h * 2.2) + h * 6.2831);
        diffuseColor.rgb += vec3(0.85, 0.92, 1.0) * step(0.996, h) * pow(tw, 12.0) * 0.4;
        // wind-blown snow streams — long in the wind (+x), tight across it
        vec2 ws = vec2(vSparkPos.x * 0.09 - uSparkTime * 1.05, vSparkPos.z * 0.8);
        float st = wnNoise(ws + wnNoise(ws * 1.7 + 3.7) * 0.8);
        st = smoothstep(0.62, 0.95, st);
        diffuseColor.rgb += vec3(0.9, 0.95, 1.0) * st * 0.05;
        // drifting cloud light — the overcast sky visibly moves over the snow
        vec2 cw = vSparkPos.xz * 0.016 + vec2(uSparkTime * 0.010, uSparkTime * 0.0038);
        float cl = (wnNoise(cw) - 0.5) + 0.5 * (wnNoise(cw * 2.3 + 7.7) - 0.5);
        diffuseColor.rgb *= 1.0 + cl * 0.10;
        // caustics — light focused through the ice, breathing slowly
        vec2 cc = vSparkPos.xz * 0.55;
        float ca = sin(cc.x * 3.1 + uSparkTime * 0.62) * sin(cc.y * 2.7 - uSparkTime * 0.49)
                 + sin((cc.x + cc.y) * 2.3 + uSparkTime * 0.36);
        diffuseColor.rgb += vec3(0.55, 0.75, 1.0) * max(ca - 1.55, 0.0) * 0.09;
      }`);
  };
}
addSnowSparkle(floorMat);
addSnowSparkle(lidMat);

/* ---------------- sculpted arctic terrain ----------------
   A REAL 3D world, not a photo backdrop: wind-stretched snow drifts rise from
   the plain mid-field, and two belts of billowed snow dunes carry the whole
   horizon — irregular geometry with true parallax, dissolving into the haze,
   never the dead-straight floor/sky junction that read as two stitched
   images. The flat stage (r<8) is untouched: figures, emblems, the vault and
   every camera keyframe (max r≈8.4) live there. The shell sits 25mm BELOW
   the floor plane and only emerges where the sculpt rises, so the join with
   the existing snow (same map, same sparkle hash) is an irregular drift
   contour, not a seam. Deterministic seeded noise — the range never changes
   between visits. */
const terrain = (() => {
  const R0 = 7.5, R1 = 70, RSEG = 150, ASEG = 240;   // shell runs past fog extinction — no visible edge
  const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return hash2(xi, yi) * (1 - u) * (1 - v) + hash2(xi + 1, yi) * u * (1 - v)
      + hash2(xi, yi + 1) * (1 - u) * v + hash2(xi + 1, yi + 1) * u * v;
  };
  const fbm = (x, y, oct) => {
    let a = 0, amp = 0.5, f = 1, n = 0;
    for (let o = 0; o < oct; o++) { a += (vnoise(x * f, y * f) * 2 - 1) * amp; n += amp; amp *= 0.5; f *= 2.1; }
    return a / n;                                       // -1..1
  };
  const ridged = (x, y, oct) => {
    let a = 0, amp = 0.5, f = 1, n = 0;
    for (let o = 0; o < oct; o++) { const w = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1); a += w * w * amp; n += amp; amp *= 0.5; f *= 2.05; }
    return a / n;                                       // 0..1
  };
  const zone = (r, a, b) => smooth(clamp01((r - a) / (b - a)));
  const height = (x, z) => {
    const r = Math.hypot(x, z);
    const stage = zone(r, 8.4, 11.0);                   // dead flat where the story lives
    // A VAST FLAT WIND-SCULPTED PLAIN running clean to the horizon — the
    // range panorama owns EVERY mountain. The reference has no mid-ground
    // masses, and procedural hills only ever read as clay next to
    // photographic peaks, so there are none: depth comes from the rippled
    // surface, the racing spindrift, the ground haze and the lens. Real
    // parallax needs no geometry to look real at this distance.
    // Broad slow swells give the plain its continental scale...
    let h = fbm(x * 0.019 + 4.0, z * 0.019 - 2.0, 3) * 1.15 * zone(r, 9, 22);
    // ...wind drifts banked across it, stretched along the wind (+x)...
    h += Math.max(fbm(x * 0.058, z * 0.15, 4), 0) * 0.6 * zone(r, 9, 17);
    // ...fine sastrugi ripples for near-ground tactility...
    h += fbm(x * 0.15, z * 0.5, 2) * 0.09 * zone(r, 9, 14);
    // ...and an almost-imperceptible lift into the far haze so the plain
    // reads as endless, never a disc with a rim (stays far below the
    // pano's peak bases, and the height fog whitens it out regardless).
    h += smooth(clamp01((r - 26) / 40)) * 1.6;
    return h * stage;
  };
  const verts = RSEG * ASEG, pos = new Float32Array(verts * 3), uv = new Float32Array(verts * 2);
  const col = new Float32Array(verts * 3), idx = new Uint32Array((RSEG - 1) * ASEG * 6);
  const SNOW = new THREE.Color(0xb3bcc8), CAP = new THREE.Color(0xe4eaf2);
  const c = new THREE.Color();
  for (let ri = 0; ri < RSEG; ri++) {
    // slight radial bias packs vertices into the dune/mountain bands
    const t = ri / (RSEG - 1), r = R0 + (R1 - R0) * (t * 0.7 + t * t * 0.3);
    for (let ai = 0; ai < ASEG; ai++) {
      const a = (ai / ASEG) * Math.PI * 2, i = ri * ASEG + ai;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = height(x, z);
      pos[i * 3] = x; pos[i * 3 + 1] = h - 0.025; pos[i * 3 + 2] = z;
      uv[i * 2] = x * (14 / 120) + 0.5; uv[i * 2 + 1] = z * (14 / 120) + 0.5;
      // colour: floor-matched snow, whitening toward the caps
      c.copy(SNOW).lerp(CAP, clamp01(h / 10));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
  }
  let k = 0;
  for (let ri = 0; ri < RSEG - 1; ri++) {
    for (let ai = 0; ai < ASEG; ai++) {
      const a0 = ri * ASEG + ai, a1 = ri * ASEG + (ai + 1) % ASEG;
      const b0 = a0 + ASEG, b1 = a1 + ASEG;                 // shared wrap verts: no normal seam
      idx[k++] = a0; idx[k++] = b0; idx[k++] = a1;
      idx[k++] = a1; idx[k++] = b0; idx[k++] = b1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  // A directional sun term is BAKED into the vertex colours — the SAME sun
  // the sky bloom and the key light use, so light comes from one place
  // everywhere. Flat ground keeps factor 1.0 by construction: the terrain
  // stays pixel-identical to the floor where they meet (same colour, same
  // map, same lights, same sparkle) — no emergence seam can exist. Shading
  // strength grows with the MASS of the form: low foreground drifts stay
  // floor-bright (a full-strength bake there stamped dark streaks onto the
  // plain), and shadowed snow cools toward blue — never grey-black.
  // Exposed rock rides the steep faces first (the poster's stratified crags —
  // snow keeps the benches and flats), then the sun bake shades everything.
  const ROCK = new THREE.Color(0x3c4553), ROCKD = new THREE.Color(0x272d38);
  const rockCol = new THREE.Color();
  const nrm = geo.attributes.normal.array;
  for (let i = 0; i < verts; i++) {
    const h = pos[i * 3 + 1];
    const wx = pos[i * 3], wz = pos[i * 3 + 2];
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    c.setRGB(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
    // the rock-start height UNDULATES — a constant threshold drew one bright
    // snow/rock boundary at the same world height around the entire ring
    const hRock = 0.9 + vnoise(wx * 0.11 + 5.1, wz * 0.11 - 2.9) * 1.6;
    const steep = clamp01((0.86 - ny) / 0.22) * clamp01((h - hRock) / 1.8);
    if (steep > 0) {
      const band = 0.5 + 0.5 * Math.sin(h * 2.3 + vnoise(wx * 0.15, wz * 0.15) * 9.0);
      rockCol.copy(ROCK).lerp(ROCKD, band * 0.7);
      const breakup = 0.5 + 0.5 * vnoise(wx * 0.9, wz * 0.9);
      c.lerp(rockCol, steep * breakup * 0.95);
    }
    const lam = Math.max(nx * SUN.x + ny * SUN.y + nz * SUN.z, 0);
    const ease = clamp01((1 - ny) * 2.6) * (0.2 + 0.8 * clamp01(h / 2.4));
    const shade = 1 + (0.56 + 0.60 * lam - 1) * ease;   // 0.56 shade floor, ~1.16 lit crest
    c.r *= shade * (shade < 1 ? 0.93 + 0.07 * shade : 1);   // blue-shift the shade side
    c.g *= shade * (shade < 1 ? 0.97 + 0.03 * shade : 1);
    c.b *= shade;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.96, metalness: 0.0, envMapIntensity: 0.35,
    /* where the sculpt grazes the coplanar floor plane the depth tie must go
       to the floor — identical surfaces, so the handoff is invisible; without
       this the crossing annulus z-fights as a hard dark line */
    polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2
  });
  addSnowSparkle(mat);                                   // same world-hash glints as the plain
  onSnowTex((t0) => {
    const t = t0.clone();                                // shares the decoded image — no refetch
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1);
    t.needsUpdate = true;
    mat.map = t; mat.bumpMap = t; mat.bumpScale = 0.012;
    mat.needsUpdate = true;                              // same grain as the floor it rises from
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  return mesh;
})();

/* ---------------- spindrift — the ground blizzard ----------------
   The poster's defining texture: sheets of wind-blown snow racing across the
   plain, pooling around the mesa bases. Three horizontal veils at ankle /
   knee / waist height, each a world-space advected-noise alpha sheet in the
   HAZE colour. Seen at grazing angle from the 1.3m eye they stretch into
   flowing streams; the depth buffer threads them between the rock masses.
   The stage (r<10) stays clear so the story is never veiled. */
const driftMats = [];
{
  const driftGeo = new THREE.RingGeometry(9, 64, 72, 1);
  driftGeo.rotateX(-Math.PI / 2);
  const base = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: { value: 0 }, uOff: { value: 0 }, uScale: { value: 1 }, uHaze: { value: HAZE } },
    vertexShader: `varying vec3 vW;
      void main(){ vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uTime, uOff, uScale; uniform vec3 uHaze; varying vec3 vW;
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
      float fb(vec2 p){ float a = 0.0, w = 0.5; for (int i = 0; i < 3; i++){ a += n2(p) * w; p *= 2.17; w *= 0.5; } return a; }
      void main(){
        float r = length(vW.xz);
        // streaks race along the wind (+x): long in x, tight in z
        vec2 q = vec2(vW.x * 0.05 * uScale - uTime * 0.85, vW.z * 0.30 * uScale + uOff);
        float s = fb(q + fb(q * 1.9 + uTime * 0.05) * 0.7);
        s = smoothstep(0.40, 0.80, s);
        float mask = smoothstep(10.0, 18.0, r) * (1.0 - smoothstep(46.0, 62.0, r));
        // grazing fade: where the sheet compresses toward the eye-level
        // horizon it would stack into a solid band — dissolve it instead
        float d = distance(cameraPosition, vW);
        float grz = smoothstep(0.012, 0.05, abs(cameraPosition.y - vW.y) / max(d, 0.001));
        gl_FragColor = vec4(uHaze * 1.04, s * mask * grz * 0.42);
      }`
  });
  for (const [y, off, sc] of [[0.25, 0.0, 1.0], [0.60, 3.7, 1.35], [1.10, 8.9, 1.8]]) {
    if (isMobile && y > 1.0) continue;                  // two veils on mobile
    const m = base.clone();
    m.uniforms.uOff.value = off; m.uniforms.uScale.value = sc;
    const veil = new THREE.Mesh(driftGeo, m);
    veil.position.y = y;
    veil.renderOrder = 2;                               // after the other transparents
    scene.add(veil);
    driftMats.push(m);
  }
}

/* The plain runs clean and unbroken to the photographic range — no slabs, no
   mesas, no staged relief. The reference has nothing on the foreground snow,
   and every procedural mass we tried read as clay beside the real mountains.
   Subtraction wins: the emptiness is the point. */

/* soft contact shadow under each figure */
const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(40,46,58,0.5)');
  grad.addColorStop(1, 'rgba(40,46,58,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
function contactShadow() {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.01;
  scene.add(m);
  return m;
}
const shadowA = contactShadow(), shadowB = contactShadow();

/* ---------------- ice material ---------------- */
function iceMaterial() {
  /* dense glacial ice — dark, tactile, high-contrast (not milky glass) */
  return new THREE.MeshPhysicalMaterial({
    color: 0xb9c6d4,
    metalness: 0.0,
    roughness: 0.16,
    transmission: 0.6,
    thickness: 1.6,
    ior: 1.45,
    attenuationColor: new THREE.Color(0x5f7890),
    attenuationDistance: 1.3,
    clearcoat: 1.0,
    clearcoatRoughness: 0.12,
    iridescence: 0.35,
    iridescenceIOR: 1.34,
    sheen: 0.6,
    sheenColor: new THREE.Color(0xbcd6ff),
    sheenRoughness: 0.5,
    specularIntensity: 1.0,
    envMapIntensity: 1.35,
    emissive: new THREE.Color(0x18242f),
    emissiveIntensity: 0.06,
    transparent: true
  });
}

/* ---------------- deconstruction shards ----------------
   Sampled from the hero mesh surface; disperse outward on scroll like
   igloo's igloo coming apart brick by brick. */
const shardMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: true,
  uniforms: {
    uDisperse: { value: 0 }, uTime: { value: 0 }, uAlpha: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uFogColor: { value: new THREE.Color(0xc6ccd4) }, uFogD: { value: 0.03 },
    uColLo: { value: new THREE.Color(0x8697a8) }, uColHi: { value: new THREE.Color(0xf1f6fc) }
  },
  vertexShader: `
    attribute vec3 aScatter; attribute vec4 aRand;
    uniform float uDisperse, uTime;
    varying vec3 vN, vW;
    void main(){
      vec3 it = instanceMatrix[3].xyz;
      vec3 wob = vec3(sin(uTime*0.7+aRand.x*6.28), cos(uTime*0.6+aRand.y*6.28), sin(uTime*0.8+aRand.z*6.28)) * 0.03 * uDisperse;
      vec3 off = (aScatter - it) * uDisperse + wob;
      vec4 wp = instanceMatrix * vec4(position, 1.0);
      wp.xyz += off;
      wp = modelMatrix * wp;
      vW = wp.xyz;
      vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    precision highp float;
    uniform float uAlpha, uFogD; uniform vec3 uCam, uFogColor, uColLo, uColHi;
    varying vec3 vN, vW;
    void main(){
      vec3 V = normalize(uCam - vW);
      float fres = pow(1.0 - abs(dot(V, normalize(vN))), 2.0);
      vec3 col = mix(uColLo, uColHi, fres);
      float sd = distance(uCam, vW);
      float fog = 1.0 - exp(-sd*sd*uFogD*uFogD);
      col = mix(col, uFogColor, fog);
      gl_FragColor = vec4(col, uAlpha * (0.55 + 0.45*fres) * (1.0 - fog*0.6));
    }`
});
let shards = null;
function buildShards(sceneObj) {
  sceneObj.updateWorldMatrix(true, true);
  const pts = [];
  sceneObj.traverse(o => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const m = o.matrixWorld;
    const stride = Math.max(1, Math.floor(pos.count / 2200));
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      pts.push(v.x, v.y, v.z);
    }
  });
  const n = pts.length / 3;
  if (!n) return;
  const geo = new THREE.TetrahedronGeometry(1, 0);
  const im = new THREE.InstancedMesh(geo, shardMat, n);
  const scatter = new Float32Array(n * 3), rand = new Float32Array(n * 4);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    pv.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
    e.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28); q.setFromEuler(e);
    const s = 0.009 + Math.random() * 0.022; sv.set(s, s * (1 + Math.random() * 1.3), s);
    m4.compose(pv, q, sv); im.setMatrixAt(i, m4);
    const dir = pv.clone().sub(new THREE.Vector3(0, 0.95, 0)); dir.y *= 0.4; dir.normalize();
    const R = 0.7 + Math.random() * 2.0;
    scatter[i * 3] = pv.x + dir.x * R + (Math.random() - 0.5) * 0.7;
    scatter[i * 3 + 1] = pv.y + Math.abs(dir.y) * R + Math.random() * 1.4;
    scatter[i * 3 + 2] = pv.z + dir.z * R + (Math.random() - 0.5) * 0.7;
    rand.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  }
  geo.setAttribute('aScatter', new THREE.InstancedBufferAttribute(scatter, 3));
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 4));
  im.frustumCulled = false;
  im.visible = false;
  scene.add(im);
  shards = im;
}

/* ---------------- figures ---------------- */
const GAP = 0.72;                 // half-distance between twins when split
const figA = new THREE.Group();   // human
const figB = new THREE.Group();   // digital twin
figA.visible = figB.visible = false;
scene.add(figA, figB);
let figureLoaded = false;
let modelHeight = 1.75;
let heart = null, core = null;    // the human heart / twin data core

/* the HUMAN: the BODY is the crystal — faceted like cut ice (flat shading
   turns every triangle into a tiny facet), deep glassy transmission, and the
   heart's warm blood-light suffusing the crystal from within */
/* chisel: quantize world-space normals in the fragment shader so the dense
   smooth mesh breaks into large flat gem facets — the body IS the crystal.
   (flatShading alone is invisible here: the GLB is too dense, its per-triangle
   facets are sub-pixel.) */
function chisel(mat, k = 3.0) {
  /* chains with any existing onBeforeCompile (e.g. the pulse wave) */
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh) => {
    if (prev) prev(sh);
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
       {
         vec3 wn = inverseTransformDirection(normal, viewMatrix);
         wn = normalize(floor(wn * ${k.toFixed(1)}) / ${k.toFixed(1)} + 1e-4);
         normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
       }`
    );
  };
}

/* the figures are museum-grade sculpted meshes now — smooth flowing glass,
   not faceted crystal. chisel() is retired for the bodies (the hard normal
   quantization read as low-poly); the premium is in polish: clearcoat,
   sheen, and the inner light. */
/* PULSE WAVE — one pulse, two bodies. With every lub-dub a band of light
   washes through the glass body, radiating from the heart's seat: the pulse
   itself made visible ("your pulse, your proof"). Injected as an emissive
   band in world-space distance from the heart — geometry-independent, so
   it flows down limbs and torso alike. */
function pulseWave(mat, tint) {
  const u = {
    uHeartW: { value: new THREE.Vector3(0, 1.27, 0) },
    uWaveR: { value: 0 },
    uWaveAmp: { value: 0 },
    uPulseTint: { value: new THREE.Color(tint) }
  };
  mat.userData.pulse = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPulseW;')
      .replace('#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvPulseW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vPulseW;\nuniform vec3 uHeartW;\nuniform float uWaveR;\nuniform float uWaveAmp;\nuniform vec3 uPulseTint;')
      .replace('#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float dP = distance(vPulseW, uHeartW);
          float band = exp(-pow((dP - uWaveR) * 4.0, 2.0));
          totalEmissiveRadiance += uPulseTint * band * uWaveAmp;
        }`);
  };
}

const matHuman = iceMaterial();
matHuman.transmission = 0.34;          // translucent, but with enough body to hold colour + form
matHuman.roughness = 0.18;
matHuman.ior = 1.4;
matHuman.thickness = 1.5;
matHuman.attenuationColor = new THREE.Color(0xcf7f78);   // warm blood in the depths — the living human
matHuman.attenuationDistance = 0.6;                      // short light-path → saturated inner colour, not milk
matHuman.envMapIntensity = 0.5;        // THE milk fix: stop the blown sky washing every surface white
matHuman.specularIntensity = 0.5;
matHuman.clearcoat = 0.55;
matHuman.clearcoatRoughness = 0.4;     // soften the hot clearcoat speculars
matHuman.iridescence = 0.3;
matHuman.color = new THREE.Color(0x9db1c6);   // deeper cool ice so the silhouette reads against the snow
matHuman.sheen = 0.5;
matHuman.sheenColor = new THREE.Color(0xffd2bd);
matHuman.emissive = new THREE.Color(0x3a1f24);  // the inner warmth stays — glow retained
matHuman.emissiveIntensity = 0.16;

/* the DIGITAL TWIN: the same premium crystal, cast in gold — the sovereign's
   precious double. Platinum ice skin, molten gold burning in the depths; the
   colour of the inner light is what tells the twins apart: blood vs bullion. */
/* the twin is CUT, not cast — where the human is smooth living glass, the
   twin is faceted gold CRYSTAL: hard gem planes (world-space chisel),
   sharp clearcoat, iridescent glints. The digital copy is a jewel of the
   original. */
const matTwin = iceMaterial();
/* the twin is SOLID cut gold — no transmission. The transmissive path
   sampled a buffer that intermittently (machine-state-sensitive, weeks of
   bisects: lights, sprites, passes, compile order) rendered BLACK, turning
   the whole figure into a silhouette; transmission=0 was the one state
   proven clean in every session. A struck coin is opaque anyway. */
matTwin.transmission = 0;
matTwin.roughness = 0.1;
matTwin.ior = 1.45;
matTwin.thickness = 1.5;
matTwin.attenuationColor = new THREE.Color(0xc9a35e);    // molten gold in the depths — saturated
matTwin.attenuationDistance = 0.5;
matTwin.envMapIntensity = 1.1;     /* the env carries the depth the glass used to */
matTwin.specularIntensity = 1.0;
matTwin.clearcoat = 0.9;
matTwin.clearcoatRoughness = 0.15;
matTwin.iridescence = 0.55;
matTwin.color = new THREE.Color(0xd09f4e);    /* struck-coin GOLD — the jury read the old
                                                 champagne 0xc2b294 as tan clay; this sits on
                                                 the ratified #c9974a with luminance to survive
                                                 the transmission wash */
matTwin.specularColor = new THREE.Color(0xffd9a0);   // warm gold speculars, not white plastic
matTwin.sheen = 0.6;
matTwin.sheenColor = new THREE.Color(0xf3ddae);          // gold sheen skimming the facets
matTwin.emissive = new THREE.Color(0x453312);
matTwin.emissiveIntensity = 0.38;  /* inner warmth the transmitted gold used to carry */

/* the twin's golden receive-wave (the human keeps only the chest-top
   heartbeat — its wave stays wired but silent, amp 0 in the drive) */
pulseWave(matHuman, 0xff5a3a);
pulseWave(matTwin, 0xffb44e);
/* the CUT: gem facets on the twin only — chained after the pulse wave */
chisel(matTwin, 3.0);

function fitInto(gltf, group, mat, mirror) {
  const src = gltf.scene;
  const box = new THREE.Box3().setFromObject(src);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const s = 1.75 / (size.y || 1);
  modelHeight = size.y * s;
  src.traverse(o => { if (o.isMesh) { o.material = mat; o.castShadow = false; o.geometry.computeVertexNormals(); } });
  src.scale.setScalar(s);
  src.position.set(-center.x * s, -box.min.y * s, -center.z * s);
  group.add(src);
  if (mirror) group.scale.x = -1;
}

const loader = new GLTFLoader();
let loadedA = false, loadedB = false;
const markLoaded = () => {
  if (loadedA && loadedB) {
    figureLoaded = true;
    /* pre-link the figure programs NOW (the twin's chisel+pulse chain is a
       distinct program from the human's) — otherwise the twin's shader
       links on its first visible frame, which can paint black for a beat
       under load (seen once after a scroll-restoring reload) */
    try { renderer.compile(scene, camera); } catch (_) { /* never fatal */ }
  }
};
/* the human is the hand-on-heart hero; the twin is the open-palm A-pose.
   Museum-grade meshes first; if either is missing, the original sculpts
   step back in (never a blank stage).
   The HUMAN wears the cool ice with warm blood-light in the depths; the
   DIGITAL twin wears the champagne gold (the struck coin). The red heart
   stays with the human, the gold signal core with the twin. */
/* ONE fetch, two bodies: the twin is CAST FROM the human — the same sculpted
   mesh, cloned (clone shares BufferGeometry: one parse, one GPU upload),
   mirrored, struck in gold. (The separate twin mesh read female; a digital
   twin of this human must read as HIM.) Per-figure GLB fallbacks remain. */
loader.load('assets/models/human-hd.glb',
  (g) => {
    const twinScene = g.scene.clone(true);      // clone BEFORE fitInto reparents the original
    fitInto(g, figA, matHuman, false); figA.visible = true; buildShards(figA); loadedA = true; markLoaded();
    fitInto({ scene: twinScene }, figB, matTwin, true); loadedB = true; markLoaded();
  },
  undefined,
  () => {
    loader.load('assets/models/hero.glb',
      (g) => { fitInto(g, figA, matHuman, false); figA.visible = true; buildShards(figA); loadedA = true; markLoaded(); },
      undefined, (err) => console.warn('hero.glb:', err?.message || err));
    loader.load('assets/models/twin.glb',
      (g) => { fitInto(g, figB, matTwin, true); loadedB = true; markLoaded(); },
      undefined, (err) => console.warn('twin.glb:', err?.message || err));
  });

{
  /* ONE PULSE, TWO BODIES — no gems, no geometry. Each chest holds a heart
     of pure LIGHT: a bright asymmetric double-nucleus (organic, faintly
     anatomical) inside a deeper halo. The human's burns blood-red and
     LAUNCHES a visible pulse-wave through the glass with every lub-dub;
     the twin's is an exact GOLDEN MIRROR beating ~0.22s later — the twin
     has no heart of its own; it carries yours, received as light. */
  const lightHeart = (fig, hot, cold, lightColor) => {
    const g = new THREE.Group();
    const nucMat = new THREE.SpriteMaterial({
      map: glowTexture(hot, cold),
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.8
    });
    const nucleus = new THREE.Sprite(nucMat);
    nucleus.position.set(-0.012, 0.008, 0);
    nucleus.scale.setScalar(0.085);
    /* the second "lobe" blob is RETIRED: under a load-order race that one
       sprite rasterized as a giant solid-black disc over the twin's chest
       (proven by object-level bisect — hiding it alone healed the frame;
       the shared material and the nucleus were innocent). The nucleus +
       halo carry the anatomy; a dummy keeps the drive's scale writes. */
    const lobe = new THREE.Object3D();
    lobe.position.set(0.017, -0.013, 0);
    lobe.scale.setScalar(0.055);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(hot.replace('1)', '0.95)'), cold),
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.4
    }));
    halo.scale.setScalar(0.22);
    /* THE ROOT of the intermittent black twin, finally: these chest lights
       used to live INSIDE the visibility-toggled figures, so the visible
       light count changed mid-session (the exact gotcha this project
       already codified for the cavern) — and the twin's transmissive body
       renders BLACK whenever its program binds the wrong lights state.
       The lights now live at SCENE level (count constant forever, zero
       recompiles); the drive steers them to the chests each frame. */
    /* tight falloff: at distance 2.6 the red ran down the flank and forearm
       and read as a wound — the light dies within the torso now, the sprite
       halo carries the visible glow (jury round 10) */
    const light = new THREE.PointLight(lightColor, 0.32, 1.35, 2.5);
    light.position.set(0.03, 1.27, 0.02);
    scene.add(light);
    nucleus.renderOrder = 12; lobe.renderOrder = 12; halo.renderOrder = 11;
    g.add(nucleus, lobe, halo);
    g.position.set(0.03, 1.27, 0.02);
    fig.add(g);
    return { nucMat, nucleus, lobe, halo, light };
  };
  heart = lightHeart(figA, 'rgba(255,96,64,1)', 'rgba(255,52,24,0)', 0xff4a2a);
  core = lightHeart(figB, 'rgba(255,182,66,1)', 'rgba(255,150,30,0)', 0xffa53c);
}

/* heartbeat: two-bump "lub-dub" cycle */
function heartbeat(t) {
  const c = (t % 1.15) / 1.15;
  const lub = Math.exp(-Math.pow((c - 0.10) / 0.045, 2));
  const dub = 0.55 * Math.exp(-Math.pow((c - 0.30) / 0.06, 2));
  return lub + dub;
}

/* (the twin's separate "signal beat" is retired — one pulse, two bodies:
   the twin's golden heart is heartbeat(t - 0.22), the human's own beat
   received as light across the link.) */

/* faint ground-glow rings (pedestal) */
const ringMat = new THREE.MeshBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
const rings = [];
for (let i = 0; i < 3; i++) {
  const r = new THREE.Mesh(new THREE.RingGeometry(0.9 + i * 0.5, 0.92 + i * 0.5, 96), ringMat.clone());
  r.rotation.x = -Math.PI / 2;
  r.position.y = 0.02;
  scene.add(r);
  rings.push(r);
}

/* authorization shockwave — warm rings that roll out across the ice from the
   human's heart when the sovereign identity signs (the one red, radiating) */
const shocks = [];
for (let i = 0; i < 2; i++) {
  const s = new THREE.Mesh(
    new THREE.RingGeometry(0.965, 1.0, 128),
    new THREE.MeshBasicMaterial({ color: 0xff7a5c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  );
  s.rotation.x = -Math.PI / 2;
  s.position.y = 0.04;
  s.visible = false;
  scene.add(s);
  shocks.push(s);
}

/* ---------------- The Centennial Vault — one human's sovereign seal ------
   Between the twins a MONOLITH of void-black crystal calves up through the
   ice — cut in the same facet language as the twins' own bodies, but struck
   from night: deep obsidian glass, its fracture lines sealed with veins of
   living gold that pulse to the owner's heartbeat (kintsugi — a life's
   fractures, mended in gold). A brushed-platinum band girdles its waist; a
   platinum seal ring lies in the ice at its base, engraved with the vow.
   Deep inside, the owner's warm-red heart goes on beating. This is not an
   object between the twins — it is the one thing the human OWNS outright:
   their intent, under their key alone, held for a hundred years. */
const vault = new THREE.Group();
vault.visible = false;
let armVaultCube = null;   // set inside the block below; fired by update() past p 0.5
let monoGeo = null;   // the hewn geometry — the crystal veins seed on its real surface
{
  /* THE MONOLITH — a stretched icosahedral shard, every vertex displaced by
     a deterministic hash so shared corners stay welded and every triangle
     becomes a hard hewn facet (non-indexed = true flat shading) */
  const h3 = (x, y, z) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return n - Math.floor(n);
  };
  /* subdivision 2 (320 facets) with TWO octaves of displacement — a large
     calved form carrying a fine vocabulary of chips and cleaves. Keyed to the
     unit-sphere position so shared corners stay welded (watertight). */
  monoGeo = new THREE.BoxGeometry(1.24, 1.16, 1.1).toNonIndexed();
  {
    const pos = monoGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      /* a whisper of per-corner hash so the six faces never mirror the sky
         as one dead-flat slab — a hewn block of glacier ice, not a glass die.
         A CUBE now (matching the finale film), not the calved shard. */
      const j = 1 + (h3(+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)) - 0.5) * 0.05;
      pos.setXYZ(i, v.x * j, v.y * j, v.z * j);
    }
    monoGeo.computeVertexNormals();   // flat facets — the chisel is in the geometry
    /* per-FACET tonal jitter (all three verts of a face share one value):
       hewn ice never reflects evenly — without this the facets mirror the
       sky uniformly and the whole mass reads as brushed aluminium */
    const col = new Float32Array(pos.count * 3);
    for (let f = 0; f < pos.count; f += 3) {
      const t = 0.9 + h3(f * 0.618, 1.7, 3.9) * 0.2;                   // 0.90..1.10 — variety, kept luminous
      const b = t * (0.99 + h3(f * 0.213, 7.7, 1.1) * 0.04);           // a whisper of blue variance
      for (let k = 0; k < 3; k++) {
        col[(f + k) * 3] = t * 0.97; col[(f + k) * 3 + 1] = t; col[(f + k) * 3 + 2] = b;
      }
    }
    monoGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  /* FROSTED GLACIAL ICE — clear crystal, not black stone. High transmission so
     the internal frost and the amber heart read THROUGH the mass; a frost macro
     drives the ROUGHNESS map so dendrite areas go matte-white while the clear
     channels stay glassy — frost baked into the ice, so the cube has presence
     against the bright snow instead of vanishing into it. */
  const frostTex = texLoader.load('assets/env/vault-frost.jpg',
    () => { if (vault.userData) vault.userData.veinsReady = true; },
    undefined,
    () => texLoader.load('assets/env/frost.jpg', (t) => {
      frostTex.image = t.image; frostTex.needsUpdate = true;
      if (vault.userData) vault.userData.veinsReady = true;
    }));
  frostTex.colorSpace = THREE.SRGBColorSpace;
  frostTex.wrapS = frostTex.wrapT = THREE.RepeatWrapping;
  frostTex.repeat.set(1.5, 1.5);                        // finer dendrite lace across the faces
  const iceMat = new THREE.MeshPhysicalMaterial({
    color: 0xeef4fb, metalness: 0.0, roughness: 0.44,
    vertexColors: true,
    roughnessMap: frostTex,                             // frost dendrites go matte; clear channels stay see-through
    transmission: 0.85, thickness: 0.75, ior: 1.31,     // translucent frosted crystal — the gem reads inside
    attenuationColor: new THREE.Color(0xf3ead9), attenuationDistance: 1.3,  // the amber core warms the depths
    clearcoat: 1.0, clearcoatRoughness: 0.14,           // wet-ice skin
    sheen: 0.35, sheenColor: new THREE.Color(0xe4f0ff), sheenRoughness: 0.55,
    iridescence: 0.18, iridescenceIOR: 1.3,
    specularIntensity: 1.0, envMapIntensity: 0.95,
    emissive: new THREE.Color(0xffb060), emissiveIntensity: 0,  // the sealed heart's warmth, gated in update
    transparent: true
  });
  texLoader.load('assets/env/ice-macro.jpg', (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1.6, 1.6);
    iceMat.bumpMap = t; iceMat.bumpScale = 0.02;        // frosted-glass surface relief
    iceMat.needsUpdate = true;
  });
  const block = new THREE.Mesh(monoGeo, iceMat);
  block.position.y = 1.32;            // cube centred on the heart — floats between the twins
  block.rotation.y = 0.42;            // a three-quarter view, one edge toward camera
  block.rotation.z = 0;               // upright — a clear die of ice, not a calved lean

  /* the INNER CORE — a ghost of the monolith suspended inside itself: a
     second, smaller hewn form whose additive edges read as deep internal
     structure whenever the camera moves (real depth, not a decal) */
  const coreGeo = monoGeo.clone();
  const coreEdgeMat = new THREE.LineBasicMaterial({
    color: 0xffd9a0, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const core2 = new THREE.LineSegments(new THREE.EdgesGeometry(coreGeo, 24), coreEdgeMat);
  core2.scale.setScalar(0.55);
  core2.position.set(0.02, 1.32, 0);
  core2.rotation.y = 0.9;

  /* INTERNAL LIGHT SHAFTS — three tall additive blades rising from the base
     through the heart: molten gold light living inside the black glass */
  const shaftMats = [];
  const shaftGroup = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshBasicMaterial({
      map: glowTexture('rgba(255,196,110,0.55)', 'rgba(255,196,110,0)'),
      transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    const blade = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 2.3), m);
    blade.position.set((i - 1) * 0.08, 1.22, (i - 1) * -0.05);
    blade.rotation.y = 0.5 + i * 1.05;
    shaftGroup.add(blade);
    shaftMats.push(m);
  }

  /* FLOATING MICRO-SLIVERS — a slow orbit of solid-gold flecks circling the
     monument like a court, catching the low sun (instanced, one draw call) */
  const orbitMat = new THREE.MeshPhysicalMaterial({
    color: 0xffc978, metalness: 1.0, roughness: 0.24,
    clearcoat: 0.5, clearcoatRoughness: 0.2,
    emissive: new THREE.Color(0x7a4d0e), emissiveIntensity: 0.35,
    envMapIntensity: 1.7, transparent: true, opacity: 0, depthWrite: false
  });
  const ORBITERS = 22;
  const orbit = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), orbitMat, ORBITERS);
  orbit.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  orbit.frustumCulled = false;
  const orbitData = [];
  {
    let s2 = 41;
    const rnd2 = () => { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
    for (let i = 0; i < ORBITERS; i++) {
      orbitData.push({
        /* the court stays INSIDE the figures' ring (they stand at ±0.92) —
           a sliver drifting across a sovereign's face breaks the ceremony */
        r: 0.6 + rnd2() * 0.26,
        y: 0.45 + rnd2() * 1.9,
        a0: rnd2() * Math.PI * 2,
        sp: 0.05 + rnd2() * 0.075,           // slow — a monument's court, not a swarm
        bob: 0.5 + rnd2() * 1.2,
        s: 0.014 + rnd2() * 0.03,
        rx: rnd2() * Math.PI * 2, ry: rnd2() * Math.PI * 2
      });
    }
  }

  /* KINTSUGI SEAMS — the major facet ridges traced in gold (30° threshold —
     the great fracture lines of the mass, sealed and glowing, not a wireframe) */
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffc36b, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(monoGeo, 30), edgeMat);
  edges.position.copy(block.position);
  edges.rotation.copy(block.rotation);

  /* internal cleavage — two great fracture planes frozen inside the mass at
     odd angles (real glacier ice, not etched decoration). They catch the low
     sun as pale sheets when the camera moves. */
  const fracMat = new THREE.MeshPhysicalMaterial({
    color: 0xf5e2c4, metalness: 0, roughness: 0.55,
    transmission: 0.88, thickness: 0.1, ior: 1.28,
    transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide
  });
  const fracMatB = fracMat.clone();
  const fracA = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), fracMat);
  fracA.position.set(0.06, 1.4, 0.05); fracA.rotation.set(0.1, 0.9, 0.16);
  const fracB = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44), fracMatB);
  fracB.position.set(-0.07, 1.22, -0.05); fracB.rotation.set(-0.14, -0.55, -0.1);

  /* INTERNAL FROST — snowflake dendrites suspended inside the cube: a few
     small alpha-mapped planes (kept central + small so none projects past the
     silhouette). depthTest off so they read THROUGH the ice, giving the block
     the "frost etched inside" character of the finale film. */
  const frostGroup = new THREE.Group();
  const frostMats = [];
  const FROST_PLANES = [
    { p: [0.0, 1.42, 0.32], r: [0, 0, 0], s: 0.92 },
    { p: [0.05, 1.24, -0.3], r: [0, 0.5, 0], s: 0.9 },
    { p: [-0.28, 1.36, 0.05], r: [0.1, 1.1, 0.2], s: 0.86 },
    { p: [0.28, 1.3, -0.05], r: [0, -0.9, 0.1], s: 0.84 },
    { p: [0.02, 1.5, -0.05], r: [0.2, 0.2, 0.9], s: 0.8 },
    { p: [-0.05, 1.18, 0.1], r: [-0.2, 1.5, 0.4], s: 0.82 }
  ];
  for (const f of (isMobile ? [] : FROST_PLANES)) {
    /* mobile skips the etched-frost planes: depthTest-off quads idling at
       opacity 0 are exactly what the poisoned-program state paints as
       opaque black slabs over the figures (twice bisected to this block);
       at 375px the etching was sub-pixel anyway */
    const m = new THREE.MeshBasicMaterial({
      alphaMap: frostTex, color: 0xeaf4ff, transparent: true, opacity: 0,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide
    });
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(f.s, f.s), m);
    pl.position.set(...f.p); pl.rotation.set(...f.r);
    pl.renderOrder = 11;
    frostGroup.add(pl); frostMats.push(m);
  }

  /* THE HEART, SEALED RUBY — a faceted ruby jewel at the cube's centre,
     painted through the ice so it always glows within. The jury's ruling
     stands: the vault holds the HUMAN's heart, so the gem carries the one
     red — the gold stays on the frost glints, the band and the seal ring
     (the two accents separated, as the cavern film already proves). */
  const gemGeo = new THREE.IcosahedronGeometry(0.145, 0);
  const gemMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8233a, metalness: 0.15, roughness: 0.1,
    emissive: new THREE.Color(0xe01f2e), emissiveIntensity: 1.0,
    flatShading: true, envMapIntensity: 1.6,
    clearcoat: 0.7, clearcoatRoughness: 0.15,
    transparent: true, opacity: 0, depthTest: false
  });
  const hMesh = new THREE.Mesh(gemGeo, gemMat);
  hMesh.renderOrder = 12;
  hMesh.position.y = 1.32;            // chest height, deep in the monolith's core
  hMesh.rotation.x = 0.35;
  const gemEdgeMat = new THREE.LineBasicMaterial({
    color: 0xff8a76, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
  });
  const gemEdges = new THREE.LineSegments(new THREE.EdgesGeometry(gemGeo), gemEdgeMat);
  gemEdges.renderOrder = 13;
  hMesh.add(gemEdges);
  /* a tight, contained amber halo — the sealed heart's warmth, small (a broad
     warm-white sprite washes to a pale blob) */
  const hGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,84,60,0.95)', 'rgba(255,84,60,0)'),
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0
  }));
  hGlow.position.y = 1.32;
  hGlow.scale.setScalar(0.34); hGlow.renderOrder = 14;

  /* THE PLATINUM BAND — a brushed band girdling the shard's waist below the
     heart, with a gold hairline set into it: the vault is not raw geology,
     it is a KEPT object — banded, owned, maintained. Elliptical to match the
     shard's cross-section, tilted with its lean. */
  const bandMat = new THREE.MeshPhysicalMaterial({
    color: 0xb6bcc7, metalness: 1.0, roughness: 0.3,
    clearcoat: 0.6, clearcoatRoughness: 0.3,
    envMapIntensity: 1.15, transparent: true, opacity: 0
  });
  const goldLineMat = new THREE.MeshPhysicalMaterial({
    color: 0xffc873, metalness: 1.0, roughness: 0.2,
    emissive: new THREE.Color(0x8a5a12), emissiveIntensity: 0.4,
    envMapIntensity: 1.6, transparent: true, opacity: 0
  });
  /* (a floating waist band was tried and cut — a calved shard has no true
     centreline, so any ring reads as a hovering hoop. All the metalwork
     lives at the base instead: the object is JEWELLED where it is HELD.) */

  /* THE SEAL PLINTH — a low platinum ring the monolith stands in, its outer
     wall engraved with the owner's vow (readable from the level camera —
     a flat ground ring would foreshorten to nothing). This is the signature
     detail: the vault belongs to SOMEONE, and their vow is struck in metal. */
  const sealCanvas = document.createElement('canvas');
  sealCanvas.width = 2048; sealCanvas.height = 128;
  const sealTex = new THREE.CanvasTexture(sealCanvas);
  sealTex.colorSpace = THREE.SRGBColorSpace;
  sealTex.anisotropy = 8;
  sealTex.wrapS = THREE.RepeatWrapping;
  /* the brushed-platinum strip is pre-rendered once; the vow layer redraws
     over it live — it re-renders letter by letter when the visitor SEALS
     THEIR OWN NAME into the ring */
  const sealBg = document.createElement('canvas');
  sealBg.width = 2048; sealBg.height = 128;
  {
    const g = sealBg.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0, '#c6ccd6'); grad.addColorStop(0.45, '#e2e6ec');
    grad.addColorStop(0.75, '#aab0bb'); grad.addColorStop(1, '#8f95a1');
    g.fillStyle = grad; g.fillRect(0, 0, 2048, 128);
    g.globalAlpha = 0.14;
    for (let y = 2; y < 126; y += 2.5) {
      g.strokeStyle = (y % 5 < 2.5) ? '#7e8590' : '#f2f4f8';
      g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(0, y); g.lineTo(2048, y); g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#c9974a';
    g.fillRect(0, 0, 2048, 5); g.fillRect(0, 123, 2048, 5);
  }
  const vowFor = (name) => name
    ? `SEALED FOR ${name} · ONE HUMAN · ONE TWIN · EVERY AGENT ACCOUNTABLE · 2026—2126 · `
    : 'ONE HUMAN · ONE TWIN · EVERY AGENT ACCOUNTABLE · SEALED 2026—2126 · ';
  /* one vow, scaled to span the strip exactly (seamless wrap, no clipped or
     doubled characters). struck/hot drive the live engraving: chars < struck
     are cut; the char at hot glows gold-bright as the punch lands. */
  const drawSealStrip = (text, struck = Infinity, hot = -1) => {
    const g = sealCanvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, 2048, 128);
    g.drawImage(sealBg, 0, 0);
    g.font = '600 42px "IBM Plex Mono", monospace';
    g.textBaseline = 'middle';
    const vowW = g.measureText(text).width;
    g.save();
    g.scale(2048 / vowW, 1);
    let x = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (i < struck) {
        /* engraved: dark cut + light lower bevel; interpuncts struck in gold */
        g.fillStyle = 'rgba(250,252,255,0.55)';
        g.fillText(ch, x, 68);
        g.fillStyle = ch === '·' ? '#a5741f' : '#4d525c';
        g.fillText(ch, x, 66);
      } else if (i === hot) {
        g.shadowColor = '#ffc36b'; g.shadowBlur = 16;
        g.fillStyle = '#e8b45a';
        g.fillText(ch, x, 66);
        g.shadowBlur = 0;
      }
      x += g.measureText(ch).width;
    }
    g.restore();
    sealTex.needsUpdate = true;
  };
  drawSealStrip(vowFor(null));
  const sealMat = new THREE.MeshPhysicalMaterial({
    map: sealTex, metalness: 0.9, roughness: 0.34,
    envMapIntensity: 1.1, transparent: true, opacity: 0
  });
  const sealRing = new THREE.Group();
  {
    /* engraved outer wall + platinum top cap + a gold inlay ring set into
       the cap — the one line of gold in the metal, carrying the pulse */
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.84, 0.11, 96, 1, true), sealMat);
    wall.position.y = 0.055;
    const cap = new THREE.Mesh(new THREE.RingGeometry(0.60, 0.82, 96), bandMat);
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = 0.111;
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(0.71, 0.008, 8, 96), goldLineMat);
    inlay.rotation.x = Math.PI / 2;
    inlay.position.y = 0.112;
    sealRing.add(wall, cap, inlay);
  }

  /* GOLD MOTES — a whisper of gold dust rising around the vault while it
     stands: tiny additive points drifting upward, reborn at the base */
  const MOTES = 42;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(MOTES * 3);
  const moteSeed = new Float32Array(MOTES);
  {
    let ms = 97;
    const mrnd = () => { ms = (ms * 16807) % 2147483647; return ms / 2147483647; };
    for (let i = 0; i < MOTES; i++) {
      const a = mrnd() * Math.PI * 2, r = 0.35 + mrnd() * 0.55;
      motePos[i * 3] = Math.cos(a) * r;
      motePos[i * 3 + 1] = mrnd() * 2.6;
      motePos[i * 3 + 2] = Math.sin(a) * r;
      moteSeed[i] = mrnd();
    }
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.PointsMaterial({
    color: 0xffcf86, size: 0.016, sizeAttenuation: true,
    map: glowTexture('rgba(255,205,130,1)', 'rgba(255,205,130,0)'),
    transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;

  vault.add(block, edges, core2, shaftGroup, orbit, fracA, fracB, frostGroup, hMesh, hGlow,
            sealRing, motes);
  vault.userData = {
    iceMat, edgeMat, fracMat, fracMatB, frostMats, hMesh, hGlow, gemMat, gemEdgeMat,
    coreEdgeMat, shaftMats, orbit, orbitMat, orbitData, orbitDummy: new THREE.Object3D(),
    bandMat, goldLineMat, sealMat, moteMat, motePos, moteSeed, moteGeo,
    veinsReady: false, hdMats: null, engraveSurge: 0
  };

  /* CLAIM YOUR VAULT — the live engraving API. main.js owns the input UX;
     this strikes the letters into the platinum one by one, each glowing
     gold-hot as the punch lands, the inlay ring surging under it. The
     signature moment: the vault belongs to someone, BY NAME. */
  window.VAULT = {
    engrave(name, instant) {
      const text = vowFor(name);
      if (instant || REDUCED) { drawSealStrip(text); return; }
      const t0 = performance.now(), PER = 42;          // ms per letter-strike
      const tick = () => {
        const k = Math.min(text.length, Math.floor((performance.now() - t0) / PER));
        drawSealStrip(text, k, k < text.length ? k : -1);
        vault.userData.engraveSurge = 1;
        if (k < text.length) requestAnimationFrame(tick);
      };
      tick();
    }
  };

  /* THE REAL TRANSPARENT CUBE — the exact Higgsfield render, background
     removed to a clean cutout, composited as a camera-facing billboard. A 3D
     mesh is always SOLID; only the render carries the true glass transparency,
     the internal snowflake frost and the glowing amber gem. The finale film
     picks up the very same cube in macro, so the hand-off is seamless. The
     procedural cube stays as the fallback if the PNG ever fails (never an
     empty pedestal). */
  /* LAZY: the billboard is invisible until p≈0.86, so its texture must not
     compete with the pano/GLB/fonts at first paint — update() arms this the
     first time the visitor passes the midpoint (same policy as vaultfilm).
     WebP (110KB) first, the PNG (1.7MB) as fallback. */
  const applyCube = (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    const cubeMat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0,
      /* a red-ward tint pulls the render's baked amber gem toward the
         heart it becomes — the MacGuffin must not change color across
         the breach */
      color: new THREE.Color(1.0, 0.87, 0.83),
      depthTest: false, depthWrite: false
    });
    const cubeSprite = new THREE.Sprite(cubeMat);
    cubeSprite.scale.set(1.5, 1.5, 1);          // sized to sit clear of both figures (±0.92)
    cubeSprite.position.set(0, 1.28, 0);        // centred between the twins, on the heart line
    cubeSprite.renderOrder = 10;
    vault.add(cubeSprite);
    /* retire every procedural + solid mesh — the render IS the cube now, and
       its amber gem glows in the render itself (hide the procedural gem too). */
    block.visible = edges.visible = core2.visible = false;
    fracA.visible = fracB.visible = false;
    frostGroup.visible = shaftGroup.visible = false;
    hMesh.visible = hGlow.visible = false;
    vault.userData.cubeSpriteMat = cubeMat;
  };
  armVaultCube = () => texLoader.load('assets/env/vault-cube-cutout.webp', applyCube,
    undefined,
    () => texLoader.load('assets/env/vault-cube-cutout.png', applyCube,
      undefined, () => { /* missing — keep the procedural cube */ }));
}
scene.add(vault);

/* the vault's light-threads — a dedicated overlay canvas (the auth canvas
   zeroes its own opacity outside the auth beat, so it can't be shared) */
const vaultFx = document.createElement('canvas');
vaultFx.id = 'vaultfx';
vaultFx.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:32;pointer-events:none;opacity:0;';
document.body.appendChild(vaultFx);
const vaultFxCtx = vaultFx.getContext('2d');

/* THE VOW, STANDING WITH ITS SUBJECTS — as the vault rises, the three
   phrases of the vow land in the world, each at the feet of the being it
   names: ONE HUMAN under the human, ONE TWIN under the twin, EVERY AGENT
   ACCOUNTABLE beneath the vault between them. They clear before the finale
   title card repeats the same line at full voice — a promise made in the
   world, then spoken to the visitor. */
const sovWords = [
  { text: 'ONE HUMAN.', at: 0.30, close: false },
  { text: 'ONE TWIN.', at: 0.55, close: false },
  { text: 'EVERY AGENT ACCOUNTABLE.', at: 0.80, close: true }
].map((d) => {
  const el = document.createElement('div');
  el.className = 'sov-word' + (d.close ? ' sov-word-close' : '');
  el.textContent = d.text;
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  return { el, at: d.at };
});

/* the CLAIM invitation — surfaces while the vault stands, until it's owned */
const claimCta = document.getElementById('claim-cta');

/* GOLD ACCRETION — the igloo.inc growth signature, recast: molten-gold
   nuggets accrete in veins over the black mass as the vault forms — the
   kintsugi visibly SEALING itself instead of fading in. One InstancedMesh
   (single draw call), deterministic seeded walk. */
const vaultCrystals = (() => {
  const VEINS = 8, PER = 12, COUNT = VEINS * PER;
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffd9a0, metalness: 0.95, roughness: 0.26,
    emissive: new THREE.Color(0x8a5a12), emissiveIntensity: 0.4,
    clearcoat: 0.5, clearcoatRoughness: 0.22,
    envMapIntensity: 1.6, transparent: true, opacity: 0, depthWrite: false
  });
  const inst = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), mat, COUNT);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.frustumCulled = false;
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  /* seed each vein on a real triangle of the hewn monolith: centroid + face
     normal, transformed by the block's seat (y 1.18, ry 0.32, rz 0.035) */
  const pos = monoGeo.attributes.position, nrm = monoGeo.attributes.normal;
  const triCount = pos.count / 3;
  const _e = new THREE.Euler(0, 0.32, 0.035);
  const _q = new THREE.Quaternion().setFromEuler(_e);
  const _p = new THREE.Vector3(), _n = new THREE.Vector3();
  const data = [];
  for (let v = 0; v < VEINS; v++) {
    const tri = (rnd() * triCount) | 0;
    _p.set(0, 0, 0); _n.set(0, 0, 0);
    for (let k = 0; k < 3; k++) {
      _p.x += pos.getX(tri * 3 + k) / 3; _p.y += pos.getY(tri * 3 + k) / 3; _p.z += pos.getZ(tri * 3 + k) / 3;
      _n.x += nrm.getX(tri * 3 + k); _n.y += nrm.getY(tri * 3 + k); _n.z += nrm.getZ(tri * 3 + k);
    }
    _n.normalize();
    let px = _p.x, py = _p.y, pz = _p.z;
    const nx = _n.x, ny = _n.y, nz = _n.z;
    for (let i = 0; i < PER; i++) {
      const f = i / (PER - 1);
      /* walk outward along the facet normal with sideways drift — a frost vein */
      const wob = 0.045 * (1 + f);
      px += nx * 0.03 * f + (rnd() * 2 - 1) * wob * (1 - Math.abs(nx));
      py += ny * 0.03 * f + (rnd() * 2 - 1) * wob * (1 - Math.abs(ny));
      pz += nz * 0.03 * f + (rnd() * 2 - 1) * wob * (1 - Math.abs(nz));
      _p.set(px, py, pz).applyQuaternion(_q);                   // into the monolith's seat
      data.push({
        x: _p.x, y: _p.y + 1.18, z: _p.z,
        s: (0.07 - f * 0.045) * (0.7 + 0.6 * rnd()),
        qx: rnd() * Math.PI * 2, qy: rnd() * Math.PI * 2,
        order: v / VEINS * 0.35 + f * 0.65                       // veins overlap as they spread
      });
    }
  }
  vault.add(inst);
  return { inst, mat, data, dummy: new THREE.Object3D() };
})();

/* the heart's warmth leaking out of the ice onto the twins and the snow —
   the one warm light held in the scene */
/* the heart's radiance — seated AT the gem, falloff contained INSIDE the
   monolith so the warmth reads as a glowing core, never a splash on one
   facet edge (the driver tracks it up the rise) */
const quantumLight = new THREE.PointLight(0xff9440, 0, 2.2, 2);
quantumLight.position.set(0, 1.32, 0);
scene.add(quantumLight);

/* ---------------- explore blocks (igloo portfolio pattern) ----------------
   After the deconstruction, the shard cloud settles into five great ice
   blocks — the five facets of the protocol. Hover shows telemetry,
   click opens the facet's detail page. */
const FACETS = [
  { name: 'PRESENCE',   slug: 'presence',   temp: '-42.1°C', code: 'FCT_01' },
  { name: 'INTENT',     slug: 'intent',     temp: '-38.6°C', code: 'FCT_02' },
  { name: 'CUSTODY',    slug: 'custody',    temp: '-45.9°C', code: 'FCT_03' },
  { name: 'CIPHER',     slug: 'cipher',     temp: '-51.3°C', code: 'FCT_04' },
  { name: 'CONTINUITY', slug: 'continuity', temp: '-40.7°C', code: 'FCT_05' }
];
const blockGroup = new THREE.Group();
blockGroup.visible = false;
scene.add(blockGroup);
const RING_R = 2.35;                       // the facets orbit the human at this radius

/* meaningful crystalline emblems — one sculpted form per facet of the
   protocol, hewn in the same ice language as the gems:
   PRESENCE   — a beacon: two interlocked halo rings around a living orb
   INTENT     — a compass dart: direction, meant and signed
   CUSTODY    — the key, held by no one but the human
   CIPHER     — a crystal lattice (lattice cryptography, literally)
   CONTINUITY — an hourglass that never runs out: a century, held */
function facetEmblem(i) {
  const group = new THREE.Group();
  const mats = [], edgeMats = [];
  const solid = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, flat = false) => {
    const m = iceMaterial();
    /* denser hewn ice — the emblems must carry real weight against the
       bright fog, not read as ghosts: less transmission, darker body */
    m.color = new THREE.Color(0x9db0c2);
    /* transmission RETIRED — the same poisoned-buffer class that blacked the
       twin rendered one emblem as a solid black slab over the figures on
       mobile; opaque hewn ice with an emissive floor can never go black */
    m.transmission = 0;
    m.thickness = 0.9;
    m.attenuationColor = new THREE.Color(0x3e5570);
    m.roughness = 0.24;
    m.envMapIntensity = 1.15;
    m.emissive = new THREE.Color(0x1a242e);
    m.emissiveIntensity = 0.5;
    if (flat) m.flatShading = true;
    m.opacity = 0;
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz);
    group.add(mesh); mats.push(m);
    return mesh;
  };
  const edge = (mesh) => {
    const em = new THREE.LineBasicMaterial({
      color: 0xe8f3ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), em);
    l.position.copy(mesh.position); l.rotation.copy(mesh.rotation);
    group.add(l); edgeMats.push(em);
    return mesh;
  };
  if (i === 0) {          // PRESENCE — the beacon
    solid(new THREE.TorusGeometry(0.23, 0.02, 10, 48), 0, 0, 0, 0.12);
    solid(new THREE.TorusGeometry(0.15, 0.016, 10, 40), 0, 0, 0, Math.PI / 2.3, 0.4);
    edge(solid(new THREE.IcosahedronGeometry(0.065, 0), 0, 0, 0, 0, 0, 0, true));
  } else if (i === 1) {   // INTENT — the compass dart
    edge(solid(new THREE.ConeGeometry(0.11, 0.56, 4), 0.28, 0, 0, 0, 0, -Math.PI / 2, true));
    edge(solid(new THREE.ConeGeometry(0.11, 0.24, 4), -0.12, 0, 0, 0, 0, Math.PI / 2, true));
    solid(new THREE.TorusGeometry(0.10, 0.016, 8, 28), 0, 0, 0, 0, Math.PI / 2);
  } else if (i === 2) {   // CUSTODY — the key
    solid(new THREE.TorusGeometry(0.13, 0.034, 10, 32), 0, 0.30, 0);
    solid(new THREE.CylinderGeometry(0.036, 0.036, 0.55, 10), 0, -0.02, 0);
    edge(solid(new THREE.BoxGeometry(0.16, 0.05, 0.05), 0.10, -0.16, 0));
    edge(solid(new THREE.BoxGeometry(0.12, 0.05, 0.05), 0.08, -0.26, 0));
    group.rotation.z = -0.18;
  } else if (i === 3) {   // CIPHER — the crystal lattice
    const s = 0.26, corners = [];
    for (const sx of [-s, s]) for (const sy of [-s, s]) for (const sz of [-s, s]) corners.push([sx, sy, sz]);
    for (const [x, y, z] of corners) solid(new THREE.OctahedronGeometry(0.05, 0), x, y, z, 0, 0, 0, true);
    solid(new THREE.OctahedronGeometry(0.075, 0), 0, 0, 0, 0, 0, 0, true);  // the secret at the centre
    const pts = [];
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
      const d = (corners[a][0] !== corners[b][0]) + (corners[a][1] !== corners[b][1]) + (corners[a][2] !== corners[b][2]);
      if (d === 1) pts.push(...corners[a], ...corners[b]);   // the 12 cube bonds
    }
    for (const c of corners) pts.push(0, 0, 0, ...c);        // bonds to the secret
    const latGeo = new THREE.BufferGeometry();
    latGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const em = new THREE.LineBasicMaterial({
      color: 0xe8f3ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    group.add(new THREE.LineSegments(latGeo, em)); edgeMats.push(em);
  } else {                // CONTINUITY — the hourglass
    edge(solid(new THREE.ConeGeometry(0.20, 0.30, 20), 0, 0.16, 0, Math.PI));
    edge(solid(new THREE.ConeGeometry(0.20, 0.30, 20), 0, -0.16, 0));
    solid(new THREE.CylinderGeometry(0.23, 0.23, 0.024, 24), 0, 0.325, 0);
    solid(new THREE.CylinderGeometry(0.23, 0.23, 0.024, 24), 0, -0.325, 0);
  }
  return { group, mats, edgeMats };
}

const exploreBlocks = FACETS.map((f, i) => {
  const { group: mesh, mats, edgeMats } = facetEmblem(i);
  /* evenly spaced on a ring AROUND the twins, at varied heights */
  const ang = (i / FACETS.length) * Math.PI * 2;
  const ringY = 1.15 + Math.sin(i * 1.7) * 0.45;
  mesh.position.set(Math.cos(ang) * RING_R, ringY, Math.sin(ang) * RING_R);
  mesh.rotation.y = i * 0.9;
  blockGroup.add(mesh);

  /* inner glow — the block holds a spark of the protocol */
  const spark = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(214,235,255,0.9)', 'rgba(214,235,255,0)'),
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0
  }));
  spark.scale.setScalar(0.5);
  spark.position.copy(mesh.position);
  blockGroup.add(spark);

  /* DOM telemetry label — resting shows only the facet code, quiet;
     hover expands into the full instrument card (igloo discipline) */
  const el = document.createElement('div');
  el.className = 'star-label block-label';
  el.innerHTML =
    `<span class="star-name">${f.code}<em class="fct-name"> — ${f.name}</em></span>` +
    `<span class="block-tel">TEMP ${f.temp} · D 2026</span>` +
    `<span class="star-tag">CLICK TO EXPLORE</span>`;
  document.body.appendChild(el);

  return { ...f, mesh, mats, edgeMats, spark, el, ang: (i / FACETS.length) * Math.PI * 2, ringY: mesh.position.y, seed: i * 1.37, sx: 0, sy: 0 };
});
let hoverBlock = -1, lastExplore = 0;

/* ---------------- authorized services (HUMAN-VERIFIED beat) --------------
   The verified human is the sovereign key: every daily application it touches
   is authenticated and authorized through it. Frosted monochrome app glyphs
   orbit the human and sign in one by one. NOT a sky galaxy — human-scale,
   grounded around the figure. The heart stays the only colour. */
const ICO = {
  chase:   '<svg viewBox="0 0 24 24" fill="none"><path d="M8.2 3h7.6l4.4 4.4v7.6l-4.4 4.4H8.2L3.8 15V7.4z" stroke="currentColor" stroke-width="1.5"/><rect x="9.4" y="9.4" width="5.2" height="5.2" rx="0.6" fill="currentColor"/></svg>',
  bofa:    '<svg viewBox="0 0 24 24" fill="none"><path d="M4 15.5c4-3.2 8.2 1 12.4-1.1l3.4-1.7-2 5.8C13.8 20 9.4 16 4.6 18z" fill="currentColor"/><path d="M4 9.5c4-3.2 8.2 1 12.4-1.1L19.8 6.7l-2 5.4C13.8 14 9.4 10 4.6 12z" fill="currentColor" opacity="0.5"/></svg>',
  stripe:  '<svg viewBox="0 0 24 24"><rect x="4" y="6.6" width="16" height="2.4" rx="1.2" fill="currentColor"/><rect x="4" y="10.8" width="10.5" height="2.4" rx="1.2" fill="currentColor" opacity="0.65"/><rect x="4" y="15" width="13.5" height="2.4" rx="1.2" fill="currentColor" opacity="0.85"/></svg>',
  calai:   '<svg viewBox="0 0 24 24"><path d="M12.4 3c1.1 3.1-2.1 4.2-2.1 7.2a2 2 0 004 0c0-1 .2-1.8 1-2.2 1 2 2.2 3.3 2.2 6.1a5.5 5.5 0 01-11 0c0-4.2 3.2-6.4 5.9-11.1z" fill="currentColor"/></svg>',
  equinox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 9v6M7 6.6v10.8M17 6.6v10.8M20 9v6M7.4 12h9.2"/></svg>',
  aetna:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3.2l7 2.8v6c0 4.2-3 7.3-7 9.1-4-1.8-7-4.9-7-9.1v-6z"/><path d="M12 8.4v6M9 11.4h6" stroke-linecap="round"/></svg>',
  insta:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.9"/><circle cx="17" cy="7" r="1.1" fill="currentColor" stroke="none"/></svg>',
  x:       '<svg viewBox="0 0 24 24"><path d="M4.2 4h4.1l4 5.5L17 4h2.6l-6.3 7.8L20.2 20h-4.1l-4.4-6-4.9 6H4.2l6.7-8.2z" fill="currentColor"/></svg>',
  linkedin:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="3.2"/><path d="M8 10.4V16M8 7.6v.02M11.6 16v-3.4a2.1 2.1 0 014.2 0V16" stroke-linecap="round"/></svg>'
};
/* CATEGORY chips, not brand names — real third-party marks read as claimed
   live integrations that do not exist yet, and undercut credibility exactly
   where the site is proving trust (jury round 10). Neutral instrument
   glyphs for the categories the twin signs into on the human's behalf. */
ICO.bank   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 9.5L12 4l8 5.5M5.5 10v7M9.8 10v7M14.2 10v7M18.5 10v7M4 19.5h16" stroke-linecap="round" stroke-linejoin="round"/></svg>';
ICO.card   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="6" width="17" height="12.5" rx="2"/><path d="M3.5 10h17"/><path d="M7 15h4" stroke-linecap="round"/></svg>';
ICO.camera = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8.5 7l1.2-2h4.6l1.2 2H20v12H4V7z" stroke-linejoin="round"/><circle cx="12" cy="12.6" r="3.4"/></svg>';
ICO.chat   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5.5h16v11H9l-5 4z" stroke-linejoin="round"/><path d="M8 9.5h8M8 12.5h5" stroke-linecap="round"/></svg>';
ICO.nodes  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="6" cy="12" r="2.2"/><circle cx="17.5" cy="6" r="2.2"/><circle cx="17.5" cy="18" r="2.2"/><path d="M8 11l7.5-4M8 13l7.5 4"/></svg>';
const AUTH_APPS = [
  { name: 'BANKING',   sector: 'FINANCE', svg: ICO.bank },
  { name: 'PAYMENTS',  sector: 'FINANCE', svg: ICO.card },
  { name: 'LEDGER',    sector: 'FINANCE', svg: ICO.stripe },
  { name: 'NUTRITION', sector: 'HEALTH',  svg: ICO.calai },
  { name: 'FITNESS',   sector: 'HEALTH',  svg: ICO.equinox },
  { name: 'COVERAGE',  sector: 'HEALTH',  svg: ICO.aetna },
  { name: 'SOCIAL',    sector: 'SOCIAL',  svg: ICO.camera },
  { name: 'MESSAGES',  sector: 'SOCIAL',  svg: ICO.chat },
  { name: 'NETWORK',   sector: 'SOCIAL',  svg: ICO.nodes }
];
/* auth-beat geometry cache: the panel's size and each chip's offset within it
   are static for the whole beat — measured once on entry (and re-measured
   after any resize), so the effect-heavy signing frames do zero DOM reads */
let authMeasure = null;
addEventListener('resize', () => { authMeasure = null; });
const authNet = (() => {
  let d = document.getElementById('authnet');
  if (!d) { d = document.createElement('div'); d.id = 'authnet'; document.body.appendChild(d); }
  return d;
})();
/* card header — mirrors the HUMAN-VERIFIED annotation, but for the twin: the
   digital twin is the agent that signs into every service on the human's behalf */
const authHead = document.createElement('div');
authHead.className = 'auth-head';
authHead.innerHTML = `<div class="auth-eyebrow">////// PROTOCOL_03 · SERVICES</div><div class="auth-title">AUTHORIZED SERVICES</div>`;
authNet.appendChild(authHead);
const AUTH_SECTORS = ['FINANCE', 'HEALTH', 'SOCIAL'];
const appChips = [];
AUTH_SECTORS.forEach((sector) => {
  const sec = document.createElement('div');
  sec.className = 'app-sector';
  const head = document.createElement('div');
  head.className = 'sec-head';
  head.textContent = sector;
  const row = document.createElement('div');
  row.className = 'sec-row';
  AUTH_APPS.filter((a) => a.sector === sector).forEach((a) => {
    const el = document.createElement('div');
    el.className = 'app-chip';
    el.innerHTML =
      `<div class="app-ico">${a.svg}</div>` +
      `<span class="app-name">${a.name}</span>` +
      `<span class="app-auth"><span class="auth-check">✓</span>AUTH</span>`;
    row.appendChild(el);
    appChips.push({ ...a, el, authed: false });
  });
  sec.appendChild(head); sec.appendChild(row);
  authNet.appendChild(sec);
});
const authMeta = document.createElement('div');
authMeta.className = 'auth-meta';
authMeta.textContent = 'SIGNED BY SUBJECT_01 · CONTINUOUS';
authNet.appendChild(authMeta);
let lastAuthBeat = 0;

/* full-screen overlay for the authorization energy — light-threads from the
   heart, through the twin, out to each service, with travelling pulses +
   ignition flares. Drawn in CSS pixels; sits under the glass tiles. */
const authFx = document.createElement('canvas');
authFx.id = 'authfx';
document.body.appendChild(authFx);
const authFxCtx = authFx.getContext('2d');
const APP_ARRIVE = [];   // per-app arrival point along the beat (set at first draw)

/* wind-driven snow — real MOTION, not a floating-dust effect. Every flake is
   a tiny streak (line segment) stretched along its own velocity — driving
   wind + gust + fall — so the storm visibly RACES through the scene the way
   spindrift does. Analytic in the shader (zero CPU), wrapping in a volume
   around the camera so it never thins. */
const moteGeo = new THREE.BufferGeometry();
{
  const n = isMobile ? 380 : 900;                 // fewer flakes, more motion
  const pos = new Float32Array(n * 2 * 3), ph = new Float32Array(n * 2),
    seed = new Float32Array(n * 2), end = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const bx = Math.random() * 36.0, by = Math.random() * 9.0, bz = Math.random() * 24.0;
    const p2 = Math.random() * Math.PI * 2, s2 = Math.random();
    for (let k = 0; k < 2; k++) {                 // head + tail vertex per flake
      const j = i * 2 + k;
      pos[j * 3] = bx; pos[j * 3 + 1] = by; pos[j * 3 + 2] = bz;
      ph[j] = p2; seed[j] = s2; end[j] = k;
    }
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  moteGeo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  moteGeo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
}
const moteMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: true,
  uniforms: { uTime: { value: 0 }, uWind: { value: 0 } },
  vertexShader: `
    attribute float aPhase; attribute float aSeed; attribute float aEnd;
    uniform float uTime, uWind;
    varying float vA;
    void main(){
      float W = 36.0, H = 9.0, D = 24.0;
      float fall = 1.1 + aSeed * 2.0;                       // per-flake fall speed
      float baseWind = 3.4 + aSeed * 2.6;                   // strong driving wind (wraps clean)
      // bounded gust added AFTER the wrap so the drift stays seamless;
      // uWind (scroll velocity) drives gust + streak length ONLY — never the
      // cumulative wrap term, which would teleport every flake on a flick
      float gust = (sin(uTime*0.4 + aPhase*0.5)*1.0 + sin(uTime*0.17 + 1.7)*0.6)
                 * (1.0 + 1.6*uWind);
      float x = mod(position.x + uTime*baseWind, W) - W*0.5;
      x += gust + sin(uTime*1.8 + aPhase)*0.2;
      float y = H - mod(position.y + uTime*fall, H);        // falls, wraps
      float z = (position.z - D*0.5) + sin(uTime*0.9 + aPhase*1.7)*0.25;
      // the tail vertex trails back along the velocity vector — a motion streak
      vec3 vel = vec3(baseWind + gust*0.6, -fall, 0.0);
      vec3 p = vec3(x, y, z) - aEnd * vel * (0.035 + aSeed*0.03) * (1.0 + 2.2*uWind);
      vec4 mv = viewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      // fade at the top/bottom of the column so wrap seams are invisible;
      // the tail fades harder than the head so each streak has direction
      vA = (0.14 + 0.24*aSeed)
        * smoothstep(0.0, 0.9, y) * smoothstep(H, H-1.3, y)
        * (1.0 - aEnd*0.7) * (1.0 + 0.35*uWind);
    }`,
  fragmentShader: `
    varying float vA;
    void main(){
      gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), vA);
    }`
});
scene.add(new THREE.LineSegments(moteGeo, moteMat));

/* drifting fog banks — soft volumetric-reading cloud sprites at staggered
   depths. They put LAYERS of atmosphere between the figures and the range
   (and one whisper near the camera) so the plain reads as deep, inhabited
   weather instead of a flat backdrop. */
const fogTex = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const x = 30 + Math.random() * 196, y = 34 + Math.random() * 60;
    const r = 26 + Math.random() * 44;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.10)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 128);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const fogBanks = [];
/* mobile RETIRES the fog banks: under the poisoned-program state one of
   these whisper sprites (opacity 0.05) rendered as an opaque black slab
   across the figures — measured by screen-region bbox enumeration. The
   pano's own aerial haze + the spindrift veils carry mobile atmosphere. */
if (!isMobile) {
  const LAYERS = [
    /* LOW ground mist only — kept small and faint so it never rises to veil
       the range. The pano carries its own aerial-perspective haze; a second
       sprite veil on top just mushed the peaks. These now read as thin
       spindrift pooling on the plain, nothing more. */
    { z: -13, y: 0.45, s: 16, o: 0.07, v: 0.14 },
    { z:  -9, y: 0.34, s: 13, o: 0.06, v: 0.20 },
    { z:  -6, y: 0.28, s: 10, o: 0.05, v: 0.28 }
  ];
  for (const L of LAYERS) {
    const m = new THREE.SpriteMaterial({
      map: fogTex, transparent: true, opacity: L.o,
      depthWrite: false, color: 0xdae0e9
    });
    const sp = new THREE.Sprite(m);
    sp.scale.set(L.s, L.s * 0.22, 1);
    sp.position.set((Math.random() - 0.5) * 10, L.y, L.z);
    scene.add(sp);
    fogBanks.push({ ...L, sp, m, x0: sp.position.x, seed: Math.random() * 20 });
  }
}

/* ---------------- post-processing (bloom) ----------------
   16-bit float render targets: smooth gradients (the arctic sky) must never
   round through 8-bit buffers or they band into grey lines over time. */
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(initW, initH, { type: THREE.HalfFloatType })
);
composer.setPixelRatio(Math.min(devicePixelRatio || 1, isMobile ? 1.75 : 2));
composer.setSize(initW, initH);
composer.addPass(new RenderPass(scene, camera));
/* depth-of-field — the camera becomes a LENS (igloo's bokeh pass): focus
   rides the story's subject each frame; the far dunes and the near drift
   genuinely defocus. Subtle by design; desktop only (extra depth render). */
/* DEEP focus like the reference photograph: the range must be tack sharp.
   A tiny aperture makes the depth of field huge (figure -> mountains all
   crisp) and a small maxblur clamps any residual — the sky sphere writes no
   depth, so without this clamp the bokeh treats the range as infinitely far
   and mushes it. Only the ground within ~2m of the lens keeps a whisper of
   softness — the "real lens" cue without ever touching the peaks. */
const bokehPass = isMobile ? null : new BokehPass(scene, camera, {
  focus: 5.0, aperture: 0.000022, maxblur: 0.0016
});
if (bokehPass) composer.addPass(bokehPass);
/* NaN fuse — the transmission buffer can emit a non-finite pixel at some
   camera angles (measured at the cast beat), and UnrealBloom's mip blur
   smears one NaN into a full black frame. Clamp + heal right before bloom
   so the chain is unconditionally finite. */
const sanitizePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      /* NaN pixels HEAL to haze, never black — a black disc on the bright
         plain is a hole in the film; a haze patch is invisible */
      c.rgb = mix(vec3(0.62, 0.65, 0.70), clamp(c.rgb, 0.0, 60.0), vec3(equal(c.rgb, c.rgb)));
      c.a = (c.a == c.a) ? c.a : 1.0;
      gl_FragColor = c;
    }`
});
composer.addPass(sanitizePass);
const bloom = new UnrealBloomPass(
  new THREE.Vector2(initW, initH),
  0.34,   // strength
  0.6,    // radius
  0.90    // threshold — only the truly hot speculars bloom, no milk
);
composer.addPass(bloom);

/* chromatic aberration + frost + vignette + grain — igloo-style scene
   transitions. uAberr spikes during act changes; uFrost fills a frosted
   wipe; uSpace tints the vignette from cold-ice to deep-space. */
const ChromaticShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAberr: { value: 0.0 },
    uFrost: { value: 0.0 },
    uSpace: { value: 0.0 },
    uTime: { value: 0.0 },
    uRes: { value: new THREE.Vector2(initW, initH) }
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAberr, uFrost, uSpace, uTime; uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float r2 = dot(dir, dir);
      // frost: jitter the sample by animated noise for a frozen-glass wipe
      float fr = uFrost;
      if (fr > 0.001){
        vec2 j = (vec2(hash(uv * uRes * 0.5 + uTime), hash(uv * uRes * 0.5 + 7.0 - uTime)) - 0.5);
        uv += j * fr * 0.03;
      }
      // chromatic aberration scaled toward the edges — the resting term is
      // near-subliminal; only transition pulses are allowed to fringe
      float a = (uAberr * 0.005) + r2 * (0.0016 + uAberr * 0.016);
      vec2 off = normalize(dir + 1e-5) * a;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      // frost desaturates + brightens toward white
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l * 1.15 + 0.15), fr * 0.85);
      // vignette (cools toward space)
      float vig = smoothstep(0.95, 0.35, r2 * 2.1);
      vec3 vigTint = mix(vec3(1.0), vec3(0.72, 0.82, 1.0), uSpace);
      col *= mix(vec3(1.0), vigTint, 1.0 - vig) * (0.58 + 0.42 * vig + uSpace * 0.15 * vig);
      // cinematic contrast curve — kills the milk
      col = (col - 0.5) * 1.1 + 0.5;
      // film grain — the poster's texture; light enough to leave smooth crystal
      // skin clean up close, but present on the landscape
      float g = (hash(uv * uRes + fract(uTime)) - 0.5) * 0.024;
      col += g;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`
};
const chromaPass = new ShaderPass(ChromaticShader);
composer.addPass(chromaPass);
composer.addPass(new OutputPass());

/* ================================================================
   THE HEART CAVERN — the interior of the vault, an island 400 units
   out along −z so the surface world and the interior can never see
   each other (FogExp2 whites out anything that far away). The dive
   film covers the camera's cut inside; the cavern is fully live
   WebGL: the Higgsfield interior pano on a dome, the beating heart
   in a crystal lattice over the platinum seal ring, the godray from
   the oculus, and the reading deck projected onto real DOM plates.
   Bright glacial interior — this is an ice cathedral, never a void.
   ================================================================ */
const CAV = new THREE.Vector3(0, 0, -400);
const cavGroup = new THREE.Group();
cavGroup.position.copy(CAV);
cavGroup.visible = false;
scene.add(cavGroup);

/* the interior dome: procedural glacial gradient until the pano lands,
   then the pano tiled 2× around the circle, melting into the shared
   HAZE at its base (the same no-seam contract as the sky) */
const cavDomeMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    uMap: { value: fallSpace }, uHasMap: { value: 0 },
    uHaze: { value: HAZE }, uTime: { value: 0 }
  },
  vertexShader: `varying vec3 vDir;
    void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D uMap; uniform float uHasMap, uTime; uniform vec3 uHaze; varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      float elev = asin(clamp(d.y, -1.0, 1.0));
      /* procedural interior: haze base lifting into pale glacial blue,
         brightening toward the oculus overhead */
      vec3 col = mix(uHaze, vec3(0.80, 0.87, 0.95), smoothstep(-0.05, 0.7, elev));
      col = mix(col, vec3(0.97, 0.99, 1.0), smoothstep(0.85, 1.35, elev));
      if (uHasMap > 0.001) {
        float u = atan(d.z, d.x) / 6.2831853 + 0.5;   // true 360° pano — maps once
        float v = clamp(0.5 + elev / 2.4, 0.001, 0.999);
        vec3 pano = texture2D(uMap, vec2(u, v)).rgb;
        float w = uHasMap
                * smoothstep(-0.10, 0.02, elev)               // base melts into floor mist
                * (1.0 - smoothstep(1.05, 1.45, elev));       // zenith hands to the oculus glow
        col = mix(col, pano, w);
        /* mist skirt — the 3D floor's far edge melts into this band (the
           cavern key cut the scene fog that used to hide the meeting line) */
        col = mix(vec3(0.845, 0.885, 0.93), col, smoothstep(-0.02, 0.15, elev));
        /* the oculus owns everything above — no clamped top-row smear */
        col = mix(col, vec3(0.99, 1.0, 1.0), smoothstep(0.90, 1.25, elev) * 0.92);
      }
      float dth = fract(sin(dot(gl_FragCoord.xy + uTime * vec2(41.0, 17.0), vec2(12.9898, 78.233))) * 43758.5453);
      col += (dth - 0.5) * (1.7 / 255.0);
      gl_FragColor = vec4(col, 1.0);
    }`
});
cavGroup.add(new THREE.Mesh(new THREE.SphereGeometry(46, 48, 32), cavDomeMat));
let cavArmed = false;
function armCavern() {
  if (cavArmed) return;
  cavArmed = true;
  texLoader.load('assets/env/ruby-heart.webp', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    rubyMat.map = t;
    rubyMat.needsUpdate = true;
    rubyReady = true;
    /* the render replaces the procedural gem (which stays as the 404 fallback) */
    cavHeart.visible = false;
    cavNucleus.visible = false;
    cavCore.visible = false;
  }, undefined, () => { /* missing — the procedural ruby carries the beat */ });
  texLoader.load(isMobile ? 'assets/env/heart-cavern-mobile.webp' : 'assets/env/heart-cavern.webp', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    cavDomeMat.uniforms.uMap.value = t;
    cavDomeMat.uniforms.uHasMap.value = 1;
  }, undefined, () => texLoader.load('assets/env/heart-cavern.jpg', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    cavDomeMat.uniforms.uMap.value = t;
    cavDomeMat.uniforms.uHasMap.value = 1;
  }));
}

/* the frost floor — the height fog whites its far edge into the dome base */
{
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xcfd9e6, roughness: 0.94, metalness: 0.0   /* the blown-white floor was erasing every object's grounding */
  });
  onSnowTex((t) => { floorMat.map = t; floorMat.needsUpdate = true; });
  addSnowSparkle(floorMat);
  const f = new THREE.Mesh(new THREE.CircleGeometry(46, 64), floorMat);
  f.rotation.x = -Math.PI / 2;
  f.position.y = 0.01;
  cavGroup.add(f);
}

/* THE HEART — the one red in a world of ice, held in a crystal lattice
   above the platinum seal ring (the ring that carries the visitor's name) */
const heartG = new THREE.Group();
heartG.position.set(0, 3.05, 0);
cavGroup.add(heartG);
/* the ruby reads INNER-LIT, like the figures' own chest gems: a faceted
   translucent shell around a hot additive nucleus — five jury rounds of
   opaque flat-shaded attempts read as clay; light from WITHIN is what
   makes a gem a gem. (The ice casing shell is retired — its lit facets
   read as white holes punched in the silhouette.) */
const cavHeartMat = new THREE.MeshPhysicalMaterial({
  color: 0x8a0a04, roughness: 0.16, metalness: 0.0, flatShading: true,
  fog: false, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.55,
  transparent: true, opacity: 0.85,
  emissive: new THREE.Color(0xd01206), emissiveIntensity: 1.05
});
const cavHeart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), cavHeartMat);
heartG.add(cavHeart);
const cavNucleus = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture('rgba(255,74,42,1)', 'rgba(200,16,6,0)'),
  transparent: true, depthWrite: false, depthTest: false,
  blending: THREE.AdditiveBlending, opacity: 0.6
}));
cavNucleus.scale.setScalar(1.35);
heartG.add(cavNucleus);
/* the white-hot pinpoint that actually crosses the bloom threshold — the
   jury measured the heart never blooming; a gem is a STAR, not a ball */
const cavCore = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTexture('rgba(255,158,120,1)', 'rgba(255,64,32,0)'),
  transparent: true, depthWrite: false, depthTest: false,
  blending: THREE.AdditiveBlending, opacity: 0.85
}));
cavCore.scale.setScalar(0.5);
heartG.add(cavCore);

/* THE RUBY, RENDERED — the vault cube's own proven pattern applied to the
   film's most important object: a faceted heart-cut ruby with a burning
   core, photographed against black and cut out. Six jury rounds of
   procedural icospheres read as clay against the photographic cathedral;
   the render IS the gem. Lazy-armed with the pano; if it 404s, the
   procedural heart above carries the beat (never a blank centre).
   depthTest:false — nothing can ever impale it again. */
const rubyMat = new THREE.SpriteMaterial({
  transparent: true, opacity: 0, depthTest: false, depthWrite: false
});
const rubySprite = new THREE.Sprite(rubyMat);
rubySprite.scale.set(1.58, 1.29, 1);          // render aspect 2987x2445
rubySprite.renderOrder = 11;
heartG.add(rubySprite);
let rubyReady = false;
const cavGlowTex = glowTexture('rgba(255,96,64,1)', 'rgba(255,52,24,0)');
const cavGlowIn = new THREE.Sprite(new THREE.SpriteMaterial({
  map: cavGlowTex, transparent: true, depthWrite: false, depthTest: false,
  blending: THREE.AdditiveBlending, opacity: 0.85
}));
cavGlowIn.scale.setScalar(2.4);
heartG.add(cavGlowIn);
const cavGlowOut = new THREE.Sprite(new THREE.SpriteMaterial({
  map: cavGlowTex, transparent: true, depthWrite: false, depthTest: false,
  blending: THREE.AdditiveBlending, opacity: 0.28
}));
cavGlowOut.scale.setScalar(9.5);
heartG.add(cavGlowOut);

/* the crystal lattice — a ring of ice shards holding the heart */
const latticeG = new THREE.Group();
heartG.add(latticeG);
const latticeMat = new THREE.MeshPhysicalMaterial({
  color: 0xc4ddf4, transparent: true, opacity: 0.72, fog: false,
  roughness: 0.03, metalness: 0.0, envMapIntensity: 2.3,
  side: THREE.DoubleSide, depthWrite: false
});
const latticeShards = [];
{
  let ls = 20260722;
  const lrnd = () => { ls = (ls * 16807) % 2147483647; return ls / 2147483647; };
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + lrnd() * 0.3;
    /* the ring holds CLEAR of the gem — no shard may ever pierce the heart */
    const r = 1.75 + lrnd() * 0.75;
    const h = 0.7 + lrnd() * 0.7;
    /* per-shard material: any shard drifting across the camera→heart
       sightline steps ASIDE (opacity fades) — geometrically clear was not
       enough; from the orbit the near shard still bisected the gem on screen */
    const shard = new THREE.Mesh(new THREE.ConeGeometry(0.07 + lrnd() * 0.06, h, 5), latticeMat.clone());
    shard.position.set(Math.cos(a) * r, (lrnd() - 0.5) * 1.4, Math.sin(a) * r);
    shard.rotation.set((lrnd() - 0.5) * 0.5, lrnd() * Math.PI, (lrnd() - 0.5) * 0.5);
    latticeG.add(shard);
    latticeShards.push(shard);
  }
}
/* point-to-segment distance temps for the sightline fade */
const _shP = new THREE.Vector3(), _shA = new THREE.Vector3(),
      _shAB = new THREE.Vector3(), _shAP = new THREE.Vector3();
/* visibility of the standing vow words this frame (the ring engraving yields) */
let _sovVis = 0;

/* the seal ring — platinum struck with gold, waiting for a name */
const cavRingMat = new THREE.MeshStandardMaterial({
  color: 0xc9974a, metalness: 0.88, roughness: 0.3, fog: false,
  emissive: new THREE.Color(0xa5741f), emissiveIntensity: 0.12
});
const cavRing = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.06, 20, 140), cavRingMat);
cavRing.rotation.x = Math.PI / 2;
cavRing.position.y = -1.15;
heartG.add(cavRing);

/* the godray — the oculus light standing in the chamber's air */
const godrayMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uAmp: { value: 0.6 } },
  vertexShader: `varying vec2 vUv; varying vec3 vPos;
    void main(){ vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform float uTime, uAmp; varying vec2 vUv; varying vec3 vPos;
    void main(){
      float v = smoothstep(0.0, 0.45, vUv.y) * (0.35 + 0.65 * smoothstep(0.0, 1.0, vUv.y));
      float flicker = 0.9 + 0.1 * sin(uTime * 0.7 + vUv.x * 12.0);
      vec3 col = mix(vec3(0.72, 0.84, 0.95), vec3(1.0, 0.99, 0.95), vUv.y);
      gl_FragColor = vec4(col, v * uAmp * flicker * 0.30);
    }`
});
const godray = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 6.2, 17, 40, 1, true), godrayMat);
godray.position.set(0, 9.4, 0);
cavGroup.add(godray);

/* drifting motes — dust in the godray, frost in the chamber air */
const cavMoteTex = glowTexture('rgba(255,255,255,1)', 'rgba(190,225,255,0)');
function moteCloud(count, spread, y0, y1, size, opacity) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  let ms = 4611 + count;
  const mr = () => { ms = (ms * 16807) % 2147483647; return ms / 2147483647; };
  for (let i = 0; i < count; i++) {
    const a = mr() * Math.PI * 2, r = Math.sqrt(mr()) * spread;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = y0 + mr() * (y1 - y0);
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({
    map: cavMoteTex, size, transparent: true, opacity,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}
const shaftMotes = moteCloud(isMobile ? 120 : 240, 4.4, 0.6, 17, 0.10, 0.5);
const cavAirMotes = moteCloud(isMobile ? 160 : 320, 17, 0.4, 12, 0.07, 0.3);
cavGroup.add(shaftMotes); cavGroup.add(cavAirMotes);

/* NO cavern lights: adding lights inside a toggled group changes the
   visible light count mid-session, forcing every patched material (snow
   sparkle, height fog, chisel) to recompile — measured as a black frame.
   The dome is unlit, the heart is emissive, the metals read the env map;
   the heart's blood-light on the frost is a flat sprite, not a light. */
const cavFloorGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: cavGlowTex, transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, opacity: 0.16, color: 0xff4a2a
}));
cavFloorGlow.scale.set(7.5, 2.4, 1);
cavFloorGlow.position.set(0, 0.35, 0);
cavGroup.add(cavFloorGlow);

/* THE COLONNADE — the film's arrival frame promises a gothic ice cathedral;
   the live chamber must BE one, not an empty floor with scattered cones: a
   ring of great translucent ice columns in the lattice's own material
   language stands in the middle distance, echoing the pano's colonnade and
   giving the room parallax and architecture */
{
  let cs = 4611;
  const crnd = () => { cs = (cs * 16807) % 2147483647; return cs / 2147483647; };
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + crnd() * 0.4;
    const r = 20 + crnd() * 7;
    const h = 12 + crnd() * 10;
    const colMat = latticeMat.clone();
    colMat.opacity = 0.4 + crnd() * 0.12;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9 + crnd() * 0.6, 1.5 + crnd() * 0.8, h, 6), colMat);
    col.position.set(Math.cos(a) * r, h / 2 - 0.5, Math.sin(a) * r);
    col.rotation.y = crnd() * Math.PI;
    cavGroup.add(col);
  }
}

/* the floor is CARVED, not blank: concentric hairline rings etched around
   the seal — the chamber's own pedestal geometry (the featureless white
   below the horizon was half the act's measured flatness) */
{
  for (const [r, w, o] of [[3.4, 0.035, 0.38], [6.8, 0.03, 0.30], [10.4, 0.028, 0.24], [15.2, 0.028, 0.17]]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - w, r + w, 128),
      new THREE.MeshBasicMaterial({
        color: 0xb9a06a, transparent: true, opacity: o, fog: false, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    cavGroup.add(ring);
  }
}

/* the ring GROUNDS — a soft contact shadow beneath it on the frost (it
   read as a floating hula-hoop with no relationship to the floor) */
const cavRingShadow = new THREE.Mesh(
  new THREE.CircleGeometry(2.15, 48),
  new THREE.MeshBasicMaterial({
    map: glowTexture('rgba(22,30,42,0.5)', 'rgba(22,30,42,0)'),
    transparent: true, opacity: 0.32, depthWrite: false, fog: false
  })
);
cavRingShadow.rotation.x = -Math.PI / 2;
cavRingShadow.position.set(0, 0.07, 0);
cavGroup.add(cavRingShadow);

/* ---- the cavern's own camera line: fall out of the shaft, meet the
   heart, one slow orbit past the reading stations, then rise into the
   light. One vector, no reversals — the return IS the ascent. ---- */
const KFC = [
  { p: 0.700, pos: [0.0, 15.0, 4.0], look: [0.0, 2.4, 0.0] },   // falling out of the shaft
  /* arrival at EYE level, gaze slightly RAISED — the cathedral walls and
     colonnade back the heart; a level-down gaze filled the frame with
     fog-white floor */
  { p: 0.790, pos: [0.3, 3.2, 7.2], look: [0.0, 3.6, 0.0] },    // arrival — the heart
  { p: 0.845, pos: [4.9, 3.4, 5.6], look: [0.0, 3.0, 0.0] },    // orbit — the world plate
  { p: 0.890, pos: [6.2, 3.0, -1.4], look: [0.0, 3.0, 0.0] },   // deep side — the moat wall
  { p: 0.930, pos: [2.9, 2.8, -6.6], look: [0.0, 3.0, 0.0] },   // behind — the pilot station
  { p: 0.960, pos: [-3.6, 3.6, -5.2], look: [0.0, 3.05, 0.0] }, // rounding — investors
  /* hold the heart as the subject until the whiteout owns the frame (the
     old direct cut to eyes-up left 0.97 with no composed subject) */
  { p: 0.978, pos: [-1.7, 5.3, -1.2], look: [0.0, 5.2, 0.0] },
  /* the resting frame keeps the WORLD in it — godray shaft above, the
     heart's afterglow below the vow (a straight-up gaze resolved on
     featureless haze: the flattest frame of the film) */
  { p: 1.000, pos: [-0.4, 8.4, 1.8], look: [0.0, 10.5, 0.3] }   // THE RETURN — into the light
];
function sampleCavernCamera(P) {
  let i = 0;
  while (i < KFC.length - 2 && P > KFC[i + 1].p) i++;
  const a = KFC[i], b = KFC[i + 1];
  const k0 = KFC[Math.max(0, i - 1)], k3 = KFC[Math.min(KFC.length - 1, i + 2)];
  const raw = clamp01((P - a.p) / (b.p - a.p));
  const t = raw * 0.35 + smooth(raw) * 0.65;
  camPos.set(
    crom(k0.pos[0], a.pos[0], b.pos[0], k3.pos[0], t) + CAV.x,
    crom(k0.pos[1], a.pos[1], b.pos[1], k3.pos[1], t) + CAV.y,
    crom(k0.pos[2], a.pos[2], b.pos[2], k3.pos[2], t) + CAV.z
  );
  camLook.set(
    crom(k0.look[0], a.look[0], b.look[0], k3.look[0], t) + CAV.x,
    crom(k0.look[1], a.look[1], b.look[1], k3.look[1], t) + CAV.y,
    crom(k0.look[2], a.look[2], b.look[2], k3.look[2], t) + CAV.z
  );
  /* portrait fit — same trick as the vault act: dolly back on tall screens */
  const fitK = Math.max(1, Math.min(2.3, 1.05 / camera.aspect));
  if (fitK > 1.001) camPos.sub(camLook).multiplyScalar(fitK).add(camLook);
}

/* ---- the reading deck, seated in the chamber (window + anchor each) ---- */
/* SEQUENTIAL station windows — no two plates may ever share the frame
   (the old MOAT/PILOT overlap double-exposed at 0.9), and every snap
   station (0.80 / 0.865 / 0.925 / 0.952) parks INSIDE a fully-open
   window, never on a fade ramp */
const cavPlates = [
  { el: document.getElementById('plate-world'), a: new THREE.Vector3(-3.1, 3.4, 3.4), w: [0.782, 0.845], counted: true },
  { el: document.getElementById('plate-specs'), a: new THREE.Vector3(2.6, 3.3, -3.3), w: [0.850, 0.893], counted: false },
  { el: document.getElementById('plate-pilot'), a: new THREE.Vector3(-0.6, 3.1, -3.9), w: [0.897, 0.937], counted: true },
  /* the ask must be READ, not drowned: fully clear before the whiteout */
  { el: document.getElementById('plate-invest'), a: new THREE.Vector3(-1.6, 3.6, 2.3), w: [0.938, 0.968], counted: true }
].filter(pl => pl.el);
/* the belief ladder — five declarations spiralling up around the heart */
const cavDecls = [0, 1, 2, 3, 4].map(i => {
  const a = (i / 5) * Math.PI * 2 + 0.5;
  return {
    el: document.getElementById('decl-' + (i + 1)),
    a: new THREE.Vector3(Math.cos(a) * 2.7, 1.9 + i * 0.58, Math.sin(a) * 2.7),
    w: [0.786 + i * 0.021, 0.826 + i * 0.021]
  };
}).filter(d => d.el);
let countRun = false;
const _cproj = new THREE.Vector3();
/* the heart's screen position (set each cavern frame) — declarations repel
   from it so the belief copy never crosses the film's one sacred object */
const _heartScr = { x: -1e4, y: -1e4 };
/* on portrait the plates and the free declarations fight for the same
   band — while a plate is substantially open, the decls yield (set per
   frame by the cavern drive) */
let _declSquelch = 0;
function seatCavPlate(item, P, W, H, isDecl) {
  const el = item.el;
  let w = seg(P, item.w[0], item.w[0] + 0.014) * (1 - seg(P, item.w[1] - 0.014, item.w[1]));
  if (isDecl) w *= 1 - _declSquelch;
  if (w <= 0.01) {
    el.style.opacity = '0'; el.style.visibility = 'hidden';
    el.classList.remove('live');
    el.setAttribute('aria-hidden', 'true');
    return 0;
  }
  _cproj.copy(item.a).add(CAV).project(camera);
  if (_cproj.z > 1 || _cproj.z < -1) { el.style.opacity = '0'; el.style.visibility = 'hidden'; return 0; }
  if (el._pw === undefined || (_lblFrame % 16 === 0)) {
    el._pw = el.offsetWidth || 320; el._ph = el.offsetHeight || 160;
  }
  let x = (_cproj.x * 0.5 + 0.5) * W - el._pw / 2;
  let y = (-_cproj.y * 0.5 + 0.5) * H - el._ph / 2;
  if (!isDecl && W < H * 0.8) {
    /* portrait: DOCK the plate as a bottom sheet — the heart owns the whole
       upper two-thirds. The old y >= 0.40H still centred the card over the
       ruby at the 0.865 rest and buried the film's one sacred object on the
       phone (jury round 10); the money shot now reads clean above it. */
    x = (W - el._pw) / 2;                       // centre the sheet across the base
    y = H - el._ph - Math.max(58, H * 0.085);   // clear the fixed HUD telemetry row
  }
  if (isDecl) {
    /* the declarations float, but never off the page (mobile clipped them
       mid-word) and never across the heart's bloom */
    const cx = x + el._pw / 2, cy = y + el._ph / 2;
    const dx = cx - _heartScr.x, dy = cy - _heartScr.y;
    const rx = el._pw / 2 + Math.min(W, H) * 0.16, ry = el._ph / 2 + Math.min(W, H) * 0.15;
    if (Math.abs(dx) < rx && Math.abs(dy) < ry) {
      if (Math.abs(dx) / rx > Math.abs(dy) / ry) x += (dx >= 0 ? rx - dx : -rx - dx);
      else y += (dy >= 0 ? ry - dy : -ry - dy);
    }
    x = Math.max(12, Math.min(W - el._pw - 12, x));
    /* the ladder is a TITLE STRIP: declarations live in the top band while
       the plates live below — spatial separation instead of the squelch
       that made the film's core argument effectively invisible */
    y = Math.max(H * 0.07, Math.min(H * 0.21, y));
  } else {   // plates clamp into the readable band, below the decl strip
    x = Math.max(16, Math.min(W - el._pw - 16, x));
    y = Math.max(H * 0.30, Math.min(H * 0.985 - el._ph, y));
  }
  el.style.visibility = 'visible';
  el.style.opacity = String(w);
  el.style.transform = `translate(${x.toFixed(1)}px, ${(y + (1 - w) * 12).toFixed(1)}px)`;
  el.style.filter = w < 0.995 ? `blur(${((1 - w) * 4).toFixed(1)}px)` : 'none';
  el.setAttribute('aria-hidden', w > 0.5 ? 'false' : 'true');
  el.classList.toggle('live', w > 0.6);
  /* the moat numbers count from the plate's FIRST appearance (arming at
     0.6 left a fast or scrubbed-back arrival reading zeros at readable
     opacity — the flagship claims inverted) */
  if (!isDecl && !item.counted && w > 0.15) {
    item.counted = true; countRun = true;
    el.querySelectorAll('.pcount').forEach((c) => {
      c._t0 = performance.now(); c._target = +c.dataset.target;
    });
  }
  return w;
}

/* ================================================================ */
/* ---------------- camera path ---------------- */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const KF = [
  { p: 0.00, pos: V(0.0, 0.92, 4.5), look: V(0.0, 1.06, 0.0) },   // lone human, monumental
  { p: 0.10, pos: V(0.0, 1.00, 5.2), look: V(0.0, 1.05, 0.0) },   // the cast begins
  { p: 0.22, pos: V(0.0, 1.10, 6.8), look: V(0.0, 1.05, 0.0) },   // TWO twins — held centerpiece
  { p: 0.31, pos: V(0.0, 1.15, 6.0), look: V(0.0, 1.08, 0.0) },   // verified — both twins, held together
  { p: 0.40, pos: V(0.0, 1.18, 6.4), look: V(0.0, 1.12, 0.0) },   // the pair, signal + heart both beating
  { p: 0.50, pos: V(0.0, 1.42, 7.2), look: V(0.0, 1.22, 0.0) },   // the protocol rises around the pair
  { p: 0.60, pos: V(1.9, 1.60, 8.2), look: V(0.0, 1.28, 0.0) },   // camera arcs; facets orbit both twins
  { p: 0.70, pos: V(-1.8, 1.60, 8.2), look: V(0.0, 1.30, 0.0) },  // the full ring around the two sovereigns
  { p: 0.80, pos: V(0.0, 1.36, 6.8), look: V(0.0, 1.22, 0.0) },   // facets sink back; the pair remain
  { p: 0.87, pos: V(0.0, 1.35, 6.0), look: V(0.0, 1.22, 0.0) },   // the twins settle; the ice forms between them
  { p: 0.93, pos: V(0.55, 1.30, 4.6), look: V(0.0, 1.20, 0.0) },  // slow push-in, a touch off-axis for dimension
  { p: 1.00, pos: V(0.0, 1.26, 4.2), look: V(0.0, 1.20, 0.0) }    // held close on the sealed heart as it whitens
];
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
/* Catmull-Rom through a component of four keyframes — continuous velocity, so
   the camera GLIDES through keyframes instead of cornering + stopping at each.
   A gentle ease on the local t keeps the rest-at-snap feel without the hard
   stop-start that made the move read mechanical. */
function crom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function sampleCamera(p) {
  let i = 0;
  while (i < KF.length - 2 && p > KF[i + 1].p) i++;
  const a = KF[i], b = KF[i + 1];
  const k0 = KF[Math.max(0, i - 1)], k3 = KF[Math.min(KF.length - 1, i + 2)];
  // soft ease (blend linear↔smoothstep) so holds breathe but motion never stalls
  const raw = (p - a.p) / (b.p - a.p);
  const t = raw * 0.35 + smooth(raw) * 0.65;
  camPos.set(
    crom(k0.pos.x, a.pos.x, b.pos.x, k3.pos.x, t),
    crom(k0.pos.y, a.pos.y, b.pos.y, k3.pos.y, t),
    crom(k0.pos.z, a.pos.z, b.pos.z, k3.pos.z, t)
  );
  camLook.set(
    crom(k0.look.x, a.look.x, b.look.x, k3.look.x, t),
    crom(k0.look.y, a.look.y, b.look.y, k3.look.y, t),
    crom(k0.look.z, a.look.z, b.look.z, k3.look.z, t)
  );
}

const mouse = { x: 0, y: 0, tx: 0, ty: 0, cx: -999, cy: -999 };
addEventListener('pointermove', e => {
  mouse.tx = (e.clientX / innerWidth - 0.5) * 2;
  mouse.ty = (e.clientY / innerHeight - 0.5) * 2;
  mouse.cx = e.clientX;
  mouse.cy = e.clientY;
});

/* ---------------- the gateway galaxy (chapter 05) ----------------
   The digital twin is the gate; every application is a star.
   Hover a star to flare it; click to authorize. */
const APPS = [
  { name: 'FINANCE', pos: V(-3.6, 8.8, -2.0) },
  { name: 'HEALTH', pos: V(-2.0, 9.8, -1.0) },
  { name: 'SOCIAL', pos: V(-0.4, 8.4, -2.4) },
  { name: 'COMMERCE', pos: V(1.2, 9.6, -1.6) },
  { name: 'TRAVEL', pos: V(2.8, 8.6, -2.0) },
  { name: 'WORK', pos: V(3.8, 9.9, -0.8) },
  { name: 'LEARNING', pos: V(-2.9, 7.3, -1.4) },
  { name: 'ENERGY', pos: V(2.0, 7.1, -1.8) }
];
const starTex = glowTexture('rgba(255,255,255,1)', 'rgba(150,215,255,0)');
const galaxyGroup = new THREE.Group();
galaxyGroup.visible = false;
scene.add(galaxyGroup);

const appStars = APPS.map((a, i) => {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: starTex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0
  }));
  sprite.position.copy(a.pos);
  sprite.scale.setScalar(1.2);
  galaxyGroup.add(sprite);

  /* beam from the twin's core to this star */
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({
    color: 0x8fd8ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  beam.frustumCulled = false;
  galaxyGroup.add(beam);

  /* verification pulse traveling up the beam */
  const pulse = new THREE.Sprite(new THREE.SpriteMaterial({
    map: starTex, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0
  }));
  pulse.scale.setScalar(0.35);
  galaxyGroup.add(pulse);

  /* DOM label */
  const el = document.createElement('div');
  el.className = 'star-label';
  el.innerHTML = `<span class="star-name">${a.name}</span><span class="star-tag">✓ VERIFIED</span>`;
  document.body.appendChild(el);

  return { ...a, sprite, beam, pulse, el, seed: i * 0.37, flash: -10 };
});

/* deep-space starfield with warp streaming */
const deepGeo = new THREE.BufferGeometry();
{
  const n = isMobile ? 700 : 1500;
  const pos = new Float32Array(n * 3), ph = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const th = Math.random() * Math.PI * 2;
    const u = Math.random() * 0.9 + 0.1;             // bias upward
    const r = 46 + Math.random() * 8;
    pos[i * 3] = r * Math.sqrt(1 - u * u) * Math.cos(th);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * Math.sqrt(1 - u * u) * Math.sin(th);
    ph[i] = Math.random() * Math.PI * 2;
  }
  deepGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  deepGeo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
}
const deepMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uSpace: { value: 0 }, uTime: { value: 0 }, uWarp: { value: 0 } },
  vertexShader: `attribute float aPhase; uniform float uTime, uWarp; varying float vA;
    void main(){
      vec3 p = position;
      p.y -= uWarp * fract(uTime * (0.25 + fract(aPhase) * 0.35) + aPhase) * 26.0;
      vec4 mv = viewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float tw = 0.5 + 0.5 * sin(uTime * (0.5 + fract(aPhase) * 1.3) + aPhase * 9.0);
      gl_PointSize = (1.4 + tw * 2.0) * (1.0 + uWarp * 2.5);
      vA = 0.25 + 0.75 * tw;
    }`,
  fragmentShader: `uniform float uSpace; varying float vA;
    void main(){
      vec2 c = gl_PointCoord - 0.5;
      float d = 1.0 - smoothstep(0.08, 0.5, length(c));
      gl_FragColor = vec4(vec3(0.85, 0.92, 1.0), d * vA * uSpace);
    }`
});
scene.add(new THREE.Points(deepGeo, deepMat));

/* hover + click: explore blocks open their facet page (igloo portfolio) */
let hoverIdx = -1, lastGalaxy = 0;
const clockForFlash = { t: 0 };
addEventListener('pointerdown', e => {
  if (lastExplore < 0.3) return;
  if (e.target.closest && e.target.closest('a, button, nav')) return;
  /* ground the hover in the ACTUAL tap — on touch, cx/cy is stale drag-scroll
     residue, and a tap anywhere near a facet would navigate away mid-film */
  mouse.cx = e.clientX; mouse.cy = e.clientY;
  let idx = -1, best = 110;
  for (let i = 0; i < exploreBlocks.length; i++) {
    const b = exploreBlocks[i];
    if (b.sx === undefined) continue;
    const d = Math.hypot(b.sx - e.clientX, b.sy - e.clientY);
    if (d < best) { best = d; idx = i; }
  }
  if (idx < 0) return;
  const b = exploreBlocks[idx];
  /* coarse pointers confirm: the first tap expands the facet (the update loop
     marks it hot from the grounded cx/cy), the second tap navigates */
  if (matchMedia('(pointer: coarse)').matches && !b.el.classList.contains('hot')) {
    hoverBlock = idx;
    return;
  }
  b.el.classList.add('auth');
  const tag = b.el.querySelector('.star-tag');
  if (tag) tag.textContent = 'OPENING ▓▒░';
  setTimeout(() => { location.href = `portfolio/${b.slug}.html`; }, 420);
});

/* scramble-in for chapter titles (igloo-style telemetry) */
const SCRAMBLE = '▓▒░<>/\\|=+*#';
const scrambled = [false, false, false, false, false];
const labelState = [null, null, null, null, null];   // per-card slot hysteresis
let lastLabelT = 0;                                  // for frame-rate-corrected easing
let _lblFrame = 0;                                   // stagger DOM measurements to avoid per-frame reflow
function scrambleIn(el) {
  const target = el.dataset.text || el.textContent;
  el.dataset.text = target;
  let frame = 0;
  const total = 14;
  const tick = () => {
    frame++;
    const solved = Math.floor((frame / total) * target.length);
    el.textContent = target.slice(0, solved) +
      Array.from({ length: Math.min(10, Math.max(0, target.length - solved)) },
        () => SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0]).join('');
    if (frame < total) setTimeout(tick, 30);
    else el.textContent = target;
  };
  tick();
}

/* live telemetry readouts inside the labels (igloo instrument style) */
const telBpm = document.querySelector('[data-tel="bpm"]');
const telYr = document.querySelector('[data-tel="yr"]');
const telYr2 = document.querySelector('[data-tel="yr2"]');

/* on every act transition, the whole HUD scrambles at once (igloo move) */
/* NOTE: the sound toggle is deliberately NOT scrambled — it carries live
   state (SOUND: ON/OFF), and re-scrambling reset its label to a stale value */
const HUD_SCRAMBLE_ELS = [
  ...document.querySelectorAll('.topnav a')
].filter(Boolean);
/* 0.42 -> 0.40: the HUD re-stamp + ice-crack land at the seal film's
   ENTRANCE (a scene change, where the grammar belongs), not mid-macro */
const ACT_EDGES = [0.10, 0.28, 0.40, 0.62, 0.76, 0.88];
let lastActIdx = -1;
let _actStampT = 0, _actStampP = -1;   // act-crossing debounce (scrub dither)
let _windK = 0, _nowTime = 0, _settleAt = -1e3;  // velocity weather + snap settle
function actIndex(p) { let i = 0; for (const e of ACT_EDGES) if (p > e) i++; return i; }

/* ---------------- annotation labels (leader lines) ---------------- */
const labels = [1, 2, 3, 4, 5].map(i => document.getElementById(`anno-${i}`));
let svg = document.getElementById('leaders');
if (!svg) {
  svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'leaders';
  document.body.appendChild(svg);
}
const leaderEls = labels.map((_, i) => {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('r', '2.5');
  if (i === 4) {                       // chapter 5 lives in deep space: light lines
    path.style.stroke = 'rgba(223,233,255,0.85)';
    dot.style.fill = '#dfe9ff';
  }
  svg.appendChild(path); svg.appendChild(dot);
  return { path, dot };
});
const _proj = new THREE.Vector3();

/* ---------------- choreography ---------------- */
let progress = 0;        // legacy-warped p — every surface act reads this
let masterP = 0;         // master descent progress — the interior reads this
/* THE DESCENT warp (mirrored in main.js): the legacy journey plays in
   master P ∈ [0, 0.615] at its original pacing; the breach, the dive and
   the heart cavern own the rest. */
const LEGACY_END = 0.615, LEGACY_CAP = 0.955;
const warpLegacy = (P) => P <= LEGACY_END ? (P / LEGACY_END) * LEGACY_CAP : LEGACY_CAP;
const whiteout = document.getElementById('whiteout');

function update(time) {
  const p = progress;      // the surface acts (legacy-authored)
  const P = masterP;       // the whole descent (master-authored)
  clockForFlash.t = time;

  /* the interior arms as the visitor approaches the vault, and owns the
     frame once the dive film has covered the cut inside */
  if (!cavArmed && P > 0.5) armCavern();
  const inCavern = P > 0.66;
  cavGroup.visible = P > 0.58;

  /* the score's harmony follows the STORY, not the frozen surface warp:
     past 0.60 legacy p pins toward 0.955, which fired the FINALE chord at
     the breach and left the ending nowhere to go. Hold the vault chord
     (scoreP < 0.95, filter fully swelled) through the dive + cavern, and
     give the finale to the vow at P = 0.955 — continuous at both joins. */
  const scoreP = P <= 0.60 ? p
    : P < 0.955 ? 0.9317 + ((P - 0.60) / 0.355) * 0.0182
    : 0.95 + ((P - 0.955) / 0.045) * 0.05;
  window.SCORE?.setProgress(scoreP);

  /* act-transition detector: scramble the whole HUD when we cross an edge */
  const ai = actIndex(p);
  if (ai !== lastActIdx) {
    /* debounced: scrub dither across an edge used to machine-gun the
       re-stamp + ice-crack — one signature moment per crossing, with a
       cooldown and a real-travel guard before it may fire again */
    const nowA = performance.now() / 1000;
    if (lastActIdx !== -1 && nowA - _actStampT > 1.2 && Math.abs(p - _actStampP) > 0.008) {
      HUD_SCRAMBLE_ELS.forEach(el => scrambleIn(el));
      window.SFX?.telemetry(3);          // the whole HUD re-stamps
      window.SOUNDWORLD?.crack(0.8);     // the ice answers the crossing
      _actStampT = nowA; _actStampP = p;
    }
    lastActIdx = ai;
  }
  /* arctic flow — two sovereigns, side by side, the whole way through:
     one human -> the digital twin is cast from it -> BOTH stay, verified ->
     the protocol facets rise and orbit the PAIR -> facets sink -> the
     centennial vault forms between them -> whiteout. The twin never leaves,
     so its signal beats from the cast to the end. */
  const splitPos = seg(p, 0.10, 0.22);                   // cast apart once, then held apart forever
  const twinAlpha = seg(p, 0.10, 0.18);                  // once cast, the digital twin never leaves
  const humanAlpha = 1;                                  // the human is the constant — NEVER breaks
  const scan = seg(p, 0.28, 0.31) * (1 - seg(p, 0.35, 0.38));   // human-verified pulse
  const intent = seg(p, 0.29, 0.32) * (1 - seg(p, 0.36, 0.39));
  const disperse = 0;                                    // (deconstruction retired)
  const shardAlpha = 0;                                  // the human no longer shatters into shards
  const explore = seg(p, 0.46, 0.54) * (1 - seg(p, 0.76, 0.82)); // the protocol facets, risen around the human
  const facetRise = 1 - seg(p, 0.47, 0.57);              // blocks rise up out of the ice as they appear
  const facetSink = seg(p, 0.75, 0.82);                  // then sink back into the ice
  const moat = seg(p, 0.86, 0.92);                       // the centennial spire
  const moatFade = 1 - seg(p, 0.95, 0.99);
  const galaxy = 0;                                      // gateway galaxy retired
  lastGalaxy = 0;
  lastExplore = explore;

  /* velocity weather — the world answers the hand: scroll speed leans on
     the spindrift's gusts and streaks (capped so autoplay glides whisper) */
  _nowTime = time;
  _windK += ((Math.min(0.4, window.__scrollVel || 0) / 0.4) - _windK) * 0.08;
  moteMat.uniforms.uWind.value = REDUCED ? 0 : _windK;
  moteMat.uniforms.uTime.value = time;
  sparkTime.value = time;
  for (const m of driftMats) m.uniforms.uTime.value = time % 3600.0;
  /* fog banks drift with the wind, wrapping seamlessly across the frame */
  for (const f of fogBanks) {
    const span = f.s * 1.6;
    f.sp.position.x = ((f.x0 + time * f.v + f.seed) % span + span) % span - span / 2;
    f.m.opacity = f.o * (0.85 + 0.15 * Math.sin(time * 0.11 + f.seed));
  }

  /* environment stays arctic; only the ground haze breathes. */
  skyMat.uniforms.uSpace.value = 0;
  /* long wrap so the stratus drift never visibly pops (float stays precise) */
  skyMat.uniforms.uTime.value = time % 3600.0;
  /* THE PARHELION blooms as the protocol crystallizes, holds its peak
     through the vault rise, and yields the sky to the breach film */
  skyMat.uniforms.uParhelion.value =
    seg(masterP, 0.36, 0.55) * (1 - seg(masterP, 0.60, 0.645));
  /* heavy haze IS the depth cue: the dune belts dissolve into the sky's own
     horizon colour — one world, no junction anywhere */
  scene.fog.density = 0.016;
  floor.material.opacity = 1;

  /* cinematic chromatic aberration — pulses at the cast, the seal, and a
     gentle breath as the protocol facets rise + sink */
  const aberr = seg(p, 0.12, 0.18) * (1 - seg(p, 0.24, 0.30)) * 0.30
    + seg(p, 0.37, 0.40) * (1 - seg(p, 0.42, 0.45)) * 0.22
    + seg(p, 0.47, 0.50) * (1 - seg(p, 0.505, 0.525)) * 0.18;
  chromaPass.uniforms.uAberr.value = aberr;
  /* a single soft frost veil as the protocol crystallizes in around the human.
     BOTH effects must be fully clear by p=0.525: the story SNAPS (and the
     auto-play dwells) at 0.53 — the protocol beat has to read crisp, not
     through frozen glass. The veil now lives entirely inside the glide. */
  const frost = seg(p, 0.44, 0.475) * (1 - seg(p, 0.49, 0.522)) * 0.55
    /* the signature film ENTERS through the same frost grammar it exits by —
       without this its first frame was a hard splice off the wide plain */
    + seg(p, 0.385, 0.403) * (1 - seg(p, 0.412, 0.432)) * 0.45
    /* the breach — the veil blinks as the ice opens and the dive begins */
    + seg(P, 0.596, 0.628) * (1 - seg(P, 0.64, 0.672)) * 0.8
    /* the hidden camera cut (surface freeze -> cavern lens at 0.66) is only
       ever safe under an opaque dive film; when the film is late or 404'd,
       this frost blink covers the teleport — same pattern as the arrival */
    + (window.DIVEFILM?.ready ? 0
      : seg(P, 0.644, 0.658) * (1 - seg(P, 0.672, 0.692)) * 0.75)
    /* the arrival — retired while the cavern film carries the hand-off
       (film-to-film continues the very frame, so a veil would only smear
       it); the blink survives solely as the 404 fallback's softener, when
       the dive still releases into the live WebGL cavern */
    + (window.CAVERNFILM?.ready ? 0
      : seg(P, 0.744, 0.758) * (1 - seg(P, 0.764, 0.778)) * 0.42);
  chromaPass.uniforms.uFrost.value = Math.min(0.85, frost);
  chromaPass.uniforms.uSpace.value = 0;
  chromaPass.uniforms.uTime.value = time;

  /* ONE PULSE, TWO BODIES — the human's heart of light beats lub-dub and a
     pulse-wave washes through the glass; ~0.22s later the twin's golden
     mirror answers with the SAME beat, received as light. */
  if (heart && core) {
    const hb = heartbeat(time);
    const eb = heartbeat(time - 0.22);                  // the echo — your beat, arrived
    /* Glow UI — the DOM breathes with the heart: HUD corners and the wordmark
       star consume --pulse in CSS, so the whole instrument shares one pulse */
    if (!REDUCED) document.documentElement.style.setProperty('--pulse', hb.toFixed(3));
    heart.nucMat.opacity = (0.5 + 0.4 * hb) * humanAlpha;
    heart.nucleus.scale.setScalar(0.08 + 0.022 * hb);
    heart.lobe.scale.setScalar(0.052 + 0.014 * hb);
    heart.halo.material.opacity = (0.2 + 0.24 * hb) * humanAlpha;
    heart.halo.scale.setScalar(0.2 + 0.05 * hb);
    heart.light.intensity = (0.22 + 0.5 * hb) * humanAlpha;

    core.nucMat.opacity = (0.5 + 0.4 * eb) * twinAlpha;
    core.nucleus.scale.setScalar(0.08 + 0.022 * eb);
    core.lobe.scale.setScalar(0.052 + 0.014 * eb);
    core.halo.material.opacity = (0.18 + 0.24 * eb) * twinAlpha;
    core.halo.scale.setScalar(0.19 + 0.05 * eb);
    core.light.intensity = (0.2 + 0.45 * eb) * twinAlpha;

    /* the visible pulse: a wave launches from each chest at its beat's lub
       and expands through the body, fading as it travels */
    {
      const spH = smooth(splitPos);
      const hx = -GAP * spH - moat * 0.20, tx = GAP * spH + moat * 0.20;
      const CYCLE = 1.15, LUB = 0.10;
      const drive = (mat, x, t, alpha) => {
        const u = mat.userData.pulse;
        if (!u) return;
        const ph = (((t % CYCLE) + CYCLE) % CYCLE) / CYCLE;
        const wp = clamp01((ph - LUB) / 0.88);
        u.uHeartW.value.set(x + 0.03, 1.27, 0.02);
        u.uWaveR.value = wp * 2.15;
        u.uWaveAmp.value = ph < LUB ? 0 : Math.pow(1 - wp, 1.6) * 0.5 * alpha;
      };
      /* the human keeps only the chest-top heartbeat — no body-wide wave
         (user direction). The shader stays wired (amp 0) so this remains a
         one-line flip. The twin still visibly RECEIVES the pulse as gold. */
      const uH = matHuman.userData.pulse;
      if (uH) uH.uWaveAmp.value = 0;
      drive(matTwin, tx, time - 0.22, twinAlpha);
    }

    /* live instrument readouts */
    if (telBpm) telBpm.textContent = `${64 + Math.round(hb * 6)} BPM`;
  }
  /* the readout reaches the NAMESAKE number at the rest: moat eases to
     ~0.97 on the frame visitors dwell on, and "SEALED 98 YR" two lines
     above "held for a hundred years" broke the fiction (jury round 10) */
  if (telYr) telYr.textContent = `${Math.min(100, Math.round(moat * 103))} YR`;

  /* figures: the human is the constant; the twin is cast from it, sealed
     back into it before the deconstruction, and re-emerges at the finale. */
  if (figureLoaded) {
    const sway = Math.sin(time * 0.3) * 0.03;
    const sp = smooth(splitPos);
    const humanX = -GAP * sp - moat * 0.20;              // human eases left (further for the spire)
    const twinX = GAP * sp + moat * 0.20;                // twin eases right, mirrored

    figA.visible = humanAlpha > 0.01;
    figA.position.set(humanX, Math.sin(time * 0.5) * 0.01, 0);
    figA.rotation.y = sway + (1 - sp) * Math.sin(time * 0.12) * 0.12;
    matHuman.opacity = humanAlpha;

    figB.visible = sp > 0.002 && twinAlpha > 0.01;
    figB.position.set(twinX, Math.sin(time * 0.5 + 1) * 0.01, 0);
    figB.rotation.y = -sway;
    if (matTwin) { matTwin.opacity = twinAlpha; }
    /* the scene-level chest lights follow their bodies (they cannot live
       inside the toggled figures — see lightHeart) */
    if (heart) heart.light.position.set(humanX + 0.03, 1.27 + figA.position.y, 0.02);
    if (core) core.light.position.set(twinX - 0.03, 1.27 + figB.position.y, 0.02);
    /* arm the black-twin sentinel: while the twin stands fully cast on the
       bright surface, its chest pixel must never read black (see probeTwin) */
    _twinChest.set(twinX, 1.27, 0.05);
    _twinBright = sp > 0.6 && twinAlpha > 0.95 && masterP < 0.55
      && progress > 0.183 && progress < 0.90;

    shadowA.position.set(humanX, 0.01, 0);
    shadowB.position.set(twinX, 0.01, 0);
    shadowA.material.opacity = 0.72 * humanAlpha;
    shadowB.material.opacity = 0.72 * sp * twinAlpha;
    shadowA.scale.setScalar(1.3);
    shadowB.scale.setScalar(1.3);
  }

  /* authorized services + THE AWE MOMENT: the human's heart surges, and a wave
     of the one warm light travels from the heart, through the twin's core, and
     races out along light-threads to each service — igniting them one by one as
     the twin signs on the human's behalf. A shockwave rolls across the ice; the
     scene blooms. The card mirrors HUMAN-VERIFIED, seated right of the twin. */
  const authBeat = seg(p, 0.315, 0.345) * (1 - seg(p, 0.375, 0.405));
  const authFlow = clamp01((p - 0.320) / (0.374 - 0.320));   // 0..1 the signing wave
  bloom.strength = 0.34 + 0.04 * authBeat;                   // heart-surge glow (restrained)
  if (authBeat > 0.004 && figureLoaded && figB.visible) {
    const Wp = innerWidth, Hp = innerHeight, N = appChips.length;
    authNet.style.opacity = String(authBeat);
    authFx.style.opacity = '1';
    /* seat the card to the twin's right */
    _proj.set(figB.position.x + 0.5, 1.05, 0).project(camera);
    const rightX = (_proj.x * 0.5 + 0.5) * Wp;
    _proj.set(figB.position.x, 1.05, 0).project(camera);
    const twinY = (-_proj.y * 0.5 + 0.5) * Hp;
    if (!authMeasure) {
      const base = authNet.getBoundingClientRect();
      authMeasure = {
        pw: authNet.offsetWidth || 200,
        ph: authNet.offsetHeight || 240,
        rel: appChips.map((c) => {
          const r = c.el.getBoundingClientRect();
          return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 };
        })
      };
    }
    const pw = authMeasure.pw, ph = authMeasure.ph;
    let px = Math.min(rightX + 46, Wp - pw - 20);
    let py = Math.max(74, Math.min(Hp - ph - 20, twinY - ph / 2));
    /* narrow viewports: if the clamp would slide the panel ONTO the twin,
       give up the side-seat and drop to the centre gap beneath the pair —
       the placement that never crosses a body (the user's standing rule) */
    if (px < rightX - 6) {
      px = Math.max(12, (Wp - pw) / 2);
      py = Math.max(74, Hp - ph - Math.round(Hp * 0.09));
    }
    authNet.style.transform = `translate(${Math.round(px)}px, ${Math.round(py)}px)`;

    /* heart surge — the source of authority swells, but restrained (the
       threads + comets carry the energy, not a bloom white-out) */
    if (heart) {
      heart.halo.material.opacity = Math.min(1, heart.halo.material.opacity + 0.16 * authBeat);
      heart.halo.scale.setScalar(heart.halo.scale.x + 0.10 * authBeat);
      heart.light.intensity += 0.95 * authBeat;
      heart.nucleus.scale.multiplyScalar(1 + 0.10 * authBeat);
    }
    if (core) {
      core.halo.material.opacity = Math.min(1, core.halo.material.opacity + 0.13 * authBeat);
      core.light.intensity += 0.7 * authBeat;
    }

    /* shockwave rings roll out across the ice from the heart */
    shocks.forEach((s, i) => {
      s.visible = true;
      s.position.x = figA.position.x;
      const phc = (((authFlow * 1.25 + i * 0.5) % 1) + 1) % 1;
      s.scale.setScalar(1 + phc * 30);
      s.material.opacity = authBeat * (1 - phc) * (1 - phc) * 0.18;
    });

    /* the energy overlay: threads of light + travelling pulses + flares */
    const DPR = Math.min(devicePixelRatio || 1, 2);
    if (authFx.width !== Math.round(Wp * DPR) || authFx.height !== Math.round(Hp * DPR)) {
      authFx.width = Math.round(Wp * DPR); authFx.height = Math.round(Hp * DPR);
      authFx.style.width = Wp + 'px'; authFx.style.height = Hp + 'px';
    }
    const g = authFxCtx;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, Wp, Hp);
    g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    const lp = (a, b, t) => a + (b - a) * t;
    const beam = (x1, y1, x2, y2, a) => {
      if (a <= 0.002) return;
      g.strokeStyle = 'rgba(255,150,120,' + a + ')'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    };
    const flare = (x, y, r, a) => {
      if (a <= 0.002) return;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,244,236,' + a + ')');
      gr.addColorStop(0.4, 'rgba(255,140,108,' + (a * 0.75) + ')');
      gr.addColorStop(1, 'rgba(255,120,90,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    };
    /* a comet of light racing along a thread — bright head, fading tail */
    const comet = (x1, y1, x2, y2, pf, a) => {
      if (pf <= 0 || pf >= 1 || a <= 0.002) return;
      const tl = Math.max(0, pf - 0.22);
      const hxp = lp(x1, x2, pf), hyp = lp(y1, y2, pf);
      const txp = lp(x1, x2, tl), typ = lp(y1, y2, tl);
      const gr = g.createLinearGradient(txp, typ, hxp, hyp);
      gr.addColorStop(0, 'rgba(255,130,100,0)');
      gr.addColorStop(1, 'rgba(255,228,208,' + a + ')');
      g.strokeStyle = gr; g.lineWidth = 2.6;
      g.beginPath(); g.moveTo(txp, typ); g.lineTo(hxp, hyp); g.stroke();
      flare(hxp, hyp, 7, a);
    };
    /* heart (human) → core (twin) trunk */
    _proj.set(figA.position.x + 0.03, 1.28, 0.05).project(camera);
    const hx = (_proj.x * 0.5 + 0.5) * Wp, hy = (-_proj.y * 0.5 + 0.5) * Hp;
    _proj.set(figB.position.x + 0.03, 1.28, 0.05).project(camera);
    const kx = (_proj.x * 0.5 + 0.5) * Wp, ky = (-_proj.y * 0.5 + 0.5) * Hp;
    beam(hx, hy, kx, ky, (0.10 + 0.18 * authFlow) * authBeat);
    comet(hx, hy, kx, ky, clamp01(authFlow / 0.16), 0.85 * authBeat);
    flare(hx, hy, 12, 0.3 * authBeat);                    // the heart, alight
    flare(kx, ky, 9, 0.22 * authBeat);                    // the twin's core catches it
    /* core → each service, staggered */
    let maxFlare = 0;
    for (let i = 0; i < N; i++) {
      const c = appChips[i];
      /* chip centres derive from the panel seat + cached offsets — the rect
         read here used to force layout against this frame's transform write */
      const tx = px + authMeasure.rel[i].x, ty = py + authMeasure.rel[i].y;
      const ai = 0.16 + 0.80 * (N > 1 ? i / (N - 1) : 0);
      const signed = authFlow >= ai;
      if (signed !== c.authed) { c.authed = signed; c.el.classList.toggle('authorized', signed); }
      beam(kx, ky, tx, ty, (0.05 + 0.16 * clamp01((authFlow - (ai - 0.22)) / 0.22)) * authBeat);
      comet(kx, ky, tx, ty, clamp01((authFlow - (ai - 0.16)) / 0.16), 0.85 * authBeat);
      const fl = signed ? clamp01(1 - (authFlow - ai) / 0.12) : 0;
      if (fl > 0) { maxFlare = Math.max(maxFlare, fl); flare(tx, ty, 11 + 18 * fl, 0.5 * fl * authBeat); }
    }
    g.globalCompositeOperation = 'source-over';
    /* a whisper of aberration as the services ignite */
    chromaPass.uniforms.uAberr.value += authBeat * 0.04 + maxFlare * 0.09;
  } else if (lastAuthBeat > 0.004) {
    authNet.style.opacity = '0';
    authFx.style.opacity = '0';
    for (const c of appChips) { if (c.authed) { c.authed = false; c.el.classList.remove('authorized'); } }
    for (const s of shocks) { s.visible = false; s.material.opacity = 0; }
    authFxCtx.setTransform(1, 0, 0, 1, 0, 0);
    authFxCtx.clearRect(0, 0, authFx.width, authFx.height);
  }
  lastAuthBeat = authBeat;

  /* deconstruction + reassembly: the shard cloud disperses under the film,
     then converges again to rebuild the figure (the igloo signature) */
  if (shards) {
    shards.visible = shardAlpha > 0.01;
    if (shards.visible) {
      shardMat.uniforms.uDisperse.value = disperse * 2.2;
      shardMat.uniforms.uTime.value = time;
      shardMat.uniforms.uAlpha.value = Math.min(1, shardAlpha);
      shardMat.uniforms.uCam.value.copy(camera.position);
    }
  }

  /* explore blocks: five facets of the protocol, hover + click to open */
  blockGroup.visible = explore > 0.01;
  if (blockGroup.visible) {
    const W2 = innerWidth, H2 = innerHeight;
    let nearest = -1, nearestD = 110;
    for (let i = 0; i < exploreBlocks.length; i++) {
      const b = exploreBlocks[i];
      _proj.copy(b.mesh.position).project(camera);
      b.sx = (_proj.x * 0.5 + 0.5) * W2;
      b.sy = (-_proj.y * 0.5 + 0.5) * H2;
      const d = Math.hypot(b.sx - mouse.cx, b.sy - mouse.cy);
      if (d < nearestD) { nearestD = d; nearest = i; }
    }
    hoverBlock = nearest;
    /* the ring never crosses the bodies: a block passing in FRONT of a
       figure DUCKS until it has passed (the emblems were parking on the
       twins' heads at the protocol beats — copy never crosses the figures,
       and neither do the relics) */
    const spF = smooth(splitPos);
    _proj.set(-GAP * spF - moat * 0.20, 1.2, 0).project(camera);
    const f1x = (_proj.x * 0.5 + 0.5) * W2, f1z = _proj.z;
    _proj.set(GAP * spF + moat * 0.20, 1.2, 0).project(camera);
    const f2x = (_proj.x * 0.5 + 0.5) * W2, f2z = _proj.z;
    for (let i = 0; i < exploreBlocks.length; i++) {
      const b = exploreBlocks[i];
      const hovered = i === hoverBlock;
      const ease = smooth(explore);
      /* the facet orbits the standing human, rises from the ice as it appears,
         then sinks back into the ice — the human is never touched */
      /* a CROWN, not a full orbit — the card claims FIVE facets but a
         rotating ring never showed more than three: two pairs flank the
         sovereigns and the fifth floats crowned above them, all facing the
         visitor, swaying in place */
      /* a WIDE QUINTET flanking the pair — the crowned center emblem sat
         where any render fault lands on the sovereigns' heads (and did) */
      const arcFr = [-1.42, -0.78, 1.95, 0.78, 1.42][i] || 0;
      const a = Math.PI * 0.5 + arcFr + Math.sin(time * 0.11 + b.seed) * 0.07;
      const yLift = 0;
      const y = (b.ringY + yLift) * (1 - facetRise) - facetSink * 1.4
        + Math.sin(time * 0.5 + b.seed) * 0.06;
      /* matter hand-off: as the facets sink they also CONVERGE on the spot
         where the vault will rise — the protocol folds itself into the cube
         instead of five relics silently vanishing (jury round 10) */
      const rr = RING_R * 1.32 * (1 - facetSink * 0.82);
      b.mesh.position.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
      _proj.copy(b.mesh.position).project(camera);      // re-seat after the crown step
      b.sx = (_proj.x * 0.5 + 0.5) * W2;
      b.sy = (-_proj.y * 0.5 + 0.5) * H2;
      /* duck in FRONT of a figure or BEHIND it — the bodies are translucent
         glass, so a block passing behind still reads as a collision through
         the torso */
      const duck = !hovered &&
        (Math.abs(b.sx - f1x) < 90 || Math.abs(b.sx - f2x) < 90) ? 0.18 : 1;
      if (!REDUCED) b.mesh.rotation.y += (hovered ? 0.006 : 0.0018);
      const op = ease * (hovered ? 1.0 : 0.97) * duck;
      for (const m of b.mats) m.opacity = op;
      for (const m of b.edgeMats) m.opacity = ease * (hovered ? 0.8 : 0.38) * duck;
      b.mesh.scale.setScalar((0.55 + 0.45 * ease + (hovered ? 0.1 : 0)) * 1.15);
      b.spark.position.copy(b.mesh.position);
      b.spark.material.opacity = ease * (hovered ? 0.85 : 0.32) * duck
        * (0.75 + 0.25 * Math.sin(time * 1.3 + b.seed));
      /* centred above its block */
      if (b.el._lw === undefined || (_lblFrame + i) % 8 === 0) b.el._lw = b.el.offsetWidth || 60;
      b._lx = Math.max(10, Math.min(W2 - b.el._lw - 10, b.sx - b.el._lw / 2));
      b._ly = Math.max(70, Math.min(H2 - 140, b.sy - 92));
      /* the label lives and dies WITH its emblem — orphaned sky labels were
         hanging over the range after the facets dissolved */
      /* …and it NEVER prints over the signature film: the DOM labels ride
         above the film canvas, so they hold until the seal's legacy-0.522
         exit even though the emblems are already rising beneath (jury) */
      const sealGate = seg(p, 0.518, 0.528);
      b._op = op * (hovered ? 1 : 0.55) * duck * sealGate;
      b._hov = hovered;
    }
    /* label separation — two blocks can project into the same column; the
       later label steps a row down instead of overprinting */
    const bOrder = [...exploreBlocks].sort((p, q) => p._lx - q._lx);
    for (let i = 1; i < bOrder.length; i++) {
      for (let j = 0; j < i; j++) {
        const A = bOrder[j], B = bOrder[i];
        if (Math.abs(B._lx - A._lx) < (A.el._lw + B.el._lw) / 2 + 10 &&
            Math.abs(B._ly - A._ly) < 24) B._ly = A._ly + 26;
      }
    }
    for (const b of exploreBlocks) {
      b.el.style.transform = `translate(${b._lx}px, ${b._ly}px)`;
      b.el.style.opacity = String(b._op);
      /* a clicked block stays expanded while OPENING, even if the pointer
         drifts during the navigation delay */
      const opening = b.el.classList.contains('auth');
      b.el.classList.toggle('hot', b._hov || opening);
      if (opening) b.el.style.opacity = String(smooth(explore));
    }
    document.body.style.cursor = hoverBlock >= 0 && explore > 0.3 ? 'pointer' : '';
  } else {
    hoverBlock = -1;
    for (const b of exploreBlocks) b.el.style.opacity = '0';
    if (document.body.style.cursor === 'pointer' && lastGalaxy < 0.01) document.body.style.cursor = '';
  }

  /* pedestal rings pulse subtly, brighten during scan and under the vault */
  const moatGlow = moat * moatFade;
  rings.forEach((r, i) => {
    const base = 0.05 + 0.05 * Math.sin(time * 0.6 + i);
    r.material.opacity = base + scan * 0.5 + moatGlow * (0.34 - i * 0.08);
    r.scale.setScalar(1 + splitPos * 0.4);
  });

  /* amber intent light — restrained; color stays rare */
  amberLight.intensity = intent * 2.2;
  amberLight.position.x = 0;

  /* the Centennial Vault: a MONOLITH of void-black crystal calves up through
     the plain between the twins, its gold seams beating with the sealed
     heart. A monument does not float and does not spin — it RISES, then
     stands. While it stands, the whole world's light leans GOLD. */
  const moatVis = moat * moatFade;
  /* golden hour — scroll-reactive: the vault pulls the sun low and warm */
  {
    /* anticipation: the key leans faintly warm while the facets sink
       (p 0.80-0.86) — the dead beat before the vault calves gains a
       direction using only light, no new object (subtraction wins) */
    const gold = clamp01(smooth(moatVis) + 0.22 * seg(p, 0.80, 0.86) * moatFade);
    key.color.lerpColors(KEY_BASE, KEY_GOLD, gold * 0.85);
    key.intensity = 3.8 + 0.45 * gold;
    rim.color.lerpColors(RIM_BASE, RIM_GOLD, gold * 0.5);
    hemi.groundColor.lerpColors(HEMI_BASE, HEMI_GOLD, gold * 0.6);
  }
  /* past the midpoint, fetch the cube billboard so it's decoded well before
     its p≈0.86 entrance (the same lazy policy vaultfilm uses) */
  if (armVaultCube && p > 0.5) { const arm = armVaultCube; armVaultCube = null; arm(); }
  /* > 0.04, not > 0.01: at the window's first breath every part still sits
     at opacity ~0, and a poisoned program ignores opacity and paints an
     opaque black quad (measured: a depthTest-off frost plane as a black
     slab over the figures). Visibility is the one gate a broken program
     cannot ignore; the monolith is still 96% sunk at 0.04, so no pop. */
  vault.visible = moatVis > 0.04;
  if (vault.visible) {
    const ud = vault.userData;
    const grow = smooth(moatVis);
    vault.position.y = -2.7 * (1 - grow);                        // sunk in the ice -> seated on it
    vault.rotation.y = 0;
    vault.scale.setScalar(1);
    const hb = heartbeat(time);
    ud.iceMat.opacity = Math.min(1, moatVis * 1.35);
    /* the transparent-cube billboard (the real render) fades in with the beat */
    if (ud.cubeSpriteMat) ud.cubeSpriteMat.opacity = Math.min(1, moatVis * 1.35);
    /* frosted-ice edges catch a gold rim; the sealed heart's warmth breathes
       faintly through the whole clear mass (uniform amber, kept subtle so it
       never washes the ice orange) */
    ud.edgeMat.opacity = (0.30 + 0.22 * hb) * moatVis;
    if (ud.veinsReady) ud.iceMat.emissiveIntensity = (0.05 + 0.10 * hb) * moatVis;
    /* the museum sculpture (once arrived) breathes through its own painted
       veins — the baked kintsugi doubles as the emissive map */
    if (ud.hdMats) for (const m of ud.hdMats) {
      m.opacity = Math.min(1, moatVis * 1.35);
      m.emissiveIntensity = (0.7 + 1.0 * hb) * moatVis;
    }
    ud.fracMat.opacity = 0.15 * moatVis;                          // internal cleavage, barely there
    ud.fracMatB.opacity = 0.11 * moatVis;
    /* internal snowflake frost breathes in as the cube forms */
    if (ud.frostMats) for (const fm of ud.frostMats) fm.opacity = 0.8 * moatVis;
    /* the kept-object hardware: platinum band + gold hairline + seal ring */
    ud.bandMat.opacity = moatVis;
    ud.goldLineMat.opacity = moatVis;
    /* the hairline carries the pulse — and blazes while a name is struck */
    {
      /* frame-rate-independent decay: per-frame *=0.988 died twice as fast
         on 120Hz displays (the codebase's label easing already does this) */
      const nowS2 = performance.now() * 0.001;
      const sdt = Math.min(0.1, Math.max(0.001, nowS2 - (ud.__surgeT ?? nowS2)));
      ud.__surgeT = nowS2;
      ud.engraveSurge *= Math.pow(0.988, sdt * 60);
    }
    ud.goldLineMat.emissiveIntensity = 0.3 + 0.5 * hb + 1.1 * ud.engraveSurge;
    /* the ring's engraving steps aside while the standing vow words pass —
       three text layers were stacking in the same lower-third band */
    ud.sealMat.opacity = moatVis * (1 - 0.92 * _sovVis);
    /* gold dust rising around the monument — reborn at the base */
    {
      const mp = ud.motePos, ms2 = ud.moteSeed;
      for (let i = 0; i < ms2.length; i++) {
        const speed = 0.10 + ms2[i] * 0.14;
        mp[i * 3 + 1] = ((ms2[i] * 2.6 + time * speed) % 2.8);
        mp[i * 3] += Math.sin(time * 0.5 + ms2[i] * 31) * 0.0006;
        mp[i * 3 + 2] += Math.cos(time * 0.43 + ms2[i] * 17) * 0.0006;
      }
      ud.moteGeo.attributes.position.needsUpdate = true;
      /* fade with height is baked into the glow texture; gate on the beat */
      ud.moteMat.opacity = (0.32 + 0.18 * hb) * moatVis;
    }
    /* the heart ignores depth (it must glow THROUGH the ice) — so it has to
       wait below the surface during the rise or it ghosts through the floor */
    const heartUp = clamp01((vault.position.y + 1.32 - 0.35) / 0.5);
    ud.hMesh.material.opacity = moatVis * heartUp;
    ud.hMesh.scale.setScalar(1 + 0.16 * hb);
    ud.hMesh.rotation.y = time * 0.45;                            // the gem turns in its socket — facet glints
    ud.gemMat.emissiveIntensity = 0.5 + 0.55 * hb;                // the ember breathes with the heartbeat
    ud.gemEdgeMat.opacity = 0.5 * moatVis * heartUp;
    ud.hGlow.material.opacity = (0.24 + 0.22 * hb) * moatVis * heartUp;
    ud.hGlow.scale.setScalar(0.30 + 0.06 * hb);
    /* the heart's radiance rides the rise and beats — a glowing CORE that
       lights the inner facets of the translucent mass from within */
    quantumLight.position.y = vault.position.y + 1.32;
    quantumLight.intensity = moatVis * heartUp * (1.3 + 1.1 * hb);

    /* the inner ghost core breathes against the outer mass — deep structure */
    ud.coreEdgeMat.opacity = (0.14 + 0.05 * hb) * moatVis * heartUp;

    /* internal light shafts — volumetric blades waking from base to tip,
       each on its own slow phase, all swelling faintly with the heartbeat */
    for (let i = 0; i < ud.shaftMats.length; i++) {
      ud.shaftMats[i].opacity =
        (0.10 + 0.07 * Math.sin(time * 0.5 + i * 2.1) + 0.05 * hb) * moatVis * heartUp;
    }

    /* the monument's court — micro-shards in slow orbit, bobbing on their
       own phases, drifting up with the rise */
    {
      const od = ud.orbitDummy;
      for (let i = 0; i < ud.orbitData.length; i++) {
        const d = ud.orbitData[i];
        const a = d.a0 + time * d.sp;
        od.position.set(
          Math.cos(a) * d.r,
          d.y + Math.sin(time * 0.4 + d.bob * 7.0) * 0.06,
          Math.sin(a) * d.r
        );
        od.rotation.set(d.rx + time * 0.1, d.ry + time * 0.13, 0);
        od.scale.setScalar(d.s * (0.4 + 0.6 * grow));
        od.updateMatrix();
        ud.orbit.setMatrixAt(i, od.matrix);
      }
      ud.orbit.instanceMatrix.needsUpdate = true;
      ud.orbitMat.opacity = 0.8 * moatVis * heartUp;
    }

    /* the gold accretion nuggets are RETIRED — they were kintsugi gold seeding
       over the black shard; on the clear ice cube they read as floating debris.
       The gold now lives in the plinth, the edge-rim, the motes and the heart. */
    vaultCrystals.mat.opacity = 0;

    /* the vow lands in the world — each phrase at the feet of its subject,
       blurring in as the vault grows, clearing before the finale title card */
    {
      const sp2v = smooth(splitPos);
      const gm = smooth(moatVis);
      /* clear BEFORE the finale film owns the frame (film full by 0.93) —
         the vow title card is the only voice over the blaze */
      const sovFade = (1 - seg(p, 0.922, 0.936)) * moatFade;
      const anchors = [
        [-GAP * sp2v - moat * 0.20, -0.02, 0.35],
        [GAP * sp2v + moat * 0.20, -0.02, 0.35],
        [0, 0.02, 0.92]
      ];
      /* portrait: the three anchors converge into the same central band and
         the words overprinted into soup — stack them as three clean rows */
      const sovPortrait = innerWidth < innerHeight * 0.8;
      _sovVis = 0;
      for (let i = 0; i < sovWords.length; i++) {
        const s = sovWords[i];
        const w = clamp01((gm - s.at) / 0.16);
        _sovVis = Math.max(_sovVis, w * sovFade);
        _proj.set(anchors[i][0], anchors[i][1], anchors[i][2]).project(camera);
        if (!s.w && s.el.offsetWidth) s.w = s.el.offsetWidth;   // measured once, cached
        const half = (s.w || 100) / 2;
        let sx, sy;
        if (sovPortrait) {
          sx = innerWidth / 2;
          sy = innerHeight * 0.60 + i * (innerWidth < 480 ? 32 : 40);
        } else {
          /* clamp fully on-screen — on narrow viewports the figures stand at
             the frame edges and the words must not clip away */
          sx = Math.max(half + 10, Math.min(innerWidth - half - 10,
            (_proj.x * 0.5 + 0.5) * innerWidth));
          sy = (-_proj.y * 0.5 + 0.5) * innerHeight;
        }
        /* each word clamps to its OWN row, seated BELOW the figures' feet —
           one shared ceiling flattened the three onto one line, and higher
           rows crossed the twin's legs (copy never crosses the figures) */
        sy = Math.min(sy, innerHeight - 186 + i * 26);
        s.el.style.transform =
          `translate3d(${sx.toFixed(1)}px, ${(sy + 12 + (1 - w) * 18).toFixed(1)}px, 0) translateX(-50%)`;
        s.el.style.opacity = (w * sovFade).toFixed(3);
        s.el.style.filter = w < 0.995 ? `blur(${((1 - w) * 7).toFixed(1)}px)` : 'none';
      }
    }

    /* the claim invitation rides the same window as the standing phrases,
       and, once owned, stays as the quiet SEALED FOR {NAME} re-strike path
       (main.js swaps its copy) — a typo'd name must never be permanent */
    if (claimCta) {
      /* the claim invites twice: at the vault's face on the surface, and
         inside — beside the seal ring itself, where the name is struck */
      /* ONE invitation, in the chamber where the name is struck — the
         surface appearance stacked a fifth text system onto the vault
         reveal (jury, three rounds running) */
      claimCta.classList.toggle('on', P > 0.895 && P < 0.952);
    }

    /* LIGHT-THREADS — the two sovereigns feed the sealed heart: a warm
       blood-thread from the human's chest, a gold signal-thread from the
       twin's, each with a slow pulse of light travelling inward. The vault
       is not an object between them; it is OF them. */
    if (figureLoaded && heartUp > 0.05 && P <= 0.64) {
      /* ^ the threads exist only while the surface act owns the frame — in
         the cavern their surface anchors project to a degenerate squiggle
         (the jury's "stray orange glyph in the sky") */
      const Wp = innerWidth, Hp = innerHeight, DPR2 = Math.min(devicePixelRatio || 1, 2);
      if (vaultFx.width !== Math.round(Wp * DPR2) || vaultFx.height !== Math.round(Hp * DPR2)) {
        vaultFx.width = Math.round(Wp * DPR2); vaultFx.height = Math.round(Hp * DPR2);
      }
      const g2 = vaultFxCtx;
      g2.setTransform(DPR2, 0, 0, DPR2, 0, 0);
      g2.clearRect(0, 0, Wp, Hp);
      vaultFx.style.opacity = '1';
      const toScreen = (x, y, z) => {
        _proj.set(x, y, z).project(camera);
        return [(_proj.x * 0.5 + 0.5) * Wp, (-_proj.y * 0.5 + 0.5) * Hp];
      };
      /* same seat formula as the figure block (those consts are block-scoped) */
      const sp2 = smooth(splitPos);
      const [hxs, hys] = toScreen(-GAP * sp2 - moat * 0.20, 1.27, 0);
      const [txs, tys] = toScreen(GAP * sp2 + moat * 0.20, 1.27, 0);
      const [vxs, vys] = toScreen(0, vault.position.y + 1.32, 0);
      const thread = (x1, y1, cr, cg, cb, phase) => {
        const base = (0.10 + 0.10 * hb) * moatVis * heartUp;
        const midX = (x1 + vxs) / 2, midY = Math.min(y1, vys) - 26;   // a gentle lift
        for (const [w, aMul] of [[2.6, 0.45], [1, 1]]) {              // soft under-glow + crisp line
          g2.strokeStyle = `rgba(${cr},${cg},${cb},${(base * aMul).toFixed(3)})`;
          g2.lineWidth = w;
          g2.beginPath(); g2.moveTo(x1, y1); g2.quadraticCurveTo(midX, midY, vxs, vys); g2.stroke();
        }
        /* the travelling pulse — light flowing INTO the heart */
        const pf = ((time * 0.3 + phase) % 1 + 1) % 1;
        const u = 1 - pf, px = u * u * x1 + 2 * u * pf * midX + pf * pf * vxs,
              py = u * u * y1 + 2 * u * pf * midY + pf * pf * vys;
        const gr2 = g2.createRadialGradient(px, py, 0, px, py, 5);
        gr2.addColorStop(0, `rgba(${cr},${cg},${cb},${(base * 2.2).toFixed(3)})`);
        gr2.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        g2.fillStyle = gr2;
        g2.beginPath(); g2.arc(px, py, 5, 0, Math.PI * 2); g2.fill();
      };
      thread(hxs, hys, 255, 122, 92, 0.0);     // the human feeds it blood-warmth
      thread(txs, tys, 255, 178, 64, 0.5);     // the twin feeds it gold signal
    } else {
      vaultFx.style.opacity = '0';
    }
  } else {
    quantumLight.intensity = 0;
    for (const s of sovWords) s.el.style.opacity = '0';
    if (claimCta) claimCta.classList.remove('on');

    /* THE LINK — one pulse, two bodies: whenever both sovereigns stand
       apart, a hairline thread carries each heartbeat from the human's
       chest to the twin's; the travelling spark arrives exactly as the
       twin's golden echo fires (~0.22s). During the vault act the threads
       route through the monolith instead (drawn above). */
    const linkVis = figureLoaded && smooth(splitPos) > 0.6 ? Math.min(1, (smooth(splitPos) - 0.6) / 0.3) : 0;
    if (linkVis > 0.01) {
      const Wp = innerWidth, Hp = innerHeight, DPR2 = Math.min(devicePixelRatio || 1, 2);
      if (vaultFx.width !== Math.round(Wp * DPR2) || vaultFx.height !== Math.round(Hp * DPR2)) {
        vaultFx.width = Math.round(Wp * DPR2); vaultFx.height = Math.round(Hp * DPR2);
      }
      const g2 = vaultFxCtx;
      g2.setTransform(DPR2, 0, 0, DPR2, 0, 0);
      g2.clearRect(0, 0, Wp, Hp);
      vaultFx.style.opacity = '1';
      const spL = smooth(splitPos);
      const hxw = -GAP * spL - moat * 0.20, txw = GAP * spL + moat * 0.20;
      _proj.set(hxw + 0.03, 1.27, 0.02).project(camera);
      const x1 = (_proj.x * 0.5 + 0.5) * Wp, y1 = (-_proj.y * 0.5 + 0.5) * Hp;
      _proj.set(txw - 0.03, 1.27, 0.02).project(camera);
      const x2 = (_proj.x * 0.5 + 0.5) * Wp, y2 = (-_proj.y * 0.5 + 0.5) * Hp;
      const midX = (x1 + x2) / 2, midY = Math.min(y1, y2) - 18;
      const hbL = heartbeat(time);
      const base = (0.07 + 0.07 * hbL) * linkVis;
      for (const [w, aMul] of [[2.2, 0.4], [0.8, 1]]) {
        g2.strokeStyle = `rgba(255,170,90,${(base * aMul).toFixed(3)})`;
        g2.lineWidth = w;
        g2.beginPath(); g2.moveTo(x1, y1); g2.quadraticCurveTo(midX, midY, x2, y2); g2.stroke();
      }
      /* the spark: leaves the human at the lub, lands on the twin 0.22s
         later — the very moment the golden echo fires */
      const tIn = ((time % 1.15) + 1.15) % 1.15 - 0.115;          // seconds since the lub peak
      if (tIn >= 0 && tIn <= 0.22) {
        const uT = tIn / 0.22, uI = 1 - uT;
        const px = uI * uI * x1 + 2 * uI * uT * midX + uT * uT * x2;
        const py = uI * uI * y1 + 2 * uI * uT * midY + uT * uT * y2;
        const gr2 = g2.createRadialGradient(px, py, 0, px, py, 5.5);
        gr2.addColorStop(0, `rgba(255,190,110,${(0.65 * linkVis).toFixed(3)})`);
        gr2.addColorStop(1, 'rgba(255,190,110,0)');
        g2.fillStyle = gr2;
        g2.beginPath(); g2.arc(px, py, 5.5, 0, Math.PI * 2); g2.fill();
      }
    } else {
      vaultFx.style.opacity = '0';
    }
  }

  /* the gateway galaxy is retired — its sprites/labels stay dormant */
  galaxyGroup.visible = false;

  /* whiteout: a brief flash near the end that clears by p=1 so it never
     lingers over the sections below once the pin releases */
  if (whiteout) {
    /* the true finale now lives at the top of the RETURN: the camera rises
       into the oculus and the light takes the frame, clearing by P=1 so the
       resting frame is the godray, the vow and the name */
    /* rises only after the investors plate has fully cleared (0.968) */
    /* the un-flash EXHALES over the last 0.015 instead of snapping off
       inside the final 0.01 — the white releases into the godray rest */
    const flash = seg(P, 0.960, 0.988) * (1 - seg(P, 0.985, 1.0));
    whiteout.style.opacity = String(flash * 0.88);
  }

  /* camera — the surface line until the dive film covers the cut, then
     the cavern owns the lens (its sampler applies its own portrait fit) */
  if (inCavern) {
    sampleCavernCamera(P);
  } else {
    sampleCamera(p);
    /* portrait fit for the vault act: the FOV is vertical, so horizontal
       coverage collapses on tall screens — the cube billboard went full-bleed
       and both figures cropped out at 375px. Dolly back along the view axis,
       ramping in with the act; desktop (aspect >= 1.05) is untouched and every
       earlier beat's tuned framing renders identically. */
    const vaultK = seg(p, 0.84, 0.90);
    if (vaultK > 0) {
      const fitK = 1 + (Math.max(1, Math.min(1.9, 1.05 / camera.aspect)) - 1) * vaultK;
      if (fitK > 1.001) camPos.sub(camLook).multiplyScalar(fitK).add(camLook);
    }
    /* same fit for the facet act — the card says TAP A FACET while the
       tappable ring cropped out of a 375px frame */
    const facetK = seg(p, 0.50, 0.56) * (1 - seg(p, 0.70, 0.76));
    if (facetK > 0) {
      const fk = 1 + (Math.max(1, Math.min(2.6, 1.12 / camera.aspect)) - 1) * facetK;
      if (fk > 1.001) camPos.sub(camLook).multiplyScalar(fk).add(camLook);
    }
  }
  if (window.__enterWorld) {
    window.__enterWorld = false;
    if (!REDUCED && masterP < 0.03 && !_fzMode) { _introT = 0; _introLastT = time; }
  }
  if (_introT >= 0 && _introT < 1) {
    _introT = Math.min(1, _introT + Math.min(0.05, Math.max(0.001, time - _introLastT)) / 3.2);
    /* scroll RATCHETS the fall instead of fighting it: an impatient hand
       used to rubber-band against the blend (scrub moved the camera, the
       intro dragged it back); now scrolling completes the descent — the
       camera dives faster to meet the visitor. Patient visitors see the
       untouched 3.2s fall (masterP stays ~0). */
    _introT = Math.max(_introT, smooth(clamp01(masterP / 0.03)));
    _introLastT = time;
    const ik = Math.pow(1 - _introT, 3);
    camPos.lerp(_introStart, ik);
    camLook.lerp(_introLook, ik);
  }
  mouse.x += (mouse.tx - mouse.x) * 0.04;
  mouse.y += (mouse.ty - mouse.y) * 0.04;
  camera.position.copy(camPos);
  /* never-still camera — the film breathes even at rest (igloo's signature).
     Incommensurate sine pairs read as organic handheld drift, never a loop;
     REDUCED drops it so motion-sensitive visitors get a steady frame. */
  if (!REDUCED) {
    /* scroll speed leans on the lens like wind pressure (velocity weather) */
    const bk = 1 + 0.5 * _windK;
    camera.position.x += (Math.sin(time * 0.23) * 0.05 + Math.sin(time * 0.071 + 1.7) * 0.035) * bk;
    camera.position.y += (Math.sin(time * 0.31 + 0.6) * 0.03 + Math.sin(time * 0.047) * 0.022) * bk;
    camera.position.z += Math.sin(time * 0.17 + 3.1) * 0.035 * bk;
    /* snap-arrival settle: one deep decaying exhale when a beat is reached */
    const st = time - _settleAt;
    if (st > 0 && st < 2.2) {
      camera.position.y -= Math.exp(-st * 1.8) * 0.05 * Math.sin(st * 3.1);
    }
  }
  camera.position.x += mouse.x * 0.18;
  camera.position.y += -mouse.y * 0.10;
  camera.lookAt(
    camLook.x + mouse.x * 0.2 + (REDUCED ? 0 : Math.sin(time * 0.19 + 0.9) * 0.022),
    camLook.y - mouse.y * 0.12 + (REDUCED ? 0 : Math.sin(time * 0.27 + 2.2) * 0.016),
    camLook.z
  );
  /* the lens focuses on the story's subject — DOF rides the look target */
  if (bokehPass) bokehPass.uniforms['focus'].value = camera.position.distanceTo(camLook);

  /* ---------------- the heart cavern, alive ---------------- */
  if (cavGroup.visible) {
    const chb = heartbeat(time);
    /* the chamber's own KEY — pull the height-fog whiteout and the exposure
       down inside the ice: the climax must have a black point (the jury
       measured the arrival's tonal range at 42 vs the films' 112; 'too
       much light and flashy' is an explicit anti-reference) */
    /* full key BEFORE the film releases the frame (0.778) — frame one of
       the live chamber must already have tone, or the handoff reads as
       waking up in a different room */
    /* key in over the arrival: the dive film EXITS bright (l~0.88), so
       full key at the handoff frame made a tonal cliff — the chamber now
       meets the film at its brightness and deepens INTO the act */
    const cavKey = seg(P, 0.765, 0.802);
    scene.fog.density = 0.016 * (1 - 0.88 * cavKey);
    renderer.toneMappingExposure = 0.88 * (1 - 0.18 * cavKey);
    cavDomeMat.uniforms.uTime.value = time % 3600.0;
    godrayMat.uniforms.uTime.value = time % 3600.0;
    /* the return brightens the shaft — the light literally receives you */
    godrayMat.uniforms.uAmp.value = 0.26 + 0.10 * chb + seg(P, 0.94, 1.0) * 0.9;
    cavHeart.scale.setScalar(1 + chb * 0.16);
    /* additive light on a WHITE world saturates fast — the glow stays a
       breath, the gem itself carries the red */
    /* the glows die into the whiteout — a residual pink smear was staining
       the vow type at 0.97 */
    const glowKill = 1 - seg(P, 0.952, 0.985);
    cavGlowIn.scale.setScalar(2.4 * (1 + chb * 0.35));
    cavGlowIn.material.opacity = (0.22 + chb * 0.18) * glowKill;
    cavGlowOut.scale.setScalar(9.5 * (1 + chb * 0.2));
    cavGlowOut.material.opacity = (0.06 + chb * 0.05) * glowKill;
    cavHeartMat.emissiveIntensity = 1.0 + chb * 1.0;
    cavNucleus.scale.setScalar(1.35 * (1 + chb * 0.22));
    cavNucleus.material.opacity = (0.5 + 0.22 * chb) * glowKill;
    cavCore.scale.setScalar(0.5 * (1 + chb * 0.3));
    cavCore.material.opacity = (0.7 + 0.3 * chb) * glowKill;
    if (rubyReady) {
      rubySprite.scale.set(1.58 * (1 + chb * 0.09), 1.29 * (1 + chb * 0.09), 1);
      rubyMat.opacity = Math.min(1, seg(P, 0.755, 0.79) * 1.2);
    }
    cavFloorGlow.material.opacity = (0.07 + chb * 0.07) * seg(P, 0.70, 0.78);
    cavRingMat.emissiveIntensity = 0.10 + chb * 0.10;
    latticeG.rotation.y = time * 0.05;
    /* the lattice steps aside for the eye: any shard near the camera→heart
       sightline fades so the ruby always reads WHOLE on screen */
    _shA.set(CAV.x, CAV.y + 3.05, CAV.z);            // the heart, world space
    _shAB.copy(_shA).sub(camera.position);
    const _shLen2 = Math.max(1e-6, _shAB.lengthSq());
    for (const sh of latticeShards) {
      sh.getWorldPosition(_shP);
      _shAP.copy(_shP).sub(camera.position);
      const t = clamp01(_shAP.dot(_shAB) / _shLen2);
      /* nearest point on the camera→heart segment, then the miss distance */
      _shAP.copy(camera.position).addScaledVector(_shAB, t);
      const d = _shP.distanceTo(_shAP);
      sh.material.opacity = 0.06 + 0.50 * smooth(clamp01((d - 0.55) / 1.1));
    }
    shaftMotes.rotation.y = time * 0.016;
    shaftMotes.position.y = Math.sin(time * 0.11) * 0.35;
    cavAirMotes.rotation.y = -time * 0.008;
    /* the moat numbers count up the first time the wall is read */
    if (countRun) {
      let live = false;
      for (const c of document.querySelectorAll('#plate-specs .pcount')) {
        if (c._t0 === undefined) continue;
        const k = Math.min(1, (performance.now() - c._t0) / 1900);
        const e = 1 - Math.pow(1 - k, 4);
        c.textContent = String(Math.round((c._target || 0) * e));
        if (k < 1) live = true;
      }
      if (!live) countRun = false;
    }
    /* the reading deck + the belief ladder, seated in the chamber.
       REDUCED visitors read the static page sections instead (main.js keeps
       them visible), so the projected copy stays out of their calm frame. */
    if (!REDUCED) {
      _cproj.set(CAV.x, CAV.y + 3.05, CAV.z).project(camera);
      _heartScr.x = (_cproj.x * 0.5 + 0.5) * innerWidth;
      _heartScr.y = (-_cproj.y * 0.5 + 0.5) * innerHeight;
      let plateMax = 0;
      for (const pl of cavPlates) plateMax = Math.max(plateMax, seatCavPlate(pl, P, innerWidth, innerHeight, false));
      /* the strip/band separation replaced the squelch: the declarations
         hold the top band, the plates the body — both always readable */
      void plateMax;
      _declSquelch = 0;
      for (const d of cavDecls) seatCavPlate(d, P, innerWidth, innerHeight, true);
    }
  } else {
    scene.fog.density = 0.016;
    renderer.toneMappingExposure = 0.88;
    for (const pl of cavPlates) {
      pl.el.style.opacity = '0'; pl.el.style.visibility = 'hidden';
      pl.el.classList.remove('live');
    }
    for (const d of cavDecls) { d.el.style.opacity = '0'; d.el.style.visibility = 'hidden'; }
  }

  /* ---------------- side labels (no leaders) ----------------
     Each card simply APPEARS beside its subject object — preferring the
     object's right side, falling back to its left — never across a body,
     and never with a pointing line. Proximity alone carries the meaning. */
  const W = innerWidth, H = innerHeight;

  /* project each object to a padded screen column (so a card can never land
     across a figure or the spire), plus the screen point to sit beside */
  const columnOf = (x, y, z, halfW, pad) => {
    _proj.set(x, y, z).project(camera);
    const cx = (_proj.x * 0.5 + 0.5) * W;
    const cy = (-_proj.y * 0.5 + 0.5) * H;
    _proj.set(x + halfW, y, z).project(camera);
    const ex = (_proj.x * 0.5 + 0.5) * W;
    const r = Math.abs(ex - cx) + pad;
    return { cx, cy, a: cx - r, b: cx + r };
  };
  const colA = figureLoaded && figA.visible ? columnOf(figA.position.x, 1.18, figA.position.z, 0.62, 30) : null;
  const colB = figureLoaded && figB.visible ? columnOf(figB.position.x, 1.18, figB.position.z, 0.62, 30) : null;
  /* anchor the vault's column at its SUMMIT so the float-above fallback
     clears the full stone, never ghosting the card onto the black mass */
  const colM = vault.visible ? columnOf(0, 2.15, 0, 0.68, 34) : null;
  const keepouts = [];
  if (colA) keepouts.push([colA.a, colA.b]);
  if (colB) keepouts.push([colB.a, colB.b]);
  if (colM) keepouts.push([colM.a, colM.b]);
  const clear = (x, w2) => x >= 20 && x + w2 <= W - 20 && !keepouts.some(([a, b]) => x < b && x + w2 > a);

  /* which object each card sits beside */
  const beside = [colA, colB, colA, colM, null];   // HUMAN · TWIN · VERIFIED(beside human) · MOAT · caption

  /* frame-rate-corrected easing: the same settle speed at 30/60/120Hz
     (wall-clock, not scene time — scene time freezes under reduced motion) */
  const nowS = performance.now() / 1000;
  const labelDt = Math.min(0.1, Math.max(0.001, nowS - lastLabelT));
  lastLabelT = nowS;
  _lblFrame++;
  const easeK = 1 - Math.pow(0.86, labelDt * 60);
  const windows = [
    seg(p, 0.035, 0.065) * (1 - seg(p, 0.11, 0.14)),      // THE HUMAN (after the hero clears)
    seg(p, 0.23, 0.26) * (1 - seg(p, 0.29, 0.32)),        // THE DIGITAL TWIN
    seg(p, 0.32, 0.35) * (1 - seg(p, 0.38, 0.41)),        // HUMAN-VERIFIED (before the seal + film)
    seg(p, 0.900, 0.912) * (1 - seg(p, 0.93, 0.945)),     /* CENTENNIAL MOAT — in only once the
                                                             cube has presence (its 10%-opacity ghost
                                                             was bleeding into the range at 057%);
                                                             fully lit by the 0.5885 rest */
    explore                                               // THE PROTOCOL (explore caption)
  ];
  for (let i = 0; i < labels.length; i++) {
    const w = windows[i], label = labels[i], leader = leaderEls[i];
    if (!label) continue;
    if (leader) { leader.path.style.opacity = '0'; leader.dot.style.opacity = '0'; }  // leaders retired
    if (w <= 0.01) {
      label.style.opacity = '0'; label.style.visibility = 'hidden';
      scrambled[i] = false; labelState[i] = null;
      continue;
    }
    if (!scrambled[i] && w > 0.5) {
      scrambled[i] = true;
      const h2el = label.querySelector('h2');
      if (h2el) scrambleIn(h2el);
      window.SFX?.telemetry(5);          // the card reveals with a soft swell
      // (narration is scene-driven in main.js — it always speaks the scene
      //  you're actually viewing, so it never drifts out of sync)
    }
    /* chapter 5 is a fixed cinematic caption */
    if (i === 4) {
      label.style.visibility = 'visible';
      label.style.opacity = String(w);
      label.style.transform = `translate(${Math.max(24, W * 0.06)}px, ${H - 300 + (1 - w) * 12}px)`;
      label.style.filter = w < 0.995 ? `blur(${((1 - w) * 4).toFixed(1)}px)` : 'none';
      continue;
    }

    // cache card dimensions; re-measure staggered (1 card/frame) not all-every-
    // frame — reading offsetWidth interleaved with writes forces layout thrash
    if (label._lw === undefined || (_lblFrame + i) % 8 === 0) {
      label._lw = label.offsetWidth || Math.min(300, W * 0.8);
      label._lh = label.offsetHeight || 180;
    }
    const lw = label._lw, lh = label._lh;
    const col = beside[i] || colA || colB || colM;

    let targetX, targetY;
    /* portrait: the card seats BELOW the faces — a mid-height card was
       slicing both figures at head height while 40% of the frame sat empty */
    const portraitFloor = W < H * 0.8 ? H * 0.52 : 84;
    const besideY = Math.max(portraitFloor, Math.min(H - lh - 40, col ? col.cy - lh * 0.42 : H * 0.3));
    if (col) {
      const gap = 46;
      const right = col.b + gap;
      const left = col.a - gap - lw;
      if (clear(right, lw)) { targetX = right; targetY = besideY; }        // prefer the object's right
      else if (clear(left, lw)) { targetX = left; targetY = besideY; }     // else its left
      else {
        /* both sides blocked: widest clear gap, else float ABOVE the object
           in clean sky so the card never crosses a body (narrow viewports) */
        const spans = [...keepouts].sort((a, b) => a[0] - b[0]);
        let best = [20, W - 20], bestW = 0, cur = 20;
        for (const [a, b] of spans) { if (a - cur > bestW) { bestW = a - cur; best = [cur, a]; } cur = Math.max(cur, b); }
        if (W - 20 - cur > bestW) { bestW = W - 20 - cur; best = [cur, W - 20]; }
        if (bestW >= lw + 12) {
          targetX = Math.max(20, Math.min(W - lw - 20, (best[0] + best[1]) / 2 - lw / 2));
          targetY = besideY;
        } else {
          targetX = Math.max(20, Math.min(W - lw - 20, col.cx - lw / 2));
          targetY = Math.max(84, Math.min(H - lh - 40, col.cy - lh - 118));
        }
      }
    } else {
      targetX = W - lw - 24;
      targetY = Math.max(84, H * 0.12);
    }

    /* hysteresis: ease toward the slot, jump only if the held slot goes stale */
    let st = labelState[i];
    if (!st) st = labelState[i] = { x: targetX, y: targetY };
    if (!clear(st.x, lw) && Math.abs(st.x - targetX) > 1) st.x = targetX;
    st.x = lerp(st.x, targetX, easeK);
    st.y = lerp(st.y, targetY, easeK);

    label.style.visibility = 'visible';
    label.style.opacity = String(w);
    /* the condense-from-air grammar (the sov-words' entrance): a small rise +
       a blur that clears as the window opens — scrubbed via w, so fully
       interruptible and reduced-motion safe */
    label.style.transform = `translate(${st.x}px, ${st.y + (1 - w) * 12}px)`;
    label.style.filter = w < 0.995 ? `blur(${((1 - w) * 4).toFixed(1)}px)` : 'none';
  }
}

/* ---------------- loop ---------------- */
const clock = new THREE.Clock();

/* BLACK-TWIN SENTINEL — the twin's transmission program intermittently
   compiles into a state that paints the body solid black for the whole
   session (a load-order race, ~1 in 5-10 cold loads; the rim stays gold so
   only the transmitted interior dies). It cannot be reproduced on demand,
   so the page checks ITSELF: one 1x1 readPixels at the twin's chest every
   ~45 frames while the twin stands bright on the surface. Two consecutive
   black reads -> force the figure programs to recompile (heals it); six
   healthy reads -> the sentinel retires for the session. Cost: nothing. */
const _twinChest = new THREE.Vector3();
let _twinBright = false, _twinProbeDone = false;
let _twinProbeFrame = 0, _twinBlackStreak = 0, _twinHealthy = 0, _twinHealTries = 0;
const _probePx = new Uint8Array(4);
/* FRAME SENTINEL — last line of defense against the poisoned-program
   roulette: on a context-pressured GPU one random shader program per
   session can compile broken and paint an opaque black region onto the
   bright world (it ignores opacity and can rasterize displaced vertices,
   so no object-level guard can be complete). The surface acts NEVER
   contain pure black — plain, sky, range and figures all sit far above
   it. A sparse 15-point grid probe that finds pure black on two
   consecutive checks forces a context loss; the guarded recovery below
   reloads ONCE, and the fresh session re-rolls a clean compile. */
let _fsFrame = 0, _fsStrikes = 0, _fsDone = false, _fsLastBlack = -1;
/* THE ENTRANCE — the film FALLS to its opening frame: a one-shot descent
   from altitude that lands exactly on the hero camera as the title
   strikes. Pure blend-out — at t=1 the scroll camera owns the lens
   unchanged. Skipped for reduced motion, deep restores and the freeze
   harness. */
let _introT = -1, _introLastT = 0;
const _introStart = new THREE.Vector3(9, 26, 30);
const _introLook = new THREE.Vector3(0, 3.2, 0);
const _fzMode = new URLSearchParams(location.search).has('freeze');
const _fsPx = new Uint8Array(4);
function probeFrame() {
  if (_fsDone || !figureLoaded || masterP > 0.55 || masterP < 0.02) return;
  if ((++_fsFrame) % 60 !== 0) return;
  const gl = renderer.getContext();
  const W2 = gl.drawingBufferWidth, H2 = gl.drawingBufferHeight;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let black = 0;
  for (let gy = 0.30; gy <= 0.71; gy += 0.20) {
    for (let gx = 0.20; gx <= 0.81; gx += 0.15) {
      gl.readPixels((gx * W2) | 0, (gy * H2) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, _fsPx);
      if (_fsPx[0] + _fsPx[1] + _fsPx[2] < 33) black++;   /* grain/dither ride ~±4 per channel above true black */
    }
  }
  _fsLastBlack = black;
  if (black >= 2) {
    if (++_fsStrikes >= 2) {
      _fsDone = true;
      try {
        if (!sessionStorage.getItem('twinsCtxReload')) renderer.forceContextLoss();
      } catch (_) { /* storage blocked — do not risk a reload loop */ }
    }
  } else {
    _fsStrikes = 0;
  }
}
function probeTwin() {
  if (_twinProbeDone || !_twinBright || !figureLoaded) return;
  if ((++_twinProbeFrame) % 30 !== 0) return;
  _proj.copy(_twinChest).project(camera);
  if (_proj.z > 1 || _proj.z < -1) return;
  const gl = renderer.getContext();
  const px = Math.round((_proj.x * 0.5 + 0.5) * gl.drawingBufferWidth);
  const py = Math.round((_proj.y * 0.5 + 0.5) * gl.drawingBufferHeight);
  if (px < 0 || py < 0 || px >= gl.drawingBufferWidth || py >= gl.drawingBufferHeight) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, _probePx);
  if (_probePx[0] + _probePx[1] + _probePx[2] < 30) {
    _twinHealthy = 0;
    if (++_twinBlackStreak >= 2) {
      _twinBlackStreak = 0;
      /* the twin is opaque gold now (transmission retired — the buffer it
         sampled could render black); any residual black is a compile-state
         fluke a recompile clears */
      if (_twinHealTries++ < 4) {
        matTwin.needsUpdate = true; matHuman.needsUpdate = true;
      } else {
        _twinProbeDone = true;
      }
    }
  } else {
    _twinBlackStreak = 0;
    if (++_twinHealthy >= 6) _twinProbeDone = true;   // confirmed healthy
  }
}

function render() {
  // reduced motion: the scene still scrubs with scroll, but all autonomous
  // motion (bob, orbit, heartbeat, sky drift) holds on one frozen instant
  update(REDUCED ? 20.0 : clock.getElapsedTime());
  composer.render();
  probeTwin();
  probeFrame();
}
// dev-only: sentinel state for the capture harness
if (new URLSearchParams(location.search).has('forcetick')) {
  window.__twinSentinel = () => ({
    armed: _twinBright, frame: _twinProbeFrame, black: _twinBlackStreak,
    healthy: _twinHealthy, tries: _twinHealTries, done: _twinProbeDone
  });
  window.__frameSentinel = () => ({ f: _fsFrame, strikes: _fsStrikes, done: _fsDone, lastBlack: _fsLastBlack });
}
function tickLoop() { requestAnimationFrame(tickLoop); fitToStage(); render(); }

function fitToStage() {
  const [w, h] = stageSize();
  if (renderer.domElement.width === Math.floor(w * renderer.getPixelRatio()) &&
      renderer.domElement.height === Math.floor(h * renderer.getPixelRatio())) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  chromaPass.uniforms.uRes.value.set(w, h);
}
/* ---------------- guarded boot ----------------
   Prove the whole pipeline (materials, shaders, post-processing) can render
   one real frame BEFORE we retire the particle fallback. If it throws, we
   stay in fallback mode: the #figure canvas keeps the hero alive and main.js
   drives it (window.WORLD is never marked ready). */
let __worldOK = false;
try {
  fitToStage();
  /* pre-compile EVERY material now, while the loader still owns the screen —
     including the hidden ones (vault, facets, galaxy). Otherwise each scene's
     first appearance pays its shader compile as a mid-story jank. */
  renderer.compile(scene, camera);
  render();
  __worldOK = true;
  performance.mark('twins:first-frame');
  if (new URLSearchParams(location.search).has('forcetick'))
    console.info('[world] first frame in %dms (shaders pre-compiled)', Math.round(performance.now()));
} catch (err) {
  window.WORLD_FAILED = true;
  console.error('[world] pipeline failed its first frame — using particle fallback', err);
}

if (__worldOK) {
  window.WORLD = { ready: true, setProgress(v) {
    masterP = clamp01(v);
    progress = warpLegacy(masterP);
  }, settle() { _settleAt = _nowTime; } };
  addEventListener('resize', fitToStage);
  tickLoop();

  // only now that WebGL is proven, retire the fallback so it stops rendering
  const _fig = document.getElementById('figure');
  if (_fig) _fig.remove();

  /* GPU context loss (driver reset, tab parked for hours, memory pressure)
     would freeze the canvas. Prevent the default so the browser can restore
     it; if it can't recover in this session, reload ONCE (guarded so a truly
     dead GPU can never loop) to rebuild the context or fall through to the
     particle hero. */
  const canvasEl = renderer.domElement;
  canvasEl.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    try {
      if (!sessionStorage.getItem('twinsCtxReload')) {
        sessionStorage.setItem('twinsCtxReload', '1');
        location.reload();
      }
    } catch (_) { /* storage blocked — leave the last frame up */ }
  }, false);
  canvasEl.addEventListener('webglcontextrestored', () => {
    try { sessionStorage.removeItem('twinsCtxReload'); } catch (_) {}
  }, false);
  // a healthy run clears the guard so a later, unrelated loss can recover too
  setTimeout(() => { try { sessionStorage.removeItem('twinsCtxReload'); } catch (_) {} }, 8000);

  if (new URLSearchParams(location.search).has('forcetick')) {
    window.__drawWorld = render;
    window.__scene = scene;            // debug-only: verification probes
    window.__composer = composer;      // debug-only: post-chain bisection
  }
} else {
  // tear down the dead WebGL canvas so the particle #figure shows cleanly
  try { renderer.domElement.remove(); renderer.dispose?.(); } catch (_) {}
}
