import { L, NEED_ROOT } from './helpers.js';

// Ported from the original browser practice lab (INC-1043). Hostname, crash time, PID and log size
// are randomized per shift; commands, outputs and step logic are the lab's.
export default {
  key: 'disk-full',
  kind: 'console',
  priority: 'P2',
  params: (r) => ({ host: r.host('db'), hm: r.time().slice(0, 5), pid: r.pid(), logGb: r.int(33, 38) }),
  build: (p) => ({
    id: p.id, host: p.host, user: "tech", cwd: "~", name: `${p.host} app keeps crashing`, topic: "Disk full, logs, systemd",
    location: { rack: p.rack, u: p.u, size: 2 }, priority: "P2",
    help: "systemctl status app, journalctl -u app, df -h, du -sh /var/log/*, ls -lh <dir>, tail <file>, sudo truncate -s 0 <file>, sudo systemctl restart app",
    brief: `The reporting app on ${p.host} crashed at ${p.hm} and won't stay up. Users can't open their reports.`,
    files: [],
    init: () => ({ freed: false, up: false }),
    exec(c, st, sudo, ev) {
      if (/^systemctl status app(\.service)?$/.test(c)) {
        ev.add("status"); if (st.up) ev.add("statusUp");
        if (st.up) return L("● app.service - Reporting app\n     Loaded: loaded (/etc/systemd/system/app.service; enabled)\n     Active: active (running) since Tue 09:41:07 UTC; 3s ago\n   Main PID: 4412 (app)", "o-ok");
        return L(`× app.service - Reporting app\n     Loaded: loaded (/etc/systemd/system/app.service; enabled)\n     Active: failed (Result: exit-code) since Tue ${p.hm}:44 UTC; 6h ago\n    Process: ${p.pid} ExecStart=/opt/app/bin/app (code=exited, status=1/FAILURE)\n\nTue ${p.hm}:44 ${p.host} app[${p.pid}]: ERROR write /var/lib/app/cache.db: No space left on device\nTue ${p.hm}:44 ${p.host} systemd[1]: app.service: Failed with result 'exit-code'.`, "o-err");
      }
      if (/^journalctl -u app(\.service)?( -n \d+)?( --no-pager)?$/.test(c)) { ev.add("status"); return L(`Tue ${p.hm}:43 ${p.host} app[${p.pid}]: DEBUG request id=88123 user=svc-report ...\nTue ${p.hm}:44 ${p.host} app[${p.pid}]: ERROR write /var/lib/app/cache.db: No space left on device\nTue ${p.hm}:44 ${p.host} systemd[1]: app.service: Main process exited, code=exited, status=1/FAILURE`); }
      if (/^df( -h)?$/.test(c)) {
        ev.add("df"); if (st.freed) ev.add("dfAfter");
        const root = st.freed ? "/dev/sda2        40G   12G   26G  31% /" : "/dev/sda2        40G   40G     0 100% /";
        return [{ t: "Filesystem      Size  Used Avail Use% Mounted on\ntmpfs           1.6G  1.2M  1.6G   1% /run", c: "" }, { t: root, c: st.freed ? "o-ok" : "o-err" }, { t: "/dev/sda1       511M  6.1M  505M   2% /boot/efi", c: "" }];
      }
      if (/^du -sh \/var\/log\/\*$/.test(c) || /^du -sh \/var\/log$/.test(c)) {
        ev.add("du");
        return L(`${st.freed ? "1.1G" : `${p.logGb + 1}G`}\t/var/log/app\n24M\t/var/log/apt\n96M\t/var/log/journal\n2.1M\t/var/log/syslog\n4.0K\t/var/log/wtmp`);
      }
      if (/^du -sh \/\*$/.test(c)) return L("du: cannot read directory '/proc/...': Permission denied (lab trimmed)\n4.1G\t/usr\n1.6G\t/opt\n" + (st.freed ? "1.2G" : `${p.logGb + 1}G`) + "\t/var\n12K\t/home", "");
      if (/^ls( -l| -lh| -lah| -la)? \/var\/log\/app\/?$/.test(c)) {
        ev.add("lsApp");
        return L(`total ${st.freed ? "1.1G" : `${p.logGb + 1}G`}\n-rw-r----- 1 app app ${st.freed ? "   0" : ` ${p.logGb}G`} Oct 27 ${p.hm} debug.log\n-rw-r----- 1 app app 1.1G Oct 27 ${p.hm} app.log`);
      }
      if (/^(sudo )?tail( -n \d+)? \/var\/log\/app\/debug\.log$/.test(c)) {
        if (st.freed) return L("(empty)", "o-dim");
        return L(`${p.hm}:41 DEBUG cache hit key=report:7731\n${p.hm}:41 DEBUG cache hit key=report:7732\n${p.hm}:42 DEBUG request id=88122 headers={...}\n${p.hm}:43 DEBUG request id=88123 headers={...}\n(debug logging writes several lines per request. Someone left it switched on.)`);
      }
      const tr = c.match(/^truncate -s ?0 \/var\/log\/app\/debug\.log$/);
      const rm = c.match(/^rm( -f)? \/var\/log\/app\/debug\.log$/);
      if (tr || rm) {
        if (!sudo) return NEED_ROOT(tr ? "truncate" : "rm");
        st.freed = true; ev.add("freed");
        return L(tr ? "" : "(Deleted. Works here because the app is dead. If it were still running and had the file open, the space would NOT come back until the process restarted. That's why truncate is the safer habit.)", tr ? "" : "o-dim");
      }
      if (/^rm /.test(c)) return L("Careful: only delete what you've identified. Here, that's /var/log/app/debug.log.", "o-warn");
      const sc = c.match(/^systemctl (restart|start) app(\.service)?$/);
      if (sc) {
        if (!sudo) return NEED_ROOT("systemctl " + sc[1] + " app");
        if (!st.freed) return L("Job for app.service failed because the control process exited with error code.\nSee \"systemctl status app.service\" and \"journalctl -xeu app.service\" for details.", "o-err");
        st.up = true; ev.add("restarted"); return L("");
      }
      return null;
    },
    steps: [
      {
        title: "Ask the service what happened",
        body: "<p>Most Linux services run under <b>systemd</b>. <code>systemctl status &lt;name&gt;</code> shows whether it runs, when it stopped, and its last log lines. <code>journalctl -u &lt;name&gt;</code> shows the full log.</p>",
        try: ["systemctl status app", "journalctl -u app"], done: (st, ev) => ev.has("status"),
        learned: "<p>It says <b>failed</b>, and the reason is right there: <b>No space left on device</b>. Always read the error message before guessing.</p>"
      },
      {
        title: "How full is the disk?",
        body: "<p><code>df -h</code> shows every filesystem with size, used and free space. <code>-h</code> means human-readable (G, M instead of bytes).</p>",
        try: ["df -h"], done: (st, ev) => ev.has("df"),
        learned: "<p>The root filesystem <code>/</code> is at <b>100%</b> with 0 bytes free. Nothing on the server can write, so the app dies.</p>"
      },
      {
        title: "Find what is eating the space",
        body: "<p><code>du -sh</code> shows how big folders are (<b>d</b>isk <b>u</b>sage, <b>s</b>ummary, <b>h</b>uman). Logs are the usual suspect, so start in <code>/var/log</code>. Then list the files in the biggest folder.</p>",
        try: ["du -sh /var/log/*", "ls -lh /var/log/app", "tail /var/log/app/debug.log"], done: (st, ev) => ev.has("lsApp"),
        learned: `<p><code>debug.log</code> is <b>${p.logGb} GB</b>. <code>tail</code> shows why: debug logging writes lines for every request, and someone left it on. That's your root cause.</p>`
      },
      {
        title: "Free the space safely",
        body: "<p>Two ways to get rid of it:</p><p><code>truncate -s 0</code> empties the file but keeps it in place. <code>rm</code> deletes it. If a running process still has a file open, <code>rm</code> does <b>not</b> give the space back until that process restarts. So truncate is the safer habit on live servers.</p>",
        try: ["sudo truncate -s 0 /var/log/app/debug.log", "df -h"], done: (st, ev) => st.freed && ev.has("dfAfter"),
        learned: "<p>Down from 100% to <b>31%</b>. There's space again.</p>"
      },
      {
        title: "Bring the service back and check it",
        body: "<p>Restart the service, then check its status again. Never just assume a restart worked.</p>",
        try: ["sudo systemctl restart app", "systemctl status app"], done: (st, ev) => st.up && ev.has("statusUp"),
        learned: "<p><b>active (running)</b>. Users are back. To stop it happening again, you'd turn off debug logging, add log rotation (<code>logrotate</code>) and set an alert when the disk passes 80%. That is what separates a fix from a lasting fix.</p>"
      }
    ],
    story: `The app's status showed 'No space left on device'. df showed the root disk at 100%, and du traced it to a ${p.logGb} GB debug log, because debug logging had been left on. I truncated the log instead of deleting it, since truncate frees space even if a process holds the file open, then restarted the service and confirmed it was running. I'd also turn off debug logging, add log rotation and set a disk alert at 80%.`
  }),
};
