// Bundles game/ into single-file pages:
//   dist/flame-out.html  - standalone page (open it in any browser, or host it anywhere)
//   dist/artifact.html   - same game without the document wrapper, for a claude.ai artifact
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'game/index.html'), 'utf8');
// LEVELS_FILE and OUT_DIR let tests build a copy with other levels.
const levelsFile = process.env.LEVELS_FILE || path.join(root, 'game/levels.js');
const outDir = process.env.OUT_DIR || path.join(root, 'dist');
const js = [path.join(root, 'game/engine.js'), levelsFile, path.join(root, 'game/game.js')]
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');
const inline = src.replace(/<!--BUILD:SCRIPTS-->[\s\S]*<!--\/BUILD:SCRIPTS-->/, () => '<script>\n' + js + '\n</script>');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'flame-out.html'), inline);

const body = inline
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/g, '')
  .replace(/<\/?head>\s*/g, '')
  .replace(/<\/?body>\s*/g, '')
  .replace(/<meta [^>]*>\s*/g, '')
  .replace(/<!--BUILD:HEAD-->\s*/, '');
fs.writeFileSync(path.join(outDir, 'artifact.html'), body);
console.log('built ' + outDir + '/flame-out.html and artifact.html', (inline.length / 1024).toFixed(1) + 'KB');
