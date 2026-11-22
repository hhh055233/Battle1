// שמע פרוצדורלי (WebAudio): ירי, פיצוץ, צעדים, טעינה, פגיעה, מטוס. בלי קבצים חיצוניים.
let ctx = null, master = null, noiseBuf = null;
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.6;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { ctx = null; }
}
export function setVolume(v) { if (master) master.gain.value = v; }

function out(pan, vol) {
  const g = ctx.createGain(); g.gain.value = vol;
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(master); }
  else g.connect(master);
  return g;
}
function noise(dur, freq, q, type, vol, pan, decay = 0.06, when = 0) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = false;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = out(pan, 0);
  const t = ctx.currentTime + when;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  s.connect(f); f.connect(g); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function tone(freq, freq2, dur, type, vol, pan, when = 0) {
  const o = ctx.createOscillator(); o.type = type; const t = ctx.currentTime + when;
  o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
  const g = out(pan, 0); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g); o.start(t); o.stop(t + dur + 0.05);
}
const att = (d, ref = 12) => 1 / (1 + Math.max(0, d - ref) / 38);
const lp = (d) => Math.max(500, 9000 / (1 + d / 80));

export function sndShot(cls, dist = 0, pan = 0, silenced = false) {
  if (!ctx) return;
  const v = att(dist, 8) * (silenced ? 0.3 : 1);
  if (v < 0.01) return;
  const f = lp(dist);
  switch (cls) {
    case 'pistol': noise(0.14, Math.min(f, 3200), 0.7, 'lowpass', 0.55 * v, pan, 0.14); tone(240, 70, 0.1, 'triangle', 0.35 * v, pan); break;
    case 'smg': noise(0.1, Math.min(f, 3800), 0.7, 'lowpass', 0.5 * v, pan, 0.1); tone(280, 90, 0.07, 'triangle', 0.28 * v, pan); break;
    case 'sg': noise(0.35, Math.min(f, 2600), 0.6, 'lowpass', 1.0 * v, pan, 0.3); tone(110, 35, 0.25, 'sawtooth', 0.55 * v, pan); break;
    case 'sr': noise(0.5, Math.min(f, 2400), 0.5, 'lowpass', 1.0 * v, pan, 0.45); tone(150, 28, 0.4, 'sawtooth', 0.7 * v, pan); break;
    case 'dmr': noise(0.28, Math.min(f, 2800), 0.6, 'lowpass', 0.8 * v, pan, 0.26); tone(170, 40, 0.2, 'sawtooth', 0.5 * v, pan); break;
    default: noise(0.2, Math.min(f, 3000), 0.6, 'lowpass', 0.7 * v, pan, 0.2); tone(190, 45, 0.15, 'sawtooth', 0.42 * v, pan); break;
  }
  if (dist > 150) noise(0.5, 400, 0.5, 'lowpass', 0.25 * v, pan, 0.5, dist / 340);
}
export function sndBoom(dist = 0, pan = 0) {
  if (!ctx) return;
  const v = Math.min(1.4, 1.6 * att(dist, 20));
  if (v < 0.02) return;
  noise(1.4, 500, 0.5, 'lowpass', 1.2 * v, pan, 1.3);
  tone(90, 22, 1.0, 'sine', 1.0 * v, pan);
}
export function sndFlash(vol = 1) { if (!ctx) return; noise(0.12, 4000, 0.6, 'highpass', 0.9 * vol, 0, 0.1); tone(3200, 3000, 1.6, 'sine', 0.12 * vol, 0); }
export function sndReload(stage = 0, pan = 0) { if (!ctx) return; noise(0.05, 2500, 3, 'bandpass', 0.35, pan, 0.05); tone(stage ? 520 : 340, stage ? 400 : 250, 0.06, 'square', 0.1, pan, 0.02); }
export function sndStep(dist = 0, pan = 0, run = false, surface = 'grass') {
  if (!ctx) return;
  const v = att(dist, 4) * (run ? 0.5 : 0.28);
  if (v < 0.015) return;
  noise(0.09, surface === 'road' ? 1400 : 700, 0.9, 'lowpass', v, pan, 0.09);
}
export function sndHit(head = false) { if (!ctx) return; tone(head ? 1500 : 900, head ? 1100 : 700, 0.08, 'square', head ? 0.22 : 0.14, 0); }
export function sndHurt() { if (!ctx) return; noise(0.18, 220, 0.8, 'lowpass', 0.55, 0, 0.18); tone(130, 70, 0.18, 'triangle', 0.35, 0); }
export function sndPick() { if (!ctx) return; tone(700, 900, 0.07, 'sine', 0.15, 0); }
export function sndHeal() { if (!ctx) return; tone(520, 780, 0.2, 'sine', 0.12, 0); }
export function sndPin() { if (!ctx) return; tone(1400, 1000, 0.05, 'square', 0.12, 0); }
export function sndAlert() { if (!ctx) return; tone(880, 880, 0.12, 'sine', 0.18, 0); tone(660, 660, 0.18, 'sine', 0.18, 0, 0.15); }
export function sndPlane(dist = 0, pan = 0) {
  if (!ctx) return;
  const v = att(dist, 80) * 0.15;
  if (v < 0.01) return;
  noise(0.25, 160, 1.2, 'lowpass', v, pan, 0.25);
}
export function sndWind(speed) { if (!ctx) return; noise(0.12, 700 + speed * 20, 0.6, 'bandpass', Math.min(0.12, speed / 500), 0, 0.12); }
export function sndZoneTick() { if (!ctx) return; tone(120, 100, 0.08, 'sine', 0.1, 0); }
