// Per-shift random values for scenario params. One instance per shift keeps
// hostnames unique across the whole shift.

export function makeRandom(rand = Math.random) {
  const used = new Set();
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const pad2 = (n) => String(n).padStart(2, '0');
  const hex2 = () => int(0, 255).toString(16).padStart(2, '0');
  const alnum = (n) => Array.from({ length: n }, () => pick('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789')).join('');

  return {
    rand,
    int,
    pick,
    shuffle(list) {
      const a = [...list];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    /** Unique hostname like "web-07" for this shift. */
    host(prefix) {
      for (let tries = 0; ; tries++) {
        // two digits normally; widen the range if a prefix is running out of names
        const name = `${prefix}-${tries < 40 ? pad2(int(1, 39)) : int(40, 999)}`;
        if (!used.has(name)) {
          used.add(name);
          return name;
        }
      }
    },
    /** A /24 inside 10.0.0.0/8 as its first three octets, e.g. "10.4.17". */
    subnet() {
      return `10.${int(0, 31)}.${int(0, 60)}`;
    },
    /** A host octet that isn't the gateway (.1) or other infrastructure (.2-.9). */
    octet() {
      return int(11, 240);
    },
    mac() {
      return ['3c', 'ec', 'ef', hex2(), hex2(), hex2()].join(':');
    },
    serial(prefix = 'WD-WCC6') {
      return prefix + alnum(5);
    },
    pid() {
      return int(1100, 9800);
    },
    time() {
      return `${pad2(int(0, 5))}:${pad2(int(0, 59))}:${pad2(int(0, 59))}`;
    },
  };
}
