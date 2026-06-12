// F15 verification — Demo Move package published + MVR registration
//
// Step 1: Verify the demo Move package exists on testnet (non-empty module list).
// Step 2: Verify the PackageInfo object is owned by our keypair's address.
// Step 3: Verify PackageInfo.upgrade_cap_id and .package_address match expected values.
//
// These objects were published and registered in Session 14:
//   packageId:     0x6bcb6936da7f7df80741e0abb7aa5fb78d160a7be227f48b0a6f0c9c83648698
//   packageInfoId: 0xcc7af44f578839df65cd69705c640559aa594b6528161653b91416cdec7a50e2
//   publish tx:    85rKhcZxaSpubzxHs81P1o57wfQqQL1rD5Rqf2YBJCZH
//   packageInfo creation tx: 3NvP9wMCAqRzgaQYz8vjyfKT27em1qdAw5tj5BTqooUW

import {
  DEMO_PACKAGE_ID,
  DEMO_PACKAGE_INFO_ID,
  DEMO_UPGRADE_CAP_ID,
  PACKAGE_INFO_CONTRACT,
} from "../src/lib/mvr/metadata";
import { env } from "../src/lib/env";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

const SIGNER_ADDRESS = "0x8a271c5a35e7fdac64fd811b57d6e605f81697fd12b8a1867300abf867429d57";

async function gql(query: string): Promise<unknown> {
  const r = await fetch(env.SUI_GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`GraphQL HTTP ${r.status}`);
  const d = await r.json() as { data?: unknown; errors?: Array<{ message: string }> };
  if (d.errors?.length) throw new Error(`GraphQL error: ${d.errors[0].message}`);
  return d.data;
}

async function main() {
  let passed = 0;

  // ── Step 1: Demo package exists on testnet ────────────────────────────────
  console.log(`  [step1] Checking demo package on testnet: ${DEMO_PACKAGE_ID}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pkgData = await gql(`{
    object(address: "${DEMO_PACKAGE_ID}") {
      asMovePackage {
        modules { nodes { name } }
      }
    }
  }`) as any;

  const modules: string[] = pkgData?.object?.asMovePackage?.modules?.nodes?.map(
    (n: { name: string }) => n.name,
  ) ?? [];

  if (modules.length === 0) {
    fail(`step1: package ${DEMO_PACKAGE_ID} has no modules on testnet`);
    return;
  }
  if (!modules.includes("vault")) {
    fail(`step1: expected module "vault" but got: ${modules.join(", ")}`);
    return;
  }

  console.log(`       modules on testnet: [${modules.join(", ")}] ✓`);
  console.log(`       packageId: ${DEMO_PACKAGE_ID}`);
  pass(`step1: demo package exists on testnet with module "vault"`);
  passed++;

  // ── Step 2: PackageInfo owned by our keypair ──────────────────────────────
  console.log(`  [step2] Checking PackageInfo ownership: ${DEMO_PACKAGE_INFO_ID}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const piData = await gql(`{
    object(address: "${DEMO_PACKAGE_INFO_ID}") {
      owner { ... on AddressOwner { address { address } } }
      asMoveObject {
        contents {
          type { repr }
          json
        }
      }
    }
  }`) as any;

  const ownerAddr: string | undefined =
    piData?.object?.owner?.address?.address;
  const objType: string | undefined =
    piData?.object?.asMoveObject?.contents?.type?.repr;

  if (!ownerAddr) {
    fail(`step2: could not determine owner of PackageInfo ${DEMO_PACKAGE_INFO_ID}`);
    return;
  }

  const expectedType = `${PACKAGE_INFO_CONTRACT}::package_info::PackageInfo`;
  if (objType !== expectedType) {
    fail(`step2: unexpected type "${objType}" (expected "${expectedType}")`);
    return;
  }

  // Normalize addresses for comparison (both to lowercase)
  if (ownerAddr.toLowerCase() !== SIGNER_ADDRESS.toLowerCase()) {
    fail(
      `step2: PackageInfo owner "${ownerAddr}" ≠ our address "${SIGNER_ADDRESS}"`,
    );
    return;
  }

  console.log(`       PackageInfo type: ${objType} ✓`);
  console.log(`       Owner: ${ownerAddr} ✓`);
  pass(`step2: PackageInfo is owned by our keypair address`);
  passed++;

  // ── Step 3: PackageInfo fields match our deployment ───────────────────────
  console.log(`  [step3] Verifying PackageInfo metadata fields…`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = piData?.object?.asMoveObject?.contents?.json as any;

  const upgradeCapId: string = json?.upgrade_cap_id ?? "";
  const packageAddr: string = json?.package_address ?? "";

  if (upgradeCapId.toLowerCase() !== DEMO_UPGRADE_CAP_ID.toLowerCase()) {
    fail(
      `step3: PackageInfo.upgrade_cap_id "${upgradeCapId}" ≠ expected "${DEMO_UPGRADE_CAP_ID}"`,
    );
    return;
  }
  if (packageAddr.toLowerCase() !== DEMO_PACKAGE_ID.toLowerCase()) {
    fail(
      `step3: PackageInfo.package_address "${packageAddr}" ≠ expected "${DEMO_PACKAGE_ID}"`,
    );
    return;
  }

  console.log(`       upgrade_cap_id: ${upgradeCapId} ✓`);
  console.log(`       package_address: ${packageAddr} ✓`);
  pass(`step3: PackageInfo fields (upgrade_cap_id, package_address) match deployment`);
  passed++;

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\nF15: ${passed}/3 steps passed ✓`);
  console.log(`  packageId:     ${DEMO_PACKAGE_ID}`);
  console.log(`  packageInfoId: ${DEMO_PACKAGE_INFO_ID}`);
  console.log(`  publish tx:    85rKhcZxaSpubzxHs81P1o57wfQqQL1rD5Rqf2YBJCZH`);
  console.log(`  RECORD these IDs in progress.txt`);
}

main().catch((e) => { console.error(e); process.exit(1); });
