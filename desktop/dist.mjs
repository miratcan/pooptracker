// The app as the desktop shell loads it: index.html, src/ and media/ copied into desktop/dist (nothing is built; the
// app stays as it is in the repository). Run by `tauri dev` and `tauri build` before they start.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url)), DIST = fileURLToPath(new URL('dist', import.meta.url));
rmSync(DIST, { recursive: true, force: true }); mkdirSync(DIST);
for (const p of ['index.html', 'src', 'media']) cpSync(join(ROOT, p), join(DIST, p), { recursive: true });
console.log('desktop/dist: index.html, src/, media/');
