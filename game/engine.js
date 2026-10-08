// Flame Out - particle simulation engine.
// A falling-sand style grid: every cell is empty, solid, or one particle.
// Runs in the browser (window.FlameEngine) and in Node (module.exports) for tools.
(function (root) {
  'use strict';

  const W = 100;
  const H = 150;
  const CELL = 4; // logical pixels per cell

  const EMPTY = 0, WALL = 1, PIN = 2, WATER = 3, LAVA = 4, STONE = 5, ROCK = 6, ICE = 7, MELT = 8;
  // MELT is ice that is melting: it turns to water next step and starts melting the ice it touches.
  // zone values: 0 none, 1 drain, 2 + k = fire k
  const ZONE_DRAIN = 1, ZONE_FIRE0 = 2;

  const WATER_SPREAD = 4;
  const LAVA_SPREAD = 2;
  const QUIET_STEPS_TO_SETTLE = 90;
  const HANDLE_CELLS = 4; // space a pin needs clear beyond its handle end

  const KIND = { water: WATER, lava: LAVA, rock: ROCK, stone: STONE, ice: ICE };

  function makeRng(state) {
    const s = { a: state >>> 0 };
    const f = function () {
      s.a = (s.a + 0x6d2b79f5) >>> 0;
      let t = s.a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.state = s;
    return f;
  }

  function firesOf(level) {
    if (Array.isArray(level.fires)) return level.fires;
    return level.fire ? [level.fire] : [];
  }

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
      rand: makeRng(seed == null ? (level.seed || 1) : seed),
      events: [],
      pins: [],
      fires: [],
      totalWater: 0,
      waterCount: 0,
      lavaCount: 0,
      iceCount: 0,
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

    firesOf(level).forEach((f, k) => {
      markZone(w, f, ZONE_FIRE0 + k);
      w.fires.push({ x: f.x, y: f.y, w: f.w, h: f.h, share: f.need, progress: 0, need: 1 });
    });
    for (const d of level.drains || []) markZone(w, d, ZONE_DRAIN);

    for (const f of level.fills || []) {
      const t = KIND[f.t];
      for (let y = f.y; y < f.y + f.h; y++) {
        for (let x = f.x; x < f.x + f.w; x++) {
          if (!inside(x, y)) continue;
          const i = y * W + x;
          if (w.type[i] === EMPTY && w.zone[i] === 0) {
            w.type[i] = t;
            if (t === WATER || t === ICE) w.totalWater++;
          }
        }
      }
    }
    const share = level.need || 0.35;
    for (const f of w.fires) f.need = Math.max(1, Math.ceil(w.totalWater * (f.share || share)));
    countParticles(w);
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

  // The cells a pin must slide into just beyond its handle end.
  function handleZone(p) {
    if (p.dir === 'left') return { x: p.x - HANDLE_CELLS, y: p.y - 1, w: HANDLE_CELLS, h: p.h + 2 };
    if (p.dir === 'right') return { x: p.x + p.w, y: p.y - 1, w: HANDLE_CELLS, h: p.h + 2 };
    if (p.dir === 'up') return { x: p.x - 1, y: p.y - HANDLE_CELLS, w: p.w + 2, h: HANDLE_CELLS };
    return { x: p.x - 1, y: p.y + p.h, w: p.w + 2, h: HANDLE_CELLS };
  }

  // A pin is locked while rock, stone, ice or another pin sits where its handle must go.
  function isBlocked(w, id) {
    const p = w.pins[id];
    const z = handleZone(p);
    for (let y = z.y; y < z.y + z.h; y++) {
      for (let x = z.x; x < z.x + z.w; x++) {
        if (!inside(x, y)) continue;
        const i = y * W + x;
        const t = w.type[i];
        if (t === ROCK || t === STONE || t === ICE || t === MELT) return true;
        if (t === PIN && w.pinOf[i] !== id) return true;
      }
    }
    return false;
  }

  function pullPin(w, id) {
    const p = w.pins[id];
    if (!p || p.pulled || w.state !== 'play') return false;
    if (isBlocked(w, id)) return false;
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

  function countParticles(w) {
    const T = w.type;
    let water = 0, lava = 0, ice = 0;
    for (let i = 0; i < T.length; i++) {
      const t = T[i];
      if (t === WATER) water++;
      else if (t === LAVA) lava++;
      else if (t === ICE || t === MELT) ice++;
    }
    w.waterCount = water; w.lavaCount = lava; w.iceCount = ice;
  }

  function waterStillNeeded(w) {
    let s = 0;
    for (const f of w.fires) s += Math.max(0, f.need - f.progress);
    return s;
  }

  // ---- simulation ----

  function step(w) {
    const f = ++w.frame;
    const T = w.type, S = w.stamp, R = w.rand;
    let vertical = 0;

    const isEmpty = (x, y) => inside(x, y) && T[y * W + x] === EMPTY;

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
      if (z >= ZONE_FIRE0) {
        const fire = w.fires[z - ZONE_FIRE0];
        if (t === WATER) {
          T[j] = EMPTY;
          fire.progress++;
          if ((fire.progress & 3) === 0) w.events.push({ e: 'douse', x, y, fire: z - ZONE_FIRE0 });
        } else if (t === LAVA) {
          T[j] = EMPTY;
          w.events.push({ e: 'flare', x, y, fire: z - ZONE_FIRE0 });
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

    // Lava touching water: lava cools to stone, water boils away.
    // Lava touching ice: the ice starts melting, and the melt spreads through the whole block.
    function react(i, x, y, self) {
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 1 ? 1 : k === 2 ? -1 : 0), ny = y + (k === 0 ? 1 : k === 3 ? -1 : 0);
        if (!inside(nx, ny)) continue;
        const j = ny * W + nx;
        const o = T[j];
        if (self === WATER) {
          if (o !== LAVA) continue;
          T[j] = STONE; S[j] = f; T[i] = EMPTY;
        } else {
          if (o === WATER) { T[i] = STONE; S[i] = f; T[j] = EMPTY; }
          else if (o === ICE) { T[j] = MELT; S[j] = f; }
          else continue;
        }
        if (R() < 0.35) w.events.push({ e: 'steam', x: nx, y: ny });
        return true;
      }
      return false;
    }

    function liquid(i, x, y, spread) {
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
      const d = w.vx[i] || first;
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
        if (t < WATER || t === ICE || S[i] === f) continue;
        let r = 0;
        if (t === MELT) {
          T[i] = WATER; S[i] = f;
          if (x > 0 && T[i - 1] === ICE) { T[i - 1] = MELT; S[i - 1] = f; }
          if (x < W - 1 && T[i + 1] === ICE) { T[i + 1] = MELT; S[i + 1] = f; }
          if (y > 0 && T[i - W] === ICE) { T[i - W] = MELT; S[i - W] = f; }
          if (y < H - 1 && T[i + W] === ICE) { T[i + W] = MELT; S[i + W] = f; }
          if (R() < 0.08) w.events.push({ e: 'steam', x, y });
          vertical++;
          continue;
        }
        if (t === WATER) {
          if (react(i, x, y, WATER)) r = 2;
          else r = liquid(i, x, y, WATER_SPREAD);
        } else if (t === LAVA) {
          if (react(i, x, y, LAVA)) r = 2;
          else if (((f + x) & 1) === 0) r = liquid(i, x, y, LAVA_SPREAD);
        } else {
          r = granular(i, x, y);
        }
        if (r === 2) vertical++;
      }
    }

    countParticles(w);
    w.lastStepVertical = vertical;
    w.quiet = vertical > 0 ? 0 : w.quiet + 1;

    if (w.state === 'play') {
      const still = waterStillNeeded(w);
      if (still === 0) {
        w.state = 'won';
      } else if (w.waterCount + w.iceCount < still) {
        w.state = 'lost'; w.reason = 'water';
      } else if (w.quiet > QUIET_STEPS_TO_SETTLE && w.pins.every((p) => p.pulled || isBlocked(w, p.id))) {
        w.state = 'lost'; w.reason = 'stuck';
      }
    }
  }

  // Exact copy of a world, used by the level solver to branch.
  function cloneWorld(w) {
    const c = Object.assign({}, w);
    c.type = w.type.slice();
    c.pinOf = w.pinOf.slice();
    c.stamp = w.stamp.slice();
    c.vx = w.vx.slice();
    c.shade = w.shade.slice();
    c.rand = makeRng(0);
    c.rand.state.a = w.rand.state.a;
    c.events = [];
    c.pins = w.pins.map((p) => Object.assign({}, p));
    c.fires = w.fires.map((p) => Object.assign({}, p));
    return c;
  }

  const api = {
    W, H, CELL,
    EMPTY, WALL, PIN, WATER, LAVA, STONE, ROCK, ICE, MELT, ZONE_DRAIN, ZONE_FIRE0,
    createWorld, step, pullPin, isBlocked, handleZone, cloneWorld, firesOf, waterStillNeeded,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlameEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
