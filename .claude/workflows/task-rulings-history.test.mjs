// Run: node --test .claude/workflows/task-rulings-history.test.mjs
// T1-16 review follow-up: a logCommit from an earlier run is not the log entry of a new ruling.
// Whole-flow tests run task.js with a fake agent that answers by label (task id removed). No command, git or network call runs there.
// The script tests run ruling-log.mjs against a temporary git repository. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const src = readFileSync(join(here, 'task.js'), 'utf8');
const readRepo = (path) => readFileSync(join(repoRoot, path), 'utf8');
const workflowDoc = readRepo('WORKFLOW.md');
const RULING_LOG = join(here, 'ruling-log.mjs');

// Blocks are loaded lazily and guarded, so a missing block fails the test that needs it, with a clear message.
const blockOf = (name) => {
  const part = src.split(`// ${name}-BEGIN`)[1];
  assert.ok(part, `task.js has a // ${name}-BEGIN ... // ${name}-END block`);
  return part.split('\n').slice(1).join('\n').split(`// ${name}-END`)[0];
};
const loadRuling = () => {
  const body = blockOf('RULING');
  const out = new Function(`${body}; return { OWNER_KINDS, PO_KINDS, MAX_RULINGS, ruleKey, describeQuestion, planRuling };`)();
  return out;
};
const loadDecideStep = () => new Function(`${blockOf('STEP')}; return { decideStep };`)().decideStep;
const loadGate = () => {
  const out = new Function(
    `${blockOf('GATE')}; return { decideRulingLog: typeof decideRulingLog === 'undefined' ? undefined : decideRulingLog, RULING_UNLOGGED: typeof RULING_UNLOGGED === 'undefined' ? undefined : RULING_UNLOGGED, STOP_OUTCOMES };`,
  )();
  assert.equal(typeof out.decideRulingLog, 'function', 'the GATE block defines decideRulingLog');
  return out;
};

const relay = (json, exitCode = 0) => ({ exitCode, output: JSON.stringify(json) });
const redJson = () => ({ task: 'T9-01', expect: 'red', red: [1], green: [], gates: [], blobs: {}, problems: [] });
const greenJson = () => ({ task: 'T9-01', expect: 'green', red: [], green: [1, 2], gates: [], blobs: {}, problems: [] });
const flowJson = () => ({ ok: true, commits: 2, manifests: [], changes: [], frozen: [], taskListChanged: false, missingManifest: false, problems: [] });
const work = (extra = {}) => ({ done: true, checksPassed: true, summary: 'ok', evidence: 'commit abc1234 and PR #1', failures: [], blockers: [], ciSteps: [], ciOnly: [], ...extra });
const flat = (detail) => [].concat(detail === undefined ? '' : detail).join('\n');

const question = (extra = {}) => ({ kind: 'technical', rule: 'AGENTS.md:Tasks', question: 'QUESTION-TEXT', ...extra });
const asks = (...questions) => work({ done: false, checksPassed: false, failures: ['stopped at a question'], productOwnerQuestions: questions });
const frozenProblems = (...problems) => work({ done: false, checksPassed: false, failures: ['frozen test looks wrong'], frozenTestProblems: problems });
const answer = (rule, ruling, probe) => ({ rule, ruling, probe: probe || { what: '', found: '' } });
const ruled = (n, answers, extra = {}) => ({ rulings: answers.map((a) => a.ruling), changed: [], answers, logCommit: `abc${n}234`, ...extra });
const logOk = () => relay({ ok: true, commit: 'abc1234', heading: '## 2026-11-22, T9-01 ruling, Implement', problems: [] });

const defaults = () => ({
  spec: { summary: 'spec', openQuestions: [], touchesNative: false },
  sync: relay({ ok: true, rebased: false, problems: [] }),
  check: { approved: true, issues: [], touchesNative: false },
  revise: { summary: 'revised', openQuestions: [], touchesNative: false },
  tests: { done: true, summary: 'ok' },
  'red gate': relay(redJson()),
  'frozen gate': relay(flowJson()),
  'green gate': relay(greenJson()),
  implement: work(),
  'follow-ups': work(),
  review: { findings: [], filesChanged: ['.claude/workflows/task.js'], needsGuardian: false },
  ship: { merged: true, prUrl: 'https://example.invalid/pr/1' },
  'fixtures down': relay({ stopped: [], problems: [] }),
  'owner ruling': (n) => ruled(n, [answer('AGENTS.md:Tasks', `RULING-${n}`)]),
  'ruling log': logOk(),
});

// Runs task.js whole. answers override the defaults by label with the task id removed; a function answer gets the call number for that label and the prompt.
async function runFlow(args, answers = {}) {
  const text = src.replace('export const meta', 'const meta');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('args', 'agent', 'log', text);
  const table = { ...defaults(), ...answers };
  const calls = [];
  const logs = [];
  const seen = {};
  const agent = async (prompt, opts) => {
    const key = String(opts.label).replace(/ T\d+-\d{2}/, '');
    calls.push({ label: opts.label, key, prompt, phase: opts.phase });
    seen[key] = (seen[key] || 0) + 1;
    if (!(key in table)) return null;
    const out = table[key];
    return typeof out === 'function' ? out(seen[key], prompt) : out;
  };
  const result = await run({ root: '/r', ...args }, agent, (line) => logs.push(String(line)));
  return { result, calls, logs, keys: calls.map((call) => call.key), labels: calls.map((call) => call.label) };
}
const final = (flow) => [...flow.result.merged, ...flow.result.parked, ...flow.result.needsAttention][0];
const promptOf = (flow, key, nth = 0) => flow.calls.filter((call) => call.key === key)[nth]?.prompt;
const count = (flow, key) => flow.keys.filter((k) => k === key).length;
const FROM_IMPLEMENT = { task: 'T9-01', from: 'implement' };

const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv }).trim();
const dirs = [];
process.on('exit', () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const LOG_HEADER = '# Product Owner log\n\nOne dated section per pass.\n';
const tempRepo = (branch = 'task/T9-01') => {
  const dir = mkdtempSync(join(tmpdir(), 'ruling-log-'));
  dirs.push(dir);
  execFileSync('git', ['init', '-q', '-b', branch, dir]);
  mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'tasks', 'product-owner-log.md'), LOG_HEADER);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
};
const appendLog = (dir, text, message = 'log') => {
  writeFileSync(join(dir, 'tasks', 'product-owner-log.md'), `${readFileSync(join(dir, 'tasks', 'product-owner-log.md'), 'utf8')}\n${text}\n`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
};
const SECTION = '## 2026-11-22, T9-01 ruling, Implement\n- q: AGENTS.md:Tasks: ruled, because.';

const RULING_HISTORY_KEY = 'ruling history';
const histJson = (commits) => relay({ ok: true, sections: commits.length, counts: {}, firstRulings: {}, commits, problems: [] });
const FULL = 'abc1234' + 'f'.repeat(33);

test('review follow-up: a logCommit that an earlier run already logged ends ruling-unlogged with no ruling log call', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: asks(question()),
    [RULING_HISTORY_KEY]: histJson([FULL]),
    'owner ruling': (n) => ruled(n, [answer('AGENTS.md:Tasks', 'RULING')], { logCommit: 'abc1234' }),
  });
  assert.equal(final(flow).outcome, 'ruling-unlogged', JSON.stringify(flow.result));
  assert.equal(count(flow, 'ruling log'), 0);
});

test('review follow-up: a logCommit not in the earlier history still passes', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: (n) => (n === 1 ? asks(question()) : work()),
    [RULING_HISTORY_KEY]: histJson(['1111111' + '2'.repeat(33)]),
  });
  assert.equal(count(flow, 'ruling log'), 1, flow.labels.join(' | '));
});

test('review follow-up: ruling-log.mjs --history lists the commits that added this task\'s sections only', () => {
  const dir = tempRepo();
  const mine = appendLog(dir, SECTION);
  appendLog(dir, '## 2026-11-22, T9-02 ruling, Implement\n- q: r: ruled.');
  const out = spawnSync(process.execPath, [RULING_LOG, '--repo', dir, '--task', 'T9-01', '--history'], { encoding: 'utf8', env: gitEnv });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout.trim().split('\n').pop()).commits, [mine]);
});
