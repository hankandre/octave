// Run: node --test .claude/workflows/task-followups-accounting.test.mjs
// T1-18 review follow-up: the run counts the lows the review returned against the lows fixed or left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'task.js'), 'utf8');
const body = src.split('// LEFT-BEGIN')[1].split('\n').slice(1).join('\n').split('// LEFT-END')[0];
const { unaccountedLows } = new Function(`${body}; return { unaccountedLows };`)();

const low = { severity: 'low', where: 'a.ts:1', summary: 's' };
test('unaccountedLows counts lows neither fixed nor left', () => {
  assert.equal(unaccountedLows(2, {}), 2);
  assert.equal(unaccountedLows(2, { leftFindings: [low] }), 1);
  assert.equal(unaccountedLows(2, { fixedFindings: [low], leftFindings: [low] }), 0);
  assert.equal(unaccountedLows(0, { leftFindings: [low] }), 0);
  assert.equal(unaccountedLows(1, { leftFindings: [{ ...low, severity: 'medium' }] }), 1);
  assert.equal(unaccountedLows(1, undefined), 1);
});

test('the follow-ups prompt asks for fixedFindings and the schema accepts them', () => {
  assert.match(src, /fixedFindings: \{/);
  assert.match(src, /Return in fixedFindings each low you fixed/);
});
