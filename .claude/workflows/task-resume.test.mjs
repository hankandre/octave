// Run: node --test .claude/workflows/task-resume.test.mjs
// T1-15: resume at Ship, a green gate that reads check-red's JSON, and three gate defects.
// Whole-flow tests run task.js with a fake agent that answers by label (task id removed). No command, git or network call runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'task.js'), 'utf8');
const workflowDoc = readFileSync(join(here, '..', '..', 'WORKFLOW.md'), 'utf8');

const gateBlock = () => src.split('// GATE-BEGIN')[1].split('\n').slice(1).join('\n').split('// GATE-END')[0];
const loadDecideGreen = () => new Function(`${gateBlock()}; return { decideGreen };`)().decideGreen;
const loadModels = () => {
  const block = src.split('// MODELS-BEGIN')[1].split('\n').slice(1).join('\n').split('// MODELS-END')[0];
  return new Function(`${block}; return { MODELS };`)().MODELS;
};

const relay = (json, exitCode = 0) => ({ exitCode, output: JSON.stringify(json) });
const greenJson = (extra = {}) => ({ task: 'T9-01', expect: 'green', red: [], green: [1, 2], gates: [], blobs: {}, problems: [], ...extra });
const flowJson = (extra = {}) => ({ ok: true, commits: 2, manifests: [], changes: [], frozen: [], taskListChanged: false, missingManifest: false, problems: [], ...extra });
const work = (extra = {}) => ({ done: true, checksPassed: true, summary: 'ok', evidence: 'commit abc1234 and PR #1', failures: [], blockers: [], ciSteps: [], ciOnly: [], ...extra });
const flat = (detail) => [].concat(detail === undefined ? '' : detail).join('\n');

const defaults = () => ({
  sync: relay({ ok: true, rebased: false, problems: [] }),
  'frozen gate': relay(flowJson()),
  'green gate': relay(greenJson()),
  implement: work(),
  'follow-ups': work(),
  review: { findings: [], filesChanged: ['.claude/workflows/task.js'], needsGuardian: false },
  ship: { merged: true, prUrl: 'https://example.invalid/pr/1' },
  'fixtures down': relay({ stopped: [], problems: [] }),
});

// Runs task.js whole. answers override the defaults by label with the task id removed; a function answer gets the call number for that label.
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
    const answer = table[key];
    return typeof answer === 'function' ? answer(seen[key], prompt) : answer;
  };
  const result = await run({ root: '/r', ...args }, agent, (line) => logs.push(String(line)));
  return { result, calls, logs, keys: calls.map((call) => call.key), labels: calls.map((call) => call.label) };
}
const attention = (flow) => flow.result.needsAttention[0];
const shipPrompt = (flow) => flow.calls.find((call) => call.label === 'ship T9-01').prompt;
const SKIPPED = ['spec', 'check', 'tests', 'implement', 'review', 'guardian', 'follow-ups'];

test('T1-15 item 1: from ship skips every earlier phase, checks frozen tests then the green gate, then ships', async () => {
  const flow = await runFlow({ task: 'T9-01', from: 'ship' });
  for (const key of SKIPPED) assert.ok(!flow.keys.includes(key), `no ${key} call; got ${flow.labels.join(' | ')}`);
  const frozen = flow.labels.indexOf('frozen gate T9-01');
  const green = flow.labels.indexOf('green gate T9-01');
  const ship = flow.labels.indexOf('ship T9-01');
  assert.ok(frozen >= 0 && green > frozen && ship > green, `order frozen < green < ship; got ${flow.labels.join(' | ')}`);
  assert.equal(flow.result.merged.length, 1);
  assert.equal(flow.result.merged[0].outcome, 'merged');
});

test('T1-15 item 1: from ship with preFlow runs neither the frozen check nor the green gate', async () => {
  const flow = await runFlow({ task: 'T9-01', from: 'ship', preFlow: true });
  assert.ok(flow.keys.includes('ship'), flow.labels.join(' | '));
  assert.ok(!flow.keys.includes('frozen gate'));
  assert.ok(!flow.keys.includes('green gate'));
  assert.equal(flow.result.merged.length, 1);
});

test('T1-15 item 1: from ship stops as frozen-tests when the frozen check fails, with no green gate and no ship', async () => {
  const bad = relay(flowJson({ ok: false, problems: ['ERROR frozen test: a.test.ts differs'] }), 1);
  const flow = await runFlow({ task: 'T9-01', from: 'ship' }, { 'frozen gate': bad });
  assert.equal(attention(flow)?.outcome, 'frozen-tests', JSON.stringify(flow.result));
  assert.ok(!flow.keys.includes('green gate'));
  assert.ok(!flow.keys.includes('ship'));
});

test('T1-15 item 1: from ship is blocked, naming the item, when the green gate has a red item', async () => {
  const flow = await runFlow({ task: 'T9-01', from: 'ship' }, { 'green gate': relay(greenJson({ red: [2], green: [1] }), 1) });
  assert.equal(attention(flow)?.outcome, 'blocked', JSON.stringify(flow.result));
  assert.match(flat(attention(flow).detail), /2/);
  assert.ok(flow.keys.includes('frozen gate'));
  assert.ok(!flow.keys.includes('ship'));
});

test('T1-15 item 1: from ship gives denied, and no ship, when the frozen check is denied', async () => {
  const flow = await runFlow({ task: 'T9-01', from: 'ship' }, { 'frozen gate': { exitCode: 0, output: '', deniedCommands: ['mise exec -- node check-flow.mjs'] } });
  assert.equal(attention(flow)?.outcome, 'denied', JSON.stringify(flow.result));
  assert.ok(!flow.keys.includes('ship'));
});

test('T1-15 item 1: from ship puts evidence and ciSteps in the Ship prompt and never prints undefined', async () => {
  const flow = await runFlow({ task: 'T9-01', from: 'ship', evidence: 'commit abc1234 and the checks', ciSteps: ['step X'] });
  const prompt = shipPrompt(flow);
  assert.match(prompt, /commit abc1234 and the checks/);
  assert.match(prompt, /step X/);
  assert.ok(!prompt.includes('undefined'), 'no undefined in the Ship prompt');
  assert.match(prompt, /Review: done in an earlier run\./);
});

test('T1-15 item 1: a batch does not resume either task at Ship', async () => {
  const flow = await runFlow({ tasks: ['T9-01', 'T9-02'], from: 'ship' });
  for (const key of ['ship', 'frozen gate', 'green gate']) assert.ok(!flow.keys.includes(key), `no ${key} call; got ${flow.labels.join(' | ')}`);
  assert.equal(flow.result.merged.length, 0);
});

test('T1-15 item 1: the args description and WORKFLOW.md name from ship', () => {
  const metaText = src.split('export const meta = ')[1].split('\n};')[0] + '\n}';
  const meta = new Function(`return ${metaText};`)();
  assert.match(meta.whenToUse, /"ship"/);
  const fromLine = src.split('\n').find((line) => /^\/\/\s+from:/.test(line));
  assert.ok(fromLine, 'the // args: comment has a from: line');
  assert.match(fromLine, /"ship"/);
  const section = workflowDoc.split('### Wiring it up in Claude Code')[1].split(/\n#{2,3} /)[0];
  const bullet = section.split(/\n(?=- )/).find((chunk) => chunk.includes('from: "ship"'));
  assert.ok(bullet, 'a bullet on from: "ship"');
  assert.match(bullet, /frozen-test/i);
  assert.match(bullet, /green gate/i);
  assert.match(bullet, /review/i);
  assert.match(bullet, /earlier run/i);
});

test('T1-15 item 2: decideGreen passes a result with nothing red and no problems, whatever the relayed exit code', () => {
  const decideGreen = loadDecideGreen();
  for (const exitCode of [-1, 0, 1, 2, 137]) {
    const out = decideGreen({ exitCode, output: JSON.stringify(greenJson()) });
    assert.equal(out.action, 'pass', `exit code ${exitCode}`);
  }
});

test('T1-15 item 2: decideGreen blocks and names every red item, with no question mark', () => {
  const decideGreen = loadDecideGreen();
  const out = decideGreen(relay(greenJson({ red: [2, 3], green: [1] }), 0));
  assert.equal(out.action, 'blocked');
  assert.match(out.detail, /2/);
  assert.match(out.detail, /3/);
  assert.ok(!out.detail.includes('?'), out.detail);
});

test('T1-15 item 2: decideGreen blocks and names a problem', () => {
  const decideGreen = loadDecideGreen();
  const problem = 'ERROR red: item 1 cannot start (ENOENT): x';
  const out = decideGreen(relay(greenJson({ problems: [problem] }), 0));
  assert.equal(out.action, 'blocked');
  assert.ok(out.detail.includes(problem), out.detail);
});

test('T1-15 item 2: decideGreen retries unreadable output once, then blocks as unreadable', () => {
  const decideGreen = loadDecideGreen();
  const first = decideGreen({ exitCode: 0, output: 'no json here' }, false);
  assert.equal(first.action, 'retry');
  assert.equal(first.unreadable, true);
  const second = decideGreen({ exitCode: 0, output: 'no json here' }, true);
  assert.equal(second.action, 'blocked');
  assert.equal(second.unreadable, true);
  assert.match(second.detail, /no readable result twice/);
});

test('T1-15 item 2: a relayed exit code of -1 with nothing red still ships (the T3-23 case)', async () => {
  const flow = await runFlow({ task: 'T9-01', from: 'ship' }, { 'green gate': relay(greenJson(), -1) });
  assert.equal(flow.result.merged.length, 1, JSON.stringify(flow.result));
  assert.equal(flow.result.merged[0].outcome, 'merged');
});

test('T1-15 item 2: a green gate that returns prose twice is run again, then blocks as unreadable', async () => {
  const prose = { exitCode: 0, output: 'All acceptance items pass, no JSON for you.' };
  const flow = await runFlow({ task: 'T9-01', from: 'ship' }, { 'green gate': prose });
  assert.ok(flow.labels.includes('green gate T9-01'));
  assert.ok(flow.labels.includes('green gate T9-01 (again)'));
  assert.equal(attention(flow)?.outcome, 'blocked', JSON.stringify(flow.result));
  assert.match(flat(attention(flow).detail), /no readable result twice/);
  assert.ok(!flow.keys.includes('ship'));
});

test('T1-15 item 3: after an escalation the implement gate blocks a result that still lists failures', async () => {
  const { escalate } = loadModels();
  const notGreen = work({ done: true, checksPassed: false, failures: ['x.test.ts:1'] });
  const flow = await runFlow(
    { task: 'T9-01', from: 'implement' },
    { implement: notGreen, 'implement (retry)': notGreen, [`implement (${escalate})`]: work({ done: true, checksPassed: true, failures: ['a.test.ts:3'] }) },
  );
  assert.equal(attention(flow)?.outcome, 'blocked', JSON.stringify(flow.result));
  assert.match(flat(attention(flow).detail), /a\.test\.ts:3/);
  assert.ok(!flow.keys.includes('review'), flow.labels.join(' | '));
});

test('T1-15 item 3: a follow-up that blocks with only ciOnly items still says why', async () => {
  const { escalate } = loadModels();
  const only = work({ done: false, checksPassed: false, ciOnly: ['accept CI baselines'] });
  const flow = await runFlow({ task: 'T9-01', from: 'implement' }, { 'follow-ups': only, 'follow-ups (retry)': only, [`follow-ups (${escalate})`]: only });
  assert.equal(attention(flow)?.outcome, 'blocked', JSON.stringify(flow.result));
  const detail = flat(attention(flow).detail);
  assert.ok(detail.trim().length > 0, 'the detail is not empty');
  assert.match(detail, /accept CI baselines/);
  assert.match(detail, /not green/);
});

test('T1-15 item 3: a follow-up with failed checks and no lists names the checks in its reason', async () => {
  const { escalate } = loadModels();
  const bare = work({ done: true, checksPassed: false });
  const flow = await runFlow({ task: 'T9-01', from: 'implement' }, { 'follow-ups': bare, 'follow-ups (retry)': bare, [`follow-ups (${escalate})`]: bare });
  assert.equal(attention(flow)?.outcome, 'blocked', JSON.stringify(flow.result));
  const detail = flat(attention(flow).detail);
  assert.ok(detail.trim().length > 0, 'the detail is not empty');
  assert.match(detail, /check/i);
});

test('T1-15 item 3: ciOnly from a red attempt never reaches Ship, and a green attempt\'s ciOnly does', async () => {
  const red = work({ done: true, checksPassed: false, failures: ['a.test.ts:3'], ciOnly: ['STALE item'] });
  const stale = await runFlow({ task: 'T9-01', from: 'implement' }, { implement: red, 'implement (retry)': work({ ciOnly: [] }) });
  assert.equal(stale.result.merged.length, 1, JSON.stringify(stale.result));
  assert.ok(!shipPrompt(stale).includes('STALE item'), 'STALE item must not reach the Ship prompt');
  const control = await runFlow({ task: 'T9-01', from: 'implement' }, { implement: work({ ciOnly: ['accept CI baselines'] }) });
  assert.equal(control.result.merged.length, 1, JSON.stringify(control.result));
  assert.match(shipPrompt(control), /accept CI baselines/);
});

test('T1-15 item 3: a follow-up handed to Ship keeps its blockers and drops its ciOnly items', async () => {
  const { escalate } = loadModels();
  const handed = work({ done: false, checksPassed: true, blockers: ['needs CI run'], ciOnly: ['DROPPED item'] });
  const flow = await runFlow({ task: 'T9-01', from: 'implement', ciSteps: ['pending'] }, { 'follow-ups': handed, 'follow-ups (retry)': handed, [`follow-ups (${escalate})`]: handed });
  assert.equal(flow.result.merged.length, 1, JSON.stringify(flow.result));
  const prompt = shipPrompt(flow);
  assert.match(prompt, /needs CI run/);
  assert.ok(!prompt.includes('DROPPED item'), 'DROPPED item must not reach the Ship prompt');
});
