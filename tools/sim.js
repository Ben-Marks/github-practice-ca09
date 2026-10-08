// Headless level checker for Flame Out.
// node tools/sim.js            -> run every scripted check
// node tools/sim.js show 3     -> print level 3 as ASCII
// node tools/sim.js play 3 0,200:1  -> pull pin 0 at step 0, pin 1 at step 200, print result
const E = require('../game/engine.js');
const { LEVELS } = require('../game/levels.js');

const CH = { 0: ' ', 1: '#', 2: '=', 3: '~', 4: '%', 5: 'o', 6: '@' };

function ascii(w) {
  const rows = [];
  for (let y = 0; y < E.H; y += 2) {
    let s = '';
    for (let x = 0; x < E.W; x++) {
      const i = y * E.W + x;
      let c = CH[w.type[i]];
      if (c === ' ' && w.zone[i] === 1) c = '^';
      if (c === ' ' && w.zone[i] === 2) c = '_';
      s += c;
    }
    rows.push(String(y).padStart(3) + ' ' + s);
  }
  return rows.join('\n');
}

// plan: [[step, pinId], ...]
function play(levelIndex, plan, seed, maxSteps) {
  const w = E.createWorld(LEVELS[levelIndex], seed || 7);
  const todo = plan.slice().sort((a, b) => a[0] - b[0]);
  maxSteps = maxSteps || 3000;
  let s = 0;
  for (; s < maxSteps; s++) {
    while (todo.length && todo[0][0] <= s) E.pullPin(w, todo.shift()[1]);
    E.step(w);
    if (w.state !== 'play') break;
  }
  return { w, state: w.state, reason: w.reason, steps: s, progress: w.progress, need: w.need, water: w.waterCount, lava: w.lavaCount, total: w.totalWater };
}

function parsePlan(str) {
  return str.split(',').map((p) => { const [s, id] = p.split(':').map(Number); return id === undefined ? [0, s] : [s, id]; });
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'show') {
  const w = E.createWorld(LEVELS[a - 1], 1);
  console.log(ascii(w));
  console.log('water', w.totalWater, 'need', w.need);
} else if (cmd === 'play') {
  const r = play(a - 1, parsePlan(b));
  console.log(ascii(r.w));
  const { w, ...rest } = r;
  console.log(rest);
} else {
  const checks = require('./checks.js');
  let fail = 0;
  for (const c of checks) {
    for (const seed of [1, 2, 3]) {
      const r = play(c.level - 1, c.plan, seed);
      const ok = r.state === c.expect && (!c.reason || r.reason === c.reason);
      if (!ok) fail++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} L${c.level} seed${seed} ${c.label.padEnd(34)} -> ${r.state}${r.reason ? '/' + r.reason : ''} (step ${r.steps}, ${r.progress}/${r.need}, water ${r.water}, lava ${r.lava})`);
    }
  }
  if (fail) { console.log(`${fail} failed`); process.exit(1); }
  console.log('all checks passed');
}
