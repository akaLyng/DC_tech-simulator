import { L } from '../scenarios/helpers.js';
import { GAME_TAG, tagged } from '../commandKinds.js';
import { caseByKey, DIAG_DEFAULTS } from './index.js';

// The helpdesk laptop: a PowerShell-style tool session on the same simulated engine as
// the server consoles. Nothing is executed; every cmdlet answers from the state of the
// shift's customer calls and the data-hall tickets linked to them.

const ME = { host: 'HD-LAPTOP-07', ip: '10.20.5.23', gw: '10.20.5.1' };
const INFRA = { core: '10.20.0.1', resolver: '10.20.0.53', dhcp: '10.20.0.67', edge: '194.19.0.1' };
const PUBLIC = { 'google.com': '142.250.74.46', 'www.google.com': '142.250.74.46', '8.8.8.8': '8.8.8.8', '1.1.1.1': '1.1.1.1' };

/**
 * Cmdlet reference: synopsis, syntax, parameters (for tab completion) and examples.
 * `kind: 'fictional'` marks the ISP tools made up for the game (shown as [game]); the rest
 * are real Windows PowerShell commands.
 */
export const CMDLETS = {
  'Test-Connection': {
    synopsis: 'Sends ICMP echo requests (pings) to a computer.',
    syntax: 'Test-Connection [-TargetName] <string> [-Count <int>]',
    params: ['-TargetName', '-Count'],
    examples: ['Test-Connection 8.8.8.8 -Count 2', 'Test-Connection www.example'],
  },
  'Test-NetConnection': {
    synopsis: 'Tests a connection: ping by default, a TCP port with -Port, or the route with -TraceRoute.',
    syntax: 'Test-NetConnection [-ComputerName] <string> [-Port <int>] [-TraceRoute]',
    params: ['-ComputerName', '-Port', '-TraceRoute'],
    examples: ['Test-NetConnection srv01.example -Port 3389', 'Test-NetConnection www.example -Port 443', 'Test-NetConnection 85.170.1.2 -TraceRoute'],
  },
  'Resolve-DnsName': {
    synopsis: 'Looks up a DNS name. Uses our resolver unless you pass -Server.',
    syntax: 'Resolve-DnsName [-Name] <string> [-Server <string>] [-Type <string>]',
    params: ['-Name', '-Server', '-Type'],
    examples: ['Resolve-DnsName www.example', 'Resolve-DnsName www.example -Server 8.8.8.8'],
  },
  'Get-NetIPConfiguration': {
    synopsis: "Shows this laptop's IP address, gateway and DNS server.",
    syntax: 'Get-NetIPConfiguration',
    params: [],
    examples: ['Get-NetIPConfiguration'],
  },
  'Get-CustomerLine': {
    kind: 'fictional',
    synopsis: "ISP tool: a customer's line, router (CPE), LAN and hosted server as our systems see them.",
    syntax: 'Get-CustomerLine [-Id] <string>',
    params: ['-Id'],
    examples: ['Get-CustomerLine -Id CU-12345'],
  },
  'Get-DhcpLease': {
    kind: 'fictional',
    synopsis: "ISP tool: the DHCP lease our servers gave the customer's router.",
    syntax: 'Get-DhcpLease [-Customer] <string>',
    params: ['-Customer'],
    examples: ['Get-DhcpLease -Customer CU-12345'],
  },
  'Restart-CustomerCpe': {
    kind: 'fictional',
    synopsis: "ISP tool: restarts the customer's router (CPE) remotely. The line drops for about 40 seconds.",
    syntax: 'Restart-CustomerCpe [-Id] <string>',
    params: ['-Id'],
    examples: ['Restart-CustomerCpe -Id CU-12345'],
  },
  'Get-Help': { synopsis: 'Shows help for a command. Without a name it lists everything.', syntax: 'Get-Help [-Name] <string> [-Examples]', params: ['-Name', '-Examples'], examples: ['Get-Help', 'Get-Help Test-NetConnection -Examples'] },
  'Get-Command': { synopsis: 'Lists the commands on this laptop.', syntax: 'Get-Command', params: [], examples: ['Get-Command', 'Get-Command | Select-String Customer'] },
  'Select-String': { synopsis: 'Filters the output of another command: keeps only lines that contain the text (case-insensitive).', syntax: '<command> | Select-String <text>', params: ['-Pattern'], examples: ['Get-CustomerLine -Id CU-12345 | Select-String Cpe'] },
  'Get-Location': { synopsis: 'Shows the current folder.', syntax: 'Get-Location', params: [], examples: ['Get-Location'] },
  'Get-ChildItem': { synopsis: 'Lists the files in the current folder.', syntax: 'Get-ChildItem', params: [], examples: ['Get-ChildItem'] },
  'Get-Content': { synopsis: 'Prints a text file.', syntax: 'Get-Content [-Path] <file>', params: ['-Path'], examples: ['Get-Content runbook.txt'] },
  'Clear-Host': { synopsis: 'Clears the screen.', syntax: 'Clear-Host', params: [], examples: ['Clear-Host'] },
  whoami: { synopsis: 'Shows the signed-in user.', syntax: 'whoami', params: [], examples: ['whoami'] },
  hostname: { synopsis: "Shows this laptop's name.", syntax: 'hostname', params: [], examples: ['hostname'] },
  exit: { synopsis: 'Closes PowerShell and puts the laptop down.', syntax: 'exit', params: [], examples: ['exit'] },
};

const ALIASES = {
  ping: 'Test-Connection', tnc: 'Test-NetConnection', nslookup: 'Resolve-DnsName', ipconfig: 'Get-NetIPConfiguration',
  help: 'Get-Help', man: 'Get-Help', gcm: 'Get-Command', sls: 'Select-String', findstr: 'Select-String',
  pwd: 'Get-Location', ls: 'Get-ChildItem', dir: 'Get-ChildItem', cat: 'Get-Content', type: 'Get-Content', gc: 'Get-Content',
  cls: 'Clear-Host', clear: 'Clear-Host',
};
// aliases that are really separate programs on Windows (ping.exe, nslookup.exe, ...): the
// game runs the cmdlet instead, so the output looks different from the real thing
const ALIAS_KINDS = { ping: 'simplified', nslookup: 'simplified', ipconfig: 'simplified', findstr: 'simplified' };
const kindOf = (name) => CMDLETS[name]?.kind ?? 'real';
const CANON = Object.fromEntries(Object.keys(CMDLETS).map((k) => [k.toLowerCase(), k]));

/** Split a command line into words, keeping quoted strings together. */
function words(line) {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

/** Parse "-Name value" / switches / positional args against a cmdlet's parameter list. */
function parseArgs(args, params) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      const name = params.find((p) => p.toLowerCase().startsWith(a.toLowerCase())) || a;
      const key = name.slice(1).toLowerCase();
      const next = args[i + 1];
      if (['-traceroute', '-examples'].includes(name.toLowerCase()) || next === undefined || next.startsWith('-')) out[key] = true;
      else out[key] = args[++i];
    } else out._.push(a);
  }
  return out;
}

const pad = (s, n) => String(s).padEnd(n);
const table = (rows) => {
  const w = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${pad(k, w)} : ${v}`).join('\n');
};

export function makeLaptopScenario(desk, tickets) {
  // ---- what the network looks like right now ------------------------------------------

  const known = () => desk.calls.filter((c) => c.ticket);
  const causeOf = (call) => caseByKey[call.caseKey].causes[call.causeKey];
  const fixed = (call) => ['resolved', 'callback', 'remoteFixed'].includes(call.state) || (call.linkId && ['RESOLVED', 'CLOSED'].includes(tickets.byId(call.linkId)?.status));
  /** The cause's symptoms as our systems see them, until it is fixed. */
  const diag = (call) => (fixed(call) ? { ...DIAG_DEFAULTS } : { ...DIAG_DEFAULTS, ...causeOf(call).diag });
  const linked = (call) => (call.linkId ? tickets.byId(call.linkId) : null);
  const serverRack = (call) => {
    const l = linked(call);
    if (l?.rack) return l.rack;
    return (call.rack ??= `${'AB'[call.customer.id.charCodeAt(4) % 2]}0${(call.customer.id.charCodeAt(5) % 8) + 1}`);
  };
  // our resolver fails for everyone while any DNS outage is unfixed
  const resolverDown = () => known().some((c) => diag(c).resolver === 'fail');
  const dhcpDown = () => known().find((c) => diag(c).lease === 'none');
  const byCustomerId = (id) => known().find((c) => c.customer.id.toLowerCase() === String(id || '').toLowerCase());

  /** What a name or address points at: a customer's router/server, our infrastructure, or the internet. */
  function target(name) {
    const n = String(name).toLowerCase();
    for (const call of known()) {
      const c = call.customer;
      if (n === c.wanIp) return { kind: 'cpe', call, ip: c.wanIp };
      if (n === c.serverIp) return { kind: 'server', call, ip: c.serverIp };
      if (n === c.oldServerIp) return { kind: 'old', call, ip: c.oldServerIp };
      if ([c.site, c.domain, c.serverName].includes(n)) return { kind: 'server', call, ip: c.serverIp, name: n };
    }
    if (n in PUBLIC) return { kind: 'internet', ip: PUBLIC[n], name: /[a-z]/.test(n) ? n : undefined };
    const infra = Object.entries(INFRA).find(([, ip]) => ip === n);
    if (infra) return { kind: infra[0], ip: n };
    if (/^\d+\.\d+\.\d+\.\d+$/.test(n)) return { kind: 'unknown', ip: n };
    return null;
  }

  /** Does the target answer ping right now? */
  function pings(tg) {
    if (!tg) return false;
    if (tg.kind === 'cpe') {
      const d = diag(tg.call);
      return d.line === 'up' && d.cpe !== 'offline';
    }
    if (tg.kind === 'server') return !['uplink-down', 'down'].includes(diag(tg.call).server);
    if (tg.kind === 'dhcp') return !dhcpDown();
    return ['internet', 'core', 'resolver', 'edge'].includes(tg.kind);
  }

  /** Does a TCP connect to this port succeed from our side? */
  function tcp(tg, port) {
    if (!pings(tg) || tg.kind !== 'server') return tg?.kind === 'internet' && [80, 443].includes(port);
    const c = tg.call.customer;
    const d = diag(tg.call);
    if ([80, 443].includes(port)) return d.web !== 'blocked';
    return port === c.rdpPort;
  }

  /** Names go through our resolver (unless -Server says otherwise). */
  function resolve(name, server) {
    const n = name.toLowerCase();
    const viaUs = !server || server === INFRA.resolver;
    if (viaUs && resolverDown()) return { timeout: true };
    if (/^\d+\.\d+\.\d+\.\d+$/.test(n)) return { ip: n };
    const tg = target(n);
    return tg ? { ip: tg.ip } : { missing: true };
  }

  const nameError = (cmd, name) => L(`${cmd}: Testing connection to computer '${name}' failed: No such host is known.`, 'o-err');

  // ---- cmdlets ------------------------------------------------------------------------

  const run = {
    'Get-Command': () =>
      L(
        ['CommandType     Name', '-----------     ----', ...Object.keys(CMDLETS).map((k) => `${/-/.test(k) ? 'Cmdlet ' : 'Application'}     ${tagged(k, kindOf(k))}`), '', `${GAME_TAG} = made up for the game; the rest exist in real PowerShell.`].join('\n'),
      ),

    'Get-Help': (a) => {
      const name = a.name || a._[0];
      if (!name) {
        const names = Object.keys(CMDLETS).map((k) => tagged(k, kindOf(k)));
        const w = Math.max(...names.map((k) => k.length));
        const list = Object.values(CMDLETS).map((h, i) => `  ${names[i].padEnd(w)}  ${h.synopsis}`).join('\n');
        const aliases = Object.entries(ALIASES).map(([a2, k]) => tagged(`${a2} -> ${k}`, ALIAS_KINDS[a2] ?? 'real')).join(', ');
        return L(`Commands on this laptop (Get-Help <name> for details, -Examples for examples):\n\n${list}\n\nAliases: ${aliases}\n\n${GAME_TAG} = made up or simplified for the game; everything else works the same in real PowerShell.`);
      }
      const key = CANON[name.toLowerCase()] || ALIASES[name.toLowerCase()];
      const h = CMDLETS[key];
      if (!h) return L(`Get-Help : Get-Help could not find ${name} in a help file in this session. Get-Help without a name lists every command.`, 'o-err');
      const aliases = Object.entries(ALIASES).filter(([, k]) => k === key).map(([a2]) => a2);
      const title = tagged(key, kindOf(key));
      const aliasKind = ALIAS_KINDS[name.toLowerCase()];
      const note =
        kindOf(key) === 'fictional'
          ? `\n\nNOTE ${GAME_TAG}\n    Made up for this game: real ISPs have their own in-house tools for this.`
          : aliasKind
            ? `\n\nNOTE ${GAME_TAG}\n    On real Windows, ${name.toLowerCase()} is its own program (${name.toLowerCase()}.exe) with different output; here it runs ${key}.`
            : '';
      if (a.examples) return L(`NAME\n    ${title}\n\nEXAMPLES\n${h.examples.map((e) => `    PS C:\\> ${e}`).join('\n')}${note}`);
      return L(`NAME\n    ${title}\n\nSYNOPSIS\n    ${h.synopsis}\n\nSYNTAX\n    ${h.syntax}${aliases.length ? `\n\nALIASES\n    ${aliases.map((a2) => tagged(a2, ALIAS_KINDS[a2] ?? 'real')).join(', ')}` : ''}\n\nEXAMPLES\n${h.examples.map((e) => `    PS C:\\> ${e}`).join('\n')}${note}`);
    },

    'Select-String': () => L('Select-String filters another command\'s output. Use it after a pipe, e.g. Get-Command | Select-String Customer', 'o-dim'),
    'Get-Location': () => L(`\nPath\n----\nC:\\Users\\tech`),
    'Get-ChildItem': () => L('\n    Directory: C:\\Users\\tech\n\nMode   Name\n----   ----\nd----  Desktop\nd----  Documents\n-a---  runbook.txt'),
    'Get-Content': (a) => {
      const f = a.path || a._[0];
      if (!/runbook/i.test(f || '')) return L(`Get-Content : Cannot find path 'C:\\Users\\tech\\${f ?? ''}' because it does not exist.`, 'o-err');
      return L('Helpdesk runbook\n1. Get the customer ID from the ticket.\n2. Get-CustomerLine -Id <id>: line, router, LAN, web filter, server.\n3. Get-DhcpLease -Customer <id>: did our DHCP give them an address?\n4. Resolve-DnsName <name>: does our resolver answer? Compare with -Server 8.8.8.8.\n5. Test-NetConnection <server> -Port <port> / -TraceRoute: can WE reach it?\nIf everything works from our side, the problem is at the customer\'s end.');
    },
    whoami: () => L('helpdesk\\tech'),
    hostname: () => L(ME.host),

    'Get-NetIPConfiguration': () =>
      L(table([['InterfaceAlias', 'Ethernet'], ['InterfaceIndex', '12'], ['InterfaceDescription', 'Intel(R) Ethernet Connection I219-LM'], ['NetProfile.Name', 'helpdesk.corp'], ['IPv4Address', ME.ip], ['IPv4DefaultGateway', ME.gw], ['DNSServer', INFRA.resolver]])),

    'Test-Connection': (a) => {
      const name = a.targetname || a._[0];
      if (!name) return L('Test-Connection: Missing an argument for parameter TargetName.', 'o-err');
      const res = resolve(name);
      if (res.timeout || res.missing) return nameError('Test-Connection', name);
      const tg = target(res.ip) || { kind: 'unknown', ip: res.ip };
      const ok = pings(tg);
      const n = Math.min(+a.count || 4, 6);
      const lat = tg.kind === 'internet' ? 12 : tg.kind === 'cpe' ? 9 : 2;
      const rows = Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(4)} ${pad(ME.host, 16)} ${pad(res.ip, 24)} ${String(ok ? lat + (i % 3) : 0).padStart(7)} ${'32'.padStart(10)} ${ok ? 'Success' : 'TimedOut'}`);
      return L(`\n   Destination: ${res.ip}\n\nPing Source           Address                  Latency BufferSize Status\n                                                  (ms)        (B)\n---- ------           -------                  ------- ---------- ------\n${rows.join('\n')}`, ok ? '' : 'o-err');
    },

    'Test-NetConnection': (a) => {
      const name = a.computername || a._[0];
      if (!name) return L('Test-NetConnection: give a -ComputerName, e.g. Test-NetConnection 8.8.8.8', 'o-err');
      const res = resolve(name);
      if (res.timeout || res.missing) return L(`WARNING: Name resolution of ${name} failed${res.timeout ? ': our DNS server did not answer in time' : ''}`, 'o-warn').concat(L(table([['ComputerName', name], ['RemoteAddress', ''], ['PingSucceeded', 'False']])));
      const tg = target(res.ip) || { kind: 'unknown', ip: res.ip };
      const ok = pings(tg);
      if (a.traceroute) return L(table([['ComputerName', name], ['RemoteAddress', res.ip], ['InterfaceAlias', 'Ethernet'], ['SourceAddress', ME.ip], ['PingSucceeded', ok ? 'True' : 'False'], ['TraceRoute', traceroute(tg).join('\n' + ' '.repeat(25))]]), ok ? '' : 'o-warn');
      if (a.port !== undefined) {
        const port = +a.port;
        const tcpOk = tcp(tg, port);
        const out = tcpOk ? [] : L(`WARNING: TCP connect to (${res.ip} : ${port}) failed`, 'o-warn');
        if (!tcpOk) out.push(...L(`WARNING: Ping to ${res.ip} ${ok ? 'succeeded' : 'failed'}`, 'o-warn'));
        return out.concat(L(table([['ComputerName', name], ['RemoteAddress', res.ip], ['RemotePort', port], ['InterfaceAlias', 'Ethernet'], ['SourceAddress', ME.ip], ['TcpTestSucceeded', tcpOk ? 'True' : 'False']]), tcpOk ? 'o-ok' : 'o-err'));
      }
      return L(table([['ComputerName', name], ['RemoteAddress', res.ip], ['InterfaceAlias', 'Ethernet'], ['SourceAddress', ME.ip], ['PingSucceeded', ok ? 'True' : 'False'], ['PingReplyDetails (RTT)', ok ? '9 ms' : '0 ms']]), ok ? '' : 'o-err');
    },

    'Resolve-DnsName': (a) => {
      const name = a.name || a._[0];
      if (!name) return L('Resolve-DnsName: give a -Name, e.g. Resolve-DnsName www.example', 'o-err');
      const res = resolve(name, a.server);
      if (res.timeout) return L(`Resolve-DnsName : ${name} : This operation returned because the timeout period expired\n    + CategoryInfo          : OperationTimeout: (${name}:String) [Resolve-DnsName]\n    (Server: ${INFRA.resolver})`, 'o-err');
      if (res.missing) return L(`Resolve-DnsName : ${name} : DNS name does not exist`, 'o-err');
      return L(`\nName                                           Type   TTL   Section    IPAddress\n----                                           ----   ---   -------    ---------\n${pad(name, 46)} A      300   Answer     ${res.ip}${a.server ? `\n\n(Server: ${a.server})` : ''}`);
    },

    'Get-CustomerLine': (a) => {
      const id = a.id || a._[0];
      const call = byCustomerId(id);
      if (!call) return L(`Get-CustomerLine : No customer with Id '${id ?? ''}'. The Id is on the customer's ticket (CU-xxxxx).`, 'o-err');
      const c = call.customer;
      const d = diag(call);
      const cpe = d.cpe === 'offline' ? `Offline (last seen ${lastSeen()})` : d.cpe === 'hung' ? 'Online - management not responding' : 'Online';
      const traffic = d.line === 'down' || d.cpe !== 'online' ? '0 B in / 0 B out' : '1.2 GB in / 310 MB out';
      const rows = [
        ['Id', c.id], ['Customer', c.company], ['Contact', c.name], ['Service', 'Business Fiber 500/500'],
        ['LineStatus', d.line === 'up' ? 'Up' : 'Down (no light from the customer router)'],
        ['CpeStatus', cpe], ['CpeUptime', d.cpe === 'offline' ? '-' : d.cpe === 'hung' ? '412d 07:44' : '9d 03:12'],
        ['WanAddress', c.wanIp], ['Traffic (15 min)', traffic],
        ['LanClients', d.lan === 'guest' ? 'Office: 13 · Guest: 1 (guest network is isolated, no internet route)' : 'Office: 14 · Guest: 0'],
        ['WebFilter', d.webFilter ? 'On (blocking category: Business)' : 'Off'],
        ['HostedServer', `${c.serverName} (${c.serverIp}), rack ${serverRack(call)}`],
      ];
      if (d.serverMoved) rows.push(['Notes', `Server moved from ${c.oldServerIp} to ${c.serverIp} on 2026-10-20; customer was notified by email.`]);
      return L(table(rows));
    },

    'Get-DhcpLease': (a) => {
      const id = a.customer || a._[0];
      const call = byCustomerId(id);
      if (!call) return L(`Get-DhcpLease : No customer with Id '${id ?? ''}'.`, 'o-err');
      const d = diag(call);
      const server = linked(call)?.hostId && diag(call).lease === 'none' ? linked(call).hostId : 'dhcp-01';
      if (d.lease === 'none') {
        return L(table([['Customer', call.customer.id], ['IPAddress', '-'], ['State', 'NoLease'], ['LastRequest', `DHCPDISCOVER at ${lastSeen()}:22, no DHCPOFFER sent`], ['DhcpServer', `${server} (${INFRA.dhcp}): NOT RESPONDING`]]), 'o-err');
      }
      return L(table([['Customer', call.customer.id], ['IPAddress', call.customer.wanIp], ['State', 'Active'], ['LeaseExpires', 'in 21h 44m'], ['DhcpServer', `${server} (${INFRA.dhcp})`]]));
    },

    'Restart-CustomerCpe': (a) => {
      const id = a.id || a._[0];
      const call = byCustomerId(id);
      if (!call) return L(`Restart-CustomerCpe : No customer with Id '${id ?? ''}'.`, 'o-err');
      const d = diag(call);
      if (d.cpe === 'offline' || d.line === 'down') return L(`Restart-CustomerCpe : The router for ${call.customer.id} is offline (last seen ${lastSeen()}). It cannot be reached to restart; the problem is at the customer's end (power or cabling).`, 'o-err');
      const fixedIt = desk.remoteAction(call.customer.id, 'restart-cpe');
      return L(`Restarting CPE for ${call.customer.id} (${call.customer.company})...\nCPE back online after 41 s.${fixedIt ? ' Traffic is flowing again. Call the customer to confirm.' : ' (Nothing changed: the customer just lost connection for 41 seconds.)'}`, fixedIt ? 'o-ok' : 'o-warn');
    },
  };

  function traceroute(tg) {
    const hops = [ME.gw, INFRA.core];
    const dead = '0.0.0.0';
    if (tg.kind === 'server') {
      const rack = serverRack(tg.call).toLowerCase();
      if (['uplink-down', 'down'].includes(diag(tg.call).server)) {
        hops.push(diag(tg.call).server === 'uplink-down' ? `${dead}   (tor-${rack}: no response)` : `185.41.0.${rack.charCodeAt(2)}   (tor-${rack})`, dead);
      } else hops.push(`185.41.0.${rack.charCodeAt(2)}   (tor-${rack})`, tg.ip);
    } else if (tg.kind === 'cpe' || tg.kind === 'old' || tg.kind === 'unknown') {
      hops.push(INFRA.edge, `85.170.0.1   (acc-03)`, pings(tg) ? tg.ip : dead);
    } else if (tg.kind === 'internet') hops.push(INFRA.edge, '62.115.0.1', tg.ip);
    else hops.push(tg.ip);
    return hops;
  }

  function lastSeen() {
    const s = tickets.clock();
    return `${String(2 + Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s / 60) % 60)).padStart(2, '0')}`;
  }

  // ---- the scenario the engine and terminal see ---------------------------------------

  return {
    id: 'LAPTOP',
    host: ME.host,
    user: 'tech',
    cwd: 'C:\\Users\\tech',
    shell: 'powershell',
    title: `Windows PowerShell · ${ME.host}`,
    name: 'Helpdesk laptop',
    files: [],
    location: {},
    init: () => ({}),
    steps: [],
    banner: ['Windows PowerShell', 'ISP helpdesk tools loaded. Get-Command lists them, Get-Help <cmdlet> explains one. Tab completes names.', ''],
    notFound: (word) => L(`${word} : The term '${word}' is not recognized as the name of a cmdlet, function, script file, or operable program.\nTry Get-Command to see what this laptop can do.`, 'o-err'),
    /** For the [game] tags in the guide: fictional ISP tools and the .exe-style aliases. */
    commandKind(line) {
      const word = (words(line)[0] ?? '').toLowerCase();
      if (ALIAS_KINDS[word]) return ALIAS_KINDS[word];
      return kindOf(CANON[word] || ALIASES[word]);
    },

    exec(line, st, sudo, ev) {
      const [cmd, ...args] = words(line);
      if (!cmd) return null;
      const name = CANON[cmd.toLowerCase()] || ALIASES[cmd.toLowerCase()];
      if (!name || !run[name]) return null;
      const a = parseArgs(args, CMDLETS[name].params);
      // events the intro steps check ("did they ping the router?")
      const arg = String(a._[0] ?? a.targetname ?? a.computername ?? a.name ?? a.id ?? a.customer ?? '').toLowerCase();
      if (arg) {
        const key = `${name.toLowerCase()}:${arg}`;
        ev.add(key);
        if (a.port !== undefined) ev.add(`${key}:port`); // so a guide can tell a port test from a plain ping
        if (a.traceroute) ev.add(`${key}:trace`);
      }
      return run[name](a);
    },

    /**
     * A short PowerShell intro for a customer call, in the same step format as the
     * server consoles: ping their router, resolve their site, read their line.
     */
    introSteps(call) {
      const c = call.customer;
      return [
        {
          title: 'Can we reach their router?',
          body: `<p>Start where our network meets theirs: the customer's router (CPE). <code>Test-Connection</code> pings an address, like <code>ping</code> on Linux. The router's public address, <code>${c.wanIp}</code>, is in <code>Get-CustomerLine</code>; for now, just ping it.</p>`,
          try: [`Test-Connection ${c.wanIp} -Count 2`],
          done: (st, ev) => ev.has(`test-connection:${c.wanIp}`),
          learned: '<p>Replies came back: the line and the router are up and reachable <b>from our side</b>.</p>',
        },
        {
          title: 'Does our DNS answer for them?',
          body: `<p>Next layer up: names. <code>Resolve-DnsName</code> asks our DNS server for a name, like <code>dig</code>. Try their website.</p>`,
          try: [`Resolve-DnsName ${c.site}`],
          done: (st, ev) => ev.has(`resolve-dnsname:${c.site}`),
          learned: '<p>Our resolver answers with their server’s address. DNS on our side is fine. (If it timed out, you could compare with <code>-Server 8.8.8.8</code>.)</p>',
        },
        {
          title: 'What do our systems say about their line?',
          body: `<p><code>Get-CustomerLine</code> is an ISP tool: it shows the customer's line, router, the devices on their network, their web filter and hosted server, as our systems see them. The ID is on the ticket.</p>`,
          try: [`Get-CustomerLine -Id ${c.id}`],
          done: (st, ev) => ev.has(`get-customerline:${c.id.toLowerCase()}`),
          learned: '<p>Look at <b>LanClients</b>: one device is on the <b>guest</b> network, which has no route to the internet. Everything on our side works, so the fix is on theirs. Call the customer back (E on the phone) and tell them which network to use.</p>',
        },
      ];
    },

    /**
     * A guided check for any customer call, picked by what they called about. It shows which
     * commands to run and how to read them, but leaves the verdict (our side or theirs) to you.
     */
    guidedSteps(call) {
      const c = call.customer;
      const id = c.id.toLowerCase();
      const site = c.site.toLowerCase();
      const server = c.serverName.toLowerCase();
      const line = {
        title: 'What do our systems say about their line?',
        body: `<p><code>Get-CustomerLine</code> shows the customer's line, router (CPE), the devices on their network, their web filter and hosted server, as our systems see them. The ID is on the ticket: <code>${c.id}</code>.</p>`,
        try: [`Get-CustomerLine -Id ${c.id}`],
        done: (st, ev) => ev.has(`get-customerline:${id}`),
        learned: '<p>Read it top to bottom. <b>Line</b> and <b>Cpe</b>: is the connection up and is their router answering? <b>LanClients</b>: which network each device is on. <b>WebFilter</b>: what their router blocks. Anything odd here is a lead.</p>',
      };
      const steps = {
        'no-internet': [
          line,
          {
            title: 'Can we reach their router?',
            body: `<p><code>Test-Connection</code> pings an address, like <code>ping</code> on Linux. Ping their router's public address, <code>${c.wanIp}</code>.</p>`,
            try: [`Test-Connection ${c.wanIp} -Count 2`],
            done: (st, ev) => ev.has(`test-connection:${c.wanIp}`),
            learned: '<p>Replies mean the line and the router are up, seen from our side. No replies while the line is up points at the router itself: switched off, unplugged or hung.</p>',
          },
          {
            title: 'Did our DHCP give their router an address?',
            body: `<p>Their router gets its internet address from our DHCP server. <code>Get-DhcpLease</code> shows whether it did.</p>`,
            try: [`Get-DhcpLease -Customer ${c.id}`],
            done: (st, ev) => ev.has(`get-dhcplease:${id}`),
            learned: "<p>An <b>active lease</b> means our side did its job. <b>No lease</b> while their router is online means our DHCP server isn't handing out addresses: that's on our side.</p>",
          },
        ],
        'website-down': [
          line,
          {
            title: 'Does our DNS answer for their site?',
            body: `<p><code>Resolve-DnsName</code> asks our DNS server for a name, like <code>dig</code>. If it times out, try again with <code>-Server 8.8.8.8</code> to compare with Google's.</p>`,
            try: [`Resolve-DnsName ${c.site}`, `Resolve-DnsName ${c.site} -Server 8.8.8.8`],
            done: (st, ev) => ev.has(`resolve-dnsname:${site}`),
            learned: "<p>An address back means our resolver works. A timeout from ours while Google's answers means <b>our</b> DNS is failing.</p>",
          },
          {
            title: 'Does the site answer on the web port?',
            body: `<p><code>Test-NetConnection</code> with <code>-Port</code> tries to open a TCP connection, like a browser does. Websites use 443 (HTTPS) and 80 (HTTP).</p>`,
            try: [`Test-NetConnection ${c.site} -Port 443`],
            done: (st, ev) => ev.has(`test-netconnection:${site}:port`),
            learned: '<p><b>TcpTestSucceeded True</b>: the site answers from our network, so whatever stops them is at their end (check the web filter above). <b>False</b> while ping works: something on the server is blocking the port, which is ours to fix.</p>',
          },
        ],
        'server-unreachable': [
          line,
          {
            title: 'Can we connect to their server?',
            body: `<p>They connect with ${c.rdpPort === 22 ? 'SSH, port 22' : 'Remote Desktop, port 3389'}. Test that port from here with <code>Test-NetConnection -Port</code>.</p>`,
            try: [`Test-NetConnection ${c.serverName} -Port ${c.rdpPort}`],
            done: (st, ev) => ev.has(`test-netconnection:${server}:port`),
            learned: "<p><b>True</b>: the server is up and the port is open from our network, so the block is somewhere on their side (their office firewall, or an old address). <b>False</b>: we can't reach it either.</p>",
          },
          {
            title: 'Where does the path stop?',
            body: '<p><code>-TraceRoute</code> lists each hop between us and the server. If it stops partway, the last hop that answered is where things break.</p>',
            try: [`Test-NetConnection ${c.serverName} -TraceRoute`],
            done: (st, ev) => ev.has(`test-netconnection:${server}:trace`),
            learned: '<p>A route that reaches the server means the network is fine. A route that dies at one of our switches means the fault is in our data hall.</p>',
          },
        ],
        'service-down': [
          line,
          {
            title: 'Can we reach their service?',
            body: '<p>Their service runs on a server in our data hall. Trace the route to it to see how far we get.</p>',
            try: [`Test-NetConnection ${c.serverName} -TraceRoute`],
            done: (st, ev) => ev.has(`test-netconnection:${server}:trace`),
            learned: '<p>If the route dies inside our network, the fault is in our data hall, most likely the alarm that was left unattended.</p>',
          },
        ],
      };
      return steps[call.caseKey] ?? [line];
    },

    /** Tab completion: cmdlet names, then parameter names, then customer IDs. */
    complete(lineText) {
      const parts = lineText.split(/\s+/);
      const last = parts[parts.length - 1];
      const head = parts.slice(0, -1).join(' ');
      const join = (s) => (head ? `${head} ${s}` : s);
      if (parts.length === 1) {
        return [...Object.keys(CMDLETS), ...Object.keys(ALIASES)].filter((n) => n.toLowerCase().startsWith(last.toLowerCase())).map(join);
      }
      if (last.startsWith('-')) {
        const cmd = CANON[parts[0].toLowerCase()] || ALIASES[parts[0].toLowerCase()];
        return (CMDLETS[cmd]?.params || []).filter((p) => p.toLowerCase().startsWith(last.toLowerCase())).map(join);
      }
      if (/^cu/i.test(last)) return known().map((c) => c.customer.id).filter((id) => id.toLowerCase().startsWith(last.toLowerCase())).map(join);
      return [];
    },

    /** Sidebar: the customers you can look up, and the tools. */
    guide() {
      const rows = known()
        .filter((c) => c.ticket.status !== 'CLOSED')
        .map((c) => `<li><code>${c.customer.id}</code> ${esc(c.customer.company)}<br><small>${esc(caseByKey[c.caseKey].symptom)} · ${esc(c.ticket.status)}</small></li>`)
        .join('');
      return `<div class="hint-head"><span>Helpdesk laptop</span><span>PowerShell</span></div>
        <h4>Open customer tickets</h4>
        ${rows ? `<ul class="customers">${rows}</ul>` : '<p>No customer tickets yet. Answer the phone first.</p>'}
        <h4>Tools</h4>
        <p><code>Get-CustomerLine -Id</code> <span class="game-tag">[game]</span> line, router, LAN, filter<br><code>Get-DhcpLease -Customer</code> <span class="game-tag">[game]</span> lease from our DHCP<br><code>Resolve-DnsName</code> our DNS (try <code>-Server 8.8.8.8</code>)<br><code>Test-NetConnection -Port / -TraceRoute</code><br><code>Restart-CustomerCpe -Id</code> <span class="game-tag">[game]</span> remote router restart</p>
        <p><small>[game] = made up for the game; the rest are real PowerShell.</small></p>
        <p>If everything works from our side, the fault is at the customer's end.</p>`;
    },
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
