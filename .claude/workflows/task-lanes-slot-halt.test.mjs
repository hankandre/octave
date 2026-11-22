// Run: node --test .claude/workflows/task-lanes-slot-halt.test.mjs
// T1-19 review finding: a lane queued for the serial slot must re-check the halt once it holds the slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'task.js'), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const until = async (cond, what) => {
  for (let i = 0; i < 4000; i += 1) {
    if (cond()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
};
const relay = (json) => ({ exitCode: 0, output: JSON.stringify(json) });
const work = (extra = {}) => ({ done: true, checksPassed: true, summary: 'ok', evidence: 'commit abc1234', failures: [], blockers: [], ciSteps: [], ciOnly: [], ...extra });

test('T1-19 slot halt: a lane waiting for the serial slot starts no agent after a denial in the slot holder', async () => {
  const text = src.replace('export const meta', 'const meta');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('args', 'agent', 'log', text);
  const tasks = [
    { id: 'T9-01', lane: 'native-session' },
    { id: 'T9-02', lane: 'ui' },
  ];
  const started = new Set();
  const labels = [];
  let release;
  const holdImplement = new Promise((resolve) => {
    release = resolve;
  });
  const agent = async (prompt, opts) => {
    const label = String(opts.label);
    const key = label.replace(/ T\d+-\d{2}/, '');
    const id = (label.match(/T\d+-\d{2}/) || [])[0];
    labels.push(label);
    await tick();
    if (key.startsWith('lane state ')) {
      const lane = key.slice('lane state '.length).replace(/ \(again\)$/, '');
      const list = tasks.filter((t) => t.lane === lane && !started.has(t.id));
      const inFlight = tasks.filter((t) => t.lane === lane && started.has(t.id)).map((t) => ({ id: t.id, where: `../octave-${t.id}` }));
      return relay({
        ok: true,
        lane,
        serial: lane === 'native-session',
        tasks: list.map((t) => ({ id: t.id, model: 'sonnet', depends_on: [], waitingOn: [] })),
        inFlight,
        problems: [],
      });
    }
    switch (key) {
      case 'spec':
        started.add(id);
        return { summary: 's', openQuestions: [], touchesNative: id === 'T9-02' };
      case 'sync':
        return relay({ ok: true, rebased: false, problems: [] });
      case 'check':
        return { approved: true, issues: [], touchesNative: false };
      case 'tests':
        return { done: true, summary: 't', blockers: [] };
      case 'red gate':
        return relay({ task: id, expect: 'red', red: [1], green: [], gates: [], blobs: {}, problems: [] });
      case 'implement':
        if (id === 'T9-01') {
          await holdImplement;
          return work({ deniedCommands: ['rm -rf /tmp/x'] });
        }
        return work();
      case 'fixtures down':
        return relay({ stopped: [], problems: [] });
      default:
        return null;
    }
  };
  const done = run({ root: '/r', lanes: ['native-session', 'ui'] }, agent, () => {});
  await until(() => labels.includes('spec T9-02') && labels.includes('check T9-02'), 'the ui check');
  for (let i = 0; i < 100; i += 1) await tick();
  assert.ok(labels.includes('implement T9-01'), 'the slot holder reached implement');
  assert.ok(!labels.includes('tests T9-02'), 'ui waits for the slot before the test writer');
  release();
  const result = await done;
  assert.ok(!labels.includes('tests T9-02'), `no test writer after the denial; got ${labels.join(' | ')}`);
  assert.ok(!labels.includes('implement T9-02'));
  const ui = (result.needsAttention || []).find((o) => o.task === 'T9-02');
  assert.equal(ui?.outcome, 'halted', JSON.stringify(result));
});
