import looseCable from './looseCable.js';
import psuFailure from './psuFailure.js';
import sfpFault from './sfpFault.js';
import { LAB_CASES } from '../scenarios/index.js';
import { makeRandom } from './random.js';
import { planCalls } from '../customer/index.js';

export const PHYSICAL_CASES = [looseCable, psuFailure, sfpFault];

/**
 * Every ticket template. A template is data plus two functions:
 *   params(r, slot) -> random details for this shift (hostnames, IPs, which part failed,
 *                      root cause...), given its rack slot { rack, u }
 *   build(p)        -> the scenario: brief, world fixtures, physical actions, console
 *                      commands, steps and story, all filled in from p
 * Adding a ticket (or another root cause for an existing symptom) means adding a template.
 */
export const CASE_TEMPLATES = [...PHYSICAL_CASES, ...LAB_CASES];

const RACKS = ['A', 'B'].flatMap((row) => Array.from({ length: 8 }, (_, i) => `${row}${String(i + 1).padStart(2, '0')}`));

const byKey = Object.fromEntries(CASE_TEMPLATES.map((t) => [t.key, t]));

/**
 * One shift: the server-room scenarios in dispatch order, plus the customer calls.
 * Each shift gets fresh ticket numbers, racks, U positions and params, so nothing can be
 * memorized between shifts. The first ticket is always a hands-on one (no terminal).
 *
 * A call whose root cause is on our side links to a server-room ticket; if the shift
 * doesn't already have a matching one, a `held` scenario is built for it, which only
 * opens if the call is escalated.
 */
export function buildShift({ rand = Math.random, size = CASE_TEMPLATES.length, calls = 0, tutorial = false } = {}) {
  const r = makeRandom(rand);
  const racks = r.shuffle(RACKS);
  const first = r.pick(PHYSICAL_CASES);
  // the tutorial: one console fault, then a customer-side call, then a call that turns out to be ours
  const order = tutorial ? [byKey['disk-full']] : [first, ...r.shuffle(CASE_TEMPLATES.filter((t) => t !== first))].slice(0, size);
  if (tutorial) calls = [{ caseKey: 'no-internet', causeKey: 'guestWifi' }, { caseKey: 'website-down', causeKey: 'firewall' }];
  let number = r.int(3000, 8800);
  const make = (template, overrides = {}) => {
    const slot = { rack: racks.pop(), u: r.int(8, 30) };
    const scenario = template.build({ id: `INC-${number++}`, ...slot, ...template.params(r, slot), ...overrides });
    scenario.template = template.key;
    return scenario;
  };
  const scenarios = order.map((t) => make(t));
  if (tutorial) scenarios[0].tutorialGuide = true; // its console opens with the guide panel showing
  const held = [];
  const plannedCalls = planCalls(r, calls, scenarios, (key, overrides) => {
    const s = make(byKey[key], overrides);
    s.held = true;
    held.push(s);
    return s;
  });
  const sequence = tutorial ? [{ server: scenarios[0].id }, ...plannedCalls.map((c) => ({ call: c.id }))] : null;
  return { scenarios: [...scenarios, ...held], calls: plannedCalls, random: r, sequence };
}
