import { L } from './helpers.js';

// Ported from the original browser practice lab (INC-1047). Hostname, address and PIDs are
// randomized per shift; commands, outputs and step logic are the lab's.
export default {
  key: 'firewall',
  kind: 'console',
  priority: 'P2',
  params: (r) => ({ host: r.host('www'), ip: `${r.subnet()}.${r.octet()}`, nginxPid: r.int(600, 1400), sshdPid: r.int(500, 900) }),
  build: (p) => ({
    id: p.id, host: p.host, user: "tech", cwd: "~", name: "Website down for users", topic: "Firewall, ports, ufw",
    location: { rack: p.rack, u: p.u, size: 2 }, priority: "P2",
    // console events that count as mistakes in the shift summary
    mistakes: { disabled: "Disabled the whole firewall (ufw disable)" },
    help: "systemctl status nginx, curl -I localhost, client curl, sudo ss -tlnp, sudo ufw status verbose, sudo ufw allow 80/tcp, sudo ufw enable|disable",
    brief: `Users say the new intranet site on ${p.host} (${p.ip}) doesn't load. The developer says it works fine when they test it on the server.`,
    files: [],
    init: () => ({ allowed: false, active: true }),
    exec(c, st, sudo, ev) {
      const open = () => st.allowed || !st.active;
      if (/^systemctl status nginx(\.service)?$/.test(c)) { ev.add("nginx"); return L(`● nginx.service - A high performance web server\n     Active: active (running) since Mon 14:02:11 UTC; 19h ago\n   Main PID: ${p.nginxPid} (nginx)`, "o-ok"); }
      const curl = c.match(new RegExp(`^curl( -s| -I| -sI)? (?:http:\\/\\/)?(localhost|127\\.0\\.0\\.1|${p.ip.replace(/\./g, "\\.")})(:80)?\\/?$`));
      if (curl) { ev.add("curlLocal"); return L("HTTP/1.1 200 OK\nServer: nginx/1.24.0\nContent-Type: text/html\n(Works here because you're on the server itself: local traffic never passes the firewall's incoming rules.)"); }
      if (/^client( |-)?curl$/.test(c) || /^test( from)? client$/.test(c)) {
        ev.add("client");
        if (open()) { ev.add("clientOk"); return L(`[lab] From a user's laptop: curl -I http://${p.ip}\nHTTP/1.1 200 OK\nServer: nginx/1.24.0`, "o-lab"); }
        return L(`[lab] From a user's laptop: curl -I http://${p.ip}\ncurl: (28) Failed to connect to ${p.ip} port 80 after 21004 ms: Connection timed out`, "o-lab");
      }
      if (/^ss -tl(n)?p?n?$/.test(c) || /^ss -tulpn$/.test(c) || /^ss -tlnp$/.test(c)) {
        ev.add("ss");
        const pr = (s) => (sudo ? s : "");
        return L("State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process\nLISTEN 0      511          0.0.0.0:80        0.0.0.0:*     " + pr(`users:(("nginx",pid=${p.nginxPid},fd=6))`) + "\nLISTEN 0      4096         0.0.0.0:22        0.0.0.0:*     " + pr(`users:(("sshd",pid=${p.sshdPid},fd=3))`));
      }
      if (/^ufw status( verbose| numbered)?$/.test(c)) {
        if (!sudo) return L("ERROR: You need to be root to run this script", "o-err");
        ev.add("ufw");
        if (!st.active) return L("Status: inactive", "o-warn");
        return L("Status: active\nDefault: deny (incoming), allow (outgoing)\n\nTo                         Action      From\n--                         ------      ----\n22/tcp                     ALLOW IN    Anywhere" + (st.allowed ? "\n80/tcp                     ALLOW IN    Anywhere" : ""));
      }
      if (/^ufw allow (80(\/tcp)?|http|'?Nginx HTTP'?)$/.test(c)) {
        if (!sudo) return L("ERROR: You need to be root to run this script", "o-err");
        st.allowed = true; ev.add("allowed"); return L("Rule added\nRule added (v6)");
      }
      if (/^ufw allow /.test(c)) { if (!sudo) return L("ERROR: You need to be root to run this script", "o-err"); return L("Rule added (lab note: the site only needs port 80 here. Every extra open port is extra attack surface.)", "o-dim"); }
      if (/^ufw disable$/.test(c)) {
        if (!sudo) return L("ERROR: You need to be root to run this script", "o-err");
        st.active = false; ev.add("disabled");
        return L("Firewall stopped and disabled on system startup").concat(L("This makes the site work, but now EVERY port on the server is open to the network. It solves the ticket by creating a security hole. Turn it back on with sudo ufw enable and open only port 80.", "o-warn"));
      }
      if (/^ufw enable$/.test(c)) { if (!sudo) return L("ERROR: You need to be root to run this script", "o-err"); st.active = true; return L("Firewall is active and enabled on system startup"); }
      return null;
    },
    steps: [
      {
        title: "Is the service itself fine?",
        body: "<p>Split the problem: is the <i>application</i> broken, or is something <i>between</i> it and the users? Test the service on the server first.</p>",
        try: ["systemctl status nginx", "curl -I localhost"], done: (st, ev) => ev.has("nginx") && ev.has("curlLocal"),
        learned: "<p>nginx is running and answers <b>200 OK</b> locally. That's why the developer says \"it works\". The problem is between the server and the users.</p>"
      },
      {
        title: "Test from where the user is",
        body: "<p>Always reproduce the problem from the user's side. <code>client curl</code> runs the request from a user's laptop.</p>",
        try: ["client curl"], done: (st, ev) => ev.has("client"),
        learned: "<p><b>Connection timed out</b>. Learn this difference, you will see both all the time:</p><p><b>Timed out</b> = packets vanish without an answer, typically a firewall silently dropping them.<br><b>Connection refused</b> = the machine answered \"nothing listens on that port\", so the service is down or bound to the wrong address.</p>"
      },
      {
        title: "Is nginx listening on the network?",
        body: "<p>If nginx only listened on 127.0.0.1, users couldn't reach it either. Check with <code>ss</code>.</p>",
        try: ["sudo ss -tlnp"], done: (st, ev) => ev.has("ss"),
        learned: "<p>nginx listens on <code>0.0.0.0:80</code>, meaning all interfaces. So it's not a binding problem. That leaves the firewall.</p>"
      },
      {
        title: "Read the firewall rules",
        body: "<p>Ubuntu's firewall front-end is <b>ufw</b> (uncomplicated firewall).</p>",
        try: ["sudo ufw status verbose"], done: (st, ev) => ev.has("ufw"),
        learned: "<p>Default policy is <b>deny incoming</b>, and only <code>22/tcp</code> (SSH) is allowed. Port 80 was never opened when the site was set up.</p>"
      },
      {
        title: "Open only what's needed",
        body: "<p>The tempting fix is <code>ufw disable</code>. Don't: it opens <i>every</i> port. Add one rule for the one port the site needs.</p>",
        try: ["sudo ufw allow 80/tcp", "sudo ufw status"], done: (st) => st.allowed && st.active,
        learned: "<p>Port 80 is allowed, everything else is still blocked. Least privilege: open exactly what's needed and nothing more.</p>"
      },
      {
        title: "Verify from the user's side",
        body: "<p>Re-run the test that failed.</p>",
        try: ["client curl"], done: (st, ev) => ev.has("clientOk") && st.active,
        learned: "<p><b>200 OK</b> from the user's laptop. Ticket solved, with the firewall still protecting everything else.</p>"
      }
    ],
    story: "The site worked on the server but timed out for users. A timeout rather than 'connection refused' pointed to a firewall dropping traffic. ss showed nginx listening on all interfaces, and ufw only allowed SSH. Instead of disabling the firewall, I opened only port 80 and verified from a client machine."
  }),
};
