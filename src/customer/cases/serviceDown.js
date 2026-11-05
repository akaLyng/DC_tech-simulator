// Cascade-only case: a server-room alarm was left too long and customers start calling.
// The single cause is "ours" and is linked to the escalated ticket at runtime.
export default {
  key: 'service-down',
  cascadeOnly: true,
  symptom: 'Our hosted service is down',
  priority: 'P1',
  opening: (c) => `${c.name}, ${c.company}. Our service hosted with you has stopped working and our own customers are calling us. What is going on?`,
  questions: {
    since: 'When did it stop working?',
    error: 'What do you see when you try?',
    everyone: 'Is it all your users, or just some?',
    changed: 'Did you change anything on your side?',
  },
  answers: {
    since: 'A while ago now. It has been getting worse.',
    error: "It just times out. Nothing at all.",
    everyone: 'Everyone. All our users.',
    changed: 'No, nothing. It is your side, surely?',
  },
  advice: {
    restartPc: 'Please restart your computer and try again.',
  },
  causes: {
    linked: {
      side: 'ours',
      link: { existing: true, impact: 'Customer impact: hosted service down, customers calling.' },
      replies: { restartPc: 'Of course I tried that. It is not my computer!' },
      worked: 'It is back. Please make sure this does not happen again.',
      diag: { server: 'down' },
      story: (c) => ({ cause: `A server-room alarm was left unattended and took ${c.company}'s hosted service down.`, action: 'Fixed the escalated server-room ticket.', verified: 'Service reachable again; customer confirmed on a call-back.' }),
    },
  },
};
