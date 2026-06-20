// JSON-RPC is FORBIDDEN in this codebase (sunsets 2026-07-31). GraphQL only.

import { suiQuery } from "./graphql";

export interface ModuleInfo {
  name: string;
  source: string | null;
  disassembly: string;
}

export interface PackageContext {
  packageId: string;
  network: "testnet" | "mainnet";
  mvrName: string | null;
  sourceRepo: string | null;
  version: number;
  upgradeCount: number;
  modules: ModuleInfo[];
  fetchedAt: string;
  // Optional git-audit metadata — only set when input was a GitHub repo URL
  inputType?: string;
  fileCount?: number;
  cappedAt?: number | null;
}

export class InvalidAddressError extends Error {
  constructor(address: string) {
    super(`Invalid Sui address format: "${address}"`);
    this.name = "InvalidAddressError";
  }
}

export class PackageNotFoundError extends Error {
  constructor(address: string) {
    super(`Package not found on-chain: "${address}"`);
    this.name = "PackageNotFoundError";
  }
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;

const PACKAGE_QUERY = `
  query FetchPackage($id: SuiAddress!) {
    package(address: $id) {
      address
      version
      modules {
        nodes {
          name
          disassembly
        }
      }
    }
  }
`;

interface RawPackage {
  package: {
    address: string;
    version: number;
    modules: { nodes: Array<{ name: string; disassembly: string | null }> };
  } | null;
}

export async function fetchPackage(
  packageId: string,
  network: "testnet" | "mainnet" = "testnet"
): Promise<PackageContext> {
  if (!ADDRESS_RE.test(packageId)) {
    throw new InvalidAddressError(packageId);
  }

  const data = await suiQuery<RawPackage>(PACKAGE_QUERY, { id: packageId });

  if (!data.package) {
    throw new PackageNotFoundError(packageId);
  }

  const pkg = data.package;
  const modules: ModuleInfo[] = pkg.modules.nodes.map((m) => ({
    name: m.name,
    source: null,
    disassembly: m.disassembly ?? "",
  }));

  return {
    packageId: pkg.address,
    network,
    mvrName: null,
    sourceRepo: null,
    version: pkg.version,
    upgradeCount: pkg.version,
    modules,
    fetchedAt: new Date().toISOString(),
  };
}
