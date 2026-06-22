// THE GATE — takes Layer 1 suspects, sends each to Groq for confirmation.
// Groq either CONFIRMS (→ real finding, affects score) or DISMISSES (→ transparent but unscored).
// Rate-limited or unavailable → suspects become UNREVIEWED HINTS (shown with disclaimer, no score impact).
//
// HARD RULES:
//   - NEVER throw — all errors caught internally, suspects fall through to unreviewed.
//   - Rate limit: max 40 Groq calls per audit run.
//   - Minimum confirmation confidence: 0.60.
//   - Confirmed findings use source="layer1_confirmed".

import type { Suspect, Finding, DismissedSuspect, UnreviewedHint } from "./schema";
import { FindingSchema } from "./schema";
import { env } from "../env";
import { sanitizeForPatterns } from "./sanitize";

export interface GateResult {
  confirmed:  Finding[];
  dismissed:  DismissedSuspect[];
  unreviewed: UnreviewedHint[];
}

// Per-audit rate limit — max 40 Groq calls (free tier is generous at ~6000 RPD)
const SESSION_GROQ_CALLS = { count: 0, max: 40 };

function canCallGroq(): boolean {
  return !!env.GROQ_API_KEY && SESSION_GROQ_CALLS.count < SESSION_GROQ_CALLS.max;
}

function resetGateCallCount(): void {
  SESSION_GROQ_CALLS.count = 0;
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const GATE_PROMPT_TEMPLATE = `You are a senior Sui Move smart-contract security auditor.
You will be shown a code snippet and a specific security concern flagged by a static analyzer.
Your job: determine if this is a REAL vulnerability or a FALSE POSITIVE.

Sui Move context you must understand:
- "public entry fun" WITHOUT a capability parameter IS suspicious for state-mutating functions, but IS fine for deposit/view/getter functions that are intentionally public.
- "public fun" (without entry) is callable from other modules only — less suspicious than public entry.
- Bit-shifts (<<, >>) on u256 do NOT abort on overflow in Move. Unchecked = REAL BUG.
- Capabilities (AdminCap, OwnerCap, *Cap) passed as parameters = access IS controlled.
- assert!(condition, error_code) IS a guard — its presence means access IS checked.
- ctx.sender() used in an assert! IS an access control check.
- Structs with 'store' ability can be stored — this is often INTENTIONAL and correct.
- Structs with 'copy' ability can be duplicated — this is dangerous for capabilities, but FINE for event structs emitted via event::emit().
- Event structs MUST have 'copy' and 'drop' — that is NOT a vulnerability.
- A function named 'deposit', 'transfer', 'send', 'get_*' being public entry is usually INTENTIONAL.

Respond with ONLY a JSON object. No markdown. No explanation outside JSON.

{
  "confirmed": true or false,
  "confidence": 0.0 to 1.0,
  "reason": "one sentence explaining your decision",
  "severity_adjustment": "none" or "downgrade" or "upgrade"
}

RULE FLAGGED: {rule_id} — {rule_title}
CONCERN: {rule_description}

CODE CONTEXT (including surrounding lines):
{context_lines}

SPECIFIC MATCH:
{matched_text}

Is this a real vulnerability? Reply JSON only:`;

// ── Groq caller ───────────────────────────────────────────────────────────────

interface GroqVerdict {
  confirmed:           boolean;
  confidence:          number;
  reason:              string;
  severity_adjustment: string;
}

async function reviewSuspect(
  suspect: Suspect,
  memoryContext: string,
): Promise<GroqVerdict | null> {
  if (!canCallGroq()) return null;
  SESSION_GROQ_CALLS.count++;

  const prompt = GATE_PROMPT_TEMPLATE
    .replace("{rule_id}",          suspect.rule_id)
    .replace("{rule_title}",       suspect.title)
    .replace("{rule_description}", suspect.description)
    .replace("{context_lines}",    sanitizeForPatterns(suspect.context_lines, false).slice(0, 800))
    .replace("{matched_text}",     suspect.matched_text.slice(0, 200))
    + (memoryContext ? `\n\nRELEVANT PAST PATTERNS:\n${memoryContext}` : "");

  try {
    const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:       "llama-3.3-70b-versatile",
        messages:    [{ role: "user", content: prompt }],
        max_tokens:  200,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!resp.ok) {
      console.warn("[gate] Groq error:", resp.status);
      SESSION_GROQ_CALLS.count--; // refund the call on error
      return null;
    }

    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    const text  = data.choices?.[0]?.message?.content?.trim() ?? "";
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) {
      console.warn("[gate] No JSON in Groq response:", text.slice(0, 100));
      return null;
    }

    // Strip trailing commas before closing braces (common Groq output bug)
    const cleaned = match[0].replace(/,\s*([}\]])/g, "$1");
    const parsed  = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      confirmed:           Boolean(parsed.confirmed),
      confidence:          Number(parsed.confidence ?? 0.5),
      reason:              String(parsed.reason ?? "No reason provided"),
      severity_adjustment: String(parsed.severity_adjustment ?? "none"),
    };
  } catch (err) {
    console.warn("[gate] Groq call failed:", err);
    return null;
  }
}

// ── Severity adjustment ───────────────────────────────────────────────────────

function adjustSeverity(
  original: string,
  adjustment: string,
): "critical" | "high" | "medium" | "low" {
  const order = ["low", "medium", "high", "critical"] as const;
  const idx   = order.indexOf(original as typeof order[number]);
  if (idx === -1) return "medium";
  if (adjustment === "upgrade")   return order[Math.min(idx + 1, 3)];
  if (adjustment === "downgrade") return order[Math.max(idx - 1, 0)];
  return order[idx];
}

// ── Main gate ─────────────────────────────────────────────────────────────────

/**
 * Takes Layer 1 suspects and sends each to Groq for confirmation.
 * Returns confirmed findings, dismissed suspects, and unreviewed hints.
 * NEVER throws — errors always route to unreviewed.
 */
export async function runConfirmationGate(
  suspects:      Suspect[],
  memoryContext: string,
): Promise<GateResult> {
  // Reset call counter for each audit run
  resetGateCallCount();

  const confirmed:  Finding[]           = [];
  const dismissed:  DismissedSuspect[]  = [];
  const unreviewed: UnreviewedHint[]    = [];

  // Process in batches of 4 (parallel) to stay within rate limits
  const BATCH_SIZE = 4;

  for (let i = 0; i < suspects.length; i += BATCH_SIZE) {
    const batch   = suspects.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(s => reviewSuspect(s, memoryContext)));

    for (let j = 0; j < batch.length; j++) {
      const suspect = batch[j];
      const verdict = results[j];

      if (verdict === null) {
        // Groq unavailable or rate-limited → unreviewed hint (never scored)
        unreviewed.push({
          ...suspect,
          hint_reason: "Groq confirmation unavailable — manual review recommended",
        });
        continue;
      }

      if (verdict.confirmed && verdict.confidence >= 0.60) {
        // CONFIRMED: real finding — build a Finding from the suspect
        const adjustedSeverity = adjustSeverity(suspect.severity, verdict.severity_adjustment);

        const raw = {
          rule_id:          suspect.rule_id,
          severity:         adjustedSeverity,
          confidence:       Math.min(1, Math.max(0, verdict.confidence)),
          confidence_reason: `Groq confirmed: "${verdict.reason}"`,
          source:           "layer1_confirmed" as const,
          module:           suspect.location.module,
          line_start:       suspect.location.line_start,
          line_end:         suspect.location.line_end,
          description:      suspect.description,
          recommendation:   suspect.recommendation,
          category:         String(suspect.category),
          impacted_code:    suspect.impacted_code,
          patch_before:     null,
          patch_after:      null,
          groq_reasoning:   verdict.reason,
        };

        const parsed = FindingSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn(`[gate] Confirmed finding failed schema validation for ${suspect.rule_id}:`,
            parsed.error.issues.map(i => i.message).join("; "));
          // Fall through to unreviewed rather than lose this signal entirely
          unreviewed.push({
            ...suspect,
            hint_reason: "Schema validation failed after Groq confirmation",
          });
          continue;
        }

        console.log(`[gate] ✓ CONFIRMED ${suspect.rule_id}@${suspect.location.module}:${suspect.location.line_start} (conf=${verdict.confidence.toFixed(2)})`);
        confirmed.push(parsed.data);
      } else {
        // DISMISSED: Groq said it's a false positive (or confidence too low)
        const reason = verdict.confirmed && verdict.confidence < 0.60
          ? `Confirmed but low confidence (${(verdict.confidence * 100).toFixed(0)}%): ${verdict.reason}`
          : verdict.reason;

        console.log(`[gate] ✗ DISMISSED ${suspect.rule_id}@${suspect.location.module}:${suspect.location.line_start} — ${reason}`);
        dismissed.push({
          rule_id:  suspect.rule_id,
          title:    suspect.title,
          location: suspect.location,
          reason,
        });
      }
    }
  }

  console.log(
    `[gate] Result: ${confirmed.length} confirmed, ${dismissed.length} dismissed, ${unreviewed.length} unreviewed` +
    ` (${SESSION_GROQ_CALLS.count} Groq calls)`
  );

  return { confirmed, dismissed, unreviewed };
}
