export const meta = {
  name: 'task',
  description: 'Run tasks/prd.json tasks in order: spec, check, failing tests, implement, review, ship; park tasks with open design questions; the inline Product Owner step rules on technical, placement, dependency and scope questions and logs every ruling',
  whenToUse:
    'Build Octave tasks end to end. args: {tasks: ["T3-01", "T3-02"], risk: "routine" | "high", native: false} or {lanes: ["workflow", "ui"]} or {task: "T3-01", from: "check" | "tests" | "implement" | "review" | "ship", preFlow: true, notes: [...], evidence: "...", ciSteps: [...], approvedFrozen: [paths], models: {spec: {high: "opus"}}, root: "/abs/path/of/the/folder/holding/the/checkout"}',
  phases: [
    { title: 'Spec', detail: 'refiner writes docs/specs/<TASK>.md' },
    { title: 'Check', detail: 'fresh spec-checker; blocks only on critical or high' },
    { title: 'Tests', detail: 'test-writer commits failing tests and a manifest; the red gate stops the run if one already passes' },
    { title: 'Implement', detail: 'implementer or native-engineer; runs the verify skill' },
    { title: 'Review', detail: 'one round; fix critical, high, medium and small lows; send what is left to the backlog' },
    { title: 'Ship', detail: 'PR, auto-merge on green, clean up' },
  ],
};

// args:
//   {tasks: ["T3-01", ...], risk, native}  run tasks in order
//   {task: "T3-01", risk, native}           run one task
//   {lanes: ["ui", "core"], root, models}   run one to four lanes side by side (lane mode): each lane takes its next ready task when its last one ends, and stops with none-ready, lane-busy, a stop outcome or a denial
//   root: "/abs/dir"                        folder that holds the main checkout (default "..", relative to it)
//   from: "check" | "tests" | "implement" | "review" | "ship"  skip finished phases (single task only); "ship" is only for a task whose review round ran in an earlier run: it runs the sync, then (unless preFlow) the frozen-test and green gates, then Ship
//   preFlow: true                           a branch implemented before the test-first flow: no Tests phase, no manifest required (single task, never inferred)
//   approvedFrozen: [paths]                 frozen test paths a Product Owner ruling already changed (a resumed run)
//   notes: [...]                            spec-check notes for the test writer and the implementer (with from: "tests" or "implement")
//   models: {...}                           per-run model override, deep-merged over MODELS (see below)
//   evidence: "..."                         verify evidence from the finished implementation (with from: "review" or "ship")
//   ciSteps: [...]                          acceptance steps that need a pushed branch or CI runs (with from: "review" or "ship")
// notes reach ONLY the Tests and Implement steps (via specNotes). Spec, check, review, follow-ups and ship never receive them.
// (Check issues are appended to specNotes by the check step itself, so a resumed run with from: "implement" must pass them again.)
// A task whose spec needs a new design call is parked, and the run moves on.
// A resumed branch is rebased onto origin/main by the sync step before Check (never merged); every task's fixture servers are brought down when it ends.
// The run stops early only on STOP_OUTCOMES (a denied command, a test that passes before implementation (tests-green), or a changed frozen test (frozen-tests)), an inline Product Owner ruling with no log entry (ruling-unlogged), or a denied fixture teardown.
// Check and every guarded work step may return productOwnerQuestions; the inline Product Owner step rules on technical, placement, dependency and scope kinds, writes each ruling to tasks/product-owner-log.md and the run goes on. Look, wording and direction questions park the task.
// MODELS-BEGIN (pure; extracted and tested by .claude/workflows/task.test.mjs)
const MODELS = {
  spec: { routine: 'opus', high: 'fable' },
  check: { routine: 'opus', high: 'fable', native: 'fable' },
  implement: { routine: 'sonnet', native: 'opus' },
  review: { routine: 'sonnet', guarded: 'opus' },
  guardian: 'opus',
  ship: 'sonnet',
  escalate: 'fable',
  tests: { routine: 'sonnet', native: 'opus' },
  owner: 'fable',
  gate: 'haiku',
};
const MODEL_NAMES = ['haiku', 'sonnet', 'opus', 'fable'];
function resolveModels(defaults, override) {
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const merge = (base, extra, path) => {
    const out = {};
    for (const key of Object.keys(base)) out[key] = base[key];
    for (const key of Object.keys(extra)) {
      const where = path ? `${path}.${key}` : key;
      if (!path && key === 'owner') throw new Error('models.owner cannot be overridden; a frozen-test ruling always runs on the Product Owner model');
      if (!Object.prototype.hasOwnProperty.call(base, key)) throw new Error(`Unknown models key "${where}". Known: ${Object.keys(base).join(', ')}`);
      if (isObject(base[key])) {
        if (!isObject(extra[key])) throw new Error(`models.${where} must be an object`);
        out[key] = merge(base[key], extra[key], where);
      } else {
        if (!MODEL_NAMES.includes(extra[key])) throw new Error(`models.${where} must be one of ${MODEL_NAMES.join(', ')}; got ${JSON.stringify(extra[key])}`);
        out[key] = extra[key];
      }
    }
    return out;
  };
  if (override === undefined || override === null) return merge(defaults, {}, '');
  if (!isObject(override)) throw new Error('args.models must be an object');
  return merge(defaults, override, '');
}
// MODELS-END
// PATHS-BEGIN (pure; extracted and tested by .claude/workflows/task.test.mjs)
// The repository is octave; each task gets a sibling worktree and branch named by its id.
const REPO = 'octave';
const TASK_ID = /^T\d+-\d{2}$/;
function taskPaths(task, root) {
  if (typeof task !== 'string' || !TASK_ID.test(task)) throw new Error(`Unknown task id ${JSON.stringify(task)}; expected an id such as T3-01`);
  const parent = root || '..';
  const main = root ? `${root}/${REPO}` : '.';
  return { main, worktree: `${parent}/${REPO}-${task}`, branch: `task/${task}`, spec: `docs/specs/${task}.md` };
}
// Paths whose change always needs a guardian review (AGENTS.md: policy, tokens, redaction, native).
const HIGH_RISK_PATH =
  /^(packages\/core\/.*(jellyfin|negotiat|gateway|player|playback|redact|safe-reason|transport|host-class|session|lan-http)|packages\/core\/tests\/fixtures\/(hls-|host-classes)|src\/lib\/jellyfin\/|src\/lib\/player\/|src\/lib\/redact|src\/lib\/safe-reason|src\/lib\/transport-error|src\/lib\/lan-http|src\/domain\/(playback|host-class)|modules\/|apps\/tv\/android\/|docs\/security\.md|tests\/fixtures\/(hls-|host-classes))/;
// Kotlin and native module work goes to native-engineer.
const NATIVE_PATH = /^(modules\/|apps\/tv\/android\/)/;
// PATHS-END
// GATE-BEGIN (pure; extracted and tested by .claude/workflows/task.test.mjs)
// A gate agent relays a script's exit code and its output: one JSON line on stdout, then any ERROR lines from stderr. These functions decide what the run does with it.
const STOP_OUTCOMES = ['denied', 'tests-green', 'frozen-tests'];
// TEARDOWN-BEGIN (pure; extracted and tested by .claude/workflows/task.test.mjs; it also holds the result scanner, which the gates share and decideTeardown needs on its own)
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// The index of the "}" that closes the "{" at start, or -1. Braces inside JSON strings do not count; string state starts outside at every candidate.
function spanEnd(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
// The last JSON object in the output that isResult accepts. The relay may wrap the result in prose, a code fence, log lines or an outer object, so every "{" is a candidate.
// A span is skipped as a whole only when it is the result; otherwise scanning resumes at the next character, so an object nested in a wrapper is still tried.
function readGate(gate, isResult = isObject) {
  if (!gate || typeof gate.exitCode !== 'number' || typeof gate.output !== 'string') return null;
  const text = gate.output;
  let found = null;
  let at = text.indexOf('{');
  while (at !== -1) {
    let next = at + 1;
    const end = spanEnd(text, at);
    if (end !== -1) {
      try {
        const value = JSON.parse(text.slice(at, end + 1));
        if (isObject(value) && isResult(value)) {
          found = value;
          next = end + 1;
        }
      } catch (error) {
        // not JSON; resume at the next character
      }
    }
    at = text.indexOf('{', next);
  }
  return found;
}
const unreadable = (what) => ({ action: 'retry', unreadable: true, detail: `${what} gave no readable result` });
const isTeardownResult = (json) => Array.isArray(json.stopped) && Array.isArray(json.problems);
// fixtures-down.mjs: bring down this worktree's own fixture servers. Never throws; unreadable output is reported as the detail.
function decideTeardown(gate) {
  const none = (detail) => ({ stopped: [], detail });
  try {
    if (gate && Array.isArray(gate.deniedCommands) && gate.deniedCommands.length) return { stopped: [], detail: 'the fixture teardown command was denied', denied: gate.deniedCommands };
    const json = readGate(gate, isTeardownResult);
    if (!json) return none('the fixture teardown gave no readable result');
    const stopped = json.stopped.filter((name) => typeof name === 'string');
    if (json.problems.length) return { stopped, detail: json.problems.join('; ') };
    if (json.ok === false) return { stopped, detail: 'the fixture teardown failed' };
    if (json.note) return { stopped, detail: String(json.note) };
    return { stopped, detail: stopped.length ? `stopped ${stopped.join(', ')}` : 'none running' };
  } catch (error) {
    return none('the fixture teardown gave no readable result');
  }
}
function fixturesDownCommand({ main, worktree }) {
  return `mise exec -- node ${main}/.claude/workflows/fixtures-down.mjs --worktree ${worktree} --compose-file ${main}/tests/integration/docker-compose.yml`;
}
// Runs one task, then always its teardown once, and puts the teardown's report on the result as fixtures. A throw from the run is the outcome "failed"; the teardown never changes the outcome.
async function withTeardown(run, teardown) {
  const message = (error) => (error instanceof Error ? error.message : String(error));
  let out;
  try {
    out = await run();
  } catch (error) {
    out = { outcome: 'failed', detail: message(error) };
  }
  let fixtures;
  try {
    fixtures = await teardown();
  } catch (error) {
    fixtures = { stopped: [], detail: message(error) };
  }
  return { ...out, fixtures };
}
// TEARDOWN-END
const isFlowResult = (json) => typeof json.ok === 'boolean' && Array.isArray(json.problems);
const isRedResult = (json) => Array.isArray(json.red) && Array.isArray(json.green);
const isSyncResult = (json) => typeof json.rebased === 'boolean' && Array.isArray(json.problems);
// check-red.mjs <ID>: every run must be red before implementation. Returns the frozen blob ids and the gated items on pass.
function decideRed(gate) {
  const json = readGate(gate, isRedResult);
  if (!json) return unreadable('the red gate');
  const green = json.green || [];
  const problems = json.problems || [];
  if (green.length) return { action: 'stop', detail: `acceptance items ${green.join(', ')} already pass before any implementation` };
  if (problems.length || gate.exitCode !== 0) return { action: 'retry', detail: problems.join('; ') || `the red gate exited ${gate.exitCode}` };
  return { action: 'pass', detail: '', blobs: json.blobs || {}, gates: json.gates || [] };
}
// check-red.mjs <ID> --expect green, after the follow-ups: every run must pass.
// The decision comes from the JSON result, never from the exit code a gate agent relays (check-red derives its exit code from the same lists).
// Unreadable output is retried by the caller once (final = false), then blocks as unreadable (final = true).
function decideGreen(gate, final) {
  const json = readGate(gate, isRedResult);
  if (!json) return final ? { action: 'blocked', unreadable: true, detail: 'the green gate gave no readable result twice' } : unreadable('the green gate');
  const red = json.red || [];
  const problems = json.problems || [];
  if (!red.length && !problems.length) return { action: 'pass', detail: '' };
  const parts = [];
  if (red.length) parts.push(`acceptance items ${red.join(', ')} still fail`);
  if (problems.length) parts.push(problems.join('; '));
  return { action: 'blocked', detail: parts.join('; ') };
}
// check-flow.mjs --json. approvedPaths: frozen paths a Product Owner ruling changed in this run. pinned: the red gate's blob ids (undefined on a resumed run).
// Unreadable output is retried by the caller once (final = false), then stops the run (final = true).
function decideFrozen(gate, approvedPaths, pinned, final) {
  const json = readGate(gate, isFlowResult);
  if (!json) return final ? { action: 'stop', unreadable: true, detail: 'the frozen-test check gave no readable result twice' } : unreadable('the frozen-test check');
  if (json.missingManifest) return { action: 'blocked', detail: 'no manifest: rerun with from: "tests", or pass preFlow: true for a branch that predates the flow' };
  if (gate.exitCode !== 0 || json.ok !== true) return { action: 'stop', detail: (json.problems || []).join('; ') || `the frozen-test check exited ${gate.exitCode}` };
  // A ruling may name a path absolutely (inside the worktree); check-flow reports it relative to the repo root.
  const approvedPath = (path) => (approvedPaths || []).some((a) => a === path || a.endsWith(`/${path}`));
  const unapproved = (json.changes || []).map((change) => change.path).filter((path) => !approvedPath(path));
  if (unapproved.length) return { action: 'stop', detail: `frozen test changes the Product Owner step did not return: ${unapproved.join(', ')}` };
  if (pinned) {
    const now = {};
    for (const entry of json.frozen || []) now[entry.path] = entry.blob;
    const moved = Object.keys(pinned).filter((path) => !approvedPath(path) && now[path] !== pinned[path]);
    if (moved.length) return { action: 'stop', detail: `frozen files differ from the red gate's versions (an amended or squashed freeze commit): ${moved.join(', ')}` };
  }
  return { action: 'pass', detail: '' };
}
// The branch sync script: rebase a resumed branch onto origin/main. Blocks on any problem (a merge commit, a conflict, uncommitted changes, a moved frozen file).
function decideSync(gate, final) {
  const json = readGate(gate, isSyncResult);
  if (!json) return final ? { action: 'blocked', detail: 'the branch sync gave no readable result twice' } : unreadable('the branch sync');
  if (gate.exitCode !== 0 || json.ok !== true || json.problems.length) return { action: 'blocked', detail: json.problems.join('; ') || `the branch sync exited ${gate.exitCode}` };
  return { action: 'pass', detail: '', rebased: json.rebased };
}
// The ruling log script: ruling-log.mjs --commit <sha> checks that a ruling reached tasks/product-owner-log.md on the task branch.
const RULING_UNLOGGED = 'ruling-unlogged';
const isRulingLogResult = (json) => typeof json.ok === 'boolean' && Array.isArray(json.problems);
// Decided from the JSON result only, never from the exit code a gate agent relays. Unreadable output is retried once by the caller (final = false), then stops the run (final = true).
function decideRulingLog(gate, final) {
  const json = readGate(gate, isRulingLogResult);
  if (!json) return final ? { action: 'stop', unreadable: true, detail: 'the ruling log check gave no readable result twice' } : unreadable('the ruling log check');
  if (json.ok === true && json.problems.length === 0) return { action: 'pass', detail: '', commit: json.commit };
  return { action: 'stop', detail: json.problems.join('; ') || 'the ruling log check failed' };
}
// ruling-log.mjs --history: the task's earlier rulings, so a resumed run keeps counting the same rules. Unreadable output ends as {action: 'none'}: the run goes on with no earlier rulings.
const isRulingHistory = (json) => typeof json.sections === 'number' && isObject(json.counts) && isObject(json.firstRulings);
function decideRulingHistory(gate, final) {
  const json = readGate(gate, isRulingHistory);
  if (!json) return final ? { action: 'none', detail: 'the ruling history gave no readable result twice' } : unreadable('the ruling history');
  return { action: 'pass', detail: '', sections: json.sections, counts: json.counts, firstRulings: json.firstRulings, commits: Array.isArray(json.commits) ? json.commits.filter((c) => typeof c === 'string') : [] };
}
// GATE-END
// STEP-BEGIN (pure; extracted and tested by .claude/workflows/task.test.mjs)
const mergeUnique = (a, b) => (a || []).concat(b || []).filter((item, i, all) => all.indexOf(item) === i);
// Decide what a work() attempt leads to. A check that fails locally is never CI-only: ciOnly counts only when done and checksPassed are both true.
//   denied: stop; owner: the work reports frozen tests that look wrong; ask: the work stops at a question for the Product Owner (no retry, no escalation); done: green, ciOnly items (if any) go to Ship as steps; retry: not green, so retry or escalate.
//   The order is none, denied, owner, ask, done, retry.
function decideStep(out, isDenied) {
  if (!out) return { action: 'none', ciOnly: [] };
  if (isDenied) return { action: 'denied', ciOnly: [] };
  if (out.frozenTestProblems && out.frozenTestProblems.length) return { action: 'owner', ciOnly: [] };
  if (out.productOwnerQuestions && out.productOwnerQuestions.length) return { action: 'ask', ciOnly: [] };
  const problems = (out.blockers || []).concat(out.failures || []);
  const green = out.done === true && out.checksPassed === true && problems.length === 0;
  if (green) return { action: 'done', ciOnly: out.ciOnly || [] };
  return { action: 'retry', ciOnly: [] };
}
// Why a result is not green, never empty: its blockers and failures, else the flag that failed, plus any ciOnly items that are not handed to Ship.
function whyNotGreen(out, step) {
  const why = (out.blockers || []).concat(out.failures || []);
  if (!why.length) why.push(out.done !== true ? `the ${step} step did not report done` : `the ${step} step reported checks not passed but listed no failure`);
  if ((out.ciOnly || []).length) why.push(`ciOnly items on a result that was not green, not handed to Ship: ${out.ciOnly.join('; ')}`);
  return why;
}
// STEP-END
// RULING-BEGIN (pure; extracted and tested by .claude/workflows/task-rulings.test.mjs)
const OWNER_KINDS = ['look', 'wording', 'direction'];
const PO_KINDS = ['technical', 'placement', 'dependency', 'scope'];
const MAX_RULINGS = 6;
// The rule a question is about, compared without case, extra spaces or trailing punctuation. ruling-log.mjs keeps the same normalisation by hand.
const ruleKey = (rule) => String(rule).trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '');
const describeQuestion = (q) => `${q.kind}: ${q.question} (rule: ${ruleKey(q.rule)})`;
// Splits one return's questions: forOwner (look, wording, direction, or an unknown kind), block (a third return on a rule, or the cap), ask (for the step).
// counts: returns per key before this one; firstRulings: the first ruling per key; total: inline rulings made so far.
function planRuling(questions, counts, firstRulings, total) {
  const has = (map, key) => Object.prototype.hasOwnProperty.call(map, key);
  const plan = { forOwner: [], block: [], ask: [] };
  for (const q of questions || []) {
    const key = ruleKey(q.rule);
    const count = (has(counts, key) ? counts[key] : 0) + 1;
    if (!PO_KINDS.includes(q.kind)) plan.forOwner.push(describeQuestion(q));
    else if (count >= 3) plan.block.push(describeQuestion(q));
    else plan.ask.push({ kind: q.kind, rule: q.rule, question: q.question, key, count, probe: count === 2, first: count > 1 && has(firstRulings, key) ? firstRulings[key] : undefined });
  }
  if (plan.ask.length && total >= MAX_RULINGS) {
    plan.block = [`more than ${MAX_RULINGS} Product Owner rulings in one run`].concat(plan.block, plan.ask.map(describeQuestion));
    plan.ask = [];
  }
  return plan;
}
// RULING-END
// LEFT-BEGIN (pure; extracted and tested by .claude/workflows/task-followups.test.mjs)
// What the follow-ups step left unfixed. Only lows may be left; a left finding that opens a path into a self-hoster's home network or leaks local information is a real-TV gate.
const REAL_TV_GATES = ['home-network', 'local-information'];
function planLeft(leftFindings) {
  const left = Array.isArray(leftFindings) ? leftFindings : [];
  const unfixed = left.filter((finding) => finding.severity !== 'low');
  const gates = [];
  const problems = [];
  for (const finding of left) {
    const kind = finding.realTvGate;
    if (kind === undefined || kind === null || kind === 'none') continue;
    if (REAL_TV_GATES.includes(kind)) gates.push({ severity: finding.severity, where: finding.where, summary: finding.summary, holds: kind });
    else problems.push(`unknown realTvGate "${kind}" on ${finding.where}: ${finding.summary}`);
  }
  return { left, unfixed, gates, problems };
}
// How many lows the review returned are neither reported fixed nor listed as left. The run does not block on it (a missing field must not stop a task), but it shows the count so a silent gap is visible.
function unaccountedLows(lowCount, followUp) {
  const out = followUp || {};
  const fixed = Array.isArray(out.fixedFindings) ? out.fixedFindings.length : 0;
  const leftLows = (Array.isArray(out.leftFindings) ? out.leftFindings : []).filter((finding) => finding.severity === 'low').length;
  return Math.max(0, lowCount - fixed - leftLows);
}
// LEFT-END
// LANES-BEGIN (pure; extracted and tested by .claude/workflows/task-lanes.test.mjs)
// A task's lane (tasks/prd.json) and the lane runner's decisions. A workflow script cannot import, so LANES and SERIAL_LANES are copies of
// scripts/task.mjs; task-lanes.test.mjs keeps them equal. At most one serial lane has a task running at a time (AGENTS.md: native module,
// player and on-device work stay serial). MAX_LANES is WORKFLOW.md's cap of four concurrent streams.
const LANES = ['workflow', 'core', 'ui', 'apk-checks', 'tv-scripts', 'release', 'native-session', 'player', 'device'];
const SERIAL_LANES = ['native-session', 'player', 'device'];
const MAX_LANES = 4;
// What is wrong with args.lanes, as a list of problems (empty when it is fine).
function checkLaneArgs(value) {
  const problems = [];
  const lanes = value && value.lanes;
  if (!Array.isArray(lanes) || !lanes.length) problems.push('lanes must list one to four lane names');
  else {
    if (lanes.length > MAX_LANES) problems.push(`lanes lists ${lanes.length} lanes; the cap is ${MAX_LANES}`);
    const unknown = lanes.filter((lane) => !LANES.includes(lane));
    if (unknown.length) problems.push(`unknown lane ${unknown.map((lane) => JSON.stringify(lane)).join(', ')}; the lanes are ${LANES.join(', ')}`);
    if (lanes.some((lane, i) => lanes.indexOf(lane) !== i)) problems.push('lanes lists a lane twice');
  }
  if (value && (value.task || value.tasks)) problems.push('lanes cannot be combined with task or tasks');
  return problems;
}
// lane-state.mjs: what a lane can take next, from origin/main.
const isLaneState = (json) => typeof json.ok === 'boolean' && typeof json.lane === 'string' && Array.isArray(json.tasks) && Array.isArray(json.inFlight) && Array.isArray(json.problems);
// Decided from the JSON result, never from the exit code alone. Unreadable output is retried once by the caller (final = false), then blocks (final = true).
function decideLaneState(gate, final) {
  if (gate && Array.isArray(gate.deniedCommands) && gate.deniedCommands.length) return { action: 'denied', detail: gate.deniedCommands };
  const json = readGate(gate, isLaneState);
  if (!json) return final ? { action: 'blocked', unreadable: true, detail: 'the lane-state check gave no readable result twice' } : unreadable('the lane-state check');
  if (gate.exitCode !== 0 || json.ok !== true || json.problems.length) return { action: 'blocked', detail: json.problems.join('; ') || `the lane-state check exited ${gate.exitCode}` };
  return { action: 'pass', detail: '', json };
}
// How a lane's task runs: native-session and player work is native (native-engineer and a guardian review), a fable task is high risk.
function routeFor(lane, task) {
  return { risk: task && task.model === 'fable' ? 'high' : 'routine', native: lane === 'native-session' || lane === 'player' };
}
// One decision for a lane, from its fresh snapshot and the run's state: {laneStates, attempted (Set of ids), slotHolder (lane or null), halted}.
// Returns {action: 'run', task, risk, native}, {action: 'wait', why: 'serial' | 'dependency'} or {action: 'stop', why, waiting?}.
function pickLane({ state, lane, snapshot }) {
  if (state.halted) return { action: 'stop', why: 'halted' };
  const busy = snapshot.inFlight.filter((entry) => !state.attempted.has(entry.id));
  if (busy.length) return { action: 'stop', why: 'lane-busy', inFlight: busy };
  const open = snapshot.tasks.filter((task) => !state.attempted.has(task.id));
  const candidate = open.find((task) => !task.waitingOn.length);
  if (candidate) {
    const serial = snapshot.serial === true || SERIAL_LANES.includes(lane);
    if (serial && state.slotHolder !== null && state.slotHolder !== lane) return { action: 'wait', why: 'serial' };
    return { action: 'run', task: candidate, ...routeFor(lane, candidate) };
  }
  const others = Object.keys(state.laneStates).filter((other) => other !== lane && ['querying', 'running'].includes(state.laneStates[other]));
  if (others.length) return { action: 'wait', why: 'dependency' };
  return { action: 'stop', why: 'none-ready', waiting: open.map((task) => ({ id: task.id, waitingOn: task.waitingOn })) };
}
// LANES-END
const input = typeof args === 'string' ? { task: args } : args || {};
const items = Array.isArray(input.tasks) ? input.tasks : input.task ? [input.task] : [];
const models = resolveModels(MODELS, input.models);
if (input.lanes !== undefined) {
  const laneProblems = checkLaneArgs(input);
  if (laneProblems.length) return { stopped: 'bad-args', detail: laneProblems.join('; ') };
} else if (!items.length) return { stopped: 'no-task', detail: 'Pass args: {tasks: ["<ID>", ...]}, {task: "<ID>"} or {lanes: ["<lane>", ...]}' };

const strings = { type: 'array', items: { type: 'string' } };
const SPEC = {
  type: 'object',
  properties: { summary: { type: 'string' }, openQuestions: strings, deniedCommands: strings, touchesNative: { type: 'boolean' } },
  required: ['summary', 'openQuestions', 'touchesNative'],
};
const QUESTIONS = {
  type: 'array',
  items: {
    type: 'object',
    properties: { kind: { type: 'string', enum: OWNER_KINDS.concat(PO_KINDS) }, rule: { type: 'string' }, question: { type: 'string' } },
    required: ['kind', 'rule', 'question'],
  },
};
const CHECK = {
  type: 'object',
  properties: { approved: { type: 'boolean' }, issues: strings, touchesNative: { type: 'boolean' }, productOwnerQuestions: QUESTIONS },
  required: ['approved', 'issues', 'touchesNative'],
};
const WORK = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    checksPassed: { type: 'boolean' },
    summary: { type: 'string' },
    evidence: { type: 'string' },
    failures: strings,
    ciOnly: strings,
    blockers: strings,
    deniedCommands: strings,
    ciSteps: strings,
    frozenTestProblems: strings,
    productOwnerQuestions: QUESTIONS,
    fixedFindings: {
      type: 'array',
      items: { type: 'object', properties: { where: { type: 'string' }, summary: { type: 'string' } }, required: ['where', 'summary'] },
    },
    leftFindings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          where: { type: 'string' },
          summary: { type: 'string' },
          realTvGate: { type: 'string', enum: ['home-network', 'local-information', 'none'] },
        },
        required: ['severity', 'where', 'summary'],
      },
    },
  },
  required: ['done', 'checksPassed', 'summary', 'evidence'],
};
const TESTS = {
  type: 'object',
  properties: { done: { type: 'boolean' }, summary: { type: 'string' }, blockers: strings, deniedCommands: strings },
  required: ['done', 'summary'],
};
const GATE = {
  type: 'object',
  properties: { exitCode: { type: 'integer' }, output: { type: 'string' }, deniedCommands: strings },
  required: ['exitCode', 'output'],
};
const RULING = {
  type: 'object',
  properties: {
    rulings: strings,
    changed: strings,
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { rule: { type: 'string' }, ruling: { type: 'string' }, probe: { type: 'object', properties: { what: { type: 'string' }, found: { type: 'string' } } } },
        required: ['rule', 'ruling'],
      },
    },
    forOwner: strings,
    needsPass: strings,
    logCommit: { type: 'string' },
    deniedCommands: strings,
  },
  required: ['rulings', 'changed', 'logCommit'],
};
const REVIEW = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          where: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['severity', 'where', 'summary'],
      },
    },
    needsGuardian: { type: 'boolean' },
    filesChanged: strings,
  },
  required: ['findings', 'filesChanged'],
};
const SHIP = {
  type: 'object',
  properties: { prUrl: { type: 'string' }, merged: { type: 'boolean' }, ciFailures: strings, deniedCommands: strings },
  required: ['merged'],
};

const denied = (result) => (result && result.deniedCommands && result.deniedCommands.length ? result.deniedCommands : null);
const numbered = (list) => list.map((item, i) => `${i + 1}. ${item}`).join('\n');
const VERIFY_STEPS =
  'Run the verify skill before you return: mise exec -- pnpm check. When the diff touches negotiation or reporting, also pnpm test:tripwire against the pinned servers. When these commands exist, also run: pnpm tv:native:test if the diff touches Kotlin or a native module; pnpm tv:e2e on a free emulator if it touches the app; the task\'s wire test with pnpm tv:wire against the pinned Jellyscale if the task\'s verify names it (a playback task passes only when it passes); pnpm tv:visual if it touches screens, shared controls, or design tokens. Never run pkill or killall: stop only processes you started, with TaskStop or their own PID. One agent at a time on an emulator or device serial. If a test fails, rerun it alone and on origin/main before blaming or fixing the change, and say which in the evidence. Return checksPassed, the evidence (commands with their result lines), and each failure with file:line.';

async function runTask(task, opts) {
  const highRisk = opts.risk === 'high';
  let native = opts.native === true;
  const skipReview = opts.from === 'ship';
  const skipImpl = opts.from === 'review' || skipReview;
  const skipTests = opts.from === 'implement' || skipImpl || opts.preFlow === true;
  const skipCheck = opts.from === 'tests' || skipTests;
  const skipSpec = opts.from === 'check' || skipCheck;
  let specNotes = Array.isArray(opts.notes) ? opts.notes : [];

  let specModel, checkModel, testsModel, implAgent, implModel, reviewAgent, reviewModel;
  const route = () => {
    specModel = highRisk ? models.spec.high : models.spec.routine;
    checkModel = native ? models.check.native : highRisk ? models.check.high : models.check.routine;
    testsModel = native ? models.tests.native : models.tests.routine;
    implAgent = native ? 'native-engineer' : 'implementer';
    implModel = native ? models.implement.native : models.implement.routine;
    reviewAgent = native || highRisk ? 'guardian' : 'reviewer';
    reviewModel = native || highRisk ? models.review.guarded : models.review.routine;
  };
  route();
  log(`${task}: models ${JSON.stringify(models)}`);
  // Native work (Kotlin under modules/ or apps/tv/android, or the PlayerEngine port) goes to native-engineer on Opus with a guardian review (AGENTS.md).
  const goNative = (flag, by) => {
    if (flag && !native) {
      native = true;
      route();
      log(`${task}: the ${by} touches native code or the PlayerEngine port; routing to native-engineer and guardian`);
    }
  };

  const { main, worktree, branch, spec } = taskPaths(task, opts.root);
  const taskCli = `mise exec -- node ${worktree}/scripts/task.mjs`;
  const evidenceRule = 'The evidence must name the PR (PR #n) or a commit (commit <sha>) and stay within 600 characters; move longer notes to the PR body. Write it to a file outside the repo (mktemp) and pass it with --evidence-file.';
  const where = opts.root ? '' : ' Relative paths are relative to the main checkout, which is your starting directory.';
  const common = `Task ${task} in tasks/prd.json (read it with \`${taskCli} show ${task}\`; never read the whole file). Worktree: ${worktree} (branch ${branch}).${where} Spec: ${spec} in that worktree. Work only in that worktree. Answered questions in docs/specs/decisions-*.md and decisions the spec marks as confirmed by the human are settled human decisions. If a command is denied, report it in deniedCommands and do not work around it. Never merge origin/main or any other branch into the task branch (a merge breaks the rebase-only merge of the PR); only the branch sync step and Ship rebase it.`;
  // What the review's follow-ups step left, and the real-TV gates among it; they stay [] when no review ran (from: "ship").
  let left = [];
  let realTvGates = [];
  let unaccounted = 0;
  const result = (outcome, detail) => {
    log(`${task}: ${outcome}`);
    const out = realTvGates.length ? { task, outcome, detail, realTvGates } : { task, outcome, detail };
    return unaccounted ? { ...out, unaccountedLows: unaccounted } : out;
  };

  // Lane mode only (opts.halted and opts.holdSerial are undefined for {task} and {tasks}): a denial anywhere halts every lane at the next phase boundary,
  // and a task that turns out native in a parallel lane takes the serial slot before its next work step.
  const halted = (phase) => (opts.halted && opts.halted() ? result('halted', { from: phase }) : null);
  let reviewNative = false;
  const holdSlot = async () => {
    if ((native || reviewNative) && opts.holdSerial) await opts.holdSerial();
  };
  // A lane that waited in the slot queue may have been halted meanwhile (a denial in the lane that held the slot): check again once the slot is held.
  const holdSlotOrHalt = async (phase) => {
    await holdSlot();
    return halted(phase);
  };
  const problemsOf = (out) => (out.blockers || []).concat(out.failures || []);
  const stepOf = (out) => decideStep(out, !!out && !!denied(out));
  // Implementation step with one retry and an escalation: used for implement, check fixes, and CI fixes.
  // ciOnly items (only a CI run can produce them, reported with every local check green) count only on a green result; callers read them through decideStep.
  const work = async (prompt, label, phaseTitle) => {
    const attempt = (text, model, name) => agent(`${common}\n${text}\n${VERIFY_STEPS}`, { agentType: implAgent, model, schema: WORK, phase: phaseTitle, label: name });
    let out = await attempt(prompt, implModel, label);
    if (stepOf(out).action === 'retry') {
      log(`${task}: ${label} not green; one more try, then escalating to ${models.escalate}`);
      out = await attempt(`Finish this work: ${prompt}\nThe last attempt left these problems:\n${numbered(problemsOf(out))}`, implModel, `${label} (retry)`);
      if (stepOf(out).action === 'retry') {
        out = await attempt(`Two attempts failed. Finish this work: ${prompt}\nRemaining problems:\n${numbered(problemsOf(out))}`, models.escalate, `${label} (${models.escalate})`);
      }
    }
    return out;
  };

  // Gates: a small agent with no agent type relays one command's exit code and output; the pure decide functions judge it.
  const nodeCli = (script) => `mise exec -- node ${worktree}/scripts/${script}`;
  const redCommand = `mise exec -- node ${worktree}/scripts/check-red.mjs ${task} --repo ${worktree}`;
  const flowCommand = `${nodeCli('check-flow.mjs')} --repo ${worktree}${opts.preFlow ? '' : ` --task ${task}`} --json`;
  const gate = (command, label, phase) =>
    agent(`Run exactly this command, change nothing, and return its exit code as exitCode and everything it printed, unchanged and in full, as output (the JSON line on standard output must be in it; ERROR lines may follow): ${command}\nIf a command is denied, report it in deniedCommands and do not work around it.`, { model: models.gate, schema: GATE, phase, label });
  const runGate = async (command, label, phase, decide, run = gate) => {
    let out = await run(command, label, phase);
    if (denied(out)) return { action: 'denied', detail: denied(out) };
    let decision = decide(out, false);
    if (decision.unreadable) {
      log(`${task}: ${label} gave no readable result; running it once more`);
      out = await run(command, `${label} (again)`, phase);
      if (denied(out)) return { action: 'denied', detail: denied(out) };
      decision = decide(out, true);
    }
    return decision;
  };
  // The sync command rebases the task branch, so its gate agent is told that changing the branch is expected (const gate says "change nothing").
  const syncGate = (command, label, phase) =>
    agent(`Run exactly this command and return its exit code as exitCode and everything it printed, unchanged and in full, as output (the JSON line on standard output must be in it; ERROR lines may follow). The command itself rebases the task branch onto origin/main when the branch is behind, so a changed branch is expected; change nothing else.${where} If a command is denied, report it in deniedCommands and do not work around it: ${command}`, { model: models.gate, schema: GATE, phase, label });
  let pinned;
  let gated = [];
  let frozenRulingUsed = false;
  const approved = Array.isArray(opts.approvedFrozen) ? opts.approvedFrozen.slice() : [];
  // Inline Product Owner state for this run. The counts start from the task's own sections of tasks/product-owner-log.md (read once, before the first ruling), so a resumed run keeps counting.
  let seeded = false;
  let totalRulings = 0;
  const ruleCounts = {};
  const firstRulings = {};
  const rulingNotes = [];
  const usedCommits = [];
  const kindList = OWNER_KINDS.concat(PO_KINDS).join(', ');
  const askRule = () =>
    `If you need a ruling, stop at the first question, change nothing to work around it, and return it in productOwnerQuestions. Each question has a kind (${kindList}; technical, placement, dependency and scope go to the Product Owner step, look, wording and direction park the task for the owner), the rule it is about (<file>:<heading>, acceptance <n>, or the key of an earlier ruling, reused exactly) and the question. Earlier rulings of this task are in the sections headed "## <date>, ${task} ruling" of tasks/product-owner-log.md on the branch; read them before you ask.${rulingNotes.length ? `\nRulings so far in this run (reuse a key when the question is about the same rule):\n${rulingNotes.join('\n')}` : ''}`;
  const frozenRule = `Never change or delete a file listed in docs/specs/${task}.tests.json; add tests in new files. If a frozen test is wrong, change nothing and return it in frozenTestProblems.`;
  const rulingLogCommand = (commit) => `mise exec -- node ${main}/.claude/workflows/ruling-log.mjs --repo ${worktree} --task ${task} --commit ${commit}`;
  const rulingHistoryCommand = `mise exec -- node ${main}/.claude/workflows/ruling-log.mjs --repo ${worktree} --task ${task} --history`;
  // One inline Product Owner ruling for a return: frozen-test problems and/or questions. It returns {lines, notes} for the caller, or {stop} holding the task's result.
  // The order: frozen limit, the split (owner kinds park, a third return or the cap blocks), the step, forOwner and needsPass, the log entry, the probe, then the counts.
  const ownerRuling = async ({ frozen, questions, phase }) => {
    if (frozen.length && frozenRulingUsed) return { stop: result('blocked', frozen) };
    if (!seeded) {
      seeded = true;
      const history = await runGate(rulingHistoryCommand, `ruling history ${task}`, phase, decideRulingHistory);
      if (history.action === 'denied') return { stop: result('denied', history.detail) };
      if (history.action === 'pass') {
        totalRulings = history.sections;
        for (const key of Object.keys(history.counts)) ruleCounts[key] = history.counts[key];
        for (const key of Object.keys(history.firstRulings)) firstRulings[key] = history.firstRulings[key];
        for (const sha of history.commits) usedCommits.push(sha);
      } else log(`${task}: no readable ruling history; counting rulings from this run only`);
    }
    const plan = planRuling(questions, ruleCounts, firstRulings, totalRulings);
    if (plan.forOwner.length) return { stop: result('parked', plan.forOwner) };
    if (plan.block.length) return { stop: result('blocked', plan.block) };
    const asked = plan.ask.map((entry, i) => `${i + 1}. [${entry.key}] ${entry.kind}: ${entry.question}${entry.probe ? `\nThis rule was ruled before: ${entry.first || 'see the log'}. Before you rule, probe the fact: run the command or read the file, and put what you ran or read and a quote of what you found in probe.` : ''}`);
    const ruling = await agent(
      `${common}
You are the Product Owner. The ${phase} step of a task run reports the following for you.${frozen.length ? `\nFrozen tests that look wrong:\n${numbered(frozen)}\nThe frozen files are listed in docs/specs/${task}.tests.json. Change a test only when it contradicts the acceptance item or the spec; edit it (and the manifest when the file list changes) and commit with one trailer line per changed path: "Frozen-Test-Change: <path> -- <reason>". Otherwise leave it and say why. Return changed (every path you changed) and one line in rulings per reported test.` : ''}${asked.length ? `\nQuestions, each with the rule it is about in brackets:\n${asked.join('\n')}\nRule on technical, placement, dependency and scope questions. Return answers: one {rule, ruling, probe: {what, found}} per question, with rule exactly as written in the brackets.` : ''}
A question you judge to be a look, wording or direction question is not yours to rule: return it in forOwner. A question that only an acceptance or task-list edit can answer goes in needsPass: append a backlog line for it to tasks/backlog.jsonl in the same commit as your log section. Never touch tasks/prd.json.
Log every ruling: append a section headed "## <date from date +%F>, ${task} ruling, ${phase}" to tasks/product-owner-log.md, with one line per ruling in the form "- [<rule key>] <ruling> | reason: <why> | probe: <what you ran or read, and a quote of what you found>" (for a frozen test use "- [frozen-test] <path>: <ruling> | reason: <why>"). Never write a server address, a hostname, a LAN address, a credential, a token or the owner's name in it. Commit the log on the task branch (with the Frozen-Test-Change trailers when you changed a frozen test), leave nothing in it uncommitted, and return the commit's sha as logCommit.`,
      { agentType: 'product-owner', model: models.owner, schema: RULING, phase, label: `owner ruling ${task}` },
    );
    if (!ruling) return { stop: result('failed', 'The Product Owner returned nothing.') };
    if (denied(ruling)) return { stop: result('denied', denied(ruling)) };
    if (frozen.length) frozenRulingUsed = true;
    if ((ruling.forOwner || []).length) return { stop: result('parked', ruling.forOwner) };
    if ((ruling.needsPass || []).length) return { stop: result('blocked', ruling.needsPass) };
    const commit = typeof ruling.logCommit === 'string' ? ruling.logCommit.trim() : '';
    if (!/^[0-9a-f]{7,40}$/i.test(commit)) return { stop: result(RULING_UNLOGGED, 'The Product Owner returned no valid logCommit for its ruling.') };
    if (usedCommits.some((used) => used.toLowerCase().startsWith(commit.toLowerCase()) || commit.toLowerCase().startsWith(used.toLowerCase()))) return { stop: result(RULING_UNLOGGED, `The ruling returned the logCommit ${commit} of an earlier ruling, so it has no log entry of its own.`) };
    const logged = await runGate(rulingLogCommand(commit), `ruling log ${task}`, phase, decideRulingLog);
    if (logged.action === 'denied') return { stop: result('denied', logged.detail) };
    if (logged.action !== 'pass') return { stop: result(RULING_UNLOGGED, logged.detail) };
    usedCommits.push(commit);
    const byKey = {};
    for (const answer of ruling.answers || []) if (answer && typeof answer.rule === 'string' && !Object.prototype.hasOwnProperty.call(byKey, ruleKey(answer.rule))) byKey[ruleKey(answer.rule)] = answer;
    const missing = [];
    for (const entry of plan.ask) {
      const answer = byKey[entry.key];
      if (!answer || !String(answer.ruling || '').trim()) missing.push(`the Product Owner gave no answer for the rule ${entry.key}`);
      else if (entry.probe && !(answer.probe && String(answer.probe.found || '').trim())) missing.push(`the Product Owner gave no probe finding for the rule ${entry.key}, which was ruled on before`);
    }
    if (missing.length) return { stop: result('blocked', missing.concat(plan.ask.map(describeQuestion))) };
    totalRulings += 1;
    for (const path of ruling.changed || []) if (!approved.includes(path)) approved.push(path);
    const lines = frozen.length ? (ruling.rulings || []).slice() : [];
    const notes = [];
    for (const entry of plan.ask) {
      const text = String(byKey[entry.key].ruling).trim();
      ruleCounts[entry.key] = Math.max(ruleCounts[entry.key] || 0, entry.count);
      if (!Object.prototype.hasOwnProperty.call(firstRulings, entry.key)) firstRulings[entry.key] = text;
      lines.push(`[${entry.key}] ${text}`);
      notes.push(`Product Owner ruling (${entry.rule}): ${text}`);
      rulingNotes.push(`- ${entry.key}: ${text}`);
    }
    return { lines, notes };
  };
  // Every work() call goes through guarded: a wrong frozen test gets one Product Owner ruling and a question gets a ruling too (each ruling is logged), then the frozen-test gate runs.
  // It returns {out} for the caller, or {stop} holding the task's result (blocked, parked, frozen-tests, ruling-unlogged, denied or failed).
  const guarded = async (prompt, label, phase) => {
    const run = (text, name) => work(`${text}\n${frozenRule}\n${askRule()}`, name, phase);
    let out = await run(prompt, label);
    let round = 0;
    let ruledLines = [];
    while (['owner', 'ask'].includes(stepOf(out).action)) {
      const ruled = await ownerRuling({ frozen: out.frozenTestProblems || [], questions: out.productOwnerQuestions || [], phase });
      if (ruled.stop) return ruled;
      round += 1;
      ruledLines = ruledLines.concat(ruled.lines);
      out = await run(`${prompt}\nThe Product Owner ruled:\n${numbered(ruledLines)}`, `${label} (after ruling${round > 1 ? ` ${round}` : ''})`);
    }
    if (!out || denied(out)) return { out };
    const flow = await runGate(flowCommand, `frozen gate ${task}`, phase, (gateOut, final) => decideFrozen(gateOut, approved, pinned, final));
    if (flow.action === 'denied') return { stop: result('denied', flow.detail) };
    if (flow.action === 'stop') return { stop: result('frozen-tests', flow.detail) };
    if (flow.action !== 'pass') return { stop: result('blocked', flow.detail) };
    return { out };
  };

  // 1. Spec
  if (!skipSpec) {
    const specResult = await agent(
      `${common}
Create the worktree if it is missing: git -C ${main} fetch -q && git worktree add ${worktree} -b ${branch} origin/main (run from the main checkout).
If a task in this task's depends_on is not done on origin/main, return that as the only open question ("blocked by <ID>").
If ${spec} already exists with every section, keep it and report on it. Otherwise write it. Do not commit.
Resolve gaps yourself from the task, the code, the docs, and the settled decisions, and write the answers into the spec. Return as open questions only product or design choices the human must make that no settled decision covers; give each its options and a recommendation. Set touchesNative=true if the spec's files to touch include anything under modules/ or apps/tv/android/, or the PlayerEngine port (the engine interface in packages/core/src/domain/playback.ts).`,
      { agentType: 'refiner', model: specModel, schema: SPEC, phase: 'Spec', label: `spec ${task}` },
    );
    if (!specResult) return result('failed', 'The refiner returned nothing.');
    if (denied(specResult)) return result('denied', denied(specResult));
    if (specResult.openQuestions.length) return result('parked', specResult.openQuestions);
    goNative(specResult.touchesNative, 'spec');
  }

  const haltedBeforeCheck = skipCheck ? null : halted('check');
  if (haltedBeforeCheck) return haltedBeforeCheck;

  // Branch sync: a resumed branch that is behind origin/main is rebased onto it (freeze commit kept first, never a merge); a branch that holds a merge of main is blocked.
  const syncCommand = `mise exec -- node ${main}/.claude/workflows/branch-sync.mjs --repo ${worktree} --task ${task}`;
  const sync = await runGate(syncCommand, `sync ${task}`, skipReview ? 'Ship' : skipSpec ? 'Check' : 'Spec', decideSync, syncGate);
  if (sync.action === 'denied') return result('denied', sync.detail);
  if (sync.action !== 'pass') return result('blocked', sync.detail);
  if (sync.rebased) log(`${task}: rebased onto origin/main`);

  // 2. Check
  if (!skipCheck) {
    const check = await agent(
      `${common}
Check the spec and append your "## Spec check" verdict to it. Set approved=true unless an issue is critical or high; list medium and low issues anyway, prefixed with their severity, and the implementer will resolve them. Return approved and the numbered issues. Return a question the spec cannot settle in productOwnerQuestions, not in issues: each has a kind (${kindList}; technical, placement, dependency and scope go to the Product Owner step, look, wording and direction park the task for the owner), the rule it is about (<file>:<heading> or acceptance <n>) and the question. Set touchesNative=true if the spec's files to touch include anything under modules/ or apps/tv/android/, or the PlayerEngine port (the engine interface in packages/core/src/domain/playback.ts).`,
      { agentType: 'spec-checker', model: checkModel, schema: CHECK, phase: 'Check', label: `check ${task}` },
    );
    if (!check) return result('failed', 'The spec-checker returned nothing.');
    goNative(check.touchesNative, 'spec check');
    let rulingsOfCheck = [];
    if ((check.productOwnerQuestions || []).length) {
      const asked = await ownerRuling({ frozen: [], questions: check.productOwnerQuestions, phase: 'Check' });
      if (asked.stop) return asked.stop;
      rulingsOfCheck = asked.notes;
    }
    if (!check.approved) {
      const revised = await agent(
        `${common}
The spec check found critical or high issues. Revise the spec to fix them and remove the old "## Spec check" section.
${numbered(check.issues)}${rulingsOfCheck.length ? `\nThe Product Owner ruled on questions of the check:\n${rulingsOfCheck.join('\n')}` : ''}
Return as open questions only product or design choices the human must make that no settled decision covers.`,
        { agentType: 'refiner', model: specModel, schema: SPEC, phase: 'Check', label: `revise ${task}` },
      );
      if (!revised) return result('failed', 'The spec revision returned nothing.');
      if (revised.openQuestions.length) return result('parked', revised.openQuestions);
      specNotes = specNotes.concat(['The spec was revised after a check; re-read it before implementing.'], rulingsOfCheck);
    } else {
      specNotes = specNotes.concat(check.issues, rulingsOfCheck);
    }
  }

  // 2b. Tests: failing tests first, frozen in one commit; the red gate stops the run if any already passes
  const testsPrompt = `${common}
Write the failing tests for ${task}: turn each acceptance item of the spec's Acceptance table into behaviour-level tests, following its Test plan. Write no implementation and no stub. Search the existing tests for expectations the spec changes and update them in the same commit.
Write the manifest docs/specs/${task}.tests.json as .claude/agents/test-writer.md describes: files, and one entry per acceptance item numbered from 1, each a run (an argument list starting with node or pnpm that selects only that item's tests) or a gate that the spec names with "gate: <kind>" in the item's Acceptance row. Add no gate the spec does not name.
Run each run and confirm it fails for the intended reason.
Commit the tests, fixtures and manifest as one commit with the subject "test(${task}): freeze failing acceptance tests". If docs/specs/${task}.tests.json already exists on this branch (a rerun), amend the freeze commit with git commit --amend instead of adding a commit that touches the manifest or a test.${specNotes.length ? `\nSpec-check notes:\n${specNotes.join('\n')}` : ''}
Do not push. Return done=true once committed, and put anything that stops you in blockers.`;
  const testsRetry = (problems) => `${testsPrompt}\nThe red gate found these problems with the frozen tests:\n${problems}\nFix them and amend the freeze commit with git commit --amend; a second commit that touches the manifest or a test fails the frozen check.`;
  const writeTests = (text, label) => agent(text, { agentType: 'test-writer', model: testsModel, schema: TESTS, phase: 'Tests', label });
  if (!skipTests) {
    const haltedBeforeTests = halted('tests');
    if (haltedBeforeTests) return haltedBeforeTests;
    const haltedAtTestsSlot = await holdSlotOrHalt('tests');
    if (haltedAtTestsSlot) return haltedAtTestsSlot;
    const written = await writeTests(testsPrompt, `tests ${task}`);
    if (!written) return result('failed', 'The test writer returned nothing.');
    if (denied(written)) return result('denied', denied(written));
    if (!written.done) return result('blocked', written.blockers || []);
    let red = await runGate(redCommand, `red gate ${task}`, 'Tests', decideRed);
    if (red.action === 'retry') {
      const again = await writeTests(testsRetry(red.detail), `tests ${task} (retry)`);
      if (!again) return result('failed', 'The test writer returned nothing on the retry.');
      if (denied(again)) return result('denied', denied(again));
      red = await runGate(redCommand, `red gate ${task} (after retry)`, 'Tests', decideRed);
    }
    if (red.action === 'denied') return result('denied', red.detail);
    if (red.action === 'stop') return result('tests-green', red.detail);
    if (red.action !== 'pass') return result('blocked', red.detail);
    pinned = red.blobs;
    gated = red.gates;
    if (gated.length) log(`${task}: gated items, not tests: ${gated.map((entry) => `${entry.item} (${entry.kind})`).join(', ')}`);
  }

  // 3. Implement (the implementer runs the checks itself)
  let evidence = opts.evidence || `See the evidence field of ${task} (\`${taskCli} show ${task}\`) on ${branch}.`;
  let ciSteps = Array.isArray(opts.ciSteps) ? opts.ciSteps : [];
  if (!skipImpl) {
  const haltedBeforeImplement = halted('implement');
  if (haltedBeforeImplement) return haltedBeforeImplement;
  const haltedAtImplementSlot = await holdSlotOrHalt('implement');
  if (haltedAtImplementSlot) return haltedAtImplementSlot;
  const implRun = await guarded(
    `Implement the approved spec.${specNotes.length ? `\nAlso resolve these spec-check notes, updating the spec where they change it:\n${specNotes.join('\n')}` : ''}
Commit the spec with the work, one milestone per commit. Set the task's status to in_progress with \`${taskCli} set ${task} --status in_progress --owner ${implAgent} --evidence-file <file>\`. ${evidenceRule} Do not push or open a PR. If an acceptance item can only be met with a pushed branch, an open PR, or CI runs (for example a throwaway commit that must fail CI, or baselines rendered on the CI host), do everything else, set done=true, and list each such step in ciSteps; the Ship phase does them. Never list a review (guardian, design, or any other agent review) as a ciStep: reviews happen in the Review phase, and the Ship phase cannot start agents. Return done=false with blockers if you cannot finish for any other reason. Use ciOnly only for a step that a local run cannot produce (for example accepting CI-rendered baselines or attaching CI screenshots), and only when every local check passed; a failing local check is never ciOnly.`,
    `implement ${task}`,
    'Implement',
  );
  if (implRun.stop) return implRun.stop;
  const impl = implRun.out;
  if (!impl) return result('failed', 'The implementer returned nothing.');
  if (denied(impl)) return result('denied', denied(impl));
  const implStep = decideStep(impl, false);
  if (implStep.action !== 'done') return result('blocked', whyNotGreen(impl, 'implement'));
  evidence = impl.evidence;
  ciSteps = ciSteps.concat(impl.ciSteps || []).concat(implStep.ciOnly);
  }

  // 4. Review (one round); from: "ship" skips it, for a task whose review round ran in an earlier run
  let blocking = [];
  let lows = [];
  if (!skipReview) {
  const haltedBeforeReview = halted('review');
  if (haltedBeforeReview) return haltedBeforeReview;
  const review = await agent(
    `${common}
Review git diff origin/main...${branch} against the spec, the task acceptance, and the hard rules. If the diff touches apps/tv screens, shared controls, or design tokens, also do the design review: follow .claude/skills/change-review/references/design-checklist.md against DESIGN.md and look at the captures from pnpm tv:visual (T3-07) when it exists. Also judge whether each frozen test (listed in docs/specs/${task}.tests.json) really checks its acceptance item${gated.length ? `, and check each gated item against the spec's Acceptance table: ${gated.map((entry) => `item ${entry.item} (${entry.kind}: ${entry.why})`).join('; ')}` : ''}. This is the only review round. Change no files. Return every finding with its severity, file:line, and a concrete failure scenario. Return filesChanged: every path from git diff --name-only origin/main...${branch}. Set needsGuardian=true if the diff touches the gateway, negotiation, the player, redaction, tokens, a native method or event, Kotlin, the native HTTP client, or docs/security.md, or if the task's acceptance asks for a guardian review.`,
    { agentType: reviewAgent, model: reviewModel, schema: REVIEW, phase: 'Review', label: `review ${task}` },
  );
  if (!review) return result('failed', 'The reviewer returned nothing.');
  const riskyFiles = (review.filesChanged || []).filter((path) => HIGH_RISK_PATH.test(path));
  // A diff that reached Kotlin sends its follow-up fixes to native-engineer; the guardian below covers the review.
  if (!native && (review.filesChanged || []).some((path) => NATIVE_PATH.test(path))) {
    implAgent = 'native-engineer';
    implModel = models.implement.native;
    reviewNative = true;
    log(`${task}: the diff touches Kotlin or a native module; follow-ups go to native-engineer`);
  }
  if ((review.needsGuardian || riskyFiles.length) && reviewAgent !== 'guardian') {
    log(`${task}: the diff touches high-risk code; adding a guardian review`);
    const guard = await agent(
      `${common}
Adversarially review git diff origin/main...${branch} for token, URL, or session-ID leaks, redaction coverage, direct-play and negotiation changes, and native safety. Change no files. Return every finding with its severity, file:line, and a concrete failure scenario.`,
      { agentType: 'guardian', model: models.guardian, schema: REVIEW, phase: 'Review', label: `guardian ${task}` },
    );
    if (guard) review.findings = review.findings.concat(guard.findings);
  }
  const describe = (finding) => `[${finding.severity}] ${finding.where}: ${finding.summary}`;
  blocking = review.findings.filter((finding) => finding.severity !== 'low').map(describe);
  lows = review.findings.filter((finding) => finding.severity === 'low').map(describe);
  log(`${task}: review found ${blocking.length} to fix, ${lows.length} low`);
  const haltedAtFollowUpSlot = await holdSlotOrHalt('follow-ups');
  if (haltedAtFollowUpSlot) return haltedAtFollowUpSlot;
  const followUpRun = await guarded(
    `${blocking.length ? `Fix these review findings and commit, with a test for each behavior change:\n${blocking.join('\n')}` : 'No critical, high or medium review findings.'}
${lows.length ? `Also fix in the same pull request each of these low findings that is small, with a test for each behavior change; log none of the findings you fix (no plan line, no backlog line):\n${lows.join('\n')}` : ''}
A low is small when you can fix and test it in the same pull request without a new dependency, a new native module method or event, a change to an acceptance item or a frozen test, or a look, wording or direction call. When it needs one of those, leave it. Only lows may be left: a critical, high or medium finding you cannot fix is a blocker (done=false), not a left finding.
For each finding you leave, append one line to tasks/backlog.jsonl (WORKFLOW.md section 2a), at the end, without touching another line, and commit it with your fixes. The fields are: what (the fix, in one sentence); why (\`<severity> review finding from ${task}: <the problem>; for the phase's hardening task\`, plus \`; real-TV gate: <home-network|local-information>\` when one holds); source (\`"${task}"\`); size (S, M or L); date (from \`date +%F\`). Never append a line whose what is already in the file. Never write a plan line, or a backlog line that asks for a task of its own: one hardening task per phase takes these, and a Product Owner pass places them. Never edit tasks/prd.json.
Only a finding that opens a path into a self-hoster's home network, or leaks local information (a LAN address, a serial, a hostname, a credential), gates an install on a real TV. Return in fixedFindings each low you fixed (where, summary). Return in leftFindings every finding listed above that is not fixed on the branch, including one an earlier attempt of this step left, each with realTvGate home-network, local-information or none. Describe a leaked value, never quote it, in the backlog, the result, the evidence and the PR.
Then, if every acceptance item is met (the review above counts as the fresh-context design review; the Ship phase links screenshots) and the spec does not reserve sign-off for the human, set the task's status to done with \`${taskCli} set ${task} --status done --evidence-file <file>\` (passes follows status). ${evidenceRule} Because no PR exists yet, the evidence must contain \`commit <sha>\`. Then tick its line in the active plan, and commit. Do not push.${ciSteps.length ? `\nThese acceptance steps need CI and are done in the Ship phase, so treat them as pending (not as blockers) and leave status in_progress:\n${ciSteps.join('\n')}` : ''}
Use ciOnly only for a step that a local run cannot produce (for example accepting CI-rendered baselines or attaching CI screenshots), and only when every local check passed; a failing local check is never ciOnly.`,
    `follow-ups ${task}`,
    'Review',
  );
  if (followUpRun.stop) return followUpRun.stop;
  const followUp = followUpRun.out;
  if (!followUp) return result('failed', 'The follow-up agent returned nothing.');
  if (denied(followUp)) return result('denied', denied(followUp));
  const leftPlan = planLeft(followUp.leftFindings);
  unaccounted = unaccountedLows(lows.length, followUp);
  if (unaccounted) log(`${task}: ${unaccounted} low finding(s) are neither in fixedFindings nor in leftFindings; a real-TV gate may be missing`);
  left = leftPlan.left;
  realTvGates = leftPlan.gates;
  for (const gate of realTvGates) log(`${task}: real-TV gate (${gate.holds}): ${gate.where}`);
  if (leftPlan.problems.length) return result('blocked', leftPlan.problems);
  if (leftPlan.unfixed.length) return result('blocked', ['The follow-ups step left findings above low:'].concat(leftPlan.unfixed.map((finding) => `[${finding.severity}] ${finding.where}: ${finding.summary}`)));
  // With CI steps pending, a not-done follow-up whose checks pass hands its blockers to Ship, which refuses to merge if it cannot clear them.
  if (!followUp.checksPassed || (!followUp.done && !ciSteps.length)) return result('blocked', whyNotGreen(followUp, 'follow-up'));
  if (!followUp.done) ciSteps = ciSteps.concat(followUp.blockers || []);
  evidence = followUp.evidence || evidence;
  const followUpCiOnly = decideStep(followUp, false).ciOnly;
  if ((followUp.ciOnly || []).length && !followUpCiOnly.length) log(`${task}: dropped ciOnly from a result that was not green: ${followUp.ciOnly.join('; ')}`);
  ciSteps = mergeUnique(ciSteps, (followUp.ciSteps || []).concat(followUpCiOnly));
  // Every frozen run must now pass, including any that pnpm check does not cover.
  if (!opts.preFlow) {
    const green = await runGate(`${redCommand} --expect green`, `green gate ${task}`, 'Review', decideGreen);
    if (green.action === 'denied') return result('denied', green.detail);
    if (green.action !== 'pass') return result('blocked', green.detail);
  }
  }

  // Resuming at Ship: the review ran earlier, so only the frozen tests and the green gate are checked again.
  if (skipReview && opts.preFlow !== true) {
    const flow = await runGate(flowCommand, `frozen gate ${task}`, 'Ship', (gateOut, final) => decideFrozen(gateOut, approved, pinned, final));
    if (flow.action === 'denied') return result('denied', flow.detail);
    if (flow.action === 'stop') return result('frozen-tests', flow.detail);
    if (flow.action !== 'pass') return result('blocked', flow.detail);
    const green = await runGate(`${redCommand} --expect green`, `green gate ${task}`, 'Ship', decideGreen);
    if (green.action === 'denied') return result('denied', green.detail);
    if (green.action !== 'pass') return result('blocked', green.detail);
  }

  const haltedBeforeShip = halted('ship');
  if (haltedBeforeShip) return haltedBeforeShip;
  // 5. Ship (CI fixes go through the same retry and Fable escalation)
  const shipPrompt = `${common}
Ship with the ship skill: rebase onto origin/main if it moved (force-with-lease is allowed on this branch), push, open the PR if none exists, enable auto-merge with rebase, and wait for CI with gh pr checks --watch. The PR body must explain user impact, testing (use the evidence below), conversion and security implications, untested device, Jellyfin and Jellyscale gates, and call out any change to invariants, docs/security.md, release signing, or CI. For a UI change, add a Screenshots section that links the visual artifact from the PR's CI run (gh api repos/{owner}/{repo}/actions/runs/<run>/artifacts) and names the images that changed, plus a Design review notes section from the review. Change no source files. If CI is red, return merged=false with each failing check and its cause. Fill the PR body's Frozen tests section from the changes list that \`${nodeCli('check-flow.mjs')} --repo ${worktree} --json\` prints (or write "none changed"). After a merge, run git -C ${main} pull --ff-only and remove the worktree and branch.
Evidence: ${evidence}
Review: ${skipReview ? 'done in an earlier run.' : `${blocking.length} fixed, ${left.length} left in tasks/backlog.jsonl.`}${unaccounted ? `\nThe follow-ups step did not account for ${unaccounted} low review finding(s) (neither fixed nor listed); say so in the PR body, and check the diff and tasks/backlog.jsonl for a home-network or local-information finding.` : ''}${realTvGates.length ? `\nList each of these among the untested device gates in the PR body as "real-TV gate (<holds>), for the Product Owner to place":\n${realTvGates.map((gate) => `${gate.holds}: ${gate.where}: ${gate.summary}`).join('\n')}` : ''}${ciSteps.length ? `
Before enabling auto-merge, do these CI-dependent acceptance steps on this PR branch. Temporary commits are allowed only when a step asks for one, and each must be reverted in a later commit. Record each run URL in the task's evidence. Then, if every acceptance item is met, set the task's status to done with \`${taskCli} set ${task} --status done --evidence-file <file>\` (passes follows status), commit, and push. ${evidenceRule} If any listed step cannot be completed (for example it needs a review or a human), do not enable auto-merge; return merged=false and put the reason in ciFailures. This is the one case where the Ship phase changes files:
${ciSteps.join('\n')}` : ''}`;
  const shipEffort = ciSteps.length ? 'medium' : 'low';
  let ship = await agent(shipPrompt, { model: models.ship, effort: shipEffort, schema: SHIP, phase: 'Ship', label: `ship ${task}` });
  if (!ship) return result('failed', 'The ship agent returned nothing.');
  if (denied(ship)) return result('denied', denied(ship));
  if (!ship.merged && ship.ciFailures && ship.ciFailures.length) {
    const fixedRun = await guarded(`CI failed on the PR. Fix the cause and commit. Do not push, amend, squash or rebase: the run checks the frozen tests first, and the Ship step pushes afterwards.\n${ship.ciFailures.join('\n')}`, `fix CI ${task}`, 'Ship');
    if (fixedRun.stop) return fixedRun.stop;
    const fixed = fixedRun.out;
    if (denied(fixed)) return result('denied', denied(fixed));
    if (fixed && (fixed.ciOnly || []).length && decideStep(fixed, false).ciOnly.length) log(`${task}: the CI fix left CI-only steps for the human: ${decideStep(fixed, false).ciOnly.join('; ')}`);
    ship = await agent(shipPrompt, { model: models.ship, effort: shipEffort, schema: SHIP, phase: 'Ship', label: `ship ${task} (retry)` });
  }
  if (!ship || !ship.merged) return result('ci-red', ship ? { prUrl: ship.prUrl, ciFailures: ship.ciFailures } : 'The ship retry returned nothing.');
  return { task, outcome: 'merged', prUrl: ship.prUrl, fixed: blocking, left, realTvGates, ...(unaccounted ? { unaccountedLows: unaccounted } : {}) };
}

// The teardown runs outside runTask, so it names the Ship phase (meta.phases stays fixed). It never throws: a failure becomes the detail.
const tearDownFixtures = async (task, root) => {
  try {
    const { main, worktree } = taskPaths(task, root);
    const out = await agent(
      `Run exactly this command and return its exit code as exitCode and everything it printed, unchanged and in full, as output (the JSON line on standard output must be in it). It brings down this task's own Docker Compose fixture servers and their volumes, so a changed Docker state is expected; it touches no other project.${root ? '' : ' Relative paths are relative to the main checkout, which is your starting directory.'} If a command is denied, report it in deniedCommands and do not work around it: ${fixturesDownCommand({ main, worktree })}`,
      { model: models.gate, schema: GATE, phase: 'Ship', label: `fixtures down ${task}` },
    );
    return decideTeardown(out);
  } catch (error) {
    return { stopped: [], detail: error instanceof Error ? error.message : String(error) };
  }
};

// Lane mode: one loop per lane, side by side. A lane asks the lane-state gate what origin/main shows, decides with pickLane, runs one task through
// the same withTeardown as a batch, and asks again; it never runs two tasks at once. At most one serial lane (or a parallel-lane task that turned
// native) holds the serial slot at a time. A denial anywhere halts every lane. A throw ends only that lane.
async function runLanes(request) {
  const main = request.root ? `${request.root}/${REPO}` : '.';
  const state = { laneStates: {}, attempted: new Set(), slotHolder: null, halted: false };
  const report = {};
  const finished = [];
  let halt = null;
  let changes = 0;
  let wake;
  let changed;
  const renew = () => {
    changed = new Promise((resolve) => {
      wake = resolve;
    });
  };
  renew();
  const signal = () => {
    const fire = wake;
    renew();
    fire();
  };
  const bump = () => {
    changes += 1;
    signal();
  };
  for (const lane of request.lanes) {
    state.laneStates[lane] = 'querying';
    report[lane] = { ran: [], stopped: null };
  }
  const stopLane = (lane, reason, extra) => {
    report[lane].stopped = { reason, ...extra };
    state.laneStates[lane] = 'stopped';
    log(`lane ${lane}: stopped, ${reason}`);
    bump();
  };
  const setHalt = (where, detail) => {
    if (!halt) halt = { reason: 'denied', where, detail };
    state.halted = true;
    log(`Stopping every lane: a denied command (${where})`);
    bump();
  };
  // The serial slot: a FIFO mutex. holder is state.slotHolder; a waiter is handed the slot at the release.
  const queue = [];
  const takeSlot = async (lane) => {
    if (state.slotHolder === null || state.slotHolder === lane) {
      state.slotHolder = lane;
      return;
    }
    await new Promise((resolve) => queue.push({ lane, resolve }));
  };
  const releaseSlot = (lane) => {
    if (state.slotHolder !== lane) return;
    const next = queue.shift();
    state.slotHolder = next ? next.lane : null;
    if (next) next.resolve();
    bump();
  };
  // The lane-state gate has its own relay: runTask's gate helpers are closures of one task. It asks once more on an unreadable result.
  const laneGateCall = (lane, label) =>
    agent(
      `Run exactly this command, change nothing, and return its exit code as exitCode and everything it printed, unchanged and in full, as output (the JSON line on standard output must be in it; ERROR lines may follow). It fetches origin, so a changed git remote-tracking state is expected.${request.root ? '' : ' Relative paths are relative to the main checkout, which is your starting directory.'} If a command is denied, report it in deniedCommands and do not work around it: mise exec -- node ${main}/.claude/workflows/lane-state.mjs --repo ${main} --lane ${lane}`,
      { model: models.gate, schema: GATE, phase: 'Spec', label },
    );
  const laneGate = async (lane) => {
    let out = await laneGateCall(lane, `lane state ${lane}`);
    if (denied(out)) return { action: 'denied', detail: denied(out) };
    let decision = decideLaneState(out, false);
    if (decision.unreadable) {
      log(`lane ${lane}: the lane-state check gave no readable result; running it once more`);
      out = await laneGateCall(lane, `lane state ${lane} (again)`);
      if (denied(out)) return { action: 'denied', detail: denied(out) };
      decision = decideLaneState(out, true);
    }
    return decision;
  };
  const loop = async (lane) => {
    try {
      while (true) {
        if (state.halted) return stopLane(lane, 'halted');
        state.laneStates[lane] = 'querying';
        const seen = changes;
        const gate = await laneGate(lane);
        if (gate.action === 'denied') return setHalt(`lane state ${lane}`, gate.detail), stopLane(lane, 'denied');
        if (gate.action !== 'pass') return stopLane(lane, 'lane-state', { detail: gate.detail });
        // A task ended, a slot was released or a lane stopped while the gate ran: the snapshot may be stale, so ask again.
        if (changes !== seen) continue;
        const pick = pickLane({ state, lane, snapshot: gate.json });
        if (pick.action === 'stop') return stopLane(lane, pick.why, pick.waiting ? { waiting: pick.waiting } : pick.inFlight ? { inFlight: pick.inFlight } : undefined);
        if (pick.action === 'wait') {
          state.laneStates[lane] = 'waiting';
          // pickLane waits only while another lane is querying or running, and that lane ends in a task end or a lane stop, which wake this one.
          await changed;
          continue;
        }
        // run: the slot is taken in this synchronous step, with no await since pickLane.
        const id = pick.task.id;
        if (SERIAL_LANES.includes(lane)) state.slotHolder = lane;
        state.laneStates[lane] = 'running';
        state.attempted.add(id);
        report[lane].ran.push(id);
        const holdSerial = async () => {
          if (state.slotHolder === lane) return;
          log(`${id}: lane ${lane} holds native work; the serial slot is taken`);
          await takeSlot(lane);
        };
        let out;
        try {
          out = await withTeardown(() => runTask(id, { risk: pick.risk, native: pick.native, root: request.root, halted: () => state.halted, holdSerial }), () => tearDownFixtures(id, request.root));
        } finally {
          releaseSlot(lane);
          state.laneStates[lane] = 'querying';
          bump();
        }
        finished.push({ task: id, ...out });
        log(`${id}: fixture servers: ${out.fixtures.detail}`);
        if (out.outcome === 'denied' || (out.fixtures && out.fixtures.denied)) return setHalt(out.fixtures && out.fixtures.denied ? `fixture teardown of ${id} (lane ${lane})` : `${id} (lane ${lane})`, out.fixtures && out.fixtures.denied ? out.fixtures.denied : out.detail), stopLane(lane, 'denied');
        if (STOP_OUTCOMES.includes(out.outcome) || out.outcome === RULING_UNLOGGED) return stopLane(lane, out.outcome, { task: id });
      }
    } catch (error) {
      releaseSlot(lane);
      return stopLane(lane, 'failed', { detail: error instanceof Error ? error.message : String(error) });
    }
  };
  await Promise.all(request.lanes.map(loop));
  return {
    lanes: report,
    merged: finished.filter((o) => o.outcome === 'merged'),
    parked: finished.filter((o) => o.outcome === 'parked'),
    needsAttention: finished.filter((o) => !['merged', 'parked'].includes(o.outcome)),
    ...(halt ? { stopped: halt } : {}),
  };
}
if (Array.isArray(input.lanes)) return await runLanes(input);

const outcomes = [];
for (const task of items) {
  const out = await withTeardown(() => runTask(task, items.length === 1 ? input : { risk: input.risk, native: input.native, root: input.root }), () => tearDownFixtures(task, input.root));
  outcomes.push({ task, ...out });
  log(`${task}: fixture servers: ${out.fixtures.detail}`);
  if (STOP_OUTCOMES.includes(out.outcome) || out.outcome === RULING_UNLOGGED || (out.fixtures && out.fixtures.denied)) {
    log(`Stopping: ${out.fixtures.denied ? 'a denied fixture teardown' : out.outcome} in ${task}`);
    break;
  }
}
return {
  merged: outcomes.filter((o) => o.outcome === 'merged'),
  parked: outcomes.filter((o) => o.outcome === 'parked'),
  needsAttention: outcomes.filter((o) => !['merged', 'parked'].includes(o.outcome)),
  notRun: items.slice(outcomes.length),
};
