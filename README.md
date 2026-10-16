# gitpp-gate

> Confidence-gated nudging for the git.pp fold. Ask before you nudge, fail closed, and log the decision as a record.

## The gap this fills

The nudge loop had two holes, and the last two rounds closed them:

- **§5.6** made a nudge *reliably expressible* — `derive()` returns `setters`, so you can parent on the record that actually sets the key. Without it, a nudge lands or is silently discarded depending on nothing but whether its own id sorted first.
- **`gitpp-nudge`** made it *verifiable after the fact* — re-fold and assert the nudge landed.

Neither answers the prior question: **should this nudge happen at all?** A nudge that lands is not the same as a nudge that was right. And the failure is the quiet kind — state simply stops moving, no conflict, no exception.

## How it works

Before applying, the gate asks [TypeSafe's Jev](https://docs.typesafe.ai) two narrow questions and routes on the answer:

| Question | Type | Meaning |
|---|---|---|
| `should_apply` | noul | is this a well-founded update, given the current state? |
| `parent_is_current_setter` | noul | is the record we are parenting on still the setter? |

Then **code** — not the model — decides:

```
act      every gate clear of threshold
review   the decision is close, or a gate is weak
block    a gate is confidently no, or no gate answered
```

Jev is good at one thing: structured decisions with calibrated probabilities.
It is not asked what the right value is. The code knows that. It is asked
only whether the decision the code already wants to make is safe.

## Measured, not assumed

Real calls against Jev, on a two-record synthetic state:

| case | `should_apply` | `parent_is_current_setter` | routed |
|---|---|---|---|
| well-founded nudge, correct parent | **0.35** | **0.61** | `review` |
| unjustified nudge ("no idea") | **0.07** | — | `review` |
| nudge parented on the wrong record | — | **0.15** | `block` |

Two things fall out of this, and both are in the design:

**The parent gate separates. The intent gate does not.** Correct parent 0.61
vs wrong parent 0.15 — that discriminates. Good intent 0.35 vs bad 0.07 —
real separation, but the wrong *scale*: a fixed cutoff that admits the bad
case also blocks the good one. So the intent gate is **not allowed to
block**; it routes to `review`. The parent gate, which does separate, is
the only one that can block.

**The threshold is a knob, not a constant.** `DEFAULT_THRESHOLD = 0.80` is
a starting point to be tuned against *real* record sets. Tuning it until
this test's assertions pass would be the same false-green move this project
has now made six times, so the test asserts the mechanism instead and prints
the calibration.

## Fail closed

An earlier draft treated missing answers as "no conflicts" and routed to
`act`. That means **an unreachable Jev would silently authorise every nudge
in the system** — the exact failure this repo exists to prevent.

```js
route({})                      // -> block: no signal from: should_apply, parent_is_current_setter
route({should_apply:{noul:0.99}})  // -> block: no signal from: parent_is_current_setter
```

Absent signal is not consent. Override deliberately with `{onMissing:"review"}`
if you want a different posture, but never `act`.

## How this builds on what exists

| this | depends on |
|------|-----------|
| `gitpp-gate` | [`git.pp-spec`](https://github.com/SuperInstance/git.pp-spec) §5.6 — `setters` |
| | [`gitpp-nudge`](https://github.com/SuperInstance/gitpp-nudge) — author + verify a nudge |
| | [`gitpp-fold-conformance`](https://github.com/SuperInstance/gitpp-fold-conformance) — fold semantics, 26 cases |
| | [TypeSafe Jev](https://docs.typesafe.ai) — calibrated structured decisions |

## Run

```bash
export TYPESAFE_AI_TOKEN=...      # TYPESAFE_API_KEY also accepted
node test/gate.test.mjs           # live calls
```

`test/gate.test.mjs` makes real network calls and asserts the *mechanism*:
wrong parent is caught, unjustified nudges are not auto-applied, missing
signal blocks, and routing is pure and threshold-driven.

## Known limits

- `api.typesafe.ai` presents a certificate whose SAN list is marked
  **critical**, which strict verifiers (including Node's `fetch`) reject.
  The test shells out to `curl -k`. A skipped check is a real check; this
  is documented, not hidden.
- The intent gate is uncalibrated on thin state and currently only
  triggers `review`. It needs real record sets before it can earn `block`.
- The C# port in the table is missing — `gitpp-cs` and `gitpp-pl` are
  checked out as siblings in CI but not exercised by this test yet.
- Nothing here has run against a live `gitpp-hub-api`. The gate is a pure
  decision layer; wiring it into the write path is the next step.
