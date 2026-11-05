// Customer case: "our website won't load" (their site is hosted with us).
export default {
  key: 'website-down',
  symptom: "Website won't load",
  priority: 'P2',
  opening: (c) => `Hello, ${c.name} from ${c.company} here. Our website, ${c.site}, won't load. It's really slow, then nothing.`,
  questions: {
    where: 'Does it fail everywhere, or only from your office?',
    error: 'What does the browser say, exactly?',
    other: 'Do other websites work?',
    since: 'When did it start?',
  },
  answers: {
    where: 'Everywhere, I think. Customers are complaining too.',
    error: "It loads and loads, then says the page took too long to respond.",
    other: 'Yes, other sites are fine.',
    since: 'This morning.',
  },
  advice: {
    filter: "Your router's web filter is blocking your own site. Turn off the 'Business' category, or add your domain as an exception.",
    cache: 'Please clear your browser cache and try again.',
  },
  causes: {
    webFilter: {
      side: 'customer',
      fix: { advice: 'filter' },
      answers: {
        where: 'Hm, my colleague at home says it works for her. So just from here?',
        error: "A page from our own router: 'Blocked by web filter: Business'.",
        since: 'Since this morning. We changed some router settings yesterday, actually.',
      },
      replies: { cache: 'Done. Same blocked page.' },
      worked: "That was it! It loads now. I didn't know the filter could block our own site.",
      diag: { webFilter: true },
      story: (c) => ({ cause: `${c.company}'s own router web filter blocked their site (category 'Business').`, action: 'Customer added an exception for their domain in the web filter.', verified: 'Site loads from the office; reachable from our side throughout.' }),
    },
    dns: {
      side: 'ours',
      link: { template: 'dns', hostPrefix: 'dns', impact: 'Customer impact: our resolver cannot resolve names; hosted sites look down.' },
      answers: {
        error: "'Server not found'. Something with DNS?",
        other: 'No, actually nothing loads by name. Our IP phones still work, though.',
        since: 'About an hour ago.',
      },
      replies: { cache: 'Tried that. Still "server not found".' },
      worked: 'Yes, the site loads again, and the other sites too. Thanks!',
      diag: { resolver: 'fail' },
      story: (c) => ({ cause: 'Our DNS resolver could not resolve names (wrong upstream DNS config).', action: 'Escalated to the data hall; the resolver config was fixed there.', verified: `Resolve-DnsName ${c.site} answers again; customer confirmed the site loads.` }),
    },
    firewall: {
      side: 'ours',
      link: { template: 'firewall', impact: 'Customer impact: hosted website unreachable for everyone.' },
      answers: {
        since: 'Since your maintenance last night, I think.',
      },
      replies: { cache: "Did that. It's not just me, our customers see it too." },
      worked: "It's back! Loads instantly. Thank you.",
      diag: { web: 'blocked' },
      story: (c) => ({ cause: `The firewall on the web server hosting ${c.site} was blocking port 80.`, action: 'Escalated to the data hall; port 80 was opened in the server firewall.', verified: `Test-NetConnection ${c.site} -Port 80 succeeds; customer confirmed.` }),
    },
  },
};
