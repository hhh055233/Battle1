// רשת מול שרת משחק ייעודי (WebSocket) - חלופה ל-PeerJS כשמוגדרת כתובת שרת (config.js או ?server=...).
// פרוטוקול: הודעת פתיחה {t:'create'|'join', n, c} -> {t:'welcome', i, code, mgr} או {t:'reject', why, nf}.
// אחר כך: JSON טקסטואלי לאירועים ו-ArrayBuffer בינארי לסנאפשוטים ולמצב השחקן (כמו ב-PeerJS).

// מנרמל כתובת שרת: 'my.host', 'https://my.host', 'wss://my.host/ws' -> 'wss://my.host/ws'
export function normServerUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) u = u.replace(/^http/i, 'ws');
  else if (!/^wss?:\/\//i.test(u)) u = (/^(localhost|127\.|\[::1\]|10\.|192\.168\.)/i.test(u) ? 'ws://' : 'wss://') + u;
  if (!/^wss?:\/\/[^/]+\/./.test(u)) u = u.replace(/\/+$/, '') + '/ws';
  return u;
}

// מתחבר לשרת ושולח בקשת create/join. מחזיר {ws, idx, code, mgr, send, ctl, close}.
// שגיאות: e.nf = החדר לא נמצא, e.conn = בעיית חיבור (אפשר ליפול חזרה ל-P2P).
export function connectServer(url, req, handlers) {
  return new Promise((resolve, reject) => {
    let ws, state = 'connecting', timer = null;
    const mkErr = (m, flag) => { const e = new Error(m); if (flag) e[flag] = true; return e; };
    const fail = (e) => {
      if (state === 'closed') return;
      const was = state; state = 'closed'; clearTimeout(timer);
      try { ws.close(); } catch (e2) { /* ignore */ }
      if (was === 'connecting') reject(e); else if (handlers.onClose) handlers.onClose(e);
    };
    try { ws = new WebSocket(url); } catch (e) { reject(mkErr('כתובת השרת לא תקינה', 'conn')); return; }
    ws.binaryType = 'arraybuffer';
    timer = setTimeout(() => fail(mkErr('השרת לא ענה', 'conn')), 9000);
    const send = (m) => { if (ws.readyState === 1) ws.send(m instanceof ArrayBuffer || ArrayBuffer.isView(m) ? m : JSON.stringify(m)); };
    const close = () => { state = 'closed'; clearTimeout(timer); try { ws.close(); } catch (e) { /* ignore */ } };
    ws.onopen = () => ws.send(JSON.stringify(req));
    ws.onmessage = (ev) => {
      if (state === 'closed') return;
      let d = ev.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return; } }
      if (state === 'connecting') {
        if (d && d.t === 'welcome') { state = 'open'; clearTimeout(timer); resolve({ ws, idx: d.i, code: d.code, mgr: !!d.mgr, send, ctl: send, close }); }
        else if (d && d.t === 'reject') { const e = mkErr(d.why || 'נדחה'); if (d.nf) e.nf = true; fail(e); }
        return;
      }
      handlers.onData(d);
    };
    ws.onclose = () => fail(mkErr('החיבור נסגר', 'conn'));
    ws.onerror = () => fail(mkErr('שגיאת חיבור לשרת', 'conn'));
  });
}
