const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const HINT_KEY = 'dc-sim-console-hint';

/**
 * SSH-style console overlay. It only renders a ScenarioSession and forwards
 * typed lines to it; the session is a pure simulation and nothing typed is ever run.
 *
 * Callbacks: onResult(session, result) after every command, onClose(reason)
 * when closed with Esc / exit.
 */
export class TerminalUI {
  constructor() {
    this.session = null;
    this.onResult = null;
    this.onClose = null;
    this._hpos = -1;
    this.showHint = true;
    try {
      this.showHint = localStorage.getItem(HINT_KEY) !== '0';
    } catch {}

    this.root = document.createElement('div');
    this.root.id = 'terminal';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="term-window" role="dialog" aria-label="Server console">
        <div class="term-bar">
          <span class="dots"><i></i><i></i><i></i></span>
          <span class="term-title"></span>
          <button type="button" data-act="hint" title="Toggle guide (Alt+H)">Guide <kbd>Alt</kbd><kbd>H</kbd></button>
          <span class="close-hint"><code>exit</code> or <kbd>Ctrl</kbd><kbd>D</kbd> closes</span>
          <button type="button" data-act="close" title="Close console (Esc also works, but releases the mouse)">Close <kbd>Esc</kbd></button>
        </div>
        <div class="term-main">
          <div class="term-col">
            <div class="term-screen" aria-live="polite"></div>
            <form class="term-input" autocomplete="off">
              <span class="term-prompt"></span>
              <input type="text" spellcheck="false" autocapitalize="off" aria-label="Command" />
            </form>
          </div>
          <aside class="term-hint"></aside>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.screen = this.root.querySelector('.term-screen');
    this.input = this.root.querySelector('input');
    this.promptEl = this.root.querySelector('.term-prompt');
    this.titleEl = this.root.querySelector('.term-title');
    this.hintEl = this.root.querySelector('.term-hint');

    this.root.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      this._submit();
    });
    this.input.addEventListener('keydown', (e) => this._onKey(e));
    this.root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'hint') this.toggleHint();
      if (act === 'close') this.close('button');
      const cmd = e.target.closest('[data-cmd]')?.dataset.cmd;
      if (cmd !== undefined) {
        this.input.value = cmd;
        this.input.focus();
      } else if (e.target.closest('.term-screen') && !window.getSelection().toString()) {
        this.input.focus();
      }
    });
    // Esc / Alt+H also work when focus has wandered off the input (e.g. after clicking the guide).
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen || e.target === this.input) return;
      if (e.key === 'Escape') this.close('esc');
      else if (e.altKey && e.code === 'KeyH') this.toggleHint();
    });
  }

  get isOpen() {
    return this.session !== null;
  }

  open(session) {
    this.session = session;
    this._hpos = -1;
    const p = session.prompt;
    this.titleEl.textContent = session.scenario.title || `ssh ${p.user}@${p.host}`;
    this.promptEl.innerHTML = this._promptHTML();
    this.root.classList.toggle('ps', p.shell === 'powershell');
    this.root.classList.remove('hidden');
    // tutorial sessions open with the guide showing, whatever the saved preference
    if (session.scenario.tutorialGuide || session.forceHint) this.showHint = true;
    this.root.classList.toggle('no-hint', !this.showHint);
    this.render();
    this.input.value = '';
    this.input.focus();
  }

  close(reason) {
    if (!this.isOpen) return;
    this.session = null;
    this.input.blur();
    this.root.classList.add('hidden');
    this.onClose?.(reason);
  }

  toggleHint() {
    this.showHint = !this.showHint;
    try {
      localStorage.setItem(HINT_KEY, this.showHint ? '1' : '0');
    } catch {}
    this.root.classList.toggle('no-hint', !this.showHint);
  }

  render() {
    const s = this.session;
    this.screen.innerHTML = s.lines
      .map((l) => (l.prompt ? `<pre>${this._promptHTML()} ${esc(l.t)}</pre>` : `<pre class="${l.c}">${esc(l.t)}</pre>`))
      .join('');
    this.screen.scrollTop = this.screen.scrollHeight;
    this._renderHint();
  }

  _renderHint() {
    const s = this.session;
    const sc = s.scenario;
    // tool sessions (the helpdesk laptop) bring their own sidebar when they have no steps to
    // guide; its HTML is built from escaped data
    if (sc.guide && (!sc.steps.length || s.solved)) {
      this.hintEl.innerHTML = sc.guide(s);
      return;
    }
    const step = s.step;
    const total = sc.steps.length;
    let html = `<div class="hint-head"><span>${esc(sc.id)} · ${esc(sc.host)}</span><span>${Math.min(s.stepIdx + 1, total)}/${total}</span></div>`;
    if (step) {
      const chips = step.try
        .map((t) => {
          const k = s.physicalKeyFor(t);
          return k
            ? `<span class="chip physical" title="Physical job: done at the rack">${esc(s.physicalLabel(k))}</span>`
            : `<button type="button" class="chip" data-cmd="${esc(t)}">${esc(t)}${s.commandKind(t) === 'real' ? '' : ' <span class="game-tag" title="Made up or simplified for the game">[game]</span>'}</button>`;
        })
        .join('');
      // step bodies are static, trusted HTML from src/scenarios
      html += `<h4>${esc(step.title)}</h4><div class="hint-body">${step.body}</div><div class="chips">${chips}</div>`;
    } else {
      html += `<h4>Solved</h4><div class="hint-body"><p>Every check passes. Close the console, press <kbd>T</kbd> and then <kbd>C</kbd> to write a summary and close the ticket.</p></div>`;
    }
    if (s.lastLearned) html += `<div class="learned"><span>What the last step showed you</span>${s.lastLearned.learned}</div>`;
    this.hintEl.innerHTML = html;
  }

  _promptHTML() {
    const p = this.session.prompt;
    if (p.shell === 'powershell') return `<span class="p-ps">PS ${esc(p.cwd)}&gt;</span>`;
    return `<span class="p-user">${esc(p.user)}@${esc(p.host)}</span>:<span class="p-path">${esc(p.cwd)}</span>$`;
  }

  /** Tab completion, PowerShell style: each Tab cycles to the next match. */
  _complete() {
    const complete = this.session.scenario.complete;
    if (!complete) return;
    if (!this._tab) {
      const matches = complete(this.input.value);
      if (!matches.length) return;
      this._tab = { matches, i: -1 };
    }
    this._tab.i = (this._tab.i + 1) % this._tab.matches.length;
    this.input.value = this._tab.matches[this._tab.i];
  }

  _submit() {
    const raw = this.input.value;
    this.input.value = '';
    this._hpos = -1;
    const session = this.session;
    const res = session.run(raw);
    this.render();
    this.onResult?.(session, res);
    if (res.exit) this.close('exit');
  }

  _onKey(e) {
    e.stopPropagation(); // keep game hotkeys (E, T, C, WASD) out of the console
    const h = this.session.hist;
    if (e.key === 'Tab') {
      e.preventDefault();
      return this._complete();
    }
    this._tab = null;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close('esc');
    } else if (e.altKey && e.code === 'KeyH') {
      e.preventDefault();
      this.toggleHint();
    } else if (e.key === 'ArrowUp' && h.length) {
      e.preventDefault();
      this._hpos = this._hpos < 0 ? h.length - 1 : Math.max(0, this._hpos - 1);
      this.input.value = h[this._hpos];
    } else if (e.key === 'ArrowDown' && h.length) {
      e.preventDefault();
      if (this._hpos < 0) return;
      this._hpos++;
      if (this._hpos >= h.length) {
        this._hpos = -1;
        this.input.value = '';
      } else this.input.value = h[this._hpos];
    } else if (e.key === 'd' && e.ctrlKey && !this.input.value) {
      // Ctrl+D on an empty line logs out, like bash; unlike Esc it keeps the mouse captured
      e.preventDefault();
      this.session.lines.push({ prompt: true, t: '' }, { t: 'logout', c: 'o-dim' });
      this.close('exit');
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      this.session.lines = [];
      this.render();
    }
  }
}
