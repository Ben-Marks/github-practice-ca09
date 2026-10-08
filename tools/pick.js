// Generates and solves candidate levels in parallel, keeping the ones that pass the world's rules.
// node tools/pick.js <world 1-5> <seconds> [startSeed]
// Results are appended to tools/out/world<N>.jsonl (one candidate per line).
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const WORLDS = {
  1: { contentsTop: [['water', 6], ['lava', 2], ['empty', 1]], contents: [['water', 2], ['lava', 4], ['empty', 3]], basin: 0.35, need: [0.3, 0.7], minSteps: 2, maxRate: 0.4, maxPins: 5 },
  2: { contentsTop: [['water', 5], ['lava', 2], ['rock', 2]], contents: [['water', 2], ['lava', 3], ['rock', 3], ['empty', 2]], rocks: true, basin: 0.3, need: [0.25, 0.6], minSteps: 2, maxRate: 0.35, require: 'rock', maxPins: 5 },
  3: { contentsTop: [['water', 5], ['lava', 2], ['rock', 2]], contents: [['water', 2], ['lava', 3], ['rock', 2], ['empty', 3]], rocks: true, locks: [1, 2], basin: 0.3, need: [0.25, 0.6], minSteps: 3, maxRate: 0.3, require: 'lock', maxPins: 6 },
  4: { contentsTop: [['water', 6], ['lava', 2], ['rock', 1]], contents: [['water', 3], ['lava', 3], ['rock', 2], ['empty', 3]], rocks: true, locks: [0, 1], fires: 2, basin: 0.3, need: [0.3, 0.65], minSteps: 3, maxRate: 0.25, require: 'fires2', maxPins: 6 },
  5: { contentsTop: [['water', 3], ['lava', 4], ['ice', 3], ['rock', 1]], contents: [['water', 2], ['lava', 3], ['rock', 2], ['ice', 3], ['empty', 2]], rocks: true, locks: [0, 1], ice: 0.6, firesRandom: true, basin: 0.3, need: [0.15, 0.45], minSteps: 3, maxRate: 0.2, require: 'ice', maxPins: 6 },
};

function evaluate(world, seed, why) {
  const reject = (r) => (why ? { reject: r } : null);
  const { generate } = require('./gen.js');
  const { solve, replay } = require('./solve.js');
  const E = require('../game/engine.js');
  const base = WORLDS[world];
  const cfg = Object.assign({}, base);
  if (base.firesRandom) cfg.fires = seed % 3 === 0 ? 2 : 1;
  const level = generate(seed, cfg);
  if (!level) return reject('r1');
  if (level.pins.length < 3 || level.pins.length > 7) return reject('r2');
  const has = (t) => level.fills.some((f) => f.t === t);
  if (base.require === 'rock' && !has('rock')) return reject('r3');
  if (base.require === 'ice' && !has('ice')) return reject('r4');
  if (base.require === 'fires2' && level.fires.length < 2) return reject('r5');

  const w0 = E.createWorld(level);
  const lockedAtStart = w0.pins.filter((p) => E.isBlocked(w0, p.id)).map((p) => p.id);
  if (base.require === 'lock' && !lockedAtStart.length) return reject('r6');
  if (lockedAtStart.length === w0.pins.length) return reject('r7');

  const r = solve(level, { budget: 350 });
  if (r.aborted || !isFinite(r.minSteps)) return reject('r8');
  if (r.minSteps < base.minSteps || r.winRate > base.maxRate) return reject('r9');

  // the winning line must work for other random splashes too
  for (let k = 1; k <= 3; k++) {
    const rp = replay(level, r.best, level.seed + k * 7919);
    if (rp.state !== 'won') return reject('r10');
  }
  const own = replay(level, r.best);
  if (own.state !== 'won') return reject('r11');
  // feature checks on the winning line
  if (base.require === 'lock' && !r.best.some((id) => lockedAtStart.includes(id))) return reject('r12');
  if (base.require === 'ice' && own.w.iceCount >= w0.iceCount) return reject('r13');

  const score = r.minSteps + 2.5 * -Math.log10(Math.max(r.winRate, 1e-4));
  return { world, seed, score: Math.round(score * 100) / 100, minSteps: r.minSteps, winRate: r.winRate, best: r.best, pins: level.pins.length, nodes: r.nodes, locked: lockedAtStart, level };
}

if (isMainThread && require.main === module) {
  const world = Number(process.argv[2] || 1);
  const seconds = Number(process.argv[3] || 60);
  const start = Number(process.argv[4] || world * 1000000);
  const outDir = path.join(__dirname, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `world${world}.jsonl`);
  const threads = 4;
  let tried = 0, kept = 0, done = 0;
  const t0 = Date.now();
  for (let k = 0; k < threads; k++) {
    const wk = new Worker(__filename, { workerData: { world, start: start + k, stride: threads, deadline: t0 + seconds * 1000 } });
    wk.on('message', (m) => {
      tried++;
      if (m) { kept++; fs.appendFileSync(outFile, JSON.stringify(m) + '\n'); }
    });
    wk.on('exit', () => {
      if (++done === threads) console.log(`world ${world}: tried ${tried}, kept ${kept} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    });
    wk.on('error', (e) => console.error(e));
  }
} else if (!isMainThread) {
  const { world, start, stride, deadline } = workerData;
  for (let s = start; Date.now() < deadline; s += stride) {
    let res = null;
    try { res = evaluate(world, s); } catch (e) { res = null; }
    parentPort.postMessage(res);
  }
}

module.exports = { WORLDS, evaluate };
