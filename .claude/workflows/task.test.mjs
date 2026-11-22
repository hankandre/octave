// Run: node --test .claude/workflows/task.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const src = readFileSync(new URL('./task.js', import.meta.url), 'utf8');
const block = src.split('// MODELS-BEGIN')[1].split('\n').slice(1).join('\n').split('// MODELS-END')[0];
const { MODELS, resolveModels } = new Function(`${block}; return { MODELS, resolveModels };`)();
const stepBlock = src.split('// STEP-BEGIN')[1].split('\n').slice(1).join('\n').split('// STEP-END')[0];
const { mergeUnique, decideStep } = new Function(`${stepBlock}; return { mergeUnique, decideStep };`)();
const gateBlock = src.split('// GATE-BEGIN')[1].split('\n').slice(1).join('\n').split('// GATE-END')[0];
const { STOP_OUTCOMES, readGate, decideRed, decideGreen, decideFrozen } = new Function(
  `${gateBlock}; return { STOP_OUTCOMES, readGate, decideRed, decideGreen, decideFrozen };`,
)();

test('no override returns the defaults', () => {
  assert.deepEqual(resolveModels(MODELS, undefined), MODELS);
});

test('defaults match AGENTS.md rules', () => {
  assert.equal(MODELS.spec.high, 'fable');
  assert.equal(MODELS.spec.routine, 'opus');
  assert.equal(MODELS.check.native, 'fable');
  assert.equal(MODELS.implement.routine, 'sonnet');
  assert.equal(MODELS.implement.native, 'opus');
  assert.equal(MODELS.guardian, 'opus');
  assert.equal(MODELS.escalate, 'fable');
  assert.deepEqual(MODELS, {
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
  });
});

test('every MODELS leaf is a valid model name', () => {
  const leaves = (node) => (typeof node === 'string' ? [node] : Object.values(node).flatMap(leaves));
  for (const leaf of leaves(MODELS)) assert.ok(['haiku', 'sonnet', 'opus', 'fable'].includes(leaf), leaf);
});

test('partial override is deep-merged and does not mutate defaults', () => {
  const out = resolveModels(MODELS, { spec: { high: 'opus' }, check: { high: 'opus' }, escalate: 'opus' });
  assert.equal(out.spec.high, 'opus');
  assert.equal(out.spec.routine, 'opus');
  assert.equal(out.check.native, 'fable');
  assert.equal(out.escalate, 'opus');
  assert.equal(MODELS.spec.high, 'fable');
});

test('unknown keys fail fast', () => {
  assert.throws(() => resolveModels(MODELS, { bogus: 'opus' }), /Unknown models key "bogus"/);
  assert.throws(() => resolveModels(MODELS, { spec: { huge: 'opus' } }), /Unknown models key "spec.huge"/);
});

test('values outside haiku, sonnet, opus, fable are rejected', () => {
  assert.throws(() => resolveModels(MODELS, { ship: 'gpt' }), /must be one of/);
  assert.throws(() => resolveModels(MODELS, { spec: { high: 5 } }), /must be one of/);
});

test('shape errors are rejected', () => {
  assert.throws(() => resolveModels(MODELS, 'opus'), /must be an object/);
  assert.throws(() => resolveModels(MODELS, { spec: 'opus' }), /must be an object/);
  assert.throws(() => resolveModels(MODELS, { ship: { a: 'opus' } }), /must be one of/);
});

test('failing checks with ciOnly are not a handoff', () => {
  const out = { done: false, checksPassed: false, failures: [], blockers: [], ciOnly: ['unit test X fails'] };
  assert.equal(decideStep(out, false).action, 'retry');
  assert.equal(decideStep({ ...out, done: true }, false).action, 'retry');
  assert.equal(decideStep({ ...out, done: false, checksPassed: true }, false).action, 'retry');
});

test('passing checks with only ciOnly is a handoff carrying the items', () => {
  const out = { done: true, checksPassed: true, failures: [], blockers: [], ciOnly: ['accept baselines'] };
  assert.deepEqual(decideStep(out, false), { action: 'done', ciOnly: ['accept baselines'] });
});

test('a mix of failures and ciOnly retries', () => {
  const out = { done: true, checksPassed: true, failures: ['a.test.ts:3'], blockers: [], ciOnly: ['accept baselines'] };
  assert.equal(decideStep(out, false).action, 'retry');
});

test('denied and empty results', () => {
  assert.equal(decideStep({ done: true, checksPassed: true }, true).action, 'denied');
  assert.equal(decideStep(null, false).action, 'none');
});

test('ciOnly merges across attempts without duplicates', () => {
  assert.deepEqual(mergeUnique(['a', 'b'], ['b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(mergeUnique(['a'], undefined), ['a']);
  assert.deepEqual(mergeUnique(undefined, undefined), []);
});

const pathsBlock = src.split('// PATHS-BEGIN')[1].split('\n').slice(1).join('\n').split('// PATHS-END')[0];
const { REPO, taskPaths, HIGH_RISK_PATH, NATIVE_PATH } = new Function(`${pathsBlock}; return { REPO, taskPaths, HIGH_RISK_PATH, NATIVE_PATH };`)();

test('the worktree and branch come from the repository name and the task id', () => {
  assert.equal(REPO, 'octave');
  assert.deepEqual(taskPaths('T3-01'), { main: '.', worktree: '../octave-T3-01', branch: 'task/T3-01', spec: 'docs/specs/T3-01.md' });
  assert.deepEqual(taskPaths('T10-13', '/srv/code'), {
    main: '/srv/code/octave',
    worktree: '/srv/code/octave-T10-13',
    branch: 'task/T10-13',
    spec: 'docs/specs/T10-13.md',
  });
});

test('task ids outside the T<phase>-<nn> form are refused', () => {
  for (const bad of ['P13-08', 'T3-1', 't3-01', 'T3-01; rm -rf /', '', undefined]) {
    assert.throws(() => taskPaths(bad), /Unknown task id/);
  }
});

test('the high-risk paths name the core negotiation, gateway, player and redaction code, native code and the security document', () => {
  for (const path of [
    'packages/core/src/jellyfin/gateway.ts',
    'packages/core/src/jellyfin/source-acceptance.ts',
    'packages/core/src/player/coordinator.ts',
    'packages/core/src/redact.ts',
    'src/lib/jellyfin/gateway.ts',
    'src/lib/player/coordinator.ts',
    'src/lib/redact.ts',
    'src/domain/playback.ts',
    'modules/player/android/src/main/java/dev/octave/player/Player.kt',
    'modules/http/android/src/main/java/dev/octave/http/Client.kt',
    'apps/tv/android/app/src/main/AndroidManifest.xml',
    'docs/security.md',
    'tests/fixtures/hls-playlists.json',
    'packages/core/tests/fixtures/hls-playlists.json',
    'packages/core/tests/fixtures/hls-master-urls.json',
    'packages/core/tests/fixtures/host-classes.json',
  ]) {
    assert.ok(HIGH_RISK_PATH.test(path), path);
  }
  for (const path of ['apps/tv/src/screens/home.tsx', 'README.md', 'src/domain/catalog.ts', 'packages/core/src/domain/catalog.ts']) {
    assert.ok(!HIGH_RISK_PATH.test(path), path);
  }
});

test('Kotlin under modules/ and apps/tv/android routes to the native engineer', () => {
  assert.ok(NATIVE_PATH.test('modules/player/android/Player.kt'));
  assert.ok(NATIVE_PATH.test('apps/tv/android/app/build.gradle'));
  assert.ok(!NATIVE_PATH.test('apps/tv/src/app.tsx'));
});

test('the verify step runs the TV commands, not the desktop ones', () => {
  const verify = src.split('const VERIFY_STEPS =')[1].split('\n')[1];
  for (const command of ['pnpm check', 'pnpm test:tripwire', 'pnpm tv:native:test', 'pnpm tv:e2e', 'pnpm tv:wire', 'pnpm tv:visual']) {
    assert.ok(verify.includes(command), command);
  }
  for (const gone of ['test:e2e', 'test:visual', 'cargo']) assert.ok(!verify.includes(gone), gone);
});

// Prompt text lives inside runTask, outside the pure blocks, so slice the source by stable anchors.
const between = (from, to) => {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `anchors ${from} .. ${to}`);
  return src.slice(start, end);
};
const commonPrompt = between('const common =', 'const result =');
const implementPrompt = between('Implement the approved spec.', '`implement ${task}`');
const followUpPrompt = between('Fix these review findings', '`follow-ups ${task}`');
const shipPromptText = between('const shipPrompt', 'const shipEffort');

test('task.js never tells agents to use jq', () => {
  assert.doesNotMatch(src, /\bjq\b/);
});

test('the common prompt reads one task through the CLI and never the whole file', () => {
  assert.match(commonPrompt, /show \$\{task\}/);
  assert.match(commonPrompt, /never read the whole file/);
  assert.match(src, /const taskCli = `mise exec -- node \$\{worktree\}\/scripts\/task\.mjs`/);
});

test('the implement, follow-up and Ship prompts set the task through the CLI with the evidence rule', () => {
  for (const [name, prompt] of [['implement', implementPrompt], ['follow-up', followUpPrompt], ['ship', shipPromptText]]) {
    assert.match(prompt, /\$\{taskCli\} set \$\{task\}/, name);
    assert.match(prompt, /\$\{evidenceRule\}/, name);
  }
  assert.match(implementPrompt, /--status in_progress --owner \$\{implAgent\}/);
  assert.match(followUpPrompt, /--status done/);
  assert.match(followUpPrompt, /commit <sha>/);
  assert.match(src, /const evidenceRule = .*PR #n.*commit <sha>.*600 characters/);
});

test('no prompt uses pnpm to set a task', () => {
  assert.doesNotMatch(src, /pnpm (-C \S+ )?task/);
});

// ---- T1-12: the test-first flow ----

// Comments hold words such as work( that the call-site tests must not count.
const code = src
  .split('\n')
  .filter((line) => !/^\s*\/\//.test(line))
  .map((line) => line.replace(/\s\/\/ .*$/, ''))
  .join('\n');
const metaText = src.slice(src.indexOf('export const meta ='), src.indexOf('// args:')).replace('export const meta', 'const meta');
const meta = new Function(`${metaText}; return meta;`)();
const gateJson = (body, exitCode = 0) => ({ exitCode, output: `noise\n${JSON.stringify(body)}`, deniedCommands: [] });

test('the models for the test writer, the owner ruling and the gate agent are fixed, and the owner cannot be overridden', () => {
  assert.deepEqual(MODELS.tests, { routine: 'sonnet', native: 'opus' });
  assert.equal(MODELS.owner, 'fable');
  assert.equal(MODELS.gate, 'haiku');
  assert.throws(() => resolveModels(MODELS, { owner: 'sonnet' }), /owner.*cannot be overridden/);
  assert.equal(resolveModels(MODELS, { gate: 'sonnet' }).gate, 'sonnet');
});

test('the phases run Spec, Check, Tests, Implement, Review, Ship', () => {
  assert.deepEqual(meta.phases.map((phase) => phase.title), ['Spec', 'Check', 'Tests', 'Implement', 'Review', 'Ship']);
});

test('the from comment and whenToUse name the tests phase and the new args', () => {
  assert.match(meta.whenToUse, /"tests"/);
  const comment = src.slice(src.indexOf('// args:'), src.indexOf('// MODELS-BEGIN'));
  assert.match(comment, /from: "check" \| "tests" \| "implement" \| "review"/);
  assert.match(comment, /preFlow/);
  assert.match(comment, /approvedFrozen/);
});

test('readGate takes the last JSON line even when ERROR lines follow it', () => {
  const body = { ok: false, missingManifest: true, problems: ['x'] };
  const gate = { exitCode: 1, output: `${JSON.stringify(body)}\nERROR frozen test: no manifest\n`, deniedCommands: [] };
  assert.deepEqual(readGate(gate), body);
  assert.equal(decideFrozen(gate, [], undefined, false).action, 'blocked');
  assert.equal(readGate({ exitCode: 1, output: 'ERROR only\nmore', deniedCommands: [] }), null);
});

test('the gate prompt asks for the whole output, so the JSON line is never dropped for a trailing ERROR line', () => {
  const prompt = between('const gate = (command, label, phase) =>', 'const runGate');
  assert.match(prompt, /everything it printed/);
  assert.doesNotMatch(prompt, /last line/);
});

test('the CI fix does not push, and the Product Owner pass cleans up on every exit but a merge', () => {
  const ciFix = between('const fixedRun = await guarded', "if (fixed && (fixed.ciOnly");
  assert.match(ciFix, /Do not push/);
  const pass = readFileSync(new URL('./product-owner.js', import.meta.url), 'utf8');
  assert.match(pass, /worktree remove --force/);
  for (const outcome of ['failed', 'denied', 'nothing-to-do', 'ci-red']) assert.match(pass, new RegExp(`leave\\(\\{ outcome: '${outcome}'`), outcome);
  assert.doesNotMatch(pass, /return \{ outcome: '(failed|denied|nothing-to-do|ci-red)'/);
});

test('STOP_OUTCOMES holds the three outcomes that end a whole batch', () => {
  assert.deepEqual(STOP_OUTCOMES, ['denied', 'tests-green', 'frozen-tests']);
  assert.match(code, /STOP_OUTCOMES\.includes\(out\.outcome\)/);
});

test('decideRed stops on a green item, retries on problems or unreadable output, and passes only on a clean exit 0', () => {
  const red = { task: 'T9-01', red: [1], green: [], gates: [], blobs: { 'a.test.ts': 'abc' }, problems: [] };
  assert.equal(decideRed(gateJson({ ...red, green: [2], red: [1] }, 1)).action, 'stop');
  assert.match(decideRed(gateJson({ ...red, green: [2] }, 1)).detail, /2/);
  assert.equal(decideRed(gateJson({ ...red, problems: ['ERROR manifest: x'] }, 2)).action, 'retry');
  assert.equal(decideRed({ exitCode: 0, output: 'not json' }).action, 'retry');
  assert.equal(decideRed({ exitCode: 0, output: 'not json' }).unreadable, true);
  assert.equal(decideRed(null).action, 'retry');
  const pass = decideRed(gateJson(red));
  assert.equal(pass.action, 'pass');
  assert.deepEqual(pass.blobs, { 'a.test.ts': 'abc' });
  assert.equal(decideRed(gateJson(red, 1)).action, 'retry');
});

test('decideRed hands back the gated items', () => {
  const out = decideRed(gateJson({ red: [], green: [], gates: [{ item: 2, kind: 'owner', why: 'w' }], blobs: {}, problems: [] }));
  assert.deepEqual(out.gates, [{ item: 2, kind: 'owner', why: 'w' }]);
});

test('decideGreen passes when every run passes and blocks on a red item or a problem', () => {
  assert.equal(decideGreen(gateJson({ red: [], green: [1], gates: [], problems: [] })).action, 'pass');
  assert.equal(decideGreen(gateJson({ red: [1], green: [], gates: [], problems: [] }, 1)).action, 'blocked');
  assert.equal(decideGreen(gateJson({ red: [], green: [], gates: [], problems: ['ERROR red: x'] }, 2)).action, 'blocked');
  assert.equal(decideGreen({ exitCode: 0, output: 'x' }).unreadable, true);
});

const flow = (extra = {}) => ({ ok: true, commits: 2, manifests: [], changes: [], frozen: [{ path: 'a.test.ts', blob: 'b1' }], taskListChanged: false, missingManifest: false, problems: [], ...extra });

test('decideFrozen passes a clean result and stops on a problem', () => {
  assert.equal(decideFrozen(gateJson(flow()), [], { 'a.test.ts': 'b1' }).action, 'pass');
  assert.equal(decideFrozen(gateJson(flow({ ok: false, problems: ['ERROR frozen test: a.test.ts differs'] }), 1), [], {}).action, 'stop');
});

test('decideFrozen stops on a trailered change the Product Owner step did not return, and passes one it did', () => {
  const changed = flow({ changes: [{ path: 'a.test.ts', commit: 'c', reason: 'r' }], frozen: [{ path: 'a.test.ts', blob: 'b2' }] });
  assert.equal(decideFrozen(gateJson(changed), [], { 'a.test.ts': 'b1' }).action, 'stop');
  assert.equal(decideFrozen(gateJson(changed), ['a.test.ts'], { 'a.test.ts': 'b1' }).action, 'pass');
});

test('decideFrozen accepts a ruling that names the changed path absolutely, inside the worktree', () => {
  const changed = flow({ changes: [{ path: 'pkg/a.test.ts', commit: 'c', reason: 'r' }], frozen: [{ path: 'pkg/a.test.ts', blob: 'b2' }] });
  assert.equal(decideFrozen(gateJson(changed), ['/home/x/octave-T9-99/pkg/a.test.ts'], { 'pkg/a.test.ts': 'b1' }).action, 'pass');
  assert.equal(decideFrozen(gateJson(changed), ['/home/x/octave-T9-99/pkg/other.test.ts'], { 'pkg/a.test.ts': 'b1' }).action, 'stop');
});

test('decideFrozen stops when an amended freeze commit moved a frozen blob that was not approved', () => {
  const amended = flow({ frozen: [{ path: 'a.test.ts', blob: 'b2' }] });
  const out = decideFrozen(gateJson(amended), [], { 'a.test.ts': 'b1' });
  assert.equal(out.action, 'stop');
  assert.match(out.detail, /a\.test\.ts/);
  assert.equal(decideFrozen(gateJson(amended), ['a.test.ts'], { 'a.test.ts': 'b1' }).action, 'pass');
  assert.equal(decideFrozen(gateJson(flow({ frozen: [] })), [], { 'a.test.ts': 'b1' }).action, 'stop');
  assert.equal(decideFrozen(gateJson(amended), [], undefined).action, 'pass');
});

test('decideFrozen retries unreadable output once and then fails closed; a missing manifest only blocks the task', () => {
  const unreadable = decideFrozen({ exitCode: 0, output: 'oops' }, [], {});
  assert.equal(unreadable.action, 'retry');
  assert.equal(unreadable.unreadable, true);
  assert.equal(decideFrozen({ exitCode: 0, output: 'oops' }, [], {}, true).action, 'stop');
  assert.equal(decideFrozen(null, [], {}, true).action, 'stop');
  assert.equal(decideFrozen(gateJson(flow({ ok: false, missingManifest: true, problems: ['ERROR frozen test: no manifest'] }), 1), [], {}).action, 'blocked');
});

test('decideStep sends frozen-test problems to the owner after none and denied and before done and retry', () => {
  const green = { done: true, checksPassed: true, failures: [], blockers: [], frozenTestProblems: ['a.test.ts: wrong expectation'] };
  assert.equal(decideStep(green, false).action, 'owner');
  assert.equal(decideStep({ ...green, done: false, checksPassed: false }, false).action, 'owner');
  assert.equal(decideStep(green, true).action, 'denied');
  assert.equal(decideStep(null, false).action, 'none');
  assert.equal(decideStep({ ...green, frozenTestProblems: [] }, false).action, 'done');
});

test('guarded wraps every work call: three call sites, and work is called only inside guarded', () => {
  assert.equal((code.match(/\bguarded\(/g) || []).length, 3);
  const start = code.indexOf('const guarded =');
  const end = code.indexOf('if (!skipSpec)');
  assert.ok(start > 0 && end > start);
  const calls = [...code.matchAll(/\bwork\(/g)].map((match) => match.index);
  assert.ok(calls.length >= 1);
  for (const index of calls) assert.ok(index > start && index < end, `work( at ${index} is outside guarded`);
});

test('guarded hands blocked and frozen-tests back to runTask, and the CI fix goes through it', () => {
  const guardedText = between('const guarded =', '// 1. Spec');
  assert.match(guardedText, /result\('frozen-tests'/);
  assert.match(guardedText, /result\('blocked'/);
  const ciFix = between('const fixedRun = await guarded', "if (fixed && (fixed.ciOnly");
  assert.match(ciFix, /guarded\(/);
  assert.match(ciFix, /\.stop/);
});

const testsPrompt = between('const testsPrompt', 'const testsRetry');
const testsRetry = between('const testsRetry', '// 3. Implement');

test('the Tests step runs the test-writer between the spec check and the implementer', () => {
  const check = code.indexOf("agentType: 'spec-checker'");
  const writer = code.indexOf("agentType: 'test-writer'");
  const implement = code.indexOf('Implement the approved spec.');
  assert.ok(check > 0 && writer > check && implement > writer);
  assert.match(code, /agentType: 'test-writer', model: testsModel/);
});

test('the Tests prompt names the manifest, each acceptance item, the commit and no implementation', () => {
  assert.match(testsPrompt, /docs\/specs\/\$\{task\}\.tests\.json/);
  assert.match(testsPrompt, /each acceptance item/);
  assert.match(testsPrompt, /commit/);
  assert.match(testsPrompt, /no implementation/i);
  assert.match(testsPrompt, /specNotes/);
});

test('the Tests prompt and its retry amend the freeze commit when the manifest already exists', () => {
  assert.match(testsPrompt, /already exists on this branch[^]*amend/i);
  assert.match(testsPrompt, /git commit --amend/);
  assert.match(testsRetry, /amend/i);
});

test('the red gate stops with tests-green and reruns once after a retry', () => {
  assert.match(code, /result\('tests-green'/);
  assert.match(code, /check-red\.mjs \$\{task\} --repo \$\{worktree\}/);
  assert.match(code, /--expect green/);
});

test('the gate agent has no agent type and runs on the gate model', () => {
  const gateText = between('const gate =', 'const runGate');
  assert.doesNotMatch(gateText, /agentType/);
  assert.match(gateText, /models\.gate/);
  assert.match(gateText, /Run exactly this command/);
});

test('every guarded prompt forbids editing frozen files and sends wrong ones to frozenTestProblems', () => {
  const rule = between('const frozenRule', '// Every work() call');
  assert.match(rule, /Never change or delete a file listed in docs\/specs\/\$\{task\}\.tests\.json/);
  assert.match(rule, /frozenTestProblems/);
  assert.match(between('const guarded =', 'const out'), /\$\{frozenRule\}/);
});

test('the review prompt judges the frozen tests and the Ship prompt fills the Frozen tests section', () => {
  const reviewPrompt = between('Review git diff origin/main', '`review ${task}`');
  assert.match(reviewPrompt, /frozen test/i);
  assert.match(shipPromptText, /Frozen tests/);
  assert.match(shipPromptText, /check-flow\.mjs/);
  assert.match(read('.github/pull_request_template.md'), /## Frozen tests/);
});

test('the Product Owner ruling runs the product-owner agent on the fixed owner model', () => {
  assert.match(code, /agentType: 'product-owner', model: models\.owner/);
  const pass = readFileSync(new URL('./product-owner.js', import.meta.url), 'utf8');
  assert.match(pass, /agentType: 'product-owner', model: 'fable'/);
});

test('the agent files carry the models and the frozen-test rules', () => {
  assert.match(read('.claude/agents/product-owner.md'), /^model: fable$/m);
  assert.match(read('.claude/agents/test-writer.md'), /^model: sonnet$/m);
  assert.match(read('.claude/agents/test-writer.md'), /manifest/);
  for (const agent of ['implementer', 'native-engineer']) assert.match(read(`.claude/agents/${agent}.md`), /frozen test/i, agent);
  assert.match(read('.claude/agents/refiner.md'), /gate: <kind>/);
  assert.match(read('.claude/agents/spec-checker.md'), /gate/);
});

test('AGENTS.md, WORKFLOW.md and the rules each say the owner can veto', () => {
  assert.match(read('AGENTS.md'), /owner can veto/);
  assert.match(read('WORKFLOW.md'), /owner can veto|owner's veto|veto/);
  const rules = JSON.parse(read('tasks/prd.json')).rules;
  assert.ok(rules.some((rule) => /owner can veto/.test(rule)));
});

test('WORKFLOW.md lists the flow in the order it runs, matching the phases', () => {
  const doc = read('WORKFLOW.md');
  const section = doc.split('## The task flow, in the order it runs')[1].split('\n## ')[0];
  const steps = [...section.matchAll(/^\d+\. \*\*([^*]+)\*\*/gm)].map((match) => match[1].trim().replace(/\.$/, ''));
  assert.equal(steps[0], 'Product Owner pass');
  assert.deepEqual(steps.slice(1), meta.phases.map((phase) => phase.title));
});

// ---- the frozen-test check against a real git repository ----
const FLOW = join(root, 'scripts', 'check-flow.mjs');
const PRD = JSON.stringify(
  { product: 'p', updated: 'd', rules: ['r'], status_values: ['todo'], phases: [{ id: 'T9', tasks: [{ id: 'T9-01', title: 't', acceptance: ['one', 'two'], status: 'todo', owner: null, passes: false, evidence: '' }] }] },
  null,
  2,
) + '\n';
const MANIFEST = 'docs/specs/T9-01.tests.json';
const MANIFEST_BODY = JSON.stringify({ task: 'T9-01', files: ['src/a.test.ts'], items: [{ item: 1, run: ['node', '-e', 'process.exit(1)'] }, { item: 2, run: ['node', '-e', 'process.exit(1)'] }] });
const dirs = [];
process.on('exit', () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'flow-'));
  dirs.push(dir);
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (message, files = {}) => {
    for (const [path, text] of Object.entries(files)) put(path, text);
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  commit('base', { 'tasks/prd.json': PRD, 'src/shared.txt': 'one\ntwo\nthree\nfour\nfive\n' });
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const check = (...extra) => {
    const out = spawnSync(process.execPath, [FLOW, ...extra], { cwd: dir, encoding: 'utf8' });
    return { status: out.status, stdout: out.stdout, stderr: out.stderr };
  };
  return { dir, git, put, commit, check };
}
const freeze = (r) => r.commit('test(T9-01): freeze', { [MANIFEST]: MANIFEST_BODY, 'src/a.test.ts': 'v1\n' });

test('check-flow passes an untouched frozen test next to an implementation commit', () => {
  const r = makeRepo();
  freeze(r);
  r.commit('feat: impl', { 'src/a.ts': 'x\n' });
  const out = r.check('--task', 'T9-01');
  assert.equal(out.status, 0, out.stderr);
});

test('check-flow fails an edited frozen test with an ERROR line naming the path', () => {
  const r = makeRepo();
  freeze(r);
  r.commit('feat: impl', { 'src/a.test.ts': 'v2\n' });
  const out = r.check();
  assert.equal(out.status, 1);
  assert.match(out.stderr, /ERROR frozen test: src\/a\.test\.ts differs/);
});

test('check-flow fails a deleted frozen test and passes an edit that a later commit reverts', () => {
  const r = makeRepo();
  freeze(r);
  rmSync(join(r.dir, 'src/a.test.ts'));
  r.commit('feat: delete');
  assert.equal(r.check().status, 1);
  r.commit('fix: restore', { 'src/a.test.ts': 'v1\n' });
  assert.equal(r.check().status, 0);
});

test('check-flow accepts a trailered change and lists it in the JSON', () => {
  const r = makeRepo();
  freeze(r);
  r.commit('test(T9-01): fix a wrong expectation\n\nFrozen-Test-Change: src/a.test.ts -- wrong expectation', { 'src/a.test.ts': 'v2\n' });
  const out = r.check('--json');
  assert.equal(out.status, 0, out.stderr);
  const json = JSON.parse(out.stdout.trim().split('\n').pop());
  assert.equal(json.ok, true);
  assert.equal(json.changes[0].path, 'src/a.test.ts');
  assert.equal(json.changes[0].reason, 'wrong expectation');
  assert.ok(json.frozen.some((entry) => entry.path === 'src/a.test.ts'));
});

test('check-flow fails when the freeze commit is amended after the red gate pinned its blobs, which decideFrozen then catches', () => {
  const r = makeRepo();
  freeze(r);
  const pinned = JSON.parse(r.check('--json').stdout.trim()).frozen;
  r.put('src/a.test.ts', 'weakened\n');
  r.git('add', '-A');
  r.git('commit', '-q', '--amend', '--no-edit');
  const after = r.check('--json');
  assert.equal(after.status, 0, 'an amended freeze commit is invisible to the git-only check');
  const json = JSON.parse(after.stdout.trim());
  const pins = Object.fromEntries(pinned.map((entry) => [entry.path, entry.blob]));
  assert.equal(decideFrozen({ exitCode: 0, output: after.stdout }, [], pins).action, 'stop');
});

test('check-flow fails a shallow clone and a missing base with the fetch message', () => {
  const r = makeRepo();
  const none = r.check('--base', 'origin/nothing');
  assert.equal(none.status, 1);
  assert.match(none.stderr, /ERROR flow: .*fetch/);
  const shallow = mkdtempSync(join(tmpdir(), 'flow-shallow-'));
  dirs.push(shallow);
  r.commit('second');
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${r.dir}`, shallow], { encoding: 'utf8' });
  const out = spawnSync(process.execPath, [FLOW, '--repo', shallow, '--base', 'origin/main'], { encoding: 'utf8' });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /ERROR flow: .*(shallow|full history)/);
});

test('check-flow with --task and no manifest exits 1 with missingManifest, and zero commits ahead exits 0', () => {
  const r = makeRepo();
  assert.match(r.check().stdout, /0 commits ahead of origin\/main/);
  assert.equal(r.check().status, 0);
  r.commit('feat: impl', { 'src/a.ts': 'x\n' });
  const out = r.check('--task', 'T9-01', '--json');
  assert.equal(out.status, 1);
  assert.equal(JSON.parse(out.stdout.trim()).missingManifest, true);
  assert.equal(r.check().status, 0);
});

test('check-flow fails a task list change without a Product Owner pass and accepts a status-only one', () => {
  const r = makeRepo();
  r.commit('chore(tasks): status', { 'tasks/prd.json': PRD.replace('"status": "todo"', '"status": "done"') });
  assert.equal(r.check().status, 0);
  r.commit('feat: reword', { 'tasks/prd.json': PRD.replace('"title": "t"', '"title": "u"') });
  const out = r.check();
  assert.equal(out.status, 1);
  assert.match(out.stderr, /ERROR task list:/);
});

test('check-flow takes HEAD^2 as the tip when HEAD is a merge whose first parent is an ancestor of the base', () => {
  const r = makeRepo();
  r.git('checkout', '-q', '-b', 'pr');
  const withShared = JSON.stringify({ ...JSON.parse(MANIFEST_BODY), files: ['src/a.test.ts', 'src/shared.txt'] });
  r.commit('test(T9-01): freeze', { [MANIFEST]: withShared, 'src/a.test.ts': 'v1\n', 'src/shared.txt': 'ONE\ntwo\nthree\nfour\nfive\n' });
  r.git('checkout', '-q', 'main');
  r.commit('main edits the last line', { 'src/shared.txt': 'one\ntwo\nthree\nfour\nFIVE\n' });
  r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  r.git('checkout', '-q', '--detach');
  r.git('merge', '-q', '--no-ff', 'pr', '-m', 'merge ref');
  const mergeRef = r.git('rev-parse', 'HEAD');
  assert.equal(r.git('rev-list', '--parents', '-n1', 'HEAD').split(' ').length, 3);
  r.git('checkout', '-q', 'main');
  r.commit('main moves again', { 'src/other.txt': 'x\n' });
  r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  r.git('checkout', '-q', '--detach', mergeRef);
  const out = r.check('--task', 'T9-01');
  assert.equal(out.status, 0, out.stderr);
});

test('check-flow reads HEAD itself when it is a merge whose first parent is not behind the base', () => {
  const r = makeRepo();
  r.git('checkout', '-q', '-b', 'side');
  r.commit('side');
  r.git('checkout', '-q', 'main');
  r.commit('feature work');
  r.git('merge', '-q', '--no-ff', 'side', '-m', 'merge');
  const out = r.check('--json');
  assert.equal(JSON.parse(out.stdout.trim()).commits, 2);
});

// ---- T1-14: the task workflow on a resumed branch, a wrapped gate result and leftover fixture servers ----
// The new pieces are pulled out inside each test, so a missing block or module fails only that item's tests.
const gateApi = () => {
  const api = new Function(`${gateBlock}; return { readGate, decideFrozen, decideRed, decideSync };`)();
  assert.equal(typeof api.decideSync, 'function', 'decideSync is not in the GATE block');
  return api;
};
const teardownApi = () => {
  const part = src.split('// TEARDOWN-BEGIN')[1];
  assert.ok(part, 'no // TEARDOWN-BEGIN block in task.js');
  const text = part.split('\n').slice(1).join('\n').split('// TEARDOWN-END')[0];
  return new Function(`${text}; return { withTeardown, fixturesDownCommand, decideTeardown };`)();
};
const SYNC = join(here, 'branch-sync.mjs');
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'commit.gpgsign',
  GIT_CONFIG_VALUE_0: 'false',
};
const runSync = (r, ...extra) => {
  const out = spawnSync(process.execPath, [SYNC, '--repo', r.dir, '--task', 'T9-01', '--no-fetch', ...extra], { encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  let json = null;
  try {
    json = JSON.parse(out.stdout.trim().split('\n').filter(Boolean).pop());
  } catch (error) {
    // left null; the assertion on json reports it
  }
  return { status: out.status, stdout: out.stdout, stderr: out.stderr, json };
};
// A task branch with the freeze commit first, then main moves on by one commit (the branch is behind).
const branchBehind = (options = {}) => {
  const r = makeRepo();
  if (options.baseFiles) r.commit('base: more', options.baseFiles), r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const base = r.git('rev-parse', 'HEAD');
  r.git('checkout', '-q', '-b', 'task/T9-01');
  for (const step of options.before || []) step(r);
  const frozen = options.noFreeze ? null : r.commit('test(T9-01): freeze', { [MANIFEST]: MANIFEST_BODY, 'src/a.test.ts': 'v1\n', ...(options.freezeFiles || {}) });
  r.commit('feat: impl', { 'src/impl.ts': 'x\n' });
  r.git('checkout', '-q', 'main');
  r.commit('main: moves on', options.mainFiles || { 'src/main-only.txt': 'm\n' });
  r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  r.git('checkout', '-q', 'task/T9-01');
  return { r, base, frozen, tip: r.git('rev-parse', 'HEAD') };
};
const subjects = (r) => r.git('log', '--reverse', '--format=%s', 'origin/main..HEAD').split('\n');

test('T1-14 item 1: a branch behind origin/main is rebased with the freeze commit still first and its frozen blobs unchanged', () => {
  const { r, tip } = branchBehind();
  const blob = r.git('rev-parse', 'HEAD:src/a.test.ts');
  const out = runSync(r);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.json.ok, true);
  assert.equal(out.json.rebased, true);
  assert.equal(out.json.freezeFirst, true);
  assert.notEqual(r.git('rev-parse', 'HEAD'), tip);
  r.git('merge-base', '--is-ancestor', 'origin/main', 'HEAD');
  assert.equal(r.git('rev-list', '--merges', 'origin/main..HEAD'), '');
  assert.equal(subjects(r)[0], 'test(T9-01): freeze');
  assert.equal(r.git('rev-parse', 'HEAD:src/a.test.ts'), blob);
});

test('T1-14 item 1: a branch already up to date is left alone, dirty tracked files included', () => {
  const r = makeRepo();
  r.git('checkout', '-q', '-b', 'task/T9-01');
  freeze(r);
  const tip = r.git('rev-parse', 'HEAD');
  const clean = runSync(r);
  assert.equal(clean.status, 0, clean.stderr);
  assert.equal(clean.json.rebased, false);
  assert.equal(r.git('rev-parse', 'HEAD'), tip);
  writeFileSync(join(r.dir, 'src/shared.txt'), 'edited\n');
  const dirty = runSync(r);
  assert.equal(dirty.status, 0, dirty.stderr);
  assert.equal(dirty.json.rebased, false);
  assert.equal(readFileSync(join(r.dir, 'src/shared.txt'), 'utf8'), 'edited\n');
});

test('T1-14 item 1: a branch that holds a merge of main is stopped with the merge commit named and nothing changed', () => {
  const r = makeRepo();
  r.git('checkout', '-q', '-b', 'task/T9-01');
  freeze(r);
  r.git('checkout', '-q', 'main');
  r.commit('main: moves on', { 'src/main-only.txt': 'm\n' });
  r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  r.git('checkout', '-q', 'task/T9-01');
  r.git('merge', '--no-ff', '-q', '-m', 'merge: origin/main into task', 'origin/main');
  const merge = r.git('rev-parse', 'HEAD');
  const out = runSync(r);
  assert.equal(out.status, 1);
  assert.equal(out.json.ok, false);
  assert.ok(out.json.problems.some((p) => p.includes(merge.slice(0, 12))), out.stdout);
  assert.ok(out.stderr.includes(merge.slice(0, 12)), out.stderr);
  assert.ok(out.json.merges.some((m) => m.sha === merge));
  assert.equal(r.git('rev-parse', 'HEAD'), merge);
});

test('T1-14 item 1: a rebase conflict names the file, leaves HEAD where it was and no rebase in progress', () => {
  const r = makeRepo();
  r.git('checkout', '-q', '-b', 'task/T9-01');
  freeze(r);
  r.commit('feat: edit shared', { 'src/shared.txt': 'one\ntwo\nBRANCH\nfour\nfive\n' });
  const tip = r.git('rev-parse', 'HEAD');
  r.git('checkout', '-q', 'main');
  r.commit('main: edit shared', { 'src/shared.txt': 'one\ntwo\nMAIN\nfour\nfive\n' });
  r.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  r.git('checkout', '-q', 'task/T9-01');
  const out = runSync(r);
  assert.equal(out.status, 1);
  assert.ok(out.json.problems.some((p) => p.includes('src/shared.txt')), out.stdout);
  assert.equal(r.git('rev-parse', 'HEAD'), tip);
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), 'task/T9-01');
  for (const dir of ['rebase-merge', 'rebase-apply']) assert.equal(spawnSync('test', ['-e', join(r.dir, '.git', dir)]).status, 1, dir);
});

test('T1-14 item 1: a modified tracked file on a branch that is behind blocks the sync, never stashes, and says to commit or discard', () => {
  const { r, tip } = branchBehind();
  writeFileSync(join(r.dir, 'src/shared.txt'), 'edited\n');
  const out = runSync(r);
  assert.equal(out.status, 1);
  assert.equal(out.json.rebased, false);
  assert.ok(out.json.problems.some((p) => /commit or discard/i.test(p)), out.stdout);
  assert.equal(r.git('rev-parse', 'HEAD'), tip);
  assert.equal(readFileSync(join(r.dir, 'src/shared.txt'), 'utf8'), 'edited\n');
  assert.equal(r.git('stash', 'list'), '');
});

test('T1-14 item 1: a freeze commit that is not first stays where it was and is reported with freezeFirst false', () => {
  const { r } = branchBehind({ before: [(x) => x.commit('docs: a note first', { 'docs/note.md': 'n\n' })] });
  const out = runSync(r);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.json.rebased, true);
  assert.equal(out.json.freezeFirst, false);
  assert.deepEqual(subjects(r).slice(0, 2), ['docs: a note first', 'test(T9-01): freeze']);
  r.git('merge-base', '--is-ancestor', 'origin/main', 'HEAD');
});

test('T1-14 item 1: a pre-flow branch with no manifest is rebased without the freeze check', () => {
  const { r } = branchBehind({ noFreeze: true });
  const out = runSync(r);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.json.rebased, true);
  assert.equal(out.json.freeze, null);
  r.git('merge-base', '--is-ancestor', 'origin/main', 'HEAD');
});

test('T1-14 item 1: a clean rebase that moves a frozen blob is reported with the moved path and the old tip restored, no reset --hard', () => {
  const body = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\n';
  const manifest = JSON.stringify({ task: 'T9-01', files: ['src/b.test.ts'], items: [{ item: 1, run: ['node', '-e', 'process.exit(1)'] }] });
  const { r, tip } = branchBehind({
    baseFiles: { 'src/b.test.ts': body },
    freezeFiles: { [MANIFEST]: manifest, 'src/b.test.ts': body.replace('l1\n', 'FROZEN\n') },
    mainFiles: { 'src/b.test.ts': body.replace('l9\n', 'MAIN\n') },
  });
  const out = runSync(r);
  assert.equal(out.status, 1);
  assert.equal(out.json.ok, false);
  assert.ok(out.json.problems.some((p) => p.includes('src/b.test.ts')), out.stdout);
  assert.equal(r.git('rev-parse', 'HEAD'), tip);
  assert.equal(r.git('rev-parse', '--abbrev-ref', 'HEAD'), 'task/T9-01');
  assert.equal(r.git('status', '--porcelain', '--untracked-files=no'), '');
  assert.equal(spawnSync('test', ['-e', join(r.dir, '.git', 'rebase-merge')]).status, 1);
});

test('T1-14 item 1: decideSync passes a clean result, blocks on problems naming the merge commit, and retries unreadable output once', () => {
  const { decideSync } = gateApi();
  const ok = { ok: true, rebased: true, problems: [], merges: [] };
  const pass = decideSync({ exitCode: 0, output: `noise\n${JSON.stringify(ok)}`, deniedCommands: [] }, false);
  assert.equal(pass.action, 'pass');
  assert.equal(pass.rebased, true);
  const bad = { ok: false, rebased: false, problems: ['ERROR branch: merge commit 0123456789ab "merge: main" is not allowed'], merges: [] };
  const blocked = decideSync({ exitCode: 1, output: `${JSON.stringify(bad)}\nERROR branch: merge commit 0123456789ab`, deniedCommands: [] }, false);
  assert.equal(blocked.action, 'blocked');
  assert.match(blocked.detail, /0123456789ab/);
  const retry = decideSync({ exitCode: 0, output: 'oops' }, false);
  assert.equal(retry.action, 'retry');
  assert.equal(retry.unreadable, true);
  const final = decideSync({ exitCode: 0, output: 'oops' }, true);
  assert.equal(final.action, 'blocked');
  assert.match(final.detail, /branch sync gave no readable result twice/);
});

test('T1-14 item 1: task.js runs the sync between Spec and Check, never merges, and the only pull is --ff-only on main', () => {
  const spec = src.indexOf('// 1. Spec');
  const check = src.indexOf('// 2. Check');
  const at = src.indexOf('branch-sync.mjs');
  assert.ok(at > spec && at < check, 'the sync command must sit between // 1. Spec and // 2. Check');
  assert.match(src.slice(at - 300, at + 600), /rebase/i, 'the sync gate says the command may rebase the branch');
  assert.match(src.slice(src.indexOf('${main}/.claude/workflows/branch-sync.mjs') - 20), /--repo \$\{worktree\} --task \$\{task\}/);
  assert.match(commonPrompt, /never merge/i);
  const lines = src.split('\n').filter((line) => !/never|do not|don't/i.test(line));
  assert.ok(!lines.some((line) => /git merge/.test(line)), 'a prompt tells agents to git merge');
  assert.ok(!lines.some((line) => /git pull(?! --ff-only)/.test(line)), 'a bare git pull');
});

// ---- item 2 ----
const wrapForms = (json) => {
  const one = JSON.stringify(json);
  const pretty = JSON.stringify(json, null, 2);
  return {
    'the same-line fence': `\`\`\`json ${one} \`\`\``,
    'text before the JSON on its line': `stdout: ${one}`,
    'text after the JSON on its line': `${one} (exit 0)`,
    'pretty-printed over several lines': pretty,
    'pretty-printed in a fence with prose around it': `Here is the result:\n\`\`\`json\n${pretty}\n\`\`\`\nThat is everything it printed.`,
    'followed by a nested path/blob line': `${one}\n{"path":"a.test.ts","blob":"b1"}`,
    'followed by a JSON log line without ok': `${one}\n{"level":"info","msg":"done"}`,
    'wrapped in a non-result object': JSON.stringify({ stdout: json, extra: 1 }),
    'log lines before it': `info: start\nwarn: slow\n${one}`,
    'ERROR lines after it': `${one}\nERROR frozen test: x\nERROR more`,
    'a fence on its own lines': `\`\`\`\n${one}\n\`\`\``,
    'a stray quote in a log line before it': `it said "oops and left a quote open\n${one}`,
  };
};
const realFlow = () => {
  const r = makeRepo();
  r.git('checkout', '-q', '-b', 'task/T9-01');
  freeze(r);
  r.commit('feat: impl', { 'src/a.ts': 'x\n' });
  const out = r.check('--task', 'T9-01', '--json');
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout.trim().split('\n').pop());
};

test('T1-14 item 2: decideFrozen reads a real check-flow result in every wrapped form', () => {
  const json = realFlow();
  assert.equal(json.ok, true);
  const pinned = Object.fromEntries(json.frozen.map((f) => [f.path, f.blob]));
  for (const [name, output] of Object.entries(wrapForms(json))) {
    const got = decideFrozen({ exitCode: 0, output, deniedCommands: [] }, [], pinned, false);
    assert.equal(got.action, 'pass', `${name}: ${JSON.stringify(got)}`);
  }
});

test('T1-14 item 2: a result whose strings hold braces and escaped quotes reads correctly', () => {
  const json = { ...flow({ ok: false }), problems: ['ERROR frozen test: "a}b" changed {x} \\"q\\"'] };
  const got = decideFrozen({ exitCode: 1, output: `log "{\n${JSON.stringify(json)}\nERROR tail`, deniedCommands: [] }, [], undefined, false);
  assert.equal(got.action, 'stop');
  assert.equal(got.detail, json.problems.join('; '));
});

test('T1-14 item 2: output with no object, or only non-result objects, is unreadable and then stops', () => {
  for (const output of ['oops', 'ERROR only\nmore', '{"path":"a.test.ts","blob":"b1"}', '{"level":"info"}\n[1,2]', '{ not json }']) {
    const first = decideFrozen({ exitCode: 0, output, deniedCommands: [] }, [], {}, false);
    assert.equal(first.action, 'retry', output);
    assert.equal(first.unreadable, true, output);
    assert.equal(decideFrozen({ exitCode: 0, output, deniedCommands: [] }, [], {}, true).action, 'stop', output);
  }
});

test('T1-14 item 2: decideRed reads a pretty-printed check-red result and the sync, red and frozen gates share the scanner', () => {
  const { decideRed: red } = gateApi();
  const result = { task: 'T9-01', expect: 'red', red: [1, 2], green: [], gates: [], blobs: { 'a.test.ts': 'b1' }, problems: [] };
  const got = red({ exitCode: 0, output: `Result:\n${JSON.stringify(result, null, 2)}\ndone`, deniedCommands: [] });
  assert.equal(got.action, 'pass');
  assert.deepEqual(got.blobs, { 'a.test.ts': 'b1' });
  assert.equal(red({ exitCode: 0, output: `${JSON.stringify(result)}\n{"level":"info"}`, deniedCommands: [] }).action, 'pass');
});

// ---- item 3 ----
const FIXTURES = join(here, 'fixtures-down.mjs');
const fixturesApi = async () => {
  const mod = await import(FIXTURES);
  assert.equal(typeof mod.tearDown, 'function');
  assert.equal(typeof mod.projectNameFor, 'function');
  return mod;
};
const fakeExec = (psRows) => {
  const calls = [];
  const exec = (file, args) => {
    calls.push([file, ...args]);
    if (args[0] === 'ps') return { status: 0, stdout: psRows(args), stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { calls, exec };
};
const downCalls = (calls) => calls.filter((c) => c[1] === 'compose' && c.includes('down'));

test('T1-14 item 3: projectNameFor gives the same name as composeProjectName for an existing directory', async () => {
  const { projectNameFor } = await fixturesApi();
  const { composeProjectName } = await import(join(root, 'tests', 'integration', 'compose-project.mjs'));
  const dir = mkdtempSync(join(tmpdir(), 'octave-T9-01-'));
  dirs.push(dir);
  assert.equal(projectNameFor(dir), composeProjectName(dir));
  assert.match(projectNameFor(dir), /^octave-[0-9a-f]{10}$/);
});

test('T1-14 item 3: only this worktree\'s project is brought down, with the main checkout\'s compose file, by docker argv with no shell', async () => {
  const { tearDown, projectNameFor } = await fixturesApi();
  const worktree = '/gone/octave-T9-01';
  const mine = projectNameFor(worktree);
  const other = projectNameFor('/x/octave-T3-05');
  const { calls, exec } = fakeExec(() => `${mine}\n${other}\n`);
  const composeFile = '/main/octave/tests/integration/docker-compose.yml';
  const report = tearDown({ worktree, composeFile, exec, exists: () => false, realpath: (p) => p });
  assert.equal(report.ok, true);
  assert.deepEqual(report.stopped, [mine]);
  const downs = downCalls(calls);
  assert.equal(downs.length, 1);
  assert.deepEqual(downs[0].slice(0, 6), ['docker', 'compose', '-p', mine, '-f', composeFile]);
  for (const flag of ['down', '-v', '--remove-orphans']) assert.ok(downs[0].includes(flag), flag);
  assert.ok(!calls.some((c) => c.includes(other) && c[1] === 'compose'), 'another checkout\'s project was passed to compose');
  for (const call of calls) {
    assert.equal(call[0], 'docker');
    assert.ok(!['rm', 'kill', 'stop'].includes(call[1]), call.join(' '));
  }
  const ps = calls.find((c) => c[1] === 'ps');
  assert.ok(ps.includes('-a') && ps.some((a) => a.includes('label=com.docker.compose.project=')), ps.join(' '));
});

test('T1-14 item 3: a project with no containers is not brought down, and a missing Docker is reported without failing', async () => {
  const { tearDown } = await fixturesApi();
  const idle = fakeExec(() => '');
  const none = tearDown({ worktree: '/gone/octave-T9-01', composeFile: '/m/c.yml', exec: idle.exec, exists: () => false, realpath: (p) => p });
  assert.equal(none.ok, true);
  assert.deepEqual(none.stopped, []);
  assert.equal(downCalls(idle.calls).length, 0);
  const missing = tearDown({ worktree: '/gone/octave-T9-01', composeFile: '/m/c.yml', exec: () => ({ status: null, stdout: '', stderr: '', error: { code: 'ENOENT' } }), exists: () => false, realpath: (p) => p });
  assert.equal(missing.ok, true);
  assert.deepEqual(missing.stopped, []);
  assert.equal(missing.note, 'docker not found');
});

test('T1-14 item 3: a failing down is a problem and the exit is not ok', async () => {
  const { tearDown, projectNameFor } = await fixturesApi();
  const mine = projectNameFor('/gone/octave-T9-01');
  const exec = (file, args) => (args[0] === 'ps' ? { status: 0, stdout: `${mine}\n`, stderr: '' } : { status: 1, stdout: '', stderr: 'boom' });
  const report = tearDown({ worktree: '/gone/octave-T9-01', composeFile: '/m/c.yml', exec, exists: () => false, realpath: (p) => p });
  assert.equal(report.ok, false);
  assert.ok(report.problems.length >= 1);
});

test('T1-14 item 3: the CLI resolves a relative worktree against the current directory, which is the main checkout', async () => {
  const { projectNameFor } = await fixturesApi();
  const base = mkdtempSync(join(tmpdir(), 'td-'));
  dirs.push(base);
  const main = join(base, 'octave');
  mkdirSync(join(main, 'tests', 'integration'), { recursive: true });
  mkdirSync(join(base, 'bin'));
  const log = join(base, 'docker.log');
  writeFileSync(join(base, 'bin', 'docker'), `#!/bin/sh\necho "$@" >> "${log}"\nif [ "$1" = ps ]; then for a in "$@"; do case "$a" in label=com.docker.compose.project=*) echo "\${a#label=com.docker.compose.project=}";; esac; done; fi\n`, { mode: 0o755 });
  const out = spawnSync(process.execPath, [FIXTURES, '--worktree', '../octave-T9-01', '--compose-file', 'tests/integration/docker-compose.yml'], {
    cwd: main,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(base, 'bin')}:${process.env.PATH}` },
  });
  assert.equal(out.status, 0, out.stderr);
  const json = JSON.parse(out.stdout.trim().split('\n').pop());
  const expected = projectNameFor(join(realpathSync(base), 'octave-T9-01'));
  assert.deepEqual(json.stopped, [expected]);
  const down = readFileSync(log, 'utf8').split('\n').find((l) => l.startsWith('compose'));
  assert.ok(down.includes(`-p ${expected}`), down);
  assert.ok(down.includes(join(realpathSync(base), 'octave', 'tests', 'integration', 'docker-compose.yml')) || down.includes(join(main, 'tests', 'integration', 'docker-compose.yml')), down);
});

test('T1-14 item 3: withTeardown tears down exactly once for every outcome and when the run throws, and puts fixtures on the result', async () => {
  const { withTeardown } = teardownApi();
  for (const outcome of ['merged', 'parked', 'blocked', 'failed', 'denied', 'tests-green', 'frozen-tests', 'ci-red']) {
    let calls = 0;
    const fixtures = { stopped: ['octave-8b8377b9f2'], detail: 'stopped octave-8b8377b9f2' };
    const out = await withTeardown(async () => ({ task: 'T9-01', outcome, detail: 'd' }), async () => (calls += 1, fixtures));
    assert.equal(calls, 1, outcome);
    assert.equal(out.outcome, outcome);
    assert.deepEqual(out.fixtures, fixtures);
  }
  let calls = 0;
  const thrown = await withTeardown(async () => { throw new Error('agent crashed'); }, async () => (calls += 1, { stopped: [], detail: 'none running' }));
  assert.equal(calls, 1);
  assert.equal(thrown.outcome, 'failed');
  assert.match(String(thrown.detail), /agent crashed/);
  assert.deepEqual(thrown.fixtures, { stopped: [], detail: 'none running' });
  const broken = await withTeardown(async () => ({ outcome: 'merged' }), async () => { throw new Error('no docker agent'); });
  assert.equal(broken.outcome, 'merged');
  assert.deepEqual(broken.fixtures.stopped, []);
  assert.match(broken.fixtures.detail, /no docker agent/);
});

test('T1-14 item 3: decideTeardown reads a wrapped result, reports unreadable output without throwing, and passes a denied list through', () => {
  const { decideTeardown, fixturesDownCommand } = teardownApi();
  const report = (extra) => ({ ok: true, worktree: '/w', projects: [], stopped: [], problems: [], ...extra });
  const wrap = (r) => ({ exitCode: 0, output: `log\n\`\`\`json\n${JSON.stringify(r, null, 2)}\n\`\`\`\n`, deniedCommands: [] });
  assert.deepEqual(decideTeardown(wrap(report({ stopped: ['octave-8b8377b9f2'] }))), { stopped: ['octave-8b8377b9f2'], detail: 'stopped octave-8b8377b9f2' });
  assert.deepEqual(decideTeardown(wrap(report())), { stopped: [], detail: 'none running' });
  assert.deepEqual(decideTeardown(wrap(report({ note: 'docker not found' }))), { stopped: [], detail: 'docker not found' });
  assert.equal(decideTeardown(wrap(report({ ok: false, problems: ['down failed', 'again'] }))).detail, 'down failed; again');
  assert.deepEqual(decideTeardown({ exitCode: 0, output: 'oops', deniedCommands: [] }), { stopped: [], detail: 'the fixture teardown gave no readable result' });
  assert.deepEqual(decideTeardown(null), { stopped: [], detail: 'the fixture teardown gave no readable result' });
  assert.deepEqual(decideTeardown({ exitCode: 1, output: '', deniedCommands: ['mise exec -- node x'] }).denied, ['mise exec -- node x']);
  assert.equal(
    fixturesDownCommand({ main: '/m/octave', worktree: '/m/octave-T9-01' }),
    'mise exec -- node /m/octave/.claude/workflows/fixtures-down.mjs --worktree /m/octave-T9-01 --compose-file /m/octave/tests/integration/docker-compose.yml',
  );
});

test('T1-14 item 3: the batch loop tears down through withTeardown on the Ship phase, still tests STOP_OUTCOMES, and stops on a denied teardown', () => {
  const loop = src.slice(src.indexOf('const outcomes = []'));
  assert.match(loop, /withTeardown\(/);
  assert.match(loop, /STOP_OUTCOMES\.includes\(out\.outcome\)/);
  assert.match(loop, /fixtures\.denied/);
  const teardown = src.slice(src.indexOf('tearDownFixtures'));
  assert.match(teardown.slice(0, 1500), /phase: 'Ship'/);
  assert.match(teardown.slice(0, 1500), /models\.gate/);
  assert.match(src, /fixtures-down\.mjs/);
});

// ---- item 4 ----
test('T1-14 item 4: WORKFLOW.md states the rebase rule and the fixture teardown', () => {
  const doc = read('WORKFLOW.md');
  const section = doc.split('### Wiring it up in Claude Code')[1].split('\n## ')[0];
  const parts = section.split(/\n(?=- |\n)/);
  assert.ok(parts.some((p) => /rebase/i.test(p) && /freeze commit/i.test(p) && /never merges? (origin\/)?main into a task branch/i.test(p)), 'rebase rule');
  assert.ok(parts.some((p) => /fixture servers/i.test(p) && /another checkout/i.test(p)), 'teardown');
  assert.match(read('.claude/skills/ship/SKILL.md'), /Never merge `origin\/main` into a task branch/);
});
