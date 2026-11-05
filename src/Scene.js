import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createModel } from './ModelFactory.js';
import * as Tex from './Textures.js';
import { PARTS, SHELF_LEVELS } from './parts.js';
import {
  U, RACK, ROOM, DOORWAY, RAIL_BASE, RACK_HEADER_Y, SERVER_DEPTH, SERVER_FRONT_Z, NIC_X,
  STATUS_LED_X, statusLedDy, TOR_U, torPortX, TOR_ROW_DY, TOR_LED_DY, sfpCageX, SFP_LED_DY,
} from './constants.js';

const AISLE_HALF = 0.6; // cold aisle is two 600 mm tiles wide
const RACKS_PER_ROW = 8;
const RACK_PITCH = 0.6;
const ROW_X = AISLE_HALF + RACK.depth / 2;
const TRAY_Y = 2.35;
const CORE_Z = -5.6;
const CABLE_PORT = 6; // TOR port reserved for a host's (initially loose) patch cable
const CABLE_SIDE = 0.236;
const REAR_Z = SERVER_FRONT_Z - SERVER_DEPTH; // server rear face (hot aisle side)
const TOR_YC = RAIL_BASE + (TOR_U - 1) * U + U / 2;
const FIBER_CAGES = [0, 1]; // every TOR has two fibered uplinks
const FIBER_AQUA = 0x2ec4c9;
const SHELF = { x: -1.2, z: ROOM.maxZ - 0.2, width: 1.2, depth: 0.4, levels: [1.45, 1.05, 0.65, 0.25] };

const LED = {
  blue: new THREE.Color(0.12, 0.42, 2.6),
  green: new THREE.Color(0.2, 2.3, 0.45),
  amber: new THREE.Color(2.8, 1.0, 0.04),
  red: new THREE.Color(3.0, 0.12, 0.08),
};
const LED_STATES = {
  rack: {
    normal: { mode: 'pulse', color: LED.blue, rate: 1.2 },
    alert: { mode: 'blink', color: LED.amber, rate: 1.2 },
    red: { mode: 'blink', color: LED.red, rate: 2.4 }, // escalated: ignored too long, or customers are affected
    ok: { mode: 'solid', color: LED.green },
  },
  host: {
    normal: { mode: 'activity', color: LED.green, rate: 8 },
    fault: { mode: 'blink', color: LED.amber, rate: 1.4 },
    ok: { mode: 'solid', color: LED.green },
  },
};
// one shared, low-key outline (below the bloom threshold, so it doesn't glow)
const HIGHLIGHT_MATERIAL = new THREE.LineBasicMaterial({ color: 0xd6f6ff, transparent: true, opacity: 0.85 });
const CABLE_COLORS = [0x2f6fe0, 0x2f6fe0, 0x2f6fe0, 0xe8c21c, 0x8b9299, 0xd8463f].map((c) => new THREE.Color(c));
const PATCH_BLUE = 0x2f6fe0;

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const uBottom = (u) => RAIL_BASE + (u - 1) * U;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const hash = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};
const torPortY = (i) => uBottom(TOR_U) + U / 2 + (i < 24 ? TOR_ROW_DY : -TOR_ROW_DY);

function placement(x, y, z, rotY = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rotY), v3(sx, sy, sz));
}

function seedFrom(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/**
 * Decide what sits in each U of a rack (U42 = top-of-rack switch).
 * `blocks` maps the top U of each named host to its config so it lands exactly there.
 */
function planRack(rng, blocks) {
  const items = [
    { type: 'switch1U', u: TOR_U, size: 1 },
    { type: 'blankPanel', u: 41, size: 1 },
  ];
  const density = 0.5 + rng() * 0.45;
  let u = 40;
  while (u >= 1) {
    const host = blocks.get(u);
    if (host) {
      items.push({ type: host.size === 1 ? 'server1U' : 'server2U', u: host.u, size: host.size, host });
      u = host.u - 1;
    } else if (u >= 3 && rng() < density) {
      if (rng() < 0.45 && u - 1 >= 3 && !blocks.has(u - 1)) {
        items.push({ type: 'server2U', u: u - 1, size: 2 });
        u -= 2;
      } else {
        items.push({ type: 'server1U', u, size: 1 });
        u -= 1;
      }
    } else {
      items.push({ type: 'blankPanel', u, size: 1 });
      u -= 1;
    }
  }
  return items;
}

// Patch cable route in rack-local space: out of the TOR port, across to the
// right-hand cable manager, down, then into the server's NIC.
function cableHead(torIdx, side) {
  const tx = torPortX(torIdx);
  const ty = torPortY(torIdx);
  return [v3(tx, ty, 0.468), v3(tx, ty - 0.002, 0.492), v3((tx + side) / 2, ty - 0.03, 0.512), v3(side, ty - 0.09, 0.518)];
}
function cableSeated(side, sy) {
  return [v3(side, sy + 0.07, 0.518), v3(side - 0.04, sy + 0.012, 0.51), v3(NIC_X + 0.006, sy, 0.494), v3(NIC_X, sy, 0.462)];
}
function cableLoose(side, sy) {
  return [v3(side + 0.004, sy + 0.03, 0.525), v3(side - 0.005, sy - 0.12, 0.54), v3(side - 0.02, sy - 0.26, 0.553), v3(side - 0.035, sy - 0.37, 0.562)];
}

/** A host's patch cable: dangles and sways while loose, animates into the NIC when reseated. */
class PatchCable {
  constructor(parent, head, loose, seated) {
    this.head = head;
    this.loose = loose;
    this.seated = seated;
    this.points = [...head, ...loose].map((p) => p.clone());
    this.curve = new THREE.CatmullRomCurve3(this.points);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ color: PATCH_BLUE, roughness: 0.55 }));
    this.mesh.castShadow = true;
    this.plug = makePlug(PATCH_BLUE);
    parent.add(this.mesh, this.plug);
    this.progress = 0;
    this.target = 0;
    this.done = false;
    this._tmp = new THREE.Vector3();
    this._tan = new THREE.Vector3();
    this.update(0, 0);
  }

  get isSeated() {
    return this.target === 1;
  }

  setSeated(seated, animate = true, onDone) {
    this.target = seated ? 1 : 0;
    if (!animate) this.progress = this.target;
    this.onDone = onDone;
    this.done = false;
  }

  update(dt, t) {
    if (this.done) return;
    const dir = Math.sign(this.target - this.progress);
    this.progress = THREE.MathUtils.clamp(this.progress + (dir * dt) / 0.9, 0, 1);
    const e = this.progress * this.progress * (3 - 2 * this.progress);
    const sway = 1 - e;
    const sx = Math.sin(t * 1.3) * 0.014 * sway;
    const sz = Math.sin(t * 1.9 + 1.1) * 0.009 * sway;
    const n = this.head.length;
    for (let i = 0; i < this.loose.length; i++) {
      const w = (i + 1) / this.loose.length;
      this._tmp.copy(this.loose[i]);
      this._tmp.x += sx * w;
      this._tmp.z += sz * w;
      this.points[n + i].copy(this._tmp).lerp(this.seated[i], e);
    }
    this.curve.updateArcLengths();
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.TubeGeometry(this.curve, 64, 0.0028, 6);
    this.plug.position.copy(this.points[this.points.length - 1]);
    this.plug.quaternion.setFromUnitVectors(v3(0, 0, -1), this.curve.getTangent(1, this._tan).normalize());
    if (this.progress === 1 && this.target === 1) {
      this.done = true; // seated cables stop updating; loose ones keep swaying
      const cb = this.onDone;
      this.onDone = null;
      cb?.();
    } else if (this.progress === 0 && this.onDone) {
      const cb = this.onDone;
      this.onDone = null;
      cb();
    }
  }
}

/** A hot-swap drive caddy that slides out, gets replaced, and slides back in. */
class DiskCaddy {
  constructor(parent, bay, led) {
    this.led = led;
    this.baseZ = SERVER_FRONT_Z + 0.006;
    this.mat = new THREE.MeshStandardMaterial({ color: 0x1d2024, metalness: 0.5, roughness: 0.5 });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(bay.w - 0.002, bay.h - 0.002, 0.012), this.mat);
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(bay.w * 0.6, 0.004, 0.006),
      new THREE.MeshStandardMaterial({ color: 0x5a616a, metalness: 0.7, roughness: 0.35 }),
    );
    handle.position.set(-bay.w * 0.1, 0, 0.008);
    this.mesh.add(handle);
    this.mesh.position.set(bay.x, bay.y, this.baseZ);
    parent.add(this.mesh);
    this.swapped = false;
    this.anim = -1;
    this._apply();
  }

  set(swapped, animate = true, onDone) {
    if (swapped === this.swapped) return onDone?.();
    this.swapped = swapped;
    this.onDone = onDone;
    if (animate) {
      this.anim = 0;
      this.led.mode = 'off';
    } else {
      this._apply();
      onDone?.();
    }
  }

  _apply() {
    this.mesh.position.z = this.baseZ;
    this.mat.color.set(this.swapped ? 0x353a41 : 0x1d2024);
    Object.assign(this.led, this.swapped ? { mode: 'activity', color: LED.green, rate: 9 } : { mode: 'solid', color: LED.amber });
  }

  update(dt) {
    if (this.anim < 0) return;
    this.anim = Math.min(1, this.anim + dt / 1.8);
    const a = this.anim;
    // slide out (0-0.35), swap while out (0.35-0.6), slide in (0.6-1)
    const out = a < 0.35 ? a / 0.35 : a < 0.6 ? 1 : 1 - (a - 0.6) / 0.4;
    this.mesh.position.z = this.baseZ + 0.16 * out * out * (3 - 2 * out);
    if (a >= 0.45) this.mat.color.set(this.swapped ? 0x353a41 : 0x1d2024);
    if (a >= 1) {
      this.anim = -1;
      this._apply();
      const cb = this.onDone;
      this.onDone = null;
      cb?.();
    }
  }
}

/** A hot-swap PSU at the back of a server: 'ok', 'failed', 'removed' or 'new'. */
class PsuModule {
  constructor(parent, slot, y, led) {
    this.led = led;
    this.baseZ = REAR_Z + 0.003; // front face 12 mm proud of the rear panel
    this.mat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.55, roughness: 0.45 });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(slot.w - 0.002, slot.h - 0.002, 0.03), this.mat);
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.006, slot.h * 0.6, 0.012),
      new THREE.MeshStandardMaterial({ color: 0x8a9199, metalness: 0.7, roughness: 0.3 }),
    );
    handle.position.set(-slot.w * 0.3, 0, -0.018);
    this.mesh.add(handle);
    this.mesh.position.set(slot.x, y, this.baseZ);
    parent.add(this.mesh);
    this.state = 'ok';
    this.anim = -1;
    this._apply();
  }

  set(state, animate = true, onDone) {
    if (state === this.state) return onDone?.();
    const prev = this.state;
    this.state = state;
    this.onDone = onDone;
    if (!animate) {
      this._apply();
      return onDone?.();
    }
    // pull out (failed -> removed) or slide in (removed -> new)
    this.dir = prev !== 'removed' && state === 'removed' ? 'out' : 'in';
    this.anim = 0;
    this.mesh.visible = true;
    if (this.dir === 'in') this.mat.color.set(0x555c64);
    this.led.mode = 'off';
  }

  _apply() {
    const s = this.state;
    this.mesh.visible = s !== 'removed';
    this.mesh.position.z = this.baseZ;
    this.mat.color.set(s === 'new' ? 0x555c64 : 0x3a3f45);
    Object.assign(this.led, s === 'failed' ? { mode: 'solid', color: LED.amber } : s === 'removed' ? { mode: 'off' } : { mode: 'solid', color: LED.green });
  }

  update(dt) {
    if (this.anim < 0) return;
    this.anim = Math.min(1, this.anim + dt / 0.7);
    const e = this.anim * this.anim * (3 - 2 * this.anim);
    const out = this.dir === 'out' ? e : 1 - e;
    this.mesh.position.z = this.baseZ - 0.24 * out;
    if (this.anim >= 1) {
      this.anim = -1;
      this._apply();
      const cb = this.onDone;
      this.onDone = null;
      cb?.();
    }
  }
}

function makePlug(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.0117, 0.0085, 0.021).translate(0, 0, 0.0105),
    new THREE.MeshStandardMaterial({ color: 0xdbe4ec, transparent: true, opacity: 0.85, roughness: 0.2 }),
  );
  const boot = new THREE.Mesh(
    new THREE.BoxGeometry(0.0125, 0.0098, 0.016).translate(0, 0, 0.029),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5 }),
  );
  g.add(body, boot);
  return g;
}

export class DataCenterScene {
  /**
   * @param hostConfigs named hosts and the fixtures their tickets need:
   *   server: { id, rack, u, size, cable?, disk?: {col,row}, psu?: {failed} }
   *   switch: { id, rack, tor: true, sfp: {cage} }
   */
  constructor(renderer, hostConfigs = []) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.colliders = []; // XZ AABBs: {minX, maxX, minZ, maxZ}
    this.occluders = []; // meshes that block interaction raycasts
    this.racks = new Map();
    this.hosts = new Map();
    this.core = null;
    this.shelf = []; // { kind: 'shelf', partId, hitbox, highlight }
    this._hostConfigs = hostConfigs;
    this._leds = [];
    this._ledTimer = 0;
    this._updatables = [];
  }

  async build() {
    this._setupLighting();
    this._buildRoom();
    this._buildCeilingLights();
    await this._buildRacks();
    await this._buildCoreSwitch();
    await this._buildCooling();
    this._buildCableTrays();
    this._buildSigns();
    this._buildShelf();
    this._buildLeds();
  }

  update(dt, t) {
    this._ledTimer += dt;
    if (this._ledTimer > 1 / 30) {
      this._ledTimer = 0;
      this._updateLeds(t);
    }
    for (const u of this._updatables) u.update(dt, t);
  }

  // ---- Environment ----------------------------------------------------------

  _setupLighting() {
    const s = this.scene;
    s.background = new THREE.Color(0xdde3ea);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    s.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    s.environmentIntensity = 0.25; // just a hint of reflection; more turns the floor into a mirror
    pmrem.dispose();

    s.add(new THREE.HemisphereLight(0xf2f7ff, 0x5d636a, 0.75));
    const key = new THREE.DirectionalLight(0xf4f8ff, 0.8);
    key.position.set(1.5, 9, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 20 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3;
    s.add(key, key.target);
  }

  _buildRoom() {
    const s = this.scene;
    const w = ROOM.maxX - ROOM.minX;
    const d = ROOM.maxZ - ROOM.minZ;
    const h = ROOM.height;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ map: Tex.floorTileTexture(w / 0.6, d / 0.6), roughness: 0.82, metalness: 0 }), // matte anti-static tiles, no glare
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);

    // perforated vent tiles in front of every rack in the cold aisle
    const perf = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.6, 0.6).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: Tex.perforatedTileTexture(), roughness: 0.75, metalness: 0.1 }),
      RACKS_PER_ROW * 2,
    );
    let k = 0;
    for (let i = 0; i < RACKS_PER_ROW; i++) {
      for (const x of [-0.3, 0.3]) perf.setMatrixAt(k++, placement(x, 0.002, (RACKS_PER_ROW / 2 - 0.5 - i) * RACK_PITCH));
    }
    perf.receiveShadow = true;
    s.add(perf);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfd4d9, roughness: 0.9 });
    const skirtMat = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.6 });
    const wall = (width, x, z, rotY, height = h, y0 = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(width, height), wallMat);
      m.position.set(x, y0 + height / 2, z);
      m.rotation.y = rotY;
      m.receiveShadow = true;
      s.add(m);
      if (y0 > 0) return;
      const skirt = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.12), skirtMat);
      skirt.position.set(x, 0.06, z);
      skirt.rotation.y = rotY;
      skirt.translateZ(0.004);
      s.add(skirt);
    };
    wall(w, 0, ROOM.minZ, 0);
    wall(d, ROOM.minX, 0, Math.PI / 2);
    wall(d, ROOM.maxX, 0, -Math.PI / 2);
    // +z wall has the doorway to the helpdesk corridor
    const doorL = DOORWAY.x - DOORWAY.width / 2;
    const doorR = DOORWAY.x + DOORWAY.width / 2;
    wall(doorL - ROOM.minX, (ROOM.minX + doorL) / 2, ROOM.maxZ, Math.PI);
    wall(ROOM.maxX - doorR, (doorR + ROOM.maxX) / 2, ROOM.maxZ, Math.PI);
    wall(DOORWAY.width, DOORWAY.x, ROOM.maxZ, Math.PI, h - DOORWAY.height, DOORWAY.height);

    // walls are colliders now that the player can leave through the doorway
    const T = 0.2;
    this.colliders.push(
      { minX: ROOM.minX - T, maxX: ROOM.maxX + T, minZ: ROOM.minZ - T, maxZ: ROOM.minZ },
      { minX: ROOM.minX - T, maxX: ROOM.minX, minZ: ROOM.minZ - T, maxZ: ROOM.maxZ + T },
      { minX: ROOM.maxX, maxX: ROOM.maxX + T, minZ: ROOM.minZ - T, maxZ: ROOM.maxZ + T },
      { minX: ROOM.minX - T, maxX: doorL, minZ: ROOM.maxZ, maxZ: ROOM.maxZ + T },
      { minX: doorR, maxX: ROOM.maxX + T, minZ: ROOM.maxZ, maxZ: ROOM.maxZ + T },
    );

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color: 0xd3d9df, roughness: 0.9 }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = h;
    s.add(ceiling);

    const toDesk = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), new THREE.MeshStandardMaterial({ map: Tex.signTexture('HELPDESK →', 'CORRIDOR'), roughness: 0.6 }));
    toDesk.position.set(DOORWAY.x, DOORWAY.height + 0.3, ROOM.maxZ - 0.01);
    toDesk.rotation.y = Math.PI;
    s.add(toDesk);

    const hall = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshStandardMaterial({ map: Tex.signTexture('DATA HALL 2', 'ROWS A–B · CORE'), roughness: 0.6 }));
    hall.position.set(0, 2.9, ROOM.minZ + 0.01);
    s.add(hall);
  }

  _buildCeilingLights() {
    const xs = [-3.1, -1.85, 0, 1.85, 3.1];
    const zs = [];
    for (let z = -6.3; z <= 6.31; z += 1.8) zs.push(z);
    const n = xs.length * zs.length;
    const housing = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.14, 0.05, 1.5),
      new THREE.MeshStandardMaterial({ color: 0xb9c0c7, metalness: 0.6, roughness: 0.35 }),
      n,
    );
    const diffuser = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.1, 1.46).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 2.4, 2.6), toneMapped: false }),
      n,
    );
    let i = 0;
    for (const x of xs) {
      for (const z of zs) {
        housing.setMatrixAt(i, placement(x, ROOM.height - 0.025, z));
        diffuser.setMatrixAt(i, placement(x, ROOM.height - 0.051, z));
        i++;
      }
    }
    this.scene.add(housing, diffuser);
  }

  // ---- Racks ----------------------------------------------------------------

  async _buildRacks() {
    const types = ['rack', 'server1U', 'server2U', 'switch1U', 'blankPanel'];
    const models = Object.fromEntries(await Promise.all(types.map(async (t) => [t, await createModel(t)])));
    const instances = Object.fromEntries(types.map((t) => [t, []]));
    const cableGeos = [];
    const fiberGeos = [];
    const sfpModules = [];

    for (const row of ['A', 'B']) {
      for (let i = 0; i < RACKS_PER_ROW; i++) {
        const id = `${row}${String(i + 1).padStart(2, '0')}`;
        const x = row === 'A' ? -ROW_X : ROW_X;
        const z = (RACKS_PER_ROW / 2 - 0.5 - i) * RACK_PITCH; // rack 01 nearest the entrance
        const matrix = placement(x, 0, z, row === 'A' ? Math.PI / 2 : -Math.PI / 2);
        const rng = Tex.makeRng(seedFrom(id));
        const blocks = new Map(this._hostConfigs.filter((h) => h.rack === id && !h.tor).map((h) => [h.u + h.size - 1, h]));
        const items = planRack(rng, blocks);

        const group = new THREE.Group();
        group.matrixAutoUpdate = false;
        group.matrix.copy(matrix);
        group.matrixWorldNeedsUpdate = true;
        this.scene.add(group);

        const rack = {
          id,
          kind: 'rack',
          row,
          number: i + 1,
          matrix,
          group,
          position: v3(x, 0, z),
          servers: items.filter((it) => it.type.startsWith('server')).length,
          blanks: items.filter((it) => it.type === 'blankPanel').length,
        };
        this.racks.set(id, rack);
        instances.rack.push(matrix);

        const hostItems = [];
        for (const it of items) {
          const yc = uBottom(it.u) + (it.size * U) / 2;
          it.yc = yc;
          const local = it.type === 'blankPanel'
            ? placement(0, yc, SERVER_FRONT_Z + 0.003)
            : placement(0, yc, SERVER_FRONT_Z - SERVER_DEPTH / 2);
          instances[it.type].push(new THREE.Matrix4().multiplyMatrices(matrix, local));
          if (!it.type.startsWith('server')) continue;
          const leds = this._addServerLeds(matrix, it);
          if (it.host) hostItems.push({ item: it, leds });
        }
        const cableHost = hostItems.find((h) => h.item.host.cable);

        // patch cables from the TOR switch to a subset of servers
        const used = new Set();
        let port = 0;
        for (const it of items) {
          if (!it.type.startsWith('server') || it.host?.cable || rng() > 0.75) continue;
          if (port === CABLE_PORT) port++;
          if (port >= 24) break;
          const side = 0.226 + rng() * 0.022;
          const curve = new THREE.CatmullRomCurve3([...cableHead(port, side), ...cableSeated(side, it.yc)]);
          cableGeos.push(colouredTube(curve, CABLE_COLORS[Math.floor(rng() * CABLE_COLORS.length)], matrix));
          used.add(port++);
        }

        for (let p = 0; p < 24; p++) {
          const led = this._addLed(matrix, torPortX(p), uBottom(TOR_U) + U / 2 + TOR_LED_DY, SERVER_FRONT_Z + 0.0015,
            used.has(p) ? 'activity' : 'off', LED.green, { rate: 5 + rng() * 10, duty: 0.4 });
          if (cableHost && p === CABLE_PORT) cableHost.torLed = led;
        }
        rack.statusLed = this._addLed(matrix, -0.2, RACK_HEADER_Y, RACK.depth / 2 + 0.002, 'pulse', LED.blue, { rate: 1.2, scale: [14, 1.3, 1] });

        // SFP uplinks: modules + aqua fiber in cages 0-1, link LEDs above every cage
        rack.sfpLeds = [0, 1, 2, 3].map((c) =>
          this._addLed(matrix, sfpCageX(c), TOR_YC + SFP_LED_DY, SERVER_FRONT_Z + 0.0015, FIBER_CAGES.includes(c) ? 'activity' : 'off', LED.green, { rate: 6 + rng() * 8, duty: 0.3 }),
        );
        for (const c of FIBER_CAGES) {
          const x = sfpCageX(c);
          sfpModules.push(new THREE.Matrix4().multiplyMatrices(matrix, placement(x, TOR_YC, SERVER_FRONT_Z + 0.006)));
          const curve = new THREE.CatmullRomCurve3([
            v3(x, TOR_YC, 0.49), v3(x, TOR_YC + 0.002, 0.505), v3(x + 0.012, TOR_YC + 0.03, 0.515),
            v3(0.225 + c * 0.012, 1.93, 0.5), v3(0.225 + c * 0.012, 1.99, 0.42),
          ]);
          fiberGeos.push(colouredTube(curve, new THREE.Color(FIBER_AQUA), matrix, 0.0018));
        }

        this._addLabel(group, id);
        // Hitboxes sit flush with the server faces (not out at the rack front) so aiming
        // from above/below lands where you look; the rack's outline is still drawn at the front.
        this._addHitbox(rack, group, new THREE.PlaneGeometry(RACK.width, 1.92), v3(0, 0.98, SERVER_FRONT_Z - 0.005));
        rack.highlight.position.z = RACK.depth / 2 + 0.013;

        for (const h of hostItems) this._createHost(rack, h);
        const switchHost = this._hostConfigs.find((h) => h.rack === id && h.tor);
        if (switchHost) this._createSwitchHost(rack, switchHost);
      }
    }
    const rowHalfLen = (RACKS_PER_ROW * RACK_PITCH) / 2;
    this.colliders.push({ minX: -ROW_X - RACK.depth / 2, maxX: -AISLE_HALF, minZ: -rowHalfLen, maxZ: rowHalfLen });
    this.colliders.push({ minX: AISLE_HALF, maxX: ROW_X + RACK.depth / 2, minZ: -rowHalfLen, maxZ: rowHalfLen });

    for (const type of types) {
      const { geometry, material } = models[type];
      const list = instances[type];
      const mesh = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = type === 'rack';
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      if (type === 'rack') this.occluders.push(mesh);
    }

    const cables = new THREE.Mesh(mergeGeometries([...cableGeos, ...fiberGeos]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
    this.scene.add(cables);

    // SFP modules (metal body) and their LC connectors, one instance per fibered cage
    const sfpMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0135, 0.0085, 0.03), new THREE.MeshStandardMaterial({ color: 0xb5bcc4, metalness: 0.85, roughness: 0.3 }), sfpModules.length);
    const lcMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.007, 0.014).translate(0, 0, 0.022), new THREE.MeshStandardMaterial({ color: FIBER_AQUA, roughness: 0.5 }), sfpModules.length);
    sfpModules.forEach((m, i) => {
      sfpMesh.setMatrixAt(i, m);
      lcMesh.setMatrixAt(i, m);
    });
    sfpMesh.computeBoundingSphere();
    lcMesh.computeBoundingSphere();
    this.scene.add(sfpMesh, lcMesh);
  }

  _addServerLeds(matrix, it) {
    const fz = SERVER_FRONT_Z + 0.0015;
    const y = it.yc + statusLedDy(it.size);
    this._addLed(matrix, STATUS_LED_X[0], y, fz, 'solid', LED.blue);
    const link = this._addLed(matrix, STATUS_LED_X[1], y, fz, 'activity', LED.green, { rate: 4 + Math.random() * 8, duty: 0.35 });
    const bays = Tex.serverBayLeds(it.size).map((b) =>
      this._addLed(matrix, b.x, it.yc + b.dy, fz, 'activity', LED.green, { rate: 3 + Math.random() * 10, duty: 0.55 + Math.random() * 0.3 }),
    );
    return { link, bays };
  }

  /**
   * A named server. It gets a front hitbox (kind 'host') plus one 'fixture' target per
   * physical job its ticket needs; a fixture's `key` names the scenario's physical action.
   */
  _createHost(rack, { item, leds, torLed }) {
    const cfg = item.host;
    const host = { ...cfg, kind: 'host', rack: rack.id, rackObj: rack, u: item.u, yc: item.yc, statusLed: leds.link, torLed, targets: [] };
    this._addHitbox(host, rack.group, new THREE.PlaneGeometry(0.48, item.size * U + 0.03), v3(0, item.yc, SERVER_FRONT_Z + 0.005));
    const fixture = (key, ctrl, geometry, position) => {
      const f = { kind: 'fixture', key, host, ctrl };
      this._addHitbox(f, rack.group, geometry, position);
      host.targets.push(f);
      return f;
    };

    if (cfg.cable) {
      const cable = new PatchCable(rack.group, cableHead(CABLE_PORT, CABLE_SIDE), cableLoose(CABLE_SIDE, item.yc), cableSeated(CABLE_SIDE, item.yc));
      this._updatables.push(cable);
      host.cable = fixture('cable', cable, new THREE.PlaneGeometry(0.1, 0.46), v3(CABLE_SIDE - 0.02, item.yc - 0.17, 0.55));
      if (torLed) torLed.mode = 'off';
    }
    if (cfg.disk) {
      const bay = Tex.serverBayLocal(item.size, cfg.disk.col, cfg.disk.row);
      bay.y = item.yc + bay.dy;
      const caddy = new DiskCaddy(rack.group, bay, leds.bays[cfg.disk.col]);
      this._updatables.push(caddy);
      // generous target around the bay (full server height); the console stays reachable on the right half
      host.disk = fixture('disk', caddy, new THREE.PlaneGeometry(0.11, item.size * U + 0.03), v3(bay.x, item.yc, SERVER_FRONT_Z + 0.01));
    }
    if (cfg.psu) {
      host.psus = Tex.serverPsuSlots(item.size).map((slot, i) => {
        const y = item.yc + slot.dy;
        const led = this._addLed(rack.matrix, slot.x - slot.w * 0.32, y + slot.h * 0.28, REAR_Z - 0.0135, 'solid', LED.green);
        const module = new PsuModule(rack.group, slot, y, led);
        if (cfg.psu.failed === i + 1) module.set('failed', false);
        this._updatables.push(module);
        // rear-facing target, only hit from the hot aisle
        return fixture(`psu${i + 1}`, module, new THREE.PlaneGeometry(slot.w + 0.006, slot.h + 0.006).rotateY(Math.PI), v3(slot.x, y, REAR_Z - 0.016));
      });
    }
    this.hosts.set(cfg.id, host);
  }

  /** A top-of-rack switch as a ticket host, with an SFP cage as its fixture. */
  _createSwitchHost(rack, cfg) {
    const host = { ...cfg, kind: 'host', rack: rack.id, rackObj: rack, u: TOR_U, yc: TOR_YC, statusLed: null, targets: [] };
    host.sfpLed = rack.sfpLeds[cfg.sfp.cage];
    host.sfpLed.mode = 'off';
    this._addHitbox(host, rack.group, new THREE.PlaneGeometry(0.48, U + 0.02), v3(0, TOR_YC, SERVER_FRONT_Z + 0.005));
    const f = { kind: 'fixture', key: 'sfp', host };
    this._addHitbox(f, rack.group, new THREE.PlaneGeometry(0.03, 0.032), v3(sfpCageX(cfg.sfp.cage), TOR_YC, 0.505));
    host.targets.push(f);
    this.hosts.set(cfg.id, host);
  }

  /** Rack header light: 'normal' (blue pulse), 'alert' (amber blink), 'red' (escalated) or 'ok' (green). */
  setRackState(rackId, state) {
    Object.assign(this.racks.get(rackId).statusLed, LED_STATES.rack[state]);
  }

  /** Host status LED: 'normal' (green activity), 'fault' (amber blink) or 'ok' (solid green). */
  setHostState(hostId, state) {
    const led = this.hosts.get(hostId)?.statusLed;
    if (led) Object.assign(led, LED_STATES.host[state]);
  }

  /**
   * Make the world match a scenario's physical state, e.g. { cableSeated, diskSwapped }.
   * Animates when `animate` is set and calls onDone once the animation has finished.
   */
  applyWorld(hostId, world, animate, onDone) {
    const host = this.hosts.get(hostId);
    let pending = 1;
    const finish = () => --pending === 0 && onDone?.();
    if (host.psus && world.psu) {
      host.psus.forEach((f, i) => {
        pending++;
        f.ctrl.set(world.psu[i + 1], animate, finish);
      });
    }
    if (host.sfpLed && world.sfpLink !== undefined) {
      Object.assign(host.sfpLed, world.sfpLink ? { mode: 'activity', color: LED.green, rate: 9 } : { mode: 'off' });
    }
    if (host.cable && world.cableSeated !== undefined && world.cableSeated !== host.cable.ctrl.isSeated) {
      pending++;
      host.cable.ctrl.setSeated(world.cableSeated, animate, () => {
        if (host.torLed) host.torLed.mode = world.cableSeated ? 'activity' : 'off';
        finish();
      });
    }
    if (host.disk && world.diskSwapped !== undefined) {
      pending++;
      host.disk.ctrl.set(world.diskSwapped, animate, finish);
    }
    finish();
  }

  _addLabel(group, text) {
    const geo = new THREE.PlaneGeometry(0.26, 0.068);
    const mat = new THREE.MeshStandardMaterial({ map: Tex.labelTexture(text), roughness: 0.6 });
    const front = new THREE.Mesh(geo, mat);
    front.position.set(0.06, RACK_HEADER_Y, RACK.depth / 2 + 0.0015);
    const back = new THREE.Mesh(geo, mat);
    back.position.set(0, RACK_HEADER_Y, -RACK.depth / 2 - 0.0015);
    back.rotation.y = Math.PI;
    group.add(front, back);
  }

  _addHitbox(target, group, geometry, position) {
    addHitbox(target, group, geometry, position);
  }

  // ---- Core switch & cooling -----------------------------------------------

  async _buildCoreSwitch() {
    const { geometry, material } = await createModel('coreSwitch');
    const { width, height, depth } = Tex.CORE;
    const matrix = placement(0, 0, CORE_Z, 0);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrix);
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.occluders.push(mesh);
    this.colliders.push({ minX: -width / 2, maxX: width / 2, minZ: CORE_Z - depth / 2, maxZ: CORE_Z + depth / 2 });

    for (const p of Tex.coreLedPositions()) {
      const blue = Math.random() < 0.08;
      this._addLed(matrix, p.x, p.y, depth / 2 + 0.002, blue ? 'solid' : 'activity', blue ? LED.blue : LED.green, { rate: 4 + Math.random() * 12, duty: 0.3 });
    }

    const group = new THREE.Group();
    group.position.set(0, 0, CORE_Z);
    this.scene.add(group);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.11), new THREE.MeshStandardMaterial({ map: Tex.labelTexture('CORE-01'), roughness: 0.6 }));
    plate.position.set(0, 2.1, depth / 2 + 0.002);
    group.add(plate);
    this.core = { id: 'CORE-01', kind: 'core', position: v3(0, 0, CORE_Z) };
    this._addHitbox(this.core, group, new THREE.PlaneGeometry(width, height), v3(0, height / 2, depth / 2 + 0.01));
  }

  async _buildCooling() {
    const { geometry, material } = await createModel('crac');
    const spots = [[-3.77, -4.4], [-3.77, 3.8], [3.77, -4.4], [3.77, 3.8]];
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    spots.forEach(([x, z], i) => {
      mesh.setMatrixAt(i, placement(x, 0, z, x < 0 ? 0 : Math.PI));
      this.colliders.push({ minX: x - 0.43, maxX: x + 0.43, minZ: z - 0.9, maxZ: z + 0.9 });
    });
    mesh.castShadow = mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // ---- Parts shelf ----------------------------------------------------------------

  /** Steel shelf by the exit with two bins per level (see SHELF_LEVELS). Items are instanced per shape. */
  _buildShelf() {
    const { x: X, z: Z, width: W, depth: D, levels } = SHELF;
    const front = Z - D / 2;
    const steel = new THREE.MeshStandardMaterial({ color: 0x5d646c, metalness: 0.3, roughness: 0.75 }); // powder-coated, no mirror glare
    const frame = [];
    for (const dx of [-W / 2 + 0.02, W / 2 - 0.02]) for (const dz of [-D / 2 + 0.02, D / 2 - 0.02]) frame.push(new THREE.BoxGeometry(0.03, 1.75, 0.03).translate(X + dx, 0.875, Z + dz));
    for (const y of levels) frame.push(new THREE.BoxGeometry(W, 0.02, D).translate(X, y - 0.01, Z));
    frame.push(new THREE.BoxGeometry(W, 0.02, D).translate(X, 1.74, Z));
    const frameMesh = new THREE.Mesh(mergeGeometries(frame), steel);
    frameMesh.castShadow = frameMesh.receiveShadow = true;
    this.scene.add(frameMesh);
    this.colliders.push({ minX: X - W / 2, maxX: X + W / 2, minZ: Z - D / 2, maxZ: ROOM.maxZ });

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.25), new THREE.MeshStandardMaterial({ map: Tex.signTexture('SPARE PARTS', 'TAKE ONE · LOG IT'), roughness: 0.6 }));
    sign.position.set(X, 2.0, ROOM.maxZ - 0.01);
    sign.rotation.y = Math.PI;
    this.scene.add(sign);

    const shapes = {
      disk: new THREE.BoxGeometry(0.1, 0.026, 0.147),
      ssd: new THREE.BoxGeometry(0.07, 0.007, 0.1),
      psu: new THREE.BoxGeometry(0.054, 0.04, 0.2),
      sfp: new THREE.BoxGeometry(0.014, 0.0085, 0.056),
      coil: new THREE.TorusGeometry(0.065, 0.008, 6, 20).rotateX(Math.PI / 2),
    };
    const placed = Object.fromEntries(Object.keys(shapes).map((k) => [k, []]));
    SHELF_LEVELS.forEach((pair, li) => {
      const y = levels[li];
      pair.forEach((partId, bi) => {
        const part = PARTS[partId];
        const bx = X + (bi === 0 ? -W / 4 : W / 4);
        const count = part.shape === 'sfp' ? 5 : 3;
        for (let k = 0; k < count; k++) {
          const ix = bx + (k - (count - 1) / 2) * (part.shape === 'sfp' ? 0.05 : part.shape === 'coil' ? 0.12 : 0.14);
          const h = shapes[part.shape].parameters.height ?? 0.02;
          placed[part.shape].push({ m: placement(ix, y + (part.shape === 'coil' ? 0.012 + k * 0.004 : h / 2), Z + 0.02), color: new THREE.Color(part.color) });
        }
        const label = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.094), new THREE.MeshStandardMaterial({ map: Tex.binLabelTexture(part.label, part.spec), roughness: 0.6 }));
        label.position.set(bx, y - 0.06, front - 0.005);
        label.rotation.y = Math.PI;
        this.scene.add(label);
        const target = { kind: 'shelf', partId };
        const group = new THREE.Group();
        this.scene.add(group);
        this._addHitbox(target, group, new THREE.PlaneGeometry(W / 2 - 0.04, 0.36).rotateY(Math.PI), v3(bx, y + 0.1, front - 0.01));
        this.shelf.push(target);
      });
    });
    for (const [shape, list] of Object.entries(placed)) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(shapes[shape], new THREE.MeshStandardMaterial({ metalness: 0.4, roughness: 0.5 }), list.length);
      list.forEach(({ m, color }, i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color);
      });
      mesh.castShadow = true;
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    }
  }

  // ---- Overhead cable trays ---------------------------------------------------

  _buildCableTrays() {
    const tray = [];
    const hardware = [];
    const bundles = [];
    const W = 0.3;
    const H = 0.1;
    const T = 0.006;

    const run = (x0, z0, x1, z1) => {
      const alongZ = x0 === x1;
      const len = alongZ ? Math.abs(z1 - z0) : Math.abs(x1 - x0);
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const box = (w, h, l, off, oy) => {
        const g = alongZ ? new THREE.BoxGeometry(w, h, l) : new THREE.BoxGeometry(l, h, w);
        return g.translate(alongZ ? cx + off : cx, TRAY_Y + oy, alongZ ? cz : cz + off);
      };
      tray.push(box(W, T, len, 0, 0), box(T, H, len, -W / 2, H / 2), box(T, H, len, W / 2, H / 2));
      bundles.push(box(W - 0.06, 0.035, len - 0.02, 0, 0.021));
      for (let s = 0.3; s < len; s += 1.2) {
        const px = alongZ ? x0 : Math.min(x0, x1) + s;
        const pz = alongZ ? Math.min(z0, z1) + s : z0;
        for (const side of [-1, 1]) {
          const rx = alongZ ? px + side * (W / 2 + 0.03) : px;
          const rz = alongZ ? pz : pz + side * (W / 2 + 0.03);
          const rodLen = ROOM.height - TRAY_Y + 0.03;
          hardware.push(new THREE.CylinderGeometry(0.005, 0.005, rodLen, 6).translate(rx, TRAY_Y - 0.03 + rodLen / 2, rz));
        }
        const bar = alongZ ? new THREE.BoxGeometry(W + 0.08, 0.02, 0.03) : new THREE.BoxGeometry(0.03, 0.02, W + 0.08);
        hardware.push(bar.translate(px, TRAY_Y - 0.013, pz));
      }
    };

    run(-ROW_X, -2.85, -ROW_X, 2.7);
    run(ROW_X, -2.85, ROW_X, 2.7);
    run(-ROW_X - W / 2, -2.85, ROW_X + W / 2, -2.85);
    run(0, -2.85, 0, CORE_Z);

    for (const rack of this.racks.values()) {
      bundles.push(new THREE.CylinderGeometry(0.022, 0.022, TRAY_Y - RACK.height, 8).translate(rack.position.x, (TRAY_Y + RACK.height) / 2, rack.position.z));
    }
    for (const x of [-0.35, 0, 0.35]) {
      bundles.push(new THREE.CylinderGeometry(0.03, 0.03, TRAY_Y - Tex.CORE.height, 8).translate(x, (TRAY_Y + Tex.CORE.height) / 2, CORE_Z));
    }

    const add = (geos, mat, shadow) => {
      const m = new THREE.Mesh(mergeGeometries(geos), mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.scene.add(m);
    };
    add(tray, new THREE.MeshStandardMaterial({ color: 0xf2c100, roughness: 0.45, metalness: 0.1 }), true);
    add(hardware, new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.7 }), false);
    add(bundles, new THREE.MeshStandardMaterial({ color: 0x2e3f57, roughness: 0.7 }), true);
  }

  _buildSigns() {
    const backing = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.6 });
    const rodMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.7, roughness: 0.35 });
    for (const [row, x] of [['A', -ROW_X], ['B', ROW_X]]) {
      const mat = new THREE.MeshStandardMaterial({ map: Tex.signTexture(`ROW ${row}`, 'RACKS 01–08'), roughness: 0.5 });
      const geo = new THREE.PlaneGeometry(0.9, 0.28);
      for (const z of [2.95, -3.1]) {
        const y = 2.78;
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.3, 0.006), backing);
        board.position.set(x, y, z);
        const front = new THREE.Mesh(geo, mat);
        front.position.set(x, y, z + 0.0035);
        const back = new THREE.Mesh(geo, mat);
        back.position.set(x, y, z - 0.0035);
        back.rotation.y = Math.PI;
        this.scene.add(board, front, back);
        for (const dx of [-0.35, 0.35]) {
          const len = ROOM.height - (y + 0.15);
          const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, len, 5), rodMat);
          rod.position.set(x + dx, y + 0.15 + len / 2, z);
          this.scene.add(rod);
        }
      }
    }
  }

  // ---- LEDs -------------------------------------------------------------------

  _addLed(base, x, y, z, mode, color, { rate = 1, phase = Math.random(), duty = 0.4, scale = [1, 1, 1] } = {}) {
    const led = { matrix: new THREE.Matrix4().multiplyMatrices(base, placement(x, y, z, 0, ...scale)), mode, color, rate, phase, duty };
    this._leds.push(led);
    return led;
  }

  _buildLeds() {
    const n = this._leds.length;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.0045, 0.0045, 0.003), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
    this._leds.forEach((l, i) => mesh.setMatrixAt(i, l.matrix));
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.computeBoundingSphere();
    this.ledMesh = mesh;
    this.scene.add(mesh);
    this._updateLeds(0);
  }

  _updateLeds(t) {
    const arr = this.ledMesh.instanceColor.array;
    for (let i = 0; i < this._leds.length; i++) {
      const L = this._leds[i];
      let k;
      switch (L.mode) {
        case 'solid':
          k = 1;
          break;
        case 'pulse':
          k = 0.55 + 0.45 * Math.sin(t * L.rate * Math.PI * 2 + L.phase * 6.28);
          break;
        case 'blink':
          k = (t * L.rate + L.phase) % 1 < 0.5 ? 1 : 0.03;
          break;
        case 'activity':
          k = hash(Math.floor(t * L.rate + L.phase * 97) + i * 13.7) > L.duty ? 1 : 0.06;
          break;
        default:
          k = 0.02;
      }
      arr[i * 3] = L.color.r * k;
      arr[i * 3 + 1] = L.color.g * k;
      arr[i * 3 + 2] = L.color.b * k;
    }
    this.ledMesh.instanceColor.needsUpdate = true;
  }
}

/** Invisible raycast target plus a subtle outline shown while it's targeted. */
export function addHitbox(target, group, geometry, position) {
  const hitbox = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.copy(position);
  const highlight = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), HIGHLIGHT_MATERIAL);
  // nudge the outline towards the viewer: +z for front-facing targets, -z for rear/shelf ones
  const nz = geometry.attributes.normal?.getZ(0) ?? 1;
  highlight.position.copy(position).z += nz < 0 ? -0.003 : 0.003;
  highlight.scale.setScalar(1.02);
  highlight.visible = false;
  group.add(hitbox, highlight);
  target.hitbox = hitbox;
  target.highlight = highlight;
  return target;
}

function colouredTube(curve, color, matrix, radius = 0.0026) {
  const geo = new THREE.TubeGeometry(curve, 40, radius, 5);
  geo.applyMatrix4(matrix);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(col, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
