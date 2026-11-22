// בדיקת אינטגרציה/עומס לשרת: מחברת N שחקנים (ברירת מחדל 50) דרך אותו קוד לקוח של האתר (js/netws.js),
// יוצרת חדר, מתחילה משחק, ומודדת snapshots, רוחב פס ועומס CPU.
// שימוש:  node server/loadtest.mjs                          (מפעיל שרת מקומי ובודק אותו)
//         node server/loadtest.mjs wss://my-server/ws 50 10   (בודק שרת קיים: כתובת, שחקנים, שניות מדידה)
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectServer } from '../js/netws.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let url = argv[0] && /^wss?:/.test(argv[0]) ? argv.shift() : '';
const N = Number(argv[0]) || 50;
const SECS = Number(argv[1]) || 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '   [' + extra + ']' : '')); };
async function until(pred, ms = 5000, step = 25) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(step); }
  return !!pred();
}

let child = null;
async function startLocal() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  child = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {
    env: { ...process.env, PORT: String(port), SERVE_STATIC: '0', EMPTY_GRACE_MS: '300', CR_TEST: '1', AUTO_RESET_MS: '1500' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  child.stdout.on('data', (d) => process.stdout.write('  server> ' + d));
  await new Promise((res, rej) => {
    child.stdout.on('data', (d) => { if (String(d).includes('listening')) res(); });
    child.on('exit', (c) => rej(new Error('server exited early: ' + c)));
    setTimeout(() => rej(new Error('server start timeout')), 10000);
  });
  return port;
}
const healthOf = async () => (await fetch(url.replace(/^ws/, 'http').replace(/\/ws$/, '/health'))).json();

async function mk(name, req) {
  const c = { name, bin: 0, bytes: 0, got: {}, last: {}, closed: false };
  const api = await connectServer(url, { ...req, n: name }, {
    onData: (d) => {
      if (d instanceof ArrayBuffer) { c.bin++; c.bytes += d.byteLength; return; }
      c.got[d.t] = (c.got[d.t] || 0) + 1; c.last[d.t] = d;
    },
    onClose: () => { c.closed = true; },
  });
  return Object.assign(c, api);
}

(async () => {
  if (!url) { const port = await startLocal(); url = `ws://127.0.0.1:${port}/ws`; }
  console.log(`url ${url}  players ${N}  measure ${SECS}s`);
  const h0 = await healthOf();

  const mgr = await mk('Mgr', { t: 'create' });
  check('room created with a 5-char code', /^[A-Z2-9]{5}$/.test(mgr.code), mgr.code);
  check('creator is manager', mgr.mgr === true);

  const others = [];
  const tJoin = Date.now();
  await Promise.all(Array.from({ length: N - 1 }, (_, i) => mk('P' + (i + 1), { t: 'join', c: mgr.code }).then((c) => others.push(c))));
  const all = [mgr, ...others];
  check(`${N} players connected`, all.length === N, `${Date.now() - tJoin} ms`);
  check('unique player indexes', new Set(all.map((c) => c.idx)).size === N);
  check('only the creator is manager', others.every((c) => !c.mgr));
  await until(() => mgr.last.lobby && mgr.last.lobby.players.length === N);
  check('lobby lists every player', mgr.last.lobby && mgr.last.lobby.players.length === N);
  check('exactly one crown in the lobby', mgr.last.lobby && mgr.last.lobby.players.filter((p) => p.h).length === 1);
  check('a late joiner got the lobby on arrival', others[N - 2].got.lobby >= 1);

  if (N >= 50) {
    let err = null; try { await mk('X', { t: 'join', c: mgr.code }); } catch (e) { err = e; }
    check('51st player rejected (room full)', err && /מלא/.test(err.message), err && err.message);
  }
  let nf = null; try { await mk('Y', { t: 'join', c: 'ZZZZZ' }); } catch (e) { nf = e; }
  check('unknown room code rejected (nf)', nf && nf.nf === true, nf && nf.message);

  others[0].ctl({ t: 'settings', s: { bots: 9, speed: 1.5 } }); // לא מנהל - אמור להתעלם
  mgr.ctl({ t: 'settings', s: { bots: 0, speed: 3 } });
  await until(() => mgr.last.lobby && mgr.last.lobby.s.speed === 3);
  const S = mgr.last.lobby && mgr.last.lobby.s;
  check('manager settings applied, non-manager ignored', S && S.speed === 3 && S.bots === 0, JSON.stringify(S));

  const tStart = Date.now();
  mgr.ctl({ t: 'start' });
  await until(() => all.every((c) => c.got.start), 30000);
  check('start reached everyone', all.every((c) => c.got.start === 1), `${Date.now() - tStart} ms incl. world build`);
  check('start lists every player', mgr.last.start && mgr.last.start.players.length === N, mgr.last.start && String(mgr.last.start.players.length));
  for (const c of all) c.send({ t: 'ready' });
  await until(() => all.every((c) => c.got.go), 8000);
  check('go reached everyone', all.every((c) => c.got.go === 1));

  const hA = await healthOf(), tA = Date.now();
  for (const c of all) { c.bin = 0; c.bytes = 0; }
  others[3].send({ t: 'chat', m: 'hello' });
  await sleep(SECS * 1000);
  const hB = await healthOf(), dt = (Date.now() - tA) / 1000;
  const frames = all.map((c) => c.bin);
  const minF = Math.min(...frames), avgF = frames.reduce((a, b) => a + b, 0) / N;
  check('snapshots flowing to every player (~10/s)', minF >= SECS * 7, `per player: min ${minF}, avg ${avgF.toFixed(1)} in ${dt.toFixed(1)}s`);
  check('chat broadcast reached everyone', all.every((c) => c.got.chat >= 1));
  const kbps = all.reduce((a, c) => a + c.bytes, 0) / N / dt / 1024;
  console.log(`INFO downstream per player ${kbps.toFixed(1)} KB/s, total ${(kbps * N).toFixed(0)} KB/s; server cpu ${(((hB.cpuMs - hA.cpuMs) / 1000 / dt) * 100).toFixed(0)}% of one core, rss ${hB.rssMB} MB`);

  if (child) { // מחזור מלא: סיום -> חזרה ללובי (ידנית ואוטומטית) -> משחקים נוספים (רק מול שרת מקומי, דורש CR_TEST)
    const lobbies = () => all.map((c) => c.got.lobby || 0);
    const startMatch = async (n) => {
      mgr.ctl({ t: 'start' });
      const a = await until(() => all.every((c) => c.got.start === n), 30000);
      for (const c of all) c.send({ t: 'ready' });
      const b = await until(() => all.every((c) => c.got.go === n), 8000);
      return a && b;
    };
    mgr.ctl({ t: '_end' });
    await until(() => all.every((c) => c.got.end === 1), 5000);
    check('end of match reached everyone', all.every((c) => c.got.end === 1));
    let before = lobbies();
    others[Math.min(5, others.length - 1)].ctl({ t: 'reset' }); // לא מנהל - מתעלמים
    await sleep(400);
    check('reset by a non-manager ignored', lobbies().every((n, i) => n === before[i]));
    mgr.ctl({ t: 'reset' });
    await until(() => lobbies().every((n, i) => n > before[i]), 5000);
    check('manager reset sent everyone back to the lobby', lobbies().every((n, i) => n > before[i]) && mgr.last.lobby.players.length === N, `players ${mgr.last.lobby.players.length}`);
    check('second match starts for all players', await startMatch(2));
    mgr.ctl({ t: '_end' });
    before = lobbies();
    check('auto-return to the lobby when nobody presses back', await until(() => lobbies().every((n, i) => n > before[i]), 6000));
    check('third match starts for all players', await startMatch(3));
  }

  mgr.close(); // המנהל יוצא באמצע משחק
  await until(() => others.some((c) => c.got.mgr), 3000);
  const nm = others.find((c) => c.got.mgr);
  check('control passed to another player when the manager left', !!nm && nm.last.mgr.on === true);

  for (const c of others) c.close();
  if (child) {
    await sleep(2200);
    const hC = await healthOf();
    check('empty room cleaned up', hC.rooms === h0.rooms, `rooms ${hC.rooms}`);
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  if (child) child.kill('SIGTERM');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('test crashed:', e); if (child) child.kill('SIGKILL'); process.exit(2); });
