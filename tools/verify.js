// Checks every level in game/levels.js:
//  - the solver finds a winning line (pull, wait, pull...)
//  - that line also wins with three other random splash patterns
// node tools/verify.js
const { LEVELS } = require('../game/levels.js');
const { solve, replay } = require('./solve.js');

let failed = 0;
LEVELS.forEach((lv, i) => {
  const r = solve(lv, { budget: 3000 });
  const lines = [];
  let ok = isFinite(r.minSteps) && !r.aborted;
  if (ok) {
    for (const seed of [undefined, lv.seed + 7919, lv.seed + 15838, lv.seed + 23757]) {
      const rp = replay(lv, r.best, seed);
      if (rp.state !== 'won') { ok = false; lines.push(`seed ${seed} -> ${rp.state}`); }
    }
  }
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(i + 1).padStart(2)} ${lv.name.padEnd(18)} pins ${lv.pins.length} fewest pulls ${r.minSteps} random-play wins ${(r.winRate * 100).toFixed(1).padStart(5)}%  line ${r.best ? r.best.join(',') : '-'} ${lines.join('; ')}`);
});
if (failed) { console.log(`${failed} level(s) failed`); process.exit(1); }
console.log(`all ${LEVELS.length} levels verified`);
