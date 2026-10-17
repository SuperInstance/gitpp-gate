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

/**
 * Is the proposed parent actually the current setter?
 *
 * NOT a model question. proposeNudge() computes the parent FROM
 * folded.setters[key], so the prompt would contain its own answer. The
 * measured "0.61 correct vs 0.15 wrong" was not separation -- it was the
 * model misreading a fact the caller already knew exactly.
 *
 * The scout was right that this inverts the gate: a decidable predicate
 * held the only blocking authority, while the genuinely underdetermined
 * question (should_apply) was barred from blocking. The decisive check is
 * a string comparison, free and offline.
 */
export function parentIsCorrect(folded, key, record) {
  const expected = folded?.setters?.[key] ?? null;
  return { ok: record?.parents?.[0] === expected, expected, actual: record?.parents?.[0] ?? null };
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
  // The parent gate is a COMPARISON, not a probability. 1 or 0.
  const parentOk = opts.parentOk ?? null;
  const parentP = parentOk === null ? null : (parentOk ? 1 : 0);
  const conflicts = [];

  // FAIL CLOSED. A gate that cannot answer must never be read as consent.
  // An earlier draft treated missing answers as "no conflicts" and routed
  // to `act`, which means an unreachable Jev silently authorised every
  // nudge in the system -- the exact failure this repo exists to prevent.
  if (applyP === null || parentP === null) {
    const missing = [];
    if (applyP === null) missing.push("should_apply");
    if (parentP === null) missing.push("parentCheck");
    return {
      action: opts.onMissing ?? "block",
      reason: `no signal from: ${missing.join(", ")}`,
      apply: applyP,
      parent: parentP,
    };
  }

  // The parent gate is EXACT. A comparison against folded.setters[key] has one
  // meaningful answer, so a mismatch is a hard block with no threshold and no
  // model call. This replaces a noul question whose prompt contained its own
  // answer, where the measured "0.61 vs 0.15" was the model misreading a
  // known fact rather than any kind of separation.
  if (parentOk === false) {
    conflicts.push(`parent ${opts.parentActual ?? "?"} is not the setter ${opts.parentExpected ?? "?"}`);
  }
  // The intent gate does NOT block on its own. Measured on a two-record
  // synthetic state: a well-founded nudge scored 0.35 and an unjustified one
  // 0.07. Real separation, wrong scale -- any cutoff admitting the bad case
  // also blocks the good one. It routes to review. Its calibration on real
  // record sets is the open question, and until it is calibrated it does not
  // get blocking authority.


  if (conflicts.length) {
    return { action: "block", reason: `confidently no: ${conflicts.join(", ")}`, apply: applyP, parent: parentP };
  }
  // Weak intent signal on thin state is a review trigger, never a block.
  if (applyP !== null && applyP < t) {
    return { action: "review", reason: `should_apply=${applyP.toFixed(3)} below ${t}`, apply: applyP, parent: parentP };
  }

  // THE EFFECTS HALF.
  //
  // Everything above asks about the ACTION. Nothing above asks about
  // what the action TOUCHES. Two actions can score identically on the
  // intent gate and belong to different worlds: one lands on a cell we
  // are certain of, the other on a cell that is contested and whose
  // winner we are only 37% sure of.
  //
  // `cellConfidence` is the confidence of the weakest cell the action
  // would touch, as produced by gitpp-sheet. It is optional: without it
  // the gate behaves exactly as before, because a gate that cannot see
  // an effect must not invent one.
  //
  // The policy is deliberately counter-intuitive in one place: an
  // action touching a FRAGILE cell needs a HIGHER score, not a lower
  // one. Applying an action to a cell you are unsure about is exactly
  // when you want the action to be well justified.
  if (opts.cellConfidence !== undefined && opts.cellConfidence !== null) {
    const cellConf = opts.cellConfidence;
    const bar = opts.fragileThreshold ?? 0.75;
    if (cellConf < bar) {
      // REVIEW, never block. The cell is uncertain, but that is a
      // statement about the STATE, not a confident no about the
      // action -- and this gate has no blocking authority on thin
      // intent signal either, for the same reason.
      return {
        action: "review",
        reason:
          `the cell this action touches is only ${(cellConf * 100).toFixed(0)}% ` +
          `confident, below ${(bar * 100).toFixed(0)}%; a well-founded action ` +
          `on an uncertain cell needs a stronger justification`,
        apply: applyP,
        parent: parentP,
        cellConfidence: cellConf,
      };
    }
  }

  return {
    action: "act",
    reason: opts.cellConfidence !== undefined && opts.cellConfidence !== null
      ? `all gates confident; the cells it touches are ${(opts.cellConfidence * 100).toFixed(0)}% confident`
      : "all gates confident",
    apply: applyP,
    parent: parentP,
    ...(opts.cellConfidence !== undefined && opts.cellConfidence !== null
        ? { cellConfidence: opts.cellConfidence } : {}),
  };
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
