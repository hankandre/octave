// Run: node --test .claude/workflows/task-escalation.test.mjs
// No routine work routes to Fable (owner, 2026-11-26: docs/specs/decisions-owner-chat-2026-11-26.md §3).
// Whole-flow tests run task.js and product-owner.js with a fake agent that answers by label (task id removed). No command, git or network call runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const relay = (json, exitCode = 0) => ({ exitCode, output: JSON.stringify(json) });
const flowJson = { ok: true, commits: 2, manifests: [], changes: [], frozen: [], taskListChanged: false, missingManifest: false, problems: [] };
const work = (extra = {}) => ({ done: true, checksPassed: true, summary: 'ok', evidence: 'commit abc1234 and PR #1', failures: [], blockers: [], ciSteps: [], ciOnly: [], ...extra });
const notGreen = work({ done: true, checksPassed: false, failures: ['x.test.ts:1'] });

const defaults = () => ({
  sync: relay({ ok: true, rebased: false, problems: [] }),
  'frozen gate': relay(flowJson),
  'green gate': relay({ task: 'T9-01', expect: 'green', red: [], green: [1, 2], gates: [], blobs: {}, problems: [] }),
  implement: work(),
  'follow-ups': work(),
  review: { findings: [], filesChanged: ['.claude/workflows/task.js'], needsGuardian: false },
  guardian: { findings: [], filesChanged: ['.claude/workflows/task.js'] },
  ship: { merged: true, prUrl: 'https://example.invalid/pr/1' },
  'fixtures down': relay({ stopped: [], problems: [] }),
});

async function runScript(file, args, answers) {
  const text = readFileSync(join(here, file), 'utf8').replace('export const meta', 'const meta');
  const run = new AsyncFunction('args', 'agent', 'log', text);
  const calls = [];
  const seen = {};
  const agent = async (prompt, opts) => {
    const key = String(opts.label).replace(/ T\d+-\d{2}/, '');
    calls.push({ label: opts.label, key, model: opts.model, agentType: opts.agentType });
    seen[key] = (seen[key] || 0) + 1;
    if (!(key in answers)) return null;
    const answer = answers[key];
    return typeof answer === 'function' ? answer(seen[key], prompt) : answer;
  };
  const result = await run(args, agent, () => {});
  return { result, calls, keys: calls.map((call) => call.key), models: calls.map((call) => call.model) };
}
const runFlow = (args, answers = {}) => runScript('task.js', { root: '/r', ...args }, { ...defaults(), ...answers });
const detailOf = (flow) => [].concat(flow.result.needsAttention[0].detail).join('\n');

test('a routine step that stays red escalates once to Opus, never to Fable, and blocks naming the owner\'s choice of Fable', async () => {
  const flow = await runFlow({ task: 'T9-01', from: 'implement' }, { implement: notGreen, 'implement (retry)': notGreen, 'implement (opus)': notGreen });
  assert.deepEqual(flow.keys.filter((key) => key.startsWith('implement')), ['implement', 'implement (retry)', 'implement (opus)']);
  assert.ok(!flow.models.includes('fable'), flow.models.join(' | '));
  assert.equal(flow.result.needsAttention[0].outcome, 'blocked');
  assert.match(detailOf(flow), /x\.test\.ts:1/);
  assert.match(detailOf(flow), /owner may choose Fable/);
});

test('a native step already on Opus gets no third Opus attempt and blocks naming the owner\'s choice of Fable', async () => {
  const flow = await runFlow({ task: 'T9-01', from: 'implement', native: true }, { implement: notGreen, 'implement (retry)': notGreen });
  assert.deepEqual(flow.keys.filter((key) => key.startsWith('implement')), ['implement', 'implement (retry)']);
  assert.ok(!flow.models.includes('fable'), flow.models.join(' | '));
  assert.equal(flow.result.needsAttention[0].outcome, 'blocked');
  assert.match(detailOf(flow), /owner may choose Fable/);
});

test('an escalation that turns green carries on with no Fable message', async () => {
  const flow = await runFlow({ task: 'T9-01', from: 'implement' }, { implement: notGreen, 'implement (retry)': notGreen, 'implement (opus)': work() });
  assert.equal(flow.result.merged.length, 1, JSON.stringify(flow.result));
});

test('when the owner chooses Fable for a rerun, the escalation runs on Fable', async () => {
  const flow = await runFlow(
    { task: 'T9-01', from: 'implement', models: { escalate: 'fable' } },
    { implement: notGreen, 'implement (retry)': notGreen, 'implement (fable)': work() },
  );
  assert.ok(flow.keys.includes('implement (fable)'), flow.keys.join(' | '));
  assert.equal(flow.result.merged.length, 1, JSON.stringify(flow.result));
});

test('a high-risk task\'s spec and an inline Product Owner ruling run on Opus', async () => {
  const spec = await runFlow({ task: 'T9-01', risk: 'high' }, { spec: { summary: 's', openQuestions: ['a design call'], touchesNative: false } });
  assert.equal(spec.calls.find((call) => call.key === 'spec').model, 'opus');
  const question = { kind: 'technical', rule: 'AGENTS.md:Tasks', question: 'Q' };
  const ruling = await runFlow({ task: 'T9-01', from: 'implement' }, { implement: work({ done: false, checksPassed: false, productOwnerQuestions: [question] }) });
  const owner = ruling.calls.find((call) => call.key === 'owner ruling');
  assert.equal(owner.agentType, 'product-owner');
  assert.equal(owner.model, 'opus');
});

test('the Product Owner pass runs the product-owner agent on Opus', async () => {
  const flow = await runScript('product-owner.js', {}, { 'product-owner pass': { decisions: [], nothingToDo: true } });
  const pass = flow.calls.find((call) => call.key === 'product-owner pass');
  assert.equal(pass.agentType, 'product-owner');
  assert.equal(pass.model, 'opus');
  assert.deepEqual(flow.result, { outcome: 'nothing-to-do' });
});
