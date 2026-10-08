// Flame Out - particle simulation engine.
// A falling-sand style grid: every cell is empty, solid, or one particle.
// Runs in the browser (window.FlameEngine) and in Node (module.exports) for tests.
(function (root) {
  'use strict';

  const W = 100;
  const H = 150;
  const CELL = 4; // logical pixels per cell

  const EMPTY = 0, WALL = 1, PIN = 2, WATER = 3, LAVA = 4, STONE = 5, ROCK = 6;
  const ZONE_FIRE = 1, ZONE_DRAIN = 2;

  const WATER_SPREAD = 4;
  const LAVA_SPREAD = 2;
  const QUIET_STEPS_TO_SETTLE = 90;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const KIND = { water: WATER, lava: LAVA, rock: ROCK, stone: STONE };

  function createWorld(level, seed) {
    const n = W * H;
    const w = {
      level,
      type: new Uint8Array(n),
      pinOf: new Int16Array(n).fill(-1),
      stamp: new Uint32Array(n),
      vx: new Int8Array(n),
      shade: new Uint8Array(n),
      zone: new Uint8Array(n),
      frame: 0,
      rand: mulberry32(seed || 1),
      events: [],
      pins: [],
      progress: 0,
      totalWater: 0,
      need: 0,
      waterCount: 0,
      lavaCount: 0,
      quiet: 0,
      state: 'play', // play | won | lost
      reason: '',
      lastStepVertical: 0,
    };

    for (let i = 0; i < n; i++) w.shade[i] = (w.rand() * 256) | 0;

    for (const r of level.walls || []) fillRect(w, r[0], r[1], r[2], r[3], WALL);
    for (const l of level.lines || []) fillLine(w, l[0], l[1], l[2], l[3], l[4] || 1.5);

    (level.pins || []).forEach((p, id) => {
      w.pins.push({ id, x: p.x, y: p.y, w: p.w, h: p.h, dir: p.dir, pulled: false });
      for (let y = p.y; y < p.y + p.h; y++) {
        for (let x = p.x; x < p.x + p.w; x++) {
          if (!inside(x, y)) continue;
          const i = y * W + x;
          if (w.type[i] === EMPTY) { w.type[i] = PIN; w.pinOf[i] = id; }
        }
      }
    });

    if (level.fire) markZone(w, level.fire, ZONE_FIRE);
    for (const d of level.drains || []) markZone(w, d, ZONE_DRAIN);

    for (const f of level.fills || []) {
      const t = KIND[f.t];
      for (let y = f.y; y < f.y + f.h; y++) {
        for (let x = f.x; x < f.x + f.w; x++) {
          if (!inside(x, y)) continue;
          const i = y * W + x;
          if (w.type[i] === EMPTY && w.zone[i] === 0) {
            w.type[i] = t;
            if (t === WATER) w.totalWater++;
          }
        }
      }
    }
    w.need = Math.max(1, Math.ceil(w.totalWater * (level.need || 0.35)));
    w.waterCount = w.totalWater;
    return w;
  }

  function inside(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }

  function fillRect(w, x0, y0, rw, rh, t) {
    for (let y = y0; y < y0 + rh; y++)
      for (let x = x0; x < x0 + rw; x++)
        if (inside(x, y)) w.type[y * W + x] = t;
  }

  // Thick line segment, used for ramps and funnels.
  function fillLine(w, x1, y1, x2, y2, r) {
    const minX = Math.floor(Math.min(x1, x2) - r - 1), maxX = Math.ceil(Math.max(x1, x2) + r + 1);
    const minY = Math.floor(Math.min(y1, y2) - r - 1), maxY = Math.ceil(Math.max(y1, y2) + r + 1);
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!inside(x, y)) continue;
        const cx = x + 0.5, cy = y + 0.5;
        let t = ((cx - x1) * dx + (cy - y1) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = x1 + dx * t - cx, py = y1 + dy * t - cy;
        if (px * px + py * py <= r * r) w.type[y * W + x] = WALL;
      }
    }
  }

  function markZone(w, z, v) {
    for (let y = z.y; y < z.y + z.h; y++)
      for (let x = z.x; x < z.x + z.w; x++)
        if (inside(x, y) && w.type[y * W + x] === EMPTY) w.zone[y * W + x] = v;
  }

  function pullPin(w, id) {
    const p = w.pins[id];
    if (!p || p.pulled || w.state !== 'play') return false;
    p.pulled = true;
    for (let y = p.y; y < p.y + p.h; y++) {
      for (let x = p.x; x < p.x + p.w; x++) {
        if (!inside(x, y)) continue;
        const i = y * W + x;
        if (w.pinOf[i] === id) { w.type[i] = EMPTY; w.pinOf[i] = -1; }
      }
    }
    w.quiet = 0;
    return true;
  }

  // ---- simulation ----

  function step(w) {
    const f = ++w.frame;
    const T = w.type, S = w.stamp, R = w.rand;
    let vertical = 0;
    let water = 0, lava = 0;

    const isEmpty = (x, y) => inside(x, y) && T[y * W + x] === EMPTY;
    const at = (x, y) => (inside(x, y) ? T[y * W + x] : WALL);

    // Move particle from i to j (j is empty or a swappable liquid).
    function move(i, j) {
      const ti = T[i];
      T[i] = T[j]; T[j] = ti;
      const v = w.vx[i]; w.vx[i] = w.vx[j]; w.vx[j] = v;
      const s = w.shade[i]; w.shade[i] = w.shade[j]; w.shade[j] = s;
      S[j] = f;
      if (T[i] !== EMPTY) S[i] = f;
      touchZone(j);
      if (T[i] !== EMPTY) touchZone(i);
      return j;
    }

    function touchZone(j) {
      const z = w.zone[j];
      if (!z) return;
      const t = T[j];
      const x = j % W, y = (j / W) | 0;
      if (z === ZONE_FIRE) {
        if (t === WATER) {
          T[j] = EMPTY;
          w.progress++;
          if ((w.progress & 3) === 0) w.events.push({ e: 'douse', x, y });
        } else if (t === LAVA) {
          T[j] = EMPTY;
          w.events.push({ e: 'flare', x, y });
          if (w.state === 'play') { w.state = 'lost'; w.reason = 'lava'; }
        } else if (t === STONE || t === ROCK) {
          // The fire crumbles anything solid that lands in it, so water can still get through.
          T[j] = EMPTY;
          if (R() < 0.2) w.events.push({ e: 'ash', x, y });
        }
      } else if (z === ZONE_DRAIN) {
        if (t === WATER || t === LAVA) {
          T[j] = EMPTY;
          if (R() < 0.15) w.events.push({ e: 'drip', x, y });
        }
      }
    }

    // Water touching lava: lava cools to stone, water boils away.
    function react(i, x, y, self) {
      const other = self === WATER ? LAVA : WATER;
      const nb = [[0, 1], [1, 0], [-1, 0], [0, -1]];
      for (let k = 0; k < 4; k++) {
        const nx = x + nb[k][0], ny = y + nb[k][1];
        if (!inside(nx, ny)) continue;
        const j = ny * W + nx;
        if (T[j] !== other) continue;
        const li = self === LAVA ? i : j;
        const wi = self === WATER ? i : j;
        T[li] = STONE; S[li] = f;
        T[wi] = EMPTY;
        if (R() < 0.35) w.events.push({ e: 'steam', x: nx, y: ny });
        return true;
      }
      return false;
    }

    function liquid(i, x, y, t, spread) {
      const first = R() < 0.5 ? -1 : 1;
      if (y + 1 < H) {
        const b = i + W;
        if (T[b] === EMPTY) {
          // A falling stream sometimes drifts sideways so it splashes instead of dropping as a block.
          if (R() < 0.08 && isEmpty(x + first, y + 1) && isEmpty(x + first, y)) { move(i, b + first); return 2; }
          move(i, b); return 2;
        }
      }
      for (let s = 0; s < 2; s++) {
        const d = s === 0 ? first : -first;
        if (isEmpty(x + d, y + 1) && isEmpty(x + d, y)) { move(i, (y + 1) * W + x + d); return 2; }
      }
      let d = w.vx[i] || first;
      let cur = x;
      for (let s = 1; s <= spread; s++) {
        const nx = x + d * s;
        if (!isEmpty(nx, y)) break;
        cur = nx;
        if (isEmpty(nx, y + 1)) break;
      }
      if (cur !== x) {
        const j = move(i, y * W + cur);
        w.vx[j] = d;
        return 1;
      }
      w.vx[i] = -d;
      return 0;
    }

    function granular(i, x, y) {
      if (y + 1 < H) {
        const b = i + W;
        const tb = T[b];
        if (tb === EMPTY) { move(i, b); return 2; }
        if ((tb === WATER || tb === LAVA) && R() < 0.5) { move(i, b); return 2; }
      }
      const first = R() < 0.5 ? -1 : 1;
      for (let s = 0; s < 2; s++) {
        const d = s === 0 ? first : -first;
        if (isEmpty(x + d, y + 1) && isEmpty(x + d, y)) { move(i, (y + 1) * W + x + d); return 2; }
      }
      return 0;
    }

    for (let y = H - 1; y >= 0; y--) {
      const ltr = ((y + f) & 1) === 0;
      for (let k = 0; k < W; k++) {
        const x = ltr ? k : W - 1 - k;
        const i = y * W + x;
        const t = T[i];
        if (t < WATER || S[i] === f) continue;
        let r = 0;
        if (t === WATER) {
          if (react(i, x, y, WATER)) r = 2;
          else r = liquid(i, x, y, WATER, WATER_SPREAD);
        } else if (t === LAVA) {
          if (react(i, x, y, LAVA)) r = 2;
          else if (((f + x) & 1) === 0) r = liquid(i, x, y, LAVA, LAVA_SPREAD);
        } else {
          r = granular(i, x, y);
        }
        if (r === 2) vertical++;
      }
    }

    for (let i = 0; i < T.length; i++) {
      if (T[i] === WATER) water++;
      else if (T[i] === LAVA) lava++;
    }
    w.waterCount = water;
    w.lavaCount = lava;
    w.lastStepVertical = vertical;
    w.quiet = vertical > 0 ? 0 : w.quiet + 1;

    if (w.state === 'play') {
      if (w.progress >= w.need) {
        w.state = 'won';
      } else if (water + w.progress < w.need) {
        w.state = 'lost'; w.reason = 'water';
      } else if (w.quiet > QUIET_STEPS_TO_SETTLE && w.pins.every((p) => p.pulled)) {
        w.state = 'lost'; w.reason = 'stuck';
      }
    }
  }

  const api = {
    W, H, CELL,
    EMPTY, WALL, PIN, WATER, LAVA, STONE, ROCK, ZONE_FIRE, ZONE_DRAIN,
    createWorld, step, pullPin,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlameEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
