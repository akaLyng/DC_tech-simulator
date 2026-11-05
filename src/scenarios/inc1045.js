import { L } from './helpers.js';
import { checkPart } from '../parts.js';

// Ported from the original browser practice lab (INC-1045). Hostname, which disk fails (sda or sdb),
// its bay and the serials are randomized per shift; commands, outputs and step logic
// are the lab's.
export default {
  key: 'raid',
  kind: 'console',
  priority: 'P2',
  params: (r) => {
    const bad = r.pick(['sda', 'sdb']);
    const bay = r.int(1, 6);
    return { host: r.host('storage'), bad, bay, badSerial: r.serial(), goodSerial: r.serial(), newSerial: r.serial() };
  },
  build: (p) => {
    const devs = { sda: { dev: "sda1", disk: "sda", idx: 0, minor: 1 }, sdb: { dev: "sdb1", disk: "sdb", idx: 1, minor: 17 } };
    const bad = devs[p.bad];
    const good = devs[p.bad === "sda" ? "sdb" : "sda"];
    const map = bad.idx === 0 ? "_U" : "U_"; // md shows members in RaidDevice order
    const re = (flags) => new RegExp(`^mdadm (--manage )?/dev/md0 (${flags}) /dev/${bad.dev}$`);
    const row = (d, state) => `   ${d.idx}     8       ${String(d.minor).padStart(2)}        ${d.idx}      ${state}   /dev/${d.dev}`;
    return {
      id: p.id, host: p.host, user: "tech", cwd: "~", name: `${p.host} RAID degraded`, topic: "RAID 1, SMART, disk swap",
      location: { rack: p.rack, u: p.u, size: 2 }, priority: "P2", fixtures: { disk: { col: p.bay - 1, row: 0 } },
      help: `cat /proc/mdstat, sudo mdadm --detail /dev/md0, sudo smartctl -a /dev/${bad.disk}, lsblk, sudo mdadm /dev/md0 --remove|--add /dev/${bad.dev}`,
      brief: `Monitoring alert: RAID array on ${p.host} is DEGRADED. The server still works, but it is running on one disk. Bay ${p.bay} shows an amber LED.`,
      files: [],
      init: () => ({ removed: false, swapped: false, added: false, rebuilt: false, views: 0 }),
      // Physical jobs: done in the world (press E at the rack), not typed in the console.
      physical: {
        disk: {
          matches: (c) => /^(swap|replace)( |-)?(disk|drive)$/.test(c),
          target: `drive bay ${p.bay}`,
          prompt: (st, hand) => (st.swapped ? null : hand ? `Swap disk in bay ${p.bay} (${hand.label})` : `Swap disk · bay ${p.bay}`),
          run(st, ev, hand) {
            if (!st.removed) { hand.mistake("Pulled a disk that was still in the array"); return L("[lab] Stop before you pull it. The disk is still listed in the array. Remove it in software first (mdadm --remove), so the system expects it to go.", "o-warn"); }
            if (st.swapped) return L(`[lab] The new disk is already in bay ${p.bay}.`, "o-lab");
            const bad2 = checkPart(hand, { type: "disk", variant: "1TB", label: "a 1 TB 3.5\" HDD", why: "A RAID 1 replacement must be at least as big as the 931 GB member it replaces." }, L);
            if (bad2) return bad2;
            hand.use();
            st.swapped = true; ev.add("swapped");
            return L(`[lab] Bay ${p.bay} has the amber LED. You check the label: serial ${p.badSerial}, same as smartctl reported. Right disk.\n[lab] You put on the ESD wrist strap, press the caddy release, slide the failed disk out, and slide the new one in until it clicks.\n[lab] Bay ${p.bay} LED: green. The server never went down: this is a hot-swap bay.`, "o-lab");
          },
        },
      },
      world: (st) => ({ diskSwapped: st.swapped }),
      exec(c, st, sudo, ev) {
        if (/^cat \/proc\/mdstat$/.test(c) || /^watch cat \/proc\/mdstat$/.test(c)) {
          ev.add("mdstat");
          if (st.added && !st.rebuilt) {
            st.views++;
            if (st.views >= 2) { st.rebuilt = true; ev.add("rebuilt"); }
            else return L(`Personalities : [raid1]\nmd0 : active raid1 ${bad.dev}[2] ${good.dev}[${good.idx}]\n      976630464 blocks super 1.2 [2/1] [${map}]\n      [=====>...............]  recovery = 27.4% (267588672/976630464) finish=58.1min speed=203411K/sec\n(Rebuild in progress. Run it again to jump ahead in time.)`);
          }
          if (st.rebuilt) return L(`Personalities : [raid1]\nmd0 : active raid1 ${bad.dev}[2] ${good.dev}[${good.idx}]\n      976630464 blocks super 1.2 [2/2] [UU]`, "o-ok");
          ev.add("sawDegraded");
          const member = st.removed ? `${good.dev}[${good.idx}]` : `${good.dev}[${good.idx}] ${bad.dev}[${bad.idx}](F)`;
          return L(`Personalities : [raid1]\nmd0 : active raid1 ${member}\n      976630464 blocks super 1.2 [2/1] [${map}]`, "o-warn");
        }
        if (/^mdadm (--detail|-D) \/dev\/md0$/.test(c)) {
          if (!sudo) return L("mdadm: must be super-user to perform this action", "o-err");
          ev.add("detail");
          let badRow, state;
          if (st.rebuilt) { state = "clean"; badRow = `   2     8       ${String(bad.minor).padStart(2)}        ${bad.idx}      active sync   /dev/${bad.dev}`; }
          else if (st.added) { state = "clean, degraded, recovering"; badRow = `   2     8       ${String(bad.minor).padStart(2)}        ${bad.idx}      spare rebuilding   /dev/${bad.dev}`; }
          else if (st.removed) { state = "clean, degraded"; badRow = `   -     0        0        ${bad.idx}      removed`; }
          else { state = "clean, degraded"; badRow = `   ${bad.idx}     8       ${String(bad.minor).padStart(2)}        -      faulty   /dev/${bad.dev}`; }
          const rows = [row(good, "active sync"), badRow];
          if (bad.idx === 0) rows.reverse();
          return L(`/dev/md0:\n        Raid Level : raid1\n        Array Size : 976630464 (931.39 GiB)\n      Raid Devices : 2\n             State : ${state}\n\n    Number   Major   Minor   RaidDevice State\n${rows.join("\n")}`);
        }
        const smart = c.match(/^smartctl (-a|-H|-i) \/dev\/(sd[ab])$/);
        if (smart) {
          if (!sudo) return L("smartctl: Permission denied. Run as root (sudo).", "o-err");
          ev.add("smart");
          if (smart[2] === good.disk || st.swapped) return L(`Device Model:     WDC WD1003FZEX\nSerial Number:    ${smart[2] === good.disk ? p.goodSerial : `${p.newSerial} (new)`}\nSMART overall-health self-assessment test result: PASSED\n  5 Reallocated_Sector_Ct   0\n197 Current_Pending_Sector  0`, "o-ok");
          return L(`Device Model:     WDC WD1003FZEX\nSerial Number:    ${p.badSerial}\nSMART overall-health self-assessment test result: FAILED!\nDrive failure expected in less than 24 hours. SAVE ALL DATA.\n  5 Reallocated_Sector_Ct   1873\n197 Current_Pending_Sector  412\n198 Offline_Uncorrectable   409`, "o-err");
        }
        if (/^lsblk$/.test(c)) {
          const inArray = (d) => `${d.disk}   931.5G disk\n└─${d.dev} 931.5G part\n  └─md0 931.4G raid1 /data`;
          const badLines = st.swapped && !st.added ? `${bad.disk}   931.5G disk\n└─${bad.dev} 931.5G part   (new disk, not in array yet)` : inArray(bad);
          const lines = bad.idx === 0 ? [badLines, inArray(good)] : [inArray(good), badLines];
          return L(`NAME    SIZE TYPE  MOUNTPOINT\n${lines.join("\n")}`);
        }
        if (re("--fail|-f").test(c)) {
          if (!sudo) return L("mdadm: must be super-user to perform this action", "o-err");
          return L(`mdadm: set /dev/${bad.dev} faulty in /dev/md0 (it was already marked faulty)`);
        }
        if (re("--remove|-r").test(c)) {
          if (!sudo) return L("mdadm: must be super-user to perform this action", "o-err");
          if (st.removed) return L(`mdadm: /dev/${bad.dev} is not part of /dev/md0 any more`, "o-dim");
          st.removed = true; ev.add("removed"); return L(`mdadm: hot removed /dev/${bad.dev} from /dev/md0`);
        }
        if (re("--add|-a").test(c)) {
          if (!sudo) return L("mdadm: must be super-user to perform this action", "o-err");
          if (!st.swapped) return L(`mdadm: /dev/${bad.dev} is the failing disk. Replace it before adding a disk back.`, "o-err");
          if (st.added) return L(`mdadm: /dev/${bad.dev} is already in the array`, "o-dim");
          st.added = true; ev.add("added");
          return L(`mdadm: added /dev/${bad.dev}\n(The rebuild starts now: RAID 1 copies everything from ${good.disk} onto the new disk.)`);
        }
        return null;
      },
      steps: [
        {
          title: "Look at the array",
          body: "<p>Linux software RAID is called <b>md</b>. <code>/proc/mdstat</code> is a live status file. Reading it with <code>cat</code> is the quickest health check there is.</p>",
          try: ["cat /proc/mdstat"], done: (st, ev) => ev.has("sawDegraded"),
          learned: `<p><code>[2/1] [${map}]</code> means the array wants 2 disks but has 1 working. <b>U</b> = up, <b>_</b> = missing. <code>${bad.dev}[${bad.idx}](F)</code> marks ${bad.disk} as <b>failed</b>.</p><p>This is RAID 1 (mirroring): every write goes to both disks, so the data is still safe on ${good.disk}. But one more failure and it's gone. That's why this is urgent even though users notice nothing.</p>`
        },
        {
          title: "Confirm which disk, and that it's really dying",
          body: "<p><code>mdadm --detail</code> shows each disk's role. <b>SMART</b> is the disk's own health report; <code>smartctl -H</code> gives a pass or fail.</p>",
          try: ["sudo mdadm --detail /dev/md0", `sudo smartctl -a /dev/${bad.disk}`], done: (st, ev) => ev.has("detail") && ev.has("smart"),
          learned: `<p>SMART says <b>FAILED</b>, with 1873 reallocated sectors: the disk keeps moving data away from damaged spots. Note the <b>serial number</b> ${p.badSerial}. Before you pull anything in a data center, you match the serial on the label with what the system says. Pulling the wrong disk from a degraded array destroys the data.</p>`
        },
        {
          title: "Remove it from the array in software",
          body: "<p>Tell the RAID the disk is leaving <i>before</i> you pull it: <code>--remove</code>. If it weren't already marked failed, you'd run <code>--fail</code> first.</p>",
          try: [`sudo mdadm /dev/md0 --remove /dev/${bad.dev}`], done: (st) => st.removed,
          learned: `<p>The array now lists slot ${bad.idx} as <b>removed</b>. Software and hardware agree, so it's safe to touch the disk.</p>`
        },
        {
          title: "Swap the physical disk",
          body: `<p>Data center servers have <b>hot-swap bays</b>: you change a disk while the server keeps running. Find the amber LED, check the serial number, wear an ESD wrist strap.</p><p>Here you do it for real: close the console (<kbd>Esc</kbd>), take a <b>1 TB HDD</b> from the parts shelf by the exit, then walk to rack <b>${p.rack}</b>, look at ${p.host} (U${p.u}) and press <kbd>E</kbd> on drive bay ${p.bay}. Then reopen the console.</p>`,
          physical: "disk",
          try: ["swap disk", "lsblk"], done: (st) => st.swapped,
          learned: "<p>New disk in, green LED, zero downtime. (On a real server you'd also copy the partition layout to the new disk first, for example with <code>sfdisk</code>. The lab skips that.)</p>"
        },
        {
          title: "Add it back and watch the rebuild",
          body: `<p><code>--add</code> puts the new disk into the array, and RAID 1 starts copying everything from ${good.disk}. Check progress in <code>/proc/mdstat</code> until it shows <code>[UU]</code>.</p>`,
          try: [`sudo mdadm /dev/md0 --add /dev/${bad.dev}`, "cat /proc/mdstat", "cat /proc/mdstat"], done: (st) => st.rebuilt,
          learned: "<p><code>[2/2] [UU]</code>: both disks up, redundancy restored. During a rebuild the surviving disk works hard, which is exactly when a second old disk tends to fail. That's why you replace failed disks quickly.</p>"
        }
      ],
      story: `Monitoring showed the RAID 1 array on ${p.host} as degraded. /proc/mdstat showed [${map}] with ${bad.disk} marked failed, and SMART confirmed it with over 1800 reallocated sectors. I removed the disk from the array in software, matched the serial number on the label before pulling it from the hot-swap bay, added the new disk back and watched the rebuild until the array showed [UU].`
    };
  },
};
