# Data Center Technician Simulator

A first-person browser game about working a shift as a data-center technician. Walk the hall, find the rack with the amber light, open a console and work out why the server is down, swap a failed disk or PSU from the parts shelf, then pick up the helpdesk phone when a customer calls. Built with Three.js and Vite in plain JavaScript, with no game engine and no art files: every mesh, texture and sound is generated in code.

The aim is to teach real troubleshooting. The consoles accept real Linux and PowerShell commands (`ip a`, `dig`, `journalctl`, `ss -tulpn`, `mdadm`, `ufw`, `Test-NetConnection`…), and the guide explains what each output means. The terminal is entirely simulated: nothing you type is executed.

> **Status:** playable work in progress. All the systems below work; the art is placeholder geometry and there's no main menu yet. See [Roadmap](#roadmap).

## Running it

Needs Node.js 20 or newer.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # static build into dist/
npm run preview   # serve the build locally
```

The build is a static site and runs from any sub-path. Pushing to `main` deploys it to GitHub Pages through `.github/workflows/pages.yml` (enable it once under Settings → Pages → Source: GitHub Actions).

## Features

- **Server consoles.** Eight console tickets: DHCP, DNS, disk full, Docker port clash, RAID, static IP and subnets, firewall, and a server that won't boot (remote management controller).
- **Physical jobs.** Reseat cables, hot-swap disks and PSUs, replace SFP modules. Pick the right spare from the shelf: the wattage, speed or capacity has to match.
- **Helpdesk.** Customers call with vague symptoms. Ask questions, run checks from a PowerShell laptop, and decide whether the fault is on their side or ours.
- **Shifts.** A shift has a clock, SLAs, priorities and a summary of mistakes and customer satisfaction. Every shift randomises hosts, addresses, racks and root causes.
- **Positional sound.** Per-rack fan noise, footsteps that change with the floor, and procedural effects.

## Controls

| Key | Action |
| --- | --- |
| Click | Start / resume (captures the mouse and goes fullscreen; turn fullscreen off in the pause menu) |
| W A S D | Move |
| Shift | Walk faster |
| Q | Crouch (toggle), to reach the lower U's |
| Mouse | Look around |
| E | Inspect a rack, open a server's console, or do a physical job (cable, disk bay) within 2.5 m |
| `exit` / Ctrl+D / Esc | Close the console. The mouse stays captured in consoles, calls and the closing form: an in-game cursor appears, and closing drops you straight back into looking around. Outside fullscreen, Esc makes the browser let go of the mouse; any key or click then takes it back |
| Alt+H | Toggle the step guide inside the console |
| ↑ / ↓ | Command history in the console |
| M | Mute / unmute sound |
| T | Toggle the ticket panel |
| C | Close a resolved ticket: fill in root cause, action taken and how it was verified (Enter moves to the next field and submits on the last). T, C and M also work while the mouse is released |
| Esc (in the hall) | Pause menu: controls, volume, mute, fullscreen, restart or end the shift |

## The first ticket

Rack A03 has lost network. Find it in Row A, inspect it (amber LED, dangling patch cable), reseat the cable, then close the ticket with a short summary.

## Server consoles

There are eight console tickets. Each one belongs to a server: its rack's header light blinks amber until the ticket is solved, then turns green. Look at the server and press E to open an SSH-style console.

| Case | Topic | Physical step |
| --- | --- | --- |
| Host offline | Link, DHCP, 169.254 | Reseat the loose patch cable |
| Can't find anything | DNS, resolv.conf | |
| App keeps crashing | Disk full, logs, systemd | |
| Dashboard won't start | Docker, ports, exposure | |
| RAID degraded | RAID 1, SMART, disk swap | Swap the failed disk (1 TB HDD from the shelf) |
| Can't reach its gateway | Static IP, subnets, netplan | |
| Website down for users | Firewall, ports, ufw | |
| Server won't boot (iDRAC) | Boot order, remote console | |

Physical jobs aren't console commands: the console tells you to close it, walk to the rack and press E on the cable or disk bay, then come back.

The console is purely simulated. Every command is matched against the scenario's patterns in `src/scenarios/` and answered from in-memory state. Nothing you type is ever executed or `eval`'d.

[COMMANDS.md](COMMANDS.md) lists every command the consoles understand, marked Real, Simplified or Fictional. In the game, `help`, `Get-Help`, `Get-Command` and the guide tag the made-up and simplified ones with **[game]**, so you know which ones work on a real machine.

### Every shift is different

Each shift (each page load) draws new ticket numbers, racks and U positions, hostnames, IP addresses, MACs, serials, PIDs and ports; which disk failed and in which bay; which PSU failed and its wattage; which SFP cage, its speed and the root cause; and which digit of the static IP is mistyped. The diagnostic flow and step checks stay the same.

Scenarios are data-driven templates (`params(r, slot)` picks the random details, `build(p)` fills in the scenario), so a later ticket can pick a random root cause for one symptom, like the SFP case does.

## Parts shelf and physical cases

A steel shelf by the exit holds spare disks, PSUs, SFP modules and patch cables. Press E on a bin to take one part (shown bottom right); press E on the same bin to put it back, or on another bin to swap. A job checks both the type and the variant (wattage, speed, capacity), and a wrong part is rejected with an explanation and logged as a mistake.

Physical cases need no terminal:

- **Loose cable**: inspect the server, then reseat its patch cable.
- **PSU failure**: the server's status LED is amber and its front panel says "PSU redundancy lost". The PSUs are at the back: go to the hot aisle, pull the amber unit (not the green one), and fit a spare with the same wattage.
- **Uplink/SFP fault**: a top-of-rack switch port has no link light. Inspect it, then reseat the fiber, swap the SFP (same speed) or replace the fiber patch. The root cause is picked at random each shift, and the inspection gives a clue.

The racks have no rear doors (the hot aisle is contained), so server backs with fans, I/O and PSUs are visible from the hot aisle.

## Shifts, difficulty and SLAs

Difficulty presets live in `SHIFT_CONFIG` in `src/Shift.js` (`SHIFT_CONFIG.difficulty` picks one; there is no menu yet):

| | calm (default) | normal | hard |
| --- | --- | --- | --- |
| Shift | 30 min, 5 server tickets, 3 calls | 25 min, 8 tickets, 3 calls | 25 min, 8 tickets, 3 calls |
| At once | 1 server fault and 1 call | up to 2 of each | no limit |
| Next one | 60–90 s after the current one is resolved **and closed** | every 1–2.5 min (4 s once nothing is open) | same as normal |
| SLAs | doubled, paused while a console or call is open | P1 6 / P2 10 / P3 15 min | same as normal |
| Ignored alarms | stay amber | stay amber | turn red after 5 min and make a customer call |

**Tutorial.** The first calm shift is a guided one, in a fixed order: (a) a server fault whose console opens with the guide panel showing; (b) a customer call fixed on the customer's side, where the laptop walks you through `Test-Connection`, `Resolve-DnsName` and `Get-CustomerLine` step by step; (c) a call that turns out to be our fault and links to a data-hall ticket. Lessons are 15–25 s apart. After that, shifts are random. The browser remembers that you've done it; add `?tutorial=1` to the URL to play it again (or `?tutorial=0` to skip it).

The shift ends when the clock runs out or every ticket is closed. A ticket only counts as solved once it is closed with its write-up. The summary shows tickets solved, time to fix per ticket, SLA breaches, mistakes (wrong parts, pulling a disk still in the array, disabling the whole firewall…) and customer satisfaction. "Start a new shift" draws a fresh one.

## The helpdesk

A door in the server room's back wall (next to the parts shelf, under the "HELPDESK" sign) opens as you walk up to it and leads down a short corridor to a quiet, carpeted office. The desk has:

- a **monitoring dashboard**: every rack and its top-of-rack switch in green / amber (open alarm) / red (escalated), plus the core switch, updated live from the server room
- a **ticket queue** monitor (E opens the ticket panel)
- a **desk phone** and a **laptop** (see below)

The server-room fans fade out as you walk through the corridor (more so once the door has closed behind you). The office is quiet. There's a radio on the side cabinet: drop a track in `public/audio/lobby.mp3` and it plays that, softly, from the radio (E switches it on or off, and the game remembers). Without a track it only gives you static.

The **staff exit** in the east wall is the way home: E twice clocks you out and ends the shift (it warns you if tickets are still open).

### Customer calls

Three customers call per shift (the first after about 45 seconds; on calm, one at a time). When the phone rings, walk to the helpdesk and press E on it within 40 seconds, or it becomes a missed call you have to return. A call is a short conversation: the customer only describes a symptom ("no internet at the office", "website won't load", "can't reach our server"). Pick questions (1–4 or click), then decide:

- **Customer side** (router unplugged, guest Wi-Fi, their own web filter or firewall, an old server address): give the right advice and they confirm the fix on the phone. A hung router is fixed remotely from the laptop, then you call them back to confirm.
- **Our side** (DHCP server, DNS resolver, web server firewall, a rack's SFP uplink): say it's on our side. That opens or escalates the linked data-hall ticket (P1, red on the dashboard). Once it is fixed you get a toast; call the customer back to confirm before closing.

Wrong advice or escalating a customer-side problem counts as a mistake and costs customer satisfaction. Each customer case is a small file in `src/customer/cases/`: the symptom, the questions and answers, the advice, and a pool of root causes with their fixes, diagnostics and write-up.

### The PowerShell laptop

E on the laptop opens a PowerShell-style terminal (`PS C:\Users\tech>`) on the same simulated engine as the server consoles. Nothing is executed: every cmdlet answers from the state of the shift's customers and the data-hall tickets linked to them.

| Cmdlet | What it shows |
| --- | --- |
| `Test-Connection <host> [-Count n]` | Ping |
| `Test-NetConnection <host> [-Port n] [-TraceRoute]` | Ping, a TCP port, or the route (the hop where it dies) |
| `Resolve-DnsName <name> [-Server ip]` | Our resolver's answer (compare with `-Server 8.8.8.8`) |
| `Get-NetIPConfiguration` | The laptop's own IP, gateway and DNS |
| `Get-CustomerLine -Id CU-…` | Line, router (CPE), LAN clients, web filter, hosted server |
| `Get-DhcpLease -Customer CU-…` | Whether our DHCP gave their router an address |
| `Restart-CustomerCpe -Id CU-…` | Restart a hung router remotely (then call the customer to confirm) |

**Guided checks.** Whenever you answer a customer call, the laptop gets a short guided check for it, shown in the panel on the right: which commands to run for that kind of problem (no internet, website down, server unreachable) and how to read what they return. It doesn't tell you the answer: once the checks are done, you decide whether the fault is on our side or theirs. In the tutorial, the first call gets a fuller step-by-step PowerShell intro instead.

Also `Get-Help` (alone it lists every command; `Get-Help <name> [-Examples]` works for every command and alias), `Get-Command`, aliases (`tnc`, `ping`, `nslookup`, `ipconfig`), `| Select-String`, Tab completion of cmdlets, parameters and customer IDs, and arrow-key history. Alt+H toggles the hint panel, as in the server consoles (plain H would type an "h"). Every customer ticket can be diagnosed here: faults on our side show up in our systems (no DHCP lease, resolver timeout, a port or hop failing), while customer-side faults either point at their equipment or look perfectly healthy from our side.

### Pressure

On **hard**, a data-hall alarm that nobody touches for 5 minutes escalates: it goes red on the dashboard, its rack light blinks red, the ticket becomes P1, and a customer calls about the outage (a cascade call linked to that ticket). Customer satisfaction starts at 75% per caller and moves with how the call goes: missed calls, wrong advice, wrong escalations, calling back before the fix and SLA breaches cost points; a fix within three minutes earns some back, and a caller left without a fix at the end of the shift loses 25. The shift summary shows the average and each caller's score.

## Mouse and fullscreen

Browsers only let a page capture the mouse right after a click or key press, and they release it on Esc. So the game never lets go of the mouse itself: consoles, calls and the closing form draw their own cursor, and closing them needs no click. Starting a shift also goes fullscreen, where Chrome and Edge let the game keep Esc (Keyboard Lock), so Esc closes a console or opens the pause menu without losing the mouse. To leave fullscreen there, hold Esc. Elsewhere, or with fullscreen off, Esc still frees the mouse; press any key or click to take it back.

## Sound

All audio is procedural (Web Audio through Three.js, no files) and starts after the first click. Every rack has its own positional fan noise, so the hall gets louder as you walk between the rows; the core switch has a deeper, louder fan and a mains hum. Effects: cable click, disk/PSU caddy slide and latch, a beep when LEDs change, a chime when a ticket is resolved, a pager tone for new tickets, a buzz for mistakes and a soft two-note trill when the desk phone rings. Footsteps follow your pace (about two a second walking, faster running, slow and quiet crouched) and the floor: a hollow knock on the raised tiles in the hall, a softer tap on the corridor vinyl and a dull thud on the office carpet. M mutes everything.

## Performance

The hall is about 100 draw calls and 165k triangles: racks, servers, LEDs, SFPs, shelf items, lights and floor tiles are all `InstancedMesh`. The shadow map is rendered once (the layout is static) and the bloom pass runs at half resolution. In testing, a full frame took 7–9 ms median at 1024×768 @1.5x, within the 16.7 ms budget for 60 fps.

## Project layout

```
src/
  main.js               renderer, post-processing, game loop, input wiring
  Scene.js              data hall: room, racks, LEDs, cable trays, core switch, faults
  Player.js             PointerLockControls first-person movement + collision
  InteractionManager.js centre-screen raycast, highlight and prompts
  TicketSystem.js       generic ticket queue: scenarios, targets, hand, LEDs
  Shift.js              shift clock, ticket releases, SLAs and the end-of-shift report
  Helpdesk.js           corridor, door and office: desk, live monitors, phone, laptop, radio, exit
  CallUI.js             phone conversation overlay
  customer/             customer cases (one file each), the Desk (calls, escalation, call-backs),
                        the PowerShell laptop (laptop.js) and fictional customers
  HUD.js                DOM overlay: crosshair, prompts, messages, ticket panel
  TerminalUI.js         SSH-style console overlay with history and a step guide
  ScenarioEngine.js     simulated command runner
  scenarios/            one module per ticket: commands, outputs, steps, physical jobs
  cases/                physical cases (loose cable, PSU, SFP) and the shift builder
  parts.js              spare-parts catalog, shelf layout and the part check
  ModelFactory.js       single factory for all rack/server meshes
  Textures.js           procedural canvas textures for placeholder art
  Sound.js              positional fan noise per rack, effects, the office radio, volume and mute
  VirtualCursor.js      in-game cursor for dialogs while the mouse stays captured
  commandKinds.js       which console commands are real, simplified or made up (the [game] tags)
  constants.js          shared dimensions
public/audio/           optional lobby.mp3 for the office radio
public/models/          optional GLB models that replace the placeholders
.github/workflows/      GitHub Pages deploy
```

## Swapping in real models

All rack and server meshes come from `createModel(type)` in `src/ModelFactory.js`. To replace a placeholder, put a `.glb` in `public/models/` and set its path in `MODEL_PATHS`:

```js
export const MODEL_PATHS = {
  rack: 'models/rack.glb',
  // ...
};
```

The model is baked into one geometry (so it can still be drawn with `InstancedMesh`) and fitted to the placeholder's bounding box. Rack models should face +Z, with the origin at the floor centre.

## Roadmap

Ideas and known gaps, roughly in order:

- A main menu with a difficulty picker (today it's `SHIFT_CONFIG.difficulty` in `src/Shift.js`)
- Real models in place of the placeholder geometry (see above)
- More console tickets and customer cases, and random root causes for more of them
- Automated tests for the scenario engine and the shift builder
- Saved progress across shifts

Adding a ticket is mostly data: a console ticket is one module in `src/scenarios/`, a customer case one module in `src/customer/cases/`. Keep [COMMANDS.md](COMMANDS.md) and `src/commandKinds.js` up to date when you add commands.

## License

All rights reserved. Free to play for personal use; copying, redistribution and commercial use are not allowed. See [LICENSE](LICENSE).
