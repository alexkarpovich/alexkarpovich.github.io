const test = require("node:test");
const assert = require("node:assert/strict");
const runtime = require("../js/runtime");
const tick = () => new Promise(resolve => setImmediate(resolve));

test("reader coalesces pending reads, bounds concurrency and does not cache results", async () => {
  const read = runtime.createReader(3);
  let active = 0;
  let peak = 0;
  let calls = 0;
  const fetch = async () => {
    calls++;
    peak = Math.max(peak, ++active);
    await tick();
    active--;
    return calls;
  };
  const first = read("same", fetch);
  assert.equal(read("same", fetch), first);
  await Promise.all([first, ...Array.from({ length: 20 }, (_, i) => read(String(i), fetch))]);
  assert.equal(calls, 21);
  assert.equal(peak, 3);
  await read("same", fetch);
  assert.equal(calls, 22);
  await assert.rejects(read("failure", () => { throw new Error("offline"); }), /offline/);
  assert.equal(await read("failure", () => 42), 42);
});

test("pool preserves input order with at most eight in-flight reads", async () => {
  let active = 0;
  let peak = 0;
  const input = Array.from({ length: 100 }, (_, i) => i);
  const output = await runtime.mapPool(input, 8, async i => {
    peak = Math.max(peak, ++active);
    await tick();
    active--;
    return i * 2;
  });
  assert.equal(peak, 8);
  assert.deepEqual(output, input.map(i => i * 2));
});

test("render bursts run one trailing refresh without overlapping loads", async () => {
  let calls = 0;
  let active = 0;
  let peak = 0;
  const refresh = runtime.coalesce(async () => {
    calls++;
    peak = Math.max(peak, ++active);
    await tick();
    active--;
  });
  const first = refresh();
  await Promise.resolve();
  assert.equal(refresh(), first);
  refresh();
  await first;
  assert.equal(calls, 2);
  assert.equal(peak, 1);
  await refresh();
  assert.equal(calls, 3);
});

test("a failed refresh can be retried", async () => {
  let calls = 0;
  const refresh = runtime.coalesce(() => {
    if (++calls === 1) throw new Error("offline");
  });
  await assert.rejects(refresh(), /offline/);
  await refresh();
  assert.equal(calls, 2);
});

test("failed pools stop scheduling and finish in-flight work before rejecting", async () => {
  let calls = 0;
  let active = 0;
  await assert.rejects(runtime.mapPool(Array.from({ length: 100 }), 3, async (_, i) => {
    calls++;
    if (i === 0) throw new Error("offline");
    active++;
    await tick();
    active--;
  }), /offline/);
  assert.equal(active, 0);
  assert.equal(calls, 3);
});
