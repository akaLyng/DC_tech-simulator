import { L } from './helpers.js';

// Ported from the original browser practice lab (INC-1048). Hostname, the new disk's bay, size and
// serial are randomized per shift; commands, outputs and step logic are the lab's.
export default {
  key: 'boot-order',
  kind: 'console',
  priority: 'P1',
  params: (r) => ({ base: r.host('app'), bay: r.int(2, 4), tb: r.pick([4, 8, 12]), sn: r.serial('ZL2') }),
  build: (p) => ({
    id: p.id, host: `${p.base}-idrac`, user: "tech", cwd: "~", name: `${p.base} won't boot`, topic: "Boot order, remote console",
    location: { rack: p.rack, u: p.u, size: 2 }, priority: "P1",
    help: "power status, console, logs, boot list, boot order disk1, power cycle",
    brief: `${p.base} rebooted for patching last night and never came back. You are connected to its out-of-band management controller (like Dell iDRAC or HPE iLO), which works even when the OS is dead.`,
    files: [],
    init: () => ({ fixed: false, cycled: false }),
    exec(c, st, sudo, ev) {
      if (/^power( status)?$/.test(c)) { ev.add("power"); return L("Server power: ON\nPSU 1: OK   PSU 2: OK"); }
      if (/^console$/.test(c)) {
        ev.add("console");
        if (st.fixed && st.cycled) { ev.add("booted"); return L(`POST complete. Memory 128 GB OK. 2 CPUs OK.\nBooting from Disk 1 (Bay 1, 480 GB SSD)...\n\nUbuntu 24.04.1 LTS ${p.base} tty1\n\n${p.base} login: _`, "o-ok"); }
        ev.add("noboot");
        return L(`POST complete. Memory 128 GB OK. 2 CPUs OK.\nBooting from Disk ${p.bay} (Bay ${p.bay}, ${p.tb} TB HDD)...\n\nNo boot device found. Press F1 to retry boot, F2 for setup.`, "o-err");
      }
      if (/^(logs|sel|event log|racadm getsel)$/.test(c)) {
        ev.add("logs");
        return L(`Hardware event log (newest first)\n2026-10-27 02:14  System restart (OS initiated)\n2026-10-26 15:41  Drive inserted: Bay ${p.bay}, ${p.tb} TB HDD (S/N ${p.sn})\n2026-10-26 15:40  Chassis intrusion: cover opened\n2026-10-20 08:02  PSU 2 redundancy restored`);
      }
      if (/^boot( list)?$/.test(c)) {
        ev.add("bootlist");
        return L(st.fixed
          ? `Boot order:\n  1. Disk 1 (Bay 1, 480 GB SSD, Ubuntu)\n  2. Disk ${p.bay} (Bay ${p.bay}, ${p.tb} TB HDD, empty)\n  3. PXE network boot`
          : `Boot order:\n  1. Disk ${p.bay} (Bay ${p.bay}, ${p.tb} TB HDD, empty)\n  2. Disk 1 (Bay 1, 480 GB SSD, Ubuntu)\n  3. PXE network boot`, st.fixed ? "o-ok" : "");
      }
      if (/^boot (order|first|set) disk ?1$/.test(c) || /^boot order disk ?1,disk ?2,pxe$/.test(c)) { st.fixed = true; st.cycled = false; ev.add("fixed"); return L("Boot order updated. Takes effect on next boot."); }
      if (/^boot (order|first|set) /.test(c)) return L("Boot order updated. (Check boot list: the OS disk needs to be first.)", "o-dim");
      if (/^power (cycle|reset|restart)$/.test(c)) { st.cycled = true; ev.add("cycled"); return L("Power cycle requested. Server restarting... (run console to watch)"); }
      if (/^ip a|^ping|^systemctl|^ssh /.test(c)) return L("You're on the management controller, not the server's OS. The OS isn't running, so OS commands won't help here. Use power, console, logs and boot.", "o-dim");
      return null;
    },
    steps: [
      {
        title: "Check power, then watch the screen",
        body: "<p>When a server is dead you can't SSH in. Every data center server has a separate <b>management controller</b> (iDRAC, iLO, BMC) with its own network port. It lets you see the screen and control power remotely, even with no OS running.</p><p>Bottom-up as always: power first, then what the screen says.</p>",
        try: ["power status", "console"], done: (st, ev) => ev.has("power") && ev.has("noboot"),
        learned: `<p>Power OK, both PSUs fine, <b>POST</b> (the hardware self-test) passes. Then: <b>No boot device found</b>, while it's trying to boot from <b>Disk ${p.bay}</b>. The hardware is healthy; it's looking in the wrong place.</p>`
      },
      {
        title: "Ask: what changed?",
        body: "<p>Servers rarely break by themselves. The hardware event log records every physical change.</p>",
        try: ["logs"], done: (st, ev) => ev.has("logs"),
        learned: `<p>Yesterday at 15:41 someone opened the cover and <b>inserted a new ${p.tb} TB disk in bay ${p.bay}</b>. The server didn't reboot until the patching at 02:14, so the problem stayed hidden until then.</p>`
      },
      {
        title: "Check the boot order",
        body: "<p>Many servers put newly detected disks into the boot order, sometimes at the top.</p>",
        try: ["boot list"], done: (st, ev) => ev.has("bootlist"),
        learned: "<p>The new, <b>empty</b> data disk is first. The SSD with Ubuntu is second. The firmware tries the empty disk, finds nothing to boot, and stops.</p>"
      },
      {
        title: "Fix the order and restart",
        body: "<p>Put the OS disk first, then power-cycle remotely.</p>",
        try: ["boot order disk1", "power cycle"], done: (st) => st.fixed && st.cycled,
        learned: "<p>Order fixed and restart sent.</p>"
      },
      {
        title: "Watch it come up",
        body: "<p>Don't close the ticket until you see the login prompt.</p>",
        try: ["console"], done: (st, ev) => ev.has("booted"),
        learned: "<p>It boots from Disk 1 and reaches the login prompt. Follow-up: tell whoever added the disk, and note in the change log that boot order must be checked when adding drives.</p>"
      }
    ],
    story: `After a patch reboot, ${p.base} never came back. Through the iDRAC remote console I saw POST pass but 'No boot device found', with the server trying to boot from Disk ${p.bay}. The hardware event log showed a new data disk had been inserted the day before, and it had been placed first in the boot order. I put the OS disk first, power-cycled remotely and confirmed it reached the login prompt. I saw the same kind of boot-order problem in the lab at NMIT.`
  }),
};
