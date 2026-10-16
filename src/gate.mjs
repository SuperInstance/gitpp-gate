// The gate: decide whether a proposed nudge may be APPLIED, must be REVIEWED,
// or must be BLOCKED -- and return that decision as a RECORD so the decision
// itself is auditable.
//
// Why this exists. §5.6 made a nudge reliably expressible, and gitpp-nudge
// made it verifiable after the fact. Neither answers the prior question: should
// this nudge happen at all? A nudge that lands is not the same as a nudge that
// was right.
//
// The routing rule is deliberately boring, and lives in code, not in the model:
//
//   act     every required gate is confident enough
//   review  the decision is close to the threshold, or the gates disagree
//   block   a gate is confidently NO
//
// Jev is asked narrow questions. The code decides what those answers mean.

export const DEFAULT_THRESHOLD = 0.80;

// "Is X the current setter?" is a near-binary FACT question, not a judgement
// call, so it gets a stricter bar than the intent question. A 0.21 on the
// parent gate means the nudge is probably going to be silently discarded --
// that is a hard failure to route, not a judgement to review.
export const PARENT_BLOCK_BELOW = 0.50;

/** Classify a record's class for the §5.1 precedence question. */
export function classQuestion() {
  return {
    winner: {
      type: "choice",
      instructions: "Which record sets the final value of the key, given class precedence override > task > witness",
      criteria: {
        override: "an override record — highest class, wins regardless of ancestry",
        task: "a task record — outranks a witness, loses only to an override",
        witness: "a witness record — lowest class, loses to any task or override",
      },
    },
  };
}

/** Is the proposed parent actually the current setter? */
export function parentQuestion(currentSetter, proposedId) {
  return {
    parent_is_current_setter: {
      type: "noul",
      instructions: `The record that currently sets this key is "${currentSetter}". The proposed nudge names "${proposedId}" as its parent and therefore depends on that record remaining the setter. The parent choice is correct.`,
    },
  };
}

/** Should this nudge land at all? */
export function intentQuestion() {
  return {
    should_apply: {
      type: "noul",
      instructions:
        "The proposed change is a well-founded update to the current state: it follows from the current setter, it does not contradict a higher-precedence record, and its stated reason matches the change.",
    },
  };
}

/** Combine a set of answered questions into a routing decision. */
export function route(answers, opts = {}) {
  const t = opts.threshold ?? DEFAULT_THRESHOLD;
  const applyP = probOf(answers?.should_apply);
  const parentP = probOf(answers?.parent_is_current_setter);
  const conflicts = [];

  // FAIL CLOSED. A gate that cannot answer must never be read as consent.
  // An earlier draft treated missing answers as "no conflicts" and routed
  // to `act`, which means an unreachable Jev silently authorised every
  // nudge in the system -- the exact failure this repo exists to prevent.
  if (applyP === null || parentP === null) {
    const missing = [];
    if (applyP === null) missing.push("should_apply");
    if (parentP === null) missing.push("parent_is_current_setter");
    return {
      action: opts.onMissing ?? "block",
      reason: `no signal from: ${missing.join(", ")}`,
      apply: applyP,
      parent: parentP,
    };
  }

  // Disqualifying, each with its own bar. See PARENT_BLOCK_BELOW.
  const pb = opts.parentBlockBelow ?? PARENT_BLOCK_BELOW;
  // The intent gate does NOT block on its own. Measured on a two-record
  // synthetic state: a well-founded nudge scored 0.35 and an unjustified one
  // 0.07. That is real separation but the wrong scale, and a fixed cutoff
  // would block legitimate work. It routes to review instead. The parent
  // gate, which separates 0.62 from 0.15, is the one allowed to block.
  if (parentP !== null && parentP < pb) conflicts.push(`parent_is_current_setter=${parentP.toFixed(3)}`);

  if (conflicts.length) {
    return { action: "block", reason: `confidently no: ${conflicts.join(", ")}`, apply: applyP, parent: parentP };
  }
  // Weak intent signal on thin state is a review trigger, never a block.
  if (applyP !== null && applyP < t) {
    return { action: "review", reason: `should_apply=${applyP.toFixed(3)} below ${t}`, apply: applyP, parent: parentP };
  }
  if (parentP !== null && parentP < t) {
    return { action: "review", reason: `parent confidence=${parentP.toFixed(3)} below ${t}`, apply: applyP, parent: parentP };
  }
  return { action: "act", reason: "all gates confident", apply: applyP, parent: parentP };
}

function probOf(a) {
  if (!a) return null;
  if (typeof a.noul === "number") return a.noul;
  if (a.noul && typeof a.noul.probability === "number") return a.noul.probability;
  return null;
}

/**
 * Build the record for a proposed nudge, WITHOUT applying it.
 * `setters` comes from derive() per spec §5.6.
 */
export function proposeNudge(records, folded, key, value, opts = {}) {
  const setter = folded?.setters?.[key] ?? null;
  const kind = opts.kind ?? (records.find((r) => r.id === setter)?.kind ?? "task");
  const id = opts.id ?? `nudge-${String(records.length + 1).padStart(4, "0")}`;
  return {
    id,
    kind,
    parents: setter ? [setter] : [],
    effects: { [key]: value },
    reason: opts.reason ?? `gate: propose ${key}`,
    _setter: setter,
  };
}
