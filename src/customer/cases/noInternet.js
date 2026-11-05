// Customer case: "no internet at the office". Answers and advice can be strings or
// functions of the customer `c`. A cause's `diag` overrides what the laptop sees
// (defaults in ../index.js: everything healthy).
export default {
  key: 'no-internet',
  symptom: 'No internet at the office',
  priority: 'P2',
  opening: (c) => `Hi, this is ${c.name} at ${c.company}. We have no internet at all at the office. Nothing loads!`,
  questions: {
    lights: 'Are there any lights on your router?',
    who: 'Is it the whole office, or just some people?',
    wifi: 'Which network are your devices connected to?',
    cable: 'Do computers plugged in with a cable work?',
  },
  answers: {
    lights: 'Yes, the lights are on. Power is green, and the internet one too, I think.',
    who: 'Everyone. The whole office is down.',
    wifi: (c) => `"${c.company} Office", like always.`,
    cable: "No, the ones with cables don't work either.",
  },
  advice: {
    power: 'Please check the router has power: is it plugged in and switched on?',
    wifi: (c) => `Please connect to "${c.company} Office" instead of the guest network.`,
    reboot: 'Please unplug the router for ten seconds and plug it back in.',
  },
  causes: {
    unplugged: {
      side: 'customer',
      fix: { advice: 'power' },
      answers: {
        lights: "Hm... no. It's completely dark, actually. No lights at all.",
        cable: 'No, nothing works at all.',
      },
      replies: { reboot: "I unplugged it and plugged it in... still dark. Is that bad?" },
      worked: 'Oh! The plug had come out of the wall. Lights are coming on... and we are online! Thank you!',
      diag: { line: 'down', cpe: 'offline' },
      story: (c) => ({ cause: `${c.company}'s router had no power (plug out of the wall).`, action: 'Talked the customer through checking the power; they plugged the router back in.', verified: 'Customer confirmed lights and internet are back.' }),
    },
    guestWifi: {
      side: 'customer',
      fix: { advice: 'wifi' },
      answers: {
        who: "Actually... just me, I think. The others seem fine.",
        wifi: (c) => `"${c.company} Guest". Is that wrong?`,
        cable: "I don't have a cable, I'm on Wi-Fi.",
      },
      replies: { reboot: "Do I have to? The others are working, I don't want to cut them off." },
      worked: "There! I'm on the office network now and everything loads. Sorry for the trouble!",
      diag: { lan: 'guest' },
      story: (c) => ({ cause: `One user at ${c.company} was on the isolated guest Wi-Fi.`, action: 'Asked them to switch to the office network.', verified: 'Customer confirmed pages load on the office network.' }),
    },
    cpeHung: {
      side: 'customer',
      fix: { remote: 'restart-cpe' },
      answers: {
        lights: "They're on, but the internet light is blinking orange.",
        cable: 'No, nothing works.',
      },
      replies: { reboot: { text: "I can't, the router is in a locked cabinet and the key is with our manager. Can you do anything from your side?", ok: true } },
      worked: 'Yes! Everything came back a minute ago. Thanks!',
      diag: { cpe: 'hung' },
      story: (c) => ({ cause: `${c.company}'s router (CPE) had hung: online, but passing no traffic.`, action: 'Restarted the CPE remotely with Restart-CustomerCpe.', verified: 'CPE back online with traffic; customer confirmed.' }),
    },
    dhcp: {
      side: 'ours',
      link: { template: 'link-dhcp', hostPrefix: 'dhcp', impact: 'Customer impact: business customers get no DHCP lease (no internet).' },
      answers: {
        cable: "No. The computers say 'No internet' and show some strange address starting with 169.",
      },
      replies: { reboot: "Done. Lights came back, but still no internet." },
      worked: 'Yes, everything works again. Thanks for calling back!',
      diag: { lease: 'none' },
      story: (c) => ({ cause: `Our DHCP server was offline, so ${c.company}'s router got no lease.`, action: 'Escalated to the data hall; the DHCP server was fixed there.', verified: 'Lease active again in Get-DhcpLease; customer confirmed on a call-back.' }),
    },
  },
};
