// src/lib/walrus/quilt.ts
// Quilt bundler — packages three entries for a Walrus quilt blob upload.
//
// HARD RULES:
//   - report.json MUST NOT contain decrypted findings. Public metadata only.
//   - The watermark string MUST appear verbatim in both report.json and summary.md.
//   - NEVER call any paid LLM API. No AI-provider keys belong in this file.
//   - NEVER use Sui JSON-RPC. (Not needed in this file — no network calls.)

import { createHash } from "crypto";
import type { AuditReport } from "../audit/schema";
import { WATERMARK } from "../audit/schema";

// ──────────────────────────────────────────────────────────────
// QuiltEntry — matches WriteQuiltOptions.blobs[] in @mysten/walrus
// ──────────────────────────────────────────────────────────────

export interface QuiltEntry {
  /** Identifier used to retrieve this entry from the quilt blob. */
  identifier: string;
  /** Raw byte contents. */
  contents: Uint8Array;
  /** Optional key-value tags stored alongside the entry. */
  tags?: Record<string, string>;
}

// ──────────────────────────────────────────────────────────────
// Public metadata type (safe to expose — no findings)
// ──────────────────────────────────────────────────────────────

export interface QuiltPublicMeta {
  report_id:        string;
  /** SHA-256 hex hash of the package address — raw address never stored publicly. */
  package_ref:      string;
  mvr_name:         string | null;
  network:          string;
  version:          number;
  generated_at:     string;
  risk_grade:       string;
  severity_counts: {
    critical: number;
    high:     number;
    medium:   number;
    low:      number;
  };
  /** Whether Seal IBE encryption was applied to the findings. */
  sealed:           boolean;
  /** Verbatim watermark — required on every public record. */
  watermark:        typeof WATERMARK;
}

function hashPackageId(id: string): string {
  return createHash("sha256").update(id.toLowerCase()).digest("hex");
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Render a human-readable Markdown summary for the quilt's `summary.md` entry.
 * Public-facing — contains severity counts and risk grade, no individual findings.
 */
function renderSummaryMd(meta: QuiltPublicMeta): string {
  const { package_ref, mvr_name, generated_at, risk_grade, severity_counts, sealed, watermark } =
    meta;

  const pkgLine = mvr_name
    ? `**Package:** ${mvr_name} (ref: \`${package_ref.slice(0, 16)}…\`)`
    : `**Package:** [private — audit available to owner only]`;

  const sealLine = sealed
    ? "**Encrypted:** Yes — findings are Seal-encrypted. Owner decrypts privately."
    : "**Encrypted:** No — findings stored as plaintext (fallback mode).";

  return [
    "# MoveLens Security Audit Report",
    "",
    pkgLine,
    `**Generated:** ${generated_at}`,
    `**Risk Grade:** ${risk_grade}`,
    sealLine,
    "",
    "## Severity Summary",
    "",
    `| Severity | Count |`,
    `|----------|-------|`,
    `| Critical | ${severity_counts.critical} |`,
    `| High     | ${severity_counts.high}     |`,
    `| Medium   | ${severity_counts.medium}   |`,
    `| Low      | ${severity_counts.low}      |`,
    "",
    `> ${watermark}`,
    "",
  ].join("\n");
}

// ──────────────────────────────────────────────────────────────
// buildQuilt (F13)
// ──────────────────────────────────────────────────────────────

/**
 * Build three QuiltEntry values for a Walrus quilt blob:
 *
 *   report.json  — PUBLIC metadata: package id, severity counts, risk grade,
 *                  watermark, sealed flag.  NO decrypted findings ever appear here.
 *
 *   findings.enc — The (Seal-encrypted, or plaintext-fallback) full report bytes
 *                  produced by encryptReport().
 *
 *   summary.md   — Human-readable Markdown summary derived from public metadata.
 *
 * @param report        The assembled AuditReport (findings included — used for counts only).
 * @param encryptedBytes The encryptedBytes from encryptReport() (may be plaintext if sealed=false).
 * @param sealed        Whether real Seal IBE encryption was applied.
 */
export function buildQuilt(
  report: AuditReport,
  encryptedBytes: Uint8Array,
  sealed: boolean,
): QuiltEntry[] {
  const publicMeta: QuiltPublicMeta = {
    report_id:       report.report_id,
    package_ref:     hashPackageId(report.package.packageId),
    // mvr_name is only included when the user explicitly opted into on-chain publishing.
    // Default (publishOnChain=false) omits it to avoid leaking package identity.
    mvr_name:        report.publishOnChain ? report.package.mvrName : null,
    network:         report.package.network,
    version:         report.package.version,
    generated_at:    report.generated_at,
    risk_grade:      report.risk_grade,
    severity_counts: report.severity_counts,
    sealed,
    watermark:       WATERMARK,
  };

  return [
    {
      identifier: "report.json",
      contents:   utf8(JSON.stringify(publicMeta, null, 2)),
      tags:       { "content-type": "application/json" },
    },
    {
      identifier: "findings.enc",
      contents:   encryptedBytes,
      tags:       { "content-type": sealed ? "application/octet-stream" : "application/json" },
    },
    {
      identifier: "summary.md",
      contents:   utf8(renderSummaryMd(publicMeta)),
      tags:       { "content-type": "text/markdown" },
    },
  ];
}
