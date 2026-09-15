// 3D virtual office. Renders a desk + monitor + avatar for each teammate and
// reflects live presence: online desks glow with light + an active monitor,
// offline desks sit dark. Driven by app.js via window.office3d.update(users).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildRoom, loadModel } from './office-room.js';

const mount = document.getElementById('office-3d');

let renderer, scene, camera, composer, bloomPass, roomGroup;
let deskGroup;                 // holds all desks
const desks = new Map();       // userId -> { group, screenMat, glow, light, bodyMat, headMat, online }
let ready = false;

// Camera orbit state (drag to rotate, wheel to zoom).
let azimuth = 0.05;
let polar = Math.PI * 0.32;
let radius = 12;
let autoRotate = true;
let autoDir = 1;
let dragging = false;
let lastX = 0, lastY = 0;
const AZ_LIMIT = 0.6; // keep the camera in front of the room (no wall backs)

const COLORS = {
  online: 0x6366f1,
  onlineEmissive: 0x4f46e5,
  offline: 0x3a3f55,
  floor: 0x14161f,
  desk: 0x2a2f42,
  deskTop: 0x343b54
};

// Per-teammate neon theme (matches the spec). Falls back by index for others.
const THEMES = { Aviral: 0x22c55e, Arjun: 0x3b82f6, Pradhuman: 0xa855f7 };
const FALLBACK_THEMES = [0x6366f1, 0x22c55e, 0xa855f7, 0xf59e0b, 0xef4444];
function themeColor(user, index) {
  return THEMES[user.username] != null ? THEMES[user.username] : FALLBACK_THEMES[index % FALLBACK_THEMES.length];
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f111a);
  scene.fog = new THREE.Fog(0x0f111a, 30, 70);

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';

  // Image-based lighting from a procedural room — soft PBR reflections/ambient.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // Lighting
  scene.add(new THREE.AmbientLight(0x404a6b, 0.6));
  const key = new THREE.DirectionalLight(0xaab4ff, 1.2);
  key.position.set(6, 12, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 40;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6366f1, 0.5);
  rim.position.set(-8, 5, -6);
  scene.add(rim);

  // Modular procedural room (floor, walls, sofa, whiteboard, bookshelf, plants).
  roomGroup = buildRoom();
  scene.add(roomGroup);

  deskGroup = new THREE.Group();
  deskGroup.position.z = 2.6; // bring workstations toward the front of the room
  scene.add(deskGroup);

  // Post-processing: bloom makes the neon outlines and screens glow.
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.5, 0.82);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  setupControls();
  observeResize();
  resize();
  ready = true;
}

// ---------------------------------------------------------------------------
// Building a single workstation
// ---------------------------------------------------------------------------
function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(15,17,26,0.85)';
  roundRect(ctx, 4, 8, 248, 44, 12);
  ctx.fill();
  ctx.font = 'bold 30px -apple-system, Segoe UI, sans-serif';
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(2.6, 0.65, 1);
  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

function buildDesk(user, index) {
  const g = new THREE.Group();
  const theme = themeColor(user, index);

  // Desk top
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.12, 1.2),
    new THREE.MeshStandardMaterial({ color: COLORS.deskTop, roughness: 0.6, metalness: 0.3 })
  );
  top.position.y = 1.0;
  top.castShadow = true; top.receiveShadow = true;
  g.add(top);

  // Desk legs
  const legGeo = new THREE.BoxGeometry(0.12, 1.0, 0.12);
  const legMat = new THREE.MeshStandardMaterial({ color: COLORS.desk, roughness: 0.7 });
  [[-1.05, -0.5], [1.05, -0.5], [-1.05, 0.5], [1.05, 0.5]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, 0.5, z);
    leg.castShadow = true;
    g.add(leg);
  });

  // Monitor stand + screen
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.35, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x1c2030 })
  );
  stand.position.set(0, 1.25, -0.35);
  g.add(stand);

  const screenMat = new THREE.MeshStandardMaterial({
    color: 0x0a0c14, emissive: theme, emissiveIntensity: 0, roughness: 0.4
  });
  const screen = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.82, 0.07), screenMat);
  screen.position.set(0, 1.78, -0.38);
  screen.castShadow = true;
  g.add(screen);

  // Avatar: body (capsule) + head (sphere), colored by name
  const hue = hashHue(user.username || 'x');
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${hue}, 50%, 55%)`), roughness: 0.6
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(`hsl(${hue}, 45%, 72%)`), roughness: 0.6
  });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.5, 6, 12), bodyMat);
  body.position.set(0, 1.15, 0.55);
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 20), headMat);
  head.position.set(0, 1.78, 0.55);
  head.castShadow = true;
  g.add(head);

  // Chair back
  const chair = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.7, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x232838, roughness: 0.8 })
  );
  chair.position.set(0, 1.25, 1.0);
  g.add(chair);

  // Glow ring + desk light (online only)
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(1.3, 1.7, 48),
    new THREE.MeshBasicMaterial({ color: theme, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.02;
  g.add(glow);

  const light = new THREE.PointLight(theme, 0, 6);
  light.position.set(0, 2.4, 0);
  g.add(light);

  // Name label
  const label = makeLabel(user.username || '?');
  label.position.set(0, 2.7, 0.2);
  g.add(label);

  return { group: g, screenMat, glow, bodyMat, headMat, light, online: false };
}

function applyState(desk, online) {
  desk.online = online;
  desk.screenMat.emissiveIntensity = online ? 0.9 : 0.0;
  desk.glow.material.opacity = online ? 0.5 : 0.0;
  desk.light.intensity = online ? 1.6 : 0.0;
  const dim = online ? 1 : 0.45;
  desk.bodyMat.color.multiplyScalar(1); // base set on build; adjust emissive-like via opacity
  desk.bodyMat.opacity = dim; desk.bodyMat.transparent = !online;
  desk.headMat.opacity = dim; desk.headMat.transparent = !online;
}

const DESK_SPACING = 3.4;

function layout() {
  const n = desks.size;
  let i = 0;
  const offset = (n - 1) / 2;
  desks.forEach((desk) => {
    desk.group.position.set((i - offset) * DESK_SPACING, 0, 0);
    desk.group.rotation.y = 0;
    i++;
  });
}

// Pull the camera back so all desks fit, given the current viewport aspect.
function fitView() {
  const n = Math.max(1, desks.size);
  const aspect = (mount.clientWidth || 1) / (mount.clientHeight || 1);
  // Frame the workstation cluster (with the room reading behind it).
  const spread = Math.max((n - 1) * DESK_SPACING + 4.5, 11);
  const vFov = camera.fov * Math.PI / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(aspect, 0.0001));
  const distH = (spread / 2) / Math.tan(hFov / 2);
  const distV = 3.0 / Math.tan(vFov / 2);
  radius = Math.min(26, Math.max(8, Math.max(distH, distV) * 1.12));
}

let initialized = false;
let usersCache = null;
const pendingModels = [];

function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  try {
    init();
    if (usersCache) {
      update(usersCache);
    }
    // Load any queued models
    while (pendingModels.length > 0) {
      const { name, url, opts } = pendingModels.shift();
      loadModel(roomGroup, name, url, opts).catch(err => console.error('Failed to load lazy model:', err));
    }
  } catch (e) {
    console.error('3D office unavailable, falling back to 2D:', e);
    const ws = document.getElementById('workstations');
    if (ws) ws.classList.remove('hidden');
    if (mount) mount.style.display = 'none';
    const img = document.getElementById('office-image');
    if (img) img.classList.remove('hidden');
  }
}

function update(users) {
  usersCache = users;
  if (!initialized) {
    const officeView = document.getElementById('office-view');
    if (officeView && officeView.classList.contains('hidden')) {
      return;
    }
    ensureInitialized();
  }
  if (!ready || !Array.isArray(users)) return;

  // Rebuild if the set of users changed.
  const ids = new Set(users.map(u => u.id));
  let changed = ids.size !== desks.size;
  if (!changed) { for (const id of ids) if (!desks.has(id)) { changed = true; break; } }

  if (changed) {
    desks.forEach(d => deskGroup.remove(d.group));
    desks.clear();
    users.forEach((u, i) => {
      const desk = buildDesk(u, i);
      desks.set(u.id, desk);
      deskGroup.add(desk.group);
    });
    layout();
    fitView();
  }

  users.forEach(u => {
    const desk = desks.get(u.id);
    if (desk) applyState(desk, u.status === 'online' || u.status === 'away' || u.status === 'busy');
  });

  resize();
}

// ---------------------------------------------------------------------------
// Controls, resize, render loop
// ---------------------------------------------------------------------------
function setupControls() {
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => {
    dragging = true; autoRotate = false; lastX = e.clientX; lastY = e.clientY;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    azimuth -= (e.clientX - lastX) * 0.008;
    azimuth = Math.max(-AZ_LIMIT, Math.min(AZ_LIMIT, azimuth));
    polar -= (e.clientY - lastY) * 0.006;
    polar = Math.max(0.2, Math.min(Math.PI / 2 - 0.08, polar));
    lastX = e.clientX; lastY = e.clientY;
  });
  const stop = () => { dragging = false; };
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    radius = Math.max(6, Math.min(24, radius + e.deltaY * 0.01));
  }, { passive: false });
}

function observeResize() {
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => resize()).observe(mount);
  }
  window.addEventListener('resize', resize);
}

function resize() {
  if (!renderer) return;
  const w = mount.clientWidth, h = mount.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);
  if (bloomPass) bloomPass.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let animating = false;
let animationFrameId = null;

function startAnimating() {
  ensureInitialized();
  if (animating) return;
  animating = true;
  animate();
}

function stopAnimating() {
  animating = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function animate() {
  if (!animating) return;
  animationFrameId = requestAnimationFrame(animate);

  // Skip rendering if 3D office view is hidden to minimize background GPU/CPU consumption.
  const officeView = document.getElementById('office-view');
  if (officeView && officeView.classList.contains('hidden')) {
    stopAnimating();
    return;
  }

  if (autoRotate) {
    azimuth += 0.0009 * autoDir;
    if (azimuth > AZ_LIMIT * 0.7 || azimuth < -AZ_LIMIT * 0.7) autoDir *= -1;
  }

  const cx = Math.sin(azimuth) * Math.sin(polar) * radius;
  const cy = Math.cos(polar) * radius;
  const cz = Math.cos(azimuth) * Math.sin(polar) * radius;
  camera.position.set(cx, cy + 1.2, cz);
  camera.lookAt(0, 1.3, -0.8);

  if (composer) composer.render();
  else renderer.render(scene, camera);
}

// Expose API lazy methods
window.office3d = {
  update,
  loadModel: (name, url, opts) => {
    if (!initialized) {
      pendingModels.push({ name, url, opts });
      return Promise.resolve(null);
    }
    return loadModel(roomGroup, name, url, opts);
  },
  startAnimating,
  stopAnimating
};
