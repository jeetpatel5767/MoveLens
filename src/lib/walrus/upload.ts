// src/lib/walrus/upload.ts
// Walrus quilt upload and fetch for audit reports.
//
// HARD RULES:
//   - NEVER call any paid LLM API. No AI-provider keys here.
//   - NEVER use Sui JSON-RPC. SuiGraphQLClient only.
//   - If SUI_KEYPAIR_B64 is the placeholder, throw WalrusUploadError immediately.
//   - Retry writeQuilt once on transient failure before throwing.

import { WalrusClient } from "@mysten/walrus";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { env } from "../env";
import type { QuiltEntry } from "./quilt";

// ──────────────────────────────────────────────────────────────
// Error class
// ──────────────────────────────────────────────────────────────

/**
 * Thrown by uploadAuditQuilt / fetchAuditBlob when the operation fails.
 * Wraps the underlying cause so the pipeline can surface a human-readable message.
 */
export class WalrusUploadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WalrusUploadError";
  }
}

// ──────────────────────────────────────────────────────────────
// Return types
// ──────────────────────────────────────────────────────────────

export interface WalrusUploadResult {
  /** The Walrus blob id (base64url, 32 bytes encoded). */
  blobId: string;
  /** Maps quilt entry identifier → its patchId within the quilt. */
  quiltPatchIds: Record<string, string>;
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/**
 * The first few bytes of the placeholder keypair value from .env.example.
 * Used to detect the placeholder before attempting any network call.
 */
const PLACEHOLDER_PREFIX = "testkeypairbase64";

/**
 * Load an Ed25519Keypair from SUI_KEYPAIR_B64.
 *
 * Accepts two formats:
 *   1. Bech32 private key starting with "suiprivkey" (from `sui keytool export`)
 *   2. Raw base64-encoded 32-byte private key
 *
 * Throws WalrusUploadError if the value is the placeholder.
 */
function loadKeypair(): Ed25519Keypair {
  const raw = env.SUI_KEYPAIR_B64;
  const decoded = Buffer.from(raw, "base64");
  const asText = decoded.toString("utf8");

  // Detect the placeholder value from .env.example
  if (asText.startsWith(PLACEHOLDER_PREFIX)) {
    throw new WalrusUploadError(
      "SUI_KEYPAIR_B64 is the placeholder value. " +
        "Set a real funded testnet Ed25519 keypair to enable Walrus uploads. " +
        "(Export with: sui keytool export --key-identity <alias> --json)",
    );
  }

  // Format 1: Bech32 "suiprivkey..." — from `sui keytool export`
  if (asText.trim().startsWith("suiprivkey")) {
    const { scheme, secretKey } = decodeSuiPrivateKey(asText.trim());
    if (scheme !== "ED25519") {
      throw new WalrusUploadError(
        `SUI_KEYPAIR_B64 decoded to ${scheme} key; only ED25519 is supported.`,
      );
    }
    return Ed25519Keypair.fromSecretKey(secretKey);
  }

  // Format 2: Raw base64 private key (32 bytes)
  if (decoded.length >= 32) {
    return Ed25519Keypair.fromSecretKey(decoded.slice(0, 32));
  }

  throw new WalrusUploadError(
    `SUI_KEYPAIR_B64 decoded to ${decoded.length} bytes; expected >= 32.`,
  );
}

/**
 * Maximum number of object IDs per multiGetObjects GraphQL query.
 *
 * The Sui testnet GraphQL server enforces a 5000-byte HTTP body limit.
 * The @mysten/sui SDK chunks `getObjects` calls at 50 IDs, but the Walrus
 * testnet has 101 committee members, so the first batch of 50 generates a
 * ~5398-byte query body which exceeds the server limit.
 *
 * Reducing the batch size to 30 keeps each query to ~3850 bytes — safely
 * under the 5000-byte limit.
 *
 * This shim overrides `core.getObjects` to use smaller 30-item batches.
 * No JSON-RPC is used — the underlying transport remains GraphQL.
 */
const MAX_OBJECTS_PER_BATCH = 30;

function patchSuiClientForWalrus(suiClient: SuiGraphQLClient): SuiGraphQLClient {
  const originalGetObjects = suiClient.core.getObjects.bind(suiClient.core);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (suiClient.core as any).getObjects = async (options: Parameters<typeof originalGetObjects>[0]) => {
    const { objectIds, ...rest } = options;
    if (!objectIds || objectIds.length <= MAX_OBJECTS_PER_BATCH) {
      return originalGetObjects(options);
    }
    // Split into smaller batches and merge results
    const allObjects: Awaited<ReturnType<typeof originalGetObjects>>["objects"] = [];
    for (let i = 0; i < objectIds.length; i += MAX_OBJECTS_PER_BATCH) {
      const batch = objectIds.slice(i, i + MAX_OBJECTS_PER_BATCH);
      const result = await originalGetObjects({ ...rest, objectIds: batch });
      allObjects.push(...result.objects);
    }
    return { objects: allObjects };
  };
  return suiClient;
}

/**
 * Build a fresh WalrusClient backed by the testnet GraphQL endpoint.
 * GraphQL only — no JSON-RPC.
 *
 * Applies patchSuiClientForWalrus to keep multiGetObjects queries under
 * the 5000-byte Sui testnet GraphQL body limit.
 */
function createWalrusClient(): WalrusClient {
  const suiClient = patchSuiClientForWalrus(
    new SuiGraphQLClient({
      url: env.SUI_GRAPHQL_URL,
      network: env.SUI_NETWORK,
    }),
  );
  return new WalrusClient({ network: "testnet", suiClient });
}

// ──────────────────────────────────────────────────────────────
// uploadAuditQuilt (F14)
// ──────────────────────────────────────────────────────────────

/**
 * Upload three QuiltEntry values to Walrus testnet as a quilt blob.
 *
 * Entries should be produced by buildQuilt() in quilt.ts:
 *   [ report.json, findings.enc, summary.md ]
 *
 * Retries once on transient failure before throwing WalrusUploadError.
 *
 * @throws {WalrusUploadError} if SUI_KEYPAIR_B64 is the placeholder, or if
 *   both upload attempts fail.
 */
export async function uploadAuditQuilt(
  entries: QuiltEntry[],
): Promise<WalrusUploadResult> {
  const signer = loadKeypair(); // throws WalrusUploadError for placeholder
  const client = createWalrusClient();

  const MAX_ATTEMPTS = 4;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const result = await client.writeQuilt({
        blobs: entries,
        signer,
        epochs: 5,
        deletable: false,
      });

      // Build identifier → patchId lookup from the quilt index
      const quiltPatchIds: Record<string, string> = {};
      for (const patch of result.index.patches) {
        quiltPatchIds[patch.identifier] = patch.patchId;
      }

      console.log(
        `[upload] Walrus quilt uploaded. blobId=${result.blobId}  patches=${result.index.patches.length}`,
      );

      return { blobId: result.blobId, quiltPatchIds };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < MAX_ATTEMPTS - 1) {
        // Exponential backoff: 5s, 10s, 20s between retries.
        // Walrus testnet has ~30% unreachable nodes; brief pauses let the SDK
        // pick different nodes on retry.
        const delayMs = 5_000 * Math.pow(2, attempt);
        console.warn(
          `[upload] Walrus upload attempt ${attempt + 1} failed, retrying in ${delayMs / 1000}s… (${lastError.message})`,
        );
        await new Promise<void>((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw new WalrusUploadError(
    `Walrus upload failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message ?? "unknown error"}`,
    { cause: lastError },
  );
}

// ──────────────────────────────────────────────────────────────
// fetchAuditBlob (F14)
// ──────────────────────────────────────────────────────────────

/**
 * Fetch quilt entries back from Walrus by blob id.
 *
 * Returns a Map from identifier (e.g. "report.json") to raw bytes.
 * Fetches report.json, findings.enc, and summary.md.
 *
 * @param blobId       The blob id returned by uploadAuditQuilt.
 * @param _quiltPatchIds  Not used for lookup; passed for API symmetry and
 *   future per-patch fetching optimisations.
 *
 * @throws {WalrusUploadError} if the blob is not found or any entry is missing.
 */
export async function fetchAuditBlob(
  blobId: string,
  _quiltPatchIds: Record<string, string>,
): Promise<Map<string, Uint8Array>> {
  const client = createWalrusClient();

  let walrusBlob;
  try {
    walrusBlob = await client.getBlob({ blobId });
  } catch (e) {
    throw new WalrusUploadError(
      `getBlob(${blobId}) failed: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }

  const TARGET_IDS = ["report.json", "findings.enc", "summary.md"];

  let files;
  try {
    files = await walrusBlob.files({ identifiers: TARGET_IDS });
  } catch (e) {
    throw new WalrusUploadError(
      `blob.files() failed for blobId=${blobId}: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }

  const result = new Map<string, Uint8Array>();

  for (const file of files) {
    const identifier = await file.getIdentifier();
    if (!identifier) continue;

    const bytes = await file.bytes();
    result.set(identifier, bytes);
  }

  // Verify all three entries are present
  for (const id of TARGET_IDS) {
    if (!result.has(id)) {
      throw new WalrusUploadError(
        `Fetched quilt is missing entry "${id}" from blobId=${blobId}`,
      );
    }
  }

  console.log(
    `[upload] Fetched ${result.size} entries from blobId=${blobId}: ` +
      [...result.entries()].map(([k, v]) => `${k}(${v.length}B)`).join(", "),
  );

  return result;
}
