import { caseByKey, callScenario, cascadeCall, text } from './index.js';

const RING_SECONDS = 40; // unanswered for this long and it becomes a missed call
export const SATISFACTION = {
  start: 75,
  missed: -20,
  wrongAdvice: -12,
  wrongEscalation: -20,
  calledTooEarly: -6,
  slaBreach: -15,
  quickFix: 15, // resolved within 3 minutes of answering
};
const clamp = (v) => Math.max(0, Math.min(100, v));

/**
 * The helpdesk phone. Owns the customer calls of a shift: ringing, missed calls, the
 * dialogue (questions -> conclusion), escalation to a linked server-room ticket,
 * remote fixes from the laptop, and call-backs.
 *
 * A call moves through states: queued -> ringing -> talking -> (hold | waiting |
 * remoteFixed | callback) -> resolved. Its ticket lives in the TicketSystem.
 */
export class Desk {
  constructor({ tickets, hud, ui, audio, helpdesk, random }) {
    this.tickets = tickets;
    this.hud = hud;
    this.ui = ui;
    this.audio = audio;
    this.helpdesk = helpdesk;
    this.r = random;
    this.calls = [];
    this.queue = [];
    this.ringing = null;
    this.ringStart = 0;
    this.active = null; // call shown in the UI
    this.usedCompanies = new Set();
    this.onOpen = null; // () => void, when the call UI opens (to release the mouse)
    ui.onChoose = (i) => this._choose(i);
    ui.onClose = (reason) => this._closed(reason);
    tickets.callsWaiting = () => (this.ringing ? 1 : 0) + this.calls.filter((c) => ['missed', 'hold', 'remoteFixed', 'callback'].includes(c.state)).length;
  }

  /** Planned calls for the shift (from buildShift). They ring when the shift says so. */
  plan(calls) {
    for (const call of calls) {
      call.state = 'queued';
      this.usedCompanies.add(call.customer.domain.split('.')[0]);
    }
    this.calls.push(...calls);
    this.queue.push(...calls);
  }

  /** Calls being dealt with: ringing, or answered/missed and not yet closed. */
  get activeCount() {
    return this.calls.filter((c) => c.state !== 'queued' && c.ticket?.status !== 'CLOSED').length;
  }

  get hasQueued() {
    return this.queue.length > 0;
  }

  /** True while any call still needs work (for the end of the shift). */
  get pending() {
    return this.calls.some((c) => c.state !== 'resolved' || c.ticket?.status !== 'CLOSED');
  }

  // ---- ringing ------------------------------------------------------------------------

  ringNext() {
    if (this.ringing || !this.queue.length) return false;
    this.ringing = this.queue.shift();
    this.ringing.state = 'ringing';
    this.ringStart = this.tickets.clock();
    this.audio.setRinging(true, this.helpdesk.phone);
    this.helpdesk.ringing = true;
    this.hud.toast(`☎ The helpdesk phone is ringing: ${this.ringing.customer.company}.`, 'new');
    this.tickets.render();
    return true;
  }

  /** An ignored alarm made a customer call in: ring as soon as the line is free. */
  addCascade(linkedTicket) {
    const call = cascadeCall(this.r, linkedTicket, this.calls.length + 1, this.usedCompanies);
    call.state = 'queued';
    this.calls.push(call);
    this.queue.unshift(call);
    this.ringNext();
    return call;
  }

  update() {
    if (this.ringing && this.tickets.clock() - this.ringStart > RING_SECONDS) this._missed(this.ringing);
    if (!this.ringing && this.queue[0]?.cascade) this.ringNext();
  }

  _stopRinging() {
    this.ringing = null;
    this.audio.setRinging(false);
    this.helpdesk.ringing = false;
  }

  _missed(call) {
    this._stopRinging();
    const t = this._ticket(call);
    call.state = 'missed';
    this._satisfaction(call, SATISFACTION.missed);
    this.tickets.log(t, 'Missed call: nobody answered.');
    t.guide = `Missed call. Call ${call.customer.name} back from the desk phone.`;
    this.hud.toast(`Missed call from ${call.customer.company}. Call them back from the helpdesk phone.`, 'warn');
    this.audio.play('buzz');
    this.tickets.render();
  }

  // ---- the phone -----------------------------------------------------------------------

  /** Calls you could make right now, most urgent first. */
  _callbackCandidates() {
    const rank = { callback: 0, remoteFixed: 0, missed: 1, hold: 2, waiting: 3 };
    return this.calls.filter((c) => c.state in rank).sort((a, b) => rank[a.state] - rank[b.state]);
  }

  phonePrompt() {
    if (this.ringing) return `Answer the phone · ${this.ringing.customer.company}`;
    const next = this._callbackCandidates()[0];
    return next ? `Call back ${next.customer.name} · ${next.customer.company}` : null;
  }

  usePhone() {
    if (this.ringing) return this._answer(this.ringing);
    const next = this._callbackCandidates()[0];
    if (next) this._callBack(next);
  }

  _answer(call) {
    this._stopRinging();
    const t = this._ticket(call);
    call.answeredAt = this.tickets.clock();
    call.state = 'talking';
    call.phase = 'questions';
    call.lines = [{ who: 'them', text: text(caseByKey[call.caseKey].opening, call.customer) }];
    this.tickets.log(t, `Answered call from ${call.customer.name}.`);
    this.onAnswer?.(call);
    this._open(call);
  }

  _callBack(call) {
    const t = call.ticket;
    const c = call.customer;
    const kase = caseByKey[call.caseKey];
    const cause = kase.causes[call.causeKey];
    call.lines = [];
    const you = (s) => call.lines.push({ who: 'you', text: s });
    const them = (s) => call.lines.push({ who: 'them', text: s });
    if (call.state === 'missed') {
      you(`Hi ${c.name.split(' ')[0]}, this is the helpdesk returning your call.`);
      them(text(kase.opening, c));
      call.answeredAt = this.tickets.clock();
      call.state = 'talking';
      call.phase = 'questions';
      this.onAnswer?.(call);
    } else if (call.state === 'hold') {
      you(`Hi, it's the helpdesk again about ${kase.symptom.toLowerCase()}.`);
      them('Yes? Any news?');
      call.state = 'talking';
      call.phase = 'decide';
    } else if (call.state === 'remoteFixed') {
      you("Hi, it's the helpdesk. I've restarted your router from our side. Is it working now?");
      them(text(cause.worked, c));
      this._resolve(call, 'router restarted remotely; customer confirmed it works');
    } else if (call.state === 'callback') {
      you('Good news: we found the problem on our side and fixed it. Could you check for me?');
      them(text(cause.worked, c));
      this._resolve(call, 'fixed on our side; customer confirmed it works');
    } else if (call.state === 'waiting') {
      you("Hi, just checking in. We're still working on it on our side.");
      them('Is it fixed? It is still not working here.');
      this._satisfaction(call, SATISFACTION.calledTooEarly);
      this.tickets.log(t, 'Called the customer before the fix was done.');
      call.ended = true;
    }
    this._open(call);
  }

  _open(call) {
    this.active = call;
    this.tickets.focus(call.ticket);
    this.ui.open(this._view(call));
    this.onOpen?.();
  }

  _closed(reason) {
    const call = this.active;
    this.active = null;
    if (call && call.state === 'talking') {
      // hung up mid-conversation: they will expect a call back
      call.state = 'hold';
      call.ticket.guide = `Call ${call.customer.name} back when you know more.`;
      this.tickets.render();
    }
    call && delete call.ended;
    this.onClose?.(reason);
  }

  // ---- dialogue -----------------------------------------------------------------------

  _options(call) {
    if (call.state !== 'talking' || call.ended) return [{ label: 'Hang up', act: 'hangup' }];
    const kase = caseByKey[call.caseKey];
    const unasked = Object.keys(kase.questions).filter((q) => !call.asked?.has(q));
    if (call.phase === 'questions' && unasked.length) {
      return [
        ...unasked.slice(0, 3).map((q) => ({ label: kase.questions[q], act: 'ask', q })),
        { label: 'I think I know what this is…', act: 'decide', kind: 'decide' },
      ];
    }
    const c = call.customer;
    return [
      ...Object.entries(kase.advice).map(([key, say]) => ({ label: `Tell them: "${text(say, c)}"`, act: 'advice', key })),
      { label: "It's on our side: I'll open a ticket with the data hall and call you back.", act: 'escalate', kind: 'escalate' },
      { label: 'Let me check from our side and call you back.', act: 'hold', kind: 'hold' },
      ...(unasked.length ? [{ label: '← Ask another question', act: 'back' }] : []),
    ];
  }

  _view(call) {
    const c = call.customer;
    call.options = this._options(call);
    return {
      title: `${c.name} · ${c.company}`,
      subtitle: `${c.id} · ${caseByKey[call.caseKey].symptom} · ${call.ticket.id}`,
      satisfaction: call.satisfaction,
      lines: call.lines,
      options: call.options,
    };
  }

  _choose(i) {
    const call = this.active;
    const opt = call?.options?.[i];
    if (!opt) return;
    const t = call.ticket;
    const kase = caseByKey[call.caseKey];
    const cause = kase.causes[call.causeKey];
    const c = call.customer;
    const you = (s) => call.lines.push({ who: 'you', text: s });
    const them = (s) => call.lines.push({ who: 'them', text: s });
    const note = (s) => call.lines.push({ who: 'note', text: s });
    if (t.status === 'OPEN') this.tickets.setStatus(t, 'IN PROGRESS');

    switch (opt.act) {
      case 'hangup':
        return this.ui.close('hangup');
      case 'ask':
        (call.asked ??= new Set()).add(opt.q);
        you(kase.questions[opt.q]);
        them(text(cause.answers?.[opt.q] ?? kase.answers[opt.q], c));
        break;
      case 'decide':
        call.phase = 'decide';
        break;
      case 'back':
        call.phase = 'questions';
        break;
      case 'advice': {
        you(text(kase.advice[opt.key], c));
        if (cause.side === 'customer' && cause.fix.advice === opt.key) {
          them(text(cause.worked, c));
          this._resolve(call, 'fixed by the customer following our advice');
        } else {
          const reply = cause.replies?.[opt.key];
          const r = typeof reply === 'object' ? reply : { text: reply };
          them(text(r.text, c) || "We tried that. It didn't help.");
          if (!r.ok) this._mistake(call, `Advice didn't fit: "${text(kase.advice[opt.key], c)}"`, SATISFACTION.wrongAdvice);
        }
        break;
      }
      case 'escalate':
        you("This looks like it's on our side. I'm opening a ticket with the data hall and I'll call you back as soon as it's fixed.");
        if (cause.side === 'ours') {
          const linked = this.tickets.byId(call.linkId);
          if (linked.status === 'QUEUED') this.tickets.dispatch(linked);
          this.tickets.escalate(linked, `Customer impact: ${c.company} (${c.id}) reported "${kase.symptom}". Linked to ${t.id}.`);
          t.linkedId = linked.id;
          call.state = 'waiting';
          call.ended = true;
          this.tickets.setStatus(t, 'WAITING', `Escalated to the data hall: ${linked.id} (${linked.title}).`);
          t.guide = `Waiting on ${linked.id} in ${linked.rack ? `rack ${linked.rack}` : 'the data hall'}. When it's fixed, call ${c.name} back.`;
          them("OK. Please call me as soon as it's fixed.");
          if (linked.status === 'RESOLVED' || linked.status === 'CLOSED') this.onTicketResolved(linked);
        } else {
          note(`NOC: we checked ${c.id} from our side. Line, router, lease, DNS and routing all look fine. Nothing for the data hall to fix.`);
          them('So it is something here? What should I do?');
          this._mistake(call, 'Escalated a customer-side problem to the data hall', SATISFACTION.wrongEscalation);
        }
        break;
      case 'hold':
        you('Let me check a few things from our side, and I will call you back.');
        them('OK, thanks.');
        call.state = 'hold';
        t.guide = `Check ${c.id} from the laptop (Get-CustomerLine, Get-DhcpLease, Test-NetConnection…), then call ${c.name} back.`;
        this.tickets.render();
        this.ui.render(this._view(call));
        return this.ui.close('hold');
    }
    this.ui.render(this._view(call));
  }

  // ---- outcomes -----------------------------------------------------------------------

  /** The laptop ran a remote action (e.g. Restart-CustomerCpe). Returns true if it fixed the fault. */
  remoteAction(customerId, action) {
    const call = this.calls.find((c) => c.customer.id === customerId && c.ticket && c.state !== 'resolved');
    if (!call) return false;
    const cause = caseByKey[call.caseKey].causes[call.causeKey];
    if (cause.fix?.remote !== action) return false;
    call.state = 'remoteFixed';
    this.tickets.setStatus(call.ticket, 'CALL BACK', 'Router restarted remotely: traffic flowing again.');
    call.ticket.guide = `Router restarted. Call ${call.customer.name} back to confirm before closing.`;
    return true;
  }

  /** An SLA ran out on a customer's ticket: they are less happy. */
  onBreach(ticket) {
    if (ticket.call) this._satisfaction(ticket.call, SATISFACTION.slaBreach);
  }

  /** A server-room ticket was fixed: customers waiting on it need a call back. */
  onTicketResolved(server) {
    for (const call of this.calls) {
      if (call.linkId !== server.id || call.state !== 'waiting') continue;
      call.state = 'callback';
      this.tickets.setStatus(call.ticket, 'CALL BACK', `${server.id} is fixed. Call the customer back to confirm.`);
      call.ticket.guide = `${server.id} is fixed. Call ${call.customer.name} back to confirm before closing.`;
      this.hud.toast(`${server.id} fixed: call ${call.customer.name} (${call.customer.company}) back.`, 'success');
    }
  }

  _resolve(call, how) {
    call.state = 'resolved';
    call.ended = true;
    const quick = this.tickets.clock() - call.answeredAt < 180;
    if (quick) this._satisfaction(call, SATISFACTION.quickFix);
    call.ticket.guide = null;
    this.tickets.resolve(call.ticket, `Customer confirmed: ${how}.`);
  }

  _mistake(call, reason, penalty) {
    call.ticket.mistakes++;
    this.tickets.log(call.ticket, `✗ ${reason}`);
    this._satisfaction(call, penalty);
    this.audio.play('buzz');
  }

  _satisfaction(call, delta) {
    call.satisfaction = clamp((call.satisfaction ?? SATISFACTION.start) + delta);
    if (call.ticket) call.ticket.satisfaction = call.satisfaction;
  }

  /** Create (and open) the customer's ticket the first time we deal with the call. */
  _ticket(call) {
    if (call.ticket) return call.ticket;
    call.satisfaction ??= SATISFACTION.start;
    const t = this.tickets.add(callScenario(call, this.tickets.nextId()), { source: 'helpdesk', reporter: `${call.customer.name}, ${call.customer.company}` });
    t.call = call;
    t.satisfaction = call.satisfaction;
    call.ticket = t;
    this.tickets.dispatch(t);
    return t;
  }

  customer(id) {
    return this.calls.find((c) => c.customer.id.toLowerCase() === String(id).toLowerCase() && c.ticket);
  }
}
