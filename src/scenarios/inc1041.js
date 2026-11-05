import { L, NEED_ROOT, pingOut, parsePing } from './helpers.js';

// Ported from the original browser practice lab (INC-1041). Hostname, addresses and rack are
// randomized per shift; commands, outputs and step logic are the lab's.
export default {
  key: 'link-dhcp',
  kind: 'console',
  priority: 'P2',
  params: (r) => {
    const net = r.subnet();
    return { host: r.host('web'), net, ip: `${net}.${r.octet()}`, dhcp: `${net}.${r.int(2, 9)}`, ll: `169.254.${r.int(1, 254)}.${r.int(1, 254)}`, mac: r.mac() };
  },
  build: (p) => ({
    id: p.id, host: p.host, user: "tech", cwd: "~", name: `${p.host} is offline`, topic: "Link, DHCP, 169.254",
    location: { rack: p.rack, u: p.u, size: 2 }, priority: "P2", fixtures: { cable: true },
    help: "ip a, ip link, ip route, sudo dhclient -v eth0, ping -c 3 <host>",
    brief: `Monitoring says ${p.host} stopped answering after someone worked in rack ${p.rack} last night. Find out why and bring it back online.`,
    files: [],
    init: () => ({ link: false, lease: false }),
    // Physical jobs: done in the world (press E at the rack), not typed in the console.
    physical: {
      cable: {
        matches: (c) => /^reseat( |-)?cable$/.test(c) || c === "reseat",
        target: "the loose patch cable",
        prompt: (st) => (st.link ? null : "Reseat patch cable"),
        run(st, ev) {
          st.link = true; ev.add("reseated");
          return L(`[lab] You walk to rack ${p.rack}. The port LED for ${p.host} on the switch is dark.\n[lab] The patch cable is half out of the server's NIC. You push it in until it clicks.\n[lab] Switch port LED: green. Server NIC LED: green, blinking.`, "o-lab");
        },
      },
    },
    world: (st) => ({ cableSeated: st.link }),
    exec(c, st, sudo, ev) {
      if (/^ip (a|addr)( show)?( eth0)?$/.test(c)) {
        const lo = "1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN\n    inet 127.0.0.1/8 scope host lo\n";
        if (!st.link) { ev.add("sawDown"); return L(lo + `2: eth0: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 state DOWN\n    link/ether ${p.mac} brd ff:ff:ff:ff:ff:ff`); }
        if (!st.lease) { ev.add("saw169"); return L(lo + `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    link/ether ${p.mac} brd ff:ff:ff:ff:ff:ff\n    inet ${p.ll}/16 brd 169.254.255.255 scope link eth0`); }
        ev.add("sawLease"); return L(lo + `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    link/ether ${p.mac} brd ff:ff:ff:ff:ff:ff\n    inet ${p.ip}/24 brd ${p.net}.255 scope global dynamic eth0\n       valid_lft 86394sec preferred_lft 86394sec`);
      }
      if (/^ip link( show)?( eth0)?$/.test(c)) {
        ev.add(st.link ? "linkUp" : "sawDown");
        return L("1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN\n2: eth0: " + (st.link ? "<BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP" : "<NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 state DOWN"));
      }
      if (/^dhclient( -v)?( eth0)?$/.test(c)) {
        if (!sudo) return NEED_ROOT("dhclient");
        if (!st.link) return L("eth0: no link (NO-CARRIER). DHCP can't reach anyone without a cable.", "o-err");
        st.lease = true; ev.add("dhcp");
        return L(`Listening on LPF/eth0/${p.mac}\nDHCPDISCOVER on eth0 to 255.255.255.255 port 67 interval 3\nDHCPOFFER of ${p.ip} from ${p.dhcp}\nDHCPREQUEST for ${p.ip} on eth0 to 255.255.255.255 port 67\nDHCPACK of ${p.ip} from ${p.dhcp}\nbound to ${p.ip} -- renewal in 43200 seconds.`);
      }
      if (/^ip (r|route)( show)?$/.test(c)) {
        ev.add("route");
        if (!st.link) return L("(no routes: eth0 is down)", "o-dim");
        if (!st.lease) return L("169.254.0.0/16 dev eth0 scope link\n(no default route: nothing tells the server where the gateway is)");
        return L(`default via ${p.net}.1 dev eth0 proto dhcp\n${p.net}.0/24 dev eth0 proto kernel scope link src ${p.ip}`);
      }
      const ping = parsePing(c);
      if (ping) {
        const map = { [`${p.net}.1`]: `${p.net}.1`, "8.8.8.8": "8.8.8.8", "1.1.1.1": "1.1.1.1", "google.com": "142.250.74.46", [p.dhcp]: p.dhcp };
        const ip = map[ping.target];
        if (!ip) return L(`ping: ${ping.target}: Name or service not known`, "o-err");
        if (!st.link || !st.lease) return L("ping: connect: Network is unreachable", "o-err").concat(L(st.link ? "(A 169.254 address has no gateway, so nothing outside the cable is reachable.)" : "(No carrier on eth0.)", "o-dim"));
        if (ping.target === `${p.net}.1`) ev.add("pingGw");
        if (ping.target === "8.8.8.8" || ping.target === "1.1.1.1" || ping.target === "google.com") ev.add("pingNet");
        return pingOut(ping.target, ip, true, ping.count, ping.note);
      }
      return null;
    },
    steps: [
      {
        title: "Start at the bottom: is there a link?",
        body: "<p>Troubleshoot from the bottom up: cable first, then IP, then gateway, then DNS. Fixing DNS on a server with no cable is wasted time.</p><p><code>ip a</code> lists every network interface with its state and IP address. On real servers the main one is often <code>eth0</code>.</p>",
        try: ["ip a"], done: (st, ev) => ev.has("sawDown"),
        learned: "<p><code>eth0</code> says <b>state DOWN</b> and <b>NO-CARRIER</b>. Carrier is the electrical signal on the cable. No carrier means a layer 1 problem: unplugged or damaged cable, or a dead switch port. Everything higher up is pointless until this is fixed.</p>"
      },
      {
        title: "Fix layer 1, then look again",
        body: `<p>In a real data center you walk to the rack, check the port LEDs on the switch and the server, and reseat or swap the cable.</p><p>Here you do it for real: close the console (<kbd>Esc</kbd>), walk to rack <b>${p.rack}</b>, look at ${p.host} (U${p.u}) and press <kbd>E</kbd> on the loose patch cable. Then reopen the console and run <code>ip a</code> again to see what changed.</p>`,
        physical: "cable",
        try: ["reseat cable", "ip a"], done: (st, ev) => ev.has("reseated") && ev.has("saw169"),
        learned: `<p>The link is <b>UP</b> now, but look at the address: <code>${p.ll}/16</code>.</p><p>That's a link-local fallback. While the cable was out, the server kept asking for an address, got no answer, and gave itself one from the 169.254 range. Whenever you see 169.254, read it as <b>"never heard back from a DHCP server"</b>. These addresses have no gateway, so they can't reach anything outside the local cable.</p>`
      },
      {
        title: "Ask DHCP for a proper address",
        body: "<p>DHCP hands out IP address, subnet, gateway and DNS. It happens in four messages, known as <b>DORA</b>: Discover, Offer, Request, Acknowledge.</p><p><code>dhclient</code> asks for a new lease. <code>-v</code> (verbose) prints the conversation, and <code>sudo</code> is needed because it changes network settings.</p>",
        try: ["sudo dhclient -v eth0", "ip a"], done: (st) => st.lease,
        learned: `<p>You just watched DORA happen line by line: <b>DHCPDISCOVER</b> → <b>DHCPOFFER</b> from ${p.dhcp} → <b>DHCPREQUEST</b> → <b>DHCPACK</b>. The server now has <code>${p.ip}/24</code>.</p><p><code>/24</code> means the first 24 bits are the network, so every address from ${p.net}.1 to ${p.net}.254 is a neighbour.</p>`
      },
      {
        title: "Prove it, from near to far",
        body: "<p>Test in the same order the traffic travels. <code>ip route</code> shows the <b>default gateway</b> (the router). Ping the gateway first, then something on the internet by IP.</p>",
        try: ["ip route", `ping -c 3 ${p.net}.1`, "ping -c 3 8.8.8.8"], done: (st, ev) => ev.has("pingGw") && ev.has("pingNet"),
        learned: "<p>The gateway answers and so does the internet. If the gateway had answered but 8.8.8.8 had not, the problem would be in routing or a firewall beyond the server, not on it.</p>"
      }
    ],
    story: `${p.host} showed NO-CARRIER on eth0, so I went to the rack and found the patch cable half out. After reseating it the link came up, but the server had a 169.254 address because it had given up on DHCP. I renewed the lease, confirmed the gateway and the internet answered, and closed the ticket.`
  }),
};
