// src/lib/mvr/metadata.ts
// MVR PackageInfo metadata: attach and read Walrus blob IDs on-chain.
//
// HARD RULES:
//   - NEVER use Sui JSON-RPC. SuiGraphQLClient + Transaction only.
//   - Sign with the keypair from env — never a hardcoded key.
//   - The metadata key "movelens_audit" maps to a Walrus blob ID.
//
// On-chain layout (testnet):
//   package_info contract: 0xb96f44d08ae214887cae08d8ae061bbf6f0908b1bfccb710eea277f45150b9f4
//     module: package_info
//     struct:  PackageInfo  { metadata: VecMap<String,String>, ... }
//     fun:     set_metadata(&mut PackageInfo, String key, String value)
//
// Demo deployment (this session):
//   Demo package:   0x6bcb6936da7f7df80741e0abb7aa5fb78d160a7be227f48b0a6f0c9c83648698
//   PackageInfo:    0xcc7af44f578839df65cd69705c640559aa594b6528161653b91416cdec7a50e2
//   UpgradeCap:     0x675b9ea40fe5ec9510faf1434e157685e047e32a527fc318e15f726e7761d365
//   Owner address:  0x8a271c5a35e7fdac64fd811b57d6e605f81697fd12b8a1867300abf867429d57

import { Transaction } from "@mysten/sui/transactions";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { env } from "../env";

// ── Contract constants ────────────────────────────────────────────────────────

/**
 * Testnet package_info contract (MVR metadata, v1).
 * Source: https://github.com/MystenLabs/mvr packages/package_info Move.lock
 * chain-id 4c78adac (testnet) → 0xb96f44d0...b9f4
 */
export const PACKAGE_INFO_CONTRACT =
  "0xb96f44d08ae214887cae08d8ae061bbf6f0908b1bfccb710eea277f45150b9f4";

/** Metadata key used by MoveLens when attaching an audit report. */
export const MOVELENS_AUDIT_KEY = "movelens_audit";

// ── Demo deployment constants ─────────────────────────────────────────────────
// These were created in Session 14. The test suite uses these IDs.

/** Demo Move package published by MoveLens on testnet. */
export const DEMO_PACKAGE_ID =
  "0x6bcb6936da7f7df80741e0abb7aa5fb78d160a7be227f48b0a6f0c9c83648698";

/** PackageInfo object for the demo package (owned by our keypair). */
export const DEMO_PACKAGE_INFO_ID =
  "0xcc7af44f578839df65cd69705c640559aa594b6528161653b91416cdec7a50e2";

/** UpgradeCap of the demo package (linked to DEMO_PACKAGE_INFO_ID). */
export const DEMO_UPGRADE_CAP_ID =
  "0x675b9ea40fe5ec9510faf1434e157685e047e32a527fc318e15f726e7761d365";

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadKeypair(): Ed25519Keypair {
  const raw = Buffer.from(env.SUI_KEYPAIR_B64, "base64").toString("utf8").trim();
  const { scheme, secretKey } = decodeSuiPrivateKey(raw);
  if (scheme !== "ED25519") throw new Error(`Expected ED25519 key, got ${scheme}`);
  return Ed25519Keypair.fromSecretKey(secretKey);
}

function createSuiClient(): SuiGraphQLClient {
  return new SuiGraphQLClient({ url: env.SUI_GRAPHQL_URL, network: env.SUI_NETWORK });
}

// ── attachAuditToPackage ──────────────────────────────────────────────────────

/**
 * Attach a Walrus blob ID to a PackageInfo object on-chain.
 *
 * Calls `package_info::set_metadata(&mut PackageInfo, "movelens_audit", blobId)`.
 * Only the owner of the PackageInfo can call this.
 *
 * @param packageInfoId  Object ID of the PackageInfo (must be owned by our keypair).
 * @param blobId         Walrus blob ID string to attach as the audit report.
 * @returns              Transaction digest of the set_metadata call.
 */
export async function attachAuditToPackage(
  packageInfoId: string,
  blobId: string,
): Promise<string> {
  const signer = loadKeypair();
  const client = createSuiClient();

  // Check if the key already exists — vec_map::insert aborts on duplicate keys.
  // If it does exist, we must unset it first in the same TX.
  const existing = await readAuditMetadata(packageInfoId, { maxRetries: 0 });

  const tx = new Transaction();
  tx.setSender(signer.getPublicKey().toSuiAddress());

  if (existing !== null) {
    // Remove the existing entry first so insert won't abort.
    tx.moveCall({
      target: `${PACKAGE_INFO_CONTRACT}::package_info::unset_metadata`,
      arguments: [
        tx.object(packageInfoId),
        tx.pure.string(MOVELENS_AUDIT_KEY),
      ],
    });
  }

  tx.moveCall({
    target: `${PACKAGE_INFO_CONTRACT}::package_info::set_metadata`,
    arguments: [
      tx.object(packageInfoId),
      tx.pure.string(MOVELENS_AUDIT_KEY),
      tx.pure.string(blobId),
    ],
  });

  const result = await signer.signAndExecuteTransaction({
    transaction: tx,
    client,
  });

  // SuiGraphQLClient returns { $kind: "Transaction", Transaction: { digest, status } }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = result as any;
  const digest: string | undefined =
    r?.digest ??
    r?.Transaction?.digest ??
    r?.["Transaction"]?.digest;

  if (!digest) {
    throw new Error(
      `attachAuditToPackage: unexpected TX result shape: ${JSON.stringify(result).slice(0, 200)}`,
    );
  }

  const status =
    r?.Transaction?.status?.success ??
    r?.status?.success ??
    true;

  if (status === false) {
    const err =
      r?.Transaction?.status?.error ?? r?.status?.error ?? "unknown error";
    throw new Error(`attachAuditToPackage TX failed: ${err}`);
  }

  console.log(
    `[metadata] set_metadata("${MOVELENS_AUDIT_KEY}", "${blobId.slice(0, 20)}…") → ${digest}`,
  );
  return digest;
}

// ── readAuditMetadata ─────────────────────────────────────────────────────────

/**
 * Read the "movelens_audit" metadata value from a PackageInfo object.
 *
 * Queries the PackageInfo's `metadata` VecMap via GraphQL and returns the
 * value associated with the "movelens_audit" key.
 *
 * @param packageInfoId  Object ID of the PackageInfo to query.
 * @returns              The attached blob ID, or null if not set.
 */
export async function readAuditMetadata(
  packageInfoId: string,
  { maxRetries = 6, retryDelayMs = 3000 }: { maxRetries?: number; retryDelayMs?: number } = {},
): Promise<string | null> {
  // Direct GraphQL object query — no JSON-RPC.
  // Retries with backoff because the GraphQL indexer can lag a few seconds after a TX.
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      console.log(`[metadata] readAuditMetadata retry ${attempt}/${maxRetries}…`);
    }

    const response = await fetch(env.SUI_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{
          object(address: "${packageInfoId}") {
            asMoveObject {
              contents {
                json
              }
            }
          }
        }`,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`readAuditMetadata: GraphQL HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      data?: {
        object?: {
          asMoveObject?: {
            contents?: {
              json?: {
                metadata?: {
                  contents?: Array<{ key: string; value: string }>;
                };
              };
            };
          };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors?.length) {
      throw new Error(`readAuditMetadata: GraphQL error: ${data.errors[0].message}`);
    }

    const contents =
      data?.data?.object?.asMoveObject?.contents?.json?.metadata?.contents;

    if (contents) {
      const entry = contents.find((e) => e.key === MOVELENS_AUDIT_KEY);
      if (entry?.value) return entry.value;
    }
  }

  return null;
}
