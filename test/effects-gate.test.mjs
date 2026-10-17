import test from "node:test";
import assert from "node:assert/strict";
import { route } from "../src/gate.mjs";

// The gate's existing behaviour must be UNCHANGED when no cell
// confidence is supplied. A gate that cannot see an effect must not
// invent one.
test("with no cell confidence, the gate behaves exactly as before", () => {
  const a = route({ should_apply: { noul: 0.9 } }, { parentOk: true });
  assert.equal(a.action, "act");
  const b = route({ should_apply: { noul: 0.2 } }, { parentOk: true });
  assert.equal(b.action, "review");
  const c = route({ should_apply: { noul: 0.9 } }, { parentOk: false });
  assert.equal(c.action, "block");
  const d = route({}, { parentOk: true });
  assert.equal(d.action, "block", "absent signal still fails closed");
});

test("an action on a confident cell applies", () => {
  const a = route({ should_apply: { noul: 0.9 } }, { parentOk: true, cellConfidence: 0.97 });
  assert.equal(a.action, "act");
  assert.equal(a.cellConfidence, 0.97);
});

test("an action on a FRAGILE cell goes to review even when the intent signal is strong", () => {
  const a = route({ should_apply: { noul: 0.95 } }, { parentOk: true, cellConfidence: 0.37 });
  assert.equal(a.action, "review");
  assert.match(a.reason, /37% confident/);
  // and it is REVIEW, never block -- the cell is uncertain, but that is
  // a statement about the state, not a confident no about the action.
  assert.notEqual(a.action, "block");
});

test("the fragile-cell bar is configurable", () => {
  const a = route({ should_apply: { noul: 0.9 } },
    { parentOk: true, cellConfidence: 0.60, fragileThreshold: 0.9 });
  assert.equal(a.action, "review");
  const b = route({ should_apply: { noul: 0.9 } },
    { parentOk: true, cellConfidence: 0.60, fragileThreshold: 0.5 });
  assert.equal(b.action, "act");
});

test("a confident no still blocks, whatever the cell looks like", () => {
  const a = route({ should_apply: { noul: 0.99 } },
    { parentOk: false, cellConfidence: 0.99 });
  assert.equal(a.action, "block");
});

test("absent signal still fails closed even with a confident cell", () => {
  const a = route({}, { parentOk: true, cellConfidence: 0.99 });
  assert.equal(a.action, "block");
});
