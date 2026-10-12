// Cache busting: index.html must carry the hashes of the modules as they are now (run `npm run stamp`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stamped } from '../tools/stamp.mjs';

test('index.html carries the current module hashes (else: npm run stamp)', () => {
  assert.ok(readFileSync(new URL('../index.html', import.meta.url), 'utf8') === stamped(), 'index.html is out of date: run `npm run stamp`');
});
