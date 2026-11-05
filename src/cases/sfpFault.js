import { L } from '../scenarios/helpers.js';
import { checkPart } from '../parts.js';

// Physical case: one symptom (an uplink port with no link light), several possible
// root causes. Each shift picks one, so the fix has to be found, not remembered.
export const SFP_CAUSES = {
  unseated: {
    clue: 'The LC connector is not quite latched: it sits a millimetre proud of the module.',
    fix: 'reseat',
    story: 'the LC connector had not latched',
  },
  deadSfp: {
    clue: 'The fiber is latched and looks undamaged. The SFP module is hot to the touch.',
    fix: 'sfp',
    story: 'the SFP module itself had died',
  },
  badFiber: {
    clue: 'The connector is latched, but the fiber has a sharp kink where it bends up towards the tray.',
    fix: 'fiber',
    story: 'the fiber patch had a sharp kink',
  },
};

// params: { id, host (switch name), rack, cage: 0|1, speed: '10G'|'25G', cause: key of SFP_CAUSES }
export default {
  key: 'sfp-fault',
  kind: 'physical',
  priority: 'P1',
  causes: Object.keys(SFP_CAUSES),
  // the switch is named after its rack; the root cause is drawn from SFP_CAUSES
  params: (r, slot) => ({ host: `tor-${slot.rack.toLowerCase()}`, cage: r.pick([0, 1]), speed: r.pick(['10G', '25G']), cause: r.pick(Object.keys(SFP_CAUSES)) }),
  build: (p) => {
    const cause = SFP_CAUSES[p.cause];
    const port = 49 + p.cage;
    const module = p.speed === '25G' ? 'SFP28 25G SR' : 'SFP+ 10G SR';
    const wantSfp = { type: 'sfp', variant: p.speed, label: `an ${module} module`, why: `The port runs at ${p.speed}; the far end has to match.` };
    const wantFiber = { type: 'cable', variant: 'fiber', label: 'an OM4 LC-LC fiber patch', why: 'This is an optical port: copper Cat6 cannot plug into an SFP.' };
    const fixed = (st, ev, how) => {
      st.fixed = true;
      ev.add('fixed');
      return L(`${how} Port ${port} link LED: green. The uplink from ${p.rack} to the core is back.`);
    };

    return {
      id: p.id,
      host: p.host,
      name: `Uplink down on ${p.host} port ${port}`,
      topic: 'Optics, SFP modules, fiber',
      priority: 'P1',
      location: { rack: p.rack, tor: true },
      fixtures: { sfp: { cage: p.cage } },
      brief: `Monitoring: uplink ${p.host} port ${port} → CORE-01 is down. Rack ${p.rack} is running on its last uplink, with no redundancy left.`,
      rackHint: `Look at the top-of-rack switch (U42): port ${port} is one of the four SFP cages on the right.`,
      init: () => ({ inspected: false, fixed: false, tried: [] }),
      physical: {
        inspect: {
          prompt: () => `Inspect ${p.host}`,
          run(st, ev) {
            st.inspected = true;
            ev.add('inspected');
            return L(`Port ${port}: no link light. Module label: ${module}. ${cause.clue}`);
          },
        },
        sfp: {
          prompt: (st, hand) => {
            if (st.fixed) return null;
            if (!st.inspected) return `Inspect port ${port}`;
            if (!hand) return `Reseat fiber in port ${port}`;
            if (hand.type === 'sfp') return `Swap SFP module (${hand.label})`;
            if (hand.type === 'cable') return `Replace fiber patch (${hand.label})`;
            return `Use ${hand.label} on port ${port}`;
          },
          run(st, ev, hand) {
            if (!st.inspected) {
              st.inspected = true;
              ev.add('inspected');
              return L(`Port ${port}: no link light. Module label: ${module}. ${cause.clue}\nCheapest fix first: reseat the fiber (empty hands), then try a new module or a new fiber patch from the shelf.`);
            }
            const part = hand.part;
            if (!part) {
              st.tried.push('reseat');
              if (cause.fix === 'reseat') return fixed(st, ev, 'You press the LC connector until the latch clicks.');
              return L('You unplug the LC connector, check it, and click it back in. Still no link light.', 'o-warn');
            }
            if (part.type === 'sfp') {
              const bad = checkPart(hand, wantSfp, L);
              if (bad) return bad;
              st.tried.push('sfp');
              if (cause.fix === 'sfp') {
                hand.use();
                return fixed(st, ev, `You unlatch the fiber, pull the old module (it is hot) and slide in the new ${module}.`);
              }
              return L('You swap in the new module. Still dark, so the old one was fine: you put it back and keep the spare.', 'o-warn');
            }
            if (part.type === 'cable') {
              const bad = checkPart(hand, wantFiber, L);
              if (bad) return bad;
              st.tried.push('fiber');
              if (cause.fix === 'fiber') {
                hand.use();
                return fixed(st, ev, 'You replace the kinked patch with the new OM4 fiber and route it with a gentle bend.');
              }
              return L('You try the new fiber patch. Still dark, so the old patch was fine: you put it back.', 'o-warn');
            }
            return checkPart(hand, wantSfp, L);
          },
        },
      },
      world: (st) => ({ sfpLink: st.fixed }),
      steps: [
        {
          title: 'Look at the port',
          body: `<p>Find port ${port} on the right of ${p.host} (top of rack ${p.rack}). Check the link light, the module label and the fiber.</p>`,
          done: (st) => st.inspected,
        },
        {
          title: 'Restore the link',
          body: '<p>Work from cheapest to most expensive: reseat the fiber, then swap the SFP (same speed!), then replace the fiber patch.</p>',
          done: (st) => st.fixed,
        },
      ],
      story: `Uplink port ${port} on ${p.host} had no link light. I checked the module (${module}) and the fiber, and found that ${cause.story}. After the fix the link light came on and the uplink to the core was back.`,
    };
  },
};
