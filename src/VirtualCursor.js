/**
 * A software mouse cursor for dialogs. The real mouse stays captured (pointer lock), so
 * closing a console or a call never needs a click to look around again. While a dialog is
 * open, mouse movement moves this cursor instead of the camera, and clicks and the wheel
 * are forwarded to whatever is under it.
 */
export class VirtualCursor {
  constructor(isLocked) {
    this.isLocked = isLocked;
    this.active = false;
    this.x = innerWidth / 2;
    this.y = innerHeight / 2;
    this.el = document.createElement('div');
    this.el.id = 'vcursor';
    this.el.className = 'hidden';
    document.body.appendChild(this.el);
    this._hover = null;

    document.addEventListener('mousemove', (e) => {
      if (!this._on()) return;
      this.x = Math.min(innerWidth - 2, Math.max(0, this.x + e.movementX));
      this.y = Math.min(innerHeight - 2, Math.max(0, this.y + e.movementY));
      this._place();
    });
    document.addEventListener('mousedown', (e) => {
      if (!this._on() || e.button !== 0 || this._forwarding) return; // ignore the events we forward ourselves
      e.preventDefault();
      this._click();
    });
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this._on()) return;
        for (let el = this._under(); el; el = el.parentElement) {
          if (el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
            el.scrollTop += e.deltaY;
            break;
          }
        }
      },
      { passive: true },
    );
  }

  _on() {
    return this.active && this.isLocked();
  }

  show(on) {
    this.active = on;
    if (on) {
      this.x = innerWidth / 2;
      this.y = innerHeight / 2;
    } else this._setHover(null);
    this.update();
  }

  /** Call when the lock changes: the cursor only shows while the mouse is captured. */
  update() {
    this.el.classList.toggle('hidden', !this._on());
    if (this._on()) this._place();
  }

  _place() {
    this.el.style.transform = `translate(${this.x}px, ${this.y}px)`;
    const target = this._under()?.closest('button, [data-cmd], [data-act], [data-opt], input, textarea, a, label');
    this._setHover(target ?? null);
  }

  _setHover(el) {
    if (el === this._hover) return;
    this._hover?.classList.remove('vhover');
    this._hover = el;
    el?.classList.add('vhover');
    this.el.classList.toggle('pointer', !!el && !el.matches('input, textarea'));
  }

  _under() {
    return document.elementFromPoint(this.x, this.y);
  }

  _click() {
    const el = this._under();
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, clientX: this.x, clientY: this.y, view: window };
    this._forwarding = true;
    try {
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      const field = el.closest('input, textarea, select');
      if (field) field.focus();
      const clickable = el.closest('button, label, a, input[type=checkbox], input[type=radio]');
      if (clickable) clickable.click();
      else el.dispatchEvent(new MouseEvent('click', opts));
    } finally {
      this._forwarding = false;
    }
  }
}
