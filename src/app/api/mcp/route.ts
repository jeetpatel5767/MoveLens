/**
 * MoveLens MCP HTTP endpoint — Streamable HTTP transport (MCP spec 2025-03-26).
 *
 * Users add ONE line to their Claude Desktop config:
 *   "url": "http://16.171.224.235:3000/api/mcp"
 *
 * No cloning, no npm install, no tsx required.
 *
 * Stateless mode: a fresh McpServer + transport is created per request.
 * This is safe for our use case since all state lives in the audit API.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = (process.env.MOVELENS_URL ?? "http://16.171.224.235:3000").replace(/\/$/, "");
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 180_000; // 3 min

// ── Types ─────────────────────────────────────────────────────────────────────

interface JobStatus {
  id: string; status: string; stagesVisited: string[];
  blobId?: string | null; error?: string | null;
}

interface Finding {
  rule_id: string; severity: string; confidence: number;
  module: string; line_start: number;
  description: string; recommendation: string; category: string;
  patch_after?: string | null;
}

interface FullReport {
  package: {
    packageId: string; network: string; mvrName?: string | null;
    moduleCount: number; sourceRepo?: string | null;
    inputType?: string | null; fileCount?: number | null;
  };
  risk_grade: string;
  severity_counts: { critical: number; high: number; medium: number; low: number };
  findings: Finding[];
  layer4_used: boolean;
  memory_context_used: boolean;
  watermark: string;
  blobId?: string | null;
}

// ── Audit helpers ─────────────────────────────────────────────────────────────

async function submitAudit(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/audit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`MoveLens API ${res.status}: ${await res.text()}`);
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
  if (!res.ok) throw new Error(`Report fetch ${res.status}`);
  return res.json() as Promise<FullReport>;
}

function formatReport(report: FullReport, auditId: string): string {
  const { package: pkg, risk_grade, severity_counts, findings } = report;
  const { critical, high, medium, low } = severity_counts;
  const total = critical + high + medium + low;

  const gradeEmoji: Record<string, string> = { A:"🟢", B:"🟡", C:"🟠", D:"🔴", F:"🔴" };
  const sevEmoji:   Record<string, string> = { critical:"🔴", high:"🟠", medium:"🟡", low:"🔵" };

  const header = [
    `## MoveLens Security Report`,
    ``,
    `**Package:** ${pkg.mvrName ?? pkg.packageId}`,
    pkg.inputType === "git"
      ? `**Source:** ${pkg.sourceRepo} (${pkg.fileCount ?? pkg.moduleCount} files, ${pkg.moduleCount} analysed)`
      : `**Network:** ${pkg.network}`,
    `**Risk Grade:** ${gradeEmoji[risk_grade] ?? "⚪"} **${risk_grade}**`,
    `**Findings:** ${total} total (${critical} critical · ${high} high · ${medium} medium · ${low} low)`,
    `**Layers:** Layer 1 (rules) + Layer 2 (OZ)${report.layer4_used ? " + Layer 4 (ML)" : ""}${report.memory_context_used ? " + Layer 3 (LanceDB)" : ""}`,
    report.blobId ? `**Walrus blob:** \`${report.blobId}\`` : "",
    `**Full report:** ${BASE_URL}/audit/${auditId}`,
    ``,
    `> ${report.watermark}`,
  ].filter(Boolean).join("\n");

  if (total === 0) {
    return `${header}\n\n✅ **No issues found.** All ${pkg.moduleCount} modules passed every check.`;
  }

  const findingLines = findings.slice(0, 20).map((f, i) => [
    `### ${i + 1}. ${sevEmoji[f.severity] ?? "⚪"} [${f.severity.toUpperCase()}] ${f.rule_id}`,
    `**Module:** \`${f.module}\` · **Line:** ${f.line_start} · **Confidence:** ${Math.round(f.confidence * 100)}%`,
    `**Issue:** ${f.description}`,
    `**Fix:** ${f.recommendation}`,
    f.patch_after ? `\`\`\`move\n// ✅ Suggested fix:\n${f.patch_after.trim()}\n\`\`\`` : "",
  ].filter(Boolean).join("\n")).join("\n\n");

  const more = findings.length > 20
    ? `\n\n*… and ${findings.length - 20} more findings. [View full report →](${BASE_URL}/audit/${auditId})*`
    : "";

  return `${header}\n\n---\n\n${findingLines}${more}`;
}

async function runAudit(body: Record<string, unknown>): Promise<string> {
  const auditId = await submitAudit(body);
  const job     = await pollUntilDone(auditId);
  if (job.status === "failed") {
    return `❌ Audit failed: ${job.error ?? "unknown error"}\nStages: ${job.stagesVisited.join(" → ")}`;
  }
  const report = await fetchReport(auditId);
  return formatReport(report, auditId);
}

// ── MCP server factory ────────────────────────────────────────────────────────

function buildServer(): McpServer {
  const server = new McpServer({ name: "movelens", version: "1.0.0" });

  server.tool(
    "audit_move_source",
    "Run a 4-layer security audit on pasted Move source code. Returns risk grade, all findings with severity/line/fix, and a permanent Walrus blob ID.",
    {
      source:   z.string().min(1).describe("Move source code to audit (one or more modules)"),
      filename: z.string().optional().describe("Filename hint (default: contract.move)"),
      network:  z.enum(["testnet","mainnet"]).optional().describe("Sui network context (default: testnet)"),
    },
    async ({ source, filename, network }) => {
      const text = await runAudit({
        source: { files: [{ name: filename ?? "contract.move", content: source }] },
        network: network ?? "testnet",
        publishOnChain: false,
      });
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "audit_package_id",
    "Fetch and run a 4-layer security audit on a live Sui Move package by on-chain address. Pulls all modules via Sui GraphQL.",
    {
      packageId: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Must be 0x + 64 hex chars").describe("Sui package address"),
      network:   z.enum(["testnet","mainnet"]).optional().describe("Sui network (default: testnet)"),
    },
    async ({ packageId, network }) => {
      const text = await runAudit({ packageId, network: network ?? "testnet", publishOnChain: false });
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "audit_github_repo",
    "Clone a public GitHub repository, find all .move files (up to 50), and run a unified 4-layer security audit across the whole codebase.",
    {
      repoUrl: z.string().url().describe("Public GitHub repo URL (https://github.com/owner/repo)"),
    },
    async ({ repoUrl }) => {
      if (!repoUrl.startsWith("https://github.com/")) {
        return { content: [{ type: "text", text: "❌ Only public GitHub repos are supported." }] };
      }
      const text = await runAudit({ repoUrl });
      return { content: [{ type: "text", text }] };
    },
  );

  return server;
}

// ── Route handler (stateless — new server+transport per request) ──────────────

async function handle(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: no session tracking
  });
  const server = buildServer();
  await server.connect(transport);
  const response = await transport.handleRequest(req);
  // Don't close transport here — SSE streams stay alive until tool completes
  return response;
}

export const runtime = "nodejs"; // ensures long-running fetch/poll works
export const maxDuration = 300;  // 5-min ceiling on Vercel/serverless; no-op on EC2

export async function GET(req: Request)    { return handle(req); }
export async function POST(req: Request)   { return handle(req); }
export async function DELETE(req: Request) { return handle(req); }
