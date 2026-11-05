import { L, NEED_ROOT, pingOut, parsePing } from './helpers.js';

// Ported from the original browser practice lab (INC-1046). Hostname, subnet, host address and
// which digit of the network part is mistyped are randomized per shift; commands,
// outputs and step logic are the lab's.

/** Change one digit of the 2nd or 3rd octet so the address lands in a different /24. */
function typo(r, net) {
  const oct = net.split('.');
  for (;;) {
    const i = r.pick([1, 2]);
    const s = oct[i];
    const pos = r.int(0, s.length - 1);
    const digit = String(r.int(0, 9));
    if (digit === s[pos] || (pos === 0 && digit === '0' && s.length > 1)) continue;
    const changed = s.slice(0, pos) + digit + s.slice(pos + 1);
    if (+changed > 255) continue;
    const out = [...oct];
    out[i] = changed;
    return out.join('.');
  }
}

const esc = (s) => s.replace(/\./g, '\\.');

export default {
  key: 'static-ip',
  kind: 'console',
  priority: 'P2',
  params: (r) => {
    const net = r.subnet();
    return { host: r.host('web'), net, wrongNet: typo(r, net), hostOct: r.octet(), mac: `52:54:00:${r.mac().slice(-8)}` };
  },
  build: (p) => {
    const right = `${p.net}.${p.hostOct}`;
    const wrong = `${p.wrongNet}.${p.hostOct}`;
    const gw = `${p.net}.1`;
    return {
      id: p.id, host: p.host, user: "tech", cwd: "~", name: `${p.host} can't reach its gateway`, topic: "Static IP, subnets, netplan",
      location: { rack: p.rack, u: p.u, size: 2 }, priority: "P2",
      help: "ip a, ip route, ping -c 3 <ip>, ls /etc/netplan, cat /etc/netplan/50-cloud-init.yaml, sudo sed -i 's/old/new/' <file>, sudo netplan apply|try, sudo ip addr add|del, sudo ip route add default via <gw>",
      brief: `${p.host} was moved to a new network yesterday and given a static IP. Since then it can't reach anything. The network plan says: subnet ${p.net}.0/24, gateway ${gw}, ${p.host} = ${right}.`,
      files: [],
      init: () => ({ ip: wrong, route: false, fixedFile: false }),
      exec(c, st, sudo, ev) {
        const inNet = () => st.ip.startsWith(`${p.net}.`);
        if (/^ip (a|addr)( show)?( eth0)?$/.test(c)) {
          ev.add("ipa");
          return L(`2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP\n    link/ether ${p.mac} brd ff:ff:ff:ff:ff:ff${st.ip ? `\n    inet ${st.ip}/24 brd ${st.ip.replace(/\.\d+$/, ".255")} scope global eth0` : ""}`);
        }
        if (/^ip (r|route)( show)?$/.test(c)) {
          ev.add("route");
          if (!st.ip) return L("(no routes)", "o-dim");
          const net = st.ip.replace(/\.\d+$/, ".0");
          return L((st.route && inNet() ? `default via ${gw} dev eth0 proto static\n` : "") + `${net}/24 dev eth0 proto kernel scope link src ${st.ip}`);
        }
        if (/^cat \/etc\/netplan\/50-cloud-init\.yaml$/.test(c) || /^cat \/etc\/netplan\/\*$/.test(c)) {
          ev.add("netplan");
          return L(`network:\n  version: 2\n  ethernets:\n    eth0:\n      dhcp4: false\n      addresses: [${st.fixedFile ? right : wrong}/24]\n      routes:\n        - to: default\n          via: ${gw}\n      nameservers:\n        addresses: [${p.net}.53]`);
        }
        if (/^ls \/etc\/netplan\/?$/.test(c)) return L("50-cloud-init.yaml");
        if (new RegExp(`^sed -i ['"]s/${esc(wrong)}/${esc(right)}/g?['"] /etc/netplan/50-cloud-init\\.yaml$`).test(c)) {
          if (!sudo) return L("sed: couldn't open temporary file /etc/netplan/sedXYZ: Permission denied", "o-err").concat(L("Files in /etc belong to root: put sudo in front.", "o-dim"));
          st.fixedFile = true; ev.add("edited"); return L("");
        }
        if (/^(nano|vi|vim) /.test(c)) return L(`Editors don't run in this lab. Use: sudo sed -i 's/${wrong}/${right}/' /etc/netplan/50-cloud-init.yaml`, "o-dim");
        if (/^netplan (apply|try)$/.test(c)) {
          if (!sudo) return NEED_ROOT("netplan apply");
          if (!st.fixedFile) return L(`(Applied, but the file still says ${wrong}, so nothing changed.)`, "o-dim");
          st.ip = right; st.route = true; ev.add("applied"); return L("");
        }
        const del = c.match(/^ip (addr|a) del (\S+)\/24 dev eth0$/);
        if (del) { if (!sudo) return L("RTNETLINK answers: Operation not permitted", "o-err"); if (del[2] !== st.ip) return L("RTNETLINK answers: Cannot assign requested address", "o-err"); st.ip = ""; st.route = false; return L(""); }
        const add = c.match(/^ip (addr|a) add (10\.\d+\.\d+\.\d+)\/24 dev eth0$/);
        if (add) { if (!sudo) return L("RTNETLINK answers: Operation not permitted", "o-err"); if (st.ip) return L("RTNETLINK answers: eth0 already has an address. Delete the old one first (temporary fixes stack up).", "o-warn"); st.ip = add[2]; ev.add("manual"); return L(""); }
        if (new RegExp(`^ip route add default via ${esc(gw)}( dev eth0)?$`).test(c)) {
          if (!sudo) return L("RTNETLINK answers: Operation not permitted", "o-err");
          if (!inNet()) return L("Error: Nexthop has invalid gateway.", "o-err").concat(L(`Linux refuses: ${gw} isn't on any network this server is connected to.`, "o-dim"));
          st.route = true; return L("");
        }
        const ping = parsePing(c);
        if (ping) {
          const t = ping.target;
          if (!st.ip) return L("ping: connect: Network is unreachable", "o-err");
          if (t === gw) { if (!inNet()) { ev.add("gwFail"); return L("ping: connect: Network is unreachable", "o-err"); } ev.add("pingGw"); return pingOut(t, t, true, ping.count, ping.note); }
          if (["8.8.8.8", "1.1.1.1"].includes(t)) { if (!(inNet() && st.route)) return L("ping: connect: Network is unreachable", "o-err"); ev.add("pingNet"); return pingOut(t, t, true, ping.count, ping.note); }
          return L(`ping: ${t}: lab only simulates ${gw} and 8.8.8.8 here`, "o-dim");
        }
        return null;
      },
      steps: [
        {
          title: "Look at the address and the routes",
          body: "<p>Compare what the server <i>has</i> with what the network plan says it <i>should</i> have. <code>ip a</code> shows the address, <code>ip route</code> shows where traffic goes.</p>",
          try: ["ip a", "ip route"], done: (st, ev) => ev.has("ipa") && ev.has("route"),
          learned: `<p>The server has <code>${wrong}/24</code>, and there's <b>no default route</b>. The plan said <code>${right}</code>. One digit off.</p>`
        },
        {
          title: "Why one digit breaks everything",
          body: "<p>Try the gateway.</p>",
          try: [`ping -c 3 ${gw}`], done: (st, ev) => ev.has("gwFail"),
          learned: `<p><b>Network is unreachable</b>, not even a timeout. Here's the subnet maths: <code>/24</code> means the first <b>three</b> numbers are the network. The server thinks it lives on <b>${p.wrongNet}</b>.x, the gateway lives on <b>${p.net}</b>.x. To the server, the gateway is on a different network, and to reach a different network you need... the gateway. So it can't even try.</p>`
        },
        {
          title: "Find where the wrong value comes from",
          body: "<p>On Ubuntu servers, static network settings live in <b>netplan</b> files in <code>/etc/netplan/</code>. If you only fix the live address with <code>ip addr</code>, it's back to wrong after the next reboot.</p>",
          try: ["ls /etc/netplan", "cat /etc/netplan/50-cloud-init.yaml"], done: (st, ev) => ev.has("netplan"),
          learned: `<p>There's the typo: <code>addresses: [${wrong}/24]</code>, while the gateway in the same file is <code>${gw}</code>.</p>`
        },
        {
          title: "Fix the file and apply it",
          body: "<p><code>sed -i 's/old/new/'</code> replaces text inside a file. <code>netplan apply</code> loads the new config. On a remote server you'd use <code>netplan try</code>, which rolls back automatically if you lock yourself out.</p>",
          try: [`sudo sed -i 's/${wrong}/${right}/' /etc/netplan/50-cloud-init.yaml`, "sudo netplan apply"], done: (st) => st.fixedFile && st.ip === right && st.route,
          learned: "<p>Fixed at the source, so it survives a reboot.</p>"
        },
        {
          title: "Verify from near to far",
          body: "<p>Same order as always: address, gateway, internet.</p>",
          try: ["ip a", `ping -c 3 ${gw}`, "ping -c 3 8.8.8.8"], done: (st, ev) => ev.has("pingGw") && ev.has("pingNet"),
          learned: "<p>Everything answers. The general lesson: when something breaks right after a change, start by checking what was changed.</p>"
        }
      ],
      story: `After a network move, ${p.host} couldn't reach anything. ip a showed ${wrong}/24, but the gateway was ${gw}, so with a /24 mask the server thought the gateway was on another network. I found the typo in the netplan config, fixed it there so it would survive a reboot, applied it, and verified the gateway and internet were reachable.`
    };
  },
};
