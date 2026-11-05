// A shift: a clock, a release schedule for the queued tickets, SLA tracking and the
// end-of-shift report. Time only runs while the player is actually playing (not on the
// start screen or the pause menu), so SLAs are fair.

/**
 * Difficulty presets. `calm` is the default; a difficulty picker can set
 * SHIFT_CONFIG.difficulty before the shift starts.
 *
 *   minutes / tickets / calls  shift length, server tickets and customer calls drawn
 *   slaFactor                  multiplies every SLA
 *   pauseSlaInDialogs          SLA clocks stop while a console or a call is open
 *   cascade                    ignored alarms turn red and make customers call
 *   servers / phone            release tracks: at most `max` active at once, and either
 *                              a fixed `releaseSeconds` rhythm (with `idleSeconds` when
 *                              nothing is open) or a `breakSeconds` pause after each one
 *                              is resolved and closed
 *   tutorial                   the very first shift is the guided tutorial
 */
export const SHIFT_CONFIG = {
  difficulty: 'calm',
  slaMinutes: { P1: 6, P2: 10, P3: 15 }, // before slaFactor; from when the ticket opens
  escalateMinutes: 5, // with cascades on: an untouched alarm turns red after this long
  tutorialBreakSeconds: [15, 25], // pause between tutorial lessons
  presets: {
    calm: {
      minutes: 30,
      tickets: 5,
      calls: 3,
      slaFactor: 2,
      pauseSlaInDialogs: true,
      cascade: false,
      tutorial: true,
      servers: { max: 1, breakSeconds: [60, 90] },
      phone: { max: 1, breakSeconds: [60, 90], firstSeconds: 45 },
    },
    normal: {
      minutes: 25,
      tickets: 8,
      calls: 3,
      slaFactor: 1,
      pauseSlaInDialogs: false,
      cascade: false,
      tutorial: false,
      servers: { max: 2, releaseSeconds: [60, 150], idleSeconds: 4 },
      phone: { max: 2, releaseSeconds: [100, 220], firstSeconds: 45 },
    },
    hard: {
      minutes: 25,
      tickets: 8,
      calls: 3,
      slaFactor: 1,
      pauseSlaInDialogs: false,
      cascade: true,
      tutorial: false,
      servers: { max: Infinity, releaseSeconds: [60, 150], idleSeconds: 4 },
      phone: { max: Infinity, releaseSeconds: [100, 220], firstSeconds: 45 },
    },
  },
};

/** The active preset. */
export const preset = (name = SHIFT_CONFIG.difficulty) => SHIFT_CONFIG.presets[name];

const between = ([a, b]) => a + Math.random() * (b - a);

export class Shift {
  /**
   * @param sequence optional fixed release order (the tutorial):
   *   [{ server: ticketId } | { call: callId }], one at a time with a short break between.
   */
  constructor(tickets, hud, { onEnd, onBreach, onRelease, sequence = null, settings = preset() } = {}) {
    this.tickets = tickets;
    this.hud = hud;
    this.onEnd = onEnd;
    this.onBreach = onBreach;
    this.onRelease = onRelease; // (kind, item, index) for tutorial messages
    this.cfg = settings;
    this.length = settings.minutes * 60;
    this.time = 0;
    this.ended = false;
    this.desk = null; // the helpdesk phone, if there is one
    this.sequence = sequence;
    this.seqIndex = 0;
    this.tracks = {
      servers: { next: 0, active: 0 },
      phone: { next: settings.phone.firstSeconds ?? 0, active: 0 },
      sequence: { next: 0, active: 0 },
    };
    tickets.clock = () => this.time;
    tickets.slaFor = (priority) => SHIFT_CONFIG.slaMinutes[priority] * 60 * settings.slaFactor;
  }

  get remaining() {
    return Math.max(0, this.length - this.time);
  }

  /** Server faults being worked on (including ones a customer call escalated). */
  get activeServers() {
    return this.tickets.tickets.filter((x) => x.kind !== 'customer' && !['QUEUED', 'CLOSED'].includes(x.status)).length;
  }

  /** `dialogOpen`: a console or call is open (SLAs pause in presets that say so). */
  update(dt, running, { dialogOpen = false } = {}) {
    if (this.ended || !running) return;
    this.time += dt;
    const t = this.tickets;

    if (this.sequence) this._releaseSequence();
    else {
      this._track('servers', this.activeServers, t.hasQueued, () => t.dispatchNext());
      if (this.desk) this._track('phone', this.desk.activeCount, this.desk.hasQueued, () => this.desk.ringNext());
    }
    this.desk?.update();

    // SLAs stand still while you're busy in a console or on the phone (calm)
    if (dialogOpen && this.cfg.pauseSlaInDialogs) {
      for (const ticket of t.openTickets) if (Number.isFinite(ticket.slaDue)) ticket.slaDue += dt;
    }

    // with cascades on: untouched data-hall alarms escalate and set off a customer call
    if (this.cfg.cascade) {
      for (const ticket of t.openTickets) {
        if (ticket.status !== 'OPEN' || ticket.escalated || !ticket.rack || this.time - ticket.openedAt < SHIFT_CONFIG.escalateMinutes * 60) continue;
        t.escalate(ticket, `Alarm ignored for ${SHIFT_CONFIG.escalateMinutes} minutes: escalated to P1. Customers are affected.`);
        this.hud.toast(`${ticket.id} on rack ${ticket.rack} turned red: nobody touched it for ${SHIFT_CONFIG.escalateMinutes} minutes.`, 'warn');
        this.desk?.addCascade(ticket);
      }
    }

    // SLA breaches on anything still being worked on
    for (const ticket of t.openTickets) {
      if (ticket.status === 'RESOLVED' || ticket.breached || this.time <= ticket.slaDue) continue;
      ticket.breached = true;
      t.log(ticket, `SLA breached (${ticket.priority}).`);
      this.hud.toast(`SLA breached on ${ticket.id} (${ticket.priority}).`, 'warn');
      this.onBreach?.(ticket);
      t.render();
    }

    if (this.time >= this.length) this.end('time');
    else if (this._allDone()) this.end('done');
  }

  _allDone() {
    const t = this.tickets;
    const seqLeft = this.sequence && this.seqIndex < this.sequence.length;
    return !seqLeft && !t.hasQueued && t.tickets.every((x) => x.status === 'CLOSED' || x.held) && !this.desk?.pending;
  }

  /**
   * One release track. At most `max` active; the next one comes on a fixed rhythm
   * (`releaseSeconds`, or `idleSeconds` once nothing is open) or, in calm, a
   * `breakSeconds` pause after the last one was resolved and closed.
   */
  _track(name, active, hasMore, release) {
    const cfg = this.cfg[name];
    const tr = this.tracks[name];
    if (active < tr.active) {
      if (cfg.breakSeconds) tr.next = this.time + between(cfg.breakSeconds);
      else if (active === 0 && cfg.idleSeconds) tr.next = Math.min(tr.next, this.time + cfg.idleSeconds);
    }
    tr.active = active;
    if (!hasMore || active >= cfg.max || this.time < tr.next || this.time >= this.length) return;
    if (!release()) return;
    tr.active = active + 1;
    tr.next = cfg.releaseSeconds ? this.time + between(cfg.releaseSeconds) : Infinity; // calm: wait for the close
  }

  /** The tutorial: one item at a time, the next after the previous is closed plus a short break. */
  _releaseSequence() {
    const tr = this.tracks.sequence;
    const active = this.activeServers + (this.desk?.activeCount ?? 0);
    if (active < tr.active && active === 0) tr.next = this.time + between(SHIFT_CONFIG.tutorialBreakSeconds);
    tr.active = active;
    if (active > 0 || this.time < tr.next || this.seqIndex >= this.sequence.length) return;
    const item = this.sequence[this.seqIndex];
    const ok = item.server ? !!this.tickets.dispatch(this.tickets.byId(item.server)) : this.desk.ringNext();
    if (!ok) return;
    this.onRelease?.(item.server ? 'server' : 'call', item, this.seqIndex);
    this.seqIndex++;
    tr.active = 1;
    tr.next = Infinity;
  }

  end(reason) {
    if (this.ended) return;
    this.ended = true;
    this.onEnd?.(this.report(reason));
  }

  report(reason) {
    const rows = this.tickets.tickets.filter((t) => !(t.held && t.status === 'QUEUED')).map((t) => {
      const fixedAt = t.resolvedAt ?? null;
      // customers: their score, minus a penalty if they were left without a fix at the end
      const satisfaction = t.kind === 'customer' ? Math.max(0, (t.satisfaction ?? 75) - (['RESOLVED', 'CLOSED'].includes(t.status) ? 0 : 25)) : null;
      return {
        id: t.id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        released: t.openedAt !== null,
        timeToFix: fixedAt !== null ? fixedAt - t.openedAt : null,
        slaMet: t.openedAt === null ? null : !t.breached && fixedAt !== null && fixedAt <= t.slaDue,
        breached: !!t.breached,
        mistakes: t.mistakes,
        satisfaction,
      };
    });
    const scores = rows.map((r) => r.satisfaction).filter((x) => x !== null);
    const released = rows.filter((r) => r.released);
    // only closed tickets count: the fix isn't done until the write-up is
    const solved = released.filter((r) => r.status === 'CLOSED');
    const times = solved.map((r) => r.timeToFix).filter((x) => x !== null);
    return {
      reason,
      duration: this.time,
      rows,
      released: released.length,
      solved: solved.length,
      closed: rows.filter((r) => r.status === 'CLOSED').length,
      breaches: rows.filter((r) => r.breached).length,
      mistakes: rows.reduce((n, r) => n + r.mistakes, 0),
      avgTime: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
      satisfaction: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      customers: scores.length,
    };
  }
}

export const fmtTime = (s) => {
  if (s === null || s === undefined) return '—';
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
