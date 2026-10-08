// node tools/show.js <world> <seed> [pins...]  -> ASCII view of a generated level, optionally after pulling pins
const E = require('../game/engine.js');
const { generate } = require('./gen.js');
const { WORLDS } = require('./pick.js');
const { settle, solve } = require('./solve.js');
const CH = { 0: ' ', 1: '#', 2: '=', 3: '~', 4: '%', 5: 'o', 6: '@', 7: '*', 8: '+' };
function ascii(w) {
  const out = [];
  for (let y = 0; y < E.H; y += 2) {
    let r = '';
    for (let x = 0; x < E.W; x++) {
      const i = y * E.W + x;
      let c = CH[w.type[i]];
      if (c === ' ' && w.zone[i] >= 2) c = '^';
      if (c === ' ' && w.zone[i] === 1) c = '_';
      r += c;
    }
    out.push(String(y).padStart(3) + ' ' + r);
  }
  return out.join('\n');
}
module.exports = { ascii };
if (require.main === module) {
  const [world, seed, ...pulls] = process.argv.slice(2).map(Number);
  const cfg = Object.assign({}, WORLDS[world]);
  if (cfg.firesRandom) cfg.fires = seed % 3 === 0 ? 2 : 1;
  const level = generate(seed, cfg);
  if (!level) { console.log('no level'); process.exit(0); }
  const w = E.createWorld(level);
  settle(w);
  for (const id of pulls) { console.log('pull', id, E.pullPin(w, id)); settle(w); }
  console.log(ascii(w));
  console.log('route', level.route, 'pins', level.pins.map((p, i) => i + ':' + p.dir + '@' + p.y + (E.isBlocked(w, i) ? 'L' : '')).join(' '), 'state', w.state, w.reason, 'fires', w.fires.map((f) => f.progress + '/' + f.need));
  if (!pulls.length) { const r = solve(level, { budget: 350 }); console.log('solve', r); }
}
