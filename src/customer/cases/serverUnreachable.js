// Customer case: "can't reach our server" (their server is hosted in our data hall).
export default {
  key: 'server-unreachable',
  symptom: "Can't reach our server",
  priority: 'P2',
  opening: (c) => `Hi, ${c.name}, ${c.company}. We can't get into our server. It just times out.`,
  questions: {
    how: 'How are you connecting to the server?',
    from: 'Does it work from anywhere else, like from home?',
    changed: 'Has anything changed recently on your side?',
    error: 'What error do you get?',
  },
  answers: {
    how: (c) => `${c.rdpPort === 22 ? 'SSH' : 'Remote Desktop'} to ${c.serverName}, like always.`,
    from: "No, not from home either.",
    changed: 'Not that I know of.',
    error: (c) => (c.rdpPort === 22 ? "'Connection timed out'." : "'Remote Desktop can't connect to the remote computer.' It times out."),
  },
  advice: {
    fw: (c) => `Ask your IT to allow outbound ${c.rdpPort === 22 ? 'SSH (TCP 22)' : 'Remote Desktop (TCP 3389)'} in your office firewall.`,
    hostname: (c) => `The server moved: connect to ${c.serverName} instead of the old IP address.`,
    restartPc: 'Please restart your computer and try again.',
  },
  causes: {
    customerFw: {
      side: 'customer',
      fix: { advice: 'fw' },
      answers: {
        from: 'Yes! It works from home. Weird.',
        changed: 'IT put in a new firewall at the office on Monday.',
      },
      replies: { restartPc: 'Did that, no change.' },
      worked: 'IT opened the port and I am in. Thanks for pointing us the right way!',
      diag: { customerFw: true },
      story: (c) => ({ cause: `${c.company}'s new office firewall blocked outbound port ${c.rdpPort}.`, action: 'Advised the customer to allow the port in their firewall.', verified: `Port ${c.rdpPort} reachable from our side throughout; customer can connect after their change.` }),
    },
    oldAddress: {
      side: 'customer',
      fix: { advice: 'hostname' },
      answers: {
        how: (c) => `${c.rdpPort === 22 ? 'SSH' : 'Remote Desktop'} to ${c.oldServerIp}. I have it saved.`,
        changed: 'Hmm... you sent us an email about a server move last week?',
      },
      replies: { restartPc: 'Still nothing.' },
      worked: "Using the name works! I'll update my saved connection.",
      diag: { serverMoved: true },
      story: (c) => ({ cause: `The customer was connecting to the old address ${c.oldServerIp}; the server moved to ${c.serverIp}.`, action: `Told them to use ${c.serverName}, which resolves to the new address.`, verified: 'Customer connected using the hostname.' }),
    },
    sfp: {
      side: 'ours',
      link: { template: 'sfp-fault', impact: 'Customer impact: hosted servers in this rack unreachable.' },
      answers: {
        changed: 'Nothing on our side. Our customers cannot reach our app either.',
      },
      replies: { restartPc: 'No difference.' },
      worked: "We're in, and our app is reachable again. Thanks!",
      diag: { server: 'uplink-down' },
      story: (c) => ({ cause: `The uplink of the switch in front of ${c.company}'s server was down (SFP/fiber).`, action: 'Escalated to the data hall; the uplink was restored there.', verified: `Test-NetConnection ${c.serverName} -Port ${c.rdpPort} succeeds; customer confirmed.` }),
    },
  },
};
