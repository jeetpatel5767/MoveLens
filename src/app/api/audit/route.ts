// src/app/api/audit/route.ts
// POST /api/audit  — validate input, create job, kick off pipeline async, return { auditId }
// GET  /api/audit?id=<id> — poll job status
//
// HARD RULES:
//   - NEVER use JSON-RPC. GraphQL only.
//   - NEVER call paid AI APIs.
//   - A failed stage MUST surface a readable error, not an infinite spinner.
//   - runPipeline errors must NEVER crash the server (caught → job.status="failed").

import { NextRequest, NextResponse } from "next/server";
import { buildPackageContextFromUpload, UploadValidationError } from "@/lib/ingest/upload";
import { fetchPackage, InvalidAddressError, PackageNotFoundError } from "@/lib/sui/queries";
import { resolvePackageName } from "@/lib/mvr/resolve";
import { runAudit, assembleReport } from "@/lib/audit/engine";
import { encryptReport } from "@/lib/seal/encrypt";
import { buildQuilt } from "@/lib/walrus/quilt";
import { uploadAuditQuilt } from "@/lib/walrus/upload";
import { createMemory } from "@/lib/memory/index";
import {
  attachAuditToPackage,
  DEMO_PACKAGE_INFO_ID,
  DEMO_PACKAGE_ID,
} from "@/lib/mvr/metadata";
import { env } from "@/lib/env";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import {
  createJob,
  getJob,
  updateJob,
  type AuditJob,
} from "@/lib/store/audits";
import type { PackageContext } from "@/lib/sui/queries";

// ── Address validation ────────────────────────────────────────────────────────

const ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

// ── Signer address (for Seal ownerAddress) ────────────────────────────────────

function getSignerAddress(): string {
  try {
    const raw = Buffer.from(env.SUI_KEYPAIR_B64, "base64").toString("utf8").trim();
    const { scheme, secretKey } = decodeSuiPrivateKey(raw);
    if (scheme !== "ED25519") throw new Error("Expected ED25519");
    return Ed25519Keypair.fromSecretKey(secretKey).getPublicKey().toSuiAddress();
  } catch {
    // fallback: use the known signer address
    return "0x8a271c5a35e7fdac64fd811b57d6e605f81697fd12b8a1867300abf867429d57";
  }
}

// ── Human-readable error extraction ───────────────────────────────────────────

function humanReadable(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ── Build PackageContext from input ───────────────────────────────────────────

interface AuditInput {
  mode: "packageId" | "source";
  packageId?: string;
  network?: "testnet" | "mainnet";
  files?: { name: string; content: string }[];
}

async function buildPackageContext(input: AuditInput): Promise<PackageContext> {
  if (input.mode === "packageId" && input.packageId) {
    const network = input.network ?? "testnet";
    const ctx = await fetchPackage(input.packageId, network);
    // Attempt MVR name resolution (best-effort; never throws)
    const mvr = await resolvePackageName(input.packageId);
    return { ...ctx, mvrName: mvr.name, sourceRepo: mvr.sourceRepo };
  }

  if (input.mode === "source" && input.files) {
    return buildPackageContextFromUpload(input.files, input.network ?? "testnet");
  }

  throw new Error("Invalid audit input: must provide packageId or source.files");
}

// ── MVR linking (demo package only) ───────────────────────────────────────────

/**
 * If the audited package IS our demo package, attach the blob ID to its PackageInfo.
 * Any other package → skip silently (we only own the demo package's PackageInfo).
 * Errors are logged and swallowed — linking is best-effort.
 */
async function tryAttachToMvr(
  packageId: string,
  blobId: string,
): Promise<string | null> {
  try {
    if (packageId.toLowerCase() !== DEMO_PACKAGE_ID.toLowerCase()) {
      // Not the demo package — can't set_metadata (we don't own its PackageInfo)
      return null;
    }
    const digest = await attachAuditToPackage(DEMO_PACKAGE_INFO_ID, blobId);
    return digest;
  } catch (err) {
    console.warn("[pipeline] MVR linking skipped:", humanReadable(err));
    return null;
  }
}

// ── Full audit pipeline ───────────────────────────────────────────────────────

/**
 * Run the full 5-stage audit pipeline for a job.
 * Each stage updates job.status before starting.
 * Any unhandled error → job.status="failed", job.error=<message>.
 * This function NEVER throws — all errors are caught and stored in the job.
 */
async function runPipeline(job: AuditJob, input: AuditInput): Promise<void> {
  try {
    // ── Stage 1: fetch / parse ───────────────────────────────────────────────
    updateJob(job, { status: "fetching" });
    const ctx = await buildPackageContext(input);

    // ── Stage 2: audit ───────────────────────────────────────────────────────
    updateJob(job, { status: "auditing" });
    const memory = await createMemory();
    const engineResult = await runAudit(ctx, memory);
    // memoryContextUsed = true when Layer 3 recall returned corpus hits
    const memoryContextUsed = engineResult.layersRun.includes("layer3");
    const report = assembleReport(ctx, engineResult, {
      memoryContextUsed,
      layer3Hits: engineResult.layer3Hits,
    });

    // ── Stage 3: encrypt ─────────────────────────────────────────────────────
    updateJob(job, { status: "encrypting" });
    const ownerAddress = getSignerAddress();
    const sealed = await encryptReport(report, ownerAddress);

    // ── Stage 4: upload to Walrus ─────────────────────────────────────────────
    updateJob(job, { status: "uploading" });
    const quilt = buildQuilt(report, sealed.encryptedBytes, sealed.sealed);
    const { blobId } = await uploadAuditQuilt(quilt);

    // ── Stage 5: MVR linking (best-effort, demo package only) ─────────────────
    updateJob(job, { status: "linking", blobId });
    const txDigest = await tryAttachToMvr(ctx.packageId, blobId);

    // ── Done ───────────────────────────────────────────────────────────────────
    updateJob(job, {
      status:    "done",
      report,
      blobId,
      txDigest,
    });

    console.log(
      `[pipeline] job ${job.id} done — blobId=${blobId} txDigest=${txDigest ?? "null"}`,
    );
  } catch (err) {
    const msg = humanReadable(err);
    console.error(`[pipeline] job ${job.id} failed at stage "${job.status}":`, msg);
    updateJob(job, { status: "failed", error: msg });
  }
}

// ── POST /api/audit ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;

  // ── Source upload path ───────────────────────────────────────────────────────
  if (input.source) {
    const src = input.source as { files?: { name: string; content: string }[] };

    // Validate before creating a job (fail-fast with 400)
    try {
      buildPackageContextFromUpload(src.files ?? []);
    } catch (e) {
      if (e instanceof UploadValidationError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }

    const auditInput: AuditInput = {
      mode:    "source",
      files:   src.files,
      network: (input.network as "testnet" | "mainnet") ?? "testnet",
    };

    const job = createJob();
    void runPipeline(job, auditInput);
    return NextResponse.json({ auditId: job.id }, { status: 202 });
  }

  // ── Package ID path ──────────────────────────────────────────────────────────
  if (input.packageId) {
    const packageId = String(input.packageId);

    if (!ADDRESS_RE.test(packageId)) {
      return NextResponse.json(
        { error: `Invalid package address: "${packageId}" must be 0x + 64 hex chars` },
        { status: 400 },
      );
    }

    const network = (input.network as "testnet" | "mainnet") ?? "testnet";
    const auditInput: AuditInput = { mode: "packageId", packageId, network };

    const job = createJob();
    void runPipeline(job, auditInput);
    return NextResponse.json({ auditId: job.id }, { status: 202 });
  }

  return NextResponse.json(
    { error: "Provide either 'packageId' or 'source.files'" },
    { status: 400 },
  );
}

// ── GET /api/audit?id=<id> ────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json(
      { error: "Missing ?id= query parameter" },
      { status: 400 },
    );
  }

  const job = getJob(id);
  if (!job) {
    return NextResponse.json(
      { error: `Audit job "${id}" not found` },
      { status: 404 },
    );
  }

  // Return a slim status object — the full report is at GET /api/report/[id]
  // stagesVisited records every stage the job has passed through, so polling
  // clients that start after fast early stages (fetching/auditing) have already
  // completed can still verify those stages ran.
  return NextResponse.json({
    id:            job.id,
    status:        job.status,
    stagesVisited: job.stagesVisited,
    blobId:        job.blobId   ?? null,
    txDigest:      job.txDigest ?? null,
    error:         job.error    ?? null,
    updatedAt:     job.updatedAt,
  });
}
