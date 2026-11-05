import { L } from './scenarios/helpers.js';
import { GAME_TAG, linuxKind, tagged } from './commandKinds.js';

/**
 * Command runner ported from the original browser practice lab. Purely simulated: every
 * command is matched against the scenario's regexes and answered from its
 * in-memory state. Nothing is ever executed or eval'd.
 *
 * One ScenarioSession per ticket keeps its state, step progress, history and
 * transcript, so closing and reopening the console picks up where you left off.
 */
export class ScenarioSession {
  constructor(scenario) {
    this.s = scenario;
    this.locked = false; // set when the ticket is closed: no more reset
    this.reset();
  }

  reset() {
    this.st = this.s.init();
    this.ev = new Set();
    this.stepIdx = 0;
    this.hist = [];
    this.lines = [];
    this.solved = false;
    this.lastLearned = null;
    this._mistakesSeen = new Set();
    this._banner();
  }

  get scenario() {
    return this.s;
  }

  get step() {
    return this.s.steps[this.stepIdx] || null;
  }

  get prompt() {
    return { user: this.s.user, host: this.s.host, cwd: this.s.cwd, shell: this.s.shell || 'bash' };
  }

  /** Give a tool session (the laptop) a set of guided steps, e.g. the PowerShell intro. */
  setSteps(steps, { solvedText, banner } = {}) {
    this.s.steps = steps;
    this.s.solvedText = solvedText;
    this.stepIdx = 0;
    this.solved = false;
    this.lastLearned = null;
    this.ev = new Set();
    if (banner) this.lines.push({ t: banner, c: 'o-warn' });
  }

  /** Physical action key (e.g. "cable") if this command is a job done at the rack. */
  physicalKeyFor(cmd) {
    const c = cmd.trim().replace(/\s+/g, ' ').replace(/^sudo /, '');
    for (const [key, p] of Object.entries(this.s.physical || {})) if (p.matches?.(c)) return key;
    return null;
  }

  /** 'real' | 'simplified' | 'fictional': whether a command exists like this in real life. */
  commandKind(cmd) {
    return this.s.commandKind ? this.s.commandKind(cmd) : linuxKind(cmd);
  }

  /** Run one line typed at the prompt. Returns what happened, for the game to react to. */
  run(raw) {
    const s = this.s;
    const res = { completed: [], solvedNow: false, physical: null, exit: false, reset: false, mistakes: [] };
    let c = raw.trim().replace(/\s+/g, ' ');
    this.lines.push({ prompt: true, t: raw });
    if (!c) return res;
    this.hist.push(c);
    const ps = s.shell === 'powershell';
    if (c === 'clear' || (ps && ['cls', 'clear-host'].includes(c.toLowerCase()))) {
      this.lines = [];
      return res;
    }
    if (c === 'reset') {
      if (this.locked) return this._print(L('This ticket is closed. Nothing to reset.', 'o-dim'), res);
      this.reset();
      res.reset = true;
      return res;
    }
    if (c === 'exit' || c === 'logout') {
      res.exit = true;
      return this._print(L(`logout\nConnection to ${s.host} closed.`, 'o-dim'), res);
    }

    // `| grep x` (and in PowerShell `| Select-String x`, case-insensitive like PS)
    let grep = null;
    const gm = ps ? c.match(/^(.*?)\s*\|\s*(?:select-string|sls|findstr|grep)\s+(?:-pattern\s+)?["']?([^"']+?)["']?$/i) : c.match(/^(.*?)\s*\|\s*grep\s+(-i\s+)?["']?([^"']+?)["']?$/);
    if (gm && (ps || !/\|\s*sudo tee/.test(c))) {
      c = gm[1];
      grep = ps ? { pat: gm[2], i: true } : { pat: gm[3], i: !!gm[2] };
    }

    let sudo = false;
    if (!ps && /^sudo /.test(c)) {
      sudo = true;
      c = c.slice(5);
    }

    let out;
    const pkey = this.physicalKeyFor(c);
    if (pkey) {
      res.physical = pkey;
      out = L(`That's a physical job, not a command. ${this._walkTo(pkey)} Then reopen the console to continue.`, 'o-warn');
    } else {
      out = s.exec(c, this.st, sudo, this.ev) || (ps ? null : this._generic(c));
    }
    if (!out) {
      const word = c.split(' ')[0];
      out = s.notFound?.(word) || L(`${word}: command not found here.\nThis lab only simulates the commands this ticket needs. Type help to list them, or hint for the next step.`, 'o-dim');
    }
    if (grep) {
      const re = new RegExp(grep.pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), grep.i ? 'i' : '');
      out = out.map((o) => ({ t: o.t.split('\n').filter((ln) => re.test(ln)).join('\n'), c: o.c })).filter((o) => o.t);
    }
    this._print(out, res);
    this._advance(res);
    return res;
  }

  /**
   * A physical action done in the world (pressing E on a cable, disk bay, PSU...).
   * `hand` is { part, use(), mistake(reason) }: the part the player is holding.
   */
  doPhysical(key, hand) {
    const res = { completed: [], solvedNow: false, physical: key, exit: false, reset: false, mistakes: [] };
    const before = JSON.stringify(this.st);
    const out = this.s.physical[key].run(this.st, this.ev, hand);
    res.changed = JSON.stringify(this.st) !== before;
    res.output = out;
    if (this.s.exec) this.lines.push({ t: `── at rack ${this.s.location.rack} ──`, c: 'o-dim' });
    this._print(out, res);
    this._advance(res);
    return res;
  }

  /** Short description of the physical step, for hints. */
  physicalLabel(key) {
    const p = this.s.physical[key];
    return `At rack ${this.s.location.rack}: press E on ${p.target}`;
  }

  _walkTo(key) {
    const loc = this.s.location;
    return `Close the console (Esc or exit), walk to rack ${loc.rack} and press E on ${this.s.physical[key].target} of ${this.s.host} (U${loc.u}).`;
  }

  _print(out, res) {
    for (const o of out) if (o.t !== '') this.lines.push({ t: o.t, c: o.c });
    return res;
  }

  _advance(res) {
    const s = this.s;
    for (const [name, reason] of Object.entries(s.mistakes || {})) {
      if (this.ev.has(name) && !this._mistakesSeen.has(name)) {
        this._mistakesSeen.add(name);
        res.mistakes.push(reason);
      }
    }
    if (!s.steps.length) return; // tool sessions (the helpdesk laptop) have nothing to solve
    let moved = false;
    const complete = () => {
      res.completed.push(s.steps[this.stepIdx]);
      this.lastLearned = s.steps[this.stepIdx];
      this.stepIdx++;
      moved = true;
    };
    while (this.stepIdx < s.steps.length) {
      if (s.steps[this.stepIdx].done(this.st, this.ev)) {
        complete();
        continue;
      }
      // The player fixed things in a different order than the guide (e.g. ran
      // dhclient before looking at the 169.254 address), so the current step's
      // evidence can no longer appear. If a later step is already satisfied,
      // count everything up to it as done instead of getting stuck.
      const later = s.steps.findIndex((step, k) => k > this.stepIdx && step.done(this.st, this.ev));
      if (later < 0) break;
      while (this.stepIdx <= later) complete();
    }
    if (this.stepIdx >= s.steps.length && !this.solved) {
      this.solved = true;
      res.solvedNow = true;
      this.lines.push({ t: s.solvedText ?? `[ticket ${s.id} resolved]`, c: 'o-ok' });
    } else if (moved && this.step?.physical) {
      this.lines.push({ t: `Next step is physical. ${this._walkTo(this.step.physical)}`, c: 'o-warn' });
    }
  }

  _banner() {
    if (this.s.banner) {
      for (const t of this.s.banner) this.lines.push({ t, c: 'o-dim' });
      return;
    }
    this.lines.push({ t: `Connected to ${this.s.host}. Ticket ${this.s.id}: ${this.s.name}.`, c: 'o-dim' });
    this.lines.push({ t: 'Type help for commands, hint for the next step. Alt+H shows the guide, exit or Esc closes the console.', c: 'o-dim' });
  }

  _generic(c) {
    const s = this.s;
    if (c === 'help') {
      const list = s.help.split(', ').map((h) => tagged(h, linuxKind(h))).join(', ');
      const also = ['whoami', 'hostname', 'pwd', 'ls', 'uptime', 'clear', 'hint', 'reset', 'exit'].map((h) => tagged(h, linuxKind(h))).join(', ');
      return L(`Commands this machine understands:\n  ${list}\nAlso: ${also}\nPipes: you can add | grep <text> to filter output.\n${GAME_TAG} = made up or simplified for the game; everything else works the same on a real server.`, 'o-dim');
    }
    if (c === 'hint') {
      const step = this.step;
      if (!step) return L('This ticket is solved. Close it from the ticket panel (T, then C).', 'o-dim');
      const tries = step.try.map((t) => {
        const k = this.physicalKeyFor(t);
        return k ? `(${this.physicalLabel(k)})` : t;
      });
      return L('Next step: ' + step.title + '\nTry: ' + tries.join('   then   '), 'o-warn');
    }
    if (c === 'whoami') return L(s.user);
    if (c === 'hostname') return L(s.host);
    if (c === 'pwd') return L(s.cwd === '~' ? `/home/${s.user}` : `/home/${s.user}/${s.cwd.slice(2)}`);
    if (c === 'ls' || c === 'ls -l' || c === 'ls -la') return L(s.files.length ? s.files.join('  ') : '', '');
    if (c === 'uptime') return L(' 09:41:02 up 14 days,  3:12,  1 user,  load average: 0.08, 0.05, 0.01');
    if (c === 'date') return L(new Date().toUTCString());
    if (c === 'history') return L(this.hist.map((h, i) => `  ${i + 1}  ${h}`).join('\n') || '(empty)');
    return null;
  }
}
