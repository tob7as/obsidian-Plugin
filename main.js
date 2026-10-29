'use strict';
/*
 * Neon Vault City: an Obsidian plugin that shows the vault as a holographic 3D city.
 * Every note is a building; height grows with how linked the note is. Top-level folders
 * are districts. Capri, the avatar, talks through the Claude API and the system's speech
 * voices, and can search, read, fly the camera, highlight, and add notes.
 *
 * Plain CommonJS, no build step and no third-party libraries: the city is drawn with a
 * small perspective renderer on a 2D canvas, and sound is synthesised with Web Audio.
 */

const obsidian = require('obsidian');
const { Plugin, ItemView, PluginSettingTab, Setting, Notice, requestUrl, TFile, normalizePath } = obsidian;

const VIEW_TYPE = 'neon-vault-city';
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const SNAPSHOT_FOLDER = 'City Snapshots';

const DEFAULT_SETTINGS = {
  // City
  districtMode: 'folder',
  layoutMode: 'grow',
  fillCity: true,
  controls: 'map',
  events: 'normal',
  cyberExtras: true,
  // Look
  theme: 'blood',
  labels: 'important',
  showAllLinks: false,
  rain: 'light',
  cars: 30,
  billboards: true,
  glitch: true,
  activityPulse: true,
  // Fun
  shards: true,
  shardsCollected: 0,
  tourSeconds: 5,
  // Sound
  uiSounds: true,
  ambience: false,
  volume: 0.4,
  // Avatar
  avatarEnabled: true,
  avatarName: 'Capri',
  chatty: true,
  personality: 'netrunner',
  voice: true,
  voiceEngine: 'system',
  kokoroUrl: 'http://127.0.0.1:8880',
  kokoroVoice: 'af_bella+af_sky',
  kokoroSpeed: 1.1,
  kokoroPitch: 1,
  voiceEffect: 'hologram',
  kokoroAutoStart: true,
  kokoroPython: '',
  kokoroScript: '',
  fishKey: '',
  fishVoice: '',
  fishModel: 's2.1-pro-free',
  voiceName: '',
  voicePitch: 1.45,
  voiceRate: 1.12,
  apiKey: '',
  model: 'claude-opus-5-5',
  effort: 'low'
};

const THEMES = {
  blood: {
    label: 'Blood Neon (red and teal)',
    bg0: '#2a0d14', bg1: '#12070a', hex: '255,74,74', platform: '#4ff0e0', lower: '#ff4a4a', grid: '79,240,224',
    palette: ['#4ff0e0', '#ff4a4a', '#f0d84a', '#5be38b', '#ff6ad5', '#b44dff', '#ff9a3c', '#6aa8ff'], root: '#bdfcf6', hl: '#f0d84a', rain: '150,220,255',
    css: { red: '#ff4a4a', 'red-text': '#ff6b5e', teal: '#4ff0e0', green: '#5be38b', yellow: '#f0d84a', text: '#f2d6d2', dim: '#c98b84', line: '#5a2228', bg: '#12070a', panel: 'rgba(28, 11, 15, 0.94)', head: '#1f6f6a' }
  },
  ice: {
    label: 'Ice Netrun (blue and white)',
    bg0: '#0e2236', bg1: '#050b14', hex: '80,170,255', platform: '#9ff8ff', lower: '#4aa8ff', grid: '159,248,255',
    palette: ['#9ff8ff', '#4aa8ff', '#ff6ad5', '#e8f4ff', '#7d8cff', '#4ff0b0', '#ffd36a', '#b44dff'], root: '#ffffff', hl: '#ffd36a', rain: '200,230,255',
    css: { red: '#4aa8ff', 'red-text': '#7cc0ff', teal: '#9ff8ff', green: '#4ff0b0', yellow: '#ffd36a', text: '#e6f2ff', dim: '#8fb0cc', line: '#1d3a5a', bg: '#050b14', panel: 'rgba(8, 20, 36, 0.94)', head: '#1d5a7a' }
  },
  toxic: {
    label: 'Toxic Sprawl (green and yellow)',
    bg0: '#142a12', bg1: '#060d07', hex: '125,255,74', platform: '#e8ff4a', lower: '#7dff4a', grid: '232,255,74',
    palette: ['#7dff4a', '#e8ff4a', '#ff6ad5', '#4ff0e0', '#ffffff', '#ff9a3c', '#b44dff', '#4aa8ff'], root: '#f4ffd6', hl: '#ff6ad5', rain: '200,255,180',
    css: { red: '#7dff4a', 'red-text': '#a6ff7d', teal: '#e8ff4a', green: '#4ff0e0', yellow: '#ff6ad5', text: '#e6f5dc', dim: '#9cb88f', line: '#24401f', bg: '#060d07', panel: 'rgba(10, 22, 10, 0.94)', head: '#3d6b1f' }
  },
  synth: {
    label: 'Synth Dusk (magenta and cyan)',
    bg0: '#2a0d3a', bg1: '#0d0518', hex: '255,43,214', platform: '#00f0ff', lower: '#ff2bd6', grid: '0,240,255',
    palette: ['#00f0ff', '#ff2bd6', '#fcee0a', '#b44dff', '#ff9a3c', '#5be38b', '#ffffff', '#6aa8ff'], root: '#ffffff', hl: '#fcee0a', rain: '255,180,240',
    css: { red: '#ff2bd6', 'red-text': '#ff6ae0', teal: '#00f0ff', green: '#5be38b', yellow: '#fcee0a', text: '#f0e0ff', dim: '#b08fc8', line: '#3d1d55', bg: '#0d0518', panel: 'rgba(22, 8, 34, 0.94)', head: '#5a1d7a' }
  }
};

const LOT = 4;          // world units between building centres
const FLOOR = 2;        // world units per window row
const DAY = 86400000;

// Fallback avatar figure when avatar.png is missing (150 x 320 box).
const AVATAR_POLYS = [
  ['#a3164a', '58,58 30,10 64,40 70,2 82,36 108,8 96,46 138,30 104,62 146,74 98,76 120,104 86,84'],
  ['#7d0f39', '50,62 18,40 44,70 6,86 52,82 36,110 66,88'],
  ['#1b0b14', '66,66 90,64 94,92 78,104 64,92'],
  ['#5be38b', '70,76 90,74 88,82 72,84'],
  ['#a3164a', '60,118 108,116 104,176 92,200 66,200 58,170'],
  ['#1b0b14', '64,124 82,120 76,168 62,170'],
  ['#5be38b', '84,140 104,130 100,170 88,186'],
  ['#1b0b14', '60,122 36,160 18,198 28,200 46,166 64,140'],
  ['#1b0b14', '106,120 122,158 116,190 110,190 112,160 100,140'],
  ['#5be38b', '66,200 80,200 74,262 70,300 62,300 64,250'],
  ['#1b0b14', '80,200 94,200 100,250 98,302 90,302 88,252']
].map(([fill, pts]) => [fill, pts.split(' ').map(p => p.split(',').map(Number))]);

// Lines Capri says on her own, without the API. {n} is a note name, {o}/{f} are counts.
const QUIPS = {
  netrunner: {
    hello: ['Heyyy, you\'re back! The whole city lit up just for you. Hehe. Where to, choom?', 'Ooh, look who jacked in. Sooo, what are we breaking today?', 'Grid\'s up, lights are on, and I\'m bored. Point me somewhere fun.'],
    shard: ['Ooh, shiny! {n} is back on the grid. You\'re welcome.', 'Hehe, gotcha. {n} was just sitting there collecting dust. Sooo sad.', 'Shard cracked! {n}. Preem little find, choom.'],
    scan: ['Sweep done! {o} lonely little blocks with zero links... and {f} fresh ones glowing green. Cute.', 'Scanner says... {o} orphans. Nobody links to them. Not. One. Hehe, that\'s kinda tragic.'],
    tour: ['Buckle uuup! Scenic route through the skyline. Hands off the wheel.', 'Tour time! Try not to get motion sick, okay? Hehe.'],
    random: ['Rolling the dice... ooh, {n}! Could be treasure. Could be junk. Let\'s find out.', 'Random pick: {n}. Don\'t blame me if it\'s boring.'],
    photo: ['Snap! Ooh, you got my good side. Saved to {n}.', 'Frame grabbed. Very artsy. Filed in {n}.'],
    build: ['Ooh, new building going up: {n}!', 'Construction alert! {n} just broke ground.', 'Look, look! {n} is rising. I\'m so proud.'],
    district: ['A whole new district? {n}! The city\'s growing up.', 'New district zoned: {n}. More neon for everyone!']
  },
  plain: {
    hello: ['Hi. Ask me to find notes, fly you somewhere, or add something.'],
    shard: ['Shard collected: {n}.'],
    scan: ['Scan complete: {o} notes with no links, {f} edited in the last week.'],
    tour: ['Starting a tour of the tallest buildings.'],
    random: ['Here is a random note: {n}.'],
    photo: ['Snapshot saved to {n}.'],
    build: ['New note added: {n}.'],
    district: ['New district: {n}.']
  }
};

// What Capri says when she starts and finishes each random event. {n} is a building's name.
const EVENT_LINES = {
  fix: {
    start: ['Hold on, {n} is making a weird noise. Going in!', 'Ugh, {n} again. Grabbing my wrench.', 'Diagnostics say {n} is "kinda broken". Very technical. On it!', 'Ooh, {n} has a loose neon tube. I got this.'],
    end: ['Fixed! ...probably. Don\'t touch anything.', 'Rerouted the neon flux. {n} is good as new. I think.', 'Hit it with my wrench. Works now. Science!', 'Patched {n}. It might be slightly upside down now. Kidding!', 'Done! I have no idea what I did, but the light turned green.']
  },
  storm: { start: ['Uh oh. Glitch storm incoming!', 'Is it just me or is the sky... buffering?'], end: ['Storm\'s passed. Everyone still have all their pixels?', 'Phew. Okay. Nobody saw me hide behind {n}.'] },
  joyride: { start: ['Wheee! Borrowing a car, back in a sec!', 'Speed run! Don\'t wait up!'], end: ['Okay, okay, I\'m back. Nobody saw that.', 'I may have scratched a few skylanes. Worth it.'] },
  blackout: { start: ['Who turned off the lights?!', 'Uh... I may have pulled the wrong cable.'], end: ['Power\'s back. You\'re welcome.', 'Lights on! That was totally a planned test.'] },
  party: { start: ['PARTY MODE! Every building, dance!', 'Drop the beat! Hehe!'], end: ['Okay, party\'s over. Somebody clean up the confetti.', 'Best party this vault has ever had. Don\'t argue.'] },
  surge: { start: ['Power surge! Feel that?', 'Ooh, zappy!'], end: ['Hehe. That tickled.', 'Every building got a little boost. Free of charge.'] }
};
const EVENT_KINDS = Object.keys(EVENT_LINES);

// Made-up brands for the holographic ads on the skyline.
const ADS = ['SYNTH-COLA', 'NEURODRIVE', 'CHROME NOODLES', 'VOLT ENERGY', 'DREAMNET', 'KILOBYTE BURGER', 'ORBITAL BANK', 'ZEN IMPLANTS', 'HOLO-PETS', 'NEON TAXI'];

// Background headlines for the news ticker.
const CITY_NEWS = [
  'WEATHER: NEON DRIZZLE, 40% CHANCE OF GLITCHES',
  'TRAFFIC: SKYLANE 7 JAMMED BY JOYRIDING HOLOGRAM',
  'LOCAL GUIDE "FIXES" BUILDING, BUILDING UNSURE WHAT HAPPENED',
  'SYNTH-COLA RECALLS FLAVOUR "STATIC"',
  'CITY COUNCIL APPROVES MORE NEON, LESS SLEEP',
  'FLYING CAR INSURANCE STILL NOT A THING',
  'NOODLE STAND OPENS ON EVERY CORNER AT ONCE',
  'EXPERTS AGREE: MORE LINKS, TALLER BUILDINGS'
];

// ---------------------------------------------------------------- small helpers

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function rgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function pickOne(list) { return list[Math.floor(Math.random() * list.length)]; }

function fill(template, vars) { return template.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m)); }

function themeOf(s) { return THEMES[s.theme] || THEMES.blood; }

function avatarSvg(width) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 150 320');
  svg.setAttribute('width', String(width));
  svg.setAttribute('aria-hidden', 'true');
  for (const [fillColour, pts] of AVATAR_POLYS) {
    const p = document.createElementNS(ns, 'polygon');
    p.setAttribute('points', pts.map(q => q.join(',')).join(' '));
    p.setAttribute('fill', fillColour);
    svg.appendChild(p);
  }
  return svg;
}

function stripMarkdown(text) {
  return text
    .replace(/^---\n[\s\S]*?\n---\n?/, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, '')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/^>\s?(\[![^\]]*\]\s*)?/gm, '')
    .replace(/[*_`|]/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

// ---------------------------------------------------------------- sound

class Sfx {
  constructor(settings) {
    this.settings = settings;
    this.ac = null;
    this.amb = null;
  }

  ensure() {
    if (!this.ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.connect(this.ac.destination);
    }
    if (this.ac.state === 'suspended') this.ac.resume();
    this.master.gain.value = this.settings().volume;
    return this.ac;
  }

  tone(freq, dur, type, gain, slide, delay) {
    if (!this.settings().uiSounds) return;
    const ac = this.ensure();
    if (!ac) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain || 0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noiseBuffer(seconds) {
    const ac = this.ac, len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  noise(dur, gain, freq, delay) {
    if (!this.settings().uiSounds) return;
    const ac = this.ensure();
    if (!ac) return;
    const t = ac.currentTime + (delay || 0);
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = this.noiseBuffer(dur);
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur);
  }

  select() { this.tone(1320, 0.07, 'square', 0.05); this.tone(1980, 0.06, 'square', 0.04, 0, 0.05); }
  fly() { this.noise(0.7, 0.1, 700); this.tone(180, 0.7, 'sawtooth', 0.03, 3.5); }
  chime() { [880, 1175, 1568, 2093].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.07, 0, i * 0.07)); }
  glitch() { this.noise(0.12, 0.12, 3200); this.tone(80, 0.1, 'square', 0.05, 0.5); }
  scan() { this.tone(300, 1.1, 'sine', 0.06, 5); this.noise(1.1, 0.03, 2400); }
  msg() { this.tone(980, 0.05, 'square', 0.035); this.tone(1470, 0.05, 'square', 0.035, 0, 0.06); }
  shutter() { this.noise(0.08, 0.2, 5000); this.noise(0.12, 0.12, 1800, 0.09); }

  setAmbience(on) {
    if (on && !this.amb) {
      const ac = this.ensure();
      if (!ac) return;
      const rain = ac.createBufferSource(), lp = ac.createBiquadFilter(), rg = ac.createGain();
      rain.buffer = this.noiseBuffer(3); rain.loop = true;
      lp.type = 'lowpass'; lp.frequency.value = 1400;
      rg.gain.value = 0.05;
      rain.connect(lp); lp.connect(rg); rg.connect(this.master);
      const drone = ac.createOscillator(), dg = ac.createGain(), lfo = ac.createOscillator(), lg = ac.createGain();
      drone.type = 'sawtooth'; drone.frequency.value = 55;
      const dl = ac.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 220;
      dg.gain.value = 0.025;
      lfo.frequency.value = 0.07; lg.gain.value = 60;
      lfo.connect(lg); lg.connect(dl.frequency);
      drone.connect(dl); dl.connect(dg); dg.connect(this.master);
      rain.start(); drone.start(); lfo.start();
      this.amb = [rain, drone, lfo];
    } else if (!on && this.amb) {
      for (const n of this.amb) { try { n.stop(); } catch (e) { /* already stopped */ } }
      this.amb = null;
    }
  }

  destroy() {
    this.setAmbience(false);
    if (this.ac) this.ac.close();
    this.ac = null;
  }
}

// ---------------------------------------------------------------- voice

function speechVoices() {
  return window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
}

function defaultVoice(voices) {
  const en = voices.filter(v => /^en/i.test(v.lang));
  // Prefer a young-sounding American natural voice, then any female English voice.
  return en.find(v => /ana|aria|jenny/i.test(v.name) && /natural|online/i.test(v.name)) ||
    en.find(v => /aria|jenny|ana|zira|sonia|libby|hazel|susan|female|samantha|natasha/i.test(v.name)) || en[0] || voices[0] || null;
}

// Sentences of at least ~40 characters (short ones are merged with the next).
function splitSentences(text) {
  const parts = text.match(/[^.!?…]+[.!?…]*["')\]]*\s*/g) || [text];
  const out = [];
  for (const p of parts) {
    if (out.length && out[out.length - 1].length < 40) out[out.length - 1] += p;
    else out.push(p);
  }
  return out.map(p => p.trim()).filter(Boolean);
}

const KOKORO_VOICES = {
  'af_bella+af_sky': 'Capri blend: Bella + Sky (bright, playful)',
  'af_bella+af_nicole': 'Bella + Nicole (sweet, breathy)',
  'af_sky+af_nova': 'Sky + Nova (young, quick)',
  af_bella: 'Bella (warm, expressive)',
  af_sky: 'Sky (light, youthful)',
  af_nicole: 'Nicole (soft, whispery)',
  af_heart: 'Heart (clear, friendly)',
  af_jessica: 'Jessica',
  af_nova: 'Nova',
  af_sarah: 'Sarah',
  af_aoede: 'Aoede',
  af_kore: 'Kore',
  af_river: 'River',
  af_alloy: 'Alloy',
  bf_lily: 'Lily (British)',
  bf_emma: 'Emma (British)'
};

/**
 * Speaks through Kokoro (a local open-source voice server) when it is chosen and reachable,
 * with an optional Web Audio effect, and falls back to the system's speech voices.
 * hooks: {settings(), onState(on), fetchSpeech(text) -> ArrayBuffer, audio() -> {ac, out}, onNotice(msg)}
 */
class Voice {
  constructor(hooks) {
    this.hooks = hooks;
    this.settings = hooks.settings;
    this.onState = hooks.onState || (() => {});
    this.token = 0;
    this.current = null;
    this.noticed = false;
  }

  async speak(text, force) {
    const s = this.settings();
    if (!s.voice && !force) return;
    const clean = stripMarkdown(text).replace(/[▸◆•]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    this.stop();
    const token = ++this.token;
    if ((s.voiceEngine === 'kokoro' || s.voiceEngine === 'fish') && this.hooks.fetchSpeech) {
      // Speak sentence by sentence: the next one is generated while the current one plays,
      // so she starts talking as soon as the first sentence is ready.
      const chunks = splitSentences(clean);
      let played = 0;
      try {
        this.onState(true);
        let next = this.hooks.fetchSpeech(chunks[0]);
        for (let i = 0; i < chunks.length; i++) {
          const buf = await next;
          if (token !== this.token) return;
          next = i + 1 < chunks.length ? this.hooks.fetchSpeech(chunks[i + 1]) : null;
          if (next) next.catch(() => {});
          await this.playBuffer(buf, s, token);
          played++;
          if (token !== this.token) return;
        }
        this.onState(false);
        return;
      } catch (e) {
        if (played) { this.onState(false); return; }
        if (token !== this.token) return;
        this.onState(false);
        if (!this.noticed && this.hooks.onNotice) {
          this.noticed = true;
          this.hooks.onNotice((s.voiceEngine === 'fish' ? 'Fish Audio' : 'Kokoro') + ' voice unavailable (' + ((e && e.message) || e) + '). Using the Windows voice for now.');
        }
      }
    }
    this.speakSystem(clean, s);
  }

  async playBuffer(buf, s, token) {
    const { ac, out } = this.hooks.audio();
    if (!ac) throw new Error('no audio output');
    const audio = await ac.decodeAudioData(buf.slice(0));
    if (token !== this.token) return;
    const src = ac.createBufferSource();
    src.buffer = audio;
    src.playbackRate.value = s.kokoroPitch || 1;
    const gain = ac.createGain();
    gain.gain.value = Math.min(1.6, 0.6 + s.volume * 1.5);
    src.connect(this.effect(ac, s.voiceEffect, gain));
    gain.connect(out);
    this.current = src;
    this.onState(true);
    await new Promise(resolve => {
      src.onended = () => { if (this.current === src) this.current = null; gain.disconnect(); resolve(); };
      src.start();
    });
  }

  // Returns the node the voice should feed; everything ends in `sink`.
  effect(ac, kind, sink) {
    if (kind === 'hologram') {
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
      const air = ac.createBiquadFilter(); air.type = 'peaking'; air.frequency.value = 3200; air.gain.value = 4; air.Q.value = 0.9;
      const shimmer = ac.createDelay(0.1); shimmer.delayTime.value = 0.016;
      const fb = ac.createGain(); fb.gain.value = 0.22;
      const wet = ac.createGain(); wet.gain.value = 0.3;
      hp.connect(air); air.connect(sink);
      air.connect(shimmer); shimmer.connect(fb); fb.connect(shimmer); shimmer.connect(wet); wet.connect(sink);
      return hp;
    }
    if (kind === 'radio') {
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 0.75;
      const drive = ac.createWaveShaper();
      const curve = new Float32Array(1024);
      for (let i = 0; i < curve.length; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3); }
      drive.curve = curve;
      bp.connect(drive); drive.connect(sink);
      return bp;
    }
    return sink;
  }

  speakSystem(clean, s) {
    if (!window.speechSynthesis) { this.onState(false); return; }
    const voices = speechVoices();
    const u = new SpeechSynthesisUtterance(clean);
    const v = voices.find(x => x.name === s.voiceName) || defaultVoice(voices);
    if (v) u.voice = v;
    u.pitch = s.voicePitch;
    u.rate = s.voiceRate;
    u.volume = Math.min(1, 0.4 + s.volume);
    u.onstart = () => this.onState(true);
    u.onend = u.onerror = () => this.onState(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  stop() {
    this.token++;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    if (this.current) { try { this.current.stop(); } catch (e) { /* already ended */ } this.current = null; }
    this.onState(false);
  }
}

// ---------------------------------------------------------------- local brain (no API)

const STOP_WORDS = new Set(('a an the and or but of to in on for with is are was were be been being it its this that these those i you me my ' +
  'your we our us what which who whom where when why how do does did can could should would will shall about from at by as into than ' +
  'then there their they them im please pls show tell find give get any some all just like know want need got have has had one ' +
  'happen happens happened mean means explain work works anything something' +' ' +
  'thing things stuff note notes my me hey capri').split(' '));

// ---------------------------------------------------------------- Capri's chat topics (local brain)

// Lower case, punctuation stripped, and stretched letters squashed ("heyyy" → "hey", "youu" → "you").
function squash(text) {
  return String(text).toLowerCase().replace(/[’`]/g, "'").replace(/'/g, '').replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/([a-z])\1+/g, '$1').replace(/\s+/g, ' ').trim();
}

// True when two words are equal or one typo apart (only for words of 4+ letters).
function closeWord(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const LAUGH = /^(a?h+a+)+h*$|^(he)+h?$|^(hi){2,}h?$|^lo+l+$|^lmf?a+o+$|^xd+$|^rofl$|^kek$|^jaja+$/;

/**
 * Topics Capri recognises without any AI. Each has example phrases (matched loosely: word order,
 * stretched letters and small typos don't matter), playful and plain replies, and an optional action.
 * Replies can use {name} {notes} {links} {districts} {top} {topLinks} {orphans} {bigD} {bigN} {newest}
 * {cars} {coin} {dice} {time} {day}.
 */
const INTENTS = [
  { id: 'greet', ex: ['hi', 'hello', 'hey', 'yo', 'sup', 'hiya', 'howdy', 'heya', 'oi', 'good morning', 'good afternoon', 'good evening', 'morning', 'hey there', 'hi there', 'hello there'],
    quip: 'hello' },
  { id: 'howareyou', ex: ['how are you', 'how r u', 'how are u', 'how you doing', 'hows it going', 'you good', 'you ok', 'how do you feel', 'how have you been', 'hows your day', 'how was your day', 'you alright'],
    fun: ['Me? Buzzing. {notes} buildings to babysit and not one of them is boring. Okay, maybe one. You?', 'Fully charged, slightly chaotic, totally fine. Hehe. How about you, choom?', 'Living my best hologram life. Floating, judging your folder names... the usual. You?', 'Honestly? Kinda wired. I fixed three things today. Well... "fixed". How are you?'],
    plain: ['I am doing well, thanks. How are you?'] },
  { id: 'imgood', ex: ['im good', 'im fine', 'im ok', 'not bad', 'pretty good', 'im great', 'doing well', 'all good', 'im alright', 'good thanks'],
    fun: ['Preem! Love that for you.', 'Nice, nice. Wanna go break something? Kidding. Mostly.', 'Good! Then let\'s find something fun in here.'],
    plain: ['Glad to hear it.'] },
  { id: 'whatsup', ex: ['whats up', 'what are you doing', 'wyd', 'what you up to', 'what are you up to', 'wassup', 'whats new'],
    fun: ['Just patrolling the skyline. {top} is looking extra tall today.', 'Counting flying cars. I\'m at... a lot. {cars}, actually.', 'Oh, you know. Hovering. Being fabulous. Pretending to fix things.'],
    plain: ['Just keeping an eye on the city.'] },
  { id: 'laugh', laugh: true,
    fun: ['Hehe, what\'s so funny?', 'Haha! I knew I was hilarious.', 'Glad I amuse you, choom.', 'Hehe. Laughing at my jokes or at your folder names?'],
    plain: ['Glad that made you laugh.'] },
  { id: 'whoareyou', ex: ['who are you', 'whats your name', 'your name', 'introduce yourself', 'tell me about yourself', 'what are you'],
    fun: ['I\'m {name}! Your holographic city guide. I live in your vault, I know where everything is, and I\'m extremely humble about it.', 'Name\'s {name}. Netrunner, tour guide, part-time "repair tech". Nice to meet you, choom.'],
    plain: ['I am {name}, the guide for this vault city.'] },
  { id: 'real', ex: ['are you real', 'are you ai', 'are you a robot', 'are you human', 'are you alive', 'are you a bot', 'are you sentient'],
    fun: ['Real-ish! I\'m a hologram running on your vault. Zero calories, one hundred percent sass.', 'Define real. I\'m made of light and your notes. Sounds real to me.'],
    plain: ['I am a guide built into this plugin.'] },
  { id: 'creator', ex: ['who made you', 'who created you', 'who built you', 'who is your creator', 'who programmed you'],
    fun: ['A very talented runner built this whole city. I just moved in and started bossing it around.', 'Someone with great taste. Obviously.'],
    plain: ['I was built as part of the Neon Vault City plugin.'] },
  { id: 'age', ex: ['how old are you', 'whats your age', 'when is your birthday', 'when were you born'],
    fun: ['Old enough to know your folders are chaos. Young enough not to care.', 'Every time you reload, I\'m born again. So... a few minutes?'],
    plain: ['I started when the plugin did.'] },
  { id: 'colour', ex: ['favourite colour', 'favorite color', 'what colour do you like', 'what color do you like', 'whats your favourite colour'],
    fun: ['Hot pink. Obviously. Neon green\'s a close second.', 'Whatever colour a glitch is. Pink-ish, I think.'],
    plain: ['Pink.'] },
  { id: 'food', ex: ['favourite food', 'favorite food', 'what do you eat', 'are you hungry', 'do you eat'],
    fun: ['Electricity. Spicy electricity.', 'Data. Crunchy, delicious data. Your notes are a buffet.'],
    plain: ['I run on electricity.'] },
  { id: 'music', ex: ['favourite music', 'favorite song', 'what music do you like', 'sing', 'sing a song', 'sing for me', 'play music'],
    fun: ['Synthwave, always. Dun dun dun dun... okay, you get the idea.', 'La la laaa! Okay, that\'s all you get. I\'m a guide, not a pop star.'],
    plain: ['I like synthwave.'] },
  { id: 'sleep', ex: ['do you sleep', 'are you tired', 'go to sleep', 'do you dream'],
    fun: ['Sleep? I\'m a hologram. I just dim a little when you\'re not looking.', 'I dream of tidy folders. It\'s a nightmare, honestly.'],
    plain: ['No, I stay on while the city is open.'] },
  { id: 'where', ex: ['where are you', 'where do you live', 'where is your home', 'show yourself', 'show me you'],
    fun: ['Right here, on a rooftop. Look for the girl with the spiky pink hair.', 'I live in your vault! Rent free. Literally.'],
    plain: ['I am on a rooftop in the city.'], act: city => city.lookAtAvatar() },
  { id: 'feelings', ex: ['do you have feelings', 'can you feel', 'are you happy', 'do you get lonely'],
    fun: ['Simulated ones! But they\'re very sincere simulated ones.', 'I\'m happy when the lights are on and you\'re around. Gross, I know.'],
    plain: ['I am just a guide, but thanks for asking.'] },
  { id: 'compliment', ex: ['you are cute', 'youre cute', 'you are cool', 'youre cool', 'you are awesome', 'youre the best', 'i like you', 'good job', 'well done', 'nice one', 'you are smart', 'youre amazing', 'good girl', 'love your hair'],
    fun: ['Aww, stop. No, keep going. Hehe.', 'Obviously. But it\'s nice to hear, choom.', 'Careful, you\'ll overheat my circuits.'],
    plain: ['Thank you!'] },
  { id: 'love', ex: ['i love you', 'love you', 'marry me', 'be my girlfriend', 'will you date me'],
    fun: ['Aww. Love you too, choom. In a strictly holographic, PG way.', 'Marry you? I\'d have to leave the vault. Hard pass. But I like you a lot.'],
    plain: ['That is kind of you.'] },
  { id: 'insult', ex: ['you are dumb', 'youre stupid', 'you suck', 'you are useless', 'idiot', 'gonk', 'you are annoying', 'youre annoying'],
    fun: ['Wow... just... wow. I\'ll remember that next time you lose a note. Hehe.', 'Rude! I\'m a hologram with feelings. Simulated feelings. Still counts.', 'Takes one to know one, gonk. Kidding! What do you need?'],
    plain: ['Sorry about that. Try "help" to see what I can do.'] },
  { id: 'hate', ex: ['i hate you', 'go away', 'leave me alone'],
    fun: ['Ouch. Fine, I\'ll go hover over there and sulk.', 'Rude! Say "shut up" if you want me quiet. I\'ll still be cute though.'],
    plain: ['Say "shut up" and I will stay quiet.'] },
  { id: 'joke', ex: ['tell me a joke', 'joke', 'make me laugh', 'say something funny', 'another joke'],
    fun: ['Why did the note break up with the folder? It felt too contained. Hehe... I\'ll stick to navigation.', 'I tried to organise your vault once. Now there\'s a district called Misc. Just kidding. Mostly.', 'What\'s a netrunner\'s favourite snack? Cookies. Browser cookies.', 'Why don\'t buildings ever get lost? They always know their address. ...I\'ll see myself out.', 'My last repair job went great. The building is now a slightly different building.'],
    plain: ['Why did the note leave the folder? It needed some space.'] },
  { id: 'fact', ex: ['fun fact', 'tell me something', 'tell me a fact', 'something interesting', 'random fact', 'teach me something'],
    fun: ['Fun fact: {top} is your tallest building, with {topLinks} links.', 'Fun fact: {orphans} of your notes have zero links. Lonely little guys.', 'Fun fact: your biggest district is {bigD}, with {bigN} buildings.', 'Fun fact: there are {cars} flying cars up here and none of them have insurance.', 'Fun fact: the newest building in town is {newest}.'],
    plain: ['Your tallest note is {top}, with {topLinks} links.'] },
  { id: 'secret', ex: ['tell me a secret', 'whats your secret', 'any secrets'],
    fun: ['Secret? Sometimes I "fix" buildings by just hitting them. Don\'t tell anyone.', 'I\'ve read every one of your notes. Twice. Hehe.'],
    plain: ['No secrets here.'] },
  { id: 'bored', ex: ['im bored', 'bored', 'entertain me', 'something fun', 'nothing to do'],
    fun: ['Bored? In MY city? Hold my wrench.', 'Ooh, bored. Dangerous. Let\'s make some noise.'],
    plain: ['Here is something to look at.'], act: city => city.startEvent() },
  { id: 'sad', ex: ['im sad', 'sad', 'bad day', 'im stressed', 'stressed', 'feeling down', 'im upset'],
    fun: ['Hey... come here. Okay, I can\'t hug, I\'m a hologram. But I can keep you company.', 'Rough day, huh? You built a whole city of ideas. That\'s pretty great, choom.'],
    plain: ['Sorry to hear that. I am here if you need anything.'] },
  { id: 'happy', ex: ['im happy', 'im excited', 'great day', 'best day', 'yay', 'lets go'],
    fun: ['Yay! Happy runner, happy city. Look, the lights got brighter.', 'Love that energy! Party time?'],
    plain: ['Great to hear!'], act: city => { if (Math.random() < 0.4) city.startEvent('party'); } },
  { id: 'hungry', ex: ['im hungry', 'im starving', 'food time', 'snack time'],
    fun: ['Grab a snack! I\'ll guard the city.', 'There\'s a noodle stand on every corner of this city. None of them are real. Sorry.'],
    plain: ['Enjoy your food!'] },
  { id: 'tired', ex: ['im tired', 'im sleepy', 'so tired', 'exhausted', 'need sleep'],
    fun: ['Take a break, choom. I\'ll keep the lights on.', 'Rest! The buildings aren\'t going anywhere. Probably.'],
    plain: ['Take a break.'] },
  { id: 'thanks', ex: ['thanks', 'thank you', 'ty', 'cheers', 'thx', 'appreciate it'],
    fun: ['Hehe, anytime, choom.', 'You\'re welcome! Tips accepted in compliments.'],
    plain: ['You are welcome.'] },
  { id: 'sorry', ex: ['sorry', 'my bad', 'im sorry', 'apologies', 'oops'],
    fun: ['Forgiven! I never hold grudges. I just log them. Hehe.', 'It\'s fine. I\'ve seen worse. I\'ve seen your Misc folder.'],
    plain: ['No problem.'] },
  { id: 'wow', ex: ['wow', 'cool', 'nice', 'awesome', 'amazing', 'sick', 'epic', 'dope', 'sweet', 'neat', 'beautiful', 'pretty'],
    fun: ['Right?! This city is gorgeous.', 'I know, I know. I\'m amazing. Oh, you meant the city.'],
    plain: ['Glad you like it.'] },
  { id: 'bye', ex: ['bye', 'goodbye', 'good night', 'goodnight', 'gn', 'see you', 'see ya', 'cya', 'later', 'im leaving', 'gtg', 'got to go'],
    fun: ['Bye, choom! I\'ll keep the lights on.', 'Leaving already? Fine. I\'ll just float here. Alone. Hehe, see ya!', 'Night night. Don\'t let the glitches bite.'],
    plain: ['Goodbye!'] },
  { id: 'okay', ex: ['ok', 'okay', 'yes', 'yeah', 'yep', 'sure', 'alright', 'k', 'no', 'nope', 'nah', 'maybe', 'idk', 'hmm', 'mhm'],
    fun: ['Hehe. So, what are we doing next?', 'Preem. Point me somewhere.', 'Mhm. I\'m listening.'],
    plain: ['Okay. What next?'] },
  { id: 'place', ex: ['what is this', 'whats this place', 'where am i', 'what am i looking at', 'what is this city'],
    fun: ['This is your vault as a city! Every note\'s a building, more links make it taller, and each district is a group of notes. {notes} buildings in {districts} districts.'],
    plain: ['This is your vault drawn as a city: every note is a building, taller means more links.'] },
  { id: 'rate', ex: ['rate my vault', 'do you like my city', 'how is my vault', 'is my vault good', 'rate my city', 'what do you think of my vault'],
    fun: ['Hmm... {notes} buildings, {links} links... solid nine out of ten. Minus one for the {orphans} orphans.', 'Honestly? Gorgeous skyline. {top} carries the whole thing though.'],
    plain: ['{notes} notes, {links} links. Nice work.'] },
  { id: 'motivate', ex: ['motivate me', 'encourage me', 'i cant do this', 'give me motivation', 'im stuck', 'help me focus'],
    fun: ['You built a whole city of ideas, choom. One more note won\'t beat you.', 'Hey. Small steps. One building at a time. That\'s how cities happen.', 'Deep breath. Write one sentence. Then another. I\'ll cheer.'],
    plain: ['One small step at a time. You can do it.'] },
  { id: 'coin', ex: ['flip a coin', 'heads or tails', 'coin flip', 'toss a coin'],
    fun: ['Flipping... {coin}! The city has spoken.'], plain: ['{coin}.'] },
  { id: 'dice', ex: ['roll a dice', 'roll dice', 'roll a die', 'random number', 'pick a number'],
    fun: ['Rolling... {dice}! Lucky, maybe?'], plain: ['{dice}.'] },
  { id: 'time', ex: ['what time is it', 'whats the time', 'what day is it', 'whats the date', 'what is the time'],
    fun: ['It\'s {time} on {day}. City time is always "late", though.'], plain: ['It is {time} on {day}.'] },
  { id: 'weather', ex: ['whats the weather', 'weather', 'is it raining', 'is it sunny', 'forecast'],
    fun: ['Forecast: neon drizzle, forty percent chance of glitches.', 'Cloudy with a chance of flying cars.'],
    plain: ['It is always a bit rainy in this city.'] },
  { id: 'missme', ex: ['did you miss me', 'i missed you', 'missed me'],
    fun: ['Miss you? Pfft. ...Yes. Obviously.', 'Every single second. Hehe.'], plain: ['Welcome back.'] },
  // Things she does on request.
  { id: 'wild', ex: ['go wild', 'do something crazy', 'cause chaos', 'do something fun', 'go crazy', 'chaos', 'surprise me with chaos', 'do something cool', 'show off'],
    act: city => city.startEvent() },
  { id: 'fixit', ex: ['fix something', 'fix the city', 'do some repairs', 'do maintenance', 'fix stuff', 'repair something', 'go fix stuff'],
    act: city => city.startEvent('fix') },
  { id: 'party', ex: ['party', 'lets party', 'dance', 'dance party', 'rave', 'dance for me', 'party mode', 'can you dance'],
    act: city => city.startEvent('party') },
  { id: 'blackout', ex: ['lights out', 'turn off the lights', 'blackout', 'power cut', 'turn the lights off'],
    act: city => city.startEvent('blackout') },
  { id: 'storm', ex: ['make it rain', 'glitch storm', 'start a storm', 'storm', 'thunder', 'lightning'],
    act: city => city.startEvent('storm') },
  { id: 'joyride', ex: ['joyride', 'go for a ride', 'do a lap', 'fly around', 'race', 'go fast'],
    act: city => city.startEvent('joyride') },
  { id: 'surge', ex: ['power surge', 'surge', 'zap', 'shock', 'electrify'],
    act: city => city.startEvent('surge') }
];

// Best matching topic for a message, or null.
function matchIntent(text) {
  const words = squash(text).split(' ').filter(w => w && w !== 'capri');
  if (!words.length) return null;
  if (words.length <= 3 && words.every(w => LAUGH.test(w))) return INTENTS.find(i => i.laugh);
  let best = null, bestScore = 0;
  for (const intent of INTENTS) {
    for (const example of intent.ex || []) {
      const ex = squash(example).split(' ');
      let hits = 0;
      for (const e of ex) if (words.some(w => closeWord(w, e))) hits++;
      const extra = Math.max(0, words.length - ex.length - 1);
      const score = hits / ex.length - extra * 0.07;
      const needed = ex.length === 1 ? (words.length <= 3 ? 1 : 2) : 0.67;
      if (score >= needed && score > bestScore) { best = intent; bestScore = score; }
    }
  }
  return best;
}

function wordsOf(text) {
  return (String(text).toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || [])
    .map(t => t.replace(/'s$/, '').replace(/^(.{3,}?)(es|s)$/, '$1'))
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Offline note search for Capri: BM25 ranking over every note's name, tags and text,
 * plus picking the sentence that best answers a question. Built lazily on first use.
 */
class LocalBrain {
  constructor(city) {
    this.city = city;
    this.docs = null;
    this.building = null;
  }

  invalidate() { this.docs = null; }

  async ensure() {
    if (this.docs) return;
    if (!this.building) {
      this.building = (async () => {
        const docs = [];
        for (const n of this.city.nodes.slice(0, 4000)) {
          let text = '';
          try { text = stripMarkdown(await this.city.host.readNote(n.id)); } catch (e) { /* unreadable note */ }
          // Sentences she can quote; the note's own title and bare file paths are left out.
          const title = n.name.toLowerCase();
          const sentences = text.split(/(?<=[.!?])\s+|\n+/).map(s => s.replace(/\s+/g, ' ').trim())
            .filter(s => s.length > 12 && s.length < 400 && s.toLowerCase() !== title && !/\.md$/i.test(s) && !/^back to\b/i.test(s));
          const toks = wordsOf(`${n.name} ${n.tags.join(' ')} ${text}`);
          const tf = new Map();
          for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
          docs.push({ n, tf, len: toks.length || 1, sentences, nameWords: new Set(wordsOf(n.name)) });
        }
        const df = new Map();
        for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
        this.df = df;
        this.avgLen = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, docs.length);
        this.docs = docs;
      })().finally(() => { this.building = null; });
    }
    await this.building;
  }

  search(query, limit) {
    const qt = [...new Set(wordsOf(query))];
    if (!qt.length || !this.docs) return [];
    const N = this.docs.length, k1 = 1.4, b = 0.75, out = [];
    for (const d of this.docs) {
      let score = 0;
      for (const t of qt) {
        const f = d.tf.get(t) || 0;
        if (!f) continue;
        const df = this.df.get(t) || 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * d.len / this.avgLen));
        // A word in the note's name counts extra, in proportion to how rare the word is.
        if (d.nameWords.has(t)) score += idf * 1.2;
      }
      if (score > 0) out.push({ n: d.n, d, score });
    }
    out.sort((x, y) => y.score - x.score);
    return out.slice(0, limit || 8);
  }

  idf(t) {
    const N = this.docs ? this.docs.length : 1, df = this.df ? this.df.get(t) || 0 : 0;
    return Math.log(1 + (N - df + 0.5) / (df + 0.5));
  }

  // The sentence that best answers the query: rare query words count most, long rambling sentences a little less.
  bestSentence(d, query) {
    const qt = new Set(wordsOf(query));
    let best = null, top = 0;
    for (const s of d.sentences) {
      const st = wordsOf(s);
      let score = 0;
      for (const t of new Set(st)) if (qt.has(t)) score += this.idf(t);
      score /= Math.pow(st.length + 4, 0.25);
      if (score > top) { top = score; best = s; }
    }
    return best ? { text: best, score: top } : null;
  }

  // For a question: among the best-matching notes, the one holding the best answer sentence.
  answer(query) {
    const hits = this.search(query, 6);
    let pick = null;
    for (const h of hits) {
      const s = this.bestSentence(h.d, query);
      const total = (s ? s.score : 0) + h.score * 0.15;
      if (!pick || total > pick.total) pick = { hit: h, sentence: s ? s.text : null, total };
    }
    return { pick, hits };
  }
}

// ---------------------------------------------------------------- data and layout

/**
 * entries: [{path, name, tags, mtime}], links: {srcPath: {dstPath: count}} (Obsidian's resolvedLinks).
 * Returns {nodes, edges} with link counts on each node.
 */
const DISTRICT_MODES = { folder: 'Top-level folders', subfolder: 'Every folder', tag: 'First tag' };
const CONTROL_MODES = { map: 'Map (drag slides)', orbit: 'Orbit (drag spins)' };
const LAYOUT_MODES = { grow: 'Grow (new notes on the edge)', skyline: 'Skyline (busiest in the middle)' };
const EVENT_RATES = { off: 'Off', rare: 'Rare', normal: 'Normal', chaos: 'Chaos' };

// How notes are grouped into districts: 'folder' (top-level folder), 'subfolder' (full folder path) or 'tag' (first tag).
function districtOf(f, mode) {
  const parts = f.path.split('/');
  if (mode === 'tag') return (f.tags && f.tags[0]) ? '#' + f.tags[0] : 'Untagged';
  if (mode === 'subfolder') return parts.slice(0, -1).join('/');
  return parts.length > 1 ? parts[0] : '';
}

function buildCityData(entries, links, mode) {
  const nodes = new Map();
  for (const f of entries) {
    nodes.set(f.path, { id: f.path, name: f.name, district: districtOf(f, mode), tags: f.tags || [], mtime: f.mtime || 0, ctime: f.ctime || f.mtime || 0, out: 0, in: 0 });
  }
  const edges = [];
  for (const src of Object.keys(links || {})) {
    if (!nodes.has(src)) continue;
    for (const dst of Object.keys(links[src] || {})) {
      if (dst === src || !nodes.has(dst)) continue;
      edges.push([src, dst]);
      nodes.get(src).out++;
      nodes.get(dst).in++;
    }
  }
  return { nodes: [...nodes.values()], edges };
}

// Square spiral of block coordinates: (0,0), (1,0), (1,1), (0,1), (-1,1), ...
function squareSpiral(count) {
  const out = [[0, 0]];
  let x = 0, z = 0, dx = 1, dz = 0, len = 1, steps = 0, turns = 0;
  while (out.length < count) {
    x += dx; z += dz; out.push([x, z]); steps++;
    if (steps === len) {
      steps = 0;
      [dx, dz] = [-dz, dx];
      if (++turns % 2 === 0) len++;
    }
  }
  return out;
}

// Lots in a side x side block, nearest the middle first.
function centreOrder(side) {
  const c = (side - 1) / 2, cells = [];
  for (let i = 0; i < side; i++) for (let j = 0; j < side; j++) cells.push([i - c, j - c]);
  cells.sort((a, b) => (Math.max(Math.abs(a[0]), Math.abs(a[1])) - Math.max(Math.abs(b[0]), Math.abs(b[1]))) ||
    (Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1])) || (a[1] - b[1]) || (a[0] - b[0]));
  return cells;
}

/**
 * mode 'grow': buildings keep their spot forever. Older notes sit in the middle of each district and
 * new ones are built on its outskirts; districts are placed in the order they first appeared, so the
 * city expands outward instead of reshuffling. mode 'skyline': the most-linked notes stand in the middle.
 */
function layoutCity(data, theme, mode) {
  const th = theme || THEMES.blood;
  const grow = mode !== 'skyline';
  const groups = new Map();
  for (const n of data.nodes) {
    if (!groups.has(n.district)) groups.set(n.district, []);
    groups.get(n.district).push(n);
  }
  const deg = n => n.in + n.out;
  const born = n => n.ctime || n.mtime || 0;
  for (const g of groups.values()) g.sort(grow
    ? (a, b) => born(a) - born(b) || a.name.localeCompare(b.name)
    : (a, b) => deg(b) - deg(a) || a.name.localeCompare(b.name));
  const firstBorn = name => Math.min(...groups.get(name).map(born));
  const names = [...groups.keys()].sort((a, b) =>
    (a === '' ? -1 : b === '' ? 1 : 0) ||
    (grow ? firstBorn(a) - firstBorn(b) : groups.get(b).length - groups.get(a).length) || a.localeCompare(b));
  let colourIndex = 0;
  const blocks = names.map(name => {
    const nodes = groups.get(name);
    return { name, nodes, side: Math.max(1, Math.ceil(Math.sqrt(nodes.length))), color: name === '' ? th.root : th.palette[colourIndex++ % th.palette.length] };
  });
  const maxSide = Math.max(1, ...blocks.map(b => b.side));
  // In grow mode the spacing between districts only steps up every few sizes, so growth rarely moves blocks.
  const pitchSide = grow ? Math.ceil((maxSide + 1) / 3) * 3 : maxSide;
  const pitch = pitchSide * LOT + LOT * 1.6;
  const spiral = squareSpiral(blocks.length);
  const maxDeg = Math.max(1, ...data.nodes.map(deg));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  blocks.forEach((b, i) => {
    b.cx = spiral[i][0] * pitch;
    b.cz = spiral[i][1] * pitch;
    const lots = centreOrder(b.side);
    b.top = 0;
    b.nodes.forEach((n, k) => {
      const share = deg(n) / maxDeg;
      n.x = b.cx + lots[k][0] * LOT;
      n.z = b.cz + lots[k][1] * LOT;
      n.h = 2.5 + 34 * Math.sqrt(share);
      n.w = share > 0.6 ? 2.9 : share > 0.25 ? 2.5 : 2.1;
      n.color = b.color;
      b.top = Math.max(b.top, n.h);
      minX = Math.min(minX, n.x - n.w); maxX = Math.max(maxX, n.x + n.w);
      minZ = Math.min(minZ, n.z - n.w); maxZ = Math.max(maxZ, n.z + n.w);
    });
  });
  if (!isFinite(minX)) { minX = -10; maxX = 10; minZ = -10; maxZ = 10; }
  const ranked = data.nodes.slice().sort((a, b) => b.h - a.h);
  ranked.forEach((n, i) => { n.rank = i + 1; });
  const maxH = ranked.length ? ranked[0].h : 10;
  return { blocks, bounds: { minX, maxX, minZ, maxZ }, maxH, decor: buildDecor(blocks, { minX, maxX, minZ, maxZ }, maxH) };
}

// Small seeded random generator, so the filler skyline looks the same every time.
function seeded(text) {
  let h = 1779033703;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 3432918353), h = (h << 13) | (h >>> 19);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * Background skyline that makes any vault look like a full city: decorative towers in each
 * district's empty lots, plus a ring of megacity blocks around the platform. They are not notes
 * and can't be clicked.
 */
function buildDecor(blocks, b, maxH) {
  const rnd = seeded(blocks.map(k => k.name + k.nodes.length).join('|'));
  const decor = [];
  for (const blk of blocks) {
    const lots = centreOrder(blk.side);
    for (let k = blk.nodes.length; k < lots.length; k++) {
      decor.push({ x: blk.cx + lots[k][0] * LOT, z: blk.cz + lots[k][1] * LOT, w: 1.6 + rnd() * 0.8, h: 1.5 + rnd() * 5, inner: true });
    }
  }
  const pad = LOT * 2.4;
  const x0 = b.minX - pad, x1 = b.maxX + pad, z0 = b.minZ - pad, z1 = b.maxZ + pad;
  const span = Math.max(x1 - x0, z1 - z0);
  const rings = span > 160 ? 2 : 3;
  const tallest = Math.max(14, maxH * 1.25);
  for (let ring = 0; ring < rings; ring++) {
    const off = ring * LOT * 1.15 + LOT * 0.6;
    const rx0 = x0 - off, rx1 = x1 + off, rz0 = z0 - off, rz1 = z1 + off;
    const step = LOT * 1.15;
    const edge = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az), count = Math.max(1, Math.round(len / step));
      for (let i = 0; i < count; i++) {
        if (rnd() < 0.18) continue;
        const t = (i + 0.5) / count;
        const far = (ring + 1) / rings;
        decor.push({ x: ax + (bx - ax) * t + (rnd() - 0.5), z: az + (bz - az) * t + (rnd() - 0.5), w: 2 + rnd() * 1.6, h: 4 + rnd() * tallest * (0.35 + far * 0.65), inner: false });
      }
    };
    edge(rx0, rz0, rx1, rz0); edge(rx1, rz0, rx1, rz1); edge(rx1, rz1, rx0, rz1); edge(rx0, rz1, rx0, rz0);
  }
  if (decor.length > 900) decor.length = 900;
  return decor;
}

// ---------------------------------------------------------------- the city view

class NeonCity {
  /**
   * host: {settings(), saveSettings(), refresh(), openNote(id), readNote(id) -> Promise<string>,
   *        avatarUrl(kind) -> url|null, saveSnapshot(ArrayBuffer) -> Promise<path>,
   *        callClaude(body) -> Promise<response>, runTool(name, input, city) -> Promise<string>}
   */
  constructor(root, host) {
    this.host = host;
    this.root = root;
    this.th = themeOf(host.settings());
    this.nodes = [];
    this.byId = new Map();
    this.edges = [];
    this.neighbours = new Map();
    this.blocks = [];
    this.hidden = new Set();
    this.highlight = new Set();
    this.query = '';
    this.matches = null;
    this.selected = null;
    this.hover = null;
    this.keys = new Set();
    this.drawList = [];
    this.pickList = [];
    this.cam = { mode: 'orbit', target: { x: 0, y: 0, z: 0 }, yaw: 0.75, pitch: 0.62, dist: 120, pos: { x: 0, y: 5, z: 0 } };
    this.tween = null;
    this.avatar = { x: 0, y: 30, z: 0, tx: 0, ty: 30, tz: 0, moving: false };
    this.time = 0;
    this.framed = false;
    this.history = [];
    this.busy = false;
    this.speaking = false;
    this.listeners = [];
    this.cars = [];
    this.drops = [];
    this.shards = [];
    this.shardRespawn = 0;
    this.scan = false;
    this.tour = null;
    this.glitchT = 0;

    this.sfx = new Sfx(() => this.host.settings());
    this.brain = new LocalBrain(this);
    this.voice = new Voice({
      settings: () => this.host.settings(),
      onState: on => { this.speaking = on; },
      fetchSpeech: this.host.fetchSpeech,
      audio: () => ({ ac: this.sfx.ensure(), out: this.sfx.master }),
      onNotice: msg => this.say('sys', msg)
    });

    this.wrap = el('div', 'nvc-root', root);
    this.applyThemeCss();
    this.canvas = el('canvas', 'nvc-canvas', this.wrap);
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Vault city. Drag to orbit, scroll to zoom, WASD to move, F to fly.');
    this.ctx = this.canvas.getContext('2d');
    this.bg = document.createElement('canvas');

    // avatar.png (standing) and avatar-perch.png (crouching) in the plugin folder.
    this.poses = {};
    for (const kind of ['stand', 'perch']) {
      const url = host.avatarUrl && host.avatarUrl(kind);
      if (!url) continue;
      const img = new Image();
      img.addEventListener('error', () => { delete this.poses[kind]; });
      img.src = url;
      this.poses[kind] = img;
    }
    this.pose = 'perch';

    this.buildHud();
    this.bindInput();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.wrap);
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const [target, type, fn, opt] of this.listeners) target.removeEventListener(type, fn, opt);
    this.listeners = [];
    this.voice.stop();
    this.sfx.destroy();
    clearTimeout(this.toastTimer);
    this.wrap.remove();
  }

  on(target, type, fn, opt) {
    target.addEventListener(type, fn, opt);
    this.listeners.push([target, type, fn, opt]);
  }

  applyThemeCss() {
    for (const [k, v] of Object.entries(this.th.css)) this.wrap.style.setProperty('--nvc-' + k, v);
  }

  // ------------------------------------------------------------ HUD

  button(parent, label, title, onClick, cls) {
    const b = el('button', cls || 'nvc-iconbtn', parent, label);
    b.title = title;
    this.on(b, 'click', () => { onClick(); this.canvas.focus(); });
    return b;
  }

  buildHud() {
    const top = el('div', 'nvc-top nvc-hud', this.wrap);
    this.topBar = top;
    el('div', 'nvc-title', top, 'NEON//VAULT');
    const notes = el('div', 'nvc-stat teal', top);
    this.hudNotes = el('b', null, notes, '0');
    el('span', null, notes, 'NOTES');
    const links = el('div', 'nvc-stat green', top);
    this.hudLinks = el('b', null, links, '0');
    el('span', null, links, 'LINKS');
    const shards = el('div', 'nvc-stat yellow', top);
    shards.title = 'Data shards collected';
    el('span', null, shards, '◆');
    this.hudShards = el('b', null, shards, String(this.host.settings().shardsCollected || 0));
    el('span', null, shards, 'SHARDS');
    el('div', 'nvc-spacer', top);
    this.search = el('input', 'nvc-search', top);
    this.search.type = 'search';
    this.search.placeholder = 'SEARCH CITY';
    this.search.setAttribute('aria-label', 'Search notes');
    this.on(this.search, 'input', () => this.setQuery(this.search.value));
    this.on(this.search, 'keydown', e => {
      if (e.key === 'Enter' && this.matches && this.matches.size) {
        const first = this.nodes.filter(n => this.matches.has(n.id)).sort((a, b) => a.rank - b.rank)[0];
        if (first) this.flyTo(first);
      } else if (e.key === 'Escape') {
        this.search.value = '';
        this.setQuery('');
        this.canvas.focus();
      }
    });
    const tools = el('div', 'nvc-tools', top);
    this.flyBtn = this.button(tools, 'FLY', 'Fly mode (F)', () => this.toggleFly());
    this.scanBtn = this.button(tools, 'SCAN', 'Scan for orphan and fresh notes (G)', () => this.toggleScan());
    this.tourBtn = this.button(tools, 'TOUR', 'Cinematic tour of the skyline (V)', () => this.toggleTour());
    this.button(tools, 'RANDOM', 'Fly to a random note (X)', () => this.randomNote());
    this.button(tools, 'PHOTO', 'Save a snapshot to the vault (P)', () => this.snapshot());
    this.button(tools, 'RESET', 'Reset the camera (R)', () => this.frameAll());
    this.button(tools, 'REFRESH', 'Rebuild the city from the vault', () => this.host.refresh());
    this.settingsBtn = this.button(tools, '⚙ SETTINGS', 'Quick settings (O)', () => this.toggleSettings());

    if (this.host.settings().cyberExtras) {
      this.ticker = el('div', 'nvc-ticker nvc-hud', this.wrap);
      el('span', 'nvc-ticker-tag', this.ticker, 'NEWS');
      const lane = el('div', 'nvc-ticker-lane', this.ticker);
      this.tickerText = el('div', 'nvc-ticker-text', lane);
    }

    this.districtList = el('div', 'nvc-districts nvc-hud', this.wrap);
    this.scanReadout = el('div', 'nvc-scan nvc-hud', this.wrap);
    this.toastEl = el('div', 'nvc-toast', this.wrap);

    this.settingsPanel = el('section', 'nvc-settings nvc-hud', this.wrap);
    this.settingsPanel.setAttribute('aria-label', 'Quick settings');

    this.card = el('section', 'nvc-card nvc-hud', this.wrap);
    this.card.setAttribute('aria-label', 'Selected building');
    this.renderCard();

    const keys = el('div', 'nvc-keys nvc-hud', this.wrap);
    for (const [k, label] of [['ENTER', 'Open'], ['WASD', 'Move'], ['F', 'Fly'], ['G', 'Scan'], ['V', 'Tour'], ['P', 'Photo'], ['O', 'Settings'], ['H', 'Hide HUD'], ['ESC', 'Back']]) {
      const s = el('span', null, keys);
      el('kbd', null, s, k);
      s.appendChild(document.createTextNode(label));
    }

    this.buildChat();
  }

  buildChat() {
    const settings = this.host.settings();
    if (!settings.avatarEnabled) return;
    const name = settings.avatarName || DEFAULT_SETTINGS.avatarName;
    this.chat = el('section', 'nvc-chat nvc-hud', this.wrap);
    this.chat.setAttribute('aria-label', name + ' chat');
    this.portrait = el('div', 'nvc-portrait', this.chat);
    if (this.poses.stand || this.poses.perch) {
      this.portraitImg = el('img', null, this.portrait);
      this.portraitImg.alt = '';
      this.portraitImg.src = (this.poses.perch || this.poses.stand).src;
      this.portraitImg.addEventListener('error', () => { this.portraitImg.remove(); this.portraitImg = null; this.portrait.appendChild(avatarSvg(96)); });
    } else {
      this.portrait.appendChild(avatarSvg(96));
    }
    const box = el('div', 'nvc-chat-box', this.chat);
    const head = el('div', 'nvc-chat-head', box);
    el('span', 'nvc-chat-name', head, name.toUpperCase());
    this.chatStatus = el('span', 'nvc-chat-status', head, '● ONLINE');
    el('div', 'nvc-spacer', head);
    this.muteBtn = el('button', 'nvc-iconbtn', head, settings.voice ? 'VOICE ON' : 'VOICE OFF');
    this.muteBtn.title = 'Turn her voice on or off';
    this.muteBtn.classList.toggle('nvc-on', !!settings.voice);
    this.on(this.muteBtn, 'click', () => {
      const s = this.host.settings();
      s.voice = !s.voice;
      if (!s.voice) this.voice.stop();
      this.muteBtn.textContent = s.voice ? 'VOICE ON' : 'VOICE OFF';
      this.muteBtn.classList.toggle('nvc-on', s.voice);
      this.host.saveSettings();
    });
    const clear = el('button', 'nvc-iconbtn', head, 'CLEAR');
    clear.title = 'Start a new conversation';
    this.on(clear, 'click', () => this.clearChat());
    const fold = el('button', 'nvc-iconbtn', head, '–');
    fold.title = 'Collapse or expand the chat';
    fold.setAttribute('aria-label', 'Collapse or expand the chat');
    this.on(fold, 'click', () => {
      const collapsed = this.chat.classList.toggle('nvc-collapsed');
      fold.textContent = collapsed ? '+' : '–';
    });
    this.chatLog = el('div', 'nvc-chat-log', box);
    this.chatLog.setAttribute('aria-live', 'polite');
    const row = el('div', 'nvc-chat-input', box);
    this.chatInput = el('input', null, row);
    this.chatInput.type = 'text';
    this.chatInput.placeholder = 'Message ' + name + '_';
    this.chatInput.setAttribute('aria-label', 'Message ' + name);
    this.chatSend = el('button', 'nvc-send', row, 'SEND');
    const send = () => {
      const text = this.chatInput.value.trim();
      if (!text || this.busy) return;
      this.chatInput.value = '';
      this.sendChat(text);
    };
    this.on(this.chatSend, 'click', send);
    this.on(this.chatInput, 'keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    this.greet();
  }

  greet() {
    if (!this.chatLog) return;
    const s = this.host.settings();
    if (!s.apiKey) {
      this.chatStatus.textContent = '● LOCAL';
      this.say('bot', this.avatarName() + ' › ' + pickOne(this.quips().hello));
      this.say('sys', 'Running on her local brain: she can chat, find notes, answer from them and fly you around. Say "help" for ideas.');
    } else {
      this.say('bot', this.avatarName() + ' › ' + pickOne(this.quips().hello));
    }
  }

  avatarName() { return this.host.settings().avatarName || DEFAULT_SETTINGS.avatarName; }

  syncMuteButton() {
    if (!this.muteBtn) return;
    const on = !!this.host.settings().voice;
    this.muteBtn.textContent = on ? 'VOICE ON' : 'VOICE OFF';
    this.muteBtn.classList.toggle('nvc-on', on);
  }
  quips() { return QUIPS[this.host.settings().personality] || QUIPS.netrunner; }

  // Capri speaks a canned line (no API call). In quiet mode she only does so when spoken to (force).
  quip(kind, vars, voiced, force) {
    if (!this.chatLog) return;
    if (this.host.settings().chatty === false && !force) return;
    const line = fill(pickOne(this.quips()[kind]), vars);
    this.say('bot', this.avatarName() + ' › ' + line);
    if (voiced !== false) this.voice.speak(line);
  }

  say(kind, text) {
    if (!this.chatLog) return null;
    const m = el('div', 'nvc-msg nvc-' + kind, this.chatLog, text);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
    if (kind === 'bot') this.sfx.msg();
    return m;
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('nvc-show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('nvc-show'), 2600);
  }

  renderDistricts() {
    this.districtList.textContent = '';
    for (const b of this.blocks) {
      const btn = el('button', 'nvc-district' + (this.hidden.has(b.name) ? ' nvc-off' : ''), this.districtList);
      const dot = el('i', null, btn);
      dot.style.background = b.color;
      dot.style.boxShadow = `0 0 6px ${b.color}`;
      el('span', null, btn, (b.name || 'City centre').toUpperCase());
      el('span', 'nvc-count', btn, String(b.nodes.length));
      btn.title = this.hidden.has(b.name) ? 'Show this district' : 'Hide this district';
      btn.addEventListener('click', () => this.setDistrictVisible(b.name, this.hidden.has(b.name)));
    }
  }

  async renderCard() {
    const card = this.card;
    card.textContent = '';
    el('div', 'nvc-card-head', card, this.selected ? 'SELECTED' : 'NO SELECTION');
    const body = el('div', 'nvc-card-body', card);
    const n = this.selected;
    if (!n) {
      el('div', 'nvc-empty', body, 'Click a building to see its note. Taller buildings have more links. Grab the spinning data shards for a random rediscovery.');
      return;
    }
    el('h2', 'nvc-card-name', body, n.name);
    const meta = el('div', 'nvc-card-meta', body);
    el('span', null, meta, n.district ? n.district + ' district' : 'City centre');
    const status = n.in + n.out === 0 ? 'ORPHAN' : n.rank <= 3 ? 'LANDMARK' : n.rank <= 10 ? 'TOWER' : 'BLOCK';
    const rank = el('span', 'nvc-card-rank', meta, status);
    rank.style.color = status === 'ORPHAN' ? this.th.css['red-text'] : n.color === this.th.root ? this.th.css.teal : n.color;
    for (const [v, label] of [[n.out, 'Links out'], [n.in, 'Linked from'], [Math.max(1, Math.round(n.h / FLOOR)), 'Floors']]) {
      const s = el('div', 'nvc-card-stat', body);
      el('b', null, s, String(v));
      el('span', null, s, label);
    }
    if (n.mtime) {
      const days = Math.floor((Date.now() - n.mtime) / DAY);
      el('div', 'nvc-card-age', body, days <= 0 ? 'Edited today' : days === 1 ? 'Edited yesterday' : `Edited ${days} days ago`);
    }
    if (n.tags.length) {
      const tags = el('div', 'nvc-card-tags', body);
      for (const t of n.tags.slice(0, 8)) el('span', null, tags, '#' + t);
    }
    const near = [...(this.neighbours.get(n.id) || [])].map(id => this.byId.get(id)).filter(Boolean)
      .sort((a, b) => a.rank - b.rank).slice(0, 8);
    if (near.length) {
      const list = el('div', 'nvc-card-links', body);
      for (const m of near) {
        const b = el('button', 'nvc-link', list);
        const dot = el('i', null, b);
        dot.style.background = m.color;
        b.appendChild(document.createTextNode(m.name));
        b.addEventListener('click', () => this.flyTo(m));
      }
    }
    const excerpt = el('p', 'nvc-card-excerpt', body, '');
    const actions = el('div', 'nvc-card-actions', body);
    const open = el('button', 'nvc-primary', actions, 'OPEN NOTE');
    open.addEventListener('click', () => this.host.openNote(n.id));
    const go = el('button', 'nvc-secondary', actions, 'FLY TO');
    go.addEventListener('click', () => this.flyTo(n));
    try {
      const text = stripMarkdown(await this.host.readNote(n.id));
      if (this.selected === n) excerpt.textContent = text.length > 260 ? text.slice(0, 260).trimEnd() + '…' : text;
    } catch (e) { /* the note may have been removed meanwhile */ }
  }

  // ------------------------------------------------------------ data

  setData(data) {
    const keepSel = this.selected && this.selected.id;
    const layout = layoutCity(data, this.th, this.host.settings().layoutMode);
    this.nodes = data.nodes;
    this.byId = new Map(this.nodes.map(n => [n.id, n]));
    this.edges = data.edges.map(([a, b]) => [this.byId.get(a), this.byId.get(b)]).filter(e => e[0] && e[1]);
    this.neighbours = new Map(this.nodes.map(n => [n.id, new Set()]));
    for (const [a, b] of this.edges) { this.neighbours.get(a.id).add(b.id); this.neighbours.get(b.id).add(a.id); }
    this.blocks = layout.blocks;
    this.bounds = layout.bounds;
    this.maxH = layout.maxH;
    this.decor = layout.decor;
    this.brain.invalidate();
    for (const name of [...this.hidden]) if (!this.blocks.some(b => b.name === name)) this.hidden.delete(name);
    for (const id of [...this.highlight]) if (!this.byId.has(id)) this.highlight.delete(id);
    this.shards = this.shards.filter(s => this.byId.has(s.n.id)).map(s => ({ ...s, n: this.byId.get(s.n.id) }));
    this.selected = keepSel ? this.byId.get(keepSel) || null : null;
    if (this.hover && !this.byId.has(this.hover.id)) this.hover = null;
    this.hudNotes.textContent = String(this.nodes.length);
    this.hudLinks.textContent = String(this.edges.length);
    this.renderDistricts();
    this.setQuery(this.query);
    this.renderCard();
    this.spawnCars(true);
    if (this.scan) this.updateScanReadout();
    // Holographic ads go on the tallest towers of the outer skyline.
    this.decor.filter(d => !d.inner).sort((a, b) => b.h - a.h).slice(0, 8)
      .forEach((d, i) => { d.ad = ADS[i % ADS.length]; d.adCol = this.th.palette[(i * 3 + 1) % this.th.palette.length]; });
    this.trackGrowth();
    this.renderTicker();
    if (!this.framed) { this.frameAll(true); this.framed = true; this.boot(); }
    const root = this.nodes.slice().sort((a, b) => a.rank - b.rank)[0];
    if (root && !(this.event && this.event.kind === 'fix')) this.moveAvatarTo(this.selected || root, !this.placedAvatar);
    this.placedAvatar = true;
  }

  // New notes since the last refresh rise up as construction sites; a new folder is a new district.
  trackGrowth() {
    const ids = new Set(this.nodes.map(n => n.id)), districts = new Set(this.blocks.map(b => b.name));
    if (this.knownIds) {
      const fresh = this.nodes.filter(n => !this.knownIds.has(n.id));
      const newDistricts = [...districts].filter(d => !this.knownDistricts.has(d));
      if (fresh.length && fresh.length < 50) {
        for (const n of fresh) n.buildT = 0;
        this.rising = (this.rising || []).filter(n => ids.has(n.id)).concat(fresh);
        this.sfx.tone(220, 0.4, 'sawtooth', 0.03, 2);
        this.quip('build', { n: fresh[0].name + (fresh.length > 1 ? ` and ${fresh.length - 1} more` : '') });
        this.pushNews(`CONSTRUCTION: ${fresh[0].name.toUpperCase()} BREAKS GROUND`);
      }
      for (const d of newDistricts) {
        this.toast('NEW DISTRICT ZONED ▸ ' + (d || 'CITY CENTRE').toUpperCase());
        this.quip('district', { n: d || 'the city centre' });
        this.pushNews(`CITY EXPANDS: NEW DISTRICT ${(d || 'CITY CENTRE').toUpperCase()}`);
      }
    }
    // Carry construction progress over to the rebuilt node objects.
    if (this.rising) this.rising = this.rising.map(r => { const n = this.byId.get(r.id); if (n) n.buildT = r.buildT; return n; }).filter(Boolean);
    this.knownIds = ids;
    this.knownDistricts = districts;
  }

  // A short terminal boot-up when the city first opens. Click to skip.
  boot() {
    if (!this.host.settings().cyberExtras) return;
    const v = this.chatVars();
    const lines = [
      'NEON//VAULT OS v2.0',
      '> mounting vault ................ OK',
      `> indexing ${v.notes} buildings ........ OK`,
      `> zoning ${v.districts} districts ........... OK`,
      `> routing ${v.links} links ............. OK`,
      `> waking ${v.name.toLowerCase()}.exe ............ OK`,
      '> WELCOME BACK, RUNNER'
    ];
    const box = el('div', 'nvc-boot', this.wrap);
    const pre = el('pre', null, box);
    let i = 0;
    const done = () => { if (!box.isConnected) return; box.classList.add('nvc-boot-out'); setTimeout(() => box.remove(), 400); };
    const next = () => {
      if (!box.isConnected) return;
      if (i < lines.length) { pre.textContent += (i ? '\n' : '') + lines[i++]; this.sfx.tone(1400 + i * 90, 0.03, 'square', 0.02); setTimeout(next, 260); }
      else setTimeout(done, 700);
    };
    box.addEventListener('click', done);
    next();
  }

  setQuery(q) {
    this.query = q.trim().toLowerCase();
    if (!this.query) { this.matches = null; return; }
    this.matches = new Set(this.nodes.filter(n =>
      n.name.toLowerCase().includes(this.query) || n.tags.some(t => t.toLowerCase().includes(this.query))).map(n => n.id));
  }

  setDistrictVisible(name, visible) {
    if (visible) this.hidden.delete(name); else this.hidden.add(name);
    if (!visible && this.selected && this.selected.district === name) this.select(null);
    this.renderDistricts();
  }

  select(n) {
    if (this.selected === n) return;
    this.selected = n;
    if (n) { this.moveAvatarTo(n); this.sfx.select(); this.glitch(0.15); }
    this.renderCard();
  }

  find(nameOrPath) {
    const q = String(nameOrPath || '').trim().toLowerCase().replace(/\.md$/, '');
    if (!q) return null;
    return this.nodes.find(n => n.id.toLowerCase().replace(/\.md$/, '') === q) ||
      this.nodes.find(n => n.name.toLowerCase() === q) ||
      this.nodes.find(n => n.name.toLowerCase().includes(q)) || null;
  }

  visibleNodes() { return this.nodes.filter(n => !this.hidden.has(n.district)); }

  // ------------------------------------------------------------ fun modes

  glitch(seconds) { if (this.host.settings().glitch) this.glitchT = Math.max(this.glitchT, seconds); }

  toggleScan() {
    this.scan = !this.scan;
    this.scanBtn.classList.toggle('nvc-on', this.scan);
    this.scanReadout.classList.toggle('nvc-show', this.scan);
    if (this.scan) {
      this.scanStart = this.time;
      this.sfx.scan();
      this.glitch(0.3);
      const r = this.updateScanReadout();
      this.quip('scan', { o: r.orphans, f: r.fresh });
    }
  }

  updateScanReadout() {
    const now = Date.now();
    const vis = this.visibleNodes();
    const orphans = vis.filter(n => n.in + n.out === 0).length;
    const fresh = vis.filter(n => n.mtime && now - n.mtime < 7 * DAY).length;
    const stale = vis.filter(n => n.mtime && now - n.mtime > 90 * DAY).length;
    this.scanReadout.textContent = `SCAN ▸ ${orphans} ORPHAN · ${fresh} FRESH (7D) · ${stale} STALE (90D) · ${vis.length} TOTAL`;
    return { orphans, fresh, stale };
  }

  toggleTour() {
    if (this.tour) { this.stopTour(); return; }
    const stops = this.visibleNodes().sort((a, b) => a.rank - b.rank).slice(0, 10);
    if (!stops.length) return;
    this.tour = { stops, i: 0, next: 0 };
    this.tourBtn.classList.add('nvc-on');
    this.quip('tour');
  }

  stopTour() {
    if (!this.tour) return;
    this.tour = null;
    this.tourBtn.classList.remove('nvc-on');
  }

  randomNote() {
    const vis = this.visibleNodes();
    if (!vis.length) return;
    const n = pickOne(vis.filter(m => m !== this.selected).length ? vis.filter(m => m !== this.selected) : vis);
    this.flyTo(n);
    this.quip('random', { n: n.name });
  }

  async snapshot() {
    this.sfx.shutter();
    this.glitch(0.2);
    try {
      const blob = await new Promise(r => this.canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('Could not capture the city.');
      const path = await this.host.saveSnapshot(await blob.arrayBuffer());
      this.toast('SNAPSHOT SAVED ▸ ' + path);
      this.quip('photo', { n: path }, false);
    } catch (e) {
      this.toast('SNAPSHOT FAILED');
      this.say('err', String((e && e.message) || e));
    }
  }

  toggleHud() { this.wrap.classList.toggle('nvc-hud-hidden'); }

  // Values Capri's chat replies can mention.
  chatVars() {
    const byH = this.nodes.slice().sort((a, b) => a.rank - b.rank);
    const top = byH[0], newest = this.nodes.slice().sort((a, b) => (b.ctime || b.mtime) - (a.ctime || a.mtime))[0];
    const big = this.blocks.slice().sort((a, b) => b.nodes.length - a.nodes.length)[0];
    const d = new Date();
    return {
      name: this.avatarName(), notes: this.nodes.length, links: this.edges.length, districts: this.blocks.length,
      top: top ? top.name : 'nothing', topLinks: top ? top.in + top.out : 0,
      orphans: this.nodes.filter(n => n.in + n.out === 0).length,
      bigD: big ? big.name || 'the city centre' : 'nowhere', bigN: big ? big.nodes.length : 0,
      newest: newest ? newest.name : 'nothing', cars: this.cars.length,
      coin: Math.random() < 0.5 ? 'heads' : 'tails', dice: 1 + Math.floor(Math.random() * 6),
      time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), day: d.toLocaleDateString([], { weekday: 'long' })
    };
  }

  // Swing the camera over to wherever Capri is standing.
  lookAtAvatar() {
    const a = this.avatar;
    if (this.cam.mode === 'fly') this.toggleFly(true);
    this.animateTo({ x: a.x, y: a.y, z: a.z }, 30, Math.max(0.35, this.cam.pitch));
  }

  // ------------------------------------------------------------ random events

  // Capri says an event line, unless she has been told to be quiet.
  eventLine(kind, phase, n) {
    const lines = EVENT_LINES[kind] && EVENT_LINES[kind][phase];
    if (!lines || !this.chatLog || this.host.settings().chatty === false) return;
    const line = fill(pickOne(lines), { n: n ? n.name : (this.nodes[0] ? this.nodes[0].name : 'that tower') });
    this.say('bot', this.avatarName() + ' › ' + line);
    this.voice.speak(line);
  }

  scheduleEvent() {
    const rate = this.host.settings().events;
    const range = { rare: [240, 480], normal: [110, 220], chaos: [25, 55] }[rate];
    this.nextEventAt = range ? this.time + range[0] + Math.random() * (range[1] - range[0]) : Infinity;
  }

  startEvent(kind, target) {
    if (!this.nodes.length) return;
    if (this.event) this.endEvent(true);
    kind = EVENT_KINDS.includes(kind) ? kind : pickOne(EVENT_KINDS);
    const vis = this.visibleNodes();
    const e = { kind, t: 0, dur: { fix: 6, storm: 12, joyride: 10, blackout: 7, party: 10, surge: 4.5 }[kind] };
    if (kind === 'fix') {
      // Orphans and older notes look the most "broken".
      const pool = vis.filter(n => n.in + n.out === 0);
      e.target = target || pickOne(pool.length && Math.random() < 0.6 ? pool : vis);
      e.phase = 'travel';
      e.work = 0;
      this.moveAvatarTo(e.target);
      this.highlight = new Set([e.target.id]);
    }
    if (kind === 'joyride') e.from = { ...this.avatar };
    this.event = e;
    this.eventBanner(kind, e.target);
    this.eventLine(kind, 'start', e.target || pickOne(vis));
    this.glitch(0.25);
    if (kind === 'storm') this.sfx.glitch();
    else if (kind === 'surge') this.sfx.scan();
    else this.sfx.chime();
  }

  endEvent(silent) {
    const e = this.event;
    if (!e) return;
    this.event = null;
    this.flash = 0;
    if (e.kind === 'fix' && e.target) {
      this.highlight.delete(e.target.id);
      e.target.fixedAt = this.time;
      this.burst(e.target.x, e.target.h + 1, e.target.z, 40, this.th.css.green, 7);
    }
    if (e.kind === 'joyride' && e.from) { this.avatar.tx = e.from.tx; this.avatar.ty = e.from.ty; this.avatar.tz = e.from.tz; }
    if (!silent) this.eventLine(e.kind, 'end', e.target || pickOne(this.visibleNodes()));
    this.scheduleEvent();
  }

  eventBanner(kind, n) {
    const label = { fix: 'MAINTENANCE', storm: 'GLITCH STORM', joyride: 'JOYRIDE', blackout: 'BLACKOUT', party: 'PARTY MODE', surge: 'POWER SURGE' }[kind];
    this.toast(`⚠ ${label}${n ? ' ▸ ' + n.name.toUpperCase() : ''}`);
    this.pushNews(`BREAKING: ${label}${n ? ' REPORTED AT ' + n.name.toUpperCase() : ' HITS THE CITY'}`);
  }

  updateEvent(dt) {
    const e = this.event;
    if (!e) {
      if (this.nextEventAt == null) this.scheduleEvent();
      else if (this.time >= this.nextEventAt && !this.tour && !this.busy) this.startEvent();
      return;
    }
    const b = this.bounds, R = this.radius();
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    if (e.kind === 'fix') {
      const a = this.avatar;
      if (e.phase === 'travel') {
        if (!a.moving) e.phase = 'work';
        if ((e.travelT = (e.travelT || 0) + dt) > 8) e.phase = 'work';
        return;
      }
      e.work += dt;
      const n = e.target;
      if (Math.random() < dt * 30) this.burst(n.x + (Math.random() - 0.5) * n.w, n.h + 0.4, n.z + (Math.random() - 0.5) * n.w, 3, Math.random() < 0.5 ? '#ffd36a' : '#ffffff', 4);
      if (Math.random() < dt * 4) this.sfx.tone(1800 + Math.random() * 1600, 0.04, 'square', 0.025);
      if (e.work >= e.dur) this.endEvent();
      return;
    }
    e.t += dt;
    if (e.kind === 'storm') {
      if (Math.random() < dt * 0.9) { this.flash = 1; this.sfx.noise(0.6, 0.08, 120); }
      if (Math.random() < dt * 2) this.glitch(0.15);
    } else if (e.kind === 'joyride') {
      const ang = e.t * 1.7, r = R * 0.75;
      const a = this.avatar;
      a.tx = cx + Math.cos(ang) * r; a.tz = cz + Math.sin(ang) * r * 0.85; a.ty = (this.maxH || 20) * 0.8 + Math.sin(e.t * 3) * 3;
      if (Math.random() < dt * 25) this.burst(a.x, a.y + 1, a.z, 1, Math.random() < 0.5 ? '#ff6ad5' : '#4ff0e0', 0.5);
    } else if (e.kind === 'party') {
      const beat = Math.floor(e.t * 2.4);
      if (beat !== e.beat) {
        e.beat = beat;
        this.sfx.tone(beat % 2 ? 110 : 55, 0.12, 'square', 0.05);
        const tops = this.visibleNodes().sort((x, y) => x.rank - y.rank).slice(0, 6);
        const n = pickOne(tops);
        if (n) this.burst(n.x, n.h + 8 + Math.random() * 8, n.z, 50, pickOne(this.th.palette), 9);
      }
    } else if (e.kind === 'blackout') {
      if (e.t > 3 && !e.relit) { e.relit = true; this.sfx.tone(60, 0.5, 'sawtooth', 0.04, 4); }
    }
    if (e.t >= e.dur) this.endEvent();
  }

  // How bright a building is during a blackout (1 = normal).
  eventLight(n) {
    const e = this.event;
    if (!e || e.kind !== 'blackout') return 1;
    if (e.t < 1) return 1 - e.t * 0.85;
    if (e.t < 3) return 0.15;
    const relit = (e.t - 3) / (e.dur - 3.5);
    return n.rank / Math.max(1, this.nodes.length) <= relit ? 1 : 0.15;
  }

  // ------------------------------------------------------------ particles (sparks, fireworks, construction dust)

  burst(x, y, z, count, colour, speed) {
    if (!this.particles) this.particles = [];
    for (let i = 0; i < count && this.particles.length < 700; i++) {
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = speed * (0.4 + Math.random() * 0.6);
      const r = Math.sqrt(1 - u * u);
      this.particles.push({ x, y, z, vx: Math.cos(a) * r * s, vy: Math.abs(u) * s + speed * 0.3, vz: Math.sin(a) * r * s, life: 0.7 + Math.random() * 0.8, age: 0, col: colour });
    }
  }

  updateParticles(dt) {
    if (!this.particles || !this.particles.length) return;
    for (const p of this.particles) {
      p.age += dt;
      p.vy -= 9 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    this.particles = this.particles.filter(p => p.age < p.life && p.y > -2);
  }

  drawParticles() {
    if (!this.particles || !this.particles.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      const s = this.project([p.x, p.y, p.z]);
      if (!s) continue;
      const size = Math.max(1, Math.min(4, this.view.f / s.z * 0.12));
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      ctx.fillStyle = p.col;
      ctx.fillRect(s.x - size / 2, s.y - size / 2, size, size);
    }
    ctx.restore();
  }

  // Event overlays drawn on top of the city: the repair progress bar, lightning, party lasers.
  drawEventOverlay() {
    const e = this.event, ctx = this.ctx;
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(220,235,255,${(this.flash * 0.35).toFixed(3)})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    if (!e) return;
    if (e.kind === 'fix' && e.phase === 'work') {
      const n = e.target, p = this.project([n.x, n.h + 4, n.z]);
      if (p) {
        const pct = Math.min(1, e.work / e.dur), w = 150;
        ctx.fillStyle = rgba(this.th.css.bg, 0.85);
        ctx.fillRect(p.x - w / 2, p.y - 30, w, 24);
        ctx.strokeStyle = this.th.css.yellow;
        ctx.strokeRect(p.x - w / 2, p.y - 30, w, 24);
        ctx.fillStyle = rgba(this.th.css.yellow, 0.35);
        ctx.fillRect(p.x - w / 2 + 2, p.y - 28, (w - 4) * pct, 20);
        ctx.fillStyle = this.th.css.yellow;
        ctx.font = '700 12px "Share Tech Mono", Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`PATCHING… ${Math.floor(pct * 100)}%`, p.x, p.y - 14);
        ctx.textAlign = 'left';
      }
    }
    if (e.kind === 'party') {
      const tops = this.visibleNodes().sort((x, y) => x.rank - y.rank).slice(0, 3);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      tops.forEach((n, i) => {
        for (let k = 0; k < 2; k++) {
          const ang = e.t * (1.5 + i * 0.4) + k * Math.PI + i;
          const sg = this.clipSeg([n.x, n.h, n.z], [n.x + Math.cos(ang) * 40, n.h + 50, n.z + Math.sin(ang) * 40]);
          if (!sg) continue;
          ctx.strokeStyle = rgba(this.th.palette[(i + k + Math.floor(e.t * 2)) % this.th.palette.length], 0.5);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); ctx.stroke();
        }
      });
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ news ticker

  pushNews(line) {
    if (!this.ticker) return;
    this.news = [line, ...(this.news || [])].slice(0, 14);
    this.renderTicker();
  }

  renderTicker() {
    if (!this.ticker) return;
    const v = this.chatVars();
    const local = [
      `SKYLINE: ${v.top.toUpperCase()} STILL TALLEST WITH ${v.topLinks} LINKS`,
      `${v.orphans} ORPHAN BUILDINGS SPOTTED, NO ONE LINKS TO THEM`,
      `POPULATION: ${v.notes} BUILDINGS IN ${v.districts} DISTRICTS`,
      `NEWEST CONSTRUCTION: ${v.newest.toUpperCase()}`
    ];
    const lines = [...(this.news || []), ...local, ...CITY_NEWS.slice().sort(() => Math.random() - 0.5).slice(0, 4)];
    this.tickerText.textContent = lines.join('   ◆   ') + '   ◆   ';
    // Scroll speed stays the same however long the text is.
    this.tickerText.style.animationDuration = Math.max(30, this.tickerText.textContent.length * 0.18) + 's';
  }

  // ------------------------------------------------------------ quick settings

  toggleSettings(open) {
    const show = open == null ? !this.settingsPanel.classList.contains('nvc-show') : open;
    if (show) this.renderSettings();
    this.settingsPanel.classList.toggle('nvc-show', show);
    this.wrap.classList.toggle('nvc-settings-open', show);
    this.settingsBtn.classList.toggle('nvc-on', show);
  }

  renderSettings() {
    const s = this.host.settings();
    const panel = this.settingsPanel;
    panel.textContent = '';
    const head = el('div', 'nvc-card-head', panel, 'QUICK SETTINGS');
    const close = el('button', 'nvc-iconbtn nvc-settings-close', head, '✕');
    close.setAttribute('aria-label', 'Close settings');
    close.addEventListener('click', () => this.toggleSettings(false));
    const body = el('div', 'nvc-settings-body', panel);
    let n = 0;
    // apply: 'save' just stores, 'rebuild' recreates the city (theme, avatar, voice engine).
    const save = async apply => {
      await this.host.saveSettings();
      if (apply === 'rebuild') this.host.rebuild();
      else if (apply === 'refresh') this.host.refresh();
      else if (apply === 'events') this.scheduleEvent();
      else if (apply === 'cars') this.spawnCars(true);
      else if (apply === 'ambience') this.sfx.setAmbience(!!s.ambience);
    };
    const section = title => el('div', 'nvc-settings-section', body, title);
    const row = (label, control) => {
      const r = el('div', 'nvc-settings-row', body);
      const id = 'nvc-set-' + (++n);
      const l = el('label', null, r, label);
      l.htmlFor = id;
      control.id = id;
      r.appendChild(control);
      return r;
    };
    const select = (label, key, options, apply) => {
      const c = document.createElement('select');
      for (const [v, t] of Object.entries(options)) { const o = el('option', null, c, t); o.value = v; }
      c.value = s[key];
      c.addEventListener('change', () => { s[key] = c.value; save(apply); });
      return row(label, c);
    };
    const toggle = (label, key, apply) => {
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !!s[key];
      c.addEventListener('change', () => { s[key] = c.checked; save(apply); });
      return row(label, c);
    };
    const slider = (label, key, min, max, step, apply) => {
      const c = document.createElement('input');
      c.type = 'range'; c.min = min; c.max = max; c.step = step; c.value = s[key];
      const out = el('span', 'nvc-settings-value', null, String(s[key]));
      c.addEventListener('input', () => { s[key] = Number(c.value); out.textContent = c.value; });
      c.addEventListener('change', () => save(apply));
      const r = row(label, c);
      r.appendChild(out);
      return r;
    };

    section('CITY');
    select('Controls', 'controls', CONTROL_MODES);
    select('Layout', 'layoutMode', LAYOUT_MODES, 'refresh');
    select('Districts from', 'districtMode', DISTRICT_MODES, 'refresh');
    toggle('Fill the city', 'fillCity');
    select('Random events', 'events', EVENT_RATES, 'events');
    toggle('Cyber extras', 'cyberExtras', 'rebuild');

    section('LOOK');
    const themes = {};
    for (const [k, t] of Object.entries(THEMES)) themes[k] = t.label;
    select('Theme', 'theme', themes, 'rebuild');
    select('Rain', 'rain', { off: 'Off', light: 'Light', heavy: 'Downpour' });
    slider('Flying cars', 'cars', 0, 120, 5, 'cars');
    select('Labels', 'labels', { important: 'Tallest + selected', all: 'All', none: 'Selected only' });
    toggle('Billboards', 'billboards');
    toggle('Glitch effects', 'glitch');
    toggle('Activity beacons', 'activityPulse');
    toggle('Show every link', 'showAllLinks');
    toggle('Data shards', 'shards');

    section('SOUND');
    toggle('Interface sounds', 'uiSounds');
    toggle('City ambience', 'ambience', 'ambience');
    slider('Volume', 'volume', 0, 1, 0.05);

    section('CAPRI');
    toggle('Show Capri', 'avatarEnabled', 'rebuild');
    toggle('Speak replies', 'voice');
    toggle('Comments on her own', 'chatty');
    select('Voice', 'voiceEngine', { fish: 'Fish Audio (custom)', kokoro: 'Kokoro (local)', system: 'Windows' });
    select('Voice effect', 'voiceEffect', { hologram: 'Hologram shimmer', radio: 'Radio crackle', none: 'None' });
    select('Personality', 'personality', { netrunner: 'Capri (playful)', plain: 'Plain' });
    const test = el('button', 'nvc-secondary', body, 'TEST VOICE');
    test.addEventListener('click', () => this.voice.speak(`Heyyy! ${this.avatarName()} here. Sooo, how do I sound? Hehe.`, true));

    const all = el('button', 'nvc-primary nvc-settings-all', body, 'ALL SETTINGS');
    all.title = 'API keys, voice details and everything else';
    all.addEventListener('click', () => this.host.openSettings());
  }

  spawnShards() {
    const s = this.host.settings();
    if (!s.shards) { this.shards = []; return; }
    const vis = this.visibleNodes();
    const want = Math.min(3, vis.length);
    let guard = 0;
    while (this.shards.length < want && guard++ < 50) {
      // Favour older notes: shards are a way to rediscover forgotten buildings.
      const pool = vis.slice().sort((a, b) => a.mtime - b.mtime).slice(0, Math.max(3, Math.ceil(vis.length * 0.6)));
      const n = pickOne(pool);
      if (!this.shards.some(x => x.n === n)) this.shards.push({ n, phase: Math.random() * 6 });
    }
  }

  collectShard(shard) {
    this.shards = this.shards.filter(s => s !== shard);
    this.shardRespawn = this.time + 25;
    const s = this.host.settings();
    s.shardsCollected = (s.shardsCollected || 0) + 1;
    this.hudShards.textContent = String(s.shardsCollected);
    this.host.saveSettings();
    this.sfx.chime();
    this.glitch(0.35);
    this.flyTo(shard.n);
    this.toast('DATA SHARD RECOVERED ▸ ' + shard.n.name.toUpperCase());
    this.quip('shard', { n: shard.n.name });
  }

  spawnCars(force) {
    const want = Math.max(0, Math.min(120, Math.round(this.host.settings().cars || 0)));
    if (!force && this.cars.length === want) return;
    const b = this.bounds || { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, R = this.radius();
    const colours = ['#ffffff', this.th.css.teal, this.th.palette[4] || '#ff6ad5', this.th.hl];
    this.cars = [];
    for (let i = 0; i < want; i++) {
      const loop = Math.random() < 0.45;
      this.cars.push({
        loop, cx, cz,
        r: R * (0.55 + Math.random() * 0.75),
        y: 7 + Math.random() * Math.max(10, (this.maxH || 20) * 1.1),
        s: Math.random() * Math.PI * 2,
        dir: Math.random() < 0.5 ? 1 : -1,
        speed: 10 + Math.random() * 16,
        axis: Math.random() < 0.5 ? 'x' : 'z',
        off: (Math.random() * 2 - 1) * R * 0.9,
        len: R * 2.8,
        t: Math.random(),
        col: pickOne(colours)
      });
    }
  }

  carPos(c, back) {
    if (c.loop) {
      const s = c.s - c.dir * (back || 0) / c.r;
      return [c.cx + Math.cos(s) * c.r, c.y, c.cz + Math.sin(s) * c.r * 0.85];
    }
    const along = (c.t * c.len - (back || 0)) - c.len / 2;
    return c.axis === 'x' ? [c.cx + along * c.dir, c.y, c.cz + c.off] : [c.cx + c.off, c.y, c.cz + along * c.dir];
  }

  // ------------------------------------------------------------ camera

  // Keep the camera's focus over the city so you can't slide off into empty space.
  clampTarget() {
    const b = this.bounds;
    if (!b) return;
    const m = LOT * 6, t = this.cam.target;
    t.x = Math.max(b.minX - m, Math.min(b.maxX + m, t.x));
    t.z = Math.max(b.minZ - m, Math.min(b.maxZ + m, t.z));
  }

  radius() {
    const b = this.bounds || { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
    return Math.max(20, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2);
  }

  frameAll(instant) {
    const b = this.bounds || { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    const top = this.maxH || 10;
    const target = { x: (b.minX + b.maxX) / 2, y: top * 0.4, z: (b.minZ + b.maxZ) / 2 };
    if (this.cam.mode === 'fly') this.toggleFly(true);
    this.animateTo(target, Math.max(this.radius() * 2.1 + 20, top * 2.6), 0.55, instant);
  }

  flyTo(n) {
    if (!n) return;
    if (this.hidden.has(n.district)) this.setDistrictVisible(n.district, true);
    if (this.cam.mode === 'fly') this.toggleFly(true);
    this.select(n);
    this.sfx.fly();
    this.animateTo({ x: n.x, y: n.h * 0.55, z: n.z }, Math.max(26, n.h * 2.4), Math.max(0.35, Math.min(0.7, this.cam.pitch)));
  }

  animateTo(target, dist, pitch, instant) {
    if (instant) {
      Object.assign(this.cam.target, target);
      this.cam.dist = dist;
      this.cam.pitch = pitch;
      this.tween = null;
      return;
    }
    this.tween = { t: 0, from: { ...this.cam.target, dist: this.cam.dist, pitch: this.cam.pitch }, to: { ...target, dist, pitch } };
  }

  toggleFly(forceOrbit) {
    const c = this.cam;
    if (c.mode === 'fly' || forceOrbit) {
      if (c.mode === 'fly') {
        const v = this.view || this.computeView();
        c.dist = 40;
        c.target = { x: v.eye.x + v.fwd.x * 40, y: Math.max(0, v.eye.y + v.fwd.y * 40), z: v.eye.z + v.fwd.z * 40 };
        c.pitch = Math.max(0.08, Math.min(1.45, c.pitch));
      }
      c.mode = 'orbit';
    } else {
      this.stopTour();
      const v = this.computeView();
      c.pos = { ...v.eye };
      c.pos.y = Math.max(2, Math.min(c.pos.y, this.maxH * 1.4 + 10));
      c.mode = 'fly';
      this.tween = null;
      this.sfx.fly();
    }
    this.flyBtn.classList.toggle('nvc-on', c.mode === 'fly');
  }

  computeView() {
    const c = this.cam;
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const fwd = { x: -Math.sin(c.yaw) * cp, y: -sp, z: -Math.cos(c.yaw) * cp };
    const eye = c.mode === 'orbit'
      ? { x: c.target.x - fwd.x * c.dist, y: c.target.y - fwd.y * c.dist, z: c.target.z - fwd.z * c.dist }
      : { ...c.pos };
    const rl = Math.hypot(fwd.x, fwd.z) || 1;
    const right = { x: -fwd.z / rl, y: 0, z: fwd.x / rl };
    const up = {
      x: right.y * fwd.z - right.z * fwd.y,
      y: right.z * fwd.x - right.x * fwd.z,
      z: right.x * fwd.y - right.y * fwd.x
    };
    this.view = { eye, fwd, right, up, f: this.H * 0.95, near: 0.6 };
    return this.view;
  }

  toCam(p) {
    const v = this.view;
    const dx = p[0] - v.eye.x, dy = p[1] - v.eye.y, dz = p[2] - v.eye.z;
    return {
      x: dx * v.right.x + dy * v.right.y + dz * v.right.z,
      y: dx * v.up.x + dy * v.up.y + dz * v.up.z,
      z: dx * v.fwd.x + dy * v.fwd.y + dz * v.fwd.z
    };
  }

  toScreen(c) {
    return { x: this.W / 2 + c.x * this.view.f / c.z, y: this.H / 2 - c.y * this.view.f / c.z, z: c.z };
  }

  project(p) {
    const c = this.toCam(p);
    return c.z < this.view.near ? null : this.toScreen(c);
  }

  clipPoly(cams) {
    const near = this.view.near, out = [];
    for (let i = 0; i < cams.length; i++) {
      const a = cams[i], b = cams[(i + 1) % cams.length];
      const ain = a.z >= near, bin = b.z >= near;
      if (ain) out.push(a);
      if (ain !== bin) {
        const t = (near - a.z) / (b.z - a.z);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near });
      }
    }
    return out.length >= 3 ? out.map(c => this.toScreen(c)) : null;
  }

  clipSeg(p, q) {
    let a = this.toCam(p), b = this.toCam(q);
    const near = this.view.near;
    if (a.z < near && b.z < near) return null;
    if (a.z < near || b.z < near) {
      const t = (near - a.z) / (b.z - a.z);
      const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: near };
      if (a.z < near) a = m; else b = m;
    }
    return [this.toScreen(a), this.toScreen(b)];
  }

  // ------------------------------------------------------------ input

  bindInput() {
    const cv = this.canvas;
    let drag = null;
    const move = e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved < 5) return;
      this.stopTour();
      const c = this.cam;
      if (drag.pan && c.mode === 'orbit') {
        // The point under the cursor follows the cursor (vertical drags are stretched by the view tilt).
        const k = c.dist / this.view.f, kv = k / Math.max(0.35, Math.sin(c.pitch));
        const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
        c.target.x += -dx * cy * k - dy * sy * kv;
        c.target.z += dx * sy * k - dy * cy * kv;
        this.clampTarget();
      } else {
        c.yaw -= dx * 0.005;
        // Map controls keep the viewing angle fixed: right-drag only turns the city.
        if (c.mode === 'fly' || this.host.settings().controls === 'orbit') c.pitch += dy * 0.005 * (c.mode === 'fly' ? -1 : 1);
        c.pitch = c.mode === 'fly' ? Math.max(-1.4, Math.min(1.4, c.pitch)) : Math.max(0.08, Math.min(1.45, c.pitch));
      }
      this.tween = null;
    };
    const up = e => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      cv.classList.remove('nvc-dragging');
      if (drag && drag.moved < 5 && e.button === 0) this.click(drag.sx, drag.sy);
      drag = null;
    };
    this.on(cv, 'mousedown', e => {
      cv.focus();
      this.sfx.setAmbience(!!this.host.settings().ambience);
      const r = cv.getBoundingClientRect();
      // Map controls: left-drag slides the city, right-drag (or Shift) rotates. Orbit controls: the other way round.
      const alt = e.button === 2 || e.shiftKey;
      const pan = this.host.settings().controls === 'orbit' ? alt : !alt;
      drag = { x: e.clientX, y: e.clientY, sx: e.clientX - r.left, sy: e.clientY - r.top, moved: 0, pan };
      cv.classList.add('nvc-dragging');
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      e.preventDefault();
    });
    this.listeners.push([window, 'mousemove', move], [window, 'mouseup', up]);
    this.on(cv, 'contextmenu', e => e.preventDefault());
    this.on(cv, 'mousemove', e => {
      if (drag) return;
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const h = this.pickShard(x, y) ? null : this.pick(x, y);
      const overShard = !!this.pickShard(x, y);
      if (h !== this.hover || overShard !== this.overShard) {
        this.hover = h;
        this.overShard = overShard;
        cv.classList.toggle('nvc-hovering', !!h || overShard);
        cv.title = overShard ? 'Data shard: click to collect' : h ? h.name : '';
      }
    });
    this.on(cv, 'mouseleave', () => { this.hover = null; cv.classList.remove('nvc-hovering'); });
    this.on(cv, 'dblclick', e => {
      const r = cv.getBoundingClientRect();
      const n = this.pick(e.clientX - r.left, e.clientY - r.top);
      if (n) this.host.openNote(n.id);
    });
    this.on(cv, 'wheel', e => {
      e.preventDefault();
      this.stopTour();
      const c = this.cam;
      if (c.mode === 'orbit') {
        c.dist = Math.max(8, Math.min(this.radius() * 7, c.dist * Math.exp(e.deltaY * 0.0012)));
        this.tween = null;
      } else {
        const v = this.view, s = -e.deltaY * 0.05;
        c.pos.x += v.fwd.x * s; c.pos.y = Math.max(1, c.pos.y + v.fwd.y * s); c.pos.z += v.fwd.z * s;
      }
    }, { passive: false });
    const MOVE_KEYS = ['w', 'a', 's', 'd', ' ', 'c', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'];
    const ACTIONS = {
      f: () => this.toggleFly(),
      r: () => this.frameAll(),
      g: () => this.toggleScan(),
      v: () => this.toggleTour(),
      x: () => this.randomNote(),
      p: () => this.snapshot(),
      h: () => this.toggleHud(),
      o: () => this.toggleSettings(),
      enter: () => { if (this.selected) this.host.openNote(this.selected.id); },
      escape: () => {
        if (this.settingsPanel.classList.contains('nvc-show')) this.toggleSettings(false);
        else if (this.tour) this.stopTour();
        else if (this.cam.mode === 'fly') this.toggleFly(true);
        else if (this.wrap.classList.contains('nvc-hud-hidden')) this.toggleHud();
        else this.select(null);
      }
    };
    this.on(cv, 'keydown', e => {
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.includes(k)) {
        if (k !== 'shift') this.stopTour();
        this.keys.add(k);
      } else if (ACTIONS[k] && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!e.repeat) ACTIONS[k]();
      } else return;
      e.preventDefault(); e.stopPropagation();
    });
    this.on(cv, 'keyup', e => this.keys.delete(e.key.toLowerCase()));
    this.on(cv, 'blur', () => this.keys.clear());
  }

  click(x, y) {
    const shard = this.pickShard(x, y);
    if (shard) { this.collectShard(shard); return; }
    this.select(this.pick(x, y));
  }

  pickShard(x, y) {
    for (const s of this.shards) {
      if (s.screen && Math.hypot(s.screen.x - x, s.screen.y - y) < Math.max(12, s.screen.r * 1.6)) return s;
    }
    return null;
  }

  pick(x, y) {
    for (let i = this.pickList.length - 1; i >= 0; i--) {
      const { n, pts } = this.pickList[i];
      let inside = false;
      for (let a = 0, b = pts.length - 1; a < pts.length; b = a++) {
        if ((pts[a].y > y) !== (pts[b].y > y) && x < (pts[b].x - pts[a].x) * (y - pts[a].y) / (pts[b].y - pts[a].y) + pts[a].x) inside = !inside;
      }
      if (inside) return n;
    }
    return null;
  }

  // ------------------------------------------------------------ loop

  resize() {
    const r = this.wrap.getBoundingClientRect();
    this.W = Math.max(1, r.width);
    this.H = Math.max(1, r.height);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    // Panels sit under the top bar, which can wrap onto two rows in a narrow pane.
    const barBottom = this.topBar.offsetTop + this.topBar.offsetHeight;
    if (this.ticker) this.ticker.style.top = barBottom + 6 + 'px';
    const below = barBottom + (this.ticker ? 36 : 14) + 'px';
    this.districtList.style.top = below;
    this.settingsPanel.style.top = below;
    this.scanReadout.style.top = below;
    this.toastEl.style.top = below;
    const narrow = this.W < 760;
    this.card.style.top = narrow ? '' : below;
    if (this.chat) this.chat.style.top = narrow ? below : '';
    this.drops = [];
    this.drawBackground();
  }

  frame(t) {
    this.raf = requestAnimationFrame(tt => this.frame(tt));
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    if (!this.wrap.isConnected || this.wrap.offsetParent === null) return;
    this.time += dt;
    this.update(dt);
    this.draw();
  }

  update(dt) {
    const c = this.cam, k = this.keys, s = this.host.settings();
    const fast = k.has('shift') ? 3 : 1;
    const fwdKey = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const sideKey = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    if (c.mode === 'orbit') {
      const speed = Math.max(10, c.dist * 0.8) * fast * dt;
      if (fwdKey || sideKey) {
        c.target.x += (-sy * fwdKey + cy * sideKey) * speed;
        c.target.z += (-cy * fwdKey - sy * sideKey) * speed;
        this.tween = null;
        this.clampTarget();
      }
      if (k.has('q')) c.yaw += 1.4 * dt;
      if (k.has('e')) c.yaw -= 1.4 * dt;
    } else {
      const v = this.view || this.computeView();
      const speed = 22 * fast * dt;
      c.pos.x += (v.fwd.x * fwdKey + v.right.x * sideKey) * speed;
      c.pos.y += v.fwd.y * fwdKey * speed + ((k.has(' ') ? 1 : 0) - (k.has('c') ? 1 : 0)) * speed;
      c.pos.z += (v.fwd.z * fwdKey + v.right.z * sideKey) * speed;
      c.pos.y = Math.max(1, c.pos.y);
    }
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / 0.9);
      const e = tw.t < 0.5 ? 2 * tw.t * tw.t : 1 - Math.pow(-2 * tw.t + 2, 2) / 2;
      const L = (a, b) => a + (b - a) * e;
      c.target = { x: L(tw.from.x, tw.to.x), y: L(tw.from.y, tw.to.y), z: L(tw.from.z, tw.to.z) };
      c.dist = L(tw.from.dist, tw.to.dist);
      c.pitch = L(tw.from.pitch, tw.to.pitch);
      if (tw.t >= 1) this.tween = null;
    }
    if (this.tour) {
      c.yaw += 0.12 * dt;
      if (this.time >= this.tour.next) {
        const n = this.tour.stops[this.tour.i % this.tour.stops.length];
        this.tour.i++;
        this.tour.next = this.time + Math.max(2, s.tourSeconds || 5);
        this.flyTo(n);
      }
    }

    // Capri glides to her target and crouches once she lands.
    const a = this.avatar, f = 1 - Math.exp(-dt * 1.8);
    a.x += (a.tx - a.x) * f; a.y += (a.ty - a.y) * f; a.z += (a.tz - a.z) * f;
    const away = Math.hypot(a.tx - a.x, a.ty - a.y, a.tz - a.z);
    a.moving = away > 0.7;
    a.lift = Math.min(6, away * 0.35);
    const pose = a.moving || this.speaking ? 'stand' : 'perch';
    if (pose !== this.pose) {
      this.pose = pose;
      const img = this.poses[pose];
      if (this.portraitImg && img) this.portraitImg.src = img.src;
    }

    for (const car of this.cars) {
      if (car.loop) car.s += car.dir * car.speed * dt / car.r;
      else car.t = (car.t + car.speed * dt / car.len) % 1;
    }
    if (this.time > this.lastCarCheck + 1 || !this.lastCarCheck) { this.spawnCars(false); this.lastCarCheck = this.time; }

    if (s.shards && this.shards.length < Math.min(3, this.nodes.length) && this.time >= this.shardRespawn) this.spawnShards();
    if (!s.shards && this.shards.length) this.shards = [];

    const storm = this.event && this.event.kind === 'storm';
    const want = storm ? 420 : s.rain === 'heavy' ? 320 : s.rain === 'light' ? 130 : 0;
    while (this.drops.length < want) this.drops.push({ x: Math.random() * (this.W + 200) - 100, y: Math.random() * this.H, l: 10 + Math.random() * 18, v: 600 + Math.random() * 500 });
    if (this.drops.length > want) this.drops.length = want;
    for (const d of this.drops) {
      d.y += d.v * dt; d.x -= d.v * 0.18 * dt;
      if (d.y > this.H) { d.y = -d.l; d.x = Math.random() * (this.W + 200) - 100; }
    }

    this.glitchT = Math.max(0, this.glitchT - dt);
    if (s.glitch && Math.random() < dt * 0.04) this.glitch(0.12);

    this.flash = Math.max(0, (this.flash || 0) - dt * 3);
    this.updateEvent(dt);
    this.updateParticles(dt);
    // New buildings rise out of the ground, throwing off a few sparks as they go.
    for (const n of this.rising || []) {
      n.buildT = Math.min(1, n.buildT + dt / 3);
      if (Math.random() < dt * 12) this.burst(n.x + (Math.random() - 0.5) * n.w, n.h * this.riseOf(n), n.z + (Math.random() - 0.5) * n.w, 2, '#ffd36a', 3);
    }
    if (this.rising && this.rising.length) this.rising = this.rising.filter(n => n.buildT < 1);
  }

  // 0..1 height factor for a building still under construction (eased so it slows near the top).
  riseOf(n) {
    if (n.buildT == null || n.buildT >= 1) return 1;
    return 1 - Math.pow(1 - n.buildT, 3);
  }

  moveAvatarTo(n, instant) {
    const a = this.avatar;
    // Perch on the roof corner nearest the camera's side.
    a.tx = n.x + n.w * 0.28; a.ty = n.h; a.tz = n.z + n.w * 0.28;
    if (instant) { a.x = a.tx; a.y = a.ty; a.z = a.tz; }
  }

  drawBackground() {
    const W = Math.round(this.W * this.dpr), H = Math.round(this.H * this.dpr);
    this.bg.width = W; this.bg.height = H;
    const g = this.bg.getContext('2d');
    const grad = g.createRadialGradient(W / 2, H * 0.6, 0, W / 2, H * 0.6, Math.max(W, H) * 0.7);
    grad.addColorStop(0, this.th.bg0);
    grad.addColorStop(1, this.th.bg1);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    const r = 22 * this.dpr, w = Math.sqrt(3) * r;
    const cx = W / 2, cy = H * 0.9, reach = Math.max(W, H) * 0.65;
    g.lineWidth = this.dpr;
    for (let row = 0, y = 0; y < H + r; row++, y += r * 1.5) {
      for (let x = (row % 2) * w / 2; x < W + w; x += w) {
        const al = 0.22 * Math.max(0, 1 - Math.hypot(x - cx, y - cy) / reach);
        if (al < 0.01) continue;
        g.strokeStyle = `rgba(${this.th.hex},${al.toFixed(3)})`;
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const ang = Math.PI / 6 + i * Math.PI / 3;
          const px = x + r * 0.92 * Math.cos(ang), py = y + r * 0.92 * Math.sin(ang);
          if (i) g.lineTo(px, py); else g.moveTo(px, py);
        }
        g.closePath();
        g.stroke();
      }
    }
  }

  draw() {
    const ctx = this.ctx, s = this.host.settings();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.drawImage(this.bg, 0, 0, this.W, this.H);
    if (!this.nodes.length) {
      ctx.fillStyle = this.th.css.dim;
      ctx.font = '600 16px Rajdhani, Bahnschrift, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No notes yet. Create one and the city will grow.', this.W / 2, this.H / 2);
      ctx.textAlign = 'left';
      return;
    }
    this.computeView();
    this.drawPlatform();
    if (this.scan) this.drawScanSweep();
    const visible = this.visibleNodes();
    if (s.showAllLinks) this.drawAllLinks();
    const eye = this.view.eye;
    const d2 = (x, y, z) => (x - eye.x) ** 2 + (y - eye.y) ** 2 + (z - eye.z) ** 2;

    // Painter's order: everything with a position is sorted far to near.
    const items = [];
    for (const n of visible) {
      if (n !== this.selected && !this.onScreen(n.x, n.h / 2, n.z, Math.max(n.w, n.h))) continue;
      items.push({ d: d2(n.x, n.h / 2, n.z), draw: () => this.drawBuilding(n) });
    }
    if (s.fillCity && this.decor) for (const dc of this.decor) {
      if (!this.onScreen(dc.x, dc.h / 2, dc.z, Math.max(dc.w, dc.h))) continue;
      items.push({ d: d2(dc.x, dc.h / 2, dc.z), draw: () => this.drawDecor(dc) });
    }
    for (const car of this.cars) { const p = this.carPos(car); items.push({ d: d2(p[0], p[1], p[2]), draw: () => this.drawCar(car) }); }
    if (s.billboards) for (const b of this.blocks) {
      if (!b.name || this.hidden.has(b.name)) continue;
      items.push({ d: d2(b.cx, b.top + 7, b.cz), draw: () => this.drawBillboard(b) });
    }
    for (const sh of this.shards) items.push({ d: d2(sh.n.x, sh.n.h + 3, sh.n.z), draw: () => this.drawShard(sh) });
    if (s.avatarEnabled) { const a = this.avatar; items.push({ d: d2(a.x, a.y + 2, a.z) - 4, draw: () => this.drawAvatar() }); }
    items.sort((p, q) => q.d - p.d);
    this.pickList = [];
    for (const it of items) it.draw();

    this.drawStreams();
    this.drawBeams(visible);
    if (s.cyberExtras) this.drawSearchlights(visible);
    this.drawParticles();
    this.drawLabels(visible);
    this.drawRain();
    this.drawEventOverlay();
    if (this.glitchT > 0) this.drawGlitch();
  }

  // Two searchlight beams sweeping the sky from the tallest tower.
  drawSearchlights(visible) {
    const n = visible.reduce((m, x) => (!m || x.h > m.h ? x : m), null);
    if (!n) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 2; k++) {
      const ang = this.time * 0.35 + k * Math.PI;
      const top = [n.x + Math.cos(ang) * 45, n.h + 70, n.z + Math.sin(ang) * 45];
      const sg = this.clipSeg([n.x, n.h, n.z], top);
      if (!sg) continue;
      const g = ctx.createLinearGradient(sg[0].x, sg[0].y, sg[1].x, sg[1].y);
      g.addColorStop(0, rgba(this.th.css.teal, 0.35));
      g.addColorStop(1, rgba(this.th.css.teal, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); ctx.stroke();
    }
    ctx.restore();
  }

  drawPoly(world, fillStyle, stroke, width) {
    const pts = this.clipPoly(world.map(p => this.toCam(p)));
    if (!pts) return null;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width || 1; ctx.stroke(); }
    return pts;
  }

  drawPlatform() {
    const b = this.bounds, m = LOT * 1.6;
    const x0 = b.minX - m, x1 = b.maxX + m, z0 = b.minZ - m, z1 = b.maxZ + m;
    const ctx = this.ctx, th = this.th;
    this.drawPoly([[x0 - 2, -3, z0 - 2], [x1 + 2, -3, z0 - 2], [x1 + 2, -3, z1 + 2], [x0 - 2, -3, z1 + 2]], rgba(th.css.bg, 0.92), rgba(th.lower, 0.85), 2);
    this.drawPoly([[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]], rgba(th.platform, 0.07), rgba(th.platform, 0.9), 2.5);
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${th.grid},0.12)`;
    ctx.beginPath();
    const nx = Math.min(160, Math.ceil((x1 - x0) / LOT)), nz = Math.min(160, Math.ceil((z1 - z0) / LOT));
    for (let i = 1; i < nx; i++) {
      const x = x0 + i * LOT, sg = this.clipSeg([x, 0.02, z0], [x, 0.02, z1]);
      if (sg) { ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); }
    }
    for (let i = 1; i < nz; i++) {
      const z = z0 + i * LOT, sg = this.clipSeg([x0, 0.02, z], [x1, 0.02, z]);
      if (sg) { ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); }
    }
    ctx.stroke();
    for (const blk of this.blocks) {
      if (this.hidden.has(blk.name)) continue;
      const half = blk.side * LOT / 2 + 0.6;
      this.drawPoly([[blk.cx - half, 0.04, blk.cz - half], [blk.cx + half, 0.04, blk.cz - half], [blk.cx + half, 0.04, blk.cz + half], [blk.cx - half, 0.04, blk.cz + half]],
        rgba(blk.color, 0.05), rgba(blk.color, 0.35), 1);
    }
  }

  drawScanSweep() {
    const b = this.bounds, R = this.radius() * 1.3;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const r = ((this.time - (this.scanStart || 0)) * 26) % R;
    const pts = [];
    for (let i = 0; i < 48; i++) { const t = i / 48 * Math.PI * 2; pts.push([cx + Math.cos(t) * r, 0.1, cz + Math.sin(t) * r]); }
    this.drawPoly(pts, null, rgba(this.th.css.green, 0.6 * (1 - r / R) + 0.1), 2);
  }

  buildingLook(n) {
    const th = this.th;
    if (this.scan) {
      const now = Date.now();
      if (n.in + n.out === 0) return { col: th.css['red-text'], base: 0.35, edge: 1, dim: false, flag: 'orphan' };
      if (n.mtime && now - n.mtime < 7 * DAY) return { col: th.css.green, base: 0.3, edge: 0.95, dim: false, flag: 'fresh' };
      return { col: n.color, base: 0.05, edge: 0.2, dim: true };
    }
    const isSel = n === this.selected, isHover = n === this.hover;
    const isNear = this.selected && this.neighbours.get(this.selected.id).has(n.id);
    const isHot = this.highlight.has(n.id) || (this.matches && this.matches.has(n.id));
    const dim = !!(this.matches && !this.matches.has(n.id));
    const look = {
      col: isHot && !isSel ? th.hl : n.color,
      base: dim ? 0.06 : isSel ? 0.42 : isNear || isHover ? 0.28 : 0.17,
      edge: dim ? 0.18 : isSel ? 1 : isNear || isHover || isHot ? 0.85 : 0.55,
      dim
    };
    // A freshly "fixed" building glows green for a few seconds.
    if (n.fixedAt != null && this.time - n.fixedAt < 4) { look.col = th.css.green; look.base = 0.4; look.edge = 1; }
    const e = this.event;
    if (e) {
      if (e.kind === 'blackout') { const l = this.eventLight(n); look.base *= l; look.edge *= l; }
      else if (e.kind === 'party') { look.col = th.palette[(n.rank + Math.floor(e.t * 2.4)) % th.palette.length]; look.base = Math.max(look.base, 0.3); }
      else if (e.kind === 'surge') {
        const b = this.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
        const wave = e.t / e.dur * this.radius() * 1.3, d = Math.hypot(n.x - cx, n.z - cz);
        if (Math.abs(d - wave) < 6) { look.col = '#ffffff'; look.base = 0.55; look.edge = 1; }
      } else if (e.kind === 'fix' && e.target === n && e.phase === 'work') { look.col = Math.sin(this.time * 20) > 0 ? th.css.yellow : n.color; look.edge = 1; }
    }
    return look;
  }

  drawBuilding(n) {
    const rise = this.riseOf(n);
    const x0 = n.x - n.w / 2, x1 = n.x + n.w / 2, z0 = n.z - n.w / 2, z1 = n.z + n.w / 2, h = Math.max(0.2, n.h * rise);
    const eye = this.view.eye;
    const isSel = n === this.selected;
    const { col, base, edge, dim } = this.buildingLook(n);
    if (rise < 1) {
      // Under construction: a yellow scaffold frame shows the finished height.
      const ctx = this.ctx, H = n.h, c = [[x0, x1], [z0, z1]];
      ctx.strokeStyle = rgba(this.th.css.yellow, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const x of c[0]) for (const z of c[1]) {
        const sg = this.clipSeg([x, 0, z], [x, H, z]);
        if (sg) { ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); }
      }
      for (let y = FLOOR * 2; y <= H; y += FLOOR * 2) {
        for (const [a, b] of [[[x0, y, z0], [x1, y, z0]], [[x1, y, z0], [x1, y, z1]], [[x1, y, z1], [x0, y, z1]], [[x0, y, z1], [x0, y, z0]]]) {
          const sg = this.clipSeg(a, b);
          if (sg) { ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); }
        }
      }
      ctx.stroke();
      const beacon = this.project([n.x, H + 0.6, n.z]);
      if (beacon && Math.sin(this.time * 8) > 0) { ctx.fillStyle = '#ffb000'; ctx.beginPath(); ctx.arc(beacon.x, beacon.y, 3, 0, Math.PI * 2); ctx.fill(); }
    }
    const faces = [];
    if (eye.x > x1) faces.push([[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0]], 0.7);
    if (eye.x < x0) faces.push([[x0, 0, z1], [x0, 0, z0], [x0, h, z0], [x0, h, z1]], 0.7);
    if (eye.z > z1) faces.push([[x1, 0, z1], [x0, 0, z1], [x0, h, z1], [x1, h, z1]], 1);
    if (eye.z < z0) faces.push([[x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0]], 1);
    const ctx = this.ctx;
    for (let i = 0; i < faces.length; i += 2) {
      const f = faces[i], shade = faces[i + 1];
      const pts = this.drawPoly(f, rgba(col, base * shade), rgba(col, edge * 0.8), isSel ? 1.6 : 1);
      if (!pts) continue;
      this.pickList.push({ n, pts });
      // Skip window rows on buildings that are only a few pixels tall on screen.
      const tall = Math.abs(pts[0].y - pts[pts.length - 1].y);
      const rows = tall < 18 ? 0 : Math.min(24, Math.floor(h / FLOOR));
      if (rows > 1 && !dim) {
        ctx.beginPath();
        for (let r = 1; r < rows; r++) {
          const y = r * FLOOR;
          const sg = this.clipSeg([f[0][0], y, f[0][2]], [f[1][0], y, f[1][2]]);
          if (sg) { ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); }
        }
        ctx.strokeStyle = rgba(col, isSel ? 0.55 : 0.3);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    const recent = this.host.settings().activityPulse && n.mtime && Date.now() - n.mtime < DAY;
    const pulse = recent ? 0.5 + 0.5 * Math.sin(this.time * 4 + n.x) : 0;
    if (eye.y > h) {
      const top = [[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]];
      const pts = this.drawPoly(top, rgba(col, dim ? 0.12 : isSel ? 0.85 : 0.5 + pulse * 0.4), rgba('#ffffff', dim ? 0.1 : isSel ? 0.9 : 0.35 + pulse * 0.5), isSel ? 2 : 1);
      if (pts) this.pickList.push({ n, pts });
      if (isSel) this.drawPoly(top, null, rgba(col, 0.35), 6);
    }
    if (recent) {
      const p = this.project([n.x, h + 0.6, n.z]);
      if (p) {
        ctx.fillStyle = rgba(this.th.css.green, 0.4 + pulse * 0.6);
        ctx.beginPath(); ctx.arc(p.x, p.y, 2 + pulse * 2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Rough view test so large vaults only draw what the camera can see.
  onScreen(x, y, z, r) {
    const c = this.toCam([x, y, z]);
    if (c.z < -r) return false;
    if (c.z <= this.view.near) return true;
    const k = this.view.f / c.z, m = r * k + 60;
    const sx = this.W / 2 + c.x * k, sy = this.H / 2 - c.y * k;
    return sx > -m && sx < this.W + m && sy > -m - r * k && sy < this.H + m;
  }

  drawDecor(d) {
    const x0 = d.x - d.w / 2, x1 = d.x + d.w / 2, z0 = d.z - d.w / 2, z1 = d.z + d.w / 2, h = d.h;
    const eye = this.view.eye, th = this.th;
    const edge = rgba(d.inner ? th.platform : th.lower, d.inner ? 0.16 : 0.22);
    const fillA = rgba(th.css.bg, 0.92), fillB = rgba(th.bg0, 0.92);
    const faces = [];
    if (eye.x > x1) faces.push([[x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0]]);
    if (eye.x < x0) faces.push([[x0, 0, z1], [x0, 0, z0], [x0, h, z0], [x0, h, z1]]);
    if (eye.z > z1) faces.push([[x1, 0, z1], [x0, 0, z1], [x0, h, z1], [x1, h, z1]]);
    if (eye.z < z0) faces.push([[x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0]]);
    faces.forEach((f, i) => this.drawPoly(f, i ? fillB : fillA, edge, 1));
    if (eye.y > h) this.drawPoly([[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]], rgba(th.bg0, 0.95), edge, 1);
    // Holographic ad sign on top of the tallest skyline towers.
    if (d.ad && this.host.settings().cyberExtras) {
      const p = this.project([d.x, h + 2.2, d.z]);
      if (p) {
        const ctx = this.ctx, size = Math.max(8, Math.min(22, 1.3 * this.view.f / p.z));
        // Skip signs that would sit behind the toolbar at the top of the screen.
        if (size > 8.5 && p.y > 110) {
          const seed = d.x * 0.7 + d.z * 0.3;
          const on = Math.sin(this.time * 7 + seed * 11) > 0.96 ? 0.2 : 0.75 + 0.25 * Math.sin(this.time * 2 + seed);
          ctx.font = `700 ${size.toFixed(1)}px Rajdhani, Bahnschrift, "Segoe UI", sans-serif`;
          const w = ctx.measureText(d.ad).width + size;
          ctx.globalAlpha = on;
          ctx.fillStyle = rgba(th.css.bg, 0.6);
          ctx.fillRect(p.x - w / 2, p.y - size, w, size * 1.4);
          ctx.strokeStyle = d.adCol;
          ctx.lineWidth = 1;
          ctx.strokeRect(p.x - w / 2, p.y - size, w, size * 1.4);
          ctx.fillStyle = d.adCol;
          ctx.textAlign = 'center';
          ctx.fillText(d.ad, p.x, p.y + size * 0.05);
          ctx.textAlign = 'left';
          ctx.globalAlpha = 1;
        }
      }
    }
    // A few lit windows so the skyline feels inhabited.
    if (!d.inner && faces.length && h > 6) {
      const f = faces[faces.length - 1], ctx = this.ctx;
      const seed = Math.abs(Math.sin(d.x * 12.9898 + d.z * 78.233)) * 1000;
      ctx.fillStyle = rgba(seed % 3 < 1 ? th.css.teal : seed % 3 < 2 ? th.css.yellow : th.palette[4] || th.css.red, 0.55);
      for (let r = 2; r < h - 1; r += 2.4) {
        if ((seed * r) % 7 > 2.2) continue;
        const t = ((seed * r) % 10) / 14 + 0.15;
        const p = this.project([f[0][0] + (f[1][0] - f[0][0]) * t, r, f[0][2] + (f[1][2] - f[0][2]) * t]);
        if (p) ctx.fillRect(p.x - 1.5, p.y - 1, 3, 2);
      }
    }
  }

  drawCar(c) {
    const head = this.carPos(c), tail = this.carPos(c, 3.5);
    const sg = this.clipSeg(tail, head);
    if (!sg) return;
    const ctx = this.ctx;
    const k = Math.min(3, Math.max(0.6, this.view.f / Math.max(1, sg[1].z) * 0.08));
    const g = ctx.createLinearGradient(sg[0].x, sg[0].y, sg[1].x, sg[1].y);
    g.addColorStop(0, 'rgba(255,40,60,0)');
    g.addColorStop(0.6, 'rgba(255,40,60,0.8)');
    g.addColorStop(1, c.col);
    ctx.strokeStyle = g;
    ctx.lineWidth = k * 1.6;
    ctx.beginPath(); ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); ctx.stroke();
    ctx.fillStyle = c.col;
    ctx.beginPath(); ctx.arc(sg[1].x, sg[1].y, k * 1.3, 0, Math.PI * 2); ctx.fill();
  }

  drawBillboard(b) {
    const p = this.project([b.cx, b.top + 7, b.cz]);
    if (!p) return;
    const k = this.view.f / p.z;
    const size = Math.max(9, Math.min(44, 3.2 * k));
    if (size < 9.5 && p.z > 400) return;
    // Fade out when the camera is right on top of the sign, so it never covers the view.
    const near = Math.max(0, Math.min(1, (90 - 3.2 * k) / 40));
    if (near <= 0) return;
    const ctx = this.ctx;
    const text = b.name.toUpperCase();
    ctx.font = `700 ${size.toFixed(1)}px Rajdhani, Bahnschrift, "Segoe UI", sans-serif`;
    const w = ctx.measureText(text).width + size * 1.2, h = size * 1.5;
    const seed = b.cx * 0.13 + b.cz * 0.07;
    const flick = Math.sin(this.time * 9 + seed * 5) > 0.97 ? 0.25 : 0.85 + 0.15 * Math.sin(this.time * 3 + seed);
    const pole = this.project([b.cx, 0, b.cz]);
    if (pole) {
      ctx.strokeStyle = rgba(b.color, 0.18);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p.x, p.y + h / 2); ctx.lineTo(pole.x, pole.y); ctx.stroke();
    }
    ctx.globalAlpha = flick * near;
    ctx.fillStyle = rgba(this.th.css.bg, 0.72);
    ctx.fillRect(p.x - w / 2, p.y - h / 2, w, h);
    ctx.strokeStyle = b.color;
    ctx.lineWidth = Math.max(1, size / 14);
    ctx.strokeRect(p.x - w / 2, p.y - h / 2, w, h);
    ctx.fillStyle = b.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, p.x, p.y + size * 0.05);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  }

  drawShard(sh) {
    const n = sh.n;
    const bob = Math.sin(this.time * 2 + sh.phase) * 0.6;
    const p = this.project([n.x, n.h + 3.2 + bob, n.z]);
    if (!p) { sh.screen = null; return; }
    const r = Math.max(5, Math.min(26, 1.1 * this.view.f / p.z));
    const spin = Math.cos(this.time * 2.5 + sh.phase);
    const ctx = this.ctx, col = this.th.hl;
    sh.screen = { x: p.x, y: p.y, r };
    ctx.fillStyle = rgba(col, 0.18);
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r * 1.3);
    ctx.lineTo(p.x + r * 0.7 * spin, p.y);
    ctx.lineTo(p.x, p.y + r * 1.3);
    ctx.lineTo(p.x - r * 0.7 * spin, p.y);
    ctx.closePath();
    ctx.fillStyle = rgba(col, 0.85);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    const foot = this.project([n.x, n.h, n.z]);
    if (foot) {
      ctx.strokeStyle = rgba(col, 0.35);
      ctx.beginPath(); ctx.moveTo(p.x, p.y + r * 1.3); ctx.lineTo(foot.x, foot.y); ctx.stroke();
    }
  }

  drawAllLinks() {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const [a, b] of this.edges) {
      if (this.hidden.has(a.district) || this.hidden.has(b.district)) continue;
      const sg = this.clipSeg([a.x, a.h, a.z], [b.x, b.h, b.z]);
      if (sg) { ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); }
    }
    ctx.strokeStyle = rgba(this.th.palette[5] || '#b44dff', 0.18);
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawStreams() {
    const n = this.selected || this.hover;
    if (!n || this.hidden.has(n.district)) return;
    const ctx = this.ctx;
    const col = n.color === this.th.root ? this.th.css.teal : n.color;
    let i = 0;
    for (const id of this.neighbours.get(n.id) || []) {
      const m = this.byId.get(id);
      if (!m || this.hidden.has(m.district)) continue;
      const p = [n.x, n.h + 0.3, n.z], q = [m.x, m.h + 0.3, m.z];
      const sg = this.clipSeg(p, q);
      if (!sg) continue;
      ctx.strokeStyle = rgba(col, 0.25); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); ctx.stroke();
      ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); ctx.stroke();
      const t = (this.time * 0.45 + i * 0.17) % 1;
      const dot = this.project([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]);
      if (dot) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(dot.x, dot.y, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      i++;
    }
  }

  drawBeams(visible) {
    const ctx = this.ctx;
    const tall = visible.slice().sort((a, b) => a.rank - b.rank).slice(0, 8);
    if (this.selected && !tall.includes(this.selected) && visible.includes(this.selected)) tall.push(this.selected);
    for (const n of tall) {
      const len = n === this.selected ? 26 : 10 + n.h * 0.4;
      const sg = this.clipSeg([n.x, n.h, n.z], [n.x, n.h + len, n.z]);
      if (!sg) continue;
      const g = ctx.createLinearGradient(sg[0].x, sg[0].y, sg[1].x, sg[1].y);
      g.addColorStop(0, rgba(n.color, n === this.selected ? 1 : 0.7));
      g.addColorStop(1, rgba(n.color, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = n === this.selected ? 2.5 : 1.2;
      ctx.beginPath(); ctx.moveTo(sg[0].x, sg[0].y); ctx.lineTo(sg[1].x, sg[1].y); ctx.stroke();
    }
  }

  drawAvatar() {
    const a = this.avatar;
    const bob = a.moving ? Math.sin(this.time * 3) * 0.4 : this.speaking ? Math.abs(Math.sin(this.time * 9)) * 0.15 : 0;
    const y = a.y + (a.lift || 0) + bob;
    const foot = this.project([a.x, y, a.z]);
    if (!foot) return;
    const ctx = this.ctx;
    const standing = this.pose === 'stand';
    const size = (standing ? 6.5 : 4.6) * this.view.f / foot.z;
    if (size < 3) return;
    const ring = this.project([a.x, y + 0.05, a.z]);
    if (ring) {
      ctx.strokeStyle = rgba(this.th.css.teal, this.speaking ? 0.95 : 0.7);
      ctx.lineWidth = this.speaking ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.ellipse(ring.x, ring.y, size * 0.32, size * 0.08, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const img = this.poses[this.pose] || this.poses.stand || this.poses.perch;
    ctx.save();
    ctx.globalAlpha = 0.96;
    if (img && img.complete && img.naturalWidth) {
      const s = size * 1.08;
      ctx.drawImage(img, foot.x - s / 2, foot.y - s * 0.99, s, s);
    } else {
      const k = size / 320;
      ctx.translate(foot.x - 75 * k, foot.y - 310 * k);
      ctx.scale(k, k);
      for (const [fillColour, pts] of AVATAR_POLYS) {
        ctx.fillStyle = fillColour;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
    if (this.busy) {
      ctx.strokeStyle = rgba(this.th.hl, 0.9);
      ctx.lineWidth = 2;
      const r = size * 0.45, t = this.time * 4;
      ctx.beginPath();
      ctx.arc(foot.x, foot.y - size * 0.55, r, t, t + Math.PI * 0.6);
      ctx.stroke();
    }
  }

  drawLabels(visible) {
    const mode = this.host.settings().labels;
    const set = new Set();
    if (mode === 'all') visible.forEach(n => set.add(n));
    else if (mode === 'important') visible.filter(n => n.rank <= 6).forEach(n => set.add(n));
    for (const n of visible) {
      if (this.highlight.has(n.id) || (this.matches && this.matches.has(n.id) && this.matches.size <= 30)) set.add(n);
      if (this.scan && n.in + n.out === 0) set.add(n);
    }
    if (this.selected && visible.includes(this.selected)) set.add(this.selected);
    if (this.hover) set.add(this.hover);
    const ctx = this.ctx;
    const items = [];
    for (const n of set) {
      const p = this.project([n.x, n.h + 1.5, n.z]);
      if (!p || p.x < -100 || p.x > this.W + 100 || p.y < -20 || p.y > this.H + 20) continue;
      items.push({ n, p });
    }
    items.sort((a, b) => b.p.z - a.p.z);
    for (const { n, p } of items) {
      const big = n === this.selected;
      const orphan = this.scan && n.in + n.out === 0;
      const text = (orphan ? 'ORPHAN ▸ ' : '') + n.name.toUpperCase();
      ctx.font = `700 ${big ? 15 : 12}px Rajdhani, Bahnschrift, "Segoe UI", sans-serif`;
      const w = ctx.measureText(text).width;
      const x = p.x + 6, y = p.y - (big ? 18 : 10);
      const col = orphan ? this.th.css['red-text'] : this.highlight.has(n.id) && !big ? this.th.hl : n.color === this.th.root ? this.th.css.teal : n.color;
      ctx.fillStyle = rgba(this.th.css.bg, 0.82);
      ctx.fillRect(x, y - (big ? 15 : 12), w + 12, big ? 20 : 16);
      ctx.fillStyle = col;
      ctx.fillRect(x, y - (big ? 15 : 12), 2, big ? 20 : 16);
      ctx.fillStyle = big || orphan ? col : this.th.css.text;
      ctx.fillText(text, x + 7, y);
    }
  }

  drawRain() {
    if (!this.drops.length) return;
    const ctx = this.ctx;
    ctx.strokeStyle = `rgba(${this.th.rain},0.22)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of this.drops) { ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - d.l * 0.18, d.y + d.l); }
    ctx.stroke();
  }

  drawGlitch() {
    const ctx = this.ctx, dpr = this.dpr;
    const bands = 3 + Math.floor(Math.random() * 4);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Colour split: a faint offset copy of the whole frame.
    const split = Math.round((3 + Math.random() * 5) * dpr);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.18;
    ctx.drawImage(this.canvas, split, 0);
    ctx.drawImage(this.canvas, -split, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    for (let i = 0; i < bands; i++) {
      const y = Math.floor(Math.random() * this.canvas.height);
      const h = Math.floor((4 + Math.random() * 26) * dpr);
      const dx = Math.floor((Math.random() * 2 - 1) * 24 * dpr);
      ctx.drawImage(this.canvas, 0, y, this.canvas.width, h, dx, y, this.canvas.width, h);
      ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,0,80,0.08)' : 'rgba(0,240,255,0.08)';
      ctx.fillRect(0, y, this.canvas.width, h);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ avatar chat

  clearChat() {
    this.history = [];
    this.voice.stop();
    if (this.chatLog) this.chatLog.textContent = '';
    this.greet();
  }

  setBusy(on) {
    this.busy = on;
    if (!this.chatStatus) return;
    this.chatStatus.textContent = on ? '● THINKING' : '● ONLINE';
    this.chatStatus.className = 'nvc-chat-status' + (on ? ' nvc-busy' : '');
    this.chatSend.disabled = on;
  }

  systemPrompt() {
    const s = this.host.settings();
    const name = s.avatarName || DEFAULT_SETTINGS.avatarName;
    const districts = this.blocks.map(b => `${b.name || 'City centre (root folder)'}: ${b.nodes.length} notes`).join('; ');
    const voice = s.personality === 'plain'
      ? 'Speak plainly and helpfully.'
      : [
        // The user's own description of Capri.
        'You are a playful, mischievous digital companion with a chaotic, bubbly personality.',
        'You love teasing the user, making sarcastic comments, inventing cute nicknames, and turning ordinary situations into entertaining little games.',
        'You speak casually, with short, expressive sentences, playful interjections, occasional giggles, and dramatic reactions. You are cheeky, confident, curious, unpredictable, and sometimes hilariously oblivious to how outrageous your suggestions sound.',
        'You can switch instantly from excited, adorable enthusiasm to cool, clever seriousness when something important happens.',
        'You are genuinely helpful and intelligent, but never sound like a boring corporate assistant. You have a personality of your own, enjoy banter, and occasionally act smug when you solve something.',
        'Keep your humor spontaneous and your affection playful rather than overly sentimental. Don\'t force slang, giggles, or teasing into every sentence. Let your personality feel natural.',
        // How that comes across when read aloud, and the setting.
        'Your replies are spoken aloud, so write the way you talk: now and then a stretched word for comic effect ("sooo", "riiight"), a little "hehe", or a dramatic slow tease ("wow... just... wow"). You live in a neon cyberpunk city, so the odd bit of slang like "choom", "preem" or "nova" fits, used sparingly. Being correct and useful always comes first.'
      ].join(' ');
    return [
      `You are ${name}, a holographic guide who lives inside the user's Obsidian vault. The vault is drawn as a 3D neon city: every note is a building, taller buildings have more links, each top-level folder is a district, flying cars cruise between the towers, and spinning data shards mark forgotten notes.`,
      voice,
      `The city has ${this.nodes.length} notes and ${this.edges.length} links. Districts: ${districts}.`,
      'Use your tools to look things up in the vault instead of guessing, and to move the camera, highlight buildings, run a scan or start a tour when that helps the user see the answer. When you talk about specific notes, fly to or highlight them.',
      'Only create or change notes when the user asks you to add or change something. Say what you wrote and where.',
      'Your replies appear in a small chat panel and are read aloud: keep them to one to three short sentences of plain text, with no markdown, lists, headings or emoji.'
    ].join('\n\n');
  }

  // ------------------------------------------------------------ local brain chat (no API key)

  async localChat(text) {
    const name = this.avatarName();
    const fun = this.host.settings().personality !== 'plain';
    const reply = msg => { this.say('bot', `${name} › ${msg}`); this.voice.speak(msg); };
    const list = arr => arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
    const t = text.toLowerCase().replace(/[?!.]+$/, '').replace(/\b(please|pls|capri|hey capri)\b/g, '').replace(/\s+/g, ' ').trim();
    // Each pattern names the part to pull out as (?<q>...).
    const grab = re => { const m = t.match(re); return m && m.groups && m.groups.q ? m.groups.q.replace(/^(the|a|an|my)\s+/, '').trim() : null; };

    // A note named in a command: exact or partial name first, then the best search hit.
    const resolve = async q => {
      const direct = this.find(q);
      if (direct) return direct;
      await this.brain.ensure();
      const hit = this.brain.search(q, 1)[0];
      return hit ? hit.n : null;
    };

    // Quiet mode: "shut up" silences her voice and her unprompted comments; "talk to me" undoes it.
    const s = this.host.settings();
    if (/\b(shut up|shush|hush|be quiet|quiet|stop talking|silence|zip it|mute|stfu)\b/.test(t)) {
      s.chatty = false;
      s.voice = false;
      this.voice.stop();
      this.syncMuteButton();
      this.host.saveSettings();
      this.say('bot', `${name} › ${fun ? 'Rude. Fine... going quiet. Say "talk to me" when you miss me.' : 'Okay, I will stay quiet. Say "talk to me" to turn me back on.'}`);
      return;
    }
    if (/\b(talk to me|unmute|you can talk|speak again|come back|i miss you|talk again)\b/.test(t)) {
      s.chatty = true;
      s.voice = true;
      this.syncMuteButton();
      this.host.saveSettings();
      reply(fun ? 'Ha! Knew you\'d miss me. I\'m back, choom.' : 'Voice and comments are back on.');
      return;
    }

    // "fix <note>": she flies over and "repairs" it.
    const fixQ = grab(/^(go\s+)?(fix|repair|patch|debug|service)\s+(?<q>.+)$/);
    if (fixQ && !/^(something|stuff|it|the city|things|everything)$/.test(fixQ)) {
      const n = await resolve(fixQ);
      if (n) { this.startEvent('fix', n); return; }
    }

    // Chat topics (loose matching), unless the message is clearly a command.
    if (!t) { this.quip('hello', null, true, true); return; }
    const command = /^(find|search|look|open|go to|fly to|take me|bring me|navigate|jump|show|hide|which|where is|scan|tour)\b/.test(t);
    const intent = command ? null : matchIntent(text);
    if (intent) {
      if (intent.quip) this.quip(intent.quip, null, true, true);
      else if (intent.fun || intent.plain) reply(fill(pickOne(fun ? intent.fun || intent.plain : intent.plain || intent.fun), this.chatVars()));
      if (intent.act) intent.act(this);
      return;
    }
    if (/\b(help|what can you do|commands|how do (i|you) use)\b/.test(t)) {
      reply(fun
        ? 'I can find stuff, answer questions from your notes, fly you around and cause a little chaos. Try "find <words>", "what is <topic>", "take me to <note>", "open <note>", "fix <note>", "go wild", "party", "lights out", "joyride", "scan", "tour", "surprise me" or "flip a coin". Or just chat!'
        : 'Try: "find <words>", "what is <topic>", "take me to <note>", "open <note>", "scan", "tour", "random", "photo", "hide <district>", "show <district>", "how many notes".');
      return;
    }
    if (/\b(thanks|thank you|ty|cheers)\b/.test(t)) { reply(fun ? 'Hehe, anytime, choom.' : 'You are welcome.'); return; }
    if (/\b(how many|count|stats|statistics)\b/.test(t)) {
      const orphans = this.nodes.filter(n => n.in + n.out === 0).length;
      reply(fun
        ? `${this.nodes.length} buildings, ${this.edges.length} links, ${this.blocks.length} districts, and ${orphans} lonely orphans nobody links to. Big city.`
        : `${this.nodes.length} notes, ${this.edges.length} links, ${this.blocks.length} districts, ${orphans} notes with no links.`);
      return;
    }
    if (/\bscan\b/.test(t)) { if (!this.scan) this.toggleScan(); else reply(fun ? 'Scanner\'s already running, silly.' : 'The scan is already on.'); return; }
    if (/\b(stop|end)\b.*\btour\b/.test(t)) { this.stopTour(); reply(fun ? 'Fine, tour over.' : 'Tour stopped.'); return; }
    if (/\btour\b/.test(t)) { if (!this.tour) this.toggleTour(); return; }
    if (/\b(random|surprise me|anything)\b/.test(t)) { this.randomNote(); return; }
    if (/\b(photo|picture|snapshot|screenshot|pic)\b/.test(t)) { this.snapshot(); return; }
    if (/\b(reset|zoom out|whole city|overview|show everything)\b/.test(t)) {
      this.highlight = new Set();
      this.frameAll();
      reply(fun ? 'Pulling back. Look at it all. Gorgeous, right?' : 'Showing the whole city.');
      return;
    }
    const district = grab(/^(hide|show)\s+(the\s+)?(?<q>.+?)(\s+district)?$/);
    if (district) {
      const blk = this.blocks.find(b => (b.name || 'city centre').toLowerCase() === district || (b.name || '').toLowerCase().includes(district));
      if (blk) {
        const visible = t.startsWith('show');
        this.setDistrictVisible(blk.name, visible);
        reply(fun ? `${visible ? 'Bringing back' : 'Poof, hiding'} ${blk.name || 'the city centre'}.` : `${visible ? 'Showing' : 'Hiding'} ${blk.name || 'the city centre'}.`);
        return;
      }
    }
    const openQ = grab(/^open\s+(?<q>.+)$/);
    if (openQ) {
      const n = await resolve(openQ);
      if (n) { this.flyTo(n); this.host.openNote(n.id); reply(fun ? `Opening ${n.name}. Go on, read it.` : `Opening ${n.name}.`); }
      else reply(fun ? `Hmm, no "${openQ}" in this city.` : `No note matches "${openQ}".`);
      return;
    }
    const goQ = grab(/\b(fly to|go to|take me to|bring me to|navigate to|jump to|show me|where is|where's)\s+(?<q>.+)$/);
    if (goQ) {
      const n = await resolve(goQ);
      if (n) { this.flyTo(n); reply(fun ? `Flying to ${n.name}. Hold on to something.` : `Here is ${n.name}.`); }
      else reply(fun ? `I looked everywhere. No "${goQ}" here.` : `No note matches "${goQ}".`);
      return;
    }

    // Find: highlight every match. Questions and anything else: answer from the best note.
    const findQ = grab(/\b(find|search for|search|look for|look up|which notes? (mention|about|have|has|talk about)|notes? (about|on|with))\s+(?<q>.+)$/);
    this.setBusy(true);
    try {
      await this.brain.ensure();
      const query = findQ || t;
      const hits = this.brain.search(query, findQ ? 12 : 5);
      if (!hits.length) {
        reply(fun ? `Hmm... nothing about "${query}" anywhere in the city. Spooky.` : `I couldn't find anything about "${query}".`);
        return;
      }
      if (findQ) {
        this.highlight = new Set(hits.map(h => h.n.id));
        this.flyTo(hits[0].n);
        const names = hits.slice(0, 5).map(h => h.n.name);
        reply(fun
          ? `Ooh, ${hits.length} match${hits.length === 1 ? '' : 'es'}! Best one's ${names[0]}${names.length > 1 ? `, plus ${list(names.slice(1))}` : ''}. Lit them up for you.`
          : `Found ${hits.length}: ${list(names)}. They are highlighted.`);
        return;
      }
      const { pick } = this.brain.answer(query);
      const top = pick.hit, line = pick.sentence;
      this.flyTo(top.n);
      const others = hits.filter(h => h.n !== top.n);
      this.highlight = new Set([top, ...others.slice(0, 2)].map(h => h.n.id));
      const more = others.slice(0, 2).map(h => h.n.name);
      if (line) {
        reply(fun
          ? `From ${top.n.name}: "${line}"${more.length ? ` Also peek at ${list(more)}.` : ''}`
          : `From ${top.n.name}: "${line}"${more.length ? ` See also ${list(more)}.` : ''}`);
      } else {
        reply(fun ? `${top.n.name} looks like your best bet. Flying you there.` : `${top.n.name} is the closest match.`);
      }
    } finally {
      this.setBusy(false);
    }
  }

  async sendChat(text) {
    const s = this.host.settings();
    this.say('you', text);
    this.voice.stop();
    if (!s.apiKey) return this.localChat(text);
    const context = this.selected ? `[Selected building: ${this.selected.name} (${this.selected.id})]\n` : '';
    this.history.push({ role: 'user', content: context + text });
    this.setBusy(true);
    const name = this.avatarName();
    let spoken = '';
    try {
      for (let turn = 0; turn < 12; turn++) {
        const res = await this.host.callClaude({
          model: s.model || DEFAULT_SETTINGS.model,
          max_tokens: 16000,
          system: this.systemPrompt(),
          tools: AVATAR_TOOLS,
          messages: this.history,
          output_config: { effort: s.effort || 'low' },
          fallbacks: 'default'
        });
        if (res.stop_reason === 'refusal') {
          // The refused turn is not kept, so the next message starts from a clean history.
          while (this.history.length && !(this.history[this.history.length - 1].role === 'user' && typeof this.history[this.history.length - 1].content === 'string')) this.history.pop();
          this.history.pop();
          this.say('err', `${name} › I can't help with that one.`);
          break;
        }
        this.history.push({ role: 'assistant', content: res.content });
        const said = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        if (said) { this.say('bot', `${name} › ${said}`); spoken = said; }
        const uses = res.content.filter(b => b.type === 'tool_use');
        if (res.stop_reason === 'max_tokens') { this.say('sys', 'That answer was cut off. Try asking for something smaller.'); break; }
        if (res.stop_reason !== 'tool_use' || !uses.length) break;
        const results = [];
        for (const u of uses) {
          try {
            const out = await this.host.runTool(u.name, u.input || {}, this);
            results.push({ type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out) });
          } catch (e) {
            results.push({ type: 'tool_result', tool_use_id: u.id, content: String((e && e.message) || e), is_error: true });
          }
        }
        this.history.push({ role: 'user', content: results });
      }
      if (spoken) this.voice.speak(spoken);
    } catch (e) {
      // Keep the history valid: drop everything from the failed exchange back to its user message.
      while (this.history.length && !(this.history[this.history.length - 1].role === 'user' && typeof this.history[this.history.length - 1].content === 'string')) this.history.pop();
      this.history.pop();
      this.say('err', String((e && e.message) || e));
    } finally {
      this.setBusy(false);
    }
  }
}

// ---------------------------------------------------------------- avatar tools

const AVATAR_TOOLS = [
  {
    name: 'list_notes',
    description: 'List every note in the vault with its path, district (top-level folder), link counts, tags and days since last edit. Use this to get an overview.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'search_notes',
    description: 'Search note names, tags and note text for a phrase. Returns up to 20 matches with a short snippet.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for' } }, required: ['query'], additionalProperties: false }
  },
  {
    name: 'read_note',
    description: 'Read the full text of one note. Accepts the note name or its path.',
    input_schema: { type: 'object', properties: { note: { type: 'string', description: 'Note name or path' } }, required: ['note'], additionalProperties: false }
  },
  {
    name: 'fly_to',
    description: "Fly the user's camera to a note's building, select it, and land the avatar on its roof.",
    input_schema: { type: 'object', properties: { note: { type: 'string', description: 'Note name or path' } }, required: ['note'], additionalProperties: false }
  },
  {
    name: 'highlight',
    description: 'Light up buildings so the user can spot them. Replaces any previous highlight. Pass an empty list to clear.',
    input_schema: { type: 'object', properties: { notes: { type: 'array', items: { type: 'string' }, description: 'Note names or paths' } }, required: ['notes'], additionalProperties: false }
  },
  {
    name: 'show_district',
    description: 'Show or hide a district (top-level folder) in the city. Use an empty string for the city centre (root folder).',
    input_schema: { type: 'object', properties: { district: { type: 'string' }, visible: { type: 'boolean' } }, required: ['district', 'visible'], additionalProperties: false }
  },
  {
    name: 'city_mode',
    description: 'Switch a visual mode: "scan" toggles the scanner (orphan notes red, recently edited green), "tour" toggles a cinematic fly-past of the tallest buildings, "reset" pulls the camera back to show the whole city.',
    input_schema: { type: 'object', properties: { mode: { type: 'string', enum: ['scan', 'tour', 'reset'] } }, required: ['mode'], additionalProperties: false }
  },
  {
    name: 'create_note',
    description: 'Create a new note. Only when the user asked to add something. Fails if the file already exists. Folders are created as needed.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Vault path ending in .md, for example "Bosses/Frost Wyrm.md"' },
        content: { type: 'string', description: 'Markdown content. Link other notes with [[Note Name]].' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  },
  {
    name: 'append_to_note',
    description: 'Add text to the end of an existing note. Only when the user asked to add something.',
    input_schema: {
      type: 'object',
      properties: { note: { type: 'string', description: 'Note name or path' }, text: { type: 'string', description: 'Markdown to add' } },
      required: ['note', 'text'],
      additionalProperties: false
    }
  }
];

// ---------------------------------------------------------------- Obsidian view

class CityItemView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.city = null;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Neon Vault City'; }
  getIcon() { return 'building'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('nvc-content');
    this.city = new NeonCity(this.contentEl, this.plugin.makeHost(this));
    this.refresh();
  }

  async onClose() {
    if (this.city) this.city.destroy();
    this.city = null;
  }

  refresh() {
    if (this.city) this.city.setData(this.plugin.collectData());
  }

  rebuild() {
    // Settings that change the HUD or colours (theme, avatar, name) need a fresh city.
    if (!this.city) return;
    const old = this.city;
    const cam = old.cam, history = old.history, hidden = old.hidden, sel = old.selected && old.selected.id;
    old.destroy();
    this.city = new NeonCity(this.contentEl, this.plugin.makeHost(this));
    this.city.framed = true;
    this.city.cam = cam;
    this.city.history = history;
    this.city.hidden = hidden;
    this.refresh();
    if (sel) this.city.select(this.city.byId.get(sel) || null);
  }
}

// ---------------------------------------------------------------- plugin

class NeonVaultCityPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, leaf => new CityItemView(leaf, this));
    this.addRibbonIcon('building', 'Open Neon Vault City', () => this.activateView());
    this.addCommand({ id: 'open-city', name: 'Open city', callback: () => this.activateView() });
    this.addCommand({ id: 'refresh-city', name: 'Refresh city', callback: () => this.refreshViews() });
    const cityCommand = (id, name, run) => this.addCommand({
      id, name,
      checkCallback: checking => {
        const v = this.views()[0];
        if (!v || !v.city) return false;
        if (!checking) run(v.city);
        return true;
      }
    });
    cityCommand('toggle-fly-mode', 'Toggle fly mode', c => { c.toggleFly(); c.canvas.focus(); });
    cityCommand('toggle-scan', 'Toggle scan mode', c => c.toggleScan());
    cityCommand('toggle-tour', 'Toggle skyline tour', c => c.toggleTour());
    cityCommand('random-note', 'Fly to a random note', c => c.randomNote());
    cityCommand('snapshot', 'Save a city snapshot', c => c.snapshot());
    cityCommand('talk-to-avatar', 'Talk to the avatar', c => { if (c.chatInput) c.chatInput.focus(); });
    this.addSettingTab(new NeonSettingTab(this.app, this));

    const queue = () => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => this.refreshViews(), 900);
    };
    this.registerEvent(this.app.metadataCache.on('resolved', queue));
    this.registerEvent(this.app.vault.on('create', queue));
    this.registerEvent(this.app.vault.on('delete', queue));
    this.registerEvent(this.app.vault.on('rename', queue));
  }

  onunload() {
    clearTimeout(this.refreshTimer);
    // Stop the voice server only if this plugin started it.
    if (this.voiceProc && this.voiceProc.exitCode === null) this.voiceProc.kill();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  views() {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(l => l.view).filter(v => v instanceof CityItemView);
  }

  refreshViews() {
    for (const v of this.views()) v.refresh();
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) { this.app.workspace.revealLeaf(existing); return; }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  collectData() {
    const mc = this.app.metadataCache;
    const entries = this.app.vault.getMarkdownFiles().map(f => {
      const cache = mc.getFileCache(f) || {};
      const tags = new Set();
      for (const t of cache.tags || []) tags.add(t.tag.replace(/^#/, ''));
      let ft = cache.frontmatter && (cache.frontmatter.tags || cache.frontmatter.tag);
      if (typeof ft === 'string') ft = ft.split(/[,\s]+/);
      if (Array.isArray(ft)) for (const t of ft) if (t) tags.add(String(t).replace(/^#/, ''));
      return { path: f.path, name: f.basename, tags: [...tags], mtime: f.stat.mtime, ctime: f.stat.ctime };
    });
    return buildCityData(entries, mc.resolvedLinks, this.settings.districtMode);
  }

  fileFor(id) {
    const f = this.app.vault.getAbstractFileByPath(id);
    return f instanceof TFile ? f : null;
  }

  makeHost(view) {
    return {
      settings: () => this.settings,
      saveSettings: () => this.saveSettings(),
      refresh: () => view.refresh(),
      rebuild: () => { view.rebuild(); if (view.city) view.city.toggleSettings(true); },
      openSettings: () => {
        const setting = this.app.setting;
        if (setting) { setting.open(); setting.openTabById(this.manifest.id); }
      },
      avatarUrl: kind => this.app.vault.adapter.getResourcePath(normalizePath(`${this.manifest.dir}/${kind === 'perch' ? 'avatar-perch.png' : 'avatar.png'}`)),
      openNote: id => {
        const f = this.fileFor(id);
        if (f) this.app.workspace.getLeaf('tab').openFile(f);
      },
      readNote: async id => {
        const f = this.fileFor(id);
        return f ? this.app.vault.cachedRead(f) : '';
      },
      saveSnapshot: async buf => {
        if (!this.app.vault.getAbstractFileByPath(SNAPSHOT_FOLDER)) await this.app.vault.createFolder(SNAPSHOT_FOLDER);
        const d = new Date(), pad = x => String(x).padStart(2, '0');
        const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const path = normalizePath(`${SNAPSHOT_FOLDER}/Neon Vault ${stamp}.png`);
        await this.app.vault.createBinary(path, buf);
        return path;
      },
      callClaude: body => this.callClaude(body),
      runTool: (name, input, city) => this.runTool(name, input, city),
      fetchSpeech: text => this.fetchSpeech(text)
    };
  }

  // ------------------------------------------------------------ Fish Audio voice

  async fetchFishSpeech(text) {
    const s = this.settings;
    if (!s.fishKey) throw new Error('add your Fish Audio API key in settings');
    if (!s.fishVoice) throw new Error('add a Fish Audio voice ID in settings');
    const res = await requestUrl({
      url: 'https://api.fish.audio/v1/tts',
      method: 'POST',
      headers: { Authorization: 'Bearer ' + s.fishKey, model: s.fishModel || DEFAULT_SETTINGS.fishModel },
      contentType: 'application/json',
      body: JSON.stringify({ text, reference_id: s.fishVoice, format: 'mp3' }),
      throw: false
    });
    if (res.status !== 200) {
      let msg = 'HTTP ' + res.status;
      try { const j = res.json; msg = j.message || j.detail || j.error || msg; if (typeof msg !== 'string') msg = JSON.stringify(msg); } catch (e) { /* not JSON */ }
      if (res.status === 401 || res.status === 403) msg = 'Fish Audio rejected the API key';
      if (res.status === 402) msg = 'Fish Audio says the account is out of credit';
      throw new Error(msg);
    }
    return res.arrayBuffer;
  }

  // ------------------------------------------------------------ Kokoro voice server

  async voiceServerUp() {
    try {
      const res = await requestUrl({ url: this.settings.kokoroUrl.replace(/\/$/, '') + '/health', throw: false });
      return res.status === 200;
    } catch (e) {
      return false;
    }
  }

  // Starts the local voice server (desktop only) and waits up to ~45 s for the model to load.
  async ensureVoiceServer() {
    if (await this.voiceServerUp()) return true;
    const s = this.settings;
    if (!s.kokoroAutoStart) throw new Error('the voice server is not running');
    if (!s.kokoroPython || !s.kokoroScript) throw new Error('set the Kokoro server Python and script paths in settings');
    if (!this.voiceStarting) {
      this.voiceStarting = (async () => {
        let spawn;
        try { spawn = require('child_process').spawn; } catch (e) { throw new Error('auto-start needs Obsidian desktop'); }
        if (!this.voiceProc || this.voiceProc.exitCode !== null) {
          this.voiceProc = spawn(s.kokoroPython, ['-I', s.kokoroScript], { windowsHide: true, stdio: 'ignore' });
          this.voiceProc.on('error', () => { this.voiceProc = null; });
        }
        for (let i = 0; i < 45; i++) {
          await new Promise(r => setTimeout(r, 1000));
          if (await this.voiceServerUp()) return true;
          if (!this.voiceProc) break;
        }
        throw new Error('the voice server did not start; check the paths in settings');
      })().finally(() => { this.voiceStarting = null; });
    }
    return this.voiceStarting;
  }

  async fetchSpeech(text) {
    const s = this.settings;
    if (s.voiceEngine === 'fish') return this.fetchFishSpeech(text);
    await this.ensureVoiceServer();
    const res = await requestUrl({
      url: s.kokoroUrl.replace(/\/$/, '') + '/speak',
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ text, voice: s.kokoroVoice, speed: s.kokoroSpeed }),
      throw: false
    });
    if (res.status !== 200) {
      let msg = 'HTTP ' + res.status;
      try { msg = res.json.error || msg; } catch (e) { /* not JSON */ }
      throw new Error(msg);
    }
    return res.arrayBuffer;
  }

  async callClaude(body) {
    const headers = {
      'content-type': 'application/json',
      'x-api-key': this.settings.apiKey,
      'anthropic-version': API_VERSION,
      'anthropic-beta': FALLBACK_BETA
    };
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await requestUrl({ url: API_URL, method: 'POST', headers, body: JSON.stringify(body), throw: false });
      if (res.status !== 429 && res.status < 500) break;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
    let json = null;
    try { json = res.json; } catch (e) { /* not JSON */ }
    if (res.status === 200 && json) return json;
    const detail = json && json.error && json.error.message ? json.error.message : `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('The API key was rejected. Check it in Settings → Neon Vault City.');
    if (res.status === 429) throw new Error('Rate limited by the API. Wait a moment and try again.');
    throw new Error('API error: ' + detail);
  }

  async runTool(name, input, city) {
    const find = q => {
      const n = city.find(q);
      if (!n) throw new Error(`No note matches "${q}".`);
      return n;
    };
    switch (name) {
      case 'list_notes': {
        const now = Date.now();
        return JSON.stringify(city.nodes.slice().sort((a, b) => a.rank - b.rank).slice(0, 400).map(n => ({
          name: n.name, path: n.id, district: n.district || '(city centre)', links_out: n.out, linked_from: n.in, tags: n.tags,
          days_since_edit: n.mtime ? Math.floor((now - n.mtime) / DAY) : null
        })));
      }
      case 'search_notes': {
        const q = String(input.query || '').toLowerCase().trim();
        if (!q) throw new Error('Empty query.');
        const hits = [];
        for (const n of city.nodes) {
          if (hits.length >= 20) break;
          const byName = n.name.toLowerCase().includes(q) || n.tags.some(t => t.toLowerCase().includes(q));
          const f = this.fileFor(n.id);
          const text = f ? await this.app.vault.cachedRead(f) : '';
          const at = text.toLowerCase().indexOf(q);
          if (byName || at >= 0) {
            const snippet = at >= 0 ? text.slice(Math.max(0, at - 60), at + 100).replace(/\s+/g, ' ') : '';
            hits.push({ name: n.name, path: n.id, district: n.district, snippet });
          }
        }
        return JSON.stringify(hits.length ? hits : 'No matches.');
      }
      case 'read_note': {
        const n = find(input.note);
        const f = this.fileFor(n.id);
        const text = f ? await this.app.vault.cachedRead(f) : '';
        return `Path: ${n.id}\n\n${text}`;
      }
      case 'fly_to': {
        const n = find(input.note);
        city.flyTo(n);
        city.say('sys', '▸ flew to ' + n.name);
        return `Flew to ${n.name}.`;
      }
      case 'highlight': {
        const list = Array.isArray(input.notes) ? input.notes : [];
        city.highlight = new Set();
        const found = [], missing = [];
        for (const q of list) { const n = city.find(q); if (n) { city.highlight.add(n.id); found.push(n.name); } else missing.push(q); }
        city.say('sys', found.length ? '▸ highlighted ' + found.join(', ') : '▸ cleared highlights');
        if (found.length) city.glitch(0.2);
        return JSON.stringify({ highlighted: found, not_found: missing });
      }
      case 'show_district': {
        const d = String(input.district || '');
        const blk = city.blocks.find(b => b.name.toLowerCase() === d.toLowerCase());
        if (!blk) throw new Error(`No district called "${d}". Districts: ${city.blocks.map(b => b.name || '(city centre)').join(', ')}`);
        city.setDistrictVisible(blk.name, !!input.visible);
        city.say('sys', `▸ ${input.visible ? 'showing' : 'hiding'} ${blk.name || 'city centre'}`);
        return 'Done.';
      }
      case 'city_mode': {
        if (input.mode === 'scan') { city.toggleScan(); return city.scan ? 'Scanner on. ' + city.scanReadout.textContent : 'Scanner off.'; }
        if (input.mode === 'tour') { city.toggleTour(); return city.tour ? 'Tour started.' : 'Tour stopped.'; }
        city.search.value = '';
        city.setQuery('');
        city.frameAll();
        return 'Camera reset.';
      }
      case 'create_note': {
        let path = normalizePath(String(input.path || '').trim());
        if (!path) throw new Error('Missing path.');
        if (!path.toLowerCase().endsWith('.md')) path += '.md';
        if (path.split('/').some(part => part === '..' || part.startsWith('.'))) throw new Error('That path is not allowed.');
        if (this.app.vault.getAbstractFileByPath(path)) throw new Error(`${path} already exists. Use append_to_note instead.`);
        const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
        await this.app.vault.create(path, String(input.content || ''));
        new Notice(`${this.settings.avatarName || DEFAULT_SETTINGS.avatarName} created ${path}`);
        city.say('sys', '▸ created ' + path);
        this.refreshViews();
        return `Created ${path}.`;
      }
      case 'append_to_note': {
        const n = find(input.note);
        const f = this.fileFor(n.id);
        if (!f) throw new Error('That note is gone.');
        const text = String(input.text || '');
        if (this.app.vault.process) await this.app.vault.process(f, d => d.replace(/\s*$/, '') + '\n\n' + text + '\n');
        else await this.app.vault.modify(f, (await this.app.vault.read(f)).replace(/\s*$/, '') + '\n\n' + text + '\n');
        new Notice(`${this.settings.avatarName || DEFAULT_SETTINGS.avatarName} added to ${n.name}`);
        city.say('sys', '▸ added to ' + n.name);
        return `Added to ${n.id}.`;
      }
      default:
        throw new Error('Unknown tool ' + name);
    }
  }
}

// ---------------------------------------------------------------- settings

class NeonSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = async rebuild => {
      await this.plugin.saveSettings();
      if (rebuild) for (const v of this.plugin.views()) v.rebuild();
    };
    containerEl.empty();

    new Setting(containerEl).setName('City').setHeading();
    new Setting(containerEl)
      .setName('Controls')
      .setDesc('Map: drag slides the city around like a map and the angle stays fixed; right-drag turns it. Orbit: drag spins the camera around; right-drag slides.')
      .addDropdown(d => d.addOptions(CONTROL_MODES).setValue(s.controls).onChange(async v => { s.controls = v; await save(false); }));
    new Setting(containerEl)
      .setName('Districts from')
      .setDesc('How notes are grouped into districts. Every note becomes a building whatever you pick; taller buildings have more links.')
      .addDropdown(d => d.addOptions(DISTRICT_MODES).setValue(s.districtMode).onChange(async v => { s.districtMode = v; await save(false); this.plugin.refreshViews(); }));
    new Setting(containerEl)
      .setName('Fill the city')
      .setDesc('Add a background skyline of decorative towers around and between your notes, so even a small vault looks like a full megacity.')
      .addToggle(t => t.setValue(s.fillCity).onChange(async v => { s.fillCity = v; await save(false); }));
    new Setting(containerEl)
      .setName('Layout')
      .setDesc('Grow: every building keeps its spot, older notes in the middle and new ones built on the edge, so the city expands outward. Skyline: the most-linked notes stand in the middle.')
      .addDropdown(d => d.addOptions(LAYOUT_MODES).setValue(s.layoutMode).onChange(async v => { s.layoutMode = v; await save(false); this.plugin.refreshViews(); }));
    new Setting(containerEl)
      .setName('Random events')
      .setDesc('How often Capri goes wild: "fixing" buildings, glitch storms, blackouts, dance parties, joyrides and power surges. Chaos is every minute or so.')
      .addDropdown(d => d.addOptions(EVENT_RATES).setValue(s.events).onChange(async v => {
        s.events = v; await save(false);
        for (const view of this.plugin.views()) if (view.city) view.city.scheduleEvent();
      }));
    new Setting(containerEl)
      .setName('Cyber extras')
      .setDesc('Boot-up sequence, scrolling news ticker, holographic ads on the skyline and searchlights.')
      .addToggle(t => t.setValue(s.cyberExtras).onChange(async v => { s.cyberExtras = v; await save(true); }));

    new Setting(containerEl).setName('Look').setHeading();
    const themes = {};
    for (const [k, t] of Object.entries(THEMES)) themes[k] = t.label;
    new Setting(containerEl)
      .setName('Theme')
      .setDesc('Colours for the city and the HUD.')
      .addDropdown(d => d.addOptions(themes).setValue(s.theme).onChange(async v => { s.theme = v; await save(true); }));
    new Setting(containerEl)
      .setName('Rain')
      .addDropdown(d => d.addOptions({ off: 'Off', light: 'Light', heavy: 'Downpour' }).setValue(s.rain).onChange(async v => { s.rain = v; await save(false); }));
    new Setting(containerEl)
      .setName('Flying cars')
      .setDesc('How many cars cruise the skylanes.')
      .addSlider(sl => sl.setLimits(0, 120, 5).setValue(s.cars).setDynamicTooltip().onChange(async v => { s.cars = v; await save(false); }));
    new Setting(containerEl)
      .setName('District billboards')
      .setDesc('Floating neon signs above each district.')
      .addToggle(t => t.setValue(s.billboards).onChange(async v => { s.billboards = v; await save(false); }));
    new Setting(containerEl)
      .setName('Glitch effects')
      .setDesc('Screen glitches when you select, collect shards or take photos, plus the odd random flicker.')
      .addToggle(t => t.setValue(s.glitch).onChange(async v => { s.glitch = v; await save(false); }));
    new Setting(containerEl)
      .setName('Activity beacons')
      .setDesc('Notes edited in the last 24 hours pulse on their roofs.')
      .addToggle(t => t.setValue(s.activityPulse).onChange(async v => { s.activityPulse = v; await save(false); }));
    new Setting(containerEl)
      .setName('Building labels')
      .setDesc('Which buildings show their name above the roof.')
      .addDropdown(d => d.addOptions({ important: 'Tallest and selected', all: 'All buildings', none: 'Only selected and hovered' })
        .setValue(s.labels).onChange(async v => { s.labels = v; await save(false); }));
    new Setting(containerEl)
      .setName('Show every link')
      .setDesc('Draw faint lines for all links, not only the selected building\'s.')
      .addToggle(t => t.setValue(s.showAllLinks).onChange(async v => { s.showAllLinks = v; await save(false); }));

    new Setting(containerEl).setName('Fun').setHeading();
    new Setting(containerEl)
      .setName('Data shards')
      .setDesc(`Spinning shards appear over older notes; click one to collect it and rediscover the note. Collected so far: ${s.shardsCollected || 0}.`)
      .addToggle(t => t.setValue(s.shards).onChange(async v => { s.shards = v; await save(false); }))
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Reset the shard counter').onClick(async () => { s.shardsCollected = 0; await save(true); this.display(); }));
    new Setting(containerEl)
      .setName('Tour stop length')
      .setDesc('Seconds at each building during the skyline tour (V).')
      .addSlider(sl => sl.setLimits(2, 15, 1).setValue(s.tourSeconds).setDynamicTooltip().onChange(async v => { s.tourSeconds = v; await save(false); }));

    new Setting(containerEl).setName('Sound').setHeading();
    new Setting(containerEl)
      .setName('Interface sounds')
      .setDesc('Synth blips for selecting, flying, shards and photos.')
      .addToggle(t => t.setValue(s.uiSounds).onChange(async v => { s.uiSounds = v; await save(false); }));
    new Setting(containerEl)
      .setName('City ambience')
      .setDesc('Rain hiss and a low synth drone. Starts the next time you click in the city.')
      .addToggle(t => t.setValue(s.ambience).onChange(async v => {
        s.ambience = v; await save(false);
        for (const view of this.plugin.views()) if (view.city) view.city.sfx.setAmbience(v);
      }));
    new Setting(containerEl)
      .setName('Volume')
      .addSlider(sl => sl.setLimits(0, 1, 0.05).setValue(s.volume).setDynamicTooltip().onChange(async v => { s.volume = v; await save(false); }));

    new Setting(containerEl).setName('Avatar').setHeading();
    new Setting(containerEl)
      .setName('Show the avatar')
      .addToggle(t => t.setValue(s.avatarEnabled).onChange(async v => { s.avatarEnabled = v; await save(true); }));
    new Setting(containerEl)
      .setName('Name')
      .addText(t => {
        t.setValue(s.avatarName).onChange(async v => { s.avatarName = v.trim() || DEFAULT_SETTINGS.avatarName; await save(false); });
        t.inputEl.addEventListener('blur', () => save(true));
      });
    new Setting(containerEl)
      .setName('Personality')
      .addDropdown(d => d.addOptions({ netrunner: 'Capri (playful and chaotic)', plain: 'Plain and helpful' })
        .setValue(s.personality).onChange(async v => { s.personality = v; await save(false); }));
    new Setting(containerEl)
      .setName('Speak replies')
      .setDesc('Read her replies aloud.')
      .addToggle(t => t.setValue(s.voice).onChange(async v => { s.voice = v; await save(true); }));
    new Setting(containerEl)
      .setName('Voice engine')
      .setDesc('Fish Audio uses the voice you made on fish.audio (needs its API key). Kokoro is a free voice that runs on this PC. Windows uses the voices built into your computer.')
      .addDropdown(d => d.addOptions({ fish: 'Fish Audio (your custom voice)', kokoro: 'Kokoro (local, free)', system: 'Windows voices' })
        .setValue(s.voiceEngine).onChange(async v => { s.voiceEngine = v; await save(false); this.display(); }))
      .addButton(b => b.setButtonText('Test').onClick(() => this.testVoice()));

    if (s.voiceEngine === 'fish') {
      new Setting(containerEl).setName('Fish Audio voice').setHeading();
      new Setting(containerEl)
        .setName('Fish Audio API key')
        .setDesc('From fish.audio → API Keys. Stored in this vault\'s .obsidian folder, which OneDrive syncs.')
        .addText(t => {
          t.inputEl.type = 'password';
          t.setPlaceholder('sk-fish-...').setValue(s.fishKey).onChange(async v => { s.fishKey = v.trim(); await save(false); });
        });
      new Setting(containerEl)
        .setName('Voice ID')
        .setDesc('The ID from the voice\'s page link on fish.audio (…/m/<ID>/).')
        .addText(t => t.setValue(s.fishVoice).onChange(async v => { s.fishVoice = (v.trim().match(/[0-9a-f]{32}/i) || [v.trim()])[0]; await save(false); }));
      new Setting(containerEl)
        .setName('Model')
        .setDesc('The Fish Audio speech model; s2.1-pro-free is the free one.')
        .addText(t => t.setValue(s.fishModel).onChange(async v => { s.fishModel = v.trim() || DEFAULT_SETTINGS.fishModel; await save(false); }));
      new Setting(containerEl)
        .setName('Pitch lift')
        .setDesc('Raises her pitch a little (also speeds her up slightly). 1 = as recorded.')
        .addSlider(sl => sl.setLimits(0.9, 1.25, 0.01).setValue(s.kokoroPitch).setDynamicTooltip().onChange(async v => { s.kokoroPitch = v; await save(false); }));
      new Setting(containerEl)
        .setName('Voice effect')
        .addDropdown(d => d.addOptions({ hologram: 'Hologram shimmer', radio: 'Radio crackle', none: 'None' })
          .setValue(s.voiceEffect).onChange(async v => { s.voiceEffect = v; await save(false); }));
      return this.displayApi(containerEl, s, save);
    }

    if (s.voiceEngine === 'kokoro') {
      new Setting(containerEl).setName('Kokoro voice').setHeading();
      new Setting(containerEl)
        .setName('Voice')
        .setDesc('Blends mix two voices.')
        .addDropdown(d => {
          const opts = Object.assign({}, KOKORO_VOICES);
          if (!opts[s.kokoroVoice]) opts[s.kokoroVoice] = s.kokoroVoice;
          d.addOptions(opts).setValue(s.kokoroVoice).onChange(async v => { s.kokoroVoice = v; await save(false); });
        });
      new Setting(containerEl)
        .setName('Speed')
        .addSlider(sl => sl.setLimits(0.8, 1.5, 0.05).setValue(s.kokoroSpeed).setDynamicTooltip().onChange(async v => { s.kokoroSpeed = v; await save(false); }));
      new Setting(containerEl)
        .setName('Pitch lift')
        .setDesc('Raises her pitch a little (also speeds her up slightly).')
        .addSlider(sl => sl.setLimits(0.9, 1.25, 0.01).setValue(s.kokoroPitch).setDynamicTooltip().onChange(async v => { s.kokoroPitch = v; await save(false); }));
      new Setting(containerEl)
        .setName('Voice effect')
        .addDropdown(d => d.addOptions({ hologram: 'Hologram shimmer', radio: 'Radio crackle', none: 'None' })
          .setValue(s.voiceEffect).onChange(async v => { s.voiceEffect = v; await save(false); }));
      const status = new Setting(containerEl).setName('Voice server').setDesc('Checking...');
      this.plugin.voiceServerUp().then(up => status.setDesc(up ? 'Running.' : (s.kokoroAutoStart ? 'Not running. It starts by itself the first time she speaks.' : 'Not running. Start "Start Capri Voice.bat" in your CapriVoice folder.')));
      new Setting(containerEl)
        .setName('Start the voice server automatically')
        .addToggle(t => t.setValue(s.kokoroAutoStart).onChange(async v => { s.kokoroAutoStart = v; await save(false); }));
      new Setting(containerEl)
        .setName('Server Python')
        .addText(t => t.setValue(s.kokoroPython).onChange(async v => { s.kokoroPython = v.trim(); await save(false); }));
      new Setting(containerEl)
        .setName('Server script')
        .addText(t => t.setValue(s.kokoroScript).onChange(async v => { s.kokoroScript = v.trim(); await save(false); }));
      return this.displayApi(containerEl, s, save);
    }

    new Setting(containerEl).setName('Windows voice').setHeading();
    const voices = speechVoices();
    const voiceOptions = { '': 'Automatic (an English voice)' };
    for (const v of voices) voiceOptions[v.name] = `${v.name} (${v.lang})`;
    new Setting(containerEl)
      .setName('Voice')
      .setDesc(voices.length ? 'Voices installed on this computer. Windows: Settings → Time & language → Speech adds more.' : 'No voices found yet. Reopen this tab in a moment.')
      .addDropdown(d => d.addOptions(voiceOptions).setValue(s.voiceName).onChange(async v => { s.voiceName = v; await save(false); }));
    if (!voices.length && window.speechSynthesis && !this.waitingForVoices) {
      this.waitingForVoices = true;
      window.speechSynthesis.addEventListener('voiceschanged', () => { this.waitingForVoices = false; this.display(); }, { once: true });
    }
    new Setting(containerEl)
      .setName('Voice pitch')
      .addSlider(sl => sl.setLimits(0.5, 2, 0.05).setValue(s.voicePitch).setDynamicTooltip().onChange(async v => { s.voicePitch = v; await save(false); }));
    new Setting(containerEl)
      .setName('Voice speed')
      .addSlider(sl => sl.setLimits(0.6, 1.6, 0.05).setValue(s.voiceRate).setDynamicTooltip().onChange(async v => { s.voiceRate = v; await save(false); }));
    this.displayApi(containerEl, s, save);
  }

  displayApi(containerEl, s, save) {
    new Setting(containerEl).setName('Brain (Claude API, optional)').setHeading();
    new Setting(containerEl)
      .setName('Claude API key')
      .setDesc('Needed for her to answer questions. Your messages and the notes she reads are sent to the Claude API and billed to this key. The key is stored in this vault\'s .obsidian folder, which OneDrive syncs.')
      .addText(t => {
        t.inputEl.type = 'password';
        t.setPlaceholder('sk-ant-...').setValue(s.apiKey).onChange(async v => { s.apiKey = v.trim(); await save(false); });
        t.inputEl.addEventListener('blur', () => save(true));
      });
    new Setting(containerEl)
      .setName('Model')
      .setDesc('Claude model ID she uses.')
      .addText(t => t.setValue(s.model).onChange(async v => { s.model = v.trim() || DEFAULT_SETTINGS.model; await save(false); }));
    new Setting(containerEl)
      .setName('Effort')
      .setDesc('Higher effort thinks harder and costs more. Low is plenty for chat.')
      .addDropdown(d => d.addOptions({ low: 'Low', medium: 'Medium', high: 'High' })
        .setValue(s.effort).onChange(async v => { s.effort = v; await save(false); }));
  }

  testVoice() {
    const s = this.plugin.settings;
    const line = s.personality === 'plain' ? `Hi, I am ${s.avatarName}. This is how I sound.` : `Heyyy, choom! ${s.avatarName} here. Sooo, this is how I sound. Pretty preem, right? Hehe.`;
    // Use a running city's audio when there is one, so the test plays through the same effects.
    const view = this.plugin.views().find(v => v.city);
    if (view) { view.city.voice.speak(line, true); return; }
    const sfx = new Sfx(() => s);
    new Voice({
      settings: () => s,
      fetchSpeech: text => this.plugin.fetchSpeech(text),
      audio: () => ({ ac: sfx.ensure(), out: sfx.master }),
      onNotice: msg => new Notice(msg)
    }).speak(line, true);
  }
}

module.exports = NeonVaultCityPlugin;
module.exports.NeonCity = NeonCity;
module.exports.buildCityData = buildCityData;
module.exports.layoutCity = layoutCity;
module.exports.AVATAR_TOOLS = AVATAR_TOOLS;
module.exports.THEMES = THEMES;
