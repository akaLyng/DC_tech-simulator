// Shared output helpers, ported from the original browser practice lab.
// Output is a list of { t: text, c: css class } lines. Nothing here executes anything.

export function pingOut(target, ip, ok, count, note) {
  const n = count || 4;
  const lines = [`PING ${target} (${ip}) 56(84) bytes of data.`];
  if (ok) {
    for (let i = 1; i <= n; i++) lines.push(`64 bytes from ${ip}: icmp_seq=${i} ttl=${ip.startsWith("10.") ? 64 : 117} time=${(ip.startsWith("10.") ? 0.4 + i * 0.07 : 11.8 + i * 0.6).toFixed(1)} ms`);
    lines.push("", `--- ${target} ping statistics ---`, `${n} packets transmitted, ${n} received, 0% packet loss, time ${n * 1001 - 1000}ms`);
  } else {
    lines.push("", `--- ${target} ping statistics ---`, `${n} packets transmitted, 0 received, 100% packet loss, time ${n * 1001 - 1000}ms`);
  }
  const out = [{ t: lines.join("\n"), c: ok ? "" : "o-err" }];
  if (note) out.push({ t: note, c: "o-dim" });
  return out;
}

export function parsePing(c) {
  const m = c.match(/^ping(?:\s+-c\s*(\d+))?\s+(\S+)(?:\s+-c\s*(\d+))?$/);
  if (!m) return null;
  const count = m[1] || m[3];
  return { count: count ? Math.min(+count, 6) : 4, target: m[2], note: count ? "" : "(Lab stopped it after 4 packets. On a real Linux box ping runs forever: use -c 3 or press Ctrl+C.)" };
}

export const NEED_ROOT = (cmd) => [{ t: `${cmd}: Permission denied`, c: "o-err" }, { t: "This changes the system, so it needs root. Put sudo in front: sudo " + cmd, c: "o-dim" }];

export const L = (t, c) => [{ t, c: c || "" }];
