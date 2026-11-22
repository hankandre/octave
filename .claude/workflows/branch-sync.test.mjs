// Run: node --test .claude/workflows/branch-sync.test.mjs
// T1-14 extras that task.test.mjs (frozen) does not cover: a doubly wrapped gate result, a relative --repo, a missing worktree, the gate prompts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'task.js'), 'utf8');
const gateBlock = src.split('// GATE-BEGIN')[1].split('\n').slice(1).join('\n').split('// GATE-END')[0];
const { decideFrozen, decideSync } = new Function(`${gateBlock}; return { decideFrozen, decideSync };`)();
const SYNC = join(here, 'branch-sync.mjs');
const dirs = [];
process.on('exit', () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' };
const sync = (cwd, ...args) => {
  const out = spawnSync(process.execPath, [SYNC, '--no-fetch', ...args], { cwd, encoding: 'utf8', env });
  return { status: out.status, json: JSON.parse(out.stdout.trim().split('\n').pop()), stderr: out.stderr };
};

test('T1-14 extras: a result wrapped twice, and wrapped with an array around it, is still read', () => {
  const flow = { ok: true, commits: 1, manifests: [], changes: [], frozen: [], taskListChanged: false, missingManifest: false, problems: [] };
  for (const output of [JSON.stringify({ result: { stdout: flow } }), JSON.stringify([{ stdout: flow }]), `note {"a":{"b":[{"c":1}]}} then ${JSON.stringify({ out: flow })}`]) {
    assert.equal(decideFrozen({ exitCode: 0, output, deniedCommands: [] }, [], undefined, false).action, 'pass', output);
  }
});

test('T1-14 extras: decideSync blocks a non-zero exit with no problems and a result that is not ok', () => {
  assert.equal(decideSync({ exitCode: 1, output: '{"ok":true,"rebased":false,"problems":[]}' }, false).action, 'blocked');
  assert.equal(decideSync({ exitCode: 0, output: '{"ok":false,"rebased":false,"problems":["ERROR branch: x"]}' }, false).detail, 'ERROR branch: x');
});

test('T1-14 extras: a relative --repo resolves against the current directory, and a missing worktree is reported', () => {
  const base = mkdtempSync(join(tmpdir(), 'sync-'));
  dirs.push(base);
  const repo = join(base, 'octave-T9-01');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  execFileSync('git', ['-C', repo, 'add', '-A'], { env });
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'base'], { env });
  execFileSync('git', ['-C', repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD']);
  const ok = sync(join(base), '--repo', relative(base, repo), '--task', 'T9-01');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.json.rebased, false);
  const missing = sync(base, '--repo', 'octave-gone', '--task', 'T9-01');
  assert.equal(missing.status, 1);
  assert.equal(missing.json.missingWorktree, true);
});

test('T1-14 extras: the sync and teardown gate prompts say the command changes state', () => {
  const sync = src.slice(src.indexOf('const syncGate'), src.indexOf('let pinned'));
  assert.match(sync, /rebases the task branch/);
  assert.match(sync, /deniedCommands/);
  const teardown = src.slice(src.indexOf('const tearDownFixtures'), src.indexOf('const outcomes'));
  assert.match(teardown, /Docker/);
  assert.match(teardown, /Relative paths are relative to the main checkout/);
});
