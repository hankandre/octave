// Run: node --test .claude/workflows/task-web-risk.test.mjs
// The web form's token holder, engine and playlist validator live in packages/web-host, so a change there gets a guardian review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'task.js'), 'utf8');
const pathsBlock = src.split('// PATHS-BEGIN')[1].split('\n').slice(1).join('\n').split('// PATHS-END')[0];
const { HIGH_RISK_PATH, NATIVE_PATH } = new Function(`${pathsBlock}; return { HIGH_RISK_PATH, NATIVE_PATH };`)();

test('a change in packages/web-host needs a guardian review and is not native work', () => {
  for (const path of ['packages/web-host/src/session-holder.ts', 'packages/web-host/src/engine/hls-loader.ts', 'packages/web-host/package.json']) {
    assert.ok(HIGH_RISK_PATH.test(path), path);
    assert.ok(!NATIVE_PATH.test(path), path);
  }
});

test('a web screen alone stays routine', () => {
  for (const path of ['apps/web/src/home/home.tsx', 'packages/web-hosting/readme.md']) {
    assert.ok(!HIGH_RISK_PATH.test(path), path);
  }
});
