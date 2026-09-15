// Modular procedural office room.
// Every element is a small factory returning a THREE.Object3D tagged with
// userData.asset = "<name>". They are procedural "placeholders" tuned for a
// consistent premium look, and any one can be swapped for a real GLTF model
// later via loadModel() without touching the rest of the scene.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Room dimensions (metres-ish).
const WIDTH = 17;
const DEPTH = 14;
const WALL_H = 6;

const MAT = {
  wall: () => new THREE.MeshStandardMaterial({ color: 0x171a24, roughness: 0.95, metalness: 0.0 }),
  darkWood: () => new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.6, metalness: 0.15 }),
  fabric: (c = 0x23283a) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }),
  metal: () => new THREE.MeshStandardMaterial({ color: 0x2a2f3e, roughness: 0.4, metalness: 0.7 }),
  leaf: () => new THREE.MeshStandardMaterial({ color: 0x2f6d3a, roughness: 0.7 })
};

// --- warm wood floor texture (canvas, no external asset) -------------------
function makeWoodTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5c3f25';
  ctx.fillRect(0, 0, 512, 512);
  const plankH = 56;
  for (let y = 0; y < 512; y += plankH) {
    const s = 0.82 + Math.random() * 0.36;
    ctx.fillStyle = `rgb(${(108 * s) | 0},${(74 * s) | 0},${(44 * s) | 0})`;
    ctx.fillRect(0, y, 512, plankH - 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, y + plankH - 2, 512, 2);
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = `rgba(${(55 + Math.random() * 45) | 0},${(38 + Math.random() * 28) | 0},${(20 + Math.random() * 18) | 0},0.22)`;
      ctx.lineWidth = 1;
      const gy = y + Math.random() * plankH;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.bezierCurveTo(170, gy + (Math.random() * 6 - 3), 340, gy + (Math.random() * 6 - 3), 512, gy);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function tag(obj, name) { obj.name = `asset:${name}`; obj.userData.asset = name; return obj; }

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// --- canvas text panel (whiteboard / neon sign) ----------------------------
function makeTextTexture(lines, { bg = 'rgba(245,245,245,1)', fg = '#1a1a1a', title = null, glow = null, w = 512, h = 320 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 24; }
  let y = title ? 70 : 50;
  if (title) {
    ctx.fillStyle = fg; ctx.font = 'bold 38px Segoe UI, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(title, 36, y); y += 56;
  }
  ctx.font = '28px Segoe UI, sans-serif'; ctx.fillStyle = fg;
  lines.forEach(line => { ctx.fillText(line, 36, y); y += 44; });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// --- elements --------------------------------------------------------------
function buildFloor() {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH + 6, DEPTH + 6),
    new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.65, metalness: 0.08 })
  );
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return tag(m, 'floor');
}

function buildWalls() {
  const g = new THREE.Group();
  const back = box(WIDTH, WALL_H, 0.3, MAT.wall());
  back.position.set(0, WALL_H / 2, -DEPTH / 2);
  const left = box(0.3, WALL_H, DEPTH, MAT.wall());
  left.position.set(-WIDTH / 2, WALL_H / 2, 0);
  const right = box(0.3, WALL_H, DEPTH, MAT.wall());
  right.position.set(WIDTH / 2, WALL_H / 2, 0);
  g.add(back, left, right);
  return tag(g, 'walls');
}

function buildNeonSign() {
  const g = new THREE.Group();
  const tex = makeTextTexture(['Build · Automate · Dominate'], {
    bg: 'rgba(10,10,14,1)', fg: '#ffb347', title: 'TEAM HQ', glow: '#ff9500', w: 640, h: 220
  });
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(4.6, 1.6),
    new THREE.MeshStandardMaterial({ map: tex, emissive: 0xff9500, emissiveMap: tex, emissiveIntensity: 1.1, roughness: 0.5 })
  );
  panel.position.set(0, 4.1, -DEPTH / 2 + 0.18);
  g.add(panel);
  return tag(g, 'neon-sign');
}

function buildWhiteboard() {
  const g = new THREE.Group();
  const frame = box(4.2, 2.4, 0.12, MAT.metal());
  const tex = makeTextTexture(['☑ Finish Business Plan', '☑ Rakshak AI Update', '☑ MCP Server Testing', '☑ CTF Challenge'], { title: "TODAY'S GOALS" });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }));
  board.position.z = 0.07;
  g.add(frame, board);
  g.position.set(-5.4, 3.0, -DEPTH / 2 + 0.2);
  return tag(g, 'whiteboard');
}

function buildSofa() {
  const g = new THREE.Group();
  const fab = MAT.fabric(0x20242f);
  const seat = box(3.4, 0.5, 1.2, fab); seat.position.y = 0.55;
  const back = box(3.4, 0.9, 0.3, fab); back.position.set(0, 1.0, -0.45);
  const armL = box(0.3, 0.7, 1.2, fab); armL.position.set(-1.55, 0.7, 0);
  const armR = armL.clone(); armR.position.x = 1.55;
  g.add(seat, back, armL, armR);
  g.position.set(0, 0, -DEPTH / 2 + 1.6);
  return tag(g, 'sofa');
}

function buildCoffeeTable() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.1, 24), MAT.darkWood());
  top.position.y = 0.5; top.castShadow = true;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 12), MAT.metal());
  stem.position.y = 0.25;
  g.add(top, stem);
  g.position.set(0, 0, -DEPTH / 2 + 3.4);
  return tag(g, 'coffee-table');
}

function buildRug() {
  const m = new THREE.Mesh(new THREE.CircleGeometry(2.4, 40), MAT.fabric(0x1a1c26));
  m.rotation.x = -Math.PI / 2; m.position.set(0, 0.01, -DEPTH / 2 + 2.6); m.receiveShadow = true;
  return tag(m, 'rug');
}

function buildBookshelf() {
  const g = new THREE.Group();
  const wood = MAT.darkWood();
  const frame = box(2.0, 3.0, 0.6, wood); frame.position.y = 1.5;
  g.add(frame);
  const bookColors = [0x6366f1, 0x22c55e, 0xa855f7, 0xf59e0b, 0xef4444, 0x38bdf8];
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = 0.7 + shelf * 0.85;
    const plank = box(1.9, 0.06, 0.55, wood); plank.position.set(0, y - 0.35, 0);
    g.add(plank);
    let x = -0.85;
    while (x < 0.8) {
      const bw = 0.1 + Math.random() * 0.12;
      const bh = 0.4 + Math.random() * 0.2;
      const b = box(bw, bh, 0.4, new THREE.MeshStandardMaterial({ color: bookColors[(Math.random() * bookColors.length) | 0], roughness: 0.7 }));
      b.position.set(x + bw / 2, y - 0.05 - (0.6 - bh) / 2, 0);
      g.add(b);
      x += bw + 0.02;
    }
  }
  g.position.set(WIDTH / 2 - 0.7, 0, -DEPTH / 2 + 2.2);
  g.rotation.y = -Math.PI / 2;
  return tag(g, 'bookshelf');
}

function buildPlant() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.45, 16), new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.8 }));
  pot.position.y = 0.22; pot.castShadow = true;
  g.add(pot);
  const leaf = MAT.leaf();
  for (let i = 0; i < 5; i++) {
    const blade = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.0 + Math.random() * 0.4, 6), leaf);
    blade.position.set((Math.random() - 0.5) * 0.2, 0.9, (Math.random() - 0.5) * 0.2);
    blade.rotation.z = (Math.random() - 0.5) * 0.6;
    blade.rotation.x = (Math.random() - 0.5) * 0.6;
    blade.castShadow = true;
    g.add(blade);
  }
  return tag(g, 'plant');
}

// Warm ambient fill lights so the room reads as lit.
function buildRoomLights() {
  const g = new THREE.Group();
  const warm1 = new THREE.PointLight(0xffd9a0, 0.6, 22, 2);
  warm1.position.set(-4, 4.5, -2);
  const warm2 = new THREE.PointLight(0xffd9a0, 0.5, 22, 2);
  warm2.position.set(4, 4.5, -2);
  g.add(warm1, warm2);
  return tag(g, 'room-lights');
}

// --- assembly --------------------------------------------------------------
export function buildRoom() {
  const room = new THREE.Group();
  room.name = 'room';
  room.add(buildFloor());
  room.add(buildWalls());
  room.add(buildNeonSign());
  room.add(buildWhiteboard());
  room.add(buildRug());
  room.add(buildSofa());
  room.add(buildCoffeeTable());
  room.add(buildBookshelf());
  room.add(buildRoomLights());

  // Plants in the back corners + beside the lounge.
  const plantPositions = [
    [-WIDTH / 2 + 1.2, -DEPTH / 2 + 1.2],
    [WIDTH / 2 - 1.2, -DEPTH / 2 + 4.5],
    [-2.6, -DEPTH / 2 + 1.0],
    [2.6, -DEPTH / 2 + 1.0]
  ];
  plantPositions.forEach(([x, z]) => {
    const p = buildPlant();
    p.position.set(x, 0, z);
    room.add(p);
  });

  return room;
}

// --- model swap path (drop in a real GLTF later) ---------------------------
// loadModel(room, 'sofa', '/vendor/models/sofa.glb', { scale: 1, position:[x,y,z], rotationY })
const gltfLoader = new GLTFLoader();
export function loadModel(root, assetName, url, opts = {}) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(url, (gltf) => {
      const placeholder = root.getObjectByName(`asset:${assetName}`);
      const model = gltf.scene;
      if (opts.scale) model.scale.setScalar(opts.scale);
      if (opts.rotationY != null) model.rotation.y = opts.rotationY;
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      if (placeholder) {
        model.position.copy(placeholder.position);
        if (opts.position) model.position.set(...opts.position);
        root.remove(placeholder);
      } else if (opts.position) {
        model.position.set(...opts.position);
      }
      tag(model, assetName);
      root.add(model);
      resolve(model);
    }, undefined, reject);
  });
}
