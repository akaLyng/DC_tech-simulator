import { L } from './helpers.js';

// Ported from the original browser practice lab (INC-1044). Hostname, the clashing port and the
// squatter's PID are randomized per shift; commands, outputs and step logic are the lab's.
export default {
  key: 'docker-port',
  kind: 'console',
  priority: 'P3',
  params: (r) => {
    const port = r.pick([8080, 8000, 3000, 5000, 8888]);
    return { host: r.host('tools'), port: String(port), alt: String(port + 1), pid: String(r.pid()) };
  },
  build: (p) => ({
    id: p.id, host: p.host, user: "tech", cwd: "~/dashboard", name: "Dashboard won't start", topic: "Docker, ports, exposure",
    location: { rack: p.rack, u: p.u, size: 1 }, priority: "P3",
    help: "docker ps [-a], docker logs <name>, sudo ss -tulpn [| grep X], cat docker-compose.yml, sed -i 's/old/new/' <file>, kill <pid>, docker compose up -d, curl -I localhost:<port>",
    brief: `The team's status dashboard on ${p.host} stopped working after a reboot. The container exits a few seconds after it starts.`,
    files: ["docker-compose.yml", "README.md"],
    init: () => ({ map: `${p.port}:80`, squatter: true, up: false }),
    exec(c, st, sudo, ev) {
      const hostPort = () => { const m = st.map.match(/(\d+):80$/); return m ? m[1] : p.port; };
      const bindIp = () => (st.map.split(":").length === 3 ? st.map.split(":")[0] : "0.0.0.0");
      const conflict = () => st.squatter && hostPort() === p.port;
      if (/^docker ps$/.test(c)) {
        ev.add("ps"); if (st.up) ev.add("psUp");
        if (!st.up) return L("CONTAINER ID   IMAGE   COMMAND   CREATED   STATUS   PORTS   NAMES\n(nothing running)");
        return L(`CONTAINER ID   IMAGE                 STATUS         PORTS                    NAMES\n4be1c0d9a2f1   nginx:1.27-alpine     Up 5 seconds   ${bindIp()}:${hostPort()}->80/tcp   dashboard`, "o-ok");
      }
      if (/^docker ps -a$/.test(c)) {
        ev.add("psa");
        return L("CONTAINER ID   IMAGE                 STATUS                      NAMES\n4be1c0d9a2f1   nginx:1.27-alpine     " + (st.up ? "Up 5 seconds                dashboard" : "Exited (1) 2 minutes ago    dashboard"), st.up ? "o-ok" : "");
      }
      if (/^docker (logs dashboard|compose logs( dashboard)?|-compose logs)$/.test(c) || /^docker-compose logs$/.test(c)) {
        ev.add("logs");
        if (st.up) return L("dashboard  | /docker-entrypoint.sh: Configuration complete; ready for start up");
        return L(`dashboard  | Error response from daemon: driver failed programming external connectivity on endpoint dashboard:\ndashboard  | Error starting userland proxy: listen tcp4 0.0.0.0:${p.port}: bind: address already in use`, "o-err");
      }
      if (/^ss -tulpn$/.test(c) || /^ss -tlnp$/.test(c) || /^ss -tuln$/.test(c) || /^netstat -tulpn$/.test(c)) {
        ev.add("ss"); if (sudo) ev.add("ssProc");
        const proc = (s) => (sudo ? s : "");
        let rows = "Netid State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process\ntcp   LISTEN 0      4096       0.0.0.0:22         0.0.0.0:*     " + proc('users:(("sshd",pid=812,fd=3))') + "\n";
        if (st.squatter) rows += `tcp   LISTEN 0      5          0.0.0.0:${p.port}       0.0.0.0:*     ` + proc(`users:(("python3",pid=${p.pid},fd=3))`) + "\n";
        if (st.up) rows += `tcp   LISTEN 0      4096   ${bindIp()}:${hostPort()}       0.0.0.0:*     ` + proc('users:(("docker-proxy",pid=4420,fd=4))') + "\n";
        rows += "udp   UNCONN 0      0          0.0.0.0:5353       0.0.0.0:*     " + proc('users:(("avahi-daemon",pid=640,fd=12))');
        const out = L(rows);
        if (!sudo) out.push({ t: "(No process names: you need sudo to see which program owns each port.)", c: "o-dim" });
        return out;
      }
      if (/^cat docker-compose\.ya?ml$/.test(c)) {
        ev.add("compose");
        return L(`services:\n  dashboard:\n    image: nginx:1.27-alpine\n    container_name: dashboard\n    ports:\n      - "${st.map}"\n    volumes:\n      - ./site:/usr/share/nginx/html:ro\n    restart: unless-stopped`);
      }
      if (/^cat README\.md$/.test(c)) return L("# Status dashboard\nStatic site served by nginx. Port is set in docker-compose.yml.");
      const sed = c.match(new RegExp(`^sed -i ['"]s/${p.port}:80/([0-9.:]+)/g?['"] docker-compose\\.ya?ml$`));
      if (sed) {
        if (!/^((\d{1,3}\.){3}\d{1,3}:)?\d{2,5}:80$/.test(sed[1])) return L(`That replacement doesn't look like host:container or ip:host:container. Try 127.0.0.1:${p.alt}:80`, "o-warn");
        st.map = sed[1]; ev.add("edited"); return L("");
      }
      if (/^(nano|vi|vim) docker-compose/.test(c)) return L(`Editors don't run in this lab. Use sed: sed -i 's/${p.port}:80/127.0.0.1:${p.alt}:80/' docker-compose.yml`, "o-dim");
      const kill = c.match(/^kill( -9| -15)? (\d+)$/);
      if (kill) {
        if (kill[2] !== p.pid) return L(`kill: (${kill[2]}) - No such process`, "o-err");
        if (!st.squatter) return L(`kill: (${p.pid}) - No such process`, "o-err");
        st.squatter = false; ev.add("killed"); return L(`(python3 test server on ${p.port} stopped)`, "o-dim");
      }
      if (/^(docker compose|docker-compose) up( -d)?$/.test(c) || /^docker start dashboard$/.test(c)) {
        if (conflict()) return L(` ✔ Network dashboard_default  Running\n ✘ Container dashboard        Error\nError response from daemon: ... bind: address already in use (0.0.0.0:${p.port})`, "o-err");
        st.up = true; ev.add("upOk");
        return L(" ✔ Network dashboard_default  Running\n ✔ Container dashboard        Started", "o-ok");
      }
      const curl = c.match(/^curl( -s| -I| -sI)? (?:http:\/\/)?(localhost|127\.0\.0\.1):(\d+)\/?$/);
      if (curl) {
        if (!st.up || curl[3] !== hostPort()) return L(`curl: (7) Failed to connect to ${curl[2]} port ${curl[3]}: Connection refused`, "o-err");
        ev.add("curlOk");
        return L(curl[1] && curl[1].includes("I") ? "HTTP/1.1 200 OK\nServer: nginx/1.27.2\nContent-Type: text/html" : "<!doctype html>\n<html><head><title>Status dashboard</title></head>\n<body>Services: 14 up · 0 down ...</body></html>");
      }
      return null;
    },
    steps: [
      {
        title: "List the containers, stopped ones too",
        body: "<p><code>docker ps</code> only shows running containers. Add <code>-a</code> (all) to see the ones that stopped, and how they stopped.</p>",
        try: ["docker ps", "docker ps -a"], done: (st, ev) => ev.has("psa"),
        learned: "<p><b>Exited (1)</b>. Exit code 0 means a clean stop. Anything else means it crashed. Time to read why.</p>"
      },
      {
        title: "Read the logs",
        body: "<p><code>docker logs &lt;name&gt;</code> prints what the container wrote before it died. This is the step that turns guessing into knowing.</p>",
        try: ["docker logs dashboard"], done: (st, ev) => ev.has("logs"),
        learned: `<p><b>bind: address already in use</b> on <code>0.0.0.0:${p.port}</code>. Another program already holds port ${p.port}, so Docker can't take it.</p>`
      },
      {
        title: `Who is sitting on port ${p.port}?`,
        body: `<p><code>ss</code> lists network sockets. The flags spell out what you want: <b>t</b>cp, <b>u</b>dp, <b>l</b>istening, <b>p</b>rocess, <b>n</b>umeric. You need <code>sudo</code> to see which program owns each port. Add <code>| grep ${p.port}</code> to filter.</p>`,
        try: ["sudo ss -tulpn", `sudo ss -tulpn | grep ${p.port}`], done: (st, ev) => ev.has("ssProc"),
        learned: `<p><code>python3</code> with PID <b>${p.pid}</b> listens on ${p.port}: a leftover test web server that started on boot. Notice also <code>0.0.0.0</code>: it listens on <b>every</b> network interface.</p>`
      },
      {
        title: "Read the compose file",
        body: "<p>The port mapping lives in <code>docker-compose.yml</code>.</p>",
        try: ["cat docker-compose.yml"], done: (st, ev) => ev.has("compose"),
        learned: `<p><code>"${p.port}:80"</code> means <b>host port : container port</b>. With no IP in front, Docker binds to <code>0.0.0.0</code>, so the dashboard is reachable by <b>anyone on the same network</b>. On a shared office network, that's everyone in the building.</p>`
      },
      {
        title: "Fix it, and close the exposure while you're at it",
        body: `<p>Two valid fixes:</p><p><b>A.</b> Stop the leftover program: <code>kill ${p.pid}</code>.</p><p><b>B.</b> Move the dashboard to a free port and bind it to localhost only, so only the server itself can reach it. People would reach it through a reverse proxy, a VPN or an SSH tunnel.</p><p>B fixes the conflict <i>and</i> the exposure. Then start it with <code>docker compose up -d</code> (<code>-d</code> = run in the background).</p>`,
        try: [`sed -i 's/${p.port}:80/127.0.0.1:${p.alt}:80/' docker-compose.yml`, "docker compose up -d"], done: (st) => st.up,
        learned: "<p>Container <b>Started</b>.</p>"
      },
      {
        title: "Verify like you mean it",
        body: "<p>Check it's running, then actually request the page. <code>curl</code> fetches a URL from the command line; <code>-I</code> shows only the headers.</p>",
        try: ["docker ps", `curl -I localhost:${p.alt}`], done: (st, ev) => ev.has("curlOk"),
        learned: "<p>HTTP 200, the page loads. If you used option B, the dashboard now only listens on 127.0.0.1, which means nobody else on the network can reach it.</p>"
      }
    ],
    story: `The dashboard container kept exiting with code 1. docker logs showed 'address already in use' on port ${p.port}, and ss -tulpn showed a leftover Python test server holding it. I moved the dashboard to port ${p.alt} and bound it to 127.0.0.1, which fixed the conflict and stopped it being exposed to the whole network, then verified with docker ps and curl.`
  }),
};
