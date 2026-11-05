import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const WALK_SPEED = 1.4; // m/s, normal walking pace
const FAST_SPEED = 2.6;
const ACCEL = 9;
const EYE_HEIGHT = 1.68;
const CROUCH_EYE_HEIGHT = 1.0; // low enough to read the bottom U's of a rack
const CROUCH_SPEED = 0.7;
const RADIUS = 0.28;
const STRIDE = 0.72; // metres per footstep

const isTyping = (e) => e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');

export class Player {
  constructor(camera, domElement, colliders, bounds) {
    this.camera = camera;
    this.domElement = domElement;
    this.colliders = colliders;
    this.bounds = bounds;
    this.controls = new PointerLockControls(camera, domElement);
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.keys = new Set();
    this.bobPhase = 0;
    this.crouched = false;
    this.eyeHeight = EYE_HEIGHT;
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();

    document.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      this.keys.add(e.code);
      if (e.code === 'KeyQ' && !e.repeat && this.isLocked) this.crouched = !this.crouched;
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    // Some browsers send one huge mouse movement right after the pointer is captured,
    // which spins the camera. Swallow movement for a moment after locking, and any
    // single jump that no hand could make.
    let lockedAt = 0;
    this.controls.addEventListener('lock', () => (lockedAt = performance.now()));
    document.addEventListener(
      'mousemove',
      (e) => {
        if (!this.isLocked) return;
        if (performance.now() - lockedAt < 150 || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) e.stopImmediatePropagation();
      },
      true,
    );
    this.controls.addEventListener('unlock', () => this.keys.clear());
  }

  get isLocked() {
    return this.controls.isLocked;
  }

  lock() {
    // requestPointerLock returns a promise in modern browsers; a rejection
    // (e.g. relocking too soon after Esc) just leaves the overlay up.
    this.domElement.requestPointerLock()?.catch?.(() => {});
  }

  unlock() {
    this.controls.unlock();
  }

  /** While a dialog is open, looking and walking stop. */
  freeze(on) {
    this.frozen = on;
    this.controls.enabled = !on;
    if (on) this.keys.clear();
  }

  setPosition(x, z) {
    this.position.set(x, 0, z);
    this.camera.position.set(x, this.eyeHeight, z);
  }

  update(dt) {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);

    this._wish.set(0, 0, 0);
    if (this.isLocked && !this.frozen && (f || r)) {
      this.camera.getWorldDirection(this._fwd);
      this._fwd.y = 0;
      this._fwd.normalize();
      this._right.crossVectors(this._fwd, this.camera.up).normalize();
      const speed = this.crouched ? CROUCH_SPEED : k.has('ShiftLeft') || k.has('ShiftRight') ? FAST_SPEED : WALK_SPEED;
      this._wish.addScaledVector(this._fwd, f).addScaledVector(this._right, r).normalize().multiplyScalar(speed);
    }

    const a = 1 - Math.exp(-ACCEL * dt);
    this.velocity.x += (this._wish.x - this.velocity.x) * a;
    this.velocity.z += (this._wish.z - this.velocity.z) * a;

    // resolve each axis separately so the player slides along walls/racks
    const nx = this.position.x + this.velocity.x * dt;
    if (!this._collides(nx, this.position.z)) this.position.x = nx;
    else this.velocity.x = 0;
    const nz = this.position.z + this.velocity.z * dt;
    if (!this._collides(this.position.x, nz)) this.position.z = nz;
    else this.velocity.z = 0;

    const target = this.crouched ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    this.eyeHeight += (target - this.eyeHeight) * (1 - Math.exp(-10 * dt));

    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.bobPhase += dt * speed * 7.5;
    // a footstep every stride (~0.7 m): about two a second walking, more when running
    this.strideLeft = (this.strideLeft ?? STRIDE / 2) - speed * dt;
    if (this.strideLeft <= 0) {
      this.strideLeft += STRIDE;
      if (speed > 0.4) this.onStep?.(speed / WALK_SPEED, this.crouched);
    }
    const bob = Math.sin(this.bobPhase) * 0.014 * Math.min(speed / WALK_SPEED, 1);
    this.camera.position.set(this.position.x, this.eyeHeight + bob, this.position.z);
  }

  _collides(x, z) {
    const b = this.bounds;
    if (x < b.minX + RADIUS || x > b.maxX - RADIUS || z < b.minZ + RADIUS || z > b.maxZ - RADIUS) return true;
    for (const c of this.colliders) {
      const dx = x - THREE.MathUtils.clamp(x, c.minX, c.maxX);
      const dz = z - THREE.MathUtils.clamp(z, c.minZ, c.maxZ);
      if (dx * dx + dz * dz < RADIUS * RADIUS) return true;
    }
    return false;
  }
}
