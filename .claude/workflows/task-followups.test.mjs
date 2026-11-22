// Run: node --test .claude/workflows/task-followups.test.mjs
// T1-18: the review follow-ups step fixes small findings in the same pull request and sends what it leaves to tasks/backlog.jsonl.
// Whole-flow tests run task.js with a fake agent that answers by label (task id removed). No command, git or network call runs there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const src = readFileSync(join(here, 'task.js'), 'utf8');
const readRepo = (path) => readFileSync(join(repoRoot, path), 'utf8');

const blockOf = (name) => {
  const part = src.split(`// ${name}-BEGIN`)[1];
  assert.ok(part, `task.js has a // ${name}-BEGIN ... // ${name}-END block`);
  return part.split('\n').slice(1).join('\n').split(`// ${name}-END`)[0];
};
const loadLeft = () => {
  const body = blockOf('LEFT');
  const out = new Function(`${body}; return { REAL_TV_GATES, planLeft };`)();
  assert.equal(typeof out.planLeft, 'function', 'the LEFT block defines planLeft');
  return out;
};

const relay = (json, exitCode = 0) => ({ exitCode, output: JSON.stringify(json) });
const redJson = () => ({ task: 'T9-01', expect: 'red', red: [1], green: [], gates: [], blobs: {}, problems: [] });
const greenJson = () => ({ task: 'T9-01', expect: 'green', red: [], green: [1, 2], gates: [], blobs: {}, problems: [] });
const flowJson = () => ({ ok: true, commits: 2, manifests: [], changes: [], frozen: [], taskListChanged: false, missingManifest: false, problems: [] });
const work = (extra = {}) => ({ done: true, checksPassed: true, summary: 'ok', evidence: 'commit abc1234 and PR #1', failures: [], blockers: [], ciSteps: [], ciOnly: [], ...extra });
const flat = (detail) => [].concat(detail === undefined ? '' : detail).join('\n');

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
  'fix CI': work(),
  review: { findings: [], filesChanged: ['.claude/workflows/task.js'], needsGuardian: false },
  ship: { merged: true, prUrl: 'https://example.invalid/pr/1' },
  'fixtures down': relay({ stopped: [], problems: [] }),
});

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
  return { result, calls, logs, keys: calls.map((call) => call.key) };
}
const final = (flow) => [...flow.result.merged, ...flow.result.parked, ...flow.result.needsAttention][0];
const promptOf = (flow, key, nth = 0) => flow.calls.filter((call) => call.key === key)[nth]?.prompt;
const count = (flow, key) => flow.keys.filter((k) => k === key).length;
const FROM_IMPLEMENT = { task: 'T9-01', from: 'implement' };

const finding = (severity, extra = {}) => ({ severity, where: `src/${severity}.ts:1`, summary: `SUMMARY-${severity}`, ...extra });
const review = (...findings) => ({ findings, filesChanged: ['.claude/workflows/task.js'], needsGuardian: false });
const leftLow = (extra = {}) => ({ severity: 'low', where: 'src/low.ts:1', summary: 'SUMMARY-low', realTvGate: 'none', ...extra });
const ALL_SEVERITIES = review(finding('critical'), finding('high'), finding('medium'), finding('low'));

// ---------------------------------------------------------------- item 1

test('T1-18 item 1: the follow-ups prompt holds every finding, asks to fix small lows, and no longer says to log them', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, { review: ALL_SEVERITIES });
  const prompt = promptOf(flow, 'follow-ups');
  for (const severity of ['critical', 'high', 'medium', 'low']) assert.ok(prompt.includes(`SUMMARY-${severity}`), `the prompt holds the ${severity} finding`);
  assert.match(prompt, /small/);
  assert.doesNotMatch(prompt, /Log these low findings/);
  assert.doesNotMatch(prompt, /do not fix them/);
  assert.doesNotMatch(prompt, /follow-ups in the active plan/);
  assert.ok(prompt.includes('Fix these review findings'), 'the frozen anchor stays');
});

test('T1-18 item 1: a follow-up that leaves a medium finding ends blocked naming it, and ship is never called', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    review: review(finding('medium')),
    'follow-ups': work({ leftFindings: [{ severity: 'medium', where: 'src/m.ts:9', summary: 'LEFT-MEDIUM-TEXT', realTvGate: 'none' }] }),
  });
  assert.equal(final(flow).outcome, 'blocked');
  assert.match(JSON.stringify(final(flow).detail), /LEFT-MEDIUM-TEXT/);
  assert.equal(count(flow, 'ship'), 0);
});

test('T1-18 item 1: a follow-up with no leftFindings ends merged with left: []', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, { review: ALL_SEVERITIES });
  assert.equal(final(flow).outcome, 'merged');
  assert.deepEqual(final(flow).left, []);
});

test('T1-18 item 1: planLeft puts critical, high and medium in unfixed and keeps lows out of it', () => {
  const { planLeft } = loadLeft();
  const left = ['critical', 'high', 'medium', 'low'].map((severity) => ({ severity, where: `w-${severity}`, summary: `s-${severity}`, realTvGate: 'none' }));
  const plan = planLeft(left);
  assert.equal(plan.unfixed.length, 3);
  const text = JSON.stringify(plan.unfixed);
  for (const severity of ['critical', 'high', 'medium']) assert.ok(text.includes(`s-${severity}`), `${severity} is unfixed`);
  assert.ok(!text.includes('s-low'), 'a low is not unfixed');
  assert.equal(plan.left.length, 4);
  assert.deepEqual(plan.problems, []);
  assert.deepEqual(planLeft(undefined).left, []);
  assert.deepEqual(planLeft(undefined).unfixed, []);
});

// ---------------------------------------------------------------- item 2

test('T1-18 item 2: the follow-ups prompt sends a left low to tasks/backlog.jsonl with its severity, source and the hardening task', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, { review: review(finding('low')) });
  const prompt = promptOf(flow, 'follow-ups');
  assert.match(prompt, /tasks\/backlog\.jsonl/);
  assert.match(prompt, /severity/);
  assert.match(prompt, /hardening task/);
  assert.match(prompt, /source/);
  assert.ok(prompt.includes('"T9-01"'), 'the source is the task id');
  assert.match(prompt, /never .*task of its own/i);
  assert.match(prompt, /tasks\/prd\.json/);
  assert.doesNotMatch(prompt, /follow-ups in the active plan/);
});

test('T1-18 item 2: a left low ends merged and the result carries it in left', async () => {
  const left = [leftLow()];
  const flow = await runFlow(FROM_IMPLEMENT, { review: review(finding('low')), 'follow-ups': work({ leftFindings: left }) });
  assert.equal(final(flow).outcome, 'merged');
  assert.deepEqual(final(flow).left, left);
  assert.equal('lowsLogged' in final(flow), false);
});

test('T1-18 item 2: the ship prompt says what is left in tasks/backlog.jsonl, not "low logged in the plan"', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, { review: review(finding('low')), 'follow-ups': work({ leftFindings: [leftLow()] }) });
  const prompt = promptOf(flow, 'ship');
  assert.doesNotMatch(prompt, /low logged in the plan/);
  assert.match(prompt, /left in tasks\/backlog\.jsonl/);
});

test('T1-18 item 2: the Review phase detail no longer says to log lows', () => {
  const meta = new Function(`${src.split('export const meta')[1].split('\n};')[0]}\n};return meta;`.replace(/^\s*=/, 'const meta ='))();
  const review = meta.phases.find((phase) => phase.title === 'Review');
  assert.ok(review, 'there is a Review phase');
  assert.doesNotMatch(flat(review.detail), /log lows/);
  assert.match(flat(review.detail), /send what is left to the backlog/);
});

test('T1-18 item 2: a from ship resume still gets "Review: done in an earlier run."', async () => {
  const flow = await runFlow({ task: 'T9-01', from: 'ship' });
  assert.match(promptOf(flow, 'ship'), /Review: done in an earlier run\./);
  assert.deepEqual(final(flow).left, []);
});

// ---------------------------------------------------------------- item 3

for (const kind of ['home-network', 'local-information']) {
  test(`T1-18 item 3: a left ${kind} finding reaches realTvGates with holds, and a none finding does not`, async () => {
    const gating = leftLow({ where: `src/gate-${kind}.ts:3`, summary: `GATE-${kind}`, realTvGate: kind });
    const flow = await runFlow(FROM_IMPLEMENT, {
      review: review(finding('low'), finding('low', { where: 'src/other.ts:2', summary: 'OTHER' })),
      'follow-ups': work({ leftFindings: [gating, leftLow({ where: 'src/other.ts:2', summary: 'OTHER' })] }),
    });
    assert.equal(final(flow).outcome, 'merged');
    const gates = final(flow).realTvGates;
    assert.equal(gates.length, 1);
    assert.equal(gates[0].holds, kind);
    assert.equal(gates[0].where, gating.where);
    assert.equal(gates[0].summary, gating.summary);
    assert.equal(gates[0].severity, 'low');
    assert.ok(flow.logs.some((line) => line.includes('real-TV gate') && line.includes(kind) && line.includes(gating.where)), 'the gate is logged');
    const ship = promptOf(flow, 'ship');
    assert.ok(ship.includes(gating.where), 'the ship prompt names the gate');
    assert.match(ship, /real-TV gate/);
  });
}

test('T1-18 item 3: a ship that fails CI twice ends ci-red and still carries the gates', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    review: review(finding('low')),
    'follow-ups': work({ leftFindings: [leftLow({ realTvGate: 'home-network' })] }),
    ship: { merged: false, ciFailures: ['x'] },
  });
  assert.equal(final(flow).outcome, 'ci-red');
  assert.equal(final(flow).realTvGates.length, 1);
  assert.equal(final(flow).realTvGates[0].holds, 'home-network');
});

test('T1-18 item 3: an unknown realTvGate value ends blocked and is never dropped', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    review: review(finding('low')),
    'follow-ups': work({ leftFindings: [leftLow({ realTvGate: 'maybe' })] }),
  });
  assert.equal(final(flow).outcome, 'blocked');
  assert.match(flat(final(flow).detail), /maybe/);
  assert.equal(count(flow, 'ship'), 0);
});

test('T1-18 item 3: the follow-ups prompt names both conditions and the never-quote rule', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, { review: review(finding('low')) });
  const prompt = promptOf(flow, 'follow-ups');
  for (const re of [/home network/, /LAN address/, /serial/, /hostname/, /credential/, /never quote/i]) assert.match(prompt, re);
});

test('T1-18 item 3: planLeft maps the two kinds to gates, leaves out none and a missing value, and reports an unknown value', () => {
  const { planLeft, REAL_TV_GATES } = loadLeft();
  assert.deepEqual(REAL_TV_GATES, ['home-network', 'local-information']);
  const plan = planLeft([
    { severity: 'low', where: 'a', summary: 'sa', realTvGate: 'home-network' },
    { severity: 'low', where: 'b', summary: 'sb', realTvGate: 'local-information' },
    { severity: 'low', where: 'c', summary: 'sc', realTvGate: 'none' },
    { severity: 'low', where: 'd', summary: 'sd' },
  ]);
  assert.deepEqual(plan.gates, [
    { severity: 'low', where: 'a', summary: 'sa', holds: 'home-network' },
    { severity: 'low', where: 'b', summary: 'sb', holds: 'local-information' },
  ]);
  assert.deepEqual(plan.problems, []);
  const bad = planLeft([{ severity: 'low', where: 'e', summary: 'se', realTvGate: 'maybe' }]);
  assert.equal(bad.problems.length, 1);
  assert.match(bad.problems[0], /maybe/);
  assert.deepEqual(bad.gates, []);
});

// ---------------------------------------------------------------- item 4

test('T1-18 item 4: the follow-ups prompt carries each point of WORKFLOW.md section 2c, in its wording', async () => {
  const doc = readRepo('WORKFLOW.md');
  const section = doc.split('**Review follow-ups**')[1];
  assert.ok(section, 'WORKFLOW.md has the Review follow-ups rule');
  const rule = section.split('\n\n').slice(0, 2).join('\n\n');
  const phrases = ['same pull request', 'tasks/backlog.jsonl', 'hardening task per phase', 'home network', 'a LAN address, a serial, a hostname, a credential'];
  const flow = await runFlow(FROM_IMPLEMENT, { review: ALL_SEVERITIES });
  const prompt = promptOf(flow, 'follow-ups');
  for (const phrase of phrases) {
    assert.ok(rule.includes(phrase), `WORKFLOW.md states: ${phrase}`);
    assert.ok(prompt.includes(phrase), `the follow-ups prompt contains: ${phrase}`);
  }
});

test('T1-18 item 4: the stale "log lows" text is gone from WORKFLOW.md step 6, AGENTS.md and the change-review skill', () => {
  const step6 = readRepo('WORKFLOW.md').split('\n').find((line) => line.startsWith('6. **Review.**'));
  assert.ok(step6, 'WORKFLOW.md has task-flow step 6');
  assert.doesNotMatch(step6, /fixes and logs/);
  assert.doesNotMatch(readRepo('AGENTS.md'), /log lows in the plan/);
  assert.doesNotMatch(readRepo('.claude/skills/change-review/SKILL.md'), /log low findings in the plan/);
});
