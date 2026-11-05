import { preset } from './Shift.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const OVERLAY_TEXT = {
  start: {
    eyebrow: `Night shift · ${preset().minutes} minutes`,
    title: 'Data Center Technician',
    lead: 'You’re on the night shift in Data Hall 2. Tickets come in from the NOC as the shift runs: open the queue with T, fix what you can before the SLA runs out.',
    button: 'Click to start',
  },
  paused: { eyebrow: 'Paused', title: 'Data Center Technician', lead: 'Take a breather. The servers will wait.', button: 'Click to resume' },
  resume: { eyebrow: 'Ticket closed', title: 'Nice work', lead: 'Ticket closed. Check the queue (T) for what’s next.', button: 'Click to resume' },
  console: { eyebrow: 'Console closed', title: 'Back to the hall', lead: 'Click to pick up where you left off.', button: 'Click to continue' },
};

export class HUD {
  constructor() {
    this.overlay = $('overlay');
    this.crosshair = $('crosshair');
    this.prompt = $('prompt');
    this.message = $('message');
    this.toasts = $('toasts');
    this.panel = $('ticket-panel');
    this.ticketCount = $('ticket-count');
    this.clock = $('clock');
    this.ticketsOpen = false;
    this.editingSummary = false;
    this.onSummarySubmit = null;
    this.onSummaryCancel = null;
    this._prompt = undefined;
    this._tickets = [];
    this._focusId = null;
    this._editingId = null;
    this._draft = '';
    this._msgTimer = 0;

    this.panel.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'submit') this._submit();
      if (action === 'cancel') this._cancel();
    });
    this.panel.addEventListener('keydown', (e) => {
      if (e.target.tagName !== 'TEXTAREA') return;
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) {
        // Enter moves to the next field; on the last one it submits
        e.preventDefault();
        const fields = [...this.panel.querySelectorAll('.closing textarea')];
        const i = fields.indexOf(e.target);
        if (i >= 0 && i < fields.length - 1) fields[i + 1].focus();
        else this._submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this._cancel();
      }
    });

    this.onNewShift = null;
    $('summary').addEventListener('click', (e) => {
      if (e.target.closest('[data-action="new-shift"]')) this.onNewShift?.();
    });
  }

  setLoading(loading) {
    $('loading').classList.toggle('hidden', !loading);
  }

  showOverlay(mode, override = {}) {
    const t = { ...OVERLAY_TEXT[mode], ...override };
    $('pause-menu').classList.toggle('hidden', mode === 'start');
    $('overlay-eyebrow').textContent = t.eyebrow;
    $('overlay-title').textContent = t.title;
    $('overlay-lead').textContent = t.lead;
    $('overlay-button').textContent = t.button;
    this.overlay.classList.remove('hidden');
  }

  /** Small "click to look around" pill, used after closing the console with Esc. */
  showResumeHint(show) {
    $('resume-hint').classList.toggle('visible', show);
  }

  get overlayVisible() {
    return !this.overlay.classList.contains('hidden');
  }

  hideOverlay() {
    this.overlay.classList.add('hidden');
  }

  setMuted(muted) {
    $('mute-chip').classList.toggle('hidden', !muted);
    $('mute-btn').textContent = muted ? 'Unmute' : 'Mute';
    this.toast(muted ? 'Sound muted (M to unmute)' : 'Sound on');
  }

  /** The part in the player's hand (or null), shown bottom right. */
  setHand(part) {
    const el = $('hand');
    el.classList.toggle('visible', !!part);
    if (part) {
      el.innerHTML = `<span class="hand-label">In hand</span><span class="swatch" style="background:#${part.color.toString(16).padStart(6, '0')}"></span><span><b>${esc(part.label)}</b><small>${esc(part.spec)}</small></span>`;
    }
  }

  flashHand() {
    const el = $('hand');
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('flash');
  }

  setTarget(prompt) {
    if (prompt === this._prompt) return;
    this._prompt = prompt;
    this.crosshair.classList.toggle('active', !!prompt);
    this.prompt.innerHTML = prompt ? `<kbd>E</kbd><span>${esc(prompt)}</span>` : '';
    this.prompt.classList.toggle('visible', !!prompt);
  }

  showMessage(title, body, kind = 'info', ms = 8000) {
    this.message.className = `message visible ${kind}`;
    this.message.innerHTML = `<div class="message-title">${esc(title)}</div><div class="message-body">${esc(body)}</div>`;
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => this.message.classList.remove('visible'), ms);
  }

  toast(text, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    setTimeout(() => el.classList.add('out'), 5000);
    setTimeout(() => el.remove(), 5600);
  }

  toggleTickets(force) {
    this.ticketsOpen = force ?? !this.ticketsOpen;
    this.panel.classList.toggle('hidden', !this.ticketsOpen);
    return this.ticketsOpen;
  }

  /** Open the closing form for a resolved ticket; `example` is the lab's write-up, shown for reference. */
  beginSummary(ticketId, example) {
    this.editingSummary = true;
    this._editingId = ticketId;
    this._example = example;
    this.toggleTickets(true);
    this._render();
    this.panel.querySelector('.closing textarea').focus();
  }

  endSummary() {
    this.editingSummary = false;
    this._editingId = null;
    this._render();
  }

  renderTickets(tickets, focusId, now = 0) {
    this._tickets = tickets;
    this._focusId = focusId;
    this._now = now;
    const open = tickets.filter((t) => !['CLOSED', 'QUEUED'].includes(t.status)).length;
    const waiting = tickets.some((t) => t.status === 'QUEUED');
    this.ticketCount.textContent = open ? `${open} open ticket${open > 1 ? 's' : ''}` : waiting ? 'Next ticket incoming' : 'Queue clear';
    this.ticketCount.classList.toggle('clear', !open);
    if (!this.editingSummary) this._render();
  }

  _render() {
    const order = { RESOLVED: 0, 'CALL BACK': 0, 'IN PROGRESS': 1, OPEN: 2, WAITING: 2, CLOSED: 3 };
    const prio = { P1: 0, P2: 1, P3: 2 };
    const arrived = this._tickets.filter((t) => t.status !== 'QUEUED');
    const queued = this._tickets.length - arrived.length;
    const sorted = arrived.sort((a, b) => (a.id === this._focusId ? -1 : b.id === this._focusId ? 1 : order[a.status] - order[b.status] || prio[a.priority] - prio[b.priority]));
    const cards = sorted.map((t) => {
      const statusClass = t.status.toLowerCase().replace(' ', '-');
      const head = `
          <header>
            <span class="ticket-id">${esc(t.id)}</span>
            ${this._sla(t)}
            <span class="chip prio ${t.priority.toLowerCase()}">${esc(t.priority)}</span>
            <span class="chip status">${esc(t.status)}</span>
          </header>`;
      if (t.id !== this._focusId && t.id !== this._editingId) {
        return `<article class="ticket compact ${statusClass}">${head}<p class="ticket-title">${esc(t.title)}</p><p class="ticket-loc">${esc(t.location)}</p></article>`;
      }
      let footer = '';
      if (t.status === 'RESOLVED' && this.editingSummary && t.id === this._editingId) {
        const field = (id, label, placeholder) => `
            <label class="summary-label" for="close-${id}">${label}</label>
            <textarea id="close-${id}" data-field="${id}" rows="2" placeholder="${esc(placeholder)}"></textarea>`;
        footer = `
          <div class="closing">
            ${field('cause', 'Root cause', 'What was actually wrong?')}
            ${field('action', 'Action taken', 'What did you do to fix it?')}
            ${field('verified', 'How it was verified', 'How do you know it works now?')}
          </div>
          <div class="close-error hint"></div>
          <div class="summary-actions">
            <button data-action="submit" class="primary">Close ticket</button>
            <button data-action="cancel">Cancel</button>
          </div>
          <div class="hint">Enter for the next field (submits on the last) · Shift+Enter for a new line · Esc to cancel</div>
          <details class="example"><summary>Example write-up from the lab</summary>${esc(this._example || '')}</details>`;
      } else if (t.status === 'RESOLVED') {
        footer = `<div class="callout">Fixed and verified. Press <kbd>C</kbd> to write a summary and close.</div>`;
      } else if (t.status === 'CLOSED') {
        const r = t.resolution || {};
        footer = `<div class="resolution">
            <div class="summary-label">Root cause</div>${esc(r.cause || '')}
            <div class="summary-label">Action taken</div>${esc(r.action || '')}
            <div class="summary-label">Verified</div>${esc(r.verified || '')}
          </div>`;
      }
      return `
        <article class="ticket ${statusClass}">${head}
          <p class="ticket-title">${esc(t.title)}</p>
          <p class="ticket-text"><strong>${esc(t.id)}:</strong> ${esc(t.text)}</p>
          <dl>
            <dt>Location</dt><dd>${esc(t.location)}</dd>
            <dt>Reported by</dt><dd>${esc(t.reporter)}</dd>
          </dl>
          ${this._guide(t)}
          <ol class="log">${t.log.map((l) => `<li><time>${esc(l.time)}</time>${esc(l.text)}</li>`).join('')}</ol>
          ${footer}
        </article>`;
    });
    const allClosed = arrived.every((t) => t.status === 'CLOSED');
    const note = queued
      ? `<p class="queue-note">${allClosed ? 'Next ticket incoming…' : 'More tickets arrive as you close this one.'}</p>`
      : allClosed
        ? '<p class="queue-note">Queue clear. Every ticket is closed.</p>'
        : '';
    this.panel.innerHTML = `<div class="panel-head"><h2>Ticket queue</h2><span class="hint"><kbd>T</kbd> to hide</span></div>${cards.join('')}${note}`;
  }

  /** SLA countdown while a ticket is being worked on; a red chip once it's breached. */
  _sla(t) {
    if (t.breached && t.status !== 'CLOSED') return '<span class="chip sla breached">SLA breached</span>';
    if (t.breached) return '<span class="chip sla breached">SLA missed</span>';
    if (!['OPEN', 'IN PROGRESS', 'WAITING', 'CALL BACK'].includes(t.status) || !Number.isFinite(t.slaDue)) return '';
    const left = Math.max(0, t.slaDue - this._now);
    const m = Math.floor(left / 60);
    const s = String(Math.floor(left % 60)).padStart(2, '0');
    return `<span class="chip sla ${left < 120 ? 'soon' : ''}">SLA ${m}:${s}</span>`;
  }

  /** Shift clock in the top bar. */
  setShiftTime(remaining) {
    const m = Math.floor(remaining / 60);
    const s = String(Math.floor(remaining % 60)).padStart(2, '0');
    this.clock.textContent = `Shift ${m}:${s} left`;
    this.clock.classList.toggle('late', remaining < 180);
  }

  /** End-of-shift report. `report` comes from Shift.report(); `fmt` formats seconds. */
  showShiftSummary(report, fmt) {
    const rows = report.rows
      .map((r) => {
        const sla = !r.released ? '<td class="muted">not reached</td>' : r.breached ? '<td class="bad">breached</td>' : r.slaMet ? '<td class="good">met</td>' : '<td class="muted">open</td>';
        const sat = r.satisfaction === null ? '' : `<span class="${r.satisfaction >= 70 ? 'good' : r.satisfaction >= 40 ? '' : 'bad'}">${r.satisfaction}%</span>`;
        return `<tr class="${r.released ? '' : 'muted'}"><td>${esc(r.id)}</td><td>${esc(r.title)}</td><td>${esc(r.priority)}</td><td>${esc(r.released ? r.status : 'QUEUED')}</td><td>${fmt(r.timeToFix)}</td>${sla}<td>${r.mistakes || ''}</td><td>${sat}</td></tr>`;
      })
      .join('');
    const headline = report.reason === 'done' ? 'Queue cleared' : report.reason === 'home' ? 'Clocked out' : 'Shift over';
    const why = { time: 'Time is up', done: 'Every ticket closed', manual: 'Ended early' }[report.reason];
    $('summary').innerHTML = `
      <div class="summary-card">
        <div class="eyebrow">${why} · ${fmt(report.duration)} on shift</div>
        <h1>${headline}</h1>
        <div class="stats">
          <div><b>${report.solved}</b><span>solved of ${report.released} released</span></div>
          <div><b>${fmt(report.avgTime)}</b><span>average time to fix</span></div>
          <div class="${report.breaches ? 'bad' : ''}"><b>${report.breaches}</b><span>SLA breaches</span></div>
          <div class="${report.mistakes ? 'bad' : ''}"><b>${report.mistakes}</b><span>mistakes</span></div>
          <div class="${report.satisfaction !== null && report.satisfaction < 60 ? 'bad' : ''}"><b>${report.satisfaction === null ? '—' : `${report.satisfaction}%`}</b><span>customer satisfaction${report.customers ? ` (${report.customers} caller${report.customers > 1 ? 's' : ''})` : ''}</span></div>
        </div>
        <table>
          <thead><tr><th>Ticket</th><th>Title</th><th>Prio</th><th>Status</th><th>Time to fix</th><th>SLA</th><th>Mistakes</th><th>Customer</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button class="primary" data-action="new-shift">Start a new shift</button>
      </div>`;
    $('summary').classList.remove('hidden');
  }

  /** Physical-only tickets have no console guide, so show the current step here; customer tickets show what's next. */
  _guide(t) {
    if (t.kind === 'customer') return t.guide && t.status !== 'CLOSED' ? `<div class="guide"><span>Next</span><p>${esc(t.guide)}</p></div>` : '';
    const step = t.kind === 'physical' && !['RESOLVED', 'CLOSED'].includes(t.status) && t.session.step;
    if (!step) return '';
    const n = t.session.stepIdx + 1;
    // step bodies are static, trusted HTML from src/cases
    return `<div class="guide"><span>Step ${n}/${t.scenario.steps.length} · ${esc(step.title)}</span>${step.body}</div>`;
  }

  /** All three fields need a real answer before the ticket can close. */
  _submit() {
    const fields = [...this.panel.querySelectorAll('.closing textarea')];
    if (!fields.length) return;
    const missing = fields.filter((f) => f.value.trim().length < 2);
    fields.forEach((f) => f.classList.toggle('invalid', missing.includes(f)));
    if (missing.length) {
      const err = this.panel.querySelector('.close-error');
      err.textContent = `Fill in ${missing.length === 1 ? 'this field' : 'all three fields'} before closing: root cause, action taken and how you verified it.`;
      err.classList.remove('shake');
      void err.offsetWidth;
      err.classList.add('shake');
      missing[0].focus();
      return;
    }
    this.onSummarySubmit?.(Object.fromEntries(fields.map((f) => [f.dataset.field, f.value.trim()])));
  }

  _cancel() {
    this.onSummaryCancel?.();
  }
}
