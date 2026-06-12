// Source upload path — builds a PackageContext from pasted Move files.
// Full API route wired in Phase 7; this module contains the pure parsing logic.

import type { PackageContext, ModuleInfo } from "../sui/queries";

const MAX_TOTAL_BYTES = 1 * 1024 * 1024; // 1 MB

export interface UploadedFile {
  name: string;
  content: string;
}

export class UploadValidationError extends Error {
  constructor(message: string, public statusCode: 400 = 400) {
    super(message);
    this.name = "UploadValidationError";
  }
}

/**
 * Parse and validate uploaded Move source files into a PackageContext.
 * Throws UploadValidationError (400) on invalid input.
 */
export function buildPackageContextFromUpload(
  files: UploadedFile[],
  network: "testnet" | "mainnet" = "testnet"
): PackageContext {
  if (!files || files.length === 0) {
    throw new UploadValidationError("At least one .move file is required.");
  }

  // All files must end in .move
  const nonMove = files.filter(f => !f.name.endsWith(".move"));
  if (nonMove.length > 0) {
    throw new UploadValidationError(
      `Only .move files are accepted. Rejected: ${nonMove.map(f => f.name).join(", ")}`
    );
  }

  // Total payload must be ≤ 1 MB
  const totalBytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.content, "utf8"), 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new UploadValidationError(
      `Total payload ${(totalBytes / 1024).toFixed(1)} KB exceeds 1 MB limit.`
    );
  }

  // At least one file must contain a module declaration
  const hasModule = files.some(f => /\bmodule\s+\w/.test(f.content));
  if (!hasModule) {
    throw new UploadValidationError(
      "No module declaration found. At least one file must contain a Move module."
    );
  }

  const modules: ModuleInfo[] = files.map(f => ({
    name: f.name.replace(/\.move$/, ""),
    source: f.content,
    disassembly: "",
  }));

  return {
    packageId: "local-upload",
    network,
    mvrName: null,
    sourceRepo: null,
    version: 0,
    upgradeCount: 0,
    modules,
    fetchedAt: new Date().toISOString(),
  };
}
