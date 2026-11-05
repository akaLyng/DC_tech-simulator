const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * The phone conversation overlay. It only renders a view model from the Desk:
 *   { title, subtitle, satisfaction, lines: [{ who: 'them'|'you'|'note', text }], options: [{ label }] }
 * and reports picks with onChoose(index). Number keys 1-6 pick an option; Esc ends the call.
 */
export class CallUI {
  constructor() {
    this.onChoose = null;
    this.onClose = null;
    this.open_ = false;
    this.root = document.createElement('div');
    this.root.id = 'call';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="call-card" role="dialog" aria-label="Phone call">
        <header>
          <div class="call-icon" aria-hidden="true">☎</div>
          <div class="call-who"><b class="call-title"></b><span class="call-sub"></span></div>
          <div class="call-mood" title="Customer satisfaction"></div>
          <button type="button" data-act="hangup" title="End the call (Esc)">End call <kbd>Esc</kbd></button>
        </header>
        <div class="call-lines" aria-live="polite"></div>
        <div class="call-options"></div>
      </div>`;
    document.body.appendChild(this.root);
    this.linesEl = this.root.querySelector('.call-lines');
    this.optionsEl = this.root.querySelector('.call-options');

    this.root.addEventListener('click', (e) => {
      const opt = e.target.closest('[data-opt]');
      if (opt) this.onChoose?.(+opt.dataset.opt);
      if (e.target.closest('[data-act="hangup"]')) this.close('button');
    });
    document.addEventListener('keydown', (e) => {
      if (!this.open_) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close('esc');
      } else if (/^[1-6]$/.test(e.key)) {
        const i = +e.key - 1;
        if (i < this.optionsEl.children.length) this.onChoose?.(i);
      }
    });
  }

  get isOpen() {
    return this.open_;
  }

  open(view) {
    this.open_ = true;
    this.root.classList.remove('hidden');
    this.render(view);
  }

  render(view) {
    this.root.querySelector('.call-title').textContent = view.title;
    this.root.querySelector('.call-sub').textContent = view.subtitle;
    const mood = this.root.querySelector('.call-mood');
    mood.textContent = view.satisfaction === undefined ? '' : `${Math.round(view.satisfaction)}%`;
    mood.className = `call-mood ${view.satisfaction >= 70 ? 'good' : view.satisfaction >= 40 ? 'meh' : 'bad'}`;
    this.linesEl.innerHTML = view.lines.map((l) => `<p class="line ${l.who}">${l.who === 'you' ? '<b>You:</b> ' : ''}${esc(l.text)}</p>`).join('');
    this.linesEl.scrollTop = this.linesEl.scrollHeight;
    this.optionsEl.innerHTML = view.options
      .map((o, i) => `<button type="button" data-opt="${i}" class="${o.kind || ''}"><kbd>${i + 1}</kbd><span>${esc(o.label)}</span></button>`)
      .join('');
  }

  close(reason) {
    if (!this.open_) return;
    this.open_ = false;
    this.root.classList.add('hidden');
    this.onClose?.(reason);
  }
}
