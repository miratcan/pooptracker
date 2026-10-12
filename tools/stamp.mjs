// Cache busting without a build step: index.html gets an import map that adds ?v=<content hash> to every module,
// so a browser never runs a new module with an old one it still has in its cache (GitHub Pages caches for 10 min).
// After changing anything in src/, run `npm run stamp`; a test fails while index.html is out of date.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAP = /<script type="importmap">[\s\S]*?<\/script>\n/, ENTRY = /<script type="module" src="src\/main\.js[^"]*"><\/script>/;

const modules = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? modules(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);

// index.html as it should be: the import map and the entry script carry the hashes of today's files
export function stamped(root = ROOT) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  if (!ENTRY.test(html)) throw new Error('index.html: the <script type="module" src="src/main.js"> tag is missing');
  const files = modules(join(root, 'src')).map(f => relative(root, f).split('\\').join('/')).sort();
  const v = Object.fromEntries(files.map(f => [f, hash(join(root, f))]));
  const imports = Object.fromEntries(files.map(f => [`./${f}`, `./${f}?v=${v[f]}`]));
  const map = `<script type="importmap">\n${JSON.stringify({ imports }, null, 2)}\n</script>\n`;
  const entry = `<script type="module" src="src/main.js?v=${v['src/main.js']}"></script>`;
  return (MAP.test(html) ? html.replace(MAP, map) : html.replace(ENTRY, m => map + m)).replace(ENTRY, entry);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = join(ROOT, 'index.html'), now = readFileSync(path, 'utf8'), next = stamped();
  if (now === next) console.log('index.html is up to date');
  else { writeFileSync(path, next); console.log('index.html stamped'); }
}
