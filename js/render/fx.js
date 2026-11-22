// אפקטים: להבות לוע, קווי ירי, פיצוצים, עשן, אש, ניצוצות/דם, וקיר האזור הכחול.
import * as THREE from 'three';
import { makeSoftDot } from './textures.js';

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.dot = makeSoftDot();
    this.sprites = [];
    this.free = [];
    this.live = [];
    for (let i = 0; i < 900; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dot, transparent: true, depthWrite: false, fog: true }));
      s.visible = false; scene.add(s); this.free.push(s);
    }
    this.tracers = [];
    const tg = new THREE.BoxGeometry(0.025, 0.025, 1);
    for (let i = 0; i < 48; i++) {
      const m = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
      m.visible = false; scene.add(m); this.tracers.push({ m, life: 0, o: new THREE.Vector3(), e: new THREE.Vector3(), t: 0, len: 0, speed: 600 });
    }
    this.smokes = []; this.fires = []; this.flashes = [];
    this.lights = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffa040, 0, 40, 2); scene.add(l); this.lights.push({ l, t: 0, max: 0, i: 0 }); }
    // קיר האזור
    const zg = new THREE.CylinderGeometry(1, 1, 700, 72, 1, true);
    this.zoneMat = new THREE.ShaderMaterial({
      transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false,
      uniforms: { t: { value: 0 } },
      vertexShader: 'varying vec3 vP; varying vec2 vU; void main(){ vP = position; vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; varying vec2 vU; uniform float t;
        void main(){ float h = clamp(vP.y / 350.0 + 0.5, 0.0, 1.0); float st = 0.5 + 0.5 * sin(vU.x * 600.0 + t * 1.2) * sin(h * 40.0 - t * 2.0);
        float a = (0.16 + 0.12 * st) * (1.0 - h * 0.55); gl_FragColor = vec4(0.18, 0.5, 1.0, a); }`,
    });
    this.zone = new THREE.Mesh(zg, this.zoneMat); this.zone.frustumCulled = false; this.zone.renderOrder = 5; scene.add(this.zone);
    this.target = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 500, 64, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.target.visible = false; this.target.frustumCulled = false; scene.add(this.target);
    this.targetRing = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    this.targetRing.rotation.x = -Math.PI / 2; scene.add(this.targetRing);
    this.targetRing.visible = false;
    this.time = 0;
  }

  setZone(cx, cz, r, tcx, tcz, tr, showTarget) {
    this.zone.position.set(cx, 150, cz); this.zone.scale.set(Math.max(0.1, r), 1, Math.max(0.1, r));
    this.target.visible = this.targetRing.visible = !!showTarget && tr > 0.5;
    if (showTarget) {
      this.target.position.set(tcx, 150, tcz); this.target.scale.set(Math.max(0.1, tr), 1, Math.max(0.1, tr));
      this.targetRing.position.set(tcx, 40, tcz); this.targetRing.scale.set(Math.max(0.1, tr), Math.max(0.1, tr), 1);
    }
  }

  spr(x, y, z, size, color, life, vx = 0, vy = 0, vz = 0, grow = 0, op = 1, drag = 1, g = 0, add = false) {
    const s = this.free.pop();
    if (!s) return null;
    s.position.set(x, y, z); s.scale.set(size, size, 1);
    s.material.color.set(color); s.material.opacity = op;
    s.material.blending = add ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.visible = true;
    this.live.push({ s, life, max: life, vx, vy, vz, grow, op, drag, g, size });
    return s;
  }

  muzzle(p, d, big = 1) {
    this.spr(p.x, p.y, p.z, 0.55 * big, 0xffd27a, 0.045, 0, 0, 0, 0, 1, 1, 0, true);
    this.spr(p.x + d.x * 0.25, p.y + d.y * 0.25, p.z + d.z * 0.25, 0.32 * big, 0xfff2c0, 0.045, 0, 0, 0, 0, 1, 1, 0, true);
    for (let i = 0; i < 2; i++) this.spr(p.x, p.y, p.z, 0.25, 0x9a9a9a, 0.5, d.x * 2 + (Math.random() - 0.5), d.y * 2 + 0.4, d.z * 2 + (Math.random() - 0.5), 1.2, 0.35, 0.9);
    const L = this.lights.find((l) => l.t <= 0);
    if (L) { L.l.position.copy(p); L.l.color.set(0xffc070); L.l.distance = 18; L.max = L.t = 0.06; L.i = 4 * big; L.l.intensity = L.i; }
  }

  tracer(o, e, speed = 500) {
    const T = this.tracers.find((t) => t.life <= 0);
    if (!T) return;
    T.o.set(o[0], o[1], o[2]); T.e.set(e[0], e[1], e[2]);
    T.len = T.o.distanceTo(T.e); T.t = 3; // מתחילים קצת אחרי הלוע
    T.speed = speed; T.life = T.len / speed + 0.1; T.m.visible = true;
  }

  impact(p, n, kind) {
    const col = kind === 'terrain' ? 0x8c7a5a : kind === 'water' ? 0xdff2ff : kind === 'glass' ? 0xcfe8f5 : 0xb8b2a6;
    for (let i = 0; i < 5; i++) {
      this.spr(p.x, p.y, p.z, 0.16 + Math.random() * 0.12, col, 0.35 + Math.random() * 0.25, (n.x + (Math.random() - 0.5)) * 2.6, (n.y + Math.random() * 0.7) * 2.6, (n.z + (Math.random() - 0.5)) * 2.6, 0.6, 0.9, 1.4, 5);
    }
    this.spr(p.x, p.y, p.z, 0.6, 0xffe0a0, 0.06, 0, 0, 0, 0, 0.9, 1, 0, true);
  }

  blood(p) {
    for (let i = 0; i < 6; i++) this.spr(p.x, p.y, p.z, 0.1 + Math.random() * 0.1, 0xb01818, 0.5, (Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3, 0, 0.95, 1.2, 8);
  }

  explosion(p, r = 10) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.28, e = (Math.random() - 0.3) * 1.2, sp = 5 + Math.random() * 11;
      this.spr(p.x, p.y + 0.5, p.z, 1.8 + Math.random() * 2.2, [0xffb030, 0xff7a1a, 0xffe08a][i % 3], 0.35 + Math.random() * 0.3, Math.cos(a) * sp, 3 + e * 5, Math.sin(a) * sp, 4, 0.95, 2.2, 0, true);
    }
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * 6.28, sp = 2 + Math.random() * 6;
      this.spr(p.x, p.y + 0.8, p.z, 2.5 + Math.random() * 2.5, 0x3b3a38, 1.6 + Math.random() * 1.2, Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp, 2.6, 0.7, 1.4, -0.5);
    }
    for (let i = 0; i < 14; i++) { const a = Math.random() * 6.28; this.spr(p.x, p.y + 0.3, p.z, 0.22, 0xffcf70, 0.8, Math.cos(a) * 14, 5 + Math.random() * 10, Math.sin(a) * 14, 0, 1, 0.5, 18, true); }
    const L = this.lights.find((l) => l.t <= 0) || this.lights[0];
    L.l.position.set(p.x, p.y + 2, p.z); L.l.color.set(0xff9a40); L.l.distance = 60; L.max = L.t = 0.5; L.i = 40; L.l.intensity = 40;
  }

  addSmoke(p, dur, r, color = 0xd4d7da) { this.smokes.push({ x: p.x, y: p.y, z: p.z, until: this.time + dur, r, acc: 0, color }); }
  addFire(p, dur, r) { this.fires.push({ x: p.x, y: p.y, z: p.z, until: this.time + dur, r, acc: 0 }); }

  update(dt, camera) {
    this.time += dt;
    this.zoneMat.uniforms.t.value = this.time;
    // חלקיקים
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i];
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; this.free.push(p.s); this.live.splice(i, 1); continue; }
      const dd = Math.exp(-p.drag * dt);
      p.vx *= dd; p.vz *= dd; p.vy = p.vy * dd - p.g * dt;
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
      p.size += p.grow * dt; p.s.scale.set(p.size, p.size, 1);
      const u = p.life / p.max;
      p.s.material.opacity = p.op * Math.min(1, u * 2.2);
    }
    // קווי ירי
    for (const T of this.tracers) {
      if (T.life <= 0) continue;
      T.life -= dt; T.t += T.speed * dt;
      const head = Math.min(T.len, T.t), tail = Math.max(0, head - 14);
      if (head <= 3 || T.t > T.len + 14 || tail >= T.len) { T.m.visible = false; T.life = Math.min(T.life, 0); continue; }
      const dir = _v.copy(T.e).sub(T.o).normalize();
      const mid = _w.copy(T.o).addScaledVector(dir, (head + tail) / 2);
      T.m.position.copy(mid); T.m.scale.set(1, 1, Math.max(0.1, head - tail));
      T.m.lookAt(_x.copy(mid).add(dir));
      T.m.visible = true;
    }
    // אורות
    for (const L of this.lights) { if (L.t > 0) { L.t -= dt; L.l.intensity = Math.max(0, L.i * (L.t / L.max)); if (L.t <= 0) L.l.intensity = 0; } }
    // עשן
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const S = this.smokes[i];
      if (this.time > S.until) { this.smokes.splice(i, 1); continue; }
      S.acc += dt;
      const left = S.until - this.time, fade = Math.min(1, left / 5);
      while (S.acc > 0.07) {
        S.acc -= 0.07;
        const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * S.r * 0.55;
        this.spr(S.x + Math.cos(a) * rr, S.y + 0.8 + Math.random() * 1.5, S.z + Math.sin(a) * rr, S.r * 0.75, S.color, 6 + Math.random() * 3, (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8, 0.5, 0.78 * fade, 1);
      }
    }
    // אש
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const F = this.fires[i];
      if (this.time > F.until) { this.fires.splice(i, 1); continue; }
      F.acc += dt;
      while (F.acc > 0.04) {
        F.acc -= 0.04;
        const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * F.r;
        this.spr(F.x + Math.cos(a) * rr, F.y + 0.2, F.z + Math.sin(a) * rr, 1.1 + Math.random() * 0.9, Math.random() < 0.5 ? 0xff7a1a : 0xffc030, 0.55 + Math.random() * 0.4, 0, 1.8 + Math.random() * 1.4, 0, -0.5, 0.9, 1, 0, true);
        if (Math.random() < 0.25) this.spr(F.x + Math.cos(a) * rr, F.y + 1, F.z + Math.sin(a) * rr, 1.8, 0x2c2b2a, 1.4, 0, 2.2, 0, 1.2, 0.45, 1);
      }
    }
  }
}
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _x = new THREE.Vector3();
