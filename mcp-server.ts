#!/usr/bin/env node
/**
 * MoveLens MCP Server
 *
 * Exposes three tools to Claude Desktop / Claude Code:
 *   audit_move_source  — paste raw Move source code
 *   audit_package_id   — audit a live Sui package by address
 *   audit_github_repo  — clone a public GitHub repo and audit all .move files
 *
 * Setup: see movelens-mcp.json
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = (process.env.MOVELENS_URL ?? "https://movelens.onrender.com").replace(/\/$/, "");
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 180_000; // 3 min — git clones can be slow

// ── Helpers ───────────────────────────────────────────────────────────────────

interface JobStatus {
  id: string;
  status: string;
  stagesVisited: string[];
  blobId?: string | null;
  error?: string | null;
}

interface ReportPackage {
  packageId: string;
  network: string;
  mvrName?: string | null;
  moduleCount: number;
  sourceRepo?: string | null;
  inputType?: string | null;
  fileCount?: number | null;
}

interface Finding {
  rule_id: string;
  severity: string;
  confidence: number;
  module: string;
  line_start: number;
  description: string;
  recommendation: string;
  category: string;
  patch_after?: string | null;
}

interface FullReport {
  package: ReportPackage;
  risk_grade: string;
  severity_counts: { critical: number; high: number; medium: number; low: number };
  findings: Finding[];
  layer4_used: boolean;
  memory_context_used: boolean;
  watermark: string;
  blobId?: string | null;
}

async function submitAudit(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MoveLens API error ${res.status}: ${text}`);
  }
  const data = await res.json() as { auditId?: string; error?: string };
  if (!data.auditId) throw new Error(data.error ?? "No auditId returned");
  return data.auditId;
}

async function pollUntilDone(auditId: string): Promise<JobStatus> {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE_URL}/api/audit?id=${auditId}`);
    if (!res.ok) throw new Error(`Poll error ${res.status}`);
    const job = await res.json() as JobStatus;
    if (job.status === "done" || job.status === "failed") return job;
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Audit timed out after 3 minutes");
}

async function fetchReport(auditId: string): Promise<FullReport> {
  const res = await fetch(`${BASE_URL}/api/report/${auditId}`);
  if (!res.ok) throw new Error(`Report fetch error ${res.status}`);
  return res.json() as Promise<FullReport>;
}

function formatReport(report: FullReport, auditId: string): string {
  const { package: pkg, risk_grade, severity_counts, findings } = report;
  const { critical, high, medium, low } = severity_counts;
  const total = critical + high + medium + low;

  const gradeEmoji: Record<string, string> = { A: "🟢", B: "🟡", C: "🟠", D: "🔴", F: "🔴" };
  const sevEmoji: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };

  const header = [
    `## MoveLens Security Report`,
    ``,
    `**Package:** ${pkg.mvrName ?? pkg.packageId}`,
    pkg.inputType === "git" ? `**Source:** ${pkg.sourceRepo} (${pkg.fileCount ?? pkg.moduleCount} files, ${pkg.moduleCount} analysed)` : `**Network:** ${pkg.network}`,
    `**Risk Grade:** ${gradeEmoji[risk_grade] ?? "⚪"} **${risk_grade}**`,
    `**Findings:** ${total} total (${critical} critical · ${high} high · ${medium} medium · ${low} low)`,
    `**Layers run:** Layer 1 (rules) + Layer 2 (OZ) ${report.layer4_used ? "+ Layer 4 (ML)" : ""} ${report.memory_context_used ? "+ Layer 3 (LanceDB)" : ""}`,
    report.blobId ? `**Walrus blob:** \`${report.blobId}\`` : "",
    `**Audit ID:** \`${auditId}\``,
    ``,
    `> ${report.watermark}`,
  ].filter(l => l !== undefined).join("\n");

  if (total === 0) {
    return `${header}\n\n✅ **No issues found.** This contract passed all ${pkg.moduleCount} module checks.`;
  }

  const findingLines = findings
    .slice(0, 20)
    .map((f, i) => [
      `### ${i + 1}. ${sevEmoji[f.severity] ?? "⚪"} [${f.severity.toUpperCase()}] ${f.rule_id}`,
      `**Module:** \`${f.module}\` · **Line:** ${f.line_start} · **Confidence:** ${Math.round(f.confidence * 100)}%`,
      `**Issue:** ${f.description}`,
      `**Fix:** ${f.recommendation}`,
      f.patch_after ? `\`\`\`move\n// ✅ Suggested fix:\n${f.patch_after.trim()}\n\`\`\`` : "",
    ].filter(Boolean).join("\n"))
    .join("\n\n");

  const truncNote = findings.length > 20
    ? `\n\n*… and ${findings.length - 20} more findings. Open the full report at ${BASE_URL}/audit/${auditId}*`
    : "";

  return `${header}\n\n---\n\n${findingLines}${truncNote}`;
}

async function runAudit(body: Record<string, unknown>): Promise<string> {
  const auditId = await submitAudit(body);
  const job = await pollUntilDone(auditId);

  if (job.status === "failed") {
    return `❌ Audit failed: ${job.error ?? "unknown error"}\n\nStages reached: ${job.stagesVisited.join(" → ")}`;
  }

  const report = await fetchReport(auditId);
  return formatReport(report, auditId);
}

// ── MCP Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "movelens",
  version: "1.0.0",
});

// Tool 1 — Paste Move source
server.tool(
  "audit_move_source",
  "Run a 4-layer security audit on pasted Move source code. Returns risk grade, all findings with severity and recommended fixes, and a permanent Walrus blob ID.",
  {
    source: z.string().min(1).describe("The Move source code to audit (one or more modules)"),
    filename: z.string().optional().describe("Optional filename (default: contract.move)"),
    network: z.enum(["testnet", "mainnet"]).optional().describe("Sui network context (default: testnet)"),
  },
  async ({ source, filename, network }) => {
    const text = await runAudit({
      source: {
        files: [{ name: filename ?? "contract.move", content: source }],
      },
      network: network ?? "testnet",
      publishOnChain: false,
    });
    return { content: [{ type: "text", text }] };
  },
);

// Tool 2 — Package ID
server.tool(
  "audit_package_id",
  "Run a 4-layer security audit on a live Sui Move package by its on-chain address. Fetches all modules via Sui GraphQL, then runs the full audit pipeline.",
  {
    packageId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Must be 0x + 64 hex chars").describe("Sui package address (0x + 64 hex chars)"),
    network: z.enum(["testnet", "mainnet"]).optional().describe("Sui network (default: testnet)"),
  },
  async ({ packageId, network }) => {
    const text = await runAudit({
      packageId,
      network: network ?? "testnet",
      publishOnChain: false,
    });
    return { content: [{ type: "text", text }] };
  },
);

// Tool 3 — GitHub repo
server.tool(
  "audit_github_repo",
  "Clone a public GitHub repository, find all .move files (up to 50), and run a unified 4-layer security audit across the whole codebase. Returns per-module findings with a summary.",
  {
    repoUrl: z.string().url().describe("Public GitHub repo URL (https://github.com/owner/repo)"),
  },
  async ({ repoUrl }) => {
    if (!repoUrl.startsWith("https://github.com/")) {
      return { content: [{ type: "text", text: "❌ Only public GitHub repos are supported (https://github.com/...)" }] };
    }
    const text = await runAudit({ repoUrl });
    return { content: [{ type: "text", text }] };
  },
);

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MoveLens MCP server error:", err);
  process.exit(1);
});
