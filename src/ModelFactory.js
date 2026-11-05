import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, RACK, SERVER_WIDTH, SERVER_DEPTH } from './constants.js';
import * as Tex from './Textures.js';

/**
 * Single entry point for every rack/server mesh in the scene.
 *
 * To swap in real art, drop a .glb into /public/models and set its path below,
 * e.g. `rack: 'models/rack.glb'` (relative, so it also works under a sub-path
 * such as GitHub Pages). The loaded model is baked into one geometry and fitted
 * to the placeholder's bounding box, so it lines up with the existing layout (racks: origin at floor centre, front facing +z).
 */
export const MODEL_PATHS = {
  rack: null,
  server1U: null,
  server2U: null,
  switch1U: null,
  blankPanel: null,
  coreSwitch: null,
  crac: null,
};

const loader = new GLTFLoader();
const cache = new Map();

/** @returns {Promise<{geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]}>} */
export function createModel(type) {
  if (!PLACEHOLDERS[type]) throw new Error(`Unknown model type: ${type}`);
  if (!cache.has(type)) cache.set(type, build(type));
  return cache.get(type);
}

async function build(type) {
  const placeholder = PLACEHOLDERS[type]();
  const path = MODEL_PATHS[type];
  if (!path) return placeholder;
  try {
    return await loadGLTF(path, placeholder.geometry);
  } catch (err) {
    console.warn(`[ModelFactory] Failed to load ${path}, using placeholder`, err);
    return placeholder;
  }
}

async function loadGLTF(path, fitTo) {
  const gltf = await loader.loadAsync(path);
  gltf.scene.updateMatrixWorld(true);
  const geos = [];
  const mats = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geos.push(g.index ? g.toNonIndexed() : g);
    mats.push(Array.isArray(o.material) ? o.material[0] : o.material);
  });
  if (!geos.length) throw new Error('GLTF contains no meshes');

  let geometry = geos[0];
  if (geos.length > 1) {
    const keep = ['position', 'normal', 'uv'].filter((a) => geos.every((g) => g.attributes[a]));
    for (const g of geos) for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
    geometry = mergeGeometries(geos, true);
  }
  fitGeometry(geometry, fitTo);
  return { geometry, material: geos.length > 1 ? mats : mats[0] };
}

function fitGeometry(geometry, ref) {
  ref.computeBoundingBox();
  geometry.computeBoundingBox();
  const a = geometry.boundingBox;
  const b = ref.boundingBox;
  const sa = a.getSize(new THREE.Vector3());
  const sb = b.getSize(new THREE.Vector3());
  const ca = a.getCenter(new THREE.Vector3());
  const cb = b.getCenter(new THREE.Vector3());
  geometry.translate(-ca.x, -ca.y, -ca.z);
  geometry.scale(sa.x ? sb.x / sa.x : 1, sa.y ? sb.y / sa.y : 1, sa.z ? sb.z / sa.z : 1);
  geometry.translate(cb.x, cb.y, cb.z);
  geometry.computeVertexNormals();
}

// ---- Placeholders -------------------------------------------------------------

function box(w, h, d, x, y, z) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function rackFrame() {
  const { width: W, height: H, depth: D } = RACK;
  const t = 0.02;
  const postH = H - 0.13;
  const postY = 0.05 + postH / 2;
  const parts = [
    box(t, H, D, -W / 2 + t / 2, H / 2, 0), // side panels
    box(t, H, D, W / 2 - t / 2, H / 2, 0),
    box(W, 0.08, D, 0, H - 0.04, 0), // top + label header
    box(W - 0.02, 0.05, D - 0.02, 0, 0.025, 0), // plinth
    // no rear door: the hot aisle is contained, so server backs (PSUs, ports) are reachable
  ];
  for (const sx of [-1, 1]) {
    parts.push(box(0.03, postH, 0.03, sx * 0.255, postY, 0.49)); // front 19" posts
    parts.push(box(0.03, postH, 0.03, sx * 0.255, postY, -0.45)); // rear posts
  }
  return {
    geometry: mergeGeometries(parts),
    material: new THREE.MeshStandardMaterial({ color: 0x1b1e22, metalness: 0.55, roughness: 0.48 }),
  };
}

function chassis(units, frontTex, bodyColor = 0x30343a, rearTex = null) {
  const body = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.6, roughness: 0.45 });
  const front = new THREE.MeshStandardMaterial({ map: frontTex, metalness: 0.35, roughness: 0.55 });
  const rear = rearTex ? new THREE.MeshStandardMaterial({ map: rearTex, metalness: 0.35, roughness: 0.55 }) : body;
  return {
    geometry: new THREE.BoxGeometry(SERVER_WIDTH, units * U - 0.0012, SERVER_DEPTH),
    material: [body, body, body, body, front, rear],
  };
}

const PLACEHOLDERS = {
  rack: rackFrame,
  server1U: () => chassis(1, Tex.serverFrontTexture(1), undefined, Tex.serverRearTexture(1)),
  server2U: () => chassis(2, Tex.serverFrontTexture(2), undefined, Tex.serverRearTexture(2)),
  switch1U: () => chassis(1, Tex.switchFrontTexture(), 0x202326),
  blankPanel: () => ({
    geometry: new THREE.BoxGeometry(0.482, U - 0.0006, 0.006),
    material: new THREE.MeshStandardMaterial({ color: 0x131518, metalness: 0.3, roughness: 0.75 }),
  }),
  coreSwitch: () => {
    const { width, height, depth } = Tex.CORE;
    const body = new THREE.MeshStandardMaterial({ color: 0x23272c, metalness: 0.55, roughness: 0.45 });
    const front = new THREE.MeshStandardMaterial({ map: Tex.coreFrontTexture(), metalness: 0.35, roughness: 0.5 });
    return {
      geometry: new THREE.BoxGeometry(width, height, depth).translate(0, height / 2, 0),
      material: [body, body, body, body, front, body],
    };
  },
  crac: () => {
    const body = new THREE.MeshStandardMaterial({ color: 0xd3d8dd, metalness: 0.2, roughness: 0.6 });
    const front = new THREE.MeshStandardMaterial({ map: Tex.cracTexture(), metalness: 0.2, roughness: 0.6 });
    return {
      geometry: new THREE.BoxGeometry(0.85, 2.0, 1.8).translate(0, 1.0, 0),
      material: [front, body, body, body, body, body],
    };
  },
};
