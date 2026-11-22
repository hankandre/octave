// Run: node --test .claude/workflows/task-lanes.test.mjs
// T1-19: every task has a lane, and task.js runs lanes side by side with args.lanes.
// Whole-flow tests run task.js with a fake agent that answers by label (task id removed unless the test keys the full label).
// The fake agent also answers the lane-state gate from a small simulated origin/main (a "world"). No model, network or emulator is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const src = readFileSync(join(here, 'task.js'), 'utf8');
const workflowDoc = readFileSync(join(repoRoot, 'WORKFLOW.md'), 'utf8');
const commandsDoc = readFileSync(join(repoRoot, 'docs', 'commands.md'), 'utf8');

const TABLE = ['workflow', 'core', 'ui', 'apk-checks', 'tv-scripts', 'release', 'native-session', 'player', 'device'];
const SERIAL = ['native-session', 'player', 'device'];
const DENIAL = 'If a command is denied, report it in deniedCommands and do not work around it';

const lt = (name, fn) => test(name, { timeout: 20000 }, fn);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const settle = async (rounds = 150) => {
  for (let i = 0; i < rounds; i += 1) await tick();
};
const until = async (cond, what, limit = 4000) => {
  for (let i = 0; i < limit; i += 1) {
    if (cond()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
// A lane's or the run's stop reason: a string, or an object with the reason in it.
const reasonOf = (stopped) => (typeof stopped === 'string' ? stopped : stopped && typeof stopped === 'object' ? (stopped.reason ?? stopped.why ?? stopped.outcome) : undefined);
const idOf = (task) => (typeof task === 'string' ? task : task && task.id);

// ---------- pure block ----------
const sliceBlock = (name) => {
  assert.ok(src.includes(`// ${name}-BEGIN`), `task.js has a ${name} block`);
  return src.split(`// ${name}-BEGIN`)[1].split('\n').slice(1).join('\n').split(`// ${name}-END`)[0];
};
const loadLanes = () => {
  const names = 'LANES, SERIAL_LANES, MAX_LANES, checkLaneArgs, isLaneState, decideLaneState, routeFor, pickLane';
  return new Function(`${sliceBlock('GATE')}\n${sliceBlock('PATHS')}\n${sliceBlock('LANES')}\nreturn { ${names} };`)();
};
const loadModels = () => new Function(`${sliceBlock('MODELS')}; return { MODELS };`)().MODELS;

// ---------- simulated origin/main ----------
const relay = (json, exitCode = 0) => ({ exitCode, output: JSON.stringify(json) });
const work = (extra = {}) => ({ done: true, checksPassed: true, summary: 'ok', evidence: 'commit abc1234 and PR #1', failures: [], blockers: [], ciSteps: [], ciOnly: [], ...extra });
const SPEC_OK = { summary: 's', openQuestions: [], touchesNative: false };

function makeWorld(specs) {
  const tasks = new Map();
  for (const spec of specs) tasks.set(spec.id, { depends_on: [], model: 'sonnet', human: false, status: 'todo', passes: false, ...spec });
  const started = new Set();
  const world = {
    tasks,
    started,
    extraInFlight: {},
    merge(id) {
      const task = tasks.get(id);
      task.status = 'done';
      task.passes = true;
    },
    // What lane-state.mjs would print: the lane's todo, non-human tasks; a task this run has started has a worktree and so is in flight.
    state(lane) {
      const list = [...tasks.values()].filter((t) => t.lane === lane && t.status === 'todo' && !t.human);
      const passing = (id) => tasks.has(id) && tasks.get(id).passes === true;
      const inFlight = (world.extraInFlight[lane] || []).slice().concat(list.filter((t) => started.has(t.id)).map((t) => ({ id: t.id, where: `../octave-${t.id}` })));
      return {
        ok: true,
        lane,
        serial: SERIAL.includes(lane),
        tasks: list.map((t) => ({ id: t.id, model: t.model, depends_on: t.depends_on, waitingOn: t.depends_on.filter((d) => !passing(d)) })),
        inFlight,
        problems: [],
      };
    },
  };
  return world;
}

const fallbackAnswer = (key, id, world) => {
  if (key.startsWith('lane state ')) return relay(world.state(key.slice('lane state '.length).replace(/ \(again\)$/, '')));
  switch (key) {
    case 'spec':
      return SPEC_OK;
    case 'sync':
      return relay({ ok: true, rebased: false, problems: [] });
    case 'check':
      return { approved: true, issues: [], touchesNative: false };
    case 'tests':
      return { done: true, summary: 't', blockers: [] };
    case 'red gate':
      return relay({ task: id, expect: 'red', red: [1, 2], green: [], gates: [], blobs: {}, problems: [] });
    case 'implement':
    case 'follow-ups':
      return work();
    case 'frozen gate':
      return relay({ ok: true, commits: 2, manifests: [], changes: [], frozen: [], taskListChanged: false, missingManifest: false, problems: [] });
    case 'review':
      return { findings: [], filesChanged: ['.claude/workflows/task.js'], needsGuardian: false };
    case 'green gate':
      return relay({ task: id, expect: 'green', red: [], green: [1, 2], gates: [], blobs: {}, problems: [] });
    case 'ship':
      return { merged: true, prUrl: `https://example.invalid/pr/${id}` };
    case 'fixtures down':
      return relay({ stopped: [], problems: [] });
    default:
      return null;
  }
};

// Starts task.js whole with a fake agent. answers override by full label ("spec T9-01") or by key (label without the task id); a function answer
// gets (call number for the label, prompt, call, fallback), and may return a promise.
function start(args, { world, answers = {} } = {}) {
  const text = src.replace('export const meta', 'const meta');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('args', 'agent', 'log', text);
  const calls = [];
  const events = [];
  const logs = [];
  const seen = {};
  let active = 0;
  const h = { calls, events, logs, world, maxActive: 0 };
  const agent = async (prompt, opts) => {
    const label = String(opts.label);
    const key = label.replace(/ T\d+-\d{2}/, '');
    const id = (label.match(/T\d+-\d{2}/) || [])[0];
    seen[label] = (seen[label] || 0) + 1;
    calls.push({ label, key, id, prompt, phase: opts.phase, model: opts.model, agentType: opts.agentType });
    events.push(`start ${label}`);
    active += 1;
    h.maxActive = Math.max(h.maxActive, active);
    try {
      await tick();
      if (key === 'spec' && id) world.started.add(id);
      const fallback = () => fallbackAnswer(key, id, world);
      const own = label in answers ? answers[label] : key in answers ? answers[key] : undefined;
      let value;
      if (own === undefined) value = fallback();
      else value = typeof own === 'function' ? await own(seen[label], prompt, calls[calls.length - 1], fallback) : own;
      if (key === 'ship' && value && value.merged && id) world.merge(id);
      return value;
    } finally {
      active -= 1;
      events.push(`end ${label}`);
    }
  };
  h.done = run({ root: '/r', ...args }, agent, (line) => logs.push(String(line)));
  h.started = (label) => events.includes(`start ${label}`);
  h.ended = (label) => events.includes(`end ${label}`);
  h.at = (what) => events.indexOf(what);
  h.count = (key) => calls.filter((c) => c.key === key).length;
  h.keys = () => calls.map((c) => c.key);
  h.labels = () => calls.map((c) => c.label);
  h.call = (label) => calls.find((c) => c.label === label);
  return h;
}
async function runWhole(args, opts) {
  const h = start(args, opts);
  h.result = await h.done;
  return h;
}
const attentionOf = (h, id) => (h.result.needsAttention || []).find((o) => o.task === id);
const mergedIds = (h) => (h.result.merged || []).map((o) => o.task).sort();

// ---------- item 2: the lane runner ----------

lt('T1-19 item 2: a lane runs its next ready task when the last one ends, in one invocation, and stops none-ready', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'workflow' }, { id: 'T9-02', lane: 'workflow' }]);
  const h = await runWhole({ lanes: ['workflow'] }, { world });
  const afterOne = Math.max(h.at('end ship T9-01'), h.at('end fixtures down T9-01'));
  assert.ok(h.at('start spec T9-01') >= 0, `T9-01 ran; got ${h.labels().join(' | ')}`);
  assert.ok(afterOne >= 0 && h.at('start spec T9-02') > afterOne, `spec T9-02 comes after T9-01 ended; got ${h.labels().join(' | ')}`);
  assert.deepEqual(h.result.lanes.workflow.ran, ['T9-01', 'T9-02']);
  assert.equal(reasonOf(h.result.lanes.workflow.stopped), 'none-ready');
  assert.deepEqual(mergedIds(h), ['T9-01', 'T9-02']);
  for (const field of ['merged', 'parked', 'needsAttention']) assert.ok(Array.isArray(h.result[field]), `result.${field} is a list`);
});

lt('T1-19 item 2: the lane-state gate relays lane-state.mjs for the lane, on the gate model, with the denial sentence', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'ui' }]);
  const h = await runWhole({ lanes: ['ui'] }, { world });
  const gate = h.call('lane state ui');
  assert.ok(gate, `a "lane state ui" call; got ${h.labels().join(' | ')}`);
  assert.match(gate.prompt, /lane-state\.mjs/);
  assert.match(gate.prompt, /--repo \/r\/octave(\s|$)/);
  assert.match(gate.prompt, /--lane ui(\s|$)/);
  assert.ok(gate.prompt.includes(DENIAL), 'the denial sentence');
  assert.equal(gate.model, loadModels().gate);
  assert.equal(gate.phase, 'Spec');
});

lt('T1-19 item 2: a task that ends blocked is not run again although the state still lists it ready; the next task runs', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'workflow' }, { id: 'T9-02', lane: 'workflow' }]);
  const h = await runWhole({ lanes: ['workflow'] }, { world, answers: { 'tests T9-01': { done: false, summary: 'no', blockers: ['cannot write the test'] } } });
  assert.equal(attentionOf(h, 'T9-01')?.outcome, 'blocked', JSON.stringify(h.result));
  assert.equal(h.calls.filter((c) => c.label === 'spec T9-01').length, 1, 'T9-01 is not run twice');
  assert.ok(h.started('spec T9-02'), `T9-02 runs; got ${h.labels().join(' | ')}`);
  assert.deepEqual(h.result.lanes.workflow.ran, ['T9-01', 'T9-02']);
  assert.deepEqual(mergedIds(h), ['T9-02']);
});

lt('T1-19 item 2: a task that ends tests-green stops the lane with no further spec', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'workflow' }, { id: 'T9-02', lane: 'workflow' }]);
  const green = relay({ task: 'T9-01', expect: 'red', red: [2], green: [1], gates: [], blobs: {}, problems: [] });
  const h = await runWhole({ lanes: ['workflow'] }, { world, answers: { 'red gate T9-01': green } });
  assert.equal(attentionOf(h, 'T9-01')?.outcome, 'tests-green', JSON.stringify(h.result));
  assert.ok(!h.started('spec T9-02'), 'no spec for T9-02');
  assert.equal(reasonOf(h.result.lanes.workflow.stopped), 'tests-green');
  assert.deepEqual(h.result.lanes.workflow.ran, ['T9-01']);
});

lt('T1-19 item 2: a task that ends frozen-tests stops the lane', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'workflow' }, { id: 'T9-02', lane: 'workflow' }]);
  const bad = relay({ ok: false, commits: 2, manifests: [], changes: [], frozen: [], taskListChanged: false, missingManifest: false, problems: ['ERROR frozen test: a.test.ts differs'] }, 1);
  const h = await runWhole({ lanes: ['workflow'] }, { world, answers: { 'frozen gate T9-01': bad } });
  assert.equal(attentionOf(h, 'T9-01')?.outcome, 'frozen-tests', JSON.stringify(h.result));
  assert.ok(!h.started('spec T9-02'));
  assert.equal(reasonOf(h.result.lanes.workflow.stopped), 'frozen-tests');
});

lt('T1-19 item 2: a task whose dependency is not passing is never picked, and a later ready task is', async () => {
  const world = makeWorld([{ id: 'T9-03', lane: 'ui', depends_on: ['T9-00'] }, { id: 'T9-05', lane: 'ui' }]);
  const h = await runWhole({ lanes: ['ui'] }, { world });
  assert.ok(!h.started('spec T9-03'), 'T9-03 waits on T9-00');
  assert.ok(h.started('spec T9-05'));
  assert.equal(reasonOf(h.result.lanes.ui.stopped), 'none-ready');
});

lt('T1-19 item 2: a task with a worktree or branch from outside the run stops the lane lane-busy, before any other task', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'workflow' }, { id: 'T9-02', lane: 'workflow' }]);
  world.extraInFlight.workflow = [{ id: 'T9-01', where: '/home/x/octave-T9-01' }];
  const h = await runWhole({ lanes: ['workflow'] }, { world });
  assert.equal(reasonOf(h.result.lanes.workflow.stopped), 'lane-busy', JSON.stringify(h.result));
  assert.ok(!h.keys().includes('spec'), `no spec call; got ${h.labels().join(' | ')}`);
  assert.deepEqual(h.result.lanes.workflow.ran, []);
});

lt('T1-19 item 2: an in-flight task that this run started does not stop its lane', async () => {
  // The world adds a worktree for every task whose spec has run (the run made it), so the second query lists T9-01 in flight.
  const world = makeWorld([{ id: 'T9-01', lane: 'workflow' }, { id: 'T9-02', lane: 'workflow' }]);
  const h = await runWhole({ lanes: ['workflow'] }, { world, answers: { 'tests T9-01': { done: false, summary: 'no', blockers: ['b'] } } });
  assert.ok(h.started('spec T9-02'), `T9-02 runs after a blocked T9-01 whose worktree the run made; got ${h.labels().join(' | ')}`);
  assert.notEqual(reasonOf(h.result.lanes.workflow.stopped), 'lane-busy');
});

lt('T1-19 item 2: an unreadable lane-state result is asked once more, then the lane stops', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'ui' }]);
  const once = await runWhole({ lanes: ['ui'] }, { world, answers: { 'lane state ui': (n, p, c, fallback) => (n === 1 ? { exitCode: 0, output: 'no json here' } : fallback()) } });
  assert.ok(once.started('lane state ui (again)'), `asked again; got ${once.labels().join(' | ')}`);
  assert.ok(once.started('spec T9-01'), 'the task runs after the second answer');

  const twice = makeWorld([{ id: 'T9-01', lane: 'ui' }]);
  const bad = () => ({ exitCode: 0, output: 'still no json' });
  const h = await runWhole({ lanes: ['ui'] }, { world: twice, answers: { 'lane state ui': bad, 'lane state ui (again)': bad } });
  assert.ok(!h.keys().includes('spec'), 'no spec after two unreadable answers');
  assert.match(String(reasonOf(h.result.lanes.ui.stopped)), /lane-state/);
});

lt('T1-19 item 2: a lane that has no ready task at all stops none-ready with no task run', async () => {
  const h = await runWhole({ lanes: ['core'] }, { world: makeWorld([]) });
  assert.equal(reasonOf(h.result.lanes.core.stopped), 'none-ready');
  assert.deepEqual(h.result.lanes.core.ran, []);
  assert.ok(!h.keys().includes('spec'));
});

lt('T1-19 item 2: pickLane takes the first task that is not attempted and not waiting, and stops lane-busy before any other choice', () => {
  const { pickLane } = loadLanes();
  const snapshot = (extra = {}) => ({ ok: true, lane: 'ui', serial: false, tasks: [{ id: 'T9-01', model: 'sonnet', depends_on: [], waitingOn: [] }, { id: 'T9-02', model: 'sonnet', depends_on: [], waitingOn: [] }], inFlight: [], problems: [], ...extra });
  const state = (extra = {}) => ({ laneStates: { ui: 'querying' }, attempted: new Set(), slotHolder: null, halted: false, ...extra });
  const first = pickLane({ state: state(), lane: 'ui', snapshot: snapshot() });
  assert.equal(first.action, 'run');
  assert.equal(idOf(first.task), 'T9-01');
  assert.equal(first.risk, 'routine');
  assert.equal(first.native, false);
  const second = pickLane({ state: state({ attempted: new Set(['T9-01']) }), lane: 'ui', snapshot: snapshot() });
  assert.equal(idOf(second.task), 'T9-02');
  const waiting = snapshot({ tasks: [{ id: 'T9-01', model: 'sonnet', depends_on: ['T9-00'], waitingOn: ['T9-00'] }, { id: 'T9-02', model: 'sonnet', depends_on: [], waitingOn: [] }] });
  assert.equal(idOf(pickLane({ state: state(), lane: 'ui', snapshot: waiting }).task), 'T9-02', 'a waiting task is skipped');
  const busy = pickLane({ state: state(), lane: 'ui', snapshot: snapshot({ inFlight: [{ id: 'T9-02', where: '/x' }] }) });
  assert.equal(busy.action, 'stop');
  assert.equal(busy.why, 'lane-busy');
  const own = pickLane({ state: state({ attempted: new Set(['T9-02']) }), lane: 'ui', snapshot: snapshot({ inFlight: [{ id: 'T9-02', where: '/x' }] }) });
  assert.equal(own.action, 'run', 'an in-flight task the run attempted is not lane-busy');
  assert.equal(pickLane({ state: state({ halted: true }), lane: 'ui', snapshot: snapshot() }).action, 'stop', 'a halted run takes nothing');
});

lt('T1-19 item 2: pickLane with no candidate waits while another lane queries or runs, and stops none-ready naming what it waited on', () => {
  const { pickLane } = loadLanes();
  const snapshot = { ok: true, lane: 'ui', serial: false, tasks: [{ id: 'T9-03', model: 'sonnet', depends_on: ['T9-04'], waitingOn: ['T9-04'] }], inFlight: [], problems: [] };
  const state = (laneStates) => ({ laneStates, attempted: new Set(), slotHolder: null, halted: false });
  for (const other of ['querying', 'running']) {
    const d = pickLane({ state: state({ ui: 'querying', core: other }), lane: 'ui', snapshot });
    assert.equal(d.action, 'wait', `another lane ${other}`);
    assert.equal(d.why, 'dependency');
  }
  for (const other of ['waiting', 'stopped']) {
    const d = pickLane({ state: state({ ui: 'querying', core: other }), lane: 'ui', snapshot });
    assert.equal(d.action, 'stop', `another lane ${other}`);
    assert.equal(d.why, 'none-ready');
    assert.match(JSON.stringify(d.waiting), /T9-03/);
    assert.match(JSON.stringify(d.waiting), /T9-04/);
  }
  const alone = pickLane({ state: state({ ui: 'querying' }), lane: 'ui', snapshot });
  assert.equal(alone.action, 'stop', "the lane's own state does not count as another lane");
  const empty = pickLane({ state: state({ ui: 'querying' }), lane: 'ui', snapshot: { ...snapshot, tasks: [] } });
  assert.equal(empty.why, 'none-ready');
});

lt('T1-19 item 2: decideLaneState passes a lane-state result with its json, retries unreadable output once, then blocks', () => {
  const { decideLaneState, isLaneState } = loadLanes();
  const good = { ok: true, lane: 'ui', serial: false, tasks: [], inFlight: [], problems: [] };
  const pass = decideLaneState({ exitCode: 0, output: JSON.stringify(good) }, false);
  assert.equal(pass.action, 'pass');
  assert.equal(pass.json.lane, 'ui');
  const wrapped = decideLaneState({ exitCode: 0, output: `note ${JSON.stringify({ stdout: good })}` }, false);
  assert.equal(wrapped.action, 'pass', 'a wrapped result is still read');
  const unreadable = decideLaneState({ exitCode: 0, output: 'nothing' }, false);
  assert.equal(unreadable.action, 'retry');
  assert.equal(unreadable.unreadable, true);
  assert.equal(decideLaneState({ exitCode: 0, output: 'nothing' }, true).action, 'blocked');
  assert.notEqual(decideLaneState({ exitCode: 1, output: JSON.stringify({ ...good, ok: false, problems: ['ERROR lane: x'] }) }, false).action, 'pass');
  assert.equal(decideLaneState({ exitCode: 0, output: '', deniedCommands: ['git fetch'] }, false).action, 'denied');
  assert.equal(isLaneState(good), true);
  assert.equal(isLaneState({}), false);
  assert.equal(isLaneState({ ok: true, lane: 'ui' }), false);
});

// lane-state.mjs on a temporary git repository with a bare origin
const dirs = [];
process.on('exit', () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const prdText = (tasks) => JSON.stringify({ product: 'p', updated: '2026-01-01', rules: ['r'], status_values: ['todo', 'in_progress', 'blocked', 'done'], phases: [{ id: 'T9', name: 'n', goal: 'g', exit: 'e', tasks }] }, null, 2) + '\n';
const stateTask = (id, extra = {}) => ({ id, title: `Task ${id}`, domain: 'Process', model: 'sonnet', skill: 'exec-plan', human: false, depends_on: [], acceptance: ['a'], verify: 'pnpm check', status: 'todo', owner: null, passes: false, evidence: '', lane: 'workflow', ...extra });
const STATE_TASKS = () => [
  stateTask('T9-01'),
  stateTask('T9-02', { depends_on: ['T9-01'], model: 'opus' }),
  stateTask('T9-03', { human: true }),
  stateTask('T9-04', { status: 'done', passes: true, evidence: 'PR #1' }),
  stateTask('T9-05', { lane: 'core' }),
  stateTask('T9-06', { status: 'blocked' }),
  stateTask('T9-07', { lane: 'player' }),
  stateTask('T9-08', { status: 'in_progress' }),
];
function makeRepo(tasks = STATE_TASKS()) {
  const base = mkdtempSync(join(tmpdir(), 'lane-state-'));
  dirs.push(base);
  const origin = join(base, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  const repo = join(base, 'octave');
  execFileSync('git', ['clone', '-q', origin, repo], { env: gitEnv, stdio: 'ignore' });
  git(repo, 'checkout', '-q', '-B', 'main');
  mkdirSync(join(repo, 'tasks'));
  writeFileSync(join(repo, 'tasks', 'prd.json'), prdText(tasks));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  return { base, origin, repo };
}
const laneState = (repo, lane, ...extra) => {
  const out = spawnSync(process.execPath, [join(here, 'lane-state.mjs'), '--repo', repo, '--lane', lane, ...extra], { encoding: 'utf8', env: gitEnv });
  const lines = out.stdout.trim().split('\n').filter(Boolean);
  return { status: out.status, stdout: out.stdout, stderr: out.stderr, lines, json: lines.length ? JSON.parse(lines[lines.length - 1]) : null };
};

lt('T1-19 item 2: lane-state.mjs prints one JSON line with the lane\'s todo non-human tasks in file order and what each waits on', () => {
  const { repo } = makeRepo();
  const out = laneState(repo, 'workflow', '--no-fetch');
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.lines.length, 1, out.stdout);
  assert.equal(out.json.ok, true);
  assert.equal(out.json.lane, 'workflow');
  assert.equal(out.json.serial, false);
  assert.deepEqual(out.json.problems, []);
  assert.deepEqual(out.json.tasks.map((t) => t.id), ['T9-01', 'T9-02']);
  assert.deepEqual(out.json.tasks.map((t) => t.waitingOn), [[], ['T9-01']]);
  assert.deepEqual(out.json.tasks.map((t) => t.model), ['sonnet', 'opus']);
  assert.deepEqual(out.json.tasks[1].depends_on, ['T9-01']);
  assert.deepEqual(out.json.inFlight, []);
});

lt('T1-19 item 2: lane-state.mjs marks a serial lane serial', () => {
  const { repo } = makeRepo();
  const out = laneState(repo, 'player', '--no-fetch');
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.json.serial, true);
  assert.deepEqual(out.json.tasks.map((t) => t.id), ['T9-07']);
});

lt('T1-19 item 2: lane-state.mjs reads origin/main, not the working tree or an unpushed commit', () => {
  const { repo } = makeRepo();
  const edited = JSON.parse(readFileSync(join(repo, 'tasks', 'prd.json'), 'utf8'));
  edited.phases[0].tasks[0].status = 'done';
  edited.phases[0].tasks[0].passes = true;
  writeFileSync(join(repo, 'tasks', 'prd.json'), JSON.stringify(edited, null, 2) + '\n');
  assert.deepEqual(laneState(repo, 'workflow', '--no-fetch').json.tasks.map((t) => t.id), ['T9-01', 'T9-02'], 'working tree edit ignored');
  git(repo, 'commit', '-q', '-am', 'local only');
  assert.deepEqual(laneState(repo, 'workflow', '--no-fetch').json.tasks.map((t) => t.id), ['T9-01', 'T9-02'], 'unpushed commit ignored');
});

lt('T1-19 item 2: lane-state.mjs fetches origin unless --no-fetch', () => {
  const { base, origin, repo } = makeRepo();
  const other = join(base, 'other');
  execFileSync('git', ['clone', '-q', origin, other], { env: gitEnv, stdio: 'ignore' });
  const tasks = STATE_TASKS();
  tasks[0] = { ...tasks[0], status: 'done', passes: true, evidence: 'PR #2' };
  writeFileSync(join(other, 'tasks', 'prd.json'), prdText(tasks));
  git(other, 'commit', '-q', '-am', 'T9-01 done');
  git(other, 'push', '-q', 'origin', 'main');
  assert.deepEqual(laneState(repo, 'workflow', '--no-fetch').json.tasks.map((t) => t.id), ['T9-01', 'T9-02'], 'no fetch, old state');
  const fetched = laneState(repo, 'workflow');
  assert.equal(fetched.status, 0, fetched.stderr);
  assert.deepEqual(fetched.json.tasks.map((t) => t.id), ['T9-02']);
  assert.deepEqual(fetched.json.tasks[0].waitingOn, []);
});

lt('T1-19 item 2: lane-state.mjs lists todo and in_progress tasks with a worktree or a remote branch as in flight, and ignores blocked and done ones', () => {
  const { base, repo } = makeRepo();
  git(repo, 'worktree', 'add', '-q', join(base, 'octave-T9-01'), '-b', 'task/T9-01', 'origin/main');
  git(repo, 'worktree', 'add', '-q', join(base, 'octave-T9-06'), '-b', 'task/T9-06', 'origin/main');
  git(repo, 'worktree', 'add', '-q', join(base, 'octave-T9-04'), '-b', 'task/T9-04', 'origin/main');
  git(repo, 'worktree', 'add', '-q', join(base, 'octave-T9-05'), '-b', 'task/T9-05', 'origin/main');
  git(repo, 'push', '-q', 'origin', 'origin/main:refs/heads/task/T9-08');
  git(repo, 'push', '-q', 'origin', 'origin/main:refs/heads/task/T9-02');
  const out = laneState(repo, 'workflow');
  assert.equal(out.status, 0, out.stderr);
  const flight = Object.fromEntries(out.json.inFlight.map((f) => [f.id, f.where]));
  assert.deepEqual(Object.keys(flight).sort(), ['T9-01', 'T9-02', 'T9-08'], JSON.stringify(out.json.inFlight));
  for (const [id, where] of Object.entries(flight)) assert.ok(typeof where === 'string' && where.includes(id), `${id} where: ${where}`);
  const core = laneState(repo, 'core', '--no-fetch');
  assert.deepEqual(core.json.inFlight.map((f) => f.id), ['T9-05'], 'a worktree counts in its own lane');
});

lt('T1-19 item 2: lane-state.mjs refuses an unknown lane and a missing lane with an ERROR line and exit 1', () => {
  const { repo } = makeRepo();
  const unknown = laneState(repo, 'nope', '--no-fetch');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /^ERROR /m);
  const none = spawnSync(process.execPath, [join(here, 'lane-state.mjs'), '--repo', repo, '--no-fetch'], { encoding: 'utf8', env: gitEnv });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /^ERROR /m);
});

// ---------- item 3: the serial slot ----------

lt('T1-19 item 3: task.js and scripts/task.mjs hold the same LANES and SERIAL_LANES, and they are the spec table', async () => {
  const mod = await import(new URL('../../scripts/task.mjs', import.meta.url));
  const lanes = loadLanes();
  assert.deepEqual(lanes.LANES, TABLE);
  assert.deepEqual(lanes.SERIAL_LANES, SERIAL);
  assert.equal(lanes.MAX_LANES, 4);
  assert.deepEqual(mod.LANES, lanes.LANES);
  assert.deepEqual(mod.SERIAL_LANES, lanes.SERIAL_LANES);
});

lt('T1-19 item 3: the LANES block holds none of the frozen anchors', () => {
  const block = sliceBlock('LANES');
  for (const token of ['tearDownFixtures', 'guarded(', 'Fix these review findings', 'const common =', 'Implement the approved spec.', 'const shipPrompt']) {
    assert.ok(!block.includes(token), `the LANES block must not contain ${token}`);
  }
});

lt('T1-19 item 3: routeFor sends native-session and player to native, fable tasks to high risk, and everything else to routine', () => {
  const { routeFor } = loadLanes();
  assert.deepEqual(routeFor('player', { id: 'T9-01', model: 'sonnet' }), { risk: 'routine', native: true });
  assert.deepEqual(routeFor('native-session', { id: 'T9-01', model: 'opus' }), { risk: 'routine', native: true });
  assert.deepEqual(routeFor('native-session', { id: 'T9-01', model: 'fable' }), { risk: 'high', native: true });
  assert.deepEqual(routeFor('ui', { id: 'T9-01', model: 'fable' }), { risk: 'high', native: false });
  assert.deepEqual(routeFor('core', { id: 'T9-01', model: 'opus' }), { risk: 'routine', native: false });
  assert.deepEqual(routeFor('device', { id: 'T9-01', model: 'sonnet' }), { risk: 'routine', native: false });
});

lt('T1-19 item 3: pickLane makes a serial lane wait while another lane holds the slot, and lets a parallel lane run', () => {
  const { pickLane } = loadLanes();
  const snap = (lane, serial) => ({ ok: true, lane, serial, tasks: [{ id: 'T9-01', model: 'sonnet', depends_on: [], waitingOn: [] }], inFlight: [], problems: [] });
  const state = (slotHolder) => ({ laneStates: { player: 'querying', 'native-session': 'running', ui: 'querying' }, attempted: new Set(), slotHolder, halted: false });
  const held = pickLane({ state: state('native-session'), lane: 'player', snapshot: snap('player', true) });
  assert.equal(held.action, 'wait');
  assert.equal(held.why, 'serial');
  const free = pickLane({ state: state(null), lane: 'player', snapshot: snap('player', true) });
  assert.equal(free.action, 'run');
  assert.equal(free.native, true);
  const parallel = pickLane({ state: state('native-session'), lane: 'ui', snapshot: snap('ui', false) });
  assert.equal(parallel.action, 'run');
  assert.equal(parallel.native, false);
});

lt('T1-19 item 3: a second serial lane makes no spec call until the first serial task has ended, then it runs', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'native-session' }, { id: 'T9-02', lane: 'player' }]);
  const hold = deferred();
  let firstSpec;
  const specAnswer = (n, p, call) => {
    if (!firstSpec) {
      firstSpec = call.id;
      return hold.promise.then(() => SPEC_OK);
    }
    return SPEC_OK;
  };
  const h = start({ lanes: ['native-session', 'player'] }, { world, answers: { spec: specAnswer } });
  try {
    await until(() => h.count('spec') >= 1, 'the first spec call');
    await settle();
    assert.equal(h.count('spec'), 1, `only one serial task has started; got ${h.labels().join(' | ')}`);
  } finally {
    hold.resolve();
  }
  h.result = await h.done;
  const specs = h.calls.filter((c) => c.key === 'spec').map((c) => c.id);
  assert.equal(specs.length, 2, `both ran; got ${h.labels().join(' | ')}`);
  assert.ok(h.at('start spec ' + specs[1]) > h.at('end fixtures down ' + specs[0]), 'the second serial task starts after the first one ended');
  assert.deepEqual(mergedIds(h), ['T9-01', 'T9-02']);
});

lt('T1-19 item 3: a serial lane and a parallel lane run side by side', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'native-session' }, { id: 'T9-02', lane: 'ui' }]);
  const hold = deferred();
  const h = start({ lanes: ['native-session', 'ui'] }, { world, answers: { 'spec T9-01': () => hold.promise.then(() => SPEC_OK) } });
  try {
    await until(() => h.started('spec T9-01') && h.started('spec T9-02'), 'both spec calls');
    assert.ok(!h.ended('spec T9-01'), 'the native spec is still pending when the ui spec has started');
  } finally {
    hold.resolve();
  }
  h.result = await h.done;
  assert.deepEqual(mergedIds(h), ['T9-01', 'T9-02']);
});

lt('T1-19 item 3: three parallel lanes run side by side', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'ui' }, { id: 'T9-02', lane: 'core' }, { id: 'T9-03', lane: 'workflow' }]);
  const hold = deferred();
  const h = start({ lanes: ['ui', 'core', 'workflow'] }, { world, answers: { spec: () => hold.promise.then(() => SPEC_OK) } });
  try {
    await until(() => h.count('spec') === 3, 'three spec calls at once');
  } finally {
    hold.resolve();
  }
  h.result = await h.done;
  assert.deepEqual(mergedIds(h), ['T9-01', 'T9-02', 'T9-03']);
});

lt('T1-19 item 3: native tasks of the serial lanes go to native-engineer, fable tasks to the fable spec model, the rest to the implementer', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'player' }, { id: 'T9-02', lane: 'ui', model: 'fable' }, { id: 'T9-03', lane: 'core' }]);
  const h = await runWhole({ lanes: ['player', 'ui', 'core'] }, { world });
  assert.equal(h.call('implement T9-01')?.agentType, 'native-engineer');
  assert.equal(h.call('implement T9-02')?.agentType, 'implementer');
  assert.equal(h.call('implement T9-03')?.agentType, 'implementer');
  assert.equal(h.call('spec T9-02')?.model, loadModels().spec.high);
  assert.equal(h.call('spec T9-03')?.model, loadModels().spec.routine);
  assert.equal(h.call('review T9-01')?.agentType, 'guardian');
});

lt('T1-19 item 3: a parallel-lane task whose spec turns native waits for the slot before its Tests step, and the run logs the mismatch', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'player' }, { id: 'T9-02', lane: 'ui' }]);
  const hold = deferred();
  const native = { summary: 's', openQuestions: [], touchesNative: true };
  const h = start({ lanes: ['player', 'ui'] }, { world, answers: { 'spec T9-01': () => hold.promise.then(() => SPEC_OK), 'spec T9-02': native } });
  try {
    await until(() => h.started('spec T9-01') && h.ended('spec T9-02'), 'the ui spec to end while the player spec is held');
    await settle();
    assert.ok(!h.started('tests T9-02'), `no tests call while the player lane holds the slot; got ${h.labels().join(' | ')}`);
  } finally {
    hold.resolve();
  }
  h.result = await h.done;
  assert.ok(h.at('start tests T9-02') > h.at('end fixtures down T9-01'), 'tests T9-02 starts after the player task ended');
  assert.ok(h.logs.some((line) => /T9-02: lane ui holds native work; the serial slot is taken/.test(line)), h.logs.join('\n'));
  assert.deepEqual(mergedIds(h), ['T9-01', 'T9-02']);
});

lt('T1-19 item 3: a parallel-lane task whose review finds native files waits for the slot before its follow-ups, and the run logs the mismatch', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'player' }, { id: 'T9-02', lane: 'ui' }]);
  const hold = deferred();
  const review = { findings: [], filesChanged: ['modules/player/src/Player.kt'], needsGuardian: false };
  const h = start({ lanes: ['player', 'ui'] }, { world, answers: { 'spec T9-01': () => hold.promise.then(() => SPEC_OK), 'review T9-02': review, 'guardian T9-02': { findings: [], filesChanged: [] } } });
  try {
    await until(() => h.started('spec T9-01') && h.ended('review T9-02'), 'the ui review to end while the player spec is held');
    await settle();
    assert.ok(!h.started('follow-ups T9-02'), `no follow-ups call while the player lane holds the slot; got ${h.labels().join(' | ')}`);
  } finally {
    hold.resolve();
  }
  h.result = await h.done;
  assert.ok(h.at('start follow-ups T9-02') > h.at('end fixtures down T9-01'), 'the follow-ups start after the player task ended');
  assert.ok(h.logs.some((line) => /T9-02: lane ui holds native work; the serial slot is taken/.test(line)), h.logs.join('\n'));
});

lt('T1-19 item 3: five lanes, an unknown lane, a repeated lane, no lane, or lanes with task or tasks return bad-args with no agent call', async () => {
  const { checkLaneArgs } = loadLanes();
  assert.deepEqual(checkLaneArgs({ lanes: ['ui', 'core'] }), []);
  assert.deepEqual(checkLaneArgs({ lanes: ['workflow', 'core', 'ui', 'apk-checks'] }), []);
  const bad = [
    { lanes: ['workflow', 'core', 'ui', 'apk-checks', 'tv-scripts'] },
    { lanes: ['ui', 'nope'] },
    { lanes: ['ui', 'ui'] },
    { lanes: [] },
    { lanes: ['ui'], task: 'T9-01' },
    { lanes: ['ui'], tasks: ['T9-01'] },
  ];
  for (const input of bad) {
    assert.ok(checkLaneArgs(input).length > 0, `checkLaneArgs refuses ${JSON.stringify(input)}`);
    const h = await runWhole(input, { world: makeWorld([{ id: 'T9-01', lane: 'ui' }]) });
    assert.equal(h.result.stopped, 'bad-args', `${JSON.stringify(input)} gave ${JSON.stringify(h.result)}`);
    assert.equal(h.calls.length, 0, `no agent call for ${JSON.stringify(input)}; got ${h.labels().join(' | ')}`);
  }
});

// ---------- item 4: one task per lane, and cross-lane dependencies ----------

lt('T1-19 item 4: two ready tasks of one lane run one after the other, never together', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'ui' }, { id: 'T9-02', lane: 'ui' }]);
  const h = await runWhole({ lanes: ['ui'] }, { world });
  assert.ok(h.at('start spec T9-02') > h.at('end fixtures down T9-01'), `spec T9-02 comes only after T9-01's fixtures down; got ${h.labels().join(' | ')}`);
  assert.equal(h.maxActive, 1, 'no two agent calls of one lane are pending at once');
  assert.deepEqual(mergedIds(h), ['T9-01', 'T9-02']);
});

const crossDep = () => makeWorld([{ id: 'T9-03', lane: 'ui', depends_on: ['T9-04'] }, { id: 'T9-04', lane: 'core' }]);

for (const order of [['ui', 'core'], ['core', 'ui']]) {
  for (const late of ['ui', 'core']) {
    lt(`T1-19 item 4: a task waits for its dependency in another lane (lanes ${order.join(',')}, the ${late} gate answers late)`, async () => {
      const world = crossDep();
      const hold = deferred();
      const lateAnswer = async (n, p, c, fallback) => {
        if (n === 1) await settle(40);
        return fallback();
      };
      const h = start({ lanes: order }, { world, answers: { 'spec T9-04': () => hold.promise.then(() => SPEC_OK), [`lane state ${late}`]: lateAnswer } });
      try {
        await until(() => h.started('spec T9-04'), 'the core task to start');
        await settle();
        assert.ok(!h.started('spec T9-03'), `T9-03 waits while T9-04 runs; got ${h.labels().join(' | ')}`);
      } finally {
        hold.resolve();
      }
      h.result = await h.done;
      assert.ok(h.at('start spec T9-03') > h.at('end fixtures down T9-04'), `T9-03 starts after T9-04 ended; got ${h.labels().join(' | ')}`);
      assert.deepEqual(mergedIds(h), ['T9-03', 'T9-04']);
      assert.equal(reasonOf(h.result.lanes.ui.stopped), 'none-ready');
      assert.equal(reasonOf(h.result.lanes.core.stopped), 'none-ready');
    });
  }
}

lt('T1-19 item 4: a snapshot that lists the task as waiting, answered after its dependency ended, is asked again and not trusted', async () => {
  const world = crossDep();
  const gate = deferred();
  const stale = (n, p, c, fallback) => {
    if (n !== 1) return fallback();
    const snapshot = fallback();
    return gate.promise.then(() => snapshot);
  };
  const h = start({ lanes: ['ui', 'core'] }, { world, answers: { 'lane state ui': stale } });
  try {
    await until(() => h.ended('fixtures down T9-04'), 'the core task to end while the ui gate answer is held');
    await settle(20);
  } finally {
    gate.resolve();
  }
  h.result = await h.done;
  assert.ok(h.count('lane state ui') >= 2, `the ui gate is asked again; got ${h.labels().join(' | ')}`);
  assert.ok(h.started('spec T9-03'), 'T9-03 runs on the fresh snapshot');
  assert.deepEqual(mergedIds(h), ['T9-03', 'T9-04']);
});

lt('T1-19 item 4: a dependency that is never met ends the lane none-ready and names the task and the dependency', async () => {
  const h = await runWhole({ lanes: ['ui'] }, { world: crossDep() });
  assert.equal(reasonOf(h.result.lanes.ui.stopped), 'none-ready');
  assert.match(JSON.stringify(h.result.lanes.ui), /T9-03/);
  assert.match(JSON.stringify(h.result.lanes.ui), /T9-04/);
  assert.ok(!h.keys().includes('spec'));
});

lt('T1-19 item 4: a lane whose loop throws ends failed, and the other lanes still finish their tasks', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'core' }, { id: 'T9-05', lane: 'ui' }]);
  const h = await runWhole({ lanes: ['core', 'ui'] }, { world, answers: { 'lane state core': () => { throw new Error('boom'); } } });
  assert.equal(reasonOf(h.result.lanes.core.stopped), 'failed', JSON.stringify(h.result.lanes));
  assert.match(JSON.stringify(h.result.lanes.core), /boom/);
  assert.deepEqual(mergedIds(h), ['T9-05']);
});

lt('T1-19 item 4: a lane waiting on a lane that failed is woken and stops none-ready instead of waiting forever', async () => {
  const h = await runWhole({ lanes: ['ui', 'core'] }, { world: crossDep(), answers: { 'lane state core': () => { throw new Error('boom'); } } });
  assert.equal(reasonOf(h.result.lanes.core.stopped), 'failed');
  assert.equal(reasonOf(h.result.lanes.ui.stopped), 'none-ready');
  assert.match(JSON.stringify(h.result.lanes.ui), /T9-04/);
});

lt('T1-19 item 4: a serial lane that throws after its task frees the slot for the waiting serial lane', async () => {
  const world = makeWorld([{ id: 'T9-01', lane: 'native-session' }, { id: 'T9-02', lane: 'player' }]);
  const h = await runWhole({ lanes: ['native-session', 'player'] }, { world, answers: { 'lane state native-session': (n, p, c, fallback) => { if (n === 2) throw new Error('boom'); return fallback(); } } });
  assert.equal(reasonOf(h.result.lanes['native-session'].stopped), 'failed', JSON.stringify(h.result.lanes));
  assert.deepEqual(mergedIds(h), ['T9-01', 'T9-02']);
});

// ---------- item 5: a denied command stops every lane ----------

const denialWorld = () =>
  makeWorld([
    { id: 'T9-03', lane: 'ui' },
    { id: 'T9-05', lane: 'ui' },
    { id: 'T9-04', lane: 'core' },
    { id: 'T9-06', lane: 'core' },
  ]);

// ui's T9-03 is held at spec; the denial arrives in core meanwhile; then ui's spec is released.
async function denyRun(kind) {
  const world = denialWorld();
  const hold = deferred();
  let h;
  const answers = { 'spec T9-03': () => hold.promise.then(() => SPEC_OK) };
  if (kind === 'implement') answers['implement T9-04'] = work({ deniedCommands: ['rm -rf /tmp/x'] });
  if (kind === 'teardown') answers['fixtures down T9-04'] = { exitCode: 0, output: '', deniedCommands: ['docker compose down'] };
  if (kind === 'gate') {
    answers['lane state core'] = async (n, p, c, fallback) => {
      if (n === 1) {
        await until(() => h.started('spec T9-03'), 'the ui spec');
        return { exitCode: 0, output: '', deniedCommands: ['git fetch -q origin'] };
      }
      return fallback();
    };
  }
  h = start({ lanes: ['ui', 'core'] }, { world, answers });
  try {
    await until(() => h.started('spec T9-03'), 'the ui spec to start');
    const trigger = { implement: 'end implement T9-04', teardown: 'end fixtures down T9-04', gate: 'end lane state core' }[kind];
    await until(() => h.events.includes(trigger), trigger);
    await settle(30);
  } finally {
    hold.resolve();
  }
  h.result = await h.done;
  return h;
}

for (const [kind, where] of [['implement', /T9-04|core/], ['teardown', /T9-04|core|fixture/i], ['gate', /core|lane state/]]) {
  lt(`T1-19 item 5: a denied ${kind === 'implement' ? 'command in a task' : kind === 'teardown' ? 'fixture teardown' : 'lane-state gate'} halts the other lane at its next phase and starts no new task`, async () => {
    const h = await denyRun(kind);
    assert.ok(h.result.stopped, `the run result carries stopped; got ${JSON.stringify(h.result)}`);
    assert.equal(reasonOf(h.result.stopped), 'denied');
    assert.match(JSON.stringify(h.result.stopped.where ?? h.result.stopped), where);
    const halted = attentionOf(h, 'T9-03');
    assert.equal(halted?.outcome, 'halted', JSON.stringify(h.result));
    assert.equal(halted.detail.from, 'check');
    assert.ok(!h.started('check T9-03'), 'no check call for the halted task');
    assert.ok(h.started('fixtures down T9-03'), 'the halted task still brings its fixtures down');
    assert.ok(!h.started('spec T9-05'), 'ui takes no new task');
    assert.ok(!h.started('spec T9-06'), 'core takes no new task');
  });
}

lt('T1-19 item 5: a tests-green in one lane stops only that lane; the other goes on to its next task', async () => {
  const world = denialWorld();
  const green = relay({ task: 'T9-04', expect: 'red', red: [2], green: [1], gates: [], blobs: {}, problems: [] });
  const h = await runWhole({ lanes: ['ui', 'core'] }, { world, answers: { 'red gate T9-04': green } });
  assert.equal(attentionOf(h, 'T9-04')?.outcome, 'tests-green');
  assert.equal(reasonOf(h.result.lanes.core.stopped), 'tests-green');
  assert.ok(!h.started('spec T9-06'), 'core takes no second task');
  assert.deepEqual(h.result.lanes.ui.ran, ['T9-03', 'T9-05']);
  assert.equal(reasonOf(h.result.lanes.ui.stopped), 'none-ready');
  assert.notEqual(reasonOf(h.result.stopped), 'denied');
});

// ---------- item 6: the docs, and every item-1 rule through direct imports ----------

const wiring = () => workflowDoc.split('### Wiring it up in Claude Code')[1].split(/\n#{2,3} /)[0];
const named = (text, name) => new RegExp(`(^|[^\\w-])${name}($|[^\\w-])`).test(text);

lt('T1-19 item 6: WORKFLOW.md "Wiring it up" describes lanes, the runner, lane-busy, and every lane, with the serial ones in a sentence that says serial', () => {
  const section = wiring();
  assert.match(section, /lanes/i);
  assert.match(section, /lane-state\.mjs/);
  assert.match(section, /lane-busy/);
  assert.match(section, /args\.lanes|lanes: \[/);
  for (const name of TABLE) assert.ok(named(section, name), `the section names the lane ${name}`);
  const sentences = section.split(/(?<=[.!?:])\s+|\n+/);
  for (const name of SERIAL) assert.ok(sentences.some((s) => named(s, name) && /serial/i.test(s)), `a sentence names ${name} and says serial`);
});

lt('T1-19 item 6: the Lanes text states the wait rule, the denial rule, one run for all serial lanes, and the limit for a task the review finds native', () => {
  const section = wiring();
  const bullet = section.split(/\n(?=- )/).find((chunk) => /lane-state\.mjs/.test(chunk));
  assert.ok(bullet, 'a bullet on lanes that names lane-state.mjs');
  assert.match(bullet, /depend/i, 'the wait rule for a dependency in another lane');
  assert.match(bullet, /denied/i, 'the denial rule');
  assert.match(bullet, /one run/i, 'all serial lanes start in one run');
  const limit = bullet.split(/(?<=[.!?])\s+/).some((s) => /review/i.test(s) && /native/i.test(s));
  assert.ok(limit, 'a sentence on a parallel-lane task that the review finds native');
});

lt('T1-19 item 6: WORKFLOW.md "Parallel agents" names each serial lane, and the Coordinator row says lanes', () => {
  const section = workflowDoc.split('## Parallel agents')[1].split(/\n## /)[0];
  for (const name of SERIAL) assert.ok(named(section, name), `Parallel agents names ${name}`);
  const row = workflowDoc.split('\n').find((line) => line.startsWith('| Coordinator'));
  assert.ok(row, 'a Coordinator row');
  assert.match(row, /lanes?/i);
});

lt('T1-19 item 6: docs/commands.md names --lane', () => {
  assert.match(commandsDoc, /--lane/);
});

lt('T1-19 item 6: the task CLI and the owner tool apply every lane rule when imported directly', async () => {
  const mod = await import(new URL('../../scripts/task.mjs', import.meta.url));
  const owner = await import(new URL('../../scripts/task-owner.mjs', import.meta.url));
  assert.deepEqual(mod.LANES, TABLE);
  assert.deepEqual(mod.SERIAL_LANES, SERIAL);
  const mk = (id, extra = {}) => ({ id, title: `T ${id}`, domain: 'Process', lane: 'workflow', model: 'sonnet', skill: 'exec-plan', human: false, depends_on: [], acceptance: ['a'], verify: 'pnpm check', status: 'todo', owner: null, passes: false, evidence: '', ...extra });
  const prd = { product: 'p', updated: '2026-01-01', rules: ['r'], status_values: ['todo', 'in_progress', 'blocked', 'done'], phases: [{ id: 'T9', name: 'n', goal: 'g', exit: 'e', tasks: [mk('T9-01', { lane: 'core' }), mk('T9-02', { lane: 'ui' }), mk('T9-03', { lane: 'ui', status: 'done', passes: true, evidence: 'PR #1' })] }] };
  assert.equal(mod.nextTask(prd).id, 'T9-01');
  assert.equal(mod.nextTask(prd, { lane: 'ui' }).id, 'T9-02');
  assert.deepEqual(mod.listLines(prd, { lane: 'ui' }), ['T9-02\ttodo\tT T9-02', 'T9-03\tdone\tT T9-03']);
  assert.throws(() => mod.listLines(prd, { lane: 'x' }), /ERROR task: unknown lane x/);
  assert.throws(() => mod.parseSetArgs(['T9-01', '--status', 'todo', '--lane', 'ui']), /set changes only status, owner, passes and evidence/);

  const files = { prd: JSON.stringify(prd, null, 2) + '\n', backlog: '{"what": "Alpha", "why": "w", "source": "s", "size": "S", "date": "2026-11-20"}\n' };
  const opts = { date: '2026-11-21', readApproval: () => null };
  const NEW = { id: 'T9-04', title: 'New', domain: 'Process', lane: 'ui', model: 'opus', skill: 'exec-plan', human: false, depends_on: ['T9-01'], acceptance: ['a'], verify: 'pnpm check' };
  const add = (task) => () => owner.applyOps(files, [{ op: 'add', phase: 'T9', after: 'T9-03', task, takes: ['Alpha'] }], opts);
  const { lane: omitted, ...noLane } = NEW;
  assert.ok(omitted);
  assert.throws(add(noLane), /lane/);
  assert.throws(add({ ...NEW, lane: 'x' }), /ERROR owner: T9-04: lane has an invalid value/);
  const added = owner.applyOps(files, [{ op: 'add', phase: 'T9', after: 'T9-03', task: NEW, takes: ['Alpha'] }], opts);
  assert.deepEqual(Object.keys(JSON.parse(added.prd).phases[0].tasks[3]).slice(0, 5), ['id', 'title', 'domain', 'lane', 'model']);
  const edited = owner.applyOps(files, [{ op: 'edit', id: 'T9-01', fields: { lane: 'player' } }], opts);
  assert.equal(JSON.parse(edited.prd).phases[0].tasks[0].lane, 'player');
  assert.ok(edited.summary.includes('edited T9-01: lane'));
  assert.throws(() => owner.applyOps(files, [{ op: 'edit', id: 'T9-01', fields: { lane: 'x' } }], opts), /ERROR owner: T9-01: lane has an invalid value/);
});
