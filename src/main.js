import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { DataCenterScene } from './Scene.js';
import { Player } from './Player.js';
import { InteractionManager } from './InteractionManager.js';
import { TicketSystem, hostConfigs } from './TicketSystem.js';
import { buildShift } from './cases/index.js';
import { Shift, preset, fmtTime } from './Shift.js';
import { HUD } from './HUD.js';
import { TerminalUI } from './TerminalUI.js';
import { Sound } from './Sound.js';
import { setMaxAnisotropy } from './Textures.js';
import { WORLD_BOUNDS, ROOM, CORRIDOR } from './constants.js';
import { HelpdeskRoom } from './Helpdesk.js';
import { CallUI } from './CallUI.js';
import { Desk } from './customer/Desk.js';
import { makeLaptopScenario } from './customer/laptop.js';
import { ScenarioSession } from './ScenarioEngine.js';
import { VirtualCursor } from './VirtualCursor.js';

async function init() {
  const hud = new HUD();
  hud.setLoading(true);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('app').appendChild(renderer.domElement);
  setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 40);

  // difficulty preset (calm by default); the very first calm shift is the guided tutorial.
  // ?tutorial=1 / ?tutorial=0 forces it on or off, for testing.
  const settings = preset();
  const query = new URLSearchParams(location.search);
  let tutorialDone = false;
  try {
    tutorialDone = localStorage.getItem('dc-sim-tutorial-done') === '1';
  } catch {}
  const tutorial = query.has('tutorial') ? query.get('tutorial') !== '0' : settings.tutorial && !tutorialDone;
  const { scenarios, calls, random, sequence } = buildShift({ size: settings.tickets, calls: settings.calls, tutorial });
  const dc = new DataCenterScene(renderer, hostConfigs(scenarios));
  await dc.build();
  // the hall's lighting and layout are static: render the shadow map once, not every frame
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(dc.scene, camera));
  // threshold above anything lit (walls, floor): only the light strips, LEDs and screens glow
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.3, 1.35);
  // run the glow at half resolution: it's a blur anyway, and it's the most expensive pass
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => bloomSetSize(w / 2, h / 2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);

  const player = new Player(camera, renderer.domElement, dc.colliders, WORLD_BOUNDS);
  player.setPosition(0, 5.8);

  const tickets = new TicketSystem(hud, dc);
  for (const scenario of scenarios) tickets.add(scenario);

  // the helpdesk wing: corridor, door and office with live monitors
  const helpdesk = new HelpdeskRoom(dc.scene, { colliders: dc.colliders, statusSource: () => tickets.statusSnapshot() });
  helpdesk.build();
  const terminal = new TerminalUI();
  const audio = new Sound();
  tickets.onDispatch = () => audio.play('newTicket');
  // The shift releases tickets over time and tracks SLAs; its clock only runs while you play.
  const shift = new Shift(tickets, hud, {
    settings,
    sequence,
    onRelease: (kind, item, i) => tutorialStep(i, item),
    onBreach: (t) => {
      audio.play('buzz');
      desk?.onBreach(t);
    },
    onEnd: (report) => {
      if (tutorial) {
        try {
          localStorage.setItem('dc-sim-tutorial-done', '1');
        } catch {}
      }
      if (terminal.isOpen) terminal.close('button');
      if (callUI.isOpen) callUI.close('button');
      if (hud.editingSummary) hud.endSummary();
      hud.toggleTickets(false);
      hud.showResumeHint(false);
      hud.hideOverlay();
      player.unlock();
      audio.setPaused(true);
      hud.showShiftSummary(report, fmtTime);
    },
  });
  hud.onNewShift = () => location.reload(); // a new page load draws a new shift

  // the helpdesk phone: customer calls ring on the shift's schedule
  const callUI = new CallUI();
  const desk = new Desk({ tickets, hud, ui: callUI, audio, helpdesk, random });
  desk.plan(calls);
  shift.desk = desk;
  desk.onOpen = () => enterDialog();
  desk.onClose = () => leaveDialog();

  // the helpdesk laptop: a PowerShell-style session on the same simulated engine
  const laptopScenario = makeLaptopScenario(desk, tickets);
  const laptop = new ScenarioSession(laptopScenario);

  // ---- tutorial: what to do at each step ----
  function tutorialStep(i, item) {
    if (i === 0) {
      const t = tickets.byId(item.server);
      hud.showMessage(
        'Tutorial 1/3 · a server fault',
        `A server is in trouble. Press T to read ${t.id}, then walk to rack ${t.rack} and press E on ${t.hostId} (U${t.scenario.location.u}) to open its console. The guide on the right takes you through it step by step.`,
        'info',
        25000,
      );
    } else if (i === 1) {
      hud.showMessage(
        'Tutorial 2/3 · a customer calls',
        'The helpdesk phone is ringing. Go through the door next to the parts shelf and press E on the phone. Ask a few questions; if you are not sure yet, say you will check from your side. The laptop next to the phone then walks you through a short PowerShell check.',
        'info',
        25000,
      );
    } else {
      hud.showMessage(
        'Tutorial 3/3 · our fault this time',
        'Another call. Check from the laptop first (try Test-NetConnection on their site with -Port 443). If something fails from OUR side, tell the customer it is on our side: that opens a ticket in the data hall. Fix it there, then call the customer back to confirm.',
        'info',
        25000,
      );
    }
  }
  // Every call you answer gets a guided check on the laptop: the first tutorial call gets the
  // step-by-step PowerShell intro, every other call a check that fits what they called about.
  const introCallId = sequence?.find((s) => s.call)?.call;
  desk.onAnswer = (call) => {
    if (laptop.guideCall === call) return; // a returned call keeps its guide
    laptop.guideCall = call;
    laptop.forceHint = true;
    const c = call.customer;
    if (call.id === introCallId && !laptop.introStarted) {
      laptop.introStarted = true;
      laptop.introCall = call;
      laptop.setSteps(laptopScenario.introSteps(call), {
        banner: `── PowerShell intro for ${c.company} (${c.id}): follow the guide on the right ──`,
        solvedText: '[intro done] Everything works from our side. Call the customer back (E on the phone) and tell them the fix.',
      });
      return;
    }
    laptop.introCall = null;
    laptop.setSteps(laptopScenario.guidedSteps(call), {
      banner: `── Guided check for ${c.company} (${c.id}): follow the guide on the right (Alt+H hides it) ──`,
      solvedText: `[checks done] If something failed on our side, tell ${c.name.split(' ')[0]} it's on our side: that opens a ticket in the data hall. If everything looks healthy from here, the fault is at their end: ask questions to find it, then give the right advice.`,
    });
  };
  hud.setShiftTime(shift.remaining);
  setInterval(() => {
    hud.setShiftTime(shift.remaining);
    if (hud.ticketsOpen) tickets.render(); // keep SLA countdowns live
  }, 1000);

  tickets.onEvent = (name, key) => {
    if (name === 'resolved' && key.kind !== 'customer') desk.onTicketResolved(key); // customers waiting on it need a call back
    if (name === 'physical') audio.play(key); // cable click, caddy slide + latch
    else if (name === 'physical-done') audio.play('beep'); // LEDs change
    else if (name === 'resolved') audio.play('chime');
    else if (name === 'mistake') audio.play('buzz');
    else if (name === 'pickup') audio.play('pickup');
  };

  const interaction = new InteractionManager(camera, hud, { maxDistance: 2.5, occluders: dc.occluders });
  const register = (target) =>
    interaction.add({
      mesh: target.hitbox,
      highlight: target.highlight,
      getPrompt: () => tickets.promptFor(target),
      onInteract: () => {
        const r = tickets.interact(target);
        if (r?.console) openConsole(r.console);
      },
    });
  for (const target of [...dc.racks.values(), dc.core, ...dc.shelf]) register(target);
  for (const host of dc.hosts.values()) {
    register(host);
    for (const fixture of host.targets) register(fixture);
  }
  const deskTarget = (target, prompt, onInteract) => interaction.add({ mesh: target.hitbox, highlight: target.highlight, getPrompt: prompt, onInteract });
  deskTarget(helpdesk.targets.queue, () => 'Open the ticket queue', () => hud.toggleTickets(true));
  deskTarget(helpdesk.targets.phone, () => desk.phonePrompt() ?? 'Desk phone · no calls', () => desk.usePhone());
  deskTarget(helpdesk.targets.laptop, () => 'Use the laptop (PowerShell)', () => {
    enterDialog();
    terminal.open(laptop);
  });
  const radioPlays = () => audio.radioSource === 'file';
  deskTarget(helpdesk.targets.radio, () => (radioPlays() && audio.radioOn ? 'Turn the radio off' : 'Turn the radio on'), () => {
    if (!radioPlays()) {
      audio.play('static');
      hud.toast('Nothing on the radio tonight, just static.');
      return;
    }
    const on = audio.toggleRadio();
    helpdesk.setRadioOn(on);
    try {
      localStorage.setItem('dc-sim-radio', on ? '1' : '0');
    } catch {}
  });
  // going home ends the shift; press twice so it can't happen by accident
  let exitArmed = 0;
  deskTarget(
    helpdesk.targets.exit,
    () => (performance.now() - exitArmed < 4000 ? 'Press E again to go home (ends the shift)' : 'Go home (ends the shift)'),
    () => {
      if (performance.now() - exitArmed < 4000) return shift.end('home');
      exitArmed = performance.now();
      const left = tickets.openTickets.length;
      hud.toast(left ? `${left} ticket${left > 1 ? 's' : ''} still open. Press E again to clock out anyway.` : 'Press E again to clock out.', left ? 'warn' : 'info');
    },
  );
  try {
    if (localStorage.getItem('dc-sim-radio') === '0') audio.toggleRadio();
  } catch {}
  deskTarget(helpdesk.targets.dashboard, () => 'Read the monitoring dashboard', () => {
    const s = tickets.statusSnapshot();
    const lines = [
      ...Object.entries(s.racks).map(([r, st]) => `Rack ${r}: ${st === 'red' ? 'ESCALATED' : 'alarm'}`),
      ...Object.entries(s.switches).map(([r, st]) => `TOR switch in ${r}: uplink ${st === 'red' ? 'down, ESCALATED' : 'down'}`),
    ];
    hud.showMessage('Monitoring · Data Hall 2', lines.length ? lines.join('\n') : 'All racks and switches green.', lines.length ? 'warn' : 'success');
  });

  // footsteps: raised floor tiles in the hall, vinyl in the corridor, carpet in the office
  player.onStep = (pace, crouched) => {
    const z = player.position.z;
    const surface = z <= ROOM.maxZ ? 'tile' : z < CORRIDOR.maxZ ? 'vinyl' : 'carpet';
    audio.step(surface, crouched ? 0.45 : Math.min(1.3, 0.6 + 0.4 * pace));
  };

  // ---- dialogs: consoles, the laptop, calls and the closing form ----
  // The mouse stays captured: a dialog freezes looking and walking and shows an in-game
  // cursor instead, so closing it drops you straight back in without a click. Only Esc
  // can make the browser let go (outside fullscreen); then any key or click recaptures it.
  const dialogOpen = () => terminal.isOpen || callUI.isOpen || hud.editingSummary;
  const cursor = new VirtualCursor(() => player.isLocked);
  let lastDialogClose = 0;
  function enterDialog() {
    hud.setTarget(null);
    hud.showResumeHint(false);
    player.freeze(true);
    cursor.show(true);
  }
  function leaveDialog() {
    lastDialogClose = performance.now();
    if (dialogOpen()) return;
    cursor.show(false);
    player.freeze(false);
    if (!player.isLocked) relock();
  }
  function openConsole(t) {
    tickets.focus(t);
    enterDialog();
    terminal.open(t.session);
  }
  terminal.onResult = (session, res) => {
    const t = tickets.byHost(session.scenario.host);
    if (t) tickets.consoleResult(t, res); // the laptop isn't a ticket
    // finishing the PowerShell intro is the diagnosis, not the fix: say what comes next
    if (session === laptop && res.solvedNow && laptop.introCall) {
      const c = laptop.introCall;
      c.ticket.guide = `Diagnosis done: everything works from our side, and one device is on their guest network. Call ${c.customer.name} back (E on the phone) and tell them which network to use.`;
      tickets.render();
      hud.toast(`Check done. Now call ${c.customer.name} back and tell them the fix.`, 'success');
    }
  };
  terminal.onClose = () => leaveDialog();

  /** Re-capture the mouse; if the browser refuses (no user gesture, e.g. after Esc), the next key or click does it. */
  function relock() {
    player.lock();
    setTimeout(() => {
      if (!player.isLocked && !dialogOpen() && !shift.ended) hud.showResumeHint(true);
    }, 200);
  }
  // any key (except Esc, which browsers don't count as a gesture) or click recaptures the mouse
  const canRelock = () => started && !player.isLocked && !hud.overlayVisible && !shift.ended;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && canRelock()) player.lock();
  });
  document.addEventListener('mousedown', () => {
    if (canRelock()) player.lock();
  });

  // Fullscreen lets Chrome and Edge hand Esc to the game (Keyboard Lock), so Esc closes a
  // console or opens the pause menu without the browser dropping the mouse.
  let fullscreenPref = true;
  try {
    fullscreenPref = localStorage.getItem('dc-sim-fullscreen') !== '0';
  } catch {}
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const showFullscreenPref = () => (fullscreenBtn.textContent = `Fullscreen: ${fullscreenPref ? 'on' : 'off'}`);
  showFullscreenPref();
  function enterFullscreen() {
    if (!fullscreenPref || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => navigator.keyboard?.lock?.(['Escape']))
      .catch(() => {});
  }
  fullscreenBtn.addEventListener('click', () => {
    fullscreenPref = !fullscreenPref;
    try {
      localStorage.setItem('dc-sim-fullscreen', fullscreenPref ? '1' : '0');
    } catch {}
    showFullscreenPref();
    if (!fullscreenPref && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  });
  document.addEventListener('fullscreenchange', () => {
    // entering fullscreen can cost the pointer lock in some browsers: take it back
    if (document.fullscreenElement && started && !player.isLocked && !shift.ended) player.lock();
  });

  // ---- pointer lock / pause flow ----
  let started = false;
  hud.showOverlay(
    'start',
    tutorial
      ? {
          eyebrow: `First shift · guided · ${settings.minutes} minutes`,
          lead: 'Your first night in Data Hall 2. Three short lessons, one at a time: a server fault, a customer call fixed on their side, and a call that turns out to be our fault.',
        }
      : {},
  );
  hud.setLoading(false);

  // Only the big button starts/resumes, so the pause menu's controls can be used.
  document.getElementById('overlay-button').addEventListener('click', () => {
    started = true;
    audio.start({ scene: dc.scene, camera, racks: [...dc.racks.values()], core: dc.core, radio: helpdesk.radio });
    audio.radioReady?.then(() => helpdesk.setRadioOn(radioPlays() && audio.radioOn));
    player.lock();
    enterFullscreen();
  });

  // ---- pause menu: volume, mute, restart, end shift ----
  const volume = document.getElementById('volume');
  const volumeOut = document.getElementById('volume-out');
  const setVolume = (v) => {
    volume.value = v;
    volumeOut.textContent = `${v}%`;
    audio.setVolume(v / 100);
  };
  try {
    const saved = localStorage.getItem('dc-sim-volume');
    if (saved !== null) setVolume(+saved);
  } catch {}
  volume.addEventListener('input', () => {
    setVolume(+volume.value);
    try {
      localStorage.setItem('dc-sim-volume', volume.value);
    } catch {}
  });
  document.getElementById('mute-btn').addEventListener('click', () => hud.setMuted(audio.toggleMute()));
  const restart = document.getElementById('restart-btn');
  let restartArmed = 0;
  restart.addEventListener('click', () => {
    if (Date.now() - restartArmed < 3000) return location.reload(); // a page load is a new shift
    restartArmed = Date.now();
    restart.textContent = 'Click again to restart';
    restart.classList.add('armed');
    setTimeout(() => {
      restart.textContent = 'Restart shift';
      restart.classList.remove('armed');
    }, 3000);
  });
  document.getElementById('end-btn').addEventListener('click', () => shift.end('manual'));
  player.controls.addEventListener('lock', () => {
    cursor.update();
    hud.hideOverlay();
    hud.showResumeHint(false);
    audio.setPaused(false);
  });
  player.controls.addEventListener('unlock', () => {
    cursor.update();
    if (shift.ended) return;
    // Esc in a dialog: the browser let go of the mouse while the dialog closed. Not a pause;
    // the next key or click takes it back.
    if (dialogOpen() || performance.now() - lastDialogClose < 500) {
      if (!dialogOpen()) hud.showResumeHint(true);
      return;
    }
    hud.showResumeHint(false);
    hud.showOverlay(started ? 'paused' : 'start');
    audio.setPaused(true);
  });

  hud.onSummarySubmit = (resolution) => {
    tickets.close(resolution);
    hud.endSummary();
    leaveDialog();
  };
  hud.onSummaryCancel = () => {
    hud.endSummary();
    leaveDialog();
  };

  document.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
    if (e.code === 'KeyM' && !typing && !e.repeat && started) {
      hud.setMuted(audio.toggleMute());
      return;
    }
    // with Keyboard Lock (fullscreen) Esc reaches us instead of the browser: pause ourselves,
    // unless that Esc just closed a dialog
    if (e.key === 'Escape' && player.isLocked && !dialogOpen() && performance.now() - lastDialogClose > 300) {
      player.unlock();
      return;
    }
    // T, C and M also work while the mouse is free (after Esc); E needs you to be looking at something
    const playing = player.isLocked || (started && !hud.overlayVisible && !shift.ended);
    if (!playing || typing || e.repeat || dialogOpen()) return;
    switch (e.code) {
      case 'KeyE':
        e.preventDefault(); // E may open the console; don't let it type an "e" there
        if (player.isLocked) interaction.interact();
        break;
      case 'KeyT':
        hud.toggleTickets();
        break;
      case 'KeyC': {
        e.preventDefault(); // C focuses the summary box; don't let it type a "c" there
        const t = tickets.closable();
        if (!t) {
          // say what's still missing on the ticket you're working on
          const current = tickets.byId(tickets.focusId);
          const open = current && !['QUEUED', 'CLOSED'].includes(current.status) ? current : tickets.openTickets[0];
          hud.showMessage('Nothing to close yet', open ? tickets.whatsLeft(open) : 'There are no open tickets right now.', 'warn', 9000);
          break;
        }
        tickets.focus(t);
        enterDialog();
        hud.beginSummary(t.id, tickets.suggestedSummary(t)); // opens the panel too
        break;
      }
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    player.update(dt);
    dc.update(dt, t);
    helpdesk.update(dt, t, player.position);
    audio.setZone(helpdesk.zoneBlend(player.position), helpdesk.doorOpen);
    shift.update(dt, started && !hud.overlayVisible, { dialogOpen: terminal.isOpen || callUI.isOpen });
    interaction.update(player.isLocked);
    composer.render();
  });

  // handy for debugging from the console
  window.__dc = { dc, player, tickets, camera, terminal, interaction, shift, audio, renderer, composer, helpdesk, desk, callUI };
}

init();
