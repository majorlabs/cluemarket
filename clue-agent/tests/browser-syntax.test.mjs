// Every script the browser loads must at least parse. One stray character in app.js stops the whole site, and the
// linter skips public/, so this check runs with the tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const dir = new URL('../public/', import.meta.url);
for (const f of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  test(`public/${f} parses`, () => {
    const path = new URL(f, dir).pathname;
    try { execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' }); }
    catch (e) { assert.fail(String(e.stderr || e.message).split('\n').slice(0, 4).join('\n')); }
    assert.ok(readFileSync(path).length > 0);
  });
}
