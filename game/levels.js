// Flame Out - level data. Levels are drawn on a 90 x 150 cell layout, then shifted
// right by MARGIN so pin handles near the edges stay on the 100-cell-wide grid.
// walls: [x, y, w, h] rects. lines: [x1, y1, x2, y2, radius] ramps.
// pins: { x, y, w, h, dir } where dir is the way you swipe to pull it out.
// fills: { t: 'water' | 'lava' | 'rock', x, y, w, h } (only empty cells are filled).
// fire: zone that water puts out and lava makes worse. drains: zones that swallow liquid.
// need: share of all water that must reach the fire.
(function (root) {
  'use strict';

  // Open-topped fire pit with the fire zone in its lower half.
  function firePit(x0, x1, top) {
    top = top || 112;
    return {
      walls: [[x0 - 3, top, 3, 150 - top], [x1, top, 3, 150 - top], [x0 - 3, 146, x1 - x0 + 6, 4]],
      fire: { x: x0, y: 128, w: x1 - x0, h: 18 },
    };
  }

  // Open-bottomed tube; a pin usually closes the bottom.
  function tube(x0, x1, y0, y1) {
    return [[x0 - 3, y0, 3, y1 - y0], [x1, y0, 3, y1 - y0]];
  }

  function merge(base, extra) {
    const out = { walls: [], lines: [], pins: [], fills: [], drains: [] };
    for (const part of [base, extra]) {
      for (const k of Object.keys(part)) {
        if (Array.isArray(part[k])) out[k] = (out[k] || []).concat(part[k]);
        else out[k] = part[k];
      }
    }
    return out;
  }

  const MARGIN = 5;
  const LEVELS = [];

  // 1 - one pin, straight down.
  LEVELS.push(merge(firePit(30, 60), {
    name: 'First Splash',
    hint: 'Swipe the gold pin to pour the water on the fire.',
    walls: tube(33, 57, 20, 78),
    pins: [{ x: 24, y: 72, w: 40, h: 2, dir: 'left' }],
    fills: [{ t: 'water', x: 33, y: 30, w: 24, h: 42 }],
    need: 0.35,
  }));

  // 2 - pick the right pin.
  LEVELS.push(merge(firePit(32, 58), {
    name: 'Hot or Not',
    hint: 'Lava makes the fire bigger. Only pull the water!',
    walls: tube(12, 34, 18, 66).concat(tube(56, 78, 18, 66), [[4, 62, 3, 16], [83, 62, 3, 16]]),
    lines: [[6, 76, 31, 104, 1.6], [84, 76, 59, 104, 1.6]],
    pins: [
      { x: 4, y: 60, w: 34, h: 2, dir: 'left' },
      { x: 52, y: 60, w: 34, h: 2, dir: 'right' },
    ],
    fills: [
      { t: 'water', x: 12, y: 24, w: 22, h: 36 },
      { t: 'lava', x: 56, y: 24, w: 22, h: 36 },
    ],
    need: 0.35,
  }));

  // 3 - cool the lava first.
  LEVELS.push(merge(firePit(30, 60), {
    name: 'Cool It Down',
    hint: 'Water turns lava into stone. Cool it before it drops!',
    walls: tube(30, 60, 10, 94),
    pins: [
      { x: 22, y: 46, w: 46, h: 2, dir: 'right' },
      { x: 22, y: 86, w: 46, h: 2, dir: 'left' },
    ],
    fills: [
      { t: 'water', x: 30, y: 14, w: 30, h: 32 },
      { t: 'lava', x: 30, y: 70, w: 30, h: 16 },
    ],
    need: 0.3,
  }));

  // 4 - two doors, one leads to the drain.
  LEVELS.push(merge(firePit(58, 84), {
    name: 'Wrong Turn',
    hint: 'Pick the door that leads to the fire.',
    walls: tube(36, 54, 8, 44).concat(
      [[27, 46, 3, 16], [60, 46, 3, 16], [27, 74, 36, 3]],
      [[27, 77, 3, 70], [-3, 77, 3, 73], [-3, 146, 33, 4]],
      tube(67, 84, 8, 44)
    ),
    drains: [{ x: 0, y: 126, w: 27, h: 20 }],
    pins: [
      { x: 30, y: 40, w: 30, h: 2, dir: 'left' },
      { x: 28, y: 38, w: 2, h: 36, dir: 'up' },
      { x: 60, y: 38, w: 2, h: 36, dir: 'up' },
      { x: 63, y: 40, w: 27, h: 2, dir: 'right' },
    ],
    fills: [
      { t: 'water', x: 36, y: 12, w: 18, h: 28 },
      { t: 'lava', x: 67, y: 16, w: 17, h: 24 },
    ],
    need: 0.35,
  }));

  // 5 - two tanks of water are needed to cool a big lava pool.
  LEVELS.push(merge(firePit(30, 60), {
    name: 'Steam Bath',
    hint: 'That lava pool is big. One tank of water is not enough.',
    walls: tube(30, 60, 66, 106).concat(
      tube(6, 26, 6, 40), tube(64, 84, 6, 40), tube(37, 53, 6, 46),
      [[0, 28, 3, 18], [87, 28, 3, 18]]
    ),
    lines: [[2, 44, 33, 62, 1.6], [88, 44, 57, 62, 1.6]],
    pins: [
      { x: 0, y: 36, w: 31, h: 2, dir: 'left' },
      { x: 59, y: 36, w: 31, h: 2, dir: 'right' },
      { x: 32, y: 42, w: 26, h: 2, dir: 'right' },
      { x: 22, y: 100, w: 46, h: 2, dir: 'left' },
    ],
    fills: [
      { t: 'water', x: 6, y: 10, w: 20, h: 26 },
      { t: 'water', x: 64, y: 10, w: 20, h: 26 },
      { t: 'lava', x: 37, y: 16, w: 16, h: 26 },
      { t: 'lava', x: 30, y: 76, w: 30, h: 24 },
    ],
    need: 0.25,
  }));

  // 6 - rocks fill the hole so water can cross.
  LEVELS.push(merge(firePit(58, 84), {
    name: 'Mind the Gap',
    hint: 'Rocks can fill holes. Water falls right through them.',
    walls: tube(6, 28, 6, 44).concat(
      tube(36, 46, 14, 44),
      [[0, 34, 3, 20], [33, 55, 3, 24], [46, 57, 3, 22], [33, 76, 16, 3]]
    ),
    lines: [[2, 50, 34, 55, 1.6], [48, 57, 66, 60, 1.6]],
    drains: [{ x: 36, y: 68, w: 10, h: 8 }],
    pins: [
      { x: 0, y: 40, w: 31, h: 2, dir: 'left' },
      { x: 31, y: 42, w: 22, h: 2, dir: 'right' },
    ],
    fills: [
      { t: 'water', x: 6, y: 10, w: 22, h: 30 },
      { t: 'rock', x: 36, y: 18, w: 10, h: 24 },
    ],
    need: 0.3,
  }));

  // 7 - fill the gap, cool the lava, then open the floor.
  LEVELS.push(merge(firePit(58, 84), {
    name: 'Stone Cold',
    hint: 'Three steps. Think before you pull!',
    walls: tube(6, 28, 6, 44).concat(
      tube(36, 46, 14, 44),
      [[0, 34, 3, 20], [33, 55, 3, 24], [46, 57, 3, 22], [33, 76, 16, 3]],
      tube(60, 82, 64, 106)
    ),
    lines: [[2, 50, 34, 55, 1.6], [48, 57, 68, 61, 1.6]],
    drains: [{ x: 36, y: 68, w: 10, h: 8 }],
    pins: [
      { x: 0, y: 40, w: 31, h: 2, dir: 'left' },
      { x: 31, y: 42, w: 22, h: 2, dir: 'right' },
      { x: 54, y: 100, w: 36, h: 2, dir: 'right' },
    ],
    fills: [
      { t: 'water', x: 6, y: 10, w: 22, h: 30 },
      { t: 'rock', x: 36, y: 18, w: 10, h: 24 },
      { t: 'lava', x: 60, y: 84, w: 22, h: 16 },
    ],
    need: 0.3,
  }));

  // 8 - rocks sink and push the water over the rim.
  LEVELS.push(merge(firePit(62, 86), {
    name: 'Sink or Swim',
    hint: 'Heavy rocks sink. What happens to the water?',
    walls: [[24, 40, 3, 53], [60, 60, 3, 33], [24, 90, 39, 3]].concat(
      tube(32, 46, 8, 40), tube(56, 68, 8, 40)
    ),
    pins: [
      { x: 25, y: 38, w: 23, h: 2, dir: 'left' },
      { x: 52, y: 38, w: 24, h: 2, dir: 'right' },
    ],
    fills: [
      { t: 'water', x: 27, y: 62, w: 33, h: 28 },
      { t: 'rock', x: 32, y: 12, w: 14, h: 26 },
      { t: 'lava', x: 56, y: 14, w: 12, h: 24 },
    ],
    need: 0.18,
  }));

  // 9 - cool the lava before the rocks push it over.
  LEVELS.push(merge(firePit(62, 86), {
    name: 'Overflow',
    hint: 'Whatever is on top spills over first.',
    walls: tube(4, 24, 4, 44).concat(
      tube(30, 44, 6, 46),
      [[0, 34, 2, 16], [27, 58, 3, 40], [60, 77, 3, 21], [27, 96, 36, 3]]
    ),
    lines: [[2, 48, 31, 62, 1.6]],
    pins: [
      { x: 0, y: 40, w: 30, h: 2, dir: 'left' },
      { x: 26, y: 44, w: 24, h: 2, dir: 'right' },
    ],
    fills: [
      { t: 'water', x: 4, y: 8, w: 20, h: 32 },
      { t: 'rock', x: 30, y: 12, w: 14, h: 32 },
      { t: 'lava', x: 30, y: 80, w: 30, h: 16 },
    ],
    need: 0.18,
  }));

  // 10 - everything at once.
  LEVELS.push(merge(firePit(58, 84), {
    name: 'Grand Finale',
    hint: 'Gap, lava, decoy. Good luck!',
    walls: tube(6, 28, 6, 44).concat(
      tube(36, 46, 14, 44),
      [[0, 34, 3, 20], [33, 55, 3, 24], [46, 57, 3, 22], [33, 76, 16, 3]],
      tube(60, 82, 64, 106),
      tube(66, 82, 6, 40)
    ),
    lines: [[2, 50, 34, 55, 1.6], [48, 57, 68, 61, 1.6]],
    drains: [{ x: 36, y: 68, w: 10, h: 8 }],
    pins: [
      { x: 0, y: 40, w: 31, h: 2, dir: 'left' },
      { x: 31, y: 42, w: 22, h: 2, dir: 'left' },
      { x: 60, y: 36, w: 30, h: 2, dir: 'right' },
      { x: 54, y: 100, w: 36, h: 2, dir: 'right' },
    ],
    fills: [
      { t: 'water', x: 6, y: 10, w: 22, h: 30 },
      { t: 'rock', x: 36, y: 18, w: 10, h: 24 },
      { t: 'lava', x: 66, y: 12, w: 16, h: 24 },
      { t: 'lava', x: 60, y: 84, w: 22, h: 16 },
    ],
    need: 0.3,
  }));

  for (const lv of LEVELS) shift(lv, MARGIN);

  function shift(lv, dx) {
    lv.walls = lv.walls.map((r) => [r[0] + dx, r[1], r[2], r[3]]);
    lv.lines = lv.lines.map((l) => [l[0] + dx, l[1], l[2] + dx, l[3], l[4]]);
    for (const k of ['pins', 'fills', 'drains']) lv[k] = lv[k].map((o) => Object.assign({}, o, { x: o.x + dx }));
    lv.fire = Object.assign({}, lv.fire, { x: lv.fire.x + dx });
  }

  return_export();

  function return_export() {
    const api = { LEVELS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FlameLevels = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
