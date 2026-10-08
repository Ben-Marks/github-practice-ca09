// Random level builder for Flame Out.
// A level is a row of 2 or 3 glass columns. Each column is split into chambers by pins,
// and each chamber may hold water, lava, rock or ice. Under the columns, each column's
// output goes to a fire, a drain, a "plug pit" (a drain that rocks can fill so water
// overflows into the fire next to it), a basin above a fire, or down a ramp to a neighbour.
// Locks: a pile of rock in the shaft between two columns jams a pin's handle until the
// pin holding the pile is pulled.

function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.weighted = (pairs) => {
    let s = 0;
    for (const [, wt] of pairs) s += wt;
    let r = f() * s;
    for (const [v, wt] of pairs) { if ((r -= wt) <= 0) return v; }
    return pairs[pairs.length - 1][0];
  };
  return f;
}

const GEOM = {
  2: { colX: [15, 55], cw: 30, gaps: [[45, 55]] },
  3: { colX: [8, 38, 68], cw: 24, gaps: [[32, 38], [62, 68]] },
};

const PIT_TOP = 118;
const BASIN_TOP = 108;

// cfg: { cols, contents: [[type, weight]...], rocks, locks, fires, ice, need: [lo, hi] }
function generate(seed, cfg) {
  const R = rng(seed);
  const n = cfg.cols || R.pick([2, 3]);
  const G = GEOM[n];
  const cw = G.cw, iw = cw - 6;
  const level = { seed: (seed % 100000) + 1, walls: [], lines: [], pins: [], fills: [], fires: [], drains: [] };
  const W = level.walls;

  // ---- routing under the columns ----
  const fireCount = Math.min(cfg.fires || 1, n);
  let route = new Array(n).fill(null);
  const fireCols = [];
  while (fireCols.length < fireCount) {
    const c = R.int(0, n - 1);
    if (!fireCols.includes(c)) fireCols.push(c);
  }
  for (const c of fireCols) route[c] = cfg.basin && R() < cfg.basin ? 'basin' : 'fire';
  for (let c = 0; c < n; c++) {
    if (route[c]) continue;
    const opts = [['drain', 2]];
    const nb = [c - 1, c + 1].filter((d) => d >= 0 && d < n);
    for (const d of nb) {
      if (fireCols.includes(d)) opts.push([d < c ? 'rampL' : 'rampR', 3]);
      if (cfg.rocks && route[d] === 'fire') opts.push([d < c ? 'plugL' : 'plugR', 2]);
    }
    route[c] = R.weighted(opts);
  }
  // ramps may also go to a neighbouring drain if that neighbour is decided later; keep it simple:
  // a ramp only targets a fire or basin column.

  const yb = route.includes('basin') ? R.int(84, 94) : R.int(86, 98);
  const hasBasin = route.map((r) => r === 'basin');

  // ---- columns and chambers ----
  const cols = [];
  for (let c = 0; c < n; c++) {
    const x0 = G.colX[c];
    const top = R.int(6, 30);
    const height = yb - top;
    const maxCh = Math.max(1, Math.min(3, Math.floor(height / 20)));
    const k = Math.min(cfg.maxChambers || 3, maxCh, R() < 0.7 ? 3 : R.int(1, 3));
    const floors = [];
    for (let tries = 0; tries < 50 && floors.length < k - 1; tries++) {
      const y = R.int(top + 18, yb - 18);
      if (floors.every((f) => Math.abs(f - y) >= 18)) floors.push(y);
    }
    floors.sort((a, b) => a - b);
    floors.push(yb);
    const chambers = [];
    let prev = top;
    for (const fy of floors) {
      chambers.push({ top: prev, floor: fy, floorType: 'pin' });
      prev = fy + 2;
    }
    cols.push({ c, x0, top, chambers });
  }

  // keep the pin count within budget by merging chambers (a basin adds one more pin)
  const maxPins = (cfg.maxPins || 6) - (route.includes('basin') ? 1 : 0);
  const count = () => cols.reduce((a, c) => a + c.chambers.length, 0);
  while (count() > maxPins) {
    const multi = cols.filter((c) => c.chambers.length > 1);
    if (!multi.length) return null;
    const col = R.pick(multi);
    const j = R.int(0, col.chambers.length - 2);
    const a = col.chambers[j], b = col.chambers[j + 1];
    col.chambers.splice(j, 2, { top: a.top, floor: b.floor, floorType: 'pin' });
  }

  // pin directions: outer columns point outwards; the middle column picks a side
  const dirFor = (c) => {
    if (n === 2) return c === 0 ? 'left' : 'right';
    if (c === 0) return 'left';
    if (c === 2) return 'right';
    return R() < 0.5 ? 'left' : 'right';
  };

  // ice floors (frozen plugs instead of pins)
  if (cfg.ice) {
    for (const col of cols) for (const ch of col.chambers) {
      if (ch.floor !== yb && R() < cfg.ice * 0.6) ch.floorType = 'ice';
    }
  }

  // contents
  for (const col of cols) {
    for (const [ci, ch] of col.chambers.entries()) {
      const t = R.weighted(ci === 0 && cfg.contentsTop ? cfg.contentsTop : cfg.contents);
      if (t === 'empty') continue;
      // lava may not start touching ice: no lava on an ice floor, and no lava straight on top of an ice block
      if (t === 'lava' && ch.floorType === 'ice') continue;
      const ih = ch.floor - ch.top;
      const fh = Math.max(4, Math.round(ih * (0.4 + R() * 0.45)));
      ch.fill = { t, h: fh };
    }
  }

  for (const col of cols) {
    for (let j = 1; j < col.chambers.length; j++) {
      const up = col.chambers[j - 1], down = col.chambers[j];
      if (down.fill && down.fill.t === 'ice' && up.floorType === 'ice') up.floorType = 'pin';
    }
    // every piece of ice needs some lava above it in its column, or it could never melt
    col.chambers.forEach((ch, j) => {
      const iceHere = (ch.fill && ch.fill.t === 'ice') || ch.floorType === 'ice';
      if (!iceHere) return;
      const above = col.chambers.slice(0, ch.floorType === 'ice' ? j + 1 : j);
      if (above.some((a) => a.fill && a.fill.t === 'lava')) return;
      const host = above.filter((a) => a.floorType !== 'ice' && !(a.fill && a.fill.t === 'ice'));
      if (host.length) {
        const a = R.pick(host);
        a.fill = { t: 'lava', h: Math.max(4, Math.round((a.floor - a.top) * (0.25 + R() * 0.3))) };
      } else {
        if (ch.fill && ch.fill.t === 'ice') ch.fill.t = 'water';
        if (ch.floorType === 'ice') ch.floorType = 'pin';
      }
    });
  }

  // build pins
  const pinRefs = [];
  const addPin = (col, ch, dir) => {
    const x0 = col.x0;
    const p = dir === 'left' ? { x: x0 - 2, y: ch.floor, w: cw + 1, h: 2, dir } : { x: x0 + 1, y: ch.floor, w: cw + 1, h: 2, dir };
    ch.pin = p;
    pinRefs.push({ p, col: col.c, ch });
  };
  for (const col of cols) {
    const dir = dirFor(col.c);
    for (const ch of col.chambers) {
      if (ch.floorType === 'pin') addPin(col, ch, n === 3 && col.c === 1 ? (R() < 0.5 ? 'left' : 'right') : dir);
    }
  }

  // ---- locks ----
  const locks = [];
  const lockCount = cfg.locks ? R.int(cfg.locks[0], cfg.locks[1]) : 0;
  for (let li = 0; li < lockCount; li++) {
    const g = R.int(0, G.gaps.length - 1);
    const [gx0, gx1] = G.gaps[g];
    const leftCol = g, rightCol = g + 1;
    // A points into the gap from one side; B is a pin on the other side, lower down, extended across the gap.
    const aSide = R() < 0.5 ? 'right' : 'left'; // which column owns A
    const aCol = aSide === 'right' ? rightCol : leftCol;
    const bCol = aSide === 'right' ? leftCol : rightCol;
    const aDir = aSide === 'right' ? 'left' : 'right';
    const aCands = cols[aCol].chambers.filter((ch) => ch.pin && !ch.lockA && !ch.lockB);
    const bCands = cols[bCol].chambers.filter((ch) => ch.pin && !ch.lockA && !ch.lockB);
    const pairs = [];
    for (const a of aCands) for (const b of bCands) if (b.floor >= a.floor + 6 && b.floor <= a.floor + 26) pairs.push([a, b]);
    if (!pairs.length) continue;
    const [a, b] = R.pick(pairs);
    if (locks.some((l) => l.g === g)) continue;
    // A turns to face the gap
    const ax0 = cols[aCol].x0;
    a.pin.dir = aDir;
    if (aDir === 'left') { a.pin.x = ax0 - 2; } else { a.pin.x = ax0 + 1; }
    a.pin.w = cw + 1;
    // B keeps facing away from the gap and stretches across it to the far wall
    const bx0 = cols[bCol].x0;
    if (aSide === 'right') { // B is in the left column, faces left, extends right to inside A's wall
      b.pin.dir = 'left';
      b.pin.x = bx0 - 2;
      b.pin.w = (gx1 + 2) - b.pin.x;
    } else { // B is in the right column, faces right, extends left to inside A's wall
      b.pin.dir = 'right';
      const end = bx0 + cw + 2;
      b.pin.x = gx0 - 3;
      b.pin.w = end - b.pin.x;
    }
    a.lockA = true; b.lockB = true;
    const rockTop = a.floor - 5;
    locks.push({ g, gx0, gx1, rockTop, bFloor: b.floor });
    level.fills.push({ t: cfg.lockMaterial ? R.weighted(cfg.lockMaterial) : 'rock', x: gx0, y: rockTop, w: gx1 - gx0, h: b.floor - rockTop });
    // both columns' walls must be tall enough to hold the pile
    cols[aCol].top = Math.min(cols[aCol].top, rockTop - 4);
    cols[bCol].top = Math.min(cols[bCol].top, rockTop - 4);
  }
  if (cfg.locks && cfg.locks[0] > 0 && locks.length < cfg.locks[0]) return null;

  // ---- walls, fills ----
  for (const col of cols) {
    const x0 = col.x0;
    W.push([x0, col.top, 3, yb + 4 - col.top], [x0 + cw - 3, col.top, 3, yb + 4 - col.top]);
    for (const ch of col.chambers) {
      if (ch.floorType === 'ice') level.fills.push({ t: 'ice', x: x0 + 3, y: ch.floor - 1, w: iw, h: 3 });
      if (ch.fill) {
        const fy = ch.floor - ch.fill.h;
        level.fills.push({ t: ch.fill.t, x: x0 + 3, y: Math.max(ch.top + 1, fy), w: iw, h: ch.floor - Math.max(ch.top + 1, fy) - (ch.floorType === 'ice' ? 1 : 0) });
      }
    }
  }
  for (const r of pinRefs) level.pins.push(r.p);

  // ---- routing geometry ----
  W.push([0, 147, 100, 3]);
  const pitWalls = (c, top) => [[G.colX[c], top, 3, 147 - top], [G.colX[c] + cw - 3, top, 3, 147 - top]];
  const inner = (c) => G.colX[c] + 3;
  const fireIndex = {};
  for (let c = 0; c < n; c++) {
    const r = route[c];
    if (r === 'fire') {
      // plug neighbours lower this pit's wall on their side
      const lowL = route[c - 1] === 'plugR', lowR = route[c + 1] === 'plugL';
      const [wl, wr] = pitWalls(c, PIT_TOP);
      if (lowL) { wl[1] = 128; wl[3] = 147 - 128; }
      if (lowR) { wr[1] = 128; wr[3] = 147 - 128; }
      W.push(wl, wr);
      fireIndex[c] = level.fires.length;
      level.fires.push({ x: inner(c), y: 128, w: iw, h: 19 });
    } else if (r === 'basin') {
      W.push(...pitWalls(c, BASIN_TOP));
      const dir = n === 2 ? (c === 0 ? 'left' : 'right') : c === 0 ? 'left' : c === 2 ? 'right' : (R() < 0.5 ? 'left' : 'right');
      const x0 = G.colX[c];
      level.pins.push(dir === 'left' ? { x: x0 - 2, y: 124, w: cw + 1, h: 2, dir } : { x: x0 + 1, y: 124, w: cw + 1, h: 2, dir });
      fireIndex[c] = level.fires.length;
      level.fires.push({ x: inner(c), y: 130, w: iw, h: 17 });
    } else if (r === 'drain') {
      W.push(...pitWalls(c, PIT_TOP));
      level.drains.push({ x: inner(c), y: 132, w: iw, h: 15 });
    } else if (r === 'plugL' || r === 'plugR') {
      const [wl, wr] = pitWalls(c, PIT_TOP);
      const toward = r === 'plugL' ? c - 1 : c + 1;
      if (r === 'plugL') { wl[1] = 128; wl[3] = 147 - 128; } else { wr[1] = 128; wr[3] = 147 - 128; }
      W.push(wl, wr);
      // bridge over the gap at the low wall height
      const gx = r === 'plugL' ? G.colX[toward] + cw - 3 : G.colX[c] + cw - 3;
      const gEnd = r === 'plugL' ? G.colX[c] + 3 : G.colX[toward] + 3;
      W.push([gx, 128, gEnd - gx, 3]);
      level.drains.push({ x: inner(c), y: 138, w: iw, h: 9 });
    }
  }
  for (let c = 0; c < n; c++) {
    const r = route[c];
    if (r !== 'rampL' && r !== 'rampR') continue;
    const d = r === 'rampL' ? c - 1 : c + 1;
    const targetTop = route[d] === 'basin' ? BASIN_TOP : PIT_TOP;
    const yEnd = targetTop - 3;
    const ys = yb + 4;
    if (yEnd - ys < 3) return null;
    if (r === 'rampR') {
      level.lines.push([G.colX[c] + 1, ys, G.colX[d] + 6, yEnd, 1.6]);
    } else {
      level.lines.push([G.colX[c] + cw - 1, ys, G.colX[d] + cw - 6, yEnd, 1.6]);
    }
  }

  // ---- water needed ----
  let water = 0;
  for (const f of level.fills) if (f.t === 'water' || f.t === 'ice') water += f.w * f.h;
  if (water < 150) return null;
  const [lo, hi] = cfg.need || [0.25, 0.55];
  const share = lo + R() * (hi - lo);
  if (level.fires.length > 1) {
    const each = share / level.fires.length;
    for (const f of level.fires) f.need = each;
  }
  level.need = Math.round(share * 100) / 100;
  if (!level.fires.length) return null;
  if (!level.pins.length) return null;
  if (!level.drains.length) delete level.drains;
  if (!level.lines.length) delete level.lines;
  level.route = route;
  return level;
}

module.exports = { generate, rng };
