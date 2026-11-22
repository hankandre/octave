// Run: node --test .claude/workflows/task-rulings.test.mjs
// T1-16: the inline Product Owner step rules on technical, placement, dependency and scope questions, and every ruling is logged.
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

// ---------------------------------------------------------------- item 1

test('T1-16 item 1: planRuling sends look, wording, direction and unknown kinds to the owner and the four other kinds to the step', () => {
  const { planRuling, describeQuestion, OWNER_KINDS, PO_KINDS } = loadRuling();
  assert.deepEqual(OWNER_KINDS, ['look', 'wording', 'direction']);
  assert.deepEqual(PO_KINDS, ['technical', 'placement', 'dependency', 'scope']);
  const owner = ['look', 'wording', 'direction', 'taste'].map((kind) => ({ kind, rule: 'AGENTS.md:Tasks', question: `q-${kind}` }));
  const po = PO_KINDS.map((kind) => ({ kind, rule: `rule ${kind}`, question: `q-${kind}` }));
  const plan = planRuling([...owner, ...po], {}, {}, 0);
  assert.deepEqual(plan.forOwner, owner.map(describeQuestion));
  assert.deepEqual(plan.block, []);
  assert.deepEqual(plan.ask.map((entry) => entry.kind), PO_KINDS);
});

test('T1-16 item 1: describeQuestion builds "<kind>: <question> (rule: <key>)"', () => {
  const { describeQuestion } = loadRuling();
  assert.equal(describeQuestion({ kind: 'look', question: 'Is it blue?', rule: ' AGENTS.md:Tasks. ' }), 'look: Is it blue? (rule: agents.md:tasks)');
});

test('T1-16 item 1: the Check and guarded prompts name productOwnerQuestions and the seven kinds', async () => {
  const flow = await runFlow({ task: 'T9-01', from: 'check' });
  for (const prompt of [promptOf(flow, 'check'), promptOf(flow, 'implement')]) {
    assert.match(prompt, /productOwnerQuestions/);
    for (const kind of ['technical', 'placement', 'dependency', 'scope', 'look', 'wording', 'direction']) assert.ok(prompt.includes(kind), `the prompt names ${kind}`);
  }
});

test('T1-16 item 1: a Check question gets one owner ruling after check and before tests, and the ruling reaches Tests and Implement', async () => {
  const q = question({ kind: 'placement', rule: 'DOMAINS.md:Process', question: 'QUESTION-CHECK' });
  const flow = await runFlow(
    { task: 'T9-01', from: 'check' },
    { check: { approved: true, issues: [], touchesNative: false, productOwnerQuestions: [q] }, 'owner ruling': (n) => ruled(n, [answer('DOMAINS.md:Process', 'RULING-CHECK')]) },
  );
  const at = (key) => flow.keys.indexOf(key);
  assert.ok(at('check') >= 0 && at('owner ruling') > at('check'), flow.labels.join(' | '));
  assert.ok(at('ruling log') > at('owner ruling') && at('tests') > at('ruling log'), flow.labels.join(' | '));
  assert.equal(count(flow, 'owner ruling'), 1);
  assert.match(promptOf(flow, 'owner ruling'), /QUESTION-CHECK/);
  assert.match(promptOf(flow, 'tests'), /Product Owner ruling \(.*\): RULING-CHECK/);
  assert.match(promptOf(flow, 'implement'), /RULING-CHECK/);
  assert.equal(final(flow).outcome, 'merged', JSON.stringify(flow.result));
});

test('T1-16 item 1: a Check question on a check that is not approved gives the ruling to the revise step', async () => {
  const q = question({ kind: 'scope', rule: 'acceptance 3', question: 'QUESTION-REVISE' });
  const flow = await runFlow(
    { task: 'T9-01', from: 'check' },
    { check: { approved: false, issues: ['[high] something'], touchesNative: false, productOwnerQuestions: [q] }, 'owner ruling': (n) => ruled(n, [answer('acceptance 3', 'RULING-REVISE')]) },
  );
  assert.ok(flow.keys.indexOf('owner ruling') > flow.keys.indexOf('check'), flow.labels.join(' | '));
  assert.ok(flow.keys.indexOf('revise') > flow.keys.indexOf('owner ruling'), flow.labels.join(' | '));
  assert.match(promptOf(flow, 'revise'), /RULING-REVISE/);
});

test('T1-16 item 1: a technical implement question runs implement, owner ruling, ruling log, implement (after ruling), and merges', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: (n) => (n === 1 ? asks(question({ question: 'QUESTION-IMPL' })) : work()),
    'implement (after ruling)': work(),
    'owner ruling': (n) => ruled(n, [answer('AGENTS.md:Tasks', 'RULING-IMPL')]),
  });
  const wanted = flow.keys.filter((key) => /^(implement|owner ruling|ruling log)/.test(key));
  assert.deepEqual(wanted, ['implement', 'owner ruling', 'ruling log', 'implement (after ruling)'], flow.labels.join(' | '));
  assert.match(promptOf(flow, 'owner ruling'), /QUESTION-IMPL/);
  assert.equal(final(flow).outcome, 'merged', JSON.stringify(flow.result));
});

test('T1-16 item 1: a wording question from Implement parks the task with the question, and the owner ruling step is never called', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, { implement: asks(question({ kind: 'wording', question: 'QUESTION-WORDING' })) });
  assert.equal(final(flow).outcome, 'parked', JSON.stringify(flow.result));
  assert.match(flat(final(flow).detail), /QUESTION-WORDING/);
  assert.ok(Array.isArray(final(flow).detail) && final(flow).detail.every((line) => typeof line === 'string'), 'the detail is an array of strings');
  assert.equal(count(flow, 'owner ruling'), 0, flow.labels.join(' | '));
});

test('T1-16 item 1: a look or direction question from Check parks the task before Tests, with no owner ruling', async () => {
  for (const kind of ['look', 'direction']) {
    const flow = await runFlow({ task: 'T9-01', from: 'check' }, { check: { approved: true, issues: [], touchesNative: false, productOwnerQuestions: [question({ kind, question: `QUESTION-${kind}` })] } });
    assert.equal(final(flow).outcome, 'parked', JSON.stringify(flow.result));
    assert.match(flat(final(flow).detail), new RegExp(`QUESTION-${kind}`));
    assert.equal(count(flow, 'owner ruling'), 0);
    assert.equal(count(flow, 'tests'), 0);
  }
});

test('T1-16 item 1: a ruling that returns forOwner parks the task with those questions', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: asks(question()),
    'owner ruling': (n) => ruled(n, [answer('AGENTS.md:Tasks', 'RULING-X')], { forOwner: ['FOR-OWNER-X'] }),
  });
  assert.equal(final(flow).outcome, 'parked', JSON.stringify(flow.result));
  assert.match(flat(final(flow).detail), /FOR-OWNER-X/);
  assert.equal(count(flow, 'implement (after ruling)'), 0);
});

test('T1-16 item 1: a ruling that returns needsPass ends blocked with those questions', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: asks(question()),
    'owner ruling': (n) => ruled(n, [answer('AGENTS.md:Tasks', 'RULING-Y')], { needsPass: ['NEEDS-PASS-Y'] }),
  });
  assert.equal(final(flow).outcome, 'blocked', JSON.stringify(flow.result));
  assert.match(flat(final(flow).detail), /NEEDS-PASS-Y/);
  assert.equal(count(flow, 'implement (after ruling)'), 0);
});

test('T1-16 item 1: a result with frozen-test problems and questions gets one owner ruling whose prompt holds both', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: (n) => (n === 1 ? work({ done: false, checksPassed: false, failures: ['x'], frozenTestProblems: ['FROZEN-PROBLEM-BOTH'], productOwnerQuestions: [question({ question: 'QUESTION-BOTH' })] }) : work()),
    'implement (after ruling)': work(),
    'owner ruling': (n) => ruled(n, [answer('AGENTS.md:Tasks', 'RULING-BOTH')]),
  });
  assert.equal(count(flow, 'owner ruling'), 1, flow.labels.join(' | '));
  assert.match(promptOf(flow, 'owner ruling'), /FROZEN-PROBLEM-BOTH/);
  assert.match(promptOf(flow, 'owner ruling'), /QUESTION-BOTH/);
  assert.equal(final(flow).outcome, 'merged', JSON.stringify(flow.result));
});

// ---------------------------------------------------------------- item 2

test('T1-16 item 2: decideStep gives ask for a question on a result that is not green, and on a green result', () => {
  const decideStep = loadDecideStep();
  const q = question();
  assert.deepEqual(decideStep({ done: false, checksPassed: false, productOwnerQuestions: [q] }, false), { action: 'ask', ciOnly: [] });
  assert.deepEqual(decideStep({ done: true, checksPassed: true, failures: [], blockers: [], ciOnly: ['x'], productOwnerQuestions: [q] }, false), { action: 'ask', ciOnly: [] });
});

test('T1-16 item 2: decideStep keeps the order none, denied, owner, ask', () => {
  const decideStep = loadDecideStep();
  const q = question();
  assert.equal(decideStep({ done: false, checksPassed: false, frozenTestProblems: ['f'], productOwnerQuestions: [q] }, false).action, 'owner');
  assert.equal(decideStep({ done: false, checksPassed: false, productOwnerQuestions: [q] }, true).action, 'denied');
  assert.equal(decideStep(null, false).action, 'none');
  assert.equal(decideStep({ done: false, checksPassed: false, productOwnerQuestions: [] }, false).action, 'retry');
});

test('T1-16 item 2: the first question ends the step with one implement call, no retry and no escalation, then the step reruns with the ruling', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: (n) => (n === 1 ? asks(question({ question: 'QUESTION-ASK' })) : work()),
    'owner ruling': (n) => ruled(n, [answer('AGENTS.md:Tasks', 'RULING-ASK')]),
  });
  const before = flow.keys.slice(0, flow.keys.indexOf('owner ruling'));
  assert.ok(flow.keys.includes('owner ruling'), flow.labels.join(' | '));
  assert.equal(before.filter((key) => key === 'implement').length, 1, flow.labels.join(' | '));
  assert.ok(!flow.keys.includes('implement (retry)'), flow.labels.join(' | '));
  assert.ok(!flow.labels.some((label) => /^implement T9-01 \(fable\)/.test(label)), flow.labels.join(' | '));
  assert.match(promptOf(flow, 'implement (after ruling)'), /The Product Owner ruled:/);
  assert.match(promptOf(flow, 'implement (after ruling)'), /RULING-ASK/);
});

test('T1-16 item 2: the guarded prompt tells the step to stop at the first question and return it in productOwnerQuestions', async () => {
  const flow = await runFlow(FROM_IMPLEMENT);
  assert.ok(promptOf(flow, 'implement').includes('If you need a ruling, stop at the first question, change nothing to work around it, and return it in productOwnerQuestions.'));
});

test('T1-16 item 2: a second round is labelled "(after ruling 2)" and a follow-up step stops at its first question too', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: (n) => (n === 1 ? asks(question({ rule: 'rule-a', question: 'QA' })) : null),
    'implement (after ruling)': asks(question({ rule: 'rule-b', question: 'QB' })),
    'implement (after ruling 2)': work(),
    'owner ruling': (n) => ruled(n, [answer(['rule-a', 'rule-b', 'rule-c'][n - 1], `RULING-${n}`)]),
    'follow-ups': (n) => (n === 1 ? asks(question({ rule: 'rule-c', question: 'QC' })) : work()),
    'follow-ups (after ruling)': work(),
  });
  assert.ok(flow.keys.includes('implement (after ruling 2)'), flow.labels.join(' | '));
  assert.ok(!flow.keys.includes('follow-ups (retry)'), flow.labels.join(' | '));
  assert.ok(flow.keys.includes('follow-ups (after ruling)'), flow.labels.join(' | '));
  assert.equal(final(flow).outcome, 'merged', JSON.stringify(flow.result));
});

// ---------------------------------------------------------------- item 3

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: gitEnv }).trim();
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' };
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
const checkLog = (dir, sha, task = 'T9-01') => {
  const out = spawnSync(process.execPath, [RULING_LOG, '--repo', dir, '--task', task, '--commit', sha], { encoding: 'utf8', env: gitEnv });
  let json;
  try {
    json = JSON.parse(out.stdout.trim().split('\n').pop());
  } catch (error) {
    assert.fail(`ruling-log.mjs printed no JSON line (status ${out.status}): ${out.stdout}${out.stderr}`.slice(0, 600));
  }
  return { status: out.status, json };
};
const SECTION = '## 2026-11-22, T9-01 ruling, Implement\n- q: AGENTS.md:Tasks: ruled, because.';

test('T1-16 item 3: ruling-log.mjs accepts a commit that adds this task\'s ruling section', () => {
  const dir = tempRepo();
  const sha = appendLog(dir, SECTION);
  const { status, json } = checkLog(dir, sha);
  assert.equal(status, 0, JSON.stringify(json));
  assert.equal(json.ok, true);
  assert.deepEqual(json.problems, []);
  assert.match(json.heading, /^## \d{4}-\d{2}-\d{2}, T9-01 ruling/);
  assert.ok(sha.startsWith(json.commit) || json.commit.startsWith(sha), `commit ${json.commit}`);
});

test('T1-16 item 3: ruling-log.mjs names a problem for a commit that does not touch the log', () => {
  const dir = tempRepo();
  writeFileSync(join(dir, 'other.txt'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'other');
  const { status, json } = checkLog(dir, git(dir, 'rev-parse', 'HEAD'));
  assert.notEqual(status, 0);
  assert.equal(json.ok, false);
  assert.match(json.problems.join('; '), /product-owner-log/);
});

test('T1-16 item 3: ruling-log.mjs rejects a heading for another task', () => {
  const dir = tempRepo();
  const sha = appendLog(dir, '## 2026-11-22, T9-02 ruling, Implement\n- q: r: ruled.');
  const { status, json } = checkLog(dir, sha);
  assert.notEqual(status, 0);
  assert.equal(json.ok, false);
  assert.ok(json.problems.length > 0);
  assert.match(json.problems.join('; '), /T9-01|heading|ruling/i);
});

test('T1-16 item 3: ruling-log.mjs rejects a sha that is not on HEAD\'s history', () => {
  const dir = tempRepo();
  git(dir, 'checkout', '-q', '-b', 'side');
  const sha = appendLog(dir, SECTION);
  git(dir, 'checkout', '-q', 'task/T9-01');
  const { status, json } = checkLog(dir, sha);
  assert.notEqual(status, 0);
  assert.equal(json.ok, false);
  assert.match(json.problems.join('; '), /ancestor|history|HEAD/i);
});

test('T1-16 item 3: ruling-log.mjs rejects a log with uncommitted changes', () => {
  const dir = tempRepo();
  const sha = appendLog(dir, SECTION);
  writeFileSync(join(dir, 'tasks', 'product-owner-log.md'), `${readFileSync(join(dir, 'tasks', 'product-owner-log.md'), 'utf8')}\nunsaved\n`);
  const { status, json } = checkLog(dir, sha);
  assert.notEqual(status, 0);
  assert.equal(json.ok, false);
  assert.match(json.problems.join('; '), /uncommitted|dirty|status|not committed|changes/i);
});

test('T1-16 item 3: ruling-log.mjs rejects a sha that does not resolve', () => {
  const dir = tempRepo();
  appendLog(dir, SECTION);
  const { status, json } = checkLog(dir, '0000000000000000000000000000000000000001');
  assert.notEqual(status, 0);
  assert.equal(json.ok, false);
  assert.match(json.problems.join('; '), /resolve|not found|unknown|exist|commit/i);
});

test('T1-16 item 3: ruling-log.mjs rejects a repository that is not on the task branch', () => {
  const dir = tempRepo('somewhere-else');
  const sha = appendLog(dir, SECTION);
  const { status, json } = checkLog(dir, sha);
  assert.notEqual(status, 0);
  assert.equal(json.ok, false);
  assert.match(json.problems.join('; '), /task\/T9-01|branch/i);
});

test('T1-16 item 3: decideRulingLog passes an ok result whatever the relayed exit code', () => {
  const { decideRulingLog } = loadGate();
  for (const exitCode of [-1, 0, 1]) {
    const out = decideRulingLog(relay({ ok: true, commit: 'abc1234', heading: '## 2026-11-22, T9-01 ruling, Implement', problems: [] }, exitCode), false);
    assert.deepEqual(out, { action: 'pass', detail: '', commit: 'abc1234' }, `exit code ${exitCode}`);
  }
});

test('T1-16 item 3: decideRulingLog stops on ok false or on problems, even with exit code 0', () => {
  const { decideRulingLog } = loadGate();
  assert.deepEqual(decideRulingLog(relay({ ok: false, commit: 'abc', heading: '', problems: ['no section', 'dirty'] }, 0), false), { action: 'stop', detail: 'no section; dirty' });
  assert.deepEqual(decideRulingLog(relay({ ok: true, commit: 'abc', heading: '', problems: ['dirty'] }, 0), false), { action: 'stop', detail: 'dirty' });
  assert.deepEqual(decideRulingLog(relay({ ok: false, commit: 'abc', heading: '', problems: [] }, 0), false), { action: 'stop', detail: 'the ruling log check failed' });
});

test('T1-16 item 3: decideRulingLog retries unreadable output once, then stops', () => {
  const { decideRulingLog } = loadGate();
  assert.deepEqual(decideRulingLog({ exitCode: 0, output: 'no json here' }, false), { action: 'retry', unreadable: true, detail: 'the ruling log check gave no readable result' });
  assert.deepEqual(decideRulingLog(null, false).action, 'retry');
  assert.deepEqual(decideRulingLog({ exitCode: 0, output: 'no json here' }, true), { action: 'stop', unreadable: true, detail: 'the ruling log check gave no readable result twice' });
});

test('T1-16 item 3: RULING_UNLOGGED is "ruling-unlogged" and STOP_OUTCOMES stays at three', () => {
  const { RULING_UNLOGGED, STOP_OUTCOMES } = loadGate();
  assert.equal(RULING_UNLOGGED, 'ruling-unlogged');
  assert.deepEqual(STOP_OUTCOMES, ['denied', 'tests-green', 'frozen-tests']);
});

test('T1-16 item 3: every owner ruling, a frozen-only one included, is followed by a ruling log call that names the logCommit, before the step reruns', async () => {
  const cases = {
    'a question ruling': { implement: (n) => (n === 1 ? asks(question()) : work()), 'owner ruling': (n) => ruled(n, [answer('AGENTS.md:Tasks', 'RULING-L')]) },
    'a frozen-only ruling': { implement: (n) => (n === 1 ? frozenProblems('FROZEN-L') : work()), 'owner ruling': (n) => ruled(n, []) },
  };
  for (const [name, answers] of Object.entries(cases)) {
    const flow = await runFlow(FROM_IMPLEMENT, answers);
    const at = (key) => flow.keys.indexOf(key);
    assert.ok(at('owner ruling') >= 0 && at('ruling log') > at('owner ruling') && at('implement (after ruling)') > at('ruling log'), `${name}: ${flow.labels.join(' | ')}`);
    const command = promptOf(flow, 'ruling log');
    assert.ok(command.includes('/r/octave/.claude/workflows/ruling-log.mjs'), command);
    assert.ok(command.includes('--repo /r/octave-T9-01'), command);
    assert.ok(command.includes('--task T9-01'), command);
    assert.ok(command.includes('--commit abc1234'), command);
  }
});

test('T1-16 item 3: the ruling prompt asks for a dated section headed "## <date>, <TASK> ruling, <phase>" in tasks/product-owner-log.md and a logCommit', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, { implement: (n) => (n === 1 ? asks(question()) : work()) });
  const prompt = promptOf(flow, 'owner ruling');
  assert.match(prompt, /tasks\/product-owner-log\.md/);
  assert.match(prompt, /## <date[^>]*>, T9-01 ruling, Implement|T9-01 ruling, /);
  assert.match(prompt, /logCommit/);
});

test('T1-16 item 3: a ruling with an empty or missing logCommit ends ruling-unlogged with no ruling log call', async () => {
  for (const logCommit of ['', undefined]) {
    const flow = await runFlow(FROM_IMPLEMENT, {
      implement: asks(question()),
      'owner ruling': (n) => {
        const out = ruled(n, [answer('AGENTS.md:Tasks', 'RULING-U')]);
        if (logCommit === undefined) delete out.logCommit;
        else out.logCommit = logCommit;
        return out;
      },
    });
    assert.equal(final(flow).outcome, 'ruling-unlogged', JSON.stringify(flow.result));
    assert.equal(count(flow, 'ruling log'), 0, flow.labels.join(' | '));
    assert.equal(count(flow, 'implement (after ruling)'), 0);
  }
});

test('T1-16 item 3: a second ruling that returns the first ruling\'s logCommit ends ruling-unlogged', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: asks(question({ rule: 'rule-a' })),
    'implement (after ruling)': asks(question({ rule: 'rule-b' })),
    'owner ruling': (n) => ruled(n, [answer(n === 1 ? 'rule-a' : 'rule-b', `RULING-${n}`)], { logCommit: 'abc1234' }),
  });
  assert.equal(count(flow, 'owner ruling'), 2, flow.labels.join(' | '));
  assert.equal(final(flow).outcome, 'ruling-unlogged', JSON.stringify(flow.result));
  assert.equal(count(flow, 'implement (after ruling 2)'), 0);
});

test('T1-16 item 3: a ruling log result with ok false ends ruling-unlogged, and a batch stops with the next task not run', async () => {
  const flow = await runFlow(
    { tasks: ['T9-01', 'T9-02'] },
    {
      check: { approved: true, issues: [], touchesNative: false, productOwnerQuestions: [question()] },
      'ruling log': relay({ ok: false, commit: 'abc1234', heading: '', problems: ['no section for T9-01'] }, 1),
    },
  );
  assert.equal(final(flow).outcome, 'ruling-unlogged', JSON.stringify(flow.result));
  assert.deepEqual(flow.result.notRun, ['T9-02']);
  assert.ok(flow.logs.some((line) => /^Stopping:.*ruling-unlogged/.test(line)), flow.logs.join('\n'));
});

test('T1-16 item 3: a denied ruling log command ends denied', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: asks(question()),
    'ruling log': { exitCode: 0, output: '', deniedCommands: ['mise exec -- node ruling-log.mjs'] },
  });
  assert.equal(final(flow).outcome, 'denied', JSON.stringify(flow.result));
});

test('T1-16 item 3: .gitattributes marks tasks/product-owner-log.md merge=union, and a rebase then keeps both appended sections', () => {
  const attributes = readRepo('.gitattributes');
  assert.ok(attributes.split('\n').some((line) => /^tasks\/product-owner-log\.md\s+merge=union\s*$/.test(line)), '.gitattributes has the union line');
  const dir = tempRepo('main');
  writeFileSync(join(dir, '.gitattributes'), attributes);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'attributes');
  git(dir, 'checkout', '-q', '-b', 'task/T9-01');
  appendLog(dir, '## 2026-11-22, T9-01 ruling, Implement\n- from the branch');
  git(dir, 'checkout', '-q', 'main');
  appendLog(dir, '## 2026-11-23\n- from main');
  git(dir, 'checkout', '-q', 'task/T9-01');
  git(dir, 'rebase', 'main');
  const log = readFileSync(join(dir, 'tasks', 'product-owner-log.md'), 'utf8');
  assert.match(log, /from the branch/);
  assert.match(log, /from main/);
});

// ---------------------------------------------------------------- item 4

test('T1-16 item 4: ruleKey trims, lowercases, collapses whitespace and drops trailing punctuation', () => {
  const { ruleKey } = loadRuling();
  assert.equal(ruleKey('  AGENTS.md:Tasks. '), 'agents.md:tasks');
  assert.equal(ruleKey('  AGENTS.md:Tasks. '), ruleKey('agents.md:tasks'));
  assert.equal(ruleKey('Acceptance   3;'), 'acceptance 3');
});

test('T1-16 item 4: planRuling gives a plain ask at count 1, probe with the first ruling at count 2, and block at count 3', () => {
  const { planRuling, describeQuestion, MAX_RULINGS } = loadRuling();
  assert.equal(MAX_RULINGS, 6);
  const q = { kind: 'technical', rule: 'AGENTS.md:Tasks', question: 'q' };
  const one = planRuling([q], {}, {}, 0);
  assert.equal(one.ask.length, 1);
  assert.equal(one.ask[0].key, 'agents.md:tasks');
  assert.equal(one.ask[0].count, 1);
  assert.equal(one.ask[0].probe, false);
  assert.equal(one.ask[0].first, undefined);
  const two = planRuling([q], { 'agents.md:tasks': 1 }, { 'agents.md:tasks': 'r1' }, 1);
  assert.equal(two.ask.length, 1);
  assert.equal(two.ask[0].count, 2);
  assert.equal(two.ask[0].probe, true);
  assert.equal(two.ask[0].first, 'r1');
  assert.deepEqual(two.block, []);
  const three = planRuling([q], { 'agents.md:tasks': 2 }, { 'agents.md:tasks': 'r1' }, 2);
  assert.deepEqual(three.ask, []);
  assert.deepEqual(three.block, [describeQuestion(q)]);
});

test('T1-16 item 4: planRuling blocks every question once the run holds MAX_RULINGS rulings, naming the cap first', () => {
  const { planRuling, describeQuestion } = loadRuling();
  const q = { kind: 'scope', rule: 'new rule', question: 'q' };
  const plan = planRuling([q], {}, {}, 6);
  assert.deepEqual(plan.ask, []);
  assert.deepEqual(plan.block, ['more than 6 Product Owner rulings in one run', describeQuestion(q)]);
  assert.deepEqual(planRuling([{ kind: 'look', rule: 'x', question: 'q' }], {}, {}, 6).block, []);
});

const rule = 'AGENTS.md:Tasks';
test('T1-16 item 4: a second return on the same rule gets the first ruling and the exact probe instruction; a third return blocks with its question', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: asks(question({ rule, question: 'QUESTION-ONE' })),
    'implement (after ruling)': asks(question({ rule: 'agents.md:tasks', question: 'QUESTION-TWO' })),
    'implement (after ruling 2)': asks(question({ rule: 'AGENTS.md:Tasks.', question: 'QUESTION-THREE' })),
    'owner ruling': (n) =>
      n === 1
        ? ruled(1, [answer(rule, 'FIRST-ANSWER')], { rulings: ['a summary line'] })
        : ruled(n, [answer(rule, 'SECOND-ANSWER', { what: 'read AGENTS.md', found: 'QUOTE-FOUND' })]),
  });
  assert.equal(count(flow, 'owner ruling'), 2, flow.labels.join(' | '));
  const first = promptOf(flow, 'owner ruling', 0);
  const second = promptOf(flow, 'owner ruling', 1);
  assert.ok(!first.includes('Before you rule, probe the fact'), 'the first prompt does not ask for a probe');
  assert.ok(second.includes('Before you rule, probe the fact'), 'the second prompt asks for a probe');
  assert.ok(second.includes('FIRST-ANSWER'), 'the second prompt holds the first ruling, taken from answers');
  assert.equal(final(flow).outcome, 'blocked', JSON.stringify(flow.result));
  assert.match(flat(final(flow).detail), /QUESTION-THREE/);
  assert.equal(count(flow, 'implement (after ruling 3)'), 0);
});

test('T1-16 item 4: a probe-marked answer with no probe.found ends blocked, naming the key, and the ruling is not used', async () => {
  for (const probe of [{ what: 'read it', found: '' }, undefined]) {
    const flow = await runFlow(FROM_IMPLEMENT, {
      implement: asks(question({ rule, question: 'QUESTION-ONE' })),
      'implement (after ruling)': asks(question({ rule, question: 'QUESTION-TWO' })),
      'owner ruling': (n) => ruled(n, [n === 1 ? answer(rule, 'FIRST-ANSWER') : { rule, ruling: 'SECOND-ANSWER', ...(probe ? { probe } : {}) }]),
    });
    assert.equal(final(flow).outcome, 'blocked', JSON.stringify(flow.result));
    assert.match(flat(final(flow).detail), /agents\.md:tasks/i);
    assert.equal(count(flow, 'implement (after ruling 2)'), 0, flow.labels.join(' | '));
  }
});

test('T1-16 item 4: an asked key with no matching answer ends blocked, naming the key; an answer matches by ruleKey of its rule', async () => {
  const missing = await runFlow(FROM_IMPLEMENT, {
    implement: asks(question({ rule: 'DOMAINS.md:Process', question: 'QUESTION-MISSING' })),
    'owner ruling': (n) => ruled(n, []),
  });
  assert.equal(final(missing).outcome, 'blocked', JSON.stringify(missing.result));
  assert.match(flat(final(missing).detail), /domains\.md:process/i);
  assert.equal(count(missing, 'implement (after ruling)'), 0);
  const matched = await runFlow(FROM_IMPLEMENT, {
    implement: (n) => (n === 1 ? asks(question({ rule: 'DOMAINS.md:Process', question: 'QUESTION-CASE' })) : work()),
    'implement (after ruling)': work(),
    'owner ruling': (n) => ruled(n, [answer('  domains.md:process. ', 'RULING-CASE')]),
  });
  assert.equal(final(matched).outcome, 'merged', JSON.stringify(matched.result));
  assert.match(promptOf(matched, 'implement (after ruling)'), /RULING-CASE/);
});

test('T1-16 item 4: seven distinct keys end blocked after six rulings', async () => {
  const labels = ['implement', 'implement (after ruling)', ...[2, 3, 4, 5, 6].map((n) => `implement (after ruling ${n})`)];
  const answers = { 'owner ruling': (n) => ruled(n, [answer(`rule-${n}`, `RULING-${n}`)]) };
  labels.forEach((label, i) => {
    answers[label] = asks(question({ rule: `rule-${i + 1}`, question: `Q${i + 1}` }));
  });
  const flow = await runFlow(FROM_IMPLEMENT, answers);
  assert.equal(count(flow, 'owner ruling'), 6, flow.labels.join(' | '));
  assert.equal(final(flow).outcome, 'blocked', JSON.stringify(flow.result));
  assert.match(flat(final(flow).detail), /more than 6 Product Owner rulings/);
  assert.match(flat(final(flow).detail), /Q7/);
});

// ---------------------------------------------------------------- item 5

test('T1-16 item 5: frozen problems, a ruling, then frozen problems again end blocked with one owner ruling call', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: frozenProblems('FROZEN-ONE'),
    'implement (after ruling)': frozenProblems('FROZEN-TWO'),
    'owner ruling': (n) => ruled(n, []),
  });
  assert.equal(count(flow, 'owner ruling'), 1, flow.labels.join(' | '));
  assert.equal(final(flow).outcome, 'blocked', JSON.stringify(flow.result));
  assert.match(flat(final(flow).detail), /FROZEN-TWO/);
});

test('T1-16 item 5: a second report of frozen problems that also holds questions is blocked without calling the step', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: frozenProblems('FROZEN-ONE'),
    'implement (after ruling)': work({ done: false, checksPassed: false, failures: ['x'], frozenTestProblems: ['FROZEN-TWO'], productOwnerQuestions: [question({ question: 'QUESTION-AGAIN' })] }),
    'owner ruling': (n) => ruled(n, []),
  });
  assert.equal(count(flow, 'owner ruling'), 1, flow.labels.join(' | '));
  assert.equal(final(flow).outcome, 'blocked', JSON.stringify(flow.result));
  assert.match(flat(final(flow).detail), /FROZEN-TWO/);
});

test('T1-16 item 5: a question ruling does not use up the frozen ruling', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: asks(question({ question: 'QUESTION-FIRST' })),
    'implement (after ruling)': frozenProblems('FROZEN-LATER'),
    'implement (after ruling 2)': work(),
    'owner ruling': (n) => ruled(n, n === 1 ? [answer('AGENTS.md:Tasks', 'RULING-FIRST')] : []),
  });
  assert.equal(count(flow, 'owner ruling'), 2, flow.labels.join(' | '));
  assert.match(promptOf(flow, 'owner ruling', 1), /FROZEN-LATER/);
  assert.equal(final(flow).outcome, 'merged', JSON.stringify(flow.result));
});

test('T1-16 item 5: every owner ruling prompt forbids touching tasks/prd.json and names needsPass', async () => {
  const flow = await runFlow(FROM_IMPLEMENT, {
    implement: asks(question({ question: 'QUESTION-FIRST' })),
    'implement (after ruling)': frozenProblems('FROZEN-LATER'),
    'implement (after ruling 2)': work(),
    'owner ruling': (n) => ruled(n, n === 1 ? [answer('AGENTS.md:Tasks', 'RULING-FIRST')] : []),
  });
  const prompts = flow.calls.filter((call) => call.key === 'owner ruling').map((call) => call.prompt);
  assert.equal(prompts.length, 2);
  for (const prompt of prompts) {
    assert.match(prompt, /never touch tasks\/prd\.json/i);
    assert.match(prompt, /needsPass/);
  }
});

// ---------------------------------------------------------------- item 6

test('T1-16 item 6: WORKFLOW.md "Wiring it up in Claude Code" has a bullet on the wider Product Owner remit', () => {
  const section = workflowDoc.split('### Wiring it up in Claude Code')[1].split(/\n#{2,3} /)[0];
  const bullet = section.split(/\n(?=- )/).find((chunk) => [/productOwnerQuestions/, /technical/, /placement/, /product-owner-log/, /probe/i].every((re) => re.test(chunk)));
  assert.ok(bullet, 'a bullet naming productOwnerQuestions, technical, placement, product-owner-log and probe');
});

test('T1-16 item 6: .claude/agents/product-owner.md states the wider remit and keeps model fable', () => {
  const agent = readRepo('.claude/agents/product-owner.md');
  assert.match(agent, /productOwnerQuestions/);
  assert.match(agent, /technical, placement, dependency and scope/);
  assert.match(agent, /product-owner-log/);
  assert.match(agent, /^model: fable$/m);
});

test('T1-16 item 6: the frozen task.test.mjs and task-resume.test.mjs are unchanged against the merge base with origin/main', (t) => {
  const run = (...args) => spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' });
  const base = run('merge-base', 'origin/main', 'HEAD');
  if (base.status !== 0) return t.skip('no origin/main to compare with');
  const diff = run('diff', '--quiet', base.stdout.trim(), 'HEAD', '--', '.claude/workflows/task.test.mjs', '.claude/workflows/task-resume.test.mjs');
  assert.equal(diff.status, 0, 'task.test.mjs and task-resume.test.mjs differ from the merge base');
});

test('T1-16 item 6: this file is picked up by the pnpm test:workflow glob', () => {
  const scripts = JSON.parse(readRepo('package.json')).scripts;
  assert.match(scripts['test:workflow'], /\.claude\/workflows\/\*\.test\.mjs/);
  assert.match(workflowDoc.split('### Wiring it up in Claude Code')[1], /task-rulings\.test\.mjs|pnpm test:workflow/);
});
