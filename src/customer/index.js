import noInternet from './cases/noInternet.js';
import websiteDown from './cases/websiteDown.js';
import serverUnreachable from './cases/serverUnreachable.js';
import serviceDown from './cases/serviceDown.js';
import { makeCustomer } from './people.js';

/**
 * Customer cases, one file each in ./cases. A case is a symptom the customer reports, the
 * questions you can ask, the advice you can give, and a pool of root causes. Each cause is
 *   side: 'customer' (fixed over the phone or remotely) or 'ours' (needs the data hall)
 *   fix:  { advice: key } | { remote: 'restart-cpe' }      (customer side)
 *   link: { template, hostPrefix?, impact } | { existing }  (our side)
 *   answers / replies / worked / story / diag
 * Add a file here to add a new kind of call.
 */
export const CUSTOMER_CASES = [noInternet, websiteDown, serverUnreachable, serviceDown];
export const caseByKey = Object.fromEntries(CUSTOMER_CASES.map((c) => [c.key, c]));

/** What the laptop sees for a healthy customer; a cause's `diag` overrides parts of it. */
export const DIAG_DEFAULTS = {
  line: 'up', // 'up' | 'down'
  cpe: 'online', // 'online' | 'offline' | 'hung'
  lan: 'office', // 'office' | 'guest'
  lease: 'active', // 'active' | 'none'
  resolver: 'ok', // 'ok' | 'fail'   (our DNS resolver, for this customer's lookups)
  web: 'ok', // 'ok' | 'blocked'    (port 80/443 at the hosting server)
  webFilter: false, // customer's own router web filter blocks their site
  server: 'ok', // 'ok' | 'uplink-down' | 'down'
  serverMoved: false, // customer still uses the old address
  customerFw: false, // customer's own office firewall blocks outbound
};

export const text = (v, c) => (typeof v === 'function' ? v(c) : v);

/**
 * Plan this shift's customer calls: a number of random ones, or fixed
 * [{ caseKey, causeKey }] specs (the tutorial). Calls whose cause is on our side get a
 * linked server-room ticket: an existing one from the shift if one matches, otherwise a
 * new one built through `buildLinked(template, overrides)` (held back until escalated).
 */
export function planCalls(r, countOrSpecs, scenarios, buildLinked) {
  const used = new Set();
  const cases = CUSTOMER_CASES.filter((c) => !c.cascadeOnly);
  const specs = Array.isArray(countOrSpecs) ? countOrSpecs : Array.from({ length: countOrSpecs }, () => null);
  const calls = [];
  for (let i = 0; i < specs.length; i++) {
    const kase = specs[i] ? caseByKey[specs[i].caseKey] : r.pick(cases);
    const causeKey = specs[i]?.causeKey ?? r.pick(Object.keys(kase.causes));
    const cause = kase.causes[causeKey];
    const customer = makeCustomer(r, used);
    const call = { id: `CALL-${i + 1}`, caseKey: kase.key, causeKey, customer, linkId: null };
    if (cause.side === 'ours') {
      // reuse a matching ticket from the shift, unless the cause needs its own kind of host (e.g. a DHCP server)
      let linked = cause.link.hostPrefix ? null : scenarios.find((s) => s.template === cause.link.template && !s.linkedBy);
      if (!linked) linked = buildLinked(cause.link.template, cause.link.hostPrefix ? { host: r.host(cause.link.hostPrefix) } : {});
      linked.linkedBy = call.id;
      linked.brief = `${cause.link.impact} ${linked.brief}`;
      call.linkId = linked.id;
    }
    calls.push(call);
  }
  return calls;
}

/** A cascade call: a new customer reporting an outage caused by an escalated ticket. */
export function cascadeCall(r, linkedTicket, n, used) {
  return { id: `CALL-X${n}`, caseKey: 'service-down', causeKey: 'linked', customer: makeCustomer(r, used), linkId: linkedTicket.id, cascade: true };
}

/** The scenario a customer ticket wraps (no console, no physical steps). */
export function callScenario(call, ticketId) {
  const kase = caseByKey[call.caseKey];
  const cause = kase.causes[call.causeKey];
  const c = call.customer;
  const story = cause.story(c);
  return {
    id: ticketId,
    host: c.id,
    name: `${kase.symptom} · ${c.company}`,
    topic: 'Customer call',
    priority: call.cascade ? 'P1' : kase.priority,
    location: { office: true },
    brief: `${c.name} (${c.company}, ${c.id}) called: "${text(kase.opening, c)}"`,
    customer: c,
    init: () => ({}),
    steps: [],
    story: `Root cause: ${story.cause}\nAction taken: ${story.action}\nVerified: ${story.verified}`,
  };
}
