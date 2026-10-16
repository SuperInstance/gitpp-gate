// End-to-end: real Jev, real routing, a real nudge loop.
// Uses curl via child_process because api.typesafe.ai presents a cert
// whose SAN list is marked critical, which Node's fetch refuses.
import { spawnSync } from "node:child_process";
import { route, proposeNudge, intentQuestion, parentQuestion, PARENT_BLOCK_BELOW }
  from "../src/gate.mjs";

const KEY = process.env.TYPESAFE_AI_TOKEN;
if (!KEY) { console.error("  TYPESAFE_AI_TOKEN not set"); process.exit(2); }

function jev(state, questions) {
  const r = spawnSync("curl", ["-sk", "-m", "60", "https://api.typesafe.ai/v1/systemone",
    "-H", `Authorization: Bearer ${KEY}`, "-H", "Content-Type: application/json",
    "--data-binary", JSON.stringify({ state, model: "jev-latest", questions })],
    { encoding: "utf8", maxBuffer: 1 << 22 });
  if (r.status !== 0) throw new Error(`curl exit ${r.status}`);
  const d = JSON.parse(r.stdout);
  if (d.error || !d.answers) throw new Error(JSON.stringify(d).slice(0, 200));
  return d.answers;
}

const RECORDS = [
  { id: "t1", kind: "task", parents: [], effects: { status: "todo" }, reason: "filed" },
  { id: "t2", kind: "task", parents: ["t1"], effects: { status: "wip" }, reason: "started" },
];
// stand-in for derive(): §5.6 setters
const FOLDED = { state: { status: "wip" }, setters: { status: "t2" } };

function stateFor(kind, value, reason, id) {
  return [
    `Record ${id} is a ${kind} record.`,
    kind === "task" ? `Its parents are [${RECORDS.find((r) => r.id === "t2").parents.join(", ")}].` : "",
    `It sets status=${value}.`,
    `Its reason: "${reason}".`,
    `The record that currently sets the key "status" is t2 (a task, child of t1).`,
  ].filter(Boolean).join(" ");
}

let fails = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!ok) fails++;
};

console.log("1. a well-founded nudge, correctly parented  [CALIBRATION]");
{
  const p = proposeNudge(RECORDS, FOLDED, "status", "done", { id: "n1", reason: "work is complete" });
  const s = stateFor("task", "done", "work is complete", "n1") + ` It names t2 as its parent.`;
  const a = jev(s, { ...intentQuestion(), ...parentQuestion(FOLDED.setters.status, p.parents[0]) });
  const d = route(a);
  // NOT "expect act". On a two-record synthetic state, Jev scores this
  // well-founded nudge well below the default threshold. Tuning the
  // threshold until this assertion passes would be the same false-green
  // move this project has now made six times. What matters is that the
  // gate reads the signal faithfully and fails closed, so assert THAT.
  check(p.parents[0] === "t2", "nudge parents on the current setter");
  check(d.action === "review", "a well-founded nudge routes to review, not block", `${d.action} apply=${d.apply} parent=${d.parent}`);
  console.log(`        measured: should_apply=${d.apply}  parent_is_current_setter=${d.parent}`);
  console.log("        the default threshold is a KNOB, not a constant. It has to be");
  console.log("        tuned against real record sets, not against this test.");
}

console.log("2. a nudge nobody justified");
{
  const p = proposeNudge(RECORDS, FOLDED, "status", "shipped", { id: "n2", reason: "no idea" });
  const s = stateFor("task", "shipped", "no idea whatsoever, no supporting work exists", "n2")
    + ` It names t2 as its parent.`;
  const a = jev(s, { ...intentQuestion(), ...parentQuestion(FOLDED.setters.status, p.parents[0]) });
  const d = route(a);
  check(d.action !== "act", "does NOT auto-apply an unjustified nudge", `${d.action} apply=${d.apply}`);
  check(d.apply < 0.5, "Jev scores it as clearly unjustified", `apply=${d.apply}`);
}

console.log("3. a nudge parented on the WRONG record");
{
  const p = proposeNudge(RECORDS, FOLDED, "status", "done", { id: "n3" });
  const s = stateFor("task", "done", "finished", "n3")
    + ` It names t1 as its parent, NOT t2. t1 no longer sets this key.`;
  const a = jev(s, { ...intentQuestion(), ...parentQuestion(FOLDED.setters.status, p.parents[0]) });
  const d = route(a);
  check(d.action === "block" || d.action === "review", "wrong parent is not auto-applied", `${d.action} parent=${d.parent}`);
  check(d.parent !== null && d.parent < 0.9, "Jev actually flagged the wrong parent", `parent=${d.parent}`);
}

console.log("4. fail-closed: no signal must not mean consent");
{
  const d = route({});
  check(d.action === "block", "empty answers block", d.reason);
  const d2 = route({ should_apply: { noul: 0.99 } });
  check(d2.action === "block", "partial answers block", d2.reason);
}

console.log("5. routing is pure and threshold-driven");
{
  const at = (a, t) => route(a, { threshold: t }).action;
  check(at({ should_apply: { noul: 0.7 }, parent_is_current_setter: { noul: 0.9 } }, 0.8) === "review", "0.7 apply at 0.8 threshold -> review");
  check(at({ should_apply: { noul: 0.7 }, parent_is_current_setter: { noul: 0.9 } }, 0.6) === "act", "0.7 apply at 0.6 threshold -> act");
  check(at({ should_apply: { noul: 0.9 }, parent_is_current_setter: { noul: 0.3 } }, 0.8) === "block", "0.3 parent -> block");
}

console.log(fails ? `\n${fails} assertion(s) failed` : "\nall assertions hold");
process.exit(fails ? 1 : 0);
