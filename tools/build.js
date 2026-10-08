// Bundles game/ into single-file pages:
//   dist/flame-out.html  - standalone page (open it in any browser, or host it anywhere)
//   dist/artifact.html   - same game without the document wrapper, for a claude.ai artifact
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'game/index.html'), 'utf8');
const js = ['engine.js', 'levels.js', 'game.js']
  .map((f) => fs.readFileSync(path.join(root, 'game', f), 'utf8'))
  .join('\n');
const inline = src.replace(/<!--BUILD:SCRIPTS-->[\s\S]*<!--\/BUILD:SCRIPTS-->/, () => '<script>\n' + js + '\n</script>');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/flame-out.html'), inline);

const body = inline
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/g, '')
  .replace(/<\/?head>\s*/g, '')
  .replace(/<\/?body>\s*/g, '')
  .replace(/<meta [^>]*>\s*/g, '')
  .replace(/<!--BUILD:HEAD-->\s*/, '');
fs.writeFileSync(path.join(root, 'dist/artifact.html'), body);
console.log('built dist/flame-out.html and dist/artifact.html', (inline.length / 1024).toFixed(1) + 'KB');
