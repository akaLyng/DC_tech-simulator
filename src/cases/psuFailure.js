import { L } from '../scenarios/helpers.js';
import { checkPart } from '../parts.js';

// Physical case: one of a server's two hot-swap PSUs has failed.
// params: { id, host, rack, u, failed: 1|2, watts: '800W'|'1100W' }
export default {
  key: 'psu-failure',
  kind: 'physical',
  priority: 'P2',
  params: (r) => ({ host: r.host(r.pick(['app', 'api', 'db'])), failed: r.pick([1, 2]), watts: r.pick(['800W', '1100W']) }),
  build: (p) => {
    const good = p.failed === 1 ? 2 : 1;
    const want = { type: 'psu', variant: p.watts, label: `a ${p.watts.replace('W', ' W')} hot-swap PSU`, why: `The label on PS${good} says ${p.watts.replace('W', ' W')}; mixed wattages break redundancy.` };
    const hotAisle = p.rack[0] === 'A' ? 'behind Row A (the aisle by the left wall)' : 'behind Row B (the aisle by the right wall)';
    const psu = (n) => ({
      prompt: (st, hand) => {
        const s = st.slots[n];
        if (s === 'failed') return `Pull PS${n} (amber)`;
        if (s === 'removed') return hand ? `Insert ${hand.label} into PS${n}` : `Empty PSU bay ${n}`;
        if (s === 'ok') return `Check PS${n} (green)`;
        return null;
      },
      run(st, ev, hand) {
        const s = st.slots[n];
        st.rearSeen = true;
        if (s === 'ok') return L(`PS${n}: green LED, ${p.watts.replace('W', ' W')}. This one is carrying the whole server right now. Leave it in.`);
        if (s === 'failed') {
          st.slots[n] = 'removed';
          ev.add('pulled');
          return L(`You squeeze the release latch and slide PS${n} out: amber LED, label ${p.watts.replace('W', ' W')}. ${p.host} keeps running on PS${good}. The dead unit goes in the RMA bin.`);
        }
        if (s === 'removed') {
          const bad = checkPart(hand, want, L);
          if (bad) return bad;
          hand.use();
          st.slots[n] = 'new';
          ev.add('inserted');
          return L(`You slide the new ${p.watts.replace('W', ' W')} PSU into bay ${n} until it latches. PS${n} LED: green. Front panel: "PSU redundancy restored".`);
        }
        return L(`PS${n} is the new unit. Green LED.`);
      },
    });
    return {
      id: p.id,
      host: p.host,
      name: `${p.host}: PSU redundancy lost`,
      topic: 'Hot-swap power supplies',
      priority: 'P2',
      location: { rack: p.rack, u: p.u, size: 2 },
      fixtures: { psu: { failed: p.failed } },
      brief: `Monitoring: ${p.host} reports "PSU redundancy lost". The server is still up on one power supply. Replace the failed unit before the other one goes.`,
      rackHint: `${p.host} (U${p.u}) has an amber status LED. Its PSUs are at the back: walk round to the hot aisle ${hotAisle}.`,
      init: () => ({ inspected: false, rearSeen: false, slots: { 1: p.failed === 1 ? 'failed' : 'ok', 2: p.failed === 2 ? 'failed' : 'ok' } }),
      physical: {
        inspect: {
          prompt: () => `Inspect ${p.host}`,
          run(st, ev) {
            st.inspected = true;
            ev.add('front');
            return L(`Status LED: amber. The front-panel display reads "PSU redundancy lost: PS${p.failed} failure". The PSUs are hot-swap units at the back of the server: go round to the hot aisle ${hotAisle}.`);
          },
        },
        psu1: psu(1),
        psu2: psu(2),
      },
      world: (st) => ({ psu: { ...st.slots } }),
      steps: [
        {
          title: 'Find the failed PSU',
          body: `<p>Read the front panel of ${p.host}, then go to the back of the rack. The failed supply has an amber LED.</p>`,
          done: (st) => st.inspected || st.rearSeen,
        },
        {
          title: 'Pull the failed PSU',
          body: `<p>Hot-swap PSUs come out while the server runs. Pull only the amber one: the green one is carrying the whole load.</p>`,
          done: (st) => st.slots[p.failed] !== 'failed',
        },
        {
          title: 'Fit a matching spare',
          body: `<p>Fetch a spare from the parts shelf by the exit. It must match the wattage on the label (${p.watts.replace('W', ' W')}).</p>`,
          done: (st) => st.slots[p.failed] === 'new',
        },
      ],
      story: `${p.host} lost PSU redundancy. The front panel pointed to PS${p.failed}; at the back its LED was amber. I pulled it while the server ran on PS${good}, fitted a matching ${p.watts.replace('W', ' W')} spare, and confirmed both LEDs green and redundancy restored.`,
    };
  },
};
