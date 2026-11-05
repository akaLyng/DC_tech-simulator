import * as THREE from 'three';

const CENTER = new THREE.Vector2(0, 0);

/**
 * Raycasts from the centre of the screen each frame. Interactables register a
 * hitbox mesh plus callbacks; occluders (rack bodies etc.) block the ray so you
 * can't inspect a rack's front from behind it.
 */
export class InteractionManager {
  constructor(camera, hud, { maxDistance = 2.5, occluders = [] } = {}) {
    this.camera = camera;
    this.hud = hud;
    this.occluders = occluders;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = maxDistance;
    this.items = new Map(); // hitbox mesh -> item
    this.current = null;
  }

  /** @param {{mesh: THREE.Object3D, highlight?: THREE.Object3D, getPrompt: () => string|null, onInteract: () => void}} item */
  add(item) {
    this.items.set(item.mesh, item);
  }

  update(enabled) {
    let next = null;
    if (enabled) {
      this.raycaster.setFromCamera(CENTER, this.camera);
      // nearest hit with something to say wins; an occluder (rack body) stops the search
      for (const hit of this.raycaster.intersectObjects([...this.items.keys(), ...this.occluders], false)) {
        const item = this.items.get(hit.object);
        if (!item) break;
        if (item.getPrompt()) {
          next = item;
          break;
        }
      }
    }
    if (next !== this.current) {
      if (this.current?.highlight) this.current.highlight.visible = false;
      if (next?.highlight) next.highlight.visible = true;
      this.current = next;
    }
    this.hud.setTarget(this.current ? this.current.getPrompt() : null);
  }

  interact() {
    this.current?.onInteract();
  }
}
