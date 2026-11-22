// טבלאות לוט לפי סוג מקום ודרגה. דטרמיניסטי לפי ה-rng שמועבר.
import { weighted, pick, randInt } from './util.js';
import { AMMO, WEAPONS } from './data.js';

const WEAPON_BY_TIER = {
  1: [['p92', 5], ['p18c', 2], ['uzi', 3], ['s686', 3], ['ump', 2], ['akm', 2], ['m416', 1.2], ['scar', 1.2], ['kar98', 0.8], ['sks', 0.8], ['mini14', 0.8], ['deagle', 0.8], ['s12k', 0.6], ['vector', 0.8]],
  2: [['p92', 2], ['p18c', 1.5], ['uzi', 2], ['s686', 2], ['ump', 3], ['akm', 3], ['m416', 3], ['scar', 3], ['kar98', 1.6], ['sks', 1.8], ['mini14', 1.8], ['deagle', 1.4], ['s12k', 1.6], ['vector', 2]],
  3: [['ump', 2], ['akm', 3.5], ['m416', 4.5], ['scar', 4.5], ['kar98', 2.6], ['sks', 2.4], ['mini14', 2.4], ['deagle', 1.8], ['s12k', 2.4], ['vector', 2.6], ['uzi', 1]],
};
const GEAR_LEVEL = { 1: [[1, 70], [2, 26], [3, 4]], 2: [[1, 38], [2, 46], [3, 16]], 3: [[1, 16], [2, 46], [3, 38]] };

export function ammoStack(a) { return AMMO[a].box; }

export function rollLoot(rng, tag, tier) {
  const out = [];
  let n = weighted(rng, [[1, 55], [2, 35], [3, 10]]);
  if (tag === 'car') n = 1;
  for (let i = 0; i < n; i++) {
    const cat = weighted(rng, [
      ['weapon', tag === 'car' ? 4 : 20], ['ammo', 23], ['helmet', 7], ['vest', 7], ['pack', 6],
      ['med', 19], ['throw', 9], ['scope', tier >= 2 ? 6 : 3],
    ]);
    if (cat === 'weapon') {
      const w = weighted(rng, WEAPON_BY_TIER[Math.min(3, tier)]);
      out.push({ k: 'w:' + w, c: 1 });
      const a = WEAPONS[w].ammo;
      out.push({ k: 'a:' + a, c: AMMO[a].box * (WEAPONS[w].cls === 'sr' ? 1 : 1) });
    } else if (cat === 'ammo') {
      const a = weighted(rng, [['9mm', 22], ['45', 18], ['556', 24], ['762', 20], ['12g', 12], ['300', tier >= 3 ? 3 : 0.5]]);
      out.push({ k: 'a:' + a, c: AMMO[a].box });
    } else if (cat === 'helmet' || cat === 'vest' || cat === 'pack') {
      let lvl = weighted(rng, GEAR_LEVEL[Math.min(3, tier)]);
      if (cat === 'helmet' && lvl === 3) lvl = 2; // קסדה רמה 3 רק בחבילות אספקה
      out.push({ k: cat[0] + lvl, c: 1 });
    } else if (cat === 'med') {
      const m = weighted(rng, [['band', 40], ['aid', 20], ['kit', 7 + tier], ['drink', 15], ['pain', 11], ['adren', 3 + tier]]);
      out.push({ k: 'm:' + m, c: m === 'band' ? randInt(rng, 2, 5) : m === 'drink' ? randInt(rng, 1, 2) : 1 });
    } else if (cat === 'throw') {
      const t = weighted(rng, [['frag', 40], ['smoke', 25], ['stun', 15], ['molo', 20]]);
      out.push({ k: 't:' + t, c: randInt(rng, 1, 2) });
    } else {
      const s = weighted(rng, [['red', 34], ['x2', 30], ['x4', 24], ['x8', tier >= 2 ? 12 : 0]]);
      out.push({ k: 's:' + s, c: 1 });
    }
  }
  return out;
}

// תכולת חבילת אספקה
export function airdropContents(rng) {
  const out = [];
  const guns = [['awm', 3], ['m249', 3], ['groza', 4], ['kar98', 2], ['m416', 2]];
  const g = weighted(rng, guns);
  out.push({ k: 'w:' + g, c: 1 });
  out.push({ k: 'a:' + WEAPONS[g].ammo, c: 60 });
  if (g === 'awm') out.push({ k: 's:x8', c: 1 });
  out.push({ k: 'h3', c: 1 }, { k: 'v3', c: 1 }, { k: 'p3', c: 1 });
  out.push({ k: 'm:kit', c: 2 }, { k: 'm:adren', c: 1 }, { k: 'm:drink', c: 2 });
  out.push({ k: 't:frag', c: 2 }, { k: 't:smoke', c: 2 });
  return out;
}
