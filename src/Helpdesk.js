import * as THREE from 'three';
import { canvasTexture } from './Textures.js';
import { addHitbox } from './Scene.js';
import { ROOM, DOORWAY, CORRIDOR, OFFICE } from './constants.js';

const DESK = { x: -2.6, z: OFFICE.maxZ - 1.5, top: 0.74 };
const WINDOW = { width: 2.4, height: 1.35, sill: 0.95 }; // in the west wall, centred
const STATUS_COLORS = { ok: '#2fbf71', amber: '#f0a020', red: '#e5484d' };

/**
 * The helpdesk wing: a swinging door in the server room's +z wall, a short corridor and a
 * quiet carpeted office with a desk (two live monitors, a laptop, a desk phone), a radio
 * on a side cabinet and an exit door home.
 *
 * `statusSource()` feeds the monitors: { racks: {A01: 'ok'|'amber'|'red'}, switches: {...},
 * core, queue: [{ id, priority, title, status, slaLeft, breached }], calls }.
 */
export class HelpdeskRoom {
  constructor(scene, { colliders, statusSource }) {
    this.scene = scene;
    this.colliders = colliders;
    this.statusSource = statusSource;
    this.targets = {};
    this.doorOpen = 0; // 0 closed .. 1 open
    this.ringing = false; // set by the Desk
    this._redraw = 0;
    this._blink = false;
  }

  build() {
    this._buildDoor();
    this._buildCorridor();
    this._buildOffice();
    this._buildDesk();
    this._buildRadio();
    this._buildExit();
    this._drawMonitors();
  }

  /** 0 in the server room, 1 in the office, in between along the corridor. */
  zoneBlend(pos) {
    if (pos.z <= ROOM.maxZ) return 0;
    if (pos.z >= CORRIDOR.maxZ) return 1;
    return (pos.z - ROOM.maxZ) / (CORRIDOR.maxZ - ROOM.maxZ);
  }

  update(dt, t, playerPos) {
    // the door opens on its own when you walk up to it, from either side
    const near = Math.hypot(playerPos.x - DOORWAY.x, playerPos.z - ROOM.maxZ) < 1.8;
    this.doorOpen = THREE.MathUtils.clamp(this.doorOpen + (near ? dt : -dt) / 0.6, 0, 1);
    const e = this.doorOpen * this.doorOpen * (3 - 2 * this.doorOpen);
    this.doorPivot.rotation.y = -1.7 * e;

    // a ringing phone: blinking LED and a rattling handset
    if (this.phoneLed) {
      const on = this.ringing && Math.floor(t * 4) % 2 === 0;
      this.phoneLed.material.color.set(on ? 0xff3b30 : this.ringing ? 0x551510 : 0x222222);
      this.handset.position.y = 0.065 + (this.ringing && Math.floor(t * 12) % 2 ? 0.004 : 0);
    }

    this._redraw += dt;
    if (this._redraw > 0.5) {
      this._redraw = 0;
      this._blink = !this._blink;
      this._drawMonitors();
    }
  }

  // ---- geometry ---------------------------------------------------------------------

  _plane(w, h, mat, x, y, z, rotY = 0, rotX = 0) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.set(rotX, rotY, 0, 'YXZ');
    m.receiveShadow = true;
    this.scene.add(m);
    return m;
  }

  _box(w, h, d, mat, x, y, z, parent = this.scene) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  _buildDoor() {
    const left = DOORWAY.x - DOORWAY.width / 2;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x8a9199, metalness: 0.6, roughness: 0.35 });
    const t = 0.05;
    this._box(t, DOORWAY.height, 0.24, frameMat, left - t / 2, DOORWAY.height / 2, ROOM.maxZ);
    this._box(t, DOORWAY.height, 0.24, frameMat, left + DOORWAY.width + t / 2, DOORWAY.height / 2, ROOM.maxZ);
    this._box(DOORWAY.width + 2 * t, t, 0.24, frameMat, DOORWAY.x, DOORWAY.height + t / 2, ROOM.maxZ);

    // hinged on the left; swings into the corridor
    this.doorPivot = new THREE.Group();
    this.doorPivot.position.set(left + 0.01, 0, ROOM.maxZ + 0.03);
    this.scene.add(this.doorPivot);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x5b6168, metalness: 0.35, roughness: 0.5 });
    this._box(DOORWAY.width - 0.02, DOORWAY.height - 0.02, 0.045, doorMat, (DOORWAY.width - 0.02) / 2, (DOORWAY.height - 0.02) / 2, 0, this.doorPivot);
    const barMat = new THREE.MeshStandardMaterial({ color: 0xb8bec4, metalness: 0.8, roughness: 0.3 });
    for (const side of [-1, 1]) this._box(0.6, 0.035, 0.035, barMat, DOORWAY.width * 0.55, 1.0, side * 0.045, this.doorPivot);
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fb7c9, metalness: 0.1, roughness: 0.1, transparent: true, opacity: 0.35 });
    this._box(0.22, 0.6, 0.05, glass, DOORWAY.width * 0.5, 1.55, 0, this.doorPivot);
  }

  _buildCorridor() {
    const C = CORRIDOR;
    const w = C.maxX - C.minX;
    const len = C.maxZ - C.minZ;
    const cx = (C.minX + C.maxX) / 2;
    const cz = (C.minZ + C.maxZ) / 2;
    const floor = new THREE.MeshStandardMaterial({ map: vinylTexture(w / 0.5, len / 0.5), roughness: 0.6 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9dcd6, roughness: 0.9 });
    this._plane(w, len, floor, cx, 0.001, cz, 0, -Math.PI / 2);
    this._plane(w, len, new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.9 }), cx, C.height, cz, 0, Math.PI / 2);
    this._plane(len, C.height, wallMat, C.minX, C.height / 2, cz, Math.PI / 2);
    this._plane(len, C.height, wallMat, C.maxX, C.height / 2, cz, -Math.PI / 2);
    // the corridor side of the server-room wall, around the door
    const doorL = DOORWAY.x - DOORWAY.width / 2;
    const doorR = DOORWAY.x + DOORWAY.width / 2;
    this._plane(doorL - C.minX, C.height, wallMat, (C.minX + doorL) / 2, C.height / 2, ROOM.maxZ + 0.005);
    this._plane(C.maxX - doorR, C.height, wallMat, (doorR + C.maxX) / 2, C.height / 2, ROOM.maxZ + 0.005);
    this._plane(DOORWAY.width, C.height - DOORWAY.height, wallMat, DOORWAY.x, (C.height + DOORWAY.height) / 2, ROOM.maxZ + 0.005);
    // light strip
    this._plane(0.18, len - 0.6, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.3), toneMapped: false }), cx, C.height - 0.01, cz, 0, Math.PI / 2);
    const T = 0.2;
    this.colliders.push(
      { minX: C.minX - T, maxX: C.minX, minZ: C.minZ, maxZ: C.maxZ },
      { minX: C.maxX, maxX: C.maxX + T, minZ: C.minZ, maxZ: C.maxZ },
    );
  }

  _buildOffice() {
    const O = OFFICE;
    const w = O.maxX - O.minX;
    const d = O.maxZ - O.minZ;
    const cx = (O.minX + O.maxX) / 2;
    const cz = (O.minZ + O.maxZ) / 2;
    const carpet = new THREE.MeshStandardMaterial({ map: carpetTexture(w / 1.2, d / 1.2), roughness: 1 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9cfc0, roughness: 0.95 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x2f4f5f, roughness: 0.95 });
    this._plane(w, d, carpet, cx, 0.001, cz, 0, -Math.PI / 2);
    this._plane(w, d, new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: 0.95 }), cx, O.height, cz, 0, Math.PI / 2);
    this._plane(w, O.height, accent, cx, O.height / 2, O.maxZ, Math.PI); // behind the desk
    // west wall, built around a real window opening (see _buildWindow)
    const win = WINDOW;
    const zl = cz - win.width / 2;
    const zr = cz + win.width / 2;
    this._plane(zl - O.minZ, O.height, wallMat, O.minX, O.height / 2, (O.minZ + zl) / 2, Math.PI / 2);
    this._plane(O.maxZ - zr, O.height, wallMat, O.minX, O.height / 2, (zr + O.maxZ) / 2, Math.PI / 2);
    this._plane(win.width, win.sill, wallMat, O.minX, win.sill / 2, cz, Math.PI / 2);
    const top = win.sill + win.height;
    this._plane(win.width, O.height - top, wallMat, O.minX, (O.height + top) / 2, cz, Math.PI / 2);
    this._plane(d, O.height, wallMat, O.maxX, O.height / 2, cz, -Math.PI / 2);
    // south wall with the opening to the corridor
    this._plane(CORRIDOR.minX - O.minX, O.height, wallMat, (O.minX + CORRIDOR.minX) / 2, O.height / 2, O.minZ);
    this._plane(O.maxX - CORRIDOR.maxX, O.height, wallMat, (CORRIDOR.maxX + O.maxX) / 2, O.height / 2, O.minZ);
    this._plane(CORRIDOR.maxX - CORRIDOR.minX, O.height - CORRIDOR.height, wallMat, (CORRIDOR.minX + CORRIDOR.maxX) / 2, (O.height + CORRIDOR.height) / 2, O.minZ);
    // skirting
    const skirt = new THREE.MeshStandardMaterial({ color: 0x6b5b4b, roughness: 0.7 });
    this._plane(d, 0.1, skirt, O.minX + 0.004, 0.05, cz, Math.PI / 2);
    this._plane(d, 0.1, skirt, O.maxX - 0.004, 0.05, cz, -Math.PI / 2);

    // warm ceiling panels and one soft light
    const panel = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.08, 0.9), toneMapped: false });
    for (const [x, z] of [[cx - 1.6, cz], [cx + 1.6, cz]]) this._plane(1.0, 0.6, panel, x, O.height - 0.01, z, 0, Math.PI / 2);
    const lamp = new THREE.PointLight(0xffd9b0, 2.5, 10, 2);
    lamp.position.set(DESK.x, O.height - 0.3, DESK.z - 1.2);
    this.scene.add(lamp);

    this._buildWindow(cz);

    // a plant and a poster
    const poster = canvasTexture(400, 520, (g, W, H) => {
      g.fillStyle = '#f4efe6';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#2f4f5f';
      g.fillRect(0, 0, W, 150);
      g.fillStyle = '#fff';
      g.font = 'bold 54px Arial, sans-serif';
      g.fillText('HELPDESK', 40, 95);
      g.fillStyle = '#2f4f5f';
      g.font = 'bold 30px Arial, sans-serif';
      ['1. Listen', '2. Ask, don\u2019t guess', '3. Check from our side', '4. Fix, then verify', '5. Call back'].forEach((l, i) => g.fillText(l, 40, 220 + i * 56));
    });
    this._plane(0.5, 0.65, new THREE.MeshStandardMaterial({ map: poster, roughness: 0.8 }), O.maxX - 0.01, 1.55, cz - 0.6, -Math.PI / 2);
    const pot = this._box(0.32, 0.4, 0.32, new THREE.MeshStandardMaterial({ color: 0xb4785a, roughness: 0.8 }), O.minX + 0.45, 0.2, O.maxZ - 0.45);
    pot.geometry = new THREE.CylinderGeometry(0.17, 0.13, 0.4, 16);
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshStandardMaterial({ color: 0x3f7d4a, roughness: 0.8, flatShading: true }));
    leaves.position.set(O.minX + 0.45, 0.85, O.maxZ - 0.45);
    leaves.scale.set(1, 1.3, 1);
    this.scene.add(leaves);

    const T = 0.2;
    this.colliders.push(
      { minX: O.minX - T, maxX: O.maxX + T, minZ: O.maxZ, maxZ: O.maxZ + T },
      { minX: O.minX - T, maxX: O.minX, minZ: O.minZ - T, maxZ: O.maxZ + T },
      { minX: O.maxX, maxX: O.maxX + T, minZ: O.minZ - T, maxZ: O.maxZ + T },
      { minX: O.minX - T, maxX: CORRIDOR.minX, minZ: O.minZ - T, maxZ: O.minZ },
      { minX: CORRIDOR.maxX, maxX: O.maxX + T, minZ: O.minZ - T, maxZ: O.minZ },
      { minX: O.minX + 0.2, maxX: O.minX + 0.7, minZ: O.maxZ - 0.7, maxZ: O.maxZ - 0.2 }, // plant
    );
  }

  /**
   * A window in the west wall: deep reveal, aluminium frame with a mullion and transom,
   * faintly reflective glass, a window board and half-lowered venetian blinds. Outside,
   * two curved layers of night city (far skyline and nearer buildings) give parallax.
   */
  _buildWindow(cz) {
    const O = OFFICE;
    const W = WINDOW;
    const x0 = O.minX; // wall surface
    const depth = 0.22; // wall thickness: the reveal
    const yc = W.sill + W.height / 2;
    const zl = cz - W.width / 2;
    const zr = cz + W.width / 2;

    // reveal: the inside faces of the opening
    const reveal = new THREE.MeshStandardMaterial({ color: 0xe4dbcd, roughness: 0.9 });
    const rx = x0 - depth / 2;
    this._plane(depth, W.height, reveal, rx, yc, zl, 0); // faces +z
    this._plane(depth, W.height, reveal, rx, yc, zr, Math.PI); // faces -z
    this._plane(depth, W.width, reveal, rx, W.sill + W.height, cz, 0, Math.PI / 2); // top of the reveal, facing down

    // window board (sill) sticking a little into the room
    const board = new THREE.MeshStandardMaterial({ color: 0xf0ebe3, roughness: 0.5 });
    this._box(depth + 0.1, 0.03, W.width + 0.12, board, x0 - depth / 2 + 0.05, W.sill - 0.015, cz);

    // aluminium frame: outer frame, a mullion, a transom with a top-hung vent above it
    const alu = new THREE.MeshStandardMaterial({ color: 0x3b4046, metalness: 0.6, roughness: 0.45 });
    const fx = x0 - depth + 0.06;
    const t = 0.05;
    const fd = 0.07;
    this._box(fd, t, W.width, alu, fx, W.sill + t / 2, cz);
    this._box(fd, t, W.width, alu, fx, W.sill + W.height - t / 2, cz);
    this._box(fd, W.height, t, alu, fx, yc, zl + t / 2);
    this._box(fd, W.height, t, alu, fx, yc, zr - t / 2);
    this._box(fd, W.height, t * 0.8, alu, fx, yc, cz);
    const transomY = W.sill + W.height * 0.72;
    this._box(fd, t * 0.8, W.width, alu, fx, transomY, cz);
    const handle = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, metalness: 0.8, roughness: 0.3 });
    this._box(0.04, 0.015, 0.12, handle, fx + 0.05, transomY - 0.05, cz - W.width / 4);

    // glass: barely there, with a hint of room reflection
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fb8cc, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0.9, depthWrite: false });
    this._plane(W.width - 0.04, W.height - 0.04, glass, fx, yc, cz, Math.PI / 2);

    // venetian blinds, lowered about a third, slats tilted open
    const blindDrop = W.height * 0.22;
    this._box(0.06, 0.04, W.width - 0.04, new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.6 }), x0 - 0.06, W.sill + W.height - 0.02, cz);
    const slatCount = Math.floor(blindDrop / 0.024);
    const slats = new THREE.InstancedMesh(new THREE.BoxGeometry(0.045, 0.0016, W.width - 0.06), new THREE.MeshStandardMaterial({ color: 0xece9e2, roughness: 0.55 }), slatCount);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.55);
    for (let i = 0; i < slatCount; i++) {
      m.compose(new THREE.Vector3(x0 - 0.06, W.sill + W.height - 0.06 - i * 0.024, cz), q, new THREE.Vector3(1, 1, 1));
      slats.setMatrixAt(i, m);
    }
    slats.computeBoundingSphere();
    this.scene.add(slats);
    this._box(0.05, 0.012, W.width - 0.05, new THREE.MeshStandardMaterial({ color: 0xd8d4cb, roughness: 0.6 }), x0 - 0.06, W.sill + W.height - 0.06 - slatCount * 0.024, cz);

    // the city outside, on two half-cylinders around the window (seamless from any angle)
    const outside = (radius, height, centerY, texture, transparent) => {
      const geo = new THREE.CylinderGeometry(radius, radius, height, 64, 1, true, Math.PI, Math.PI);
      const mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, transparent, depthWrite: !transparent, fog: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x0 - depth, centerY, cz);
      this.scene.add(mesh);
    };
    // far: sky, moon, stars and the skyline; horizon a little below eye level (third floor)
    outside(18, 26, 4.0, skylineTexture(), false);
    // near: lower buildings a block or two away, mostly below eye level
    outside(11, 12, -3.5, nearBuildingsTexture(), true);
  }

  _buildDesk() {
    const { x: X, z: Z, top: TOP } = DESK;
    const wood = new THREE.MeshStandardMaterial({ color: 0x9a7b5c, roughness: 0.6 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.5, metalness: 0.3 });
    const plastic = new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.55 });
    this._box(1.9, 0.04, 0.8, wood, X, TOP - 0.02, Z);
    for (const dx of [-0.88, 0.88]) this._box(0.04, TOP - 0.04, 0.74, dark, X + dx, (TOP - 0.04) / 2, Z);
    this._box(1.7, 0.4, 0.02, dark, X, TOP - 0.25, Z + 0.35);
    this.colliders.push({ minX: X - 0.95, maxX: X + 0.95, minZ: Z - 0.4, maxZ: Z + 0.4 });

    // chair
    const chair = new THREE.MeshStandardMaterial({ color: 0x1f3440, roughness: 0.7 });
    this._box(0.5, 0.08, 0.5, chair, X, 0.48, Z - 0.75);
    this._box(0.5, 0.55, 0.07, chair, X, 0.8, Z - 1.0);
    this._box(0.06, 0.42, 0.06, dark, X, 0.23, Z - 0.75);
    this._box(0.55, 0.04, 0.55, dark, X, 0.03, Z - 0.75);

    // two monitors, angled in towards the chair
    const mkMonitor = (dx, yaw, draw) => {
      const g = new THREE.Group();
      g.position.set(X + dx, TOP, Z + 0.18);
      g.rotation.y = yaw; // screens face -z, towards the chair
      this.scene.add(g);
      this._box(0.2, 0.015, 0.16, plastic, 0, 0.008, 0, g);
      this._box(0.05, 0.28, 0.04, plastic, 0, 0.14, 0.03, g);
      this._box(0.64, 0.4, 0.03, plastic, 0, 0.42, 0, g);
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 600;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.352), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      screen.position.set(0, 0.42, -0.016);
      screen.rotation.y = Math.PI;
      g.add(screen);
      const target = { kind: draw, canvas, tex };
      addHitbox(target, g, new THREE.PlaneGeometry(0.64, 0.4).rotateY(Math.PI), new THREE.Vector3(0, 0.42, -0.02));
      return target;
    };
    this.targets.queue = mkMonitor(-0.36, -0.18, 'queue');
    this.targets.dashboard = mkMonitor(0.36, 0.18, 'dashboard');

    // laptop, lid leaning back with a PowerShell window on it
    const laptop = new THREE.Group();
    laptop.position.set(X - 0.05, TOP, Z - 0.17);
    this.scene.add(laptop);
    const alu = new THREE.MeshStandardMaterial({ color: 0x5f646b, metalness: 0.4, roughness: 0.55 });
    this._box(0.34, 0.016, 0.24, alu, 0, 0.008, 0, laptop);
    const lid = new THREE.Group();
    lid.position.set(0, 0.016, 0.12);
    lid.rotation.x = 0.28;
    laptop.add(lid);
    this._box(0.34, 0.23, 0.008, alu, 0, 0.115, 0, lid);
    const psScreen = canvasTexture(512, 320, (g, W, H) => {
      g.fillStyle = '#012456';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#eeedf0';
      g.font = '18px monospace';
      ['Windows PowerShell', 'Copyright (C) Contoso ISP tools', '', 'PS C:\\Users\\tech> _'].forEach((l, i) => g.fillText(l, 14, 32 + i * 26));
    });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.2), new THREE.MeshBasicMaterial({ map: psScreen, toneMapped: false }));
    scr.position.set(0, 0.115, -0.005);
    scr.rotation.y = Math.PI;
    lid.add(scr);
    this.targets.laptop = addHitbox({ kind: 'laptop' }, laptop, new THREE.BoxGeometry(0.36, 0.26, 0.28), new THREE.Vector3(0, 0.12, 0.02));

    // desk phone
    const phone = new THREE.Group();
    phone.position.set(X + 0.62, TOP, Z - 0.12);
    phone.rotation.y = 0.35;
    this.scene.add(phone);
    this._box(0.2, 0.05, 0.17, plastic, 0, 0.025, 0, phone).rotation.x = -0.18;
    this.handset = this._box(0.06, 0.035, 0.2, dark, -0.06, 0.065, 0, phone);
    const lcd = canvasTexture(128, 48, (g, W, H) => {
      g.fillStyle = '#a7c3a0';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#20301c';
      g.font = 'bold 20px monospace';
      g.fillText('HELPDESK', 10, 31);
    });
    const lcdMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.026), new THREE.MeshBasicMaterial({ map: lcd }));
    lcdMesh.position.set(0.04, 0.058, -0.02);
    lcdMesh.rotation.set(-1.2, Math.PI, 0, 'YXZ');
    phone.add(lcdMesh);
    this.phoneLed = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 8), new THREE.MeshBasicMaterial({ color: 0x222222, toneMapped: false }));
    this.phoneLed.position.set(0.075, 0.06, -0.06);
    phone.add(this.phoneLed);
    this.phone = phone;
    this.targets.phone = addHitbox({ kind: 'phone' }, phone, new THREE.BoxGeometry(0.26, 0.14, 0.24), new THREE.Vector3(0, 0.06, 0));
  }

  /** A small side cabinet by the east wall with a retro radio on it (the audio anchor). */
  _buildRadio() {
    const x = OFFICE.maxX - 0.27;
    const z = OFFICE.minZ + 1.0;
    const cab = new THREE.MeshStandardMaterial({ color: 0x8a6f55, roughness: 0.65 });
    this._box(0.42, 0.72, 0.6, cab, x, 0.36, z);
    this._box(0.005, 0.012, 0.16, new THREE.MeshStandardMaterial({ color: 0xb9bcc0, metalness: 0.8, roughness: 0.3 }), x - 0.213, 0.6, z);
    this.colliders.push({ minX: x - 0.23, maxX: OFFICE.maxX, minZ: z - 0.32, maxZ: z + 0.32 });

    const radio = new THREE.Group();
    radio.position.set(x, 0.72, z);
    radio.rotation.y = -Math.PI / 2; // front faces into the room (-x)
    this.scene.add(radio);
    const body = new THREE.MeshStandardMaterial({ color: 0x6b3f2a, roughness: 0.5 });
    this._box(0.34, 0.2, 0.13, body, 0, 0.1, 0, radio);
    const front = canvasTexture(340, 200, (g, W, H) => {
      g.fillStyle = '#e8dcc2';
      g.fillRect(0, 0, W, H);
      // speaker grille
      g.fillStyle = '#3a2a20';
      for (let y = 22; y < H - 20; y += 9) for (let xx = 20; xx < 180; xx += 9) g.fillRect(xx, y, 5, 5);
      // tuning dial
      g.fillStyle = '#f6efdc';
      g.fillRect(200, 30, 120, 60);
      g.strokeStyle = '#6b5a45';
      g.strokeRect(200, 30, 120, 60);
      g.fillStyle = '#6b5a45';
      g.font = '12px Arial';
      ['88', '94', '100', '106'].forEach((l, i) => g.fillText(l, 206 + i * 29, 80));
      for (let i = 0; i < 24; i++) g.fillRect(206 + i * 4.8, 40, 1, i % 4 ? 8 : 14);
      g.fillStyle = '#c0392b';
      g.fillRect(262, 34, 2, 40);
      g.font = 'bold 13px Arial';
      g.fillStyle = '#3a2a20';
      g.fillText('FM · AM', 232, 115);
    });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.18), new THREE.MeshStandardMaterial({ map: front, roughness: 0.7 }));
    face.position.set(0, 0.1, 0.066);
    radio.add(face);
    const knobMat = new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: 0.4 });
    for (const kx of [0.06, 0.12]) {
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 16), knobMat);
      knob.rotation.x = Math.PI / 2;
      knob.position.set(kx, 0.045, 0.072);
      radio.add(knob);
    }
    const handle = this._box(0.22, 0.012, 0.02, knobMat, 0, 0.215, 0, radio);
    handle.castShadow = false;
    this.radioLed = new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 8), new THREE.MeshBasicMaterial({ color: 0x2a1a10, toneMapped: false }));
    this.radioLed.position.set(0.03, 0.045, 0.07);
    radio.add(this.radioLed);
    this.radio = radio;
    this.targets.radio = addHitbox({ kind: 'radio' }, radio, new THREE.BoxGeometry(0.38, 0.26, 0.18), new THREE.Vector3(0, 0.11, 0));
  }

  setRadioOn(on) {
    this.radioLed.material.color.set(on ? 0xffa040 : 0x2a1a10);
  }

  /** The way home: a fire-exit door in the east wall with a green EXIT sign. */
  _buildExit() {
    const W = 0.95;
    const H = 2.1;
    const z = OFFICE.maxZ - 1.0;
    const x = OFFICE.maxX;
    const door = new THREE.Group();
    door.position.set(x, 0, z);
    door.rotation.y = -Math.PI / 2; // faces -x, into the office
    this.scene.add(door);
    const frame = new THREE.MeshStandardMaterial({ color: 0x8a9199, metalness: 0.6, roughness: 0.35 });
    const t = 0.05;
    this._box(t, H + t, 0.06, frame, -W / 2 - t / 2, (H + t) / 2, 0.01, door);
    this._box(t, H + t, 0.06, frame, W / 2 + t / 2, (H + t) / 2, 0.01, door);
    this._box(W + 2 * t, t, 0.06, frame, 0, H + t / 2, 0.01, door);
    this._box(W, H, 0.04, new THREE.MeshStandardMaterial({ color: 0x5d6b73, roughness: 0.55, metalness: 0.2 }), 0, H / 2, 0.02, door);
    // push bar
    const steel = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, metalness: 0.85, roughness: 0.3 });
    this._box(W * 0.8, 0.05, 0.05, steel, 0, 1.0, 0.07, door);
    for (const bx of [-W * 0.38, W * 0.38]) this._box(0.05, 0.08, 0.06, steel, bx, 1.0, 0.05, door);
    // a small "staff exit" plate on the door
    const plate = canvasTexture(256, 96, (g, Wc, Hc) => {
      g.fillStyle = '#e9edf0';
      g.fillRect(0, 0, Wc, Hc);
      g.fillStyle = '#28323a';
      g.font = 'bold 30px Arial, sans-serif';
      g.textAlign = 'center';
      g.fillText('STAFF EXIT', Wc / 2, 44);
      g.font = '20px Arial, sans-serif';
      g.fillText('to car park', Wc / 2, 76);
    });
    const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.11), new THREE.MeshStandardMaterial({ map: plate, roughness: 0.6 }));
    plateMesh.position.set(0, 1.5, 0.042);
    door.add(plateMesh);
    // the green running-man sign above it
    const sign = canvasTexture(256, 96, (g, Wc, Hc) => {
      g.fillStyle = '#0f8a4a';
      g.fillRect(0, 0, Wc, Hc);
      g.fillStyle = '#ffffff';
      g.font = 'bold 54px Arial, sans-serif';
      g.textAlign = 'center';
      g.fillText('EXIT', Wc / 2 + 30, 68);
      g.font = 'bold 54px Arial, sans-serif';
      g.fillText('\u2190', 50, 66);
    });
    this._box(0.36, 0.14, 0.05, new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.5 }), 0, H + 0.2, 0.025, door);
    const signFace = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.125), new THREE.MeshBasicMaterial({ map: sign, toneMapped: false, color: new THREE.Color(0.9, 0.9, 0.9) }));
    signFace.position.set(0, H + 0.2, 0.052);
    door.add(signFace);
    this.targets.exit = addHitbox({ kind: 'exit' }, door, new THREE.BoxGeometry(W, H, 0.12), new THREE.Vector3(0, H / 2, 0.06));
  }

  // ---- live monitors ------------------------------------------------------------------

  _drawMonitors() {
    const s = this.statusSource();
    this._drawDashboard(this.targets.dashboard, s);
    this._drawQueue(this.targets.queue, s);
  }

  _drawDashboard({ canvas, tex }, s) {
    const g = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = '#0d1218';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#9fb3c8';
    g.font = 'bold 30px Arial, sans-serif';
    g.fillText('NOC · DATA HALL 2', 28, 50);
    const alarms = [...Object.values(s.racks), ...Object.values(s.switches), s.core].filter((x) => x !== 'ok').length;
    g.textAlign = 'right';
    g.fillStyle = alarms ? STATUS_COLORS.amber : STATUS_COLORS.ok;
    g.fillText(alarms ? `${alarms} ALARM${alarms > 1 ? 'S' : ''}` : 'ALL GREEN', W - 28, 50);
    g.textAlign = 'left';

    const color = (st) => (st === 'red' && this._blink ? '#7a1d20' : STATUS_COLORS[st] || STATUS_COLORS.ok);
    const tileW = 104;
    ['A', 'B'].forEach((row, ri) => {
      const y0 = 90 + ri * 210;
      g.fillStyle = '#6f8396';
      g.font = 'bold 22px Arial, sans-serif';
      g.fillText(`ROW ${row}`, 28, y0 + 22);
      for (let i = 0; i < 8; i++) {
        const id = `${row}${String(i + 1).padStart(2, '0')}`;
        const x = 28 + i * (tileW + 18);
        g.fillStyle = color(s.racks[id]);
        roundRect(g, x, y0 + 36, tileW, 82, 10);
        g.fillStyle = '#0d1218';
        g.font = 'bold 30px Arial, sans-serif';
        g.fillText(id, x + 16, y0 + 88);
        g.fillStyle = color(s.switches[id]);
        roundRect(g, x, y0 + 128, tileW, 36, 8);
        g.fillStyle = '#0d1218';
        g.font = 'bold 18px Arial, sans-serif';
        g.fillText('TOR', x + 34, y0 + 152);
      }
    });
    g.fillStyle = color(s.core);
    roundRect(g, 28, 520, 220, 56, 10);
    g.fillStyle = '#0d1218';
    g.font = 'bold 26px Arial, sans-serif';
    g.fillText('CORE-01', 76, 558);
    g.fillStyle = '#9fb3c8';
    g.font = '20px Arial, sans-serif';
    const legend = [['ok', 'OK'], ['amber', 'Alarm'], ['red', 'Escalated']];
    legend.forEach(([k, label], i) => {
      g.fillStyle = STATUS_COLORS[k];
      g.fillRect(300 + i * 150, 538, 20, 20);
      g.fillStyle = '#9fb3c8';
      g.fillText(label, 328 + i * 150, 555);
    });
    if (s.calls) {
      g.fillStyle = STATUS_COLORS.amber;
      g.textAlign = 'right';
      g.fillText(`Customer calls waiting: ${s.calls}`, W - 28, 555);
      g.textAlign = 'left';
    }
    tex.needsUpdate = true;
  }

  _drawQueue({ canvas, tex }, s) {
    const g = canvas.getContext('2d');
    const W = canvas.width;
    g.fillStyle = '#10151b';
    g.fillRect(0, 0, W, canvas.height);
    g.fillStyle = '#9fb3c8';
    g.font = 'bold 30px Arial, sans-serif';
    g.fillText('TICKET QUEUE', 28, 50);
    g.font = 'bold 18px Arial, sans-serif';
    g.fillStyle = '#6f8396';
    ['TICKET', 'PRIO', 'TITLE', 'STATUS', 'SLA'].forEach((h, i) => g.fillText(h, [28, 190, 270, 720, 900][i], 92));
    const rows = s.queue.slice(0, 9);
    if (!rows.length) {
      g.fillStyle = '#6f8396';
      g.font = '26px Arial, sans-serif';
      g.fillText('No open tickets.', 28, 150);
    }
    rows.forEach((r, i) => {
      const y = 136 + i * 50;
      g.fillStyle = i % 2 ? '#141b23' : '#18212b';
      g.fillRect(16, y - 32, W - 32, 46);
      g.font = 'bold 22px monospace';
      g.fillStyle = '#e8edf3';
      g.fillText(r.id, 28, y);
      g.fillStyle = r.priority === 'P1' ? STATUS_COLORS.red : r.priority === 'P2' ? STATUS_COLORS.amber : '#9fb3c8';
      g.fillText(r.priority, 190, y);
      g.fillStyle = '#e8edf3';
      g.font = '22px Arial, sans-serif';
      g.fillText(r.title.length > 34 ? `${r.title.slice(0, 33)}…` : r.title, 270, y);
      g.fillStyle = '#9fb3c8';
      g.fillText(r.status, 720, y);
      g.fillStyle = r.breached ? STATUS_COLORS.red : r.slaLeft < 120 ? STATUS_COLORS.amber : '#9fb3c8';
      g.font = 'bold 22px monospace';
      g.fillText(r.breached ? 'BREACH' : r.slaLeft === null ? '—' : fmt(r.slaLeft), 900, y);
    });
    tex.needsUpdate = true;
  }
}

function fmt(s) {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
  g.fill();
}

/** Night sky over a city: gradient with light pollution near the horizon, stars, a moon, and a skyline. */
function skylineTexture() {
  return canvasTexture(4096, 1024, (g, W, H) => {
    const horizon = H * 0.62;
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#03060f');
    sky.addColorStop(0.55, '#0b1530');
    sky.addColorStop(0.85, '#1c2342');
    sky.addColorStop(1, '#3a3149'); // sodium-lit haze over the city
    g.fillStyle = sky;
    g.fillRect(0, 0, W, horizon);
    for (let i = 0; i < 420; i++) {
      const y = Math.random() * horizon * 0.7;
      g.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.5 * (1 - y / horizon)})`;
      g.fillRect(Math.random() * W, y, 1.2, 1.2);
    }
    // moon with a soft halo
    const mx = W * 0.62;
    const my = H * 0.18;
    const halo = g.createRadialGradient(mx, my, 10, mx, my, 120);
    halo.addColorStop(0, 'rgba(230,236,255,0.35)');
    halo.addColorStop(1, 'rgba(230,236,255,0)');
    g.fillStyle = halo;
    g.fillRect(mx - 120, my - 120, 240, 240);
    g.fillStyle = '#e9edf7';
    g.beginPath();
    g.arc(mx, my, 22, 0, Math.PI * 2);
    g.fill();
    // ground below the horizon
    g.fillStyle = '#07080d';
    g.fillRect(0, horizon, W, H - horizon);
    // distant skyline, two bands
    for (const [shade, minH, maxH, lit] of [['#151a29', 60, 220, 0.12], ['#0e121d', 80, 340, 0.2]]) {
      let x = 0;
      while (x < W) {
        const w = 30 + Math.random() * 90;
        const h = minH + Math.random() * (maxH - minH) * (Math.random() < 0.1 ? 1.8 : 1);
        g.fillStyle = shade;
        g.fillRect(x, horizon - h, w, h + 2);
        for (let wy = horizon - h + 6; wy < horizon - 4; wy += 7) {
          for (let wx = x + 4; wx < x + w - 4; wx += 6) {
            if (Math.random() < lit) {
              g.fillStyle = Math.random() < 0.75 ? 'rgba(255,205,130,0.75)' : 'rgba(180,215,255,0.7)';
              g.fillRect(wx, wy, 2, 3);
            }
          }
        }
        if (h > maxH * 1.2) {
          g.fillStyle = '#ff3b30'; // aviation light on the tall ones
          g.fillRect(x + w / 2 - 2, horizon - h - 4, 4, 4);
        }
        x += w + Math.random() * 6;
      }
    }
    // the town below the horizon: low roofs, then streets of sodium lamps getting
    // sparser and bigger towards us, with the odd pair of car lights
    for (let band = 0; band < 6; band++) {
      const y = horizon + 12 + band * band * 9 + band * 14;
      if (y > H) break;
      let bx = Math.random() * 40;
      while (bx < W) {
        const bw = 40 + Math.random() * 120;
        const bh = 10 + band * 6 + Math.random() * 18;
        g.fillStyle = band % 2 ? '#0b0d14' : '#0d1018';
        g.fillRect(bx, y - bh, bw, bh);
        for (let k = 0; k < bw / 9; k++) {
          if (Math.random() < 0.18) {
            g.fillStyle = 'rgba(255,200,130,0.7)';
            g.fillRect(bx + 3 + k * 9, y - bh + 4 + Math.random() * (bh - 8), 2 + band * 0.4, 2 + band * 0.4);
          }
        }
        bx += bw + 8 + Math.random() * 30;
      }
      const spacing = 18 + band * 14;
      const size = 1 + band * 0.35;
      for (let lx = Math.random() * spacing; lx < W; lx += spacing * (0.6 + Math.random() * 0.9)) {
        if (Math.random() < 0.3) continue; // dark stretches and side streets
        const ly = y + 3 + (Math.random() - 0.5) * (4 + band * 3);
        const r = size * 2.4;
        const lamp = g.createRadialGradient(lx, ly, 0, lx, ly, r);
        lamp.addColorStop(0, 'rgba(255,200,130,0.85)');
        lamp.addColorStop(1, 'rgba(255,170,90,0)');
        g.fillStyle = lamp;
        g.fillRect(lx - r, ly - r, r * 2, r * 2);
      }
      for (let c = 0; c < 6 + band * 2; c++) {
        const cx = Math.random() * W;
        const red = Math.random() < 0.5;
        g.fillStyle = red ? 'rgba(255,60,50,0.9)' : 'rgba(255,250,235,0.95)';
        g.fillRect(cx, y + 6, size, size * 0.8);
        g.fillRect(cx + size * 3, y + 6, size, size * 0.8);
      }
    }
    // street-light glow along the horizon
    const glow = g.createLinearGradient(0, horizon - 40, 0, horizon + 30);
    glow.addColorStop(0, 'rgba(255,170,90,0)');
    glow.addColorStop(0.7, 'rgba(255,170,90,0.18)');
    glow.addColorStop(1, 'rgba(255,170,90,0)');
    g.fillStyle = glow;
    g.fillRect(0, horizon - 40, W, 70);
  });
}

/** Nearer buildings (transparent above them): offices and flats with lit windows, a few blue TV glows. */
function nearBuildingsTexture() {
  return canvasTexture(2048, 1024, (g, W, H) => {
    g.clearRect(0, 0, W, H);
    let x = -20;
    while (x < W) {
      const w = 90 + Math.random() * 160;
      const h = H * (0.3 + Math.random() * 0.4);
      const top = H - h;
      g.fillStyle = Math.random() < 0.5 ? '#0a0d15' : '#0c1019';
      g.fillRect(x, top, w, h);
      g.fillStyle = 'rgba(255,255,255,0.04)';
      g.fillRect(x, top, w, 3); // roof edge catching the sky
      const cols = Math.floor((w - 12) / 14);
      const rows = Math.floor((h - 16) / 17);
      const office = Math.random() < 0.4; // offices: rows of cool light; flats: scattered warm ones
      for (let r = 0; r < rows; r++) {
        const rowLit = office && Math.random() < 0.35;
        for (let c = 0; c < cols; c++) {
          const on = office ? rowLit && Math.random() < 0.85 : Math.random() < 0.3;
          if (!on) continue;
          const tv = !office && Math.random() < 0.08;
          g.fillStyle = tv ? 'rgba(120,160,255,0.85)' : office ? 'rgba(210,230,255,0.8)' : 'rgba(255,196,120,0.85)';
          g.fillRect(x + 8 + c * 14, top + 10 + r * 17, 7, 9);
        }
      }
      x += w + 10 + Math.random() * 60;
    }
    // street glow at the very bottom
    const glow = g.createLinearGradient(0, H - 90, 0, H);
    glow.addColorStop(0, 'rgba(255,160,80,0)');
    glow.addColorStop(1, 'rgba(255,160,80,0.35)');
    g.fillStyle = glow;
    g.fillRect(0, H - 90, W, 90);
  });
}

function carpetTexture(rx, ry) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3c4654';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)';
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    g.strokeStyle = 'rgba(0,0,0,0.18)';
    g.strokeRect(0, 0, w, h);
  }, { repeat: [rx, ry] });
}

function vinylTexture(rx, ry) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#b9bcb6';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, w, h);
  }, { repeat: [rx, ry] });
}
