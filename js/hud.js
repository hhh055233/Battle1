// ממשק המשתמש בתוך המשחק: HUD, מיני-מפה, מפה גדולה, מצפן, הודעות ו-killfeed.
import { MAP, WEAPONS, HELMET, VEST, PACK, SCOPES } from './sim/data.js';
import { clamp } from './sim/util.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'compass-strip', 'minimap', 'c-alive', 'c-kills', 'zone-text', 'zone-timer', 'zone-info', 'killfeed', 'chat-log', 'chat-in', 'crosshair', 'hitmark', 'scope-ov', 'prompt', 'action-bar', 'action-fill', 'action-text', 'banner', 'hp-fill', 'hp-text', 'boost-fill', 'g-helm', 'g-vest', 'g-pack', 'throw-sel', 'ws0', 'ws1', 'ammo-mag', 'ammo-res', 'ammo-mode', 'dmg-flash', 'zone-flash', 'stun-ov', 'dmg-ind', 'fall-info', 'spectate', 'spec-name', 'net-stat', 'map-canvas', 'toast']) this.el[id] = $(id);
    this.mapImg = null; this.mapCtx = this.el.minimap.getContext('2d');
    this.bigCtx = this.el['map-canvas'].getContext('2d');
    // רצועת מצפן
    const dirs = ['N', '15', '30', 'NE', '60', '75', 'E', '105', '120', 'SE', '150', '165', 'S', '195', '210', 'SW', '240', '255', 'W', '285', '300', 'NW', '330', '345'];
    let h = '';
    for (let r = 0; r < 3; r++) for (const d of dirs) h += `<span${isNaN(+d) ? ' style="color:#ffd36b"' : ' style="color:#aab"'}>${d}</span>`;
    this.el['compass-strip'].innerHTML = h;
    this.bannerT = 0; this.toastT = 0; this.hitT = 0; this.flashT = 0;
    this.names = new Map();
  }
  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  // ---------- מפה ----------
  buildMapImage(world) {
    const S = 600, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    const sc = MAP.size / S;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const x = -MAP.half + i * sc, z = -MAP.half + j * sc, h = world.heightAt(x, z);
      let r, gg, b;
      if (h < -3) { r = 28; gg = 62; b = 92; } else if (h < -0.3) { r = 52; gg = 98; b = 128; }
      else if (h < 1.1) { r = 205; gg = 190; b = 140; }
      else { const t = clamp((h - 2) / 40, 0, 1); r = 112 + t * 40; gg = 150 - t * 20; b = 82 + t * 30; }
      const k = (j * S + i) * 4; d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const P = (v) => (v + MAP.half) / sc;
    // יער
    g.fillStyle = 'rgba(40,90,40,.5)';
    for (const t of world.trees) g.fillRect(P(t.x) - 1, P(t.z) - 1, 3, 3);
    // כבישים
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of world.roads) {
      g.strokeStyle = r.main ? '#f0e6c8' : '#cfc8b4'; g.lineWidth = r.main ? 2.6 : 1.6; g.beginPath();
      r.pts.forEach((p, i) => (i ? g.lineTo(P(p.x), P(p.z)) : g.moveTo(P(p.x), P(p.z)))); g.stroke();
    }
    // בניינים
    g.fillStyle = '#585e66';
    for (const b of world.boxes) {
      if (b.m === 'floor' && b.maxY - b.minY > 1 && b.maxX - b.minX > 5 && b.maxZ - b.minZ > 4) g.fillRect(P(b.minX), P(b.minZ), Math.max(1.5, (b.maxX - b.minX) / sc), Math.max(1.5, (b.maxZ - b.minZ) / sc));
    }
    this.mapImg = c;
  }

  _drawMarkers(g, scale, ox, oz, ctx) {
    // g: הקשר, scale: פיקסלים לכל מטר, (ox,oz): נקודת מרכז במטרים
    const { me, zone, tl, drops, mt } = ctx;
    const X = (x) => g.canvas.width / 2 + (x - ox) * scale, Z = (z) => g.canvas.height / 2 + (z - oz) * scale;
    if (zone) {
      g.strokeStyle = 'rgba(80,150,255,.95)'; g.lineWidth = 2; g.beginPath(); g.arc(X(zone.cx), Z(zone.cz), zone.r * scale, 0, 6.2832); g.stroke();
      if (zone.tr > 0) { g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 2; g.beginPath(); g.arc(X(zone.tcx), Z(zone.tcz), zone.tr * scale, 0, 6.2832); g.stroke(); }
      g.fillStyle = 'rgba(40,110,255,.18)'; g.beginPath(); g.rect(0, 0, g.canvas.width, g.canvas.height); g.arc(X(zone.cx), Z(zone.cz), zone.r * scale, 0, 6.2832, true); g.fill('evenodd');
    }
    if (tl && mt < tl.planeDur + 5) {
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.setLineDash([6, 6]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(tl.p0.x), Z(tl.p0.z)); g.lineTo(X(tl.p1.x), Z(tl.p1.z)); g.stroke(); g.setLineDash([]);
      const pl = tl.plane(mt);
      if (!pl.gone) { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(pl.x), Z(pl.z), 5, 0, 6.2832); g.fill(); }
    }
    for (const D of drops || []) {
      g.fillStyle = '#ff9a1a'; g.fillRect(X(D.x) - 5, Z(D.z) - 5, 10, 10); g.strokeStyle = '#000'; g.strokeRect(X(D.x) - 5, Z(D.z) - 5, 10, 10);
    }
    if (me) {
      g.save(); g.translate(X(me.x), Z(me.z)); g.rotate(-me.yaw + Math.PI);
      g.fillStyle = '#ffd36b'; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
  }

  drawMinimap(ctx) {
    const g = this.mapCtx, W = g.canvas.width, view = 360;
    g.clearRect(0, 0, W, W);
    if (!this.mapImg) return;
    const sc = W / view, sx = ((ctx.me.x - view / 2) + MAP.half) / MAP.size * this.mapImg.width, sw = view / MAP.size * this.mapImg.width;
    const sz = ((ctx.me.z - view / 2) + MAP.half) / MAP.size * this.mapImg.height;
    g.fillStyle = '#1c3a52'; g.fillRect(0, 0, W, W);
    g.drawImage(this.mapImg, sx, sz, sw, sw, 0, 0, W, W);
    this._drawMarkers(g, sc, ctx.me.x, ctx.me.z, ctx);
  }

  drawBigMap(ctx) {
    const g = this.bigCtx, W = g.canvas.width;
    g.clearRect(0, 0, W, W);
    if (!this.mapImg) return;
    g.drawImage(this.mapImg, 0, 0, W, W);
    const sc = W / MAP.size;
    this._drawMarkers(g, sc, 0, 0, ctx);
    g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.lineWidth = 3;
    for (const t of ctx.towns) {
      const x = W / 2 + t.x * sc, y = W / 2 + t.z * sc;
      g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(t.name, x, y - 12); g.fillStyle = '#fff'; g.fillText(t.name, x, y - 12);
    }
  }

  compass(yawRad) {
    // yaw: 0 = צפון (‎-z‎); מימין חיובי = מזרח. אורך כל ‎24 סימנים = 360°, כל תא 40px
    let deg = (-yawRad * 180 / Math.PI) % 360; if (deg < 0) deg += 360;
    const px = deg / 15 * 40 + 24 * 40; // התחלה בעותק האמצעי
    this.el['compass-strip'].style.left = `${210 - px - 20}px`;
  }

  // ---------- עדכוני נתונים ----------
  setHealth(hp, boost) {
    this.el['hp-fill'].style.width = `${clamp(hp, 0, 100)}%`;
    this.el['hp-fill'].classList.toggle('low', hp < 30);
    this.el['hp-text'].textContent = Math.ceil(hp);
    this.el['boost-fill'].style.width = `${clamp(boost, 0, 100)}%`;
  }
  setGear(helm, vest, pack) {
    const set = (el, o, max, lvl) => { el.className = 'gear' + (lvl ? ` on l${lvl}` : ''); el.lastElementChild.style.width = lvl ? `${clamp(o / max, 0, 1) * 100}%` : '0'; };
    set(this.el['g-helm'], helm.d, helm.l ? HELMET[helm.l].dur : 1, helm.l);
    set(this.el['g-vest'], vest.d, vest.l ? VEST[vest.l].dur : 1, vest.l);
    set(this.el['g-pack'], 1, 1, pack);
    this.el['g-helm'].firstElementChild.textContent = helm.l ? `קסדה ${helm.l}` : 'קסדה';
    this.el['g-vest'].firstElementChild.textContent = vest.l ? `אפוד ${vest.l}` : 'אפוד';
    this.el['g-pack'].firstElementChild.textContent = pack ? `תיק ${pack}` : 'תיק';
  }
  setWeapons(slots, cur, reserveFor) {
    for (let i = 0; i < 2; i++) {
      const w = slots[i], el = this.el['ws' + i];
      el.className = 'wslot' + (cur === i ? ' cur' : '');
      el.innerHTML = w ? `<span>${i + 1}</span><span>${WEAPONS[w.id].n}</span><span>${w.mag}</span>` : `<span>${i + 1}</span><span>—</span><span></span>`;
    }
    const w = slots[cur];
    if (w) { this.el['ammo-mag'].textContent = w.mag; this.el['ammo-res'].textContent = '/ ' + reserveFor(w.id); this.el['ammo-mode'].textContent = w.mode === 'semi' && WEAPONS[w.id].auto ? 'יחיד' : WEAPONS[w.id].auto ? 'אוטומטי' : WEAPONS[w.id].bolt ? 'בריח' : 'יחיד'; }
    else { this.el['ammo-mag'].textContent = '–'; this.el['ammo-res'].textContent = ''; this.el['ammo-mode'].textContent = cur === 2 ? 'רימון' : ''; }
  }
  setThrow(text) { this.el['throw-sel'].textContent = text; }
  setPrompt(html) { const p = this.el.prompt; if (!html) { p.classList.add('hidden'); return; } p.classList.remove('hidden'); if (p.dataset.h !== html) { p.innerHTML = html; p.dataset.h = html; } }
  setAction(frac, text) { const a = this.el['action-bar']; if (frac == null) { a.classList.add('hidden'); return; } a.classList.remove('hidden'); this.el['action-fill'].style.width = `${frac * 100}%`; this.el['action-text'].textContent = text; }
  banner(text, ms = 3000) { const b = this.el.banner; b.textContent = text; b.classList.remove('hidden'); b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; this.bannerT = ms / 1000; }
  toast(text, ms = 2200) { const t = this.el.toast; t.textContent = text; t.classList.add('on'); this.toastT = ms / 1000; }
  feed(html, mine) { const d = document.createElement('div'); d.innerHTML = html; if (mine) d.className = 'me'; const f = this.el.killfeed; f.appendChild(d); while (f.children.length > 6) f.removeChild(f.firstChild); setTimeout(() => d.remove(), 7000); }
  chat(name, msg, color) {
    const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = name + ': '; b.style.color = color; d.appendChild(b); d.appendChild(document.createTextNode(msg));
    const c = this.el['chat-log']; c.appendChild(d); while (c.children.length > 6) c.removeChild(c.firstChild); setTimeout(() => d.remove(), 12000);
  }
  hitmarker(kind) { const h = this.el.hitmark; h.className = 'on ' + (kind || ''); clearTimeout(this._ht); this._ht = setTimeout(() => { h.className = ''; }, 140); }
  damageFlash() { const f = this.el['dmg-flash']; f.style.transition = 'none'; f.style.opacity = '1'; requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = '0'; }); }
  damageDir(angle) { const i = document.createElement('i'); i.style.transform = `rotate(${angle}rad)`; this.el['dmg-ind'].appendChild(i); setTimeout(() => i.remove(), 1400); }
  zoneFlash(on) { this.el['zone-flash'].style.opacity = on ? '1' : '0'; }
  stun(sec) { const s = this.el['stun-ov']; s.style.transition = 'none'; s.style.opacity = '1'; setTimeout(() => { s.style.transition = `opacity ${sec}s`; s.style.opacity = '0'; }, 400); }
  crosshair(spread, ads, off) { const c = this.el.crosshair; c.style.setProperty('--sp', `${spread}px`); c.classList.toggle('ads', !!ads); c.classList.toggle('off', !!off); }
  scope(on) { this.el['scope-ov'].classList.toggle('hidden', !on); }

  tick(dt) {
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.el.banner.classList.add('hidden'); }
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.el.toast.classList.remove('on'); }
  }

  // ---------- שלטי שמות ----------
  plate(id, text, color, sx, sy, vis) {
    let n = this.names.get(id);
    if (!n) { n = document.createElement('div'); n.className = 'nameplate'; n.textContent = text; n.style.color = color; document.body.appendChild(n); this.names.set(id, n); }
    if (!vis) { n.style.display = 'none'; return; }
    n.style.display = 'block'; n.style.left = sx + 'px'; n.style.top = sy + 'px';
  }
  clearPlates() { for (const n of this.names.values()) n.remove(); this.names.clear(); }
}
