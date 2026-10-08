// Exhaustive solver for Flame Out levels.
// The player is modelled as: pull one pin, wait until everything settles, pull the next.
// For a level it reports:
//   minSteps - fewest pulls in any winning line
//   winRate  - chance a player who pulls random (unlocked) pins wins
//   best     - one shortest winning line (pin ids)
const E = require('../game/engine.js');

const QUIET = 30;
const MAX_SETTLE = 1500;

function settle(w) {
  let quiet = 0;
  for (let s = 0; s < MAX_SETTLE; s++) {
    E.step(w);
    w.events.length = 0;
    if (w.state !== 'play') return;
    quiet = w.lastStepVertical === 0 ? quiet + 1 : 0;
    if (quiet >= QUIET) return;
  }
}

function solve(level, opts) {
  opts = opts || {};
  const budget = opts.budget || 600;
  let nodes = 0;
  let aborted = false;

  function explore(w, depth) {
    const choices = w.pins.filter((p) => !p.pulled && !E.isBlocked(w, p.id)).map((p) => p.id);
    if (!choices.length) return { p: 0, min: Infinity, line: null };
    let p = 0, min = Infinity, line = null;
    for (const id of choices) {
      if (++nodes > budget) { aborted = true; return { p: 0, min: Infinity, line: null }; }
      const c = E.cloneWorld(w);
      E.pullPin(c, id);
      settle(c);
      let r;
      if (c.state === 'won') r = { p: 1, min: 1, line: [id] };
      else if (c.state === 'lost') r = { p: 0, min: Infinity, line: null };
      else {
        const sub = explore(c, depth + 1);
        r = { p: sub.p, min: sub.min + 1, line: sub.line ? [id].concat(sub.line) : null };
      }
      if (aborted) return r;
      p += r.p;
      if (r.min < min) { min = r.min; line = r.line; }
    }
    return { p: p / choices.length, min, line };
  }

  const w = E.createWorld(level);
  settle(w);
  const r = explore(w, 0);
  return { aborted, nodes, winRate: r.p, minSteps: r.min, best: r.line };
}

// Replays a line with the level's own seed and a few others, waiting for things to settle between pulls.
function replay(level, line, seed) {
  const w = E.createWorld(level, seed);
  settle(w);
  for (const id of line) {
    if (w.state !== 'play') break;
    if (!E.pullPin(w, id)) return { state: 'blocked', w };
    settle(w);
  }
  for (let s = 0; s < 600 && w.state === 'play'; s++) E.step(w);
  return { state: w.state, reason: w.reason, w };
}

module.exports = { solve, replay, settle };
