#!/usr/bin/env tsx
// scripts/create-memwal-account.ts
// One-time setup: create a MemWal mainnet account and delegate key.
//
// Prerequisites:
//   - A Sui mainnet keypair with enough SUI for gas (~0.1 SUI)
//   - Add MEMWAL_SUI_PRIVATE_KEY (bech32 suiprivkey1...) to .env temporarily
//
// Outputs:
//   MEMWAL_PRIVATE_KEY=<hex>    ← add to .env
//   MEMWAL_ACCOUNT_ID=<0x...>   ← add to .env
//
// MemWal server config (from https://relayer.memwal.ai/config):
//   packageId: 0xcee7a6fd8de52ce645c38332bde23d4a30fd9426bc4681409733dd50958a24c6
//   network:   mainnet

// ESM-only package — dynamic import required when running under tsx CJS mode
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createAccount: any, addDelegateKey: any, generateDelegateKey: any;

const MEMWAL_PACKAGE_ID = "0xcee7a6fd8de52ce645c38332bde23d4a30fd9426bc4681409733dd50958a24c6";

// The AccountRegistry shared object ID on mainnet.
// Source: check https://relayer.memwal.ai/config for registryId field,
// OR look up the MemWal contract deployment on the Sui mainnet explorer.
const MEMWAL_REGISTRY_ID = process.env.MEMWAL_REGISTRY_ID ?? "";

async function main() {
  // Load ESM-only package dynamically
  ({ createAccount, addDelegateKey, generateDelegateKey } =
    await import("@mysten-incubation/memwal/account"));

  if (!MEMWAL_REGISTRY_ID) {
    console.error(
      "MEMWAL_REGISTRY_ID not set. Find it from the MemWal mainnet deployment.\n" +
      "Check: https://suiexplorer.com/object/<MEMWAL_PACKAGE_ID>?network=mainnet\n" +
      "or ask the MemWal team at https://github.com/MystenLabs/MemWal"
    );
    process.exit(1);
  }

  const suiPrivateKey = process.env.MEMWAL_SUI_PRIVATE_KEY;
  if (!suiPrivateKey) {
    console.error("MEMWAL_SUI_PRIVATE_KEY not set (must be a funded mainnet bech32 key)");
    process.exit(1);
  }

  console.log("Generating delegate key…");
  const delegate = await generateDelegateKey();
  console.log("Delegate public key:", Buffer.from(delegate.publicKey).toString("hex"));
  console.log("Delegate Sui address:", delegate.suiAddress);

  console.log("\nCreating MemWal account on mainnet…");
  const account = await createAccount({
    packageId:     MEMWAL_PACKAGE_ID,
    registryId:    MEMWAL_REGISTRY_ID,
    suiPrivateKey,
  });
  console.log("Account created:", account.accountId);
  console.log("TX digest:", account.digest);

  console.log("\nAdding delegate key to account…");
  const result = await addDelegateKey({
    packageId:   MEMWAL_PACKAGE_ID,
    accountId:   account.accountId,
    publicKey:   delegate.publicKey,
    label:       "MoveLens server",
    suiPrivateKey,
  });
  console.log("Delegate key added. TX digest:", result.digest);

  console.log("\n=== ADD THESE TO YOUR .env ===");
  console.log(`MEMWAL_PRIVATE_KEY=${delegate.privateKey}`);
  console.log(`MEMWAL_ACCOUNT_ID=${account.accountId}`);
  console.log("==============================");
}

main().catch((e) => { console.error(e); process.exit(1); });
