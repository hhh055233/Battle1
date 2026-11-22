// שרת משחק ייעודי ל-Chicken Royale
// -----------------------------------------------------------------------------
// מריץ את סימולציית ה-Host (אותו קוד שרץ בדפדפן של המנהל במצב הישיר) בצד השרת, בלי דפדפן:
//  - חדרים לפי קוד בן 5 תווים, עד 50 שחקנים בחדר.
//  - הראשון שנכנס הוא המנהל (הגדרות + התחלה). אם הוא יוצא - השליטה עוברת לשחקן הבא.
//  - הלקוח (האתר) מתחבר ב-WebSocket לכתובת  wss://<השרת>/ws
//  - השרת מגיש גם את קבצי האתר עצמו (אפשר לכבות: SERVE_STATIC=0).
//
// הרצה:  npm install   ואז   npm start       (פורט ברירת מחדל 8080, משתנה סביבה PORT)
// בדיקה: npm run loadtest                    (מדמה 50 שחקנים)
//
// משתני סביבה: PORT, STATIC_DIR, SERVE_STATIC=0, MAX_ROOMS (8), ALLOWED_ORIGINS (רשימה מופרדת בפסיקים),
//              EMPTY_GRACE_MS (30000), AUTO_RESET_MS (120000)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Host } from '../js/sim/host.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(HERE, '..'));
const SERVE_STATIC = process.env.SERVE_STATIC !== '0';
const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 8;
const EMPTY_GRACE_MS = process.env.EMPTY_GRACE_MS != null ? Number(process.env.EMPTY_GRACE_MS) : 30000;
const AUTO_RESET_MS = Number(process.env.AUTO_RESET_MS) || 120000;
const ROOM_MAX_AGE_MS = 6 * 3600 * 1000;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MSGS_PER_SEC = 400;
const STARTED = Date.now();
const TEST_HOOKS = process.env.CR_TEST === '1'; // רק לבדיקות אוטומטיות: מאפשר למנהל לסיים משחק מיד

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const rooms = new Map();

function randomCode() {
  for (;;) {
    let s = '';
    for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(s)) return s;
  }
}
const toArrayBuffer = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const sendStr = (ws, s) => { if (ws && ws.readyState === 1) ws.send(s); };
const sendBin = (ws, buf) => { if (ws && ws.readyState === 1 && ws.bufferedAmount < (1 << 20)) ws.send(buf); };
function refuse(ws, why, nf = false) {
  sendStr(ws, JSON.stringify({ t: 'reject', why, nf }));
  setTimeout(() => { try { ws.close(); } catch (e) { /* ignore */ } }, 300);
}

// ---------- חדר ----------
class Room {
  constructor(code, creatorName) {
    this.code = code;
    this.socks = new Map(); // idx -> ws
    this.created = Date.now();
    this.emptyAt = 0;
    this.endedAt = 0;
    const io = {
      all: (m, except) => { const s = JSON.stringify(m); for (const [i, ws] of this.socks) if (i !== except) sendStr(ws, s); },
      one: (idx, m) => sendStr(this.socks.get(idx), JSON.stringify(m)),
      bin: (idx, buf) => sendBin(this.socks.get(idx), buf),
    };
    this.host = new Host(io, creatorName);
  }

  get humans() { return this.socks.size; }

  attach(ws, idx) {
    const H = this.host;
    if (!this.socks.size) H.hostIdx = idx; // החדר היה ריק: הנכנס הופך למנהל
    ws.room = this; ws.idx = idx;
    this.socks.set(idx, ws);
    this.emptyAt = 0;
    sendStr(ws, JSON.stringify({ t: 'welcome', i: idx, code: this.code, mgr: idx === H.hostIdx }));
    if (H.state === 'lobby') H.io.one(idx, H.lobbyInfo());
  }

  join(ws, name) {
    const H = this.host;
    const idx = H.addHuman(name); // משדר את הלובי המעודכן לשאר
    if (idx < 0) { refuse(ws, H.state !== 'lobby' ? 'המשחק כבר התחיל' : 'החדר מלא'); return; }
    this.attach(ws, idx);
    log('room', this.code, 'join', name, 'idx', idx, 'humans', this.humans);
  }

  leave(ws) {
    const idx = ws.idx, H = this.host;
    if (this.socks.get(idx) !== ws) return;
    this.socks.delete(idx);
    if (idx === H.hostIdx && this.socks.size) { // המנהל יצא: השליטה עוברת לשחקן הבא
      H.hostIdx = Math.min(...this.socks.keys());
      sendStr(this.socks.get(H.hostIdx), JSON.stringify({ t: 'mgr', on: true }));
    }
    try { H.removeHuman(idx); } catch (e) { log('room', this.code, 'removeHuman error', e && e.message); }
    if (!this.socks.size) this.emptyAt = Date.now();
    log('room', this.code, 'leave idx', idx, 'humans', this.humans);
  }

  onJson(ws, m) {
    const H = this.host, idx = ws.idx, mgr = idx === H.hostIdx;
    if (!m || typeof m.t !== 'string') return;
    try {
      switch (m.t) {
        case 'settings': if (mgr && m.s && typeof m.s === 'object') H.setSettings(m.s); break;
        case 'start':
          if (mgr && H.state === 'lobby') {
            const t0 = Date.now();
            H.startMatch();
            log('room', this.code, 'match started: humans', this.humans, 'bots', H.settings.bots, 'build', Date.now() - t0, 'ms');
          }
          break;
        case 'reset': if (mgr && H.state === 'ended') H.resetToLobby(); break;
        case '_end': if (TEST_HOOKS && mgr && H.state === 'playing') H.endMatch(null); break;
        default: H.onMessage(idx, m);
      }
    } catch (e) { log('room', this.code, 'message error', m.t, e && e.message); }
  }

  onBinary(ws, ab) {
    try { this.host.onMessage(ws.idx, ab); } catch (e) { log('room', this.code, 'binary error', e && e.message); }
  }

  destroy(why) {
    const s = JSON.stringify({ t: 'bye', why });
    for (const ws of this.socks.values()) { sendStr(ws, s); try { ws.close(1000, 'room closed'); } catch (e) { /* ignore */ } }
    this.socks.clear();
    rooms.delete(this.code);
    log('room', this.code, 'closed:', why, '- rooms:', rooms.size);
  }
}

function handleHello(ws, m) {
  if (!m || (m.t !== 'create' && m.t !== 'join')) { refuse(ws, 'בקשה לא חוקית'); return; }
  const name = String(m.n || '').replace(/[<>&"']/g, '').trim().slice(0, 14) || 'Player' + Math.floor(100 + Math.random() * 900);
  if (m.t === 'create') {
    if (rooms.size >= MAX_ROOMS) { refuse(ws, 'השרת עמוס כרגע, נסו שוב בעוד כמה דקות'); return; }
    const room = new Room(randomCode(), name);
    rooms.set(room.code, room);
    room.attach(ws, room.host.hostIdx);
    log('room', room.code, 'created by', name, '- rooms:', rooms.size);
    return;
  }
  const room = rooms.get(String(m.c || '').toUpperCase().trim());
  if (!room) { refuse(ws, 'החדר לא נמצא', true); return; }
  room.join(ws, name);
}

// ---------- HTTP: בריאות + (אופציונלי) קבצי האתר ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};
const SERVED_TOP = new Set(['index.html', 'css', 'js', 'vendor', 'favicon.ico']);
const wsUrlFor = (req) => {
  const secure = req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return `${secure ? 'wss' : 'ws'}://${req.headers.host}/ws`;
};

const server = http.createServer((req, res) => {
  const send = (code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' });
    res.end(body);
  };
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { send(400, 'text/plain', 'bad request'); return; }
  if (p === '/health') {
    const cu = process.cpuUsage();
    let players = 0; for (const r of rooms.values()) players += r.humans;
    send(200, 'application/json', JSON.stringify({
      ok: true, rooms: rooms.size, players, uptime: Math.round((Date.now() - STARTED) / 1000),
      rssMB: Math.round(process.memoryUsage().rss / 1048576), cpuMs: Math.round((cu.user + cu.system) / 1000),
    }));
    return;
  }
  if (!SERVE_STATIC) { send(404, 'text/plain', 'not found'); return; }
  // כשהאתר מוגש מהשרת עצמו, config.js מצביע אוטומטית על אותו שרת
  if (p === '/config.js') { send(200, MIME['.js'], `export const SERVER_URL = ${JSON.stringify(wsUrlFor(req))};\n`); return; }
  const abs = path.resolve(STATIC_DIR, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
  const parts = path.relative(STATIC_DIR, abs).split(path.sep);
  if (!SERVED_TOP.has(parts[0]) || parts.some((s) => s.startsWith('.'))) { send(404, 'text/plain', 'not found'); return; }
  fs.readFile(abs, (err, buf) => {
    if (err) { send(404, 'text/plain', 'not found'); return; }
    send(200, MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', buf);
  });
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({
  server, path: '/ws', maxPayload: 64 * 1024, perMessageDeflate: false,
  verifyClient: (info) => !ORIGINS.length || !info.origin || ORIGINS.includes(info.origin),
});
wss.on('error', (e) => log('wss error', e && e.message));
wss.on('connection', (ws, req) => {
  try { req.socket.setNoDelay(true); } catch (e) { /* ignore */ }
  ws.alive = true; ws.room = null; ws.idx = -1; ws.cnt = 0; ws.hello = false;
  const helloTimer = setTimeout(() => { try { ws.close(4000, 'no hello'); } catch (e) { /* ignore */ } }, 10000);
  ws.on('pong', () => { ws.alive = true; });
  ws.on('message', (data, isBinary) => {
    if (++ws.cnt > MAX_MSGS_PER_SEC) { try { ws.close(1008, 'rate limit'); } catch (e) { /* ignore */ } return; }
    if (ws.room) {
      if (isBinary) { ws.room.onBinary(ws, toArrayBuffer(data)); return; }
      let m; try { m = JSON.parse(data.toString()); } catch (e) { return; }
      ws.room.onJson(ws, m);
      return;
    }
    if (isBinary || ws.hello) return;
    let m; try { m = JSON.parse(data.toString()); } catch (e) { return; }
    clearTimeout(helloTimer);
    ws.hello = true;
    handleHello(ws, m);
  });
  ws.on('close', () => { clearTimeout(helloTimer); if (ws.room) ws.room.leave(ws); });
  ws.on('error', () => { /* נסגר ב-close */ });
});

// ---------- לולאת המשחק (כל החדרים) ----------
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.5);
  last = now;
  for (const room of [...rooms.values()]) {
    try {
      let d = dt;
      while (d > 1e-6) { const s = Math.min(d, 1 / 30); room.host.update(s); d -= s; }
    } catch (e) {
      log('room', room.code, 'crashed:', (e && e.stack) || e);
      room.destroy('שגיאה בשרת');
    }
  }
}, 16);

// ---------- ניקיון, הגבלת קצב ו-keepalive ----------
setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) ws.cnt = 0;
  for (const room of [...rooms.values()]) {
    const H = room.host;
    if (!room.humans && room.emptyAt && now - room.emptyAt > EMPTY_GRACE_MS) { room.destroy('החדר ריק'); continue; }
    if (now - room.created > ROOM_MAX_AGE_MS) { room.destroy('החדר פג תוקף'); continue; }
    if (H.state === 'ended') { // אחרי סיום משחק: חזרה אוטומטית ללובי אם המנהל לא לחץ
      if (!room.endedAt) room.endedAt = now;
      else if (now - room.endedAt > AUTO_RESET_MS) { room.endedAt = 0; try { H.resetToLobby(); } catch (e) { log('room', room.code, 'reset error', e && e.message); } }
    } else room.endedAt = 0;
  }
}, 1000);
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false;
    try { ws.ping(); } catch (e) { /* ignore */ }
  }
}, 15000);

process.on('uncaughtException', (e) => log('uncaught:', (e && e.stack) || e));
process.on('unhandledRejection', (e) => log('unhandled rejection:', (e && e.stack) || e));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log(sig, '- shutting down');
    for (const r of [...rooms.values()]) r.destroy('השרת מתחדש, התחברו מחדש בעוד רגע');
    server.close();
    setTimeout(() => process.exit(0), 300);
  });
}

server.listen(PORT, () => log(`Chicken Royale server listening on :${PORT}`, SERVE_STATIC ? `(site: ${STATIC_DIR})` : '(API only)', `max rooms ${MAX_ROOMS}`));
