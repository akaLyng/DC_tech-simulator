import { L } from '../scenarios/helpers.js';

// Physical case: a server's patch cable has worked loose. No console needed.
// params: { id, host, rack, u }
export default {
  key: 'loose-cable',
  kind: 'physical',
  priority: 'P2',
  params: (r) => ({ host: r.host(r.pick(['app', 'web', 'api', 'db'])) }),
  build: (p) => ({
    id: p.id,
    host: p.host,
    name: 'Host lost network',
    topic: 'Layer 1, patch cables',
    priority: 'P2',
    location: { rack: p.rack, u: p.u, size: 2 },
    fixtures: { cable: true },
    brief: `Host in Row ${p.rack[0]}, Rack ${p.rack.slice(1)} lost network. Investigate and restore.`,
    rackHint: `Look at ${p.host} (U${p.u}) and the cabling in front of it.`,
    init: () => ({ inspected: false, seated: false }),
    physical: {
      inspect: {
        prompt: () => `Inspect ${p.host}`,
        run(st, ev) {
          st.inspected = true;
          ev.add('inspected');
          return L(`The link LED on ${p.host} is blinking AMBER: no link on NIC1. A blue Cat6 patch cable is hanging loose in front of it; the RJ45 plug has come out of the port.`);
        },
      },
      cable: {
        prompt: (st) => (st.seated ? null : st.inspected ? 'Reseat patch cable' : 'Inspect patch cable'),
        run(st, ev) {
          if (!st.inspected) {
            st.inspected = true;
            ev.add('inspected');
            return L(`The RJ45 plug has come out of NIC1 on ${p.host}. Press E again to reseat it.`);
          }
          st.seated = true;
          ev.add('reseated');
          return L('You push the plug back into NIC1 until it clicks. Link LED: solid green. Cable reseated, link established.');
        },
      },
    },
    world: (st) => ({ cableSeated: st.seated }),
    steps: [
      {
        title: 'Find the fault',
        body: `<p>Start at layer 1. Look at the link LED on ${p.host} and the cable in front of it.</p>`,
        done: (st) => st.inspected,
      },
      {
        title: 'Reseat the cable',
        body: '<p>Push the RJ45 plug back into NIC1 until the latch clicks, then check the link LED.</p>',
        done: (st) => st.seated,
      },
    ],
    story: `Patch cable had come out of NIC1 on ${p.host} (${p.rack}, U${p.u}); link LED blinking amber. Reseated the RJ45 — link restored, LED solid green.`,
  }),
};
