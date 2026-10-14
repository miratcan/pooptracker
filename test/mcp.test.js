// The MCP server runs outside the tab, so nothing else loads it: a syntax error there would only show when someone starts it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('the MCP server parses', () => {
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', fileURLToPath(new URL('../mcp/server.mjs', import.meta.url))], { stdio: 'pipe' }));
});
