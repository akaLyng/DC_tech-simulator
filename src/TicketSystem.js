import { ScenarioSession } from './ScenarioEngine.js';
import { PARTS } from './parts.js';

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const OPEN_STATES = ['OPEN', 'IN PROGRESS'];

/** Every named host the scene must place, derived from the shift's scenarios. */
export function hostConfigs(scenarios) {
  return scenarios.map((s) => ({ id: s.host, ...s.location, ...(s.fixtures || {}) }));
}

function locationText(s) {
  const L = s.location;
  if (L.office) return `Helpdesk · ${s.customer.company} (${s.customer.id})`;
  const base = `Data Hall 2 · Row ${L.rack[0]} · Rack ${L.rack.slice(1)}`;
  return L.tor ? `${base} · ${s.host} (top-of-rack switch, U42)` : `${base} · ${s.host} (U${L.u})`;
}

/**
 * The ticket queue. Generic over where a ticket comes from (NOC alerts now, helpdesk
 * calls later) and how it is fixed (console scenario, physical case, or both): a ticket
 * wraps a scenario and its ScenarioSession, and moves through
 * QUEUED → OPEN → IN PROGRESS → RESOLVED → CLOSED while rack/host LEDs and the
 * physical world follow the scenario's state.
 *
 * It also owns the player's hand (one spare part at a time) and the parts shelf.
 * Timing (when tickets are released, SLA deadlines) belongs to whoever drives it:
 * set `clock` and `slaFor` (see Shift.js).
 */
export class TicketSystem {
  constructor(hud, dc) {
    this.hud = hud;
    this.dc = dc;
    this.tickets = [];
    this.focusId = null;
    this.hand = null; // part id from PARTS, or null
    this.onDispatch = null; // (ticket) => void
    this.onEvent = null; // (name, detail) => void, for sound effects
    this.clock = () => performance.now() / 1000; // seconds
    this.slaFor = () => Infinity; // priority -> seconds to resolve
  }

  /**
   * Queue a ticket for a scenario. `source`/`reporter` let other systems (e.g. a
   * helpdesk) raise tickets that point at faults in this room.
   */
  add(scenario, { reporter = 'NOC (automated)', source = 'noc' } = {}) {
    const t = {
      id: scenario.id,
      scenario,
      session: new ScenarioSession(scenario),
      kind: scenario.customer ? 'customer' : scenario.exec ? 'console' : 'physical',
      held: !!scenario.held, // only opened when something escalates it (e.g. a customer call)
      source,
      priority: scenario.priority,
      status: 'QUEUED',
      title: scenario.name,
      text: scenario.brief,
      location: locationText(scenario),
      reporter,
      hostId: scenario.host,
      rack: scenario.location.rack ?? null,
      escalated: false,
      guide: null, // short "what next" line for customer tickets
      log: [],
      resolution: null, // { cause, action, verified } from the closing form
      mistakes: 0,
      openedAt: null,
      slaDue: null,
      resolvedAt: null,
      closedAt: null,
      breached: false,
    };
    this.tickets.push(t);
    if (scenario.world) this.dc.applyWorld(t.hostId, scenario.world(t.session.st), false);
    this._syncLeds(t);
    this.render();
    return t;
  }

  byHost(hostId) {
    return this.tickets.find((t) => t.hostId === hostId);
  }

  byRack(rackId) {
    return this.tickets.find((t) => t.rack === rackId && t.status !== 'QUEUED');
  }

  get hasQueued() {
    return this.tickets.some((t) => t.status === 'QUEUED' && !t.held);
  }

  byId(id) {
    return this.tickets.find((t) => t.id === id);
  }

  /** Next free ticket number, for tickets raised during the shift (customer calls). */
  nextId() {
    const max = Math.max(0, ...this.tickets.map((t) => +t.id.replace(/\D/g, '') || 0));
    return `INC-${max + 1}`;
  }

  get openTickets() {
    return this.tickets.filter((t) => !['QUEUED', 'CLOSED'].includes(t.status));
  }

  /** Open the next queued ticket (held ones wait to be escalated) and announce it. */
  dispatchNext() {
    const t = this.tickets.find((x) => x.status === 'QUEUED' && !x.held);
    return t ? this.dispatch(t) : null;
  }

  /** Open a specific queued ticket now. */
  dispatch(t) {
    if (t.status !== 'QUEUED') return t;
    t.status = 'OPEN';
    t.openedAt = this.clock();
    t.slaDue = t.openedAt + this.slaFor(t.priority);
    this._log(t, `Ticket opened by ${t.source === 'noc' ? 'NOC' : t.reporter}: ${t.scenario.topic}.`);
    this._syncLeds(t);
    this.focusId = t.id;
    this.render();
    const where = t.rack ? `rack ${t.rack}` : t.kind === 'customer' ? 'helpdesk phone' : 'the data hall';
    this.hud.toast(`New ticket ${t.id} (${t.priority}): ${t.title} — ${where}. Press T for details.`, 'new');
    this.onDispatch?.(t);
    return t;
  }

  /**
   * What the monitoring dashboard and queue monitor show: a rack (or its TOR switch) is
   * amber while it has an unresolved ticket, red once that ticket has been escalated.
   */
  statusSnapshot() {
    const racks = {};
    const switches = {};
    for (const t of this.tickets) {
      if (!t.rack || !['OPEN', 'IN PROGRESS'].includes(t.status)) continue;
      const map = t.scenario.location.tor ? switches : racks;
      if (map[t.rack] !== 'red') map[t.rack] = t.escalated ? 'red' : 'amber';
    }
    const now = this.clock();
    const queue = this.openTickets
      .filter((t) => t.status !== 'RESOLVED')
      .map((t) => ({ id: t.id, priority: t.priority, title: t.title, status: t.status, breached: t.breached, slaLeft: Number.isFinite(t.slaDue) ? Math.max(0, t.slaDue - now) : null }))
      .sort((a, b) => a.priority.localeCompare(b.priority) || (a.slaLeft ?? 1e9) - (b.slaLeft ?? 1e9));
    return { racks, switches, core: Object.keys(switches).length ? 'amber' : 'ok', queue, calls: this.callsWaiting?.() ?? 0 };
  }

  /** The ticket C would close: the focused one if resolved, else the first resolved one. */
  closable() {
    const focused = this.tickets.find((t) => t.id === this.focusId);
    if (focused?.status === 'RESOLVED') return focused;
    return this.tickets.find((t) => t.status === 'RESOLVED') || null;
  }

  /** Plain-language "what's still missing" for a ticket that isn't resolved yet. */
  whatsLeft(t) {
    if (t.status === 'CLOSED') return `${t.id} is already closed.`;
    if (t.kind === 'customer') return `${t.id} isn't resolved yet: ${t.guide || `the customer has to confirm the fix on the phone.`}`;
    const step = t.session.step;
    if (!step) return `${t.id} isn't resolved yet.`;
    const where = t.kind === 'console' ? ` Open ${t.hostId}'s console and follow the guide on the right (Alt+H shows it).` : '';
    return `${t.id} isn't resolved yet. Next step (${t.session.stepIdx + 1}/${t.scenario.steps.length}): ${step.title}.${where}`;
  }

  suggestedSummary(t) {
    return t.scenario.story;
  }

  focus(t) {
    if (!t || this.focusId === t.id) return;
    this.focusId = t.id;
    this.render();
  }

  // ---- hand & shelf ---------------------------------------------------------------

  get heldPart() {
    return this.hand ? { id: this.hand, ...PARTS[this.hand] } : null;
  }

  setHand(partId) {
    this.hand = partId;
    this.hud.setHand(this.heldPart);
  }

  /** What a physical action sees: the held part, plus ways to use it or record a mistake. */
  _handFor(t) {
    return {
      part: this.heldPart,
      use: () => this.setHand(null),
      mistake: (reason) => {
        t.mistakes++;
        this._log(t, `✗ ${reason}`);
        this.hud.flashHand();
        this.onEvent?.('mistake');
      },
    };
  }

  _shelf(partId) {
    const label = PARTS[partId].label;
    if (this.hand === partId) {
      this.setHand(null);
      this.hud.toast(`Put back: ${label}.`);
    } else {
      const prev = this.hand && PARTS[this.hand].label;
      this.setHand(partId);
      this.hud.toast(prev ? `Swapped ${prev} for ${label}.` : `Took ${label}. Only one part at a time.`);
    }
    this.onEvent?.('pickup');
  }

  // ---- world interaction ------------------------------------------------------------

  _active(t) {
    return t && t.status !== 'QUEUED' ? t : null;
  }

  _prompt(p, st) {
    return typeof p.prompt === 'function' ? p.prompt(st, this.heldPart) : p.prompt;
  }

  promptFor(target) {
    switch (target.kind) {
      case 'shelf': {
        const label = PARTS[target.partId].label;
        if (this.hand === target.partId) return `Put back ${label}`;
        return this.hand ? `Swap for ${label}` : `Take ${label}`;
      }
      case 'core':
        return 'Inspect CORE-01';
      case 'rack':
        return `Inspect ${target.id}`;
      case 'host': {
        const t = this._active(this.byHost(target.id));
        if (!t) return null;
        if (t.kind === 'console') {
          return `${target.id.endsWith('-idrac') ? 'Open iDRAC console' : 'Open console'} · ${target.id.replace(/-idrac$/, '')}`;
        }
        const inspect = t.scenario.physical?.inspect;
        return inspect && t.status !== 'CLOSED' ? this._prompt(inspect, t.session.st) : null;
      }
      case 'fixture': {
        const t = this._active(this.byHost(target.host.id));
        const p = t?.scenario.physical?.[target.key];
        if (!p || t.status === 'CLOSED') return null;
        const text = this._prompt(p, t.session.st);
        return text ? `${text} · ${t.hostId}` : null;
      }
      default:
        return null;
    }
  }

  /** E on a target. Returns { console: ticket } when the caller should open a console. */
  interact(target) {
    switch (target.kind) {
      case 'shelf':
        return this._shelf(target.partId);
      case 'core':
        return this.hud.showMessage('CORE-01 · Core switch', this._coreStatus());
      case 'rack':
        return this._inspectRack(target);
      case 'host': {
        const t = this._active(this.byHost(target.id));
        if (!t) return;
        if (t.kind === 'console') return { console: t };
        if (t.scenario.physical?.inspect && t.status !== 'CLOSED') return this.physical(target.id, 'inspect');
        return;
      }
      case 'fixture':
        return this.physical(target.host.id, target.key);
    }
  }

  _coreStatus() {
    const down = this.openTickets.filter((t) => t.scenario.location.tor);
    if (!down.length) return 'All line cards healthy. Every rack uplink is up.';
    return `All line cards healthy. Alarm: uplink from ${down.map((t) => t.hostId).join(', ')} is down — check the fiber and SFP at the rack end.`;
  }

  _inspectRack(rack) {
    const t = this.byRack(rack.id);
    if (t && OPEN_STATES.includes(t.status)) {
      this.focus(t);
      const how = t.kind === 'console' ? 'Look at the server and press E to open its console.' : t.scenario.rackHint || '';
      return this.hud.showMessage(`Rack ${rack.id}`, `Amber status light: ${t.id} — ${t.title}. ${how}`, 'warn');
    }
    if (t) return this.hud.showMessage(`Rack ${rack.id}`, `Status light green. ${t.hostId} is healthy again.`, 'success');
    this.hud.showMessage(`Rack ${rack.id}`, `${rack.servers} servers, ${rack.blanks} U blanked. Status LEDs blue, link LEDs green. Nothing to do here.`);
  }

  /** A scenario's physical action, done for real in the world. */
  physical(hostId, key) {
    const t = this._active(this.byHost(hostId));
    if (!t || t.status === 'CLOSED') return;
    this.focus(t);
    const res = t.session.doPhysical(key, this._handFor(t));
    const text = res.output.map((o) => o.t).join('\n').replace(/^\[lab\] /gm, '');
    const where = t.rack ? `rack ${t.rack}` : 'data hall';
    const bad = res.output.some((o) => o.c === 'o-err' || o.c === 'o-warn');
    this.hud.showMessage(`${t.hostId} · ${where}`, text, res.solvedNow ? 'success' : bad ? 'warn' : 'info', 12000);
    if (res.changed) {
      this.onEvent?.('physical', key);
      this.dc.applyWorld(t.hostId, t.scenario.world(t.session.st), true, () => {
        this.onEvent?.('physical-done', key);
        if (!res.solvedNow && t.kind === 'console') this.hud.toast(`Done. Reopen the console on ${t.hostId} to continue ${t.id}.`, 'success');
      });
    }
    this.consoleResult(t, res, { syncWorld: false });
  }

  /** Move a ticket to a status (e.g. WAITING, CALL BACK) with a log line. */
  setStatus(t, status, logText) {
    t.status = status;
    if (logText) this._log(t, logText);
    this._syncLeds(t);
    this.render();
  }

  /** Mark a ticket resolved from outside a scenario session (e.g. the customer confirmed). */
  resolve(t, logText) {
    t.status = 'RESOLVED';
    t.resolvedAt = this.clock();
    this._log(t, logText);
    this.hud.toast(`${t.id} resolved — press T, then C to write it up and close it.`, 'success');
    this.onEvent?.('resolved', t);
    this.render();
  }

  /** Raise a ticket's priority because of customer impact (or an ignored alarm); shows red on the dashboard. */
  escalate(t, logText) {
    t.escalated = true;
    t.priority = 'P1';
    t.slaDue = Math.min(t.slaDue ?? Infinity, this.clock() + this.slaFor('P1'));
    this._log(t, logText);
    this._syncLeds(t);
    this.render();
  }

  /** React to a console command (or physical action) on a ticket's session. */
  consoleResult(t, res, { syncWorld = true } = {}) {
    this.focus(t);
    const s = t.session;
    if (res.reset && t.status !== 'CLOSED') {
      t.status = 'OPEN';
      t.resolvedAt = null;
      this._log(t, 'Console session reset; starting over.');
    }
    for (const reason of res.mistakes || []) {
      t.mistakes++;
      this._log(t, `✗ ${reason}`);
    }
    for (const step of res.completed) this._log(t, `✓ ${step.title}`);
    if (t.status === 'OPEN' && s.stepIdx > 0) t.status = 'IN PROGRESS';
    if (res.solvedNow) {
      t.status = 'RESOLVED';
      t.resolvedAt = this.clock();
      this._log(t, 'All checks pass. Ready to close.');
      this.hud.toast(`${t.id} resolved — press T, then C to write a summary and close it.`, 'success');
      this.onEvent?.('resolved', t);
    }
    if (syncWorld && t.scenario.world) this.dc.applyWorld(t.hostId, t.scenario.world(s.st), true);
    this._syncLeds(t);
    this.render();
  }

  /** Close the resolved ticket with the player's write-up: { cause, action, verified }. */
  close(resolution) {
    const t = this.closable();
    if (!t) return null;
    t.resolution = resolution;
    t.status = 'CLOSED';
    t.closedAt = this.clock();
    t.session.locked = true;
    this._log(t, 'Ticket closed by on-site technician.');
    this.render();
    const next = this.hasQueued && !this.openTickets.length ? ' Next ticket incoming…' : '';
    this.hud.toast(`${t.id} closed.${next}`, 'success');
    return t;
  }

  // ---- helpers --------------------------------------------------------------------

  _syncLeds(t) {
    const open = OPEN_STATES.includes(t.status);
    const state = t.status === 'QUEUED' ? 'normal' : open ? (t.escalated ? 'red' : 'alert') : 'ok';
    if (t.rack) this.dc.setRackState(t.rack, state);
    this.dc.setHostState(t.hostId, state === 'normal' ? 'normal' : open ? 'fault' : 'ok');
  }

  _log(t, text) {
    t.log.push({ time: now(), text });
  }

  log(t, text) {
    this._log(t, text);
  }

  render() {
    this.hud.renderTickets(this.tickets, this.focusId, this.clock());
  }
}
