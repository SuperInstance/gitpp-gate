// Thin client for TypeSafe's Jev (System One).
//
// Jev makes STRUCTURED DECISIONS with calibrated probabilities. It does not
// generate text and it does not reason about what the right value is -- it
// tells you how confident it is in a discrete question you frame. That is
// exactly what a nudge gate needs: the code decides what the action IS, Jev
// says how sure we should be before taking it.
//
// The gate keeps control in code (TypeSafe's own doctrine) and spends the
// model call only on the judgement that code cannot make on its own.

const DEFAULT_BASE = "https://api.typesafe.ai/v1/systemone";

/**
 * Ask Jev one or more questions about `state`.
 * Throws on transport/API failure so the caller can fail CLOSED.
 */
export async function ask(state, questions, opts = {}) {
  const base = opts.base ?? DEFAULT_BASE;
  const key = opts.apiKey ?? process.env.TYPESAFE_AI_TOKEN;
  if (!key) throw new Error("TYPESAFE_AI_TOKEN is not set");

  const res = await fetch(base, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ state, model: opts.model ?? "jev-latest", questions }),
    // NOTE: api.typesafe.ai presents a cert whose SAN list is marked
    // critical, which strict verifiers reject. Node's fetch cannot be told
    // to skip verification, so the CLI shim below uses curl -k. Documented
    // rather than worked around, because a skipped check is a real one.
    dispatcher: opts.dispatcher,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jev ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()).answers;
}
