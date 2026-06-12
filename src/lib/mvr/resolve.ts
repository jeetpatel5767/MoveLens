// MVR (Move Registry) reverse resolution: package address → @scope/name
// Spec: https://docs.suins.io/move-registry
// Endpoint: mainnet.mvr.mystenlabs.com (MVR is mainnet-only; testnet packages return null)
// NEVER throws — resolution failure must never block an audit.

const MVR_BASE = "https://mainnet.mvr.mystenlabs.com";
const TIMEOUT_MS = 5000;

/** Pad a Sui address to the canonical 0x + 64 hex chars format the MVR API requires. */
function padAddress(address: string): string {
  const hex = address.startsWith("0x") ? address.slice(2) : address;
  return "0x" + hex.padStart(64, "0");
}

export interface MvrResolution {
  name: string | null;
  sourceRepo: string | null;
}

/**
 * Resolve a Sui package address to its MVR name (e.g. "@deepbook/core").
 * Returns { name: null, sourceRepo: null } on any failure — never throws.
 */
export async function resolvePackageName(
  packageId: string
): Promise<MvrResolution> {
  const padded = padAddress(packageId);
  try {
    const res = await fetch(
      `${MVR_BASE}/v1/reverse-resolution/${padded}`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!res.ok) return { name: null, sourceRepo: null };
    const data = (await res.json()) as { name?: string; metadata?: { source?: string } };
    return {
      name: data.name ?? null,
      sourceRepo: data.metadata?.source ?? null,
    };
  } catch {
    console.warn(
      `[MVR] resolution timed out or failed for ${packageId} — continuing without name`
    );
    return { name: null, sourceRepo: null };
  }
}
