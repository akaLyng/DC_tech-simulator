import * as THREE from 'three';

const FX_FOR_ACTION = { cable: 'click', sfp: 'click', disk: 'caddy', psu1: 'caddy', psu2: 'caddy' };

/**
 * All game audio, procedural (no files). Everything goes through one THREE.AudioListener
 * on the camera, so master volume and mute apply to fans and effects alike.
 *
 * - every rack gets a looping PositionalAudio fan (louder as you get close)
 * - the core switch gets a deeper, louder fan plus a mains hum
 * - a quiet non-positional room tone fills the gaps
 * - a radio in the helpdesk that plays /audio/lobby.mp3 if it exists (otherwise it's silent)
 * - footsteps that depend on the floor (raised tiles, vinyl, carpet)
 * - one-shot effects: cable click, caddy click, LED beep, chimes, mistake buzz
 *
 * Fans/room tone and the office radio sit on two buses that crossfade with setZone().
 *
 * Nothing is created until start() is called from a click (browser autoplay rules).
 */
export class Sound {
  constructor() {
    this.listener = null;
    this.volume = 0.8;
    this.muted = false;
    this.paused = false;
    this.radioOn = true;
  }

  get started() {
    return this.listener !== null;
  }

  /** Call from a user gesture. `sources`: { scene, camera, racks: [{position}], core: {position}, radio: Object3D } */
  start({ scene, camera, racks, core, radio }) {
    if (this.listener) {
      this.listener.context.resume();
      return;
    }
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    const ctx = this.listener.context;
    ctx.resume();
    this.fanBus = ctx.createGain();
    this.fanBus.connect(this.listener.getInput());
    this.lobbyBus = ctx.createGain();
    this.lobbyBus.gain.value = 0;
    this.lobbyBus.connect(this.listener.getInput());

    const fanBuffer = noiseBuffer(ctx, 4, 0.55, 210);
    const coreBuffer = noiseBuffer(ctx, 4, 0.85, 95);

    for (const rack of racks) {
      this._positional(scene, rack.position.x, 1.3, rack.position.z, fanBuffer, {
        rate: 0.92 + Math.random() * 0.16,
        cutoff: 1500,
        volume: 0.55,
        refDistance: 0.9,
        rolloff: 1.4,
      });
    }
    // the core switch: deeper, louder, plus a 100 Hz mains hum
    this._positional(scene, core.position.x, 1.1, core.position.z, coreBuffer, { rate: 0.85, cutoff: 600, volume: 1.4, refDistance: 1.5, rolloff: 1.1 });
    const hum = new THREE.PositionalAudio(this.listener);
    const osc = ctx.createOscillator();
    osc.frequency.value = 100;
    osc.start();
    hum.setNodeSource(osc);
    hum.setVolume(0.05);
    tunePanner(hum, 1.2, 1.3);
    toBus(hum, this.fanBus);
    const humAnchor = new THREE.Object3D();
    humAnchor.position.set(core.position.x, 1.1, core.position.z);
    humAnchor.add(hum);
    scene.add(humAnchor);

    // quiet room tone so the far corners aren't silent
    const room = new THREE.Audio(this.listener);
    room.setBuffer(noiseBuffer(ctx, 4, 0.9, 0));
    room.setLoop(true);
    room.setFilter(lowpass(ctx, 350));
    room.setVolume(0.12);
    room.play();
    toBus(room, this.fanBus);

    this.radioReady = this._startRadio(radio);
    this._apply(true);
  }

  /** The desk phone ringing: a positional double ring at the phone, audible down the corridor. */
  setRinging(on, phoneObject) {
    if (!this.listener) return;
    if (!this.ring) {
      const ctx = this.listener.context;
      // a soft two-note electronic trill (sine with a mallet-like decay), not a bell
      const len = Math.floor(ctx.sampleRate * 3);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      const notes = [659.25, 830.61, 659.25, 830.61, 659.25, 830.61]; // E5, G#5
      notes.forEach((f, k) => {
        const start = Math.floor(ctx.sampleRate * k * 0.14);
        const n = Math.floor(ctx.sampleRate * 0.5);
        for (let i = 0; i < n && start + i < len; i++) {
          const t = i / ctx.sampleRate;
          const env = Math.min(1, t / 0.006) * Math.exp(-t * 9);
          d[start + i] += 0.35 * env * (Math.sin(2 * Math.PI * f * t) + 0.15 * Math.sin(2 * Math.PI * f * 2 * t));
        }
      });
      this.ring = new THREE.PositionalAudio(this.listener);
      this.ring.setBuffer(buf);
      this.ring.setLoop(true);
      this.ring.setVolume(0.3);
      this.ring.panner.panningModel = 'equalpower';
      this.ring.setRefDistance(2);
      this.ring.setRolloffFactor(0.6);
    }
    if (on) {
      if (phoneObject && this.ring.parent !== phoneObject) phoneObject.add(this.ring);
      if (!this.ring.isPlaying) this.ring.play();
    } else if (this.ring.isPlaying) {
      this.ring.stop();
    }
  }

  /**
   * Crossfade between the server room and the helpdesk. `blend` is 0 in the server room
   * and 1 in the office; a closed door muffles the fans further.
   */
  setZone(blend, doorOpen) {
    if (!this.listener) return;
    const muffle = blend > 0.5 && doorOpen < 0.3 ? 0.5 : 1;
    const fan = (1 - 0.88 * blend) * muffle;
    const lobby = blend;
    if (Math.abs(fan - (this._fan ?? -1)) < 0.01 && Math.abs(lobby - (this._lobby ?? -1)) < 0.01) return;
    this._fan = fan;
    this._lobby = lobby;
    const now = this.listener.context.currentTime;
    this.fanBus.gain.setTargetAtTime(fan, now, 0.25);
    this.lobbyBus.gain.setTargetAtTime(lobby, now, 0.4);
  }

  /**
   * The office radio: a quiet positional source on the cabinet. It plays your own track
   * at public/audio/lobby.mp3 if it exists; without one the radio stays silent.
   */
  async _startRadio(anchor) {
    const ctx = this.listener.context;
    this.radioIn = ctx.createGain();
    this.radioIn.gain.value = this.radioOn ? 1 : 0;
    const radio = new THREE.PositionalAudio(this.listener);
    radio.setNodeSource(this.radioIn);
    radio.setVolume(0.28);
    tunePanner(radio, 1, 1.2);
    toBus(radio, this.lobbyBus);
    (anchor ?? new THREE.Object3D()).add(radio);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}audio/lobby.mp3`);
      // Vite answers missing files with index.html, so check it really is audio
      if (res.ok && (res.headers.get('content-type') || '').startsWith('audio')) {
        const src = ctx.createBufferSource();
        src.buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        src.loop = true;
        src.connect(this.radioIn);
        src.start();
        this.radioSource = 'file';
        return;
      }
    } catch {}
    this.radioSource = null;
  }

  /** E on the radio. Returns whether it's playing now. */
  toggleRadio() {
    this.radioOn = !this.radioOn;
    if (this.listener && this.radioIn) {
      this.radioIn.gain.setTargetAtTime(this.radioOn ? 1 : 0, this.listener.context.currentTime, 0.05);
    }
    return this.radioOn;
  }

  setVolume(v) {
    this.volume = v;
    this._apply();
  }

  toggleMute() {
    this.muted = !this.muted;
    this._apply();
    return this.muted;
  }

  setPaused(paused) {
    this.paused = paused;
    this._apply();
  }

  /** One-shot effects: click, caddy, beep, chime, newTicket, buzz, pickup, or a physical action key. */
  play(name) {
    if (!this.listener) return;
    const fx = FX_FOR_ACTION[name] ?? name;
    const ctx = this.listener.context;
    const out = this.listener.getInput();
    const t = ctx.currentTime;
    switch (fx) {
      case 'click':
        burst(ctx, out, t, 0.025, 2600, 0.5);
        tone(ctx, out, t + 0.005, 2100, 0.03, 0.12, 'square');
        break;
      case 'caddy':
        burst(ctx, out, t, 0.35, 900, 0.18); // slide
        burst(ctx, out, t + 0.35, 0.03, 2400, 0.45); // latch
        tone(ctx, out, t + 0.36, 1700, 0.03, 0.1, 'square');
        break;
      case 'beep':
        tone(ctx, out, t, 1550, 0.09, 0.12);
        break;
      case 'chime':
        [660, 880, 1320].forEach((f, i) => tone(ctx, out, t + i * 0.12, f, 0.4, 0.14));
        break;
      case 'newTicket':
        [880, 1320].forEach((f, i) => tone(ctx, out, t + i * 0.16, f, 0.35, 0.12));
        break;
      case 'buzz':
        tone(ctx, out, t, 140, 0.22, 0.1, 'square');
        tone(ctx, out, t + 0.25, 120, 0.22, 0.1, 'square');
        break;
      case 'pickup':
        burst(ctx, out, t, 0.05, 1200, 0.25);
        break;
      case 'static': // a radio with no station: a short swish of noise
        burst(ctx, out, t, 0.7, 2200, 0.06);
        break;
    }
  }

  /**
   * One footstep. `surface`: 'tile' (raised floor tiles, a hollow knock), 'vinyl' (the
   * corridor) or 'carpet' (the office, a soft thud). `strength` ~0.5 crouching .. 1.3 running.
   */
  step(surface, strength = 1) {
    if (!this.listener) return;
    const ctx = this.listener.context;
    const out = this.listener.getInput();
    const t = ctx.currentTime;
    const v = strength * (0.85 + Math.random() * 0.3);
    const p = 0.92 + Math.random() * 0.16; // no two steps quite alike
    if (surface === 'tile') {
      burst(ctx, out, t, 0.05, 420 * p, 1.2 * v); // heel on the panel
      tone(ctx, out, t, 95 * p, 0.12, 0.22 * v); // the hollow under the raised floor
      burst(ctx, out, t + 0.012, 0.02, 3200 * p, 0.16 * v); // sole scuff
    } else if (surface === 'vinyl') {
      burst(ctx, out, t, 0.04, 700 * p, 0.65 * v);
      burst(ctx, out, t + 0.01, 0.025, 2600 * p, 0.1 * v);
    } else {
      burst(ctx, out, t, 0.09, 260 * p, 0.35 * v); // carpet: just a dull thud
    }
  }

  _positional(scene, x, y, z, buffer, { rate, cutoff, volume, refDistance, rolloff }) {
    const a = new THREE.PositionalAudio(this.listener);
    a.setBuffer(buffer);
    a.setLoop(true);
    a.setPlaybackRate(rate);
    a.setFilter(lowpass(this.listener.context, cutoff));
    a.setVolume(volume);
    a.offset = Math.random() * 3; // racks start at different points in the loop
    tunePanner(a, refDistance, rolloff);
    const anchor = new THREE.Object3D();
    anchor.position.set(x, y, z);
    anchor.add(a);
    scene.add(anchor);
    a.play();
    toBus(a, this.fanBus);
    return a;
  }

  _apply(fadeIn = false) {
    if (!this.listener) return;
    const target = this.muted ? 0 : this.volume * (this.paused ? 0.3 : 1);
    const g = this.listener.gain.gain;
    const now = this.listener.context.currentTime;
    g.cancelScheduledValues(now);
    if (fadeIn) {
      g.setValueAtTime(0, now);
      g.linearRampToValueAtTime(target, now + 2);
    } else {
      g.setTargetAtTime(target, now, 0.08);
    }
  }
}

/** Route a THREE.Audio's output through one of our buses instead of straight to the listener. */
function toBus(audio, bus) {
  audio.gain.disconnect();
  audio.gain.connect(bus);
}

function tunePanner(a, refDistance, rolloff) {
  a.panner.panningModel = 'equalpower'; // cheaper than HRTF, plenty for fan noise
  a.setDistanceModel('inverse');
  a.setRefDistance(refDistance);
  a.setRolloffFactor(rolloff);
  a.setMaxDistance(40);
}

function lowpass(ctx, freq) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = freq;
  return f;
}

/** Looping fan noise: brown noise, with an optional blade tone mixed in. */
function noiseBuffer(ctx, seconds, brownness, bladeHz) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    let v = last * 3.5 * brownness + white * 0.06 * (1 - brownness);
    // blade-pass tone; whole cycles per buffer so the loop is seamless
    if (bladeHz) v += 0.035 * Math.sin((2 * Math.PI * Math.round(bladeHz * seconds) * i) / len);
    data[i] = v;
  }
  // crossfade the ends so the loop point doesn't click
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    data[i] = data[i] * k + data[len - fade + i] * (1 - k);
  }
  return buf;
}

function tone(ctx, out, t0, freq, dur, gain, type = 'sine') {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
  osc.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function burst(ctx, out, t0, dur, cutoff, gain) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = cutoff;
  f.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(out);
  src.start(t0);
}
