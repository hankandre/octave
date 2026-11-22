// Run: node --test .claude/workflows/task-rulings-resume.test.mjs
// T1-16 spec-check notes: a resumed run keeps counting a task's rulings (seeded from tasks/product-owner-log.md), and the guarded prompts point at the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'task.js'), 'utf8');
const RULING_LOG = join(here, 'ruling-log.mjs');
const relay = (json, exitCode = 0) => ({ exitCode, output: JSON.stringify(json) });
const work = (extra = {}) => ({ done: true, checksPassed: true, summary: 'ok', evidence: 'commit abc1234 and PR #1', failures: [], blockers: [], ciSteps: [], ciOnly: [], ...extra });
const asks = (rule, text = 'QUESTION') => work({ done: false, checksPassed: false, failures: ['stopped'], productOwnerQuestions: [{ kind: 'technical', rule, question: text }] });
const answer = (rule, ruling, probe = { what: '', found: '' }) => ({ rule, ruling, probe });
const ruled = (n, answers) => ({ rulings: answers.map((a) => a.ruling), changed: [], answers, logCommit: `abc${n}234` });
const history = (sections, counts, firstRulings) => relay({ ok: true, sections, counts, firstRulings, problems: [] });
const flat = (detail) => [].concat(detail === undefined ? '' : detail).join('\n');

const defaults = () => ({
  sync: relay({ ok: true, rebased: false, problems: [] }),
  'frozen gate': relay({ ok: true, commits: 2, manifests: [], changes: [], frozen: [], taskListChanged: false, missingManifest: false, problems: [] }),
  'green gate': relay({ task: 'T9-01', expect: 'green', red: [], green: [1], gates: [], blobs: {}, problems: [] }),
  implement: work(),
  'implement (after ruling)': work(),
  'follow-ups': work(),
  review: { findings: [], filesChanged: ['x.js'], needsGuardian: false },
  ship: { merged: true, prUrl: 'https://example.invalid/pr/1' },
  'fixtures down': relay({ stopped: [], problems: [] }),
  'ruling log': relay({ ok: true, commit: 'abc1234', heading: '## 2026-11-22, T9-01 ruling, Implement', problems: [] }),
});

async function runFlow(args, answers = {}) {
  const text = src.replace('export const meta', 'const meta');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('args', 'agent', 'log', text);
  const table = { ...defaults(), ...answers };
  const calls = [];
  const seen = {};
  const agent = async (prompt, opts) => {
    const key = String(opts.label).replace(/ T\d+-\d{2}/, '');
    calls.push({ key, prompt, label: opts.label });
    seen[key] = (seen[key] || 0) + 1;
    if (!(key in table)) return null;
    const out = table[key];
    return typeof out === 'function' ? out(seen[key], prompt) : out;
  };
  const result = await run({ root: '/r', task: 'T9-01', from: 'implement', ...args }, agent, () => {});
  return { result, calls, keys: calls.map((call) => call.key) };
}
const final = (flow) => [...flow.result.merged, ...flow.result.parked, ...flow.result.needsAttention][0];
const rule = 'AGENTS.md:Tasks';

test('T1-16 resume: the first ruling of a resumed run reads the task history through ruling-log.mjs --history', async () => {
  const flow = await runFlow({}, { implement: asks(rule), 'ruling history': history(0, {}, {}), 'owner ruling': (n) => ruled(n, [answer(rule, 'R1')]) });
  const call = flow.calls.find((c) => c.key === 'ruling history');
  assert.ok(call, flow.keys.join(' | '));
  assert.ok(call.prompt.includes('/r/octave/.claude/workflows/ruling-log.mjs --repo /r/octave-T9-01 --task T9-01 --history'));
  assert.ok(flow.keys.indexOf('ruling history') < flow.keys.indexOf('owner ruling'));
  assert.equal(flow.keys.filter((k) => k === 'ruling history').length, 1);
});

test('T1-16 resume: a rule ruled once in an earlier run gets the probe sentence and the earlier ruling', async () => {
  const flow = await runFlow({}, {
    implement: (n) => (n === 1 ? asks(rule) : work()),
    'ruling history': history(1, { 'agents.md:tasks': 1 }, { 'agents.md:tasks': 'EARLIER-RULING' }),
    'owner ruling': (n) => ruled(n, [answer(rule, 'R2', { what: 'read it', found: 'QUOTE' })]),
  });
  const prompt = flow.calls.find((c) => c.key === 'owner ruling').prompt;
  assert.ok(prompt.includes('Before you rule, probe the fact'));
  assert.ok(prompt.includes('EARLIER-RULING'));
  assert.equal(final(flow).outcome, 'merged', JSON.stringify(flow.result));
});

test('T1-16 resume: a rule already ruled twice in earlier runs blocks the task with its question, and the step is not called', async () => {
  const flow = await runFlow({}, { implement: asks(rule, 'QUESTION-THIRD'), 'ruling history': history(2, { 'agents.md:tasks': 2 }, { 'agents.md:tasks': 'R' }) });
  assert.equal(final(flow).outcome, 'blocked');
  assert.match(flat(final(flow).detail), /QUESTION-THIRD/);
  assert.equal(flow.keys.filter((k) => k === 'owner ruling').length, 0);
});

test('T1-16 resume: the cap counts the sections of earlier runs', async () => {
  const flow = await runFlow({}, { implement: asks('new rule', 'QUESTION-CAP'), 'ruling history': history(6, {}, {}) });
  assert.equal(final(flow).outcome, 'blocked');
  assert.match(flat(final(flow).detail), /more than 6 Product Owner rulings/);
  assert.equal(flow.keys.filter((k) => k === 'owner ruling').length, 0);
});

test('T1-16 resume: an unreadable or missing history leaves the run counting from zero, and a denied history command ends denied', async () => {
  const flow = await runFlow({}, { implement: asks(rule), 'ruling history': { exitCode: 0, output: 'no json' }, 'owner ruling': (n) => ruled(n, [answer(rule, 'R1')]) });
  assert.equal(final(flow).outcome, 'merged', JSON.stringify(flow.result));
  const denied = await runFlow({}, { implement: asks(rule), 'ruling history': { exitCode: 0, output: '', deniedCommands: ['node ruling-log.mjs'] } });
  assert.equal(final(denied).outcome, 'denied');
});

test('T1-16 resume: every guarded prompt tells the step to read the task\'s sections of the log, and a run lists its rulings for the next prompt', async () => {
  const flow = await runFlow({}, {
    implement: (n) => (n === 1 ? asks(rule) : work()),
    'owner ruling': (n) => ruled(n, [answer(rule, 'LISTED-RULING')]),
  });
  const first = flow.calls.find((c) => c.key === 'implement').prompt;
  assert.match(first, /sections headed "## <date>, T9-01 ruling" of tasks\/product-owner-log\.md/);
  assert.ok(!first.includes('LISTED-RULING'));
  assert.ok(flow.calls.find((c) => c.key === 'follow-ups').prompt.includes('agents.md:tasks: LISTED-RULING'));
});

// ---- ruling-log.mjs --history, against a real temporary repository
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' };
const dirs = [];
process.on('exit', () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const repoWith = (log) => {
  const dir = mkdtempSync(join(tmpdir(), 'ruling-history-'));
  dirs.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'task/T9-01', dir]);
  if (log !== null) {
    mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'tasks', 'product-owner-log.md'), log);
  }
  execFileSync('git', ['-C', dir, 'add', '-A'], { env: gitEnv });
  execFileSync('git', ['-C', dir, 'commit', '-q', '--allow-empty', '-m', 'base'], { env: gitEnv });
  return dir;
};
const history2 = (dir, task = 'T9-01') => {
  const out = spawnSync(process.execPath, [RULING_LOG, '--repo', dir, '--task', task, '--history'], { encoding: 'utf8', env: gitEnv });
  return { status: out.status, json: JSON.parse(out.stdout.trim().split('\n').pop()) };
};
const LOG = `# Product Owner log

## 2026-11-20

- [AGENTS.md:Tasks] a pass line that is not a ruling

## 2026-11-22, T9-01 ruling, Implement

- [AGENTS.md:Tasks.] first ruling | reason: because | probe: none
- [DOMAINS.md:Process] other ruling | reason: x

## 2026-11-22, T9-02 ruling, Implement

- [AGENTS.md:Tasks] another task's ruling

## 2026-11-23, T9-01 ruling, Review

- [agents.md:tasks] second ruling | reason: y | probe: read it
`;

test('T1-16 resume: ruling-log.mjs --history counts this task\'s rulings per rule key, keeps the first ruling and ignores other sections', () => {
  const { status, json } = history2(repoWith(LOG));
  assert.equal(status, 0);
  assert.equal(json.ok, true);
  assert.equal(json.sections, 2);
  assert.deepEqual(json.counts, { 'agents.md:tasks': 2, 'domains.md:process': 1 });
  assert.equal(json.firstRulings['agents.md:tasks'], 'first ruling');
});

test('T1-16 resume: ruling-log.mjs --history reads the committed log, and an absent log gives no rulings', () => {
  const dir = repoWith(LOG);
  writeFileSync(join(dir, 'tasks', 'product-owner-log.md'), `${LOG}\n## 2026-11-24, T9-01 ruling, Review\n\n- [uncommitted] x\n`);
  assert.equal(history2(dir).json.sections, 2);
  const none = history2(repoWith(null));
  assert.equal(none.json.sections, 0);
  assert.deepEqual(none.json.counts, {});
});
