// Every workflow script must parse as the Workflow tool runs it: a plain-JavaScript async function body with `export` removed from
// `export const meta`. A backtick left inside a template literal (as `lane` was in product-owner.js) breaks the pass only at launch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const dir = new URL('./', import.meta.url);
const scripts = readdirSync(dir).filter((name) => name.endsWith('.js'));

test('the workflow directory holds the scripts the Workflow tool runs', () => {
  assert.ok(scripts.includes('task.js'), 'task.js');
  assert.ok(scripts.includes('product-owner.js'), 'product-owner.js');
});

for (const name of scripts) {
  test(`${name} parses as a workflow script`, () => {
    const source = readFileSync(new URL(name, dir), 'utf8');
    assert.match(source, /^export const meta = \{/m, `${name} starts its metadata with export const meta`);
    const body = source.replace(/^export const meta = /m, 'const meta = ');
    assert.doesNotThrow(() => new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', body), `${name} has a syntax error`);
  });
}
