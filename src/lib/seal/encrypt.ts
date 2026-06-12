// src/lib/seal/encrypt.ts
// Seal threshold encryption wrapper for AuditReport payloads.
//
// HARD RULES:
//   - NEVER call any paid LLM API. This file does not call Claude/OpenAI.
//   - NEVER use Sui JSON-RPC. SuiGraphQLClient only.
//   - The fallback must NEVER hard-crash the pipeline. Any Seal error → sealed: false.
//   - NEVER remove the watermark from the decrypted report.
//
// Key server info (Sui testnet, Mysten Labs decentralized server):
//   Package:    0xc5ce2742cac46421b62028557f1d7aea8a4c50f651379a79afdf12cd88628807 (v1)
//   Key server: 0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98
//
// Reference:   https://github.com/MystenLabs/seal/blob/main/examples/frontend/src/utils.ts

import { SealClient, EncryptedObject } from "@mysten/seal";
import { SuiGraphQLClient } from "@mysten/sui/graphql";
import { env } from "../env";
import type { AuditReport } from "../audit/schema";

// ──────────────────────────────────────────────────────────────
// Testnet constants (hardcoded; no extra env vars required)
// ──────────────────────────────────────────────────────────────

/**
 * Seal testnet policy-package namespace.
 * This is the Mysten Labs "Seal Example" package on testnet (immutable, version 1).
 * Any version-1 package can serve as an IBE namespace.
 */
export const SEAL_TESTNET_PACKAGE_ID =
  "0xc5ce2742cac46421b62028557f1d7aea8a4c50f651379a79afdf12cd88628807";

/**
 * Testnet Mysten Labs decentralized (Committee) key server.
 * Source: https://github.com/MystenLabs/seal/blob/main/examples/frontend/src/EncryptAndUpload.tsx
 * aggregatorUrl is required for Committee-type key servers.
 */
export const SEAL_TESTNET_KEY_SERVERS = [
  {
    objectId:
      "0xb012378c9f3799fb5b1a7083da74a4069e3c3f1c93de0b27212a5799ce1e1e98",
    weight: 1,
    aggregatorUrl: "https://seal-aggregator-testnet.mystenlabs.com",
  },
];

/**
 * AES-GCM IV hardcoded by the Seal SDK (dem.ts).
 * Must match the Seal DEM implementation exactly.
 */
const SEAL_IV = Uint8Array.from([
  138, 55, 153, 253, 198, 46, 121, 219, 160, 128, 89, 7, 214, 156, 148, 220,
]);

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

export interface SealResult {
  /** BCS-encoded EncryptedObject (Seal IBE + AES-GCM ciphertext). */
  encryptedBytes: Uint8Array;
  /** The `id` field from the EncryptedObject (used as the IBE identity handle). */
  sealId: string;
  /** true = real Seal IBE; false = plaintext fallback. */
  sealed: boolean;
  /**
   * The 256-bit DEM key returned by SealClient.encrypt().
   * ONLY present when sealed=true.  Used for backup recovery and test verification.
   * NEVER store this field alongside the encrypted bytes in production.
   */
  backupKey?: Uint8Array;
}

// ──────────────────────────────────────────────────────────────
// Compatibility shim: SuiGraphQLClient content lazy-promise fix
// ──────────────────────────────────────────────────────────────

/**
 * The Seal SDK's `retrieveKeyServers` calls `client.core.getObject()` and
 * synchronously reads `res.object.content` as raw BCS bytes. However,
 * `SuiGraphQLClient.core.getObject()` returns `content` as a lazy Promise.
 *
 * This function patches `core.getObject` on the given client so the returned
 * `content` is the awaited Uint8Array, making it Seal-compatible.
 *
 * No JSON-RPC is used — the underlying transport remains GraphQL.
 */
function patchSuiClientForSeal(client: SuiGraphQLClient): SuiGraphQLClient {
  const originalGetObject = client.core.getObject.bind(client.core);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client.core as any).getObject = async (options: Parameters<typeof originalGetObject>[0]) => {
    const result = await originalGetObject(options);
    // Pre-resolve the lazy content Promise so the Seal SDK can read it synchronously.
    if (result?.object?.content instanceof Promise) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result.object as any).content = await result.object.content;
    }
    return result;
  };
  return client;
}

/** Decode the sealId from a BCS-encoded EncryptedObject. */
function extractSealId(encryptedBytes: Uint8Array): string {
  try {
    return EncryptedObject.parse(encryptedBytes).id;
  } catch {
    return "unknown";
  }
}

// ──────────────────────────────────────────────────────────────
// encryptReport
// ──────────────────────────────────────────────────────────────

/**
 * Threshold-encrypt a serialised AuditReport for `ownerAddress`.
 *
 * Happy path:
 *   Seal IBE encryption with 1-of-1 testnet key server.
 *   Returns { sealed: true, encryptedBytes: <BCS blob>, sealId, backupKey }.
 *
 * Fallback (Seal unreachable / misconfigured):
 *   Returns { sealed: false, encryptedBytes: plaintext JSON, sealId: "unsealed" }.
 *   Logs a loud WARNING — never silently fails.
 *
 * Feature F12 only passes when sealed = true.
 */
export async function encryptReport(
  report: AuditReport,
  ownerAddress: string,
): Promise<SealResult> {
  const plaintext = new TextEncoder().encode(JSON.stringify(report));

  try {
    // GraphQL client — no JSON-RPC (hard rule).
    // Patched to pre-resolve the lazy content Promise for Seal SDK compatibility.
    const suiClient = patchSuiClientForSeal(
      new SuiGraphQLClient({ url: env.SUI_GRAPHQL_URL }),
    );

    const sealClient = new SealClient({
      suiClient,
      serverConfigs: SEAL_TESTNET_KEY_SERVERS,
      // Skip key-server PoP verification (acceptable for testnet hackathon demo).
      // In production, set this to true.
      verifyKeyServers: false,
    });

    const { encryptedObject, key } = await sealClient.encrypt({
      packageId: SEAL_TESTNET_PACKAGE_ID,
      id: ownerAddress,
      data: plaintext,
      threshold: 1,
    });

    return {
      encryptedBytes: encryptedObject,
      sealId: extractSealId(encryptedObject),
      sealed: true,
      backupKey: key,
    };
  } catch (e) {
    console.warn(
      "SEAL UNAVAILABLE — storing PLAINTEXT (sealed=false). Demo fallback only.",
      e,
    );
    return {
      encryptedBytes: plaintext,
      sealId: "unsealed",
      sealed: false,
    };
  }
}

// ──────────────────────────────────────────────────────────────
// decryptReport (backup key path — for test verification only)
// ──────────────────────────────────────────────────────────────

/**
 * Decrypt a Seal-encrypted AuditReport using the backup DEM key.
 *
 * The backup key is the AES-256-GCM DEM key returned by SealClient.encrypt().
 * It bypasses the key-server fetch step and decrypts the AES ciphertext directly.
 * This is intended ONLY for:
 *   (a) backup recovery when all key servers are offline
 *   (b) test verification in f12-verify.ts
 *
 * For the normal (online) decryption flow, use SealClient.decrypt() with
 * a signed SessionKey and appropriate txBytes.
 *
 * @throws {Error} if the ciphertext type is not Aes256Gcm, or decryption fails.
 */
export async function decryptReportWithBackupKey(
  encryptedBytes: Uint8Array,
  backupKey: Uint8Array,
): Promise<string> {
  const parsed = EncryptedObject.parse(encryptedBytes);

  const aesGcmCt = parsed.ciphertext.Aes256Gcm;
  if (!aesGcmCt) {
    throw new Error(
      `decryptReportWithBackupKey: unsupported ciphertext type. Expected Aes256Gcm.`,
    );
  }

  const blob = aesGcmCt.blob;
  const aad  = aesGcmCt.aad;

  const aesCryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(backupKey),
    "AES-GCM",
    false,
    ["decrypt"],
  );

  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: SEAL_IV,
      additionalData: aad ? new Uint8Array(aad) : new Uint8Array(),
    },
    aesCryptoKey,
    new Uint8Array(blob),
  );

  return new TextDecoder().decode(decryptedBuffer);
}

// ──────────────────────────────────────────────────────────────
// encryptReportFallback (for explicit fallback testing in f12-verify)
// ──────────────────────────────────────────────────────────────

/**
 * Simulate Seal being unavailable: always returns plaintext with sealed=false.
 * Used by f12-verify step 4 to test the fallback path explicitly.
 */
export async function encryptReportFallback(
  report: AuditReport,
): Promise<SealResult> {
  const plaintext = new TextEncoder().encode(JSON.stringify(report));
  console.warn(
    "SEAL UNAVAILABLE — storing PLAINTEXT (sealed=false). Demo fallback only.",
  );
  return { encryptedBytes: plaintext, sealId: "unsealed", sealed: false };
}
