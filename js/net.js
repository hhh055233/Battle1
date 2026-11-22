// רשת: PeerJS (WebRTC) - ה-host הוא דפדפן של מנהל החדר, השאר מתחברים אליו דרך קוד חדר.
// נתיב מקומי (ללא רשת) למנהל עצמו וסימולציית משחק סולו.
const PREFIX = 'chroyale-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode() { let s = ''; for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]; return s; }
// STUN לחיבור ישיר + שרתי TURN החינמיים של PeerJS (ברירת המחדל של הספרייה) כגיבוי לרשתות מגבילות (NAT סימטרי, סלולר, מוסדות)
const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

// ----- צד ה-host -----
// מחבר בין Host (הסימולציה) לבין חיבורי הלקוחות. onLocal(msg) מקבל הודעות למשתמש המקומי (המנהל).
export function openRoom(code, Peer, handlers) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, { debug: 0, config: { iceServers } });
    const conns = new Map(); // idx -> conn
    const byConn = new Map();
    let ready = false;
    peer.on('open', () => { ready = true; resolve(api); });
    peer.on('error', (e) => { if (!ready) reject(e); else handlers.onError && handlers.onError(e); });
    peer.on('connection', (conn) => {
      conn.on('open', () => { /* ממתינים ל-join */ });
      conn.on('data', (d) => {
        if (d && d.t === 'join' && !byConn.has(conn)) {
          const idx = handlers.onJoin(String(d.n || 'Player').slice(0, 14), conn);
          if (idx < 0) { conn.send({ t: 'reject', why: handlers.joinError ? handlers.joinError() : 'החדר מלא או שהמשחק כבר התחיל' }); setTimeout(() => conn.close(), 400); return; }
          conns.set(idx, conn); byConn.set(conn, idx);
          conn.send({ t: 'welcome', i: idx, code });
          return;
        }
        const idx = byConn.get(conn);
        if (idx === undefined) return;
        handlers.onMessage(idx, d);
      });
      const gone = () => { const idx = byConn.get(conn); if (idx !== undefined) { byConn.delete(conn); conns.delete(idx); handlers.onLeave(idx); } };
      conn.on('close', gone); conn.on('error', gone);
    });
    const api = {
      peer, conns,
      send(idx, m) { const c = conns.get(idx); if (c && c.open) { try { c.send(m); } catch (e) { /* ignore */ } } },
      sendAll(m, except) { for (const [i, c] of conns) if (i !== except && c.open) { try { c.send(m); } catch (e) { /* ignore */ } } },
      close() { try { peer.destroy(); } catch (e) { /* ignore */ } },
    };
  });
}

// ----- צד הלקוח -----
export function joinRoom(code, name, Peer, handlers) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(undefined, { debug: 0, config: { iceServers } });
    let done = false, timer = null;
    const fail = (e) => { if (!done) { done = true; clearTimeout(timer); try { peer.destroy(); } catch (e2) { /* ignore */ } reject(e); } else if (handlers.onClose) handlers.onClose(e); };
    timer = setTimeout(() => fail(new Error('timeout')), 15000);
    peer.on('error', (e) => fail(e));
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'binary' });
      conn.on('open', () => conn.send({ t: 'join', n: name }));
      conn.on('data', (d) => {
        if (d && d.t === 'welcome' && !done) { done = true; clearTimeout(timer); resolve({ conn, peer, idx: d.i, send: (m) => { if (conn.open) conn.send(m); }, close: () => { try { peer.destroy(); } catch (e) { /* ignore */ } } }); return; }
        if (d && d.t === 'reject' && !done) { done = true; clearTimeout(timer); try { peer.destroy(); } catch (e2) { /* ignore */ } reject(new Error(d.why || 'rejected')); return; }
        handlers.onData(d);
      });
      conn.on('close', () => { clearTimeout(timer); fail(new Error('closed')); });
      conn.on('error', (e) => fail(e));
    });
  });
}
