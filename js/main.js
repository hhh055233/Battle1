// נקודת הכניסה: תפריט, לובי, יצירת/הצטרפות לחדר, חיבור בין ה-host, הרשת והמשחק.
import * as THREE from 'three';
import { Host, DEFAULT_SETTINGS } from './sim/host.js';
import { openRoom, joinRoom, randomCode } from './net.js';
import { connectServer, normServerUrl } from './netws.js';
import { SERVER_URL as CFG_SERVER } from '../config.js';
import { Game } from './game.js';
import { HUD } from './hud.js';
import * as A from './audio.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('cr_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cr_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};
const prefs = { sens: store.get('sens', 10), vol: store.get('vol', 60), fov: store.get('fov', 80), shadow: store.get('shadow', 2048) };
$('p-sens').value = prefs.sens; $('p-vol').value = prefs.vol; $('p-fov').value = prefs.fov; $('p-shadow').value = String(prefs.shadow);
$('name').value = store.get('name', '');

const canvas = $('c');
const hud = new HUD();
let renderer = null;
function makeRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

// ---------- מצב ----------
const S = { host: null, net: null, game: null, idx: -1, isHost: false, code: '', name: '', lobby: null, players: [], ticker: null, solo: false, srv: null, mgr: false };
// שרת ייעודי (אופציונלי): ?server=wss://... בקישור (נשמר בדפדפן), אחרת config.js. ?server=off מבטל.
const SRV = (() => {
  const qs = new URLSearchParams(location.search).get('server');
  if (qs === 'off') { store.set('server', ''); return { url: '', fromCfg: false }; }
  if (qs) { const u = normServerUrl(qs); store.set('server', u); return { url: u, fromCfg: false }; }
  const saved = normServerUrl(store.get('server', ''));
  if (saved) return { url: saved, fromCfg: false };
  return { url: normServerUrl(CFG_SERVER || ''), fromCfg: true };
})();
const canManage = () => S.isHost || S.mgr;
const errText = (e) => (e && e.message) || String(e);

const show = (id, on = true) => $(id).classList.toggle('hidden', !on);
const screens = ['menu', 'lobby', 'loading'];
function showScreen(name) { for (const s of screens) show(s, s === name); }
function msg(el, text) { $(el).textContent = text || ''; }
function toast(t) { hud.toast(t); }

function myName() {
  let n = $('name').value.trim().replace(/[<>&"']/g, '').slice(0, 14);
  if (!n) n = 'Player' + Math.floor(Math.random() * 900 + 100);
  store.set('name', $('name').value.trim());
  return n;
}

// ---------- host ----------
function startTicker(fn, ms) {
  try {
    const blob = new Blob([`setInterval(()=>postMessage(0),${ms})`], { type: 'text/javascript' });
    const w = new Worker(URL.createObjectURL(blob)); w.onmessage = fn; return () => w.terminate();
  } catch (e) { const id = setInterval(fn, ms); return () => clearInterval(id); }
}

function createHost(name) {
  const io = {
    all(m, except) { for (const p of S.host.players.values()) { if (p.bot || p.gone) continue; if (p.idx === except) continue; deliver(p.idx, m); } },
    one(idx, m) { deliver(idx, m); },
    bin(idx, buf) { deliver(idx, buf); },
  };
  S.host = new Host(io, name);
  S.idx = S.host.hostIdx; S.isHost = true;
  let last = performance.now();
  S.ticker = startTicker(() => {
    const now = performance.now(); let dt = (now - last) / 1000; last = now;
    dt = Math.min(dt, 0.5);
    while (dt > 0) { const d = Math.min(dt, 1 / 30); S.host.update(d); dt -= d; }
  }, 16);
}
function deliver(idx, m) {
  if (idx === S.host.hostIdx) { route(m); return; }
  if (S.net) S.net.send(idx, m);
}

// ---------- ניתוב הודעות (משותף למנהל ולקוח) ----------
function route(m) {
  if (m instanceof ArrayBuffer) { if (S.game) S.game.onMessage(m); return; }
  if (!m || !m.t) return;
  switch (m.t) {
    case 'lobby':
      if (S.game && (S.game.ended || S.game.deathShown)) { leaveGame(false); }
      if (!S.game) { S.lobby = m; renderLobby(); }
      break;
    case 'start': startGame(m); break;
    case 'mgr': S.mgr = !!m.on; if (!S.game && S.lobby) { openLobby(); renderLobby(); } break;
    case 'bye': if (S.srv) { toast(m.why || 'החדר נסגר'); closedByHost(); } break;
    default: if (S.game) S.game.onMessage(m); break;
  }
}

// ---------- יצירת חדר / הצטרפות ----------
async function enterServerRoom(req) {
  const c = await connectServer(SRV.url, { ...req, n: S.name }, { onData: (d) => route(d), onClose: () => closedByHost() });
  S.srv = c; S.net = { send: (_, m) => c.send(m), raw: c, close: c.close }; S.clientSend = (m) => c.send(m);
  S.idx = c.idx; S.isHost = false; S.mgr = c.mgr; S.code = c.code; S.solo = false;
  msg('menu-msg', '');
  openLobby();
}

async function createRoom() {
  A.initAudio();
  S.name = myName();
  if (SRV.url) {
    msg('menu-msg', 'מתחבר לשרת...');
    try { await enterServerRoom({ t: 'create' }); return; }
    catch (e) { if (!window.Peer) { msg('menu-msg', 'השרת לא זמין: ' + errText(e)); return; } toast('השרת לא זמין - יוצר חדר ישיר (P2P)'); }
  }
  msg('menu-msg', 'יוצר חדר...');
  if (!window.Peer) { msg('menu-msg', 'PeerJS לא נטען. בדקו חיבור לאינטרנט.'); return; }
  createHost(S.name);
  let code = randomCode(), tries = 0, api = null;
  while (!api && tries++ < 6) {
    try { api = await openRoom(code, window.Peer, { onJoin: (n) => { const i = S.host.addHuman(n); if (i >= 0) setTimeout(() => { if (S.host) S.host.io.one(i, S.host.lobbyInfo()); }, 80); return i; }, onMessage: (idx, d) => S.host.onMessage(idx, d), onLeave: (idx) => S.host.removeHuman(idx), onError: (e) => console.warn(e), joinError: () => (S.host.state !== 'lobby' ? 'המשחק כבר התחיל' : 'החדר מלא') }); }
    catch (e) { if (e && e.type === 'unavailable-id') code = randomCode(); else { msg('menu-msg', 'שגיאת חיבור לשרת האיתות: ' + (e && e.type ? e.type : e)); stopHost(); return; } }
  }
  if (!api) { msg('menu-msg', 'לא הצלחנו ליצור חדר, נסו שוב'); stopHost(); return; }
  S.net = api; S.code = code; S.solo = false;
  S.host.broadcastLobby();
  openLobby();
}

function soloGame() {
  A.initAudio();
  S.name = myName(); S.code = ''; S.solo = true;
  createHost(S.name);
  S.host.setSettings({ bots: 30, maxPlayers: 50, speed: 1.5 });
  S.host.startMatch();
}

async function joinByCode() {
  if (S.net || S.game) return; // כבר בחדר
  A.initAudio();
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 5) { msg('menu-msg', 'הכנס קוד חדר בן 5 תווים'); return; }
  S.name = myName(); msg('menu-msg', 'מתחבר לחדר...');
  if (SRV.url) {
    try { await enterServerRoom({ t: 'join', c: code }); return; }
    catch (e) { if (!(e && (e.nf || e.conn)) || !window.Peer) { msg('menu-msg', errText(e)); return; } }
  }
  if (!window.Peer) { msg('menu-msg', 'PeerJS לא נטען. בדקו חיבור לאינטרנט.'); return; }
  try {
    const c = await joinRoom(code, S.name, window.Peer, {
      onData: (d) => route(d),
      onClose: () => closedByHost(),
    });
    S.net = { send: (_, m) => c.send(m), raw: c, close: c.close }; S.idx = c.idx; S.isHost = false; S.code = code; S.clientSend = (m) => c.send(m);
    msg('menu-msg', '');
    openLobby();
  } catch (e) {
    const t = (e && e.message) || '';
    msg('menu-msg', t === 'timeout' ? 'החדר לא נמצא או שהחיבור נכשל' : t === 'closed' ? 'החיבור נסגר' : (e && e.type === 'peer-unavailable') ? 'החדר לא נמצא' : (t || 'שגיאה בהתחברות'));
  }
}

function closedByHost() {
  if (!S.net && !S.game) return;
  cleanup(); showScreen('menu'); msg('menu-msg', 'החיבור לחדר נותק');
}

function stopHost() { if (S.ticker) { S.ticker(); S.ticker = null; } if (S.net && S.isHost) { S.net.close(); } S.host = null; S.net = null; S.isHost = false; }
function cleanup() {
  if (S.game) { S.game.destroy(); S.game = null; }
  if (S.isHost) stopHost(); else { try { S.net && S.net.close && S.net.close(); } catch (e) { /* ignore */ } S.net = null; }
  S.lobby = null; S.idx = -1; S.code = ''; S.srv = null; S.mgr = false;
}

// ---------- לובי ----------
function openLobby() {
  showScreen('lobby');
  $('room-code').textContent = S.code;
  $('settings').classList.toggle('locked', !canManage());
  $('btn-start').classList.toggle('hidden', !canManage());
  msg('lobby-msg', canManage() ? 'שתפו את הקוד או הקישור עם החברים' : 'ממתין שהמנהל יתחיל את המשחק...');
  $('set-note').textContent = canManage() ? '' : '(המנהל קובע)';
}
function renderLobby() {
  const L = S.lobby; if (!L) return;
  if (S.srv) { const me = L.players.find((p) => p.i === S.idx); const mg = !!(me && me.h); if (mg !== S.mgr) { S.mgr = mg; openLobby(); } }
  const list = $('pl-list'); list.innerHTML = '';
  for (const p of L.players) {
    const li = document.createElement('li'); const dot = document.createElement('i'); dot.style.background = '#' + p.c.toString(16).padStart(6, '0');
    const nm = document.createElement('span'); nm.textContent = p.n + (p.i === S.idx ? ' (אתה)' : '');
    li.appendChild(dot); li.appendChild(nm); if (p.h) { const c = document.createElement('span'); c.className = 'crown'; c.textContent = ' 👑'; li.appendChild(c); }
    list.appendChild(li);
  }
  $('pl-count').textContent = `(${L.players.length}/${L.s.maxPlayers})`;
  const s = L.s;
  $('s-max').value = s.maxPlayers; $('s-max-v').textContent = s.maxPlayers;
  $('s-bots').value = s.bots; $('s-bots-v').textContent = s.bots;
  $('s-speed').value = String(s.speed); $('s-skill').value = String(s.botSkill); $('s-view').value = s.view; $('s-time').value = s.time; $('s-fog').value = String(s.fog);
  const total = Math.min(s.maxPlayers, L.players.length + s.bots);
  if (canManage()) msg('lobby-msg',`${L.players.length} שחקנים + ${Math.max(0, total - L.players.length)} בוטים = ${total} במשחק`);
}
function pushSettings() {
  if (!canManage()) return;
  const s = { maxPlayers: +$('s-max').value, bots: +$('s-bots').value, speed: +$('s-speed').value, botSkill: +$('s-skill').value, view: $('s-view').value, time: $('s-time').value, fog: +$('s-fog').value };
  if (S.srv) S.srv.ctl({ t: 'settings', s }); else S.host.setSettings(s);
}
for (const id of ['s-max', 's-bots', 's-speed', 's-skill', 's-view', 's-time', 's-fog']) $(id).addEventListener('input', pushSettings);

// ---------- התחלת משחק ----------
async function startGame(m) {
  if (S.game) return;
  showScreen('loading'); $('loading-text').textContent = 'בונה את האי...';
  await new Promise((r) => setTimeout(r, 30));
  const r = makeRenderer();
  const send = S.isHost ? (x) => S.host.onMessage(S.idx, x) : (x) => S.clientSend && S.clientSend(x);
  const g = new Game({
    renderer: r, canvas, hud, send, isHost: S.isHost, mgr: canManage, hostWorld: S.isHost ? S.host.world : null, idx: S.idx, name: S.name,
    players: m.players, seed: m.seed, settings: m.s, prefs,
  });
  S.game = g;
  try { await g.init(); }
  catch (e) { console.error(e); cleanup(); showScreen('menu'); msg('menu-msg', 'שגיאה בטעינת המשחק: ' + (e && e.message)); return; }
  showScreen('none');
  $('loading-text').textContent = 'ממתין לשאר השחקנים...'; show('loading', true);
  // המסך נסגר כשמגיע 'go'
  const prev = g.begin.bind(g);
  g.begin = () => { show('loading', false); prev(); g.lock(); };
}

function leaveGame(toMenu) {
  if (S.game) { S.game.destroy(); S.game = null; }
  if (toMenu) { cleanup(); showScreen('menu'); } else { show('endscreen', false); showScreen('lobby'); openLobby(); }
}

// ---------- כפתורים ----------
$('btn-create').onclick = createRoom;
$('btn-solo').onclick = soloGame;
$('btn-join').onclick = joinByCode;
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(); });
$('btn-copy').onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${S.code}` + (S.srv && !SRV.fromCfg ? '&server=' + encodeURIComponent(SRV.url) : '');
  try { await navigator.clipboard.writeText(url); toast('הקישור הועתק'); } catch (e) { prompt('העתק את הקישור:', url); }
};
$('btn-leave').onclick = () => { cleanup(); showScreen('menu'); };
$('btn-start').onclick = () => {
  if (!canManage()) return;
  pushSettings();
  if (S.srv) S.srv.ctl({ t: 'start' }); else S.host.startMatch();
};
$('btn-resume').onclick = () => { if (S.game) S.game.openPause(false); };
$('btn-quit').onclick = () => {
  if (S.isHost && !S.solo && !confirm('אתה המנהל. יציאה תסגור את החדר לכולם. להמשיך?')) return;
  leaveGame(true);
};
$('btn-spec').onclick = () => { if (S.game) S.game.stopSpectateScreen(); show('btn-spec', false); };
$('btn-back').onclick = () => {
  if (!S.game) return;
  if (S.game.ended && S.isHost) { S.host.resetToLobby(); }
  else if (S.game.ended && S.srv && S.mgr) { S.srv.ctl({ t: 'reset' }); }
  else leaveGame(true);
};
for (const [id, key, fn] of [['p-sens', 'sens', null], ['p-vol', 'vol', (v) => A.setVolume(v / 100)], ['p-fov', 'fov', null], ['p-shadow', 'shadow', () => S.game && S.game.applyShadowPref()]]) {
  $(id).addEventListener('input', () => { prefs[key] = key === 'shadow' ? +$(id).value : +$(id).value; store.set(key, prefs[key]); if (fn) fn(+$(id).value); });
}
A.setVolume(prefs.vol / 100);

// קישור הזמנה
const q = new URLSearchParams(location.search).get('room');
if (q) { $('code').value = q.toUpperCase().slice(0, 5); msg('menu-msg', 'הוזמנת לחדר ' + q.toUpperCase() + ' - הכנס שם ולחץ "הצטרף"'); }

addEventListener('error', (e) => console.error(e.error || e.message));
addEventListener('beforeunload', (e) => { if (S.game && S.isHost && !S.solo) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden && S.game && S.isHost && !S.solo) toast('המשחק רץ אצלך - השאר את הלשונית פתוחה'); });
showScreen('menu');
