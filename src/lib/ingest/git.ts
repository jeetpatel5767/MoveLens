// src/lib/ingest/git.ts
// Clones a GitHub repo to a temp directory, finds all .move files,
// builds a PackageContext from them, then cleans up.

import simpleGit from "simple-git";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { PackageContext, ModuleInfo } from "../sui/queries";

export class GitCloneError extends Error {
  constructor(msg: string, public cause?: unknown) { super(msg); }
}

export interface GitAuditInput {
  repoUrl: string;   // e.g. "https://github.com/owner/repo"
  branch?: string;   // optional — defaults to repo's default branch
}

/**
 * Clone a GitHub repo, find all .move files, build a PackageContext.
 * The temp directory is cleaned up after this function returns.
 * Never throws raw git errors — wraps them in GitCloneError.
 */
export async function buildPackageContextFromGit(
  input: GitAuditInput
): Promise<PackageContext> {
  if (!isValidGithubUrl(input.repoUrl)) {
    throw new GitCloneError(`Invalid GitHub URL: ${input.repoUrl}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "movelens-git-"));

  try {
    const git = simpleGit();
    const cloneArgs = ["--depth", "1", "--single-branch"];
    if (input.branch) cloneArgs.push("--branch", input.branch);

    await git.clone(input.repoUrl, tmpDir, cloneArgs).catch((err: unknown) => {
      throw new GitCloneError(
        `Failed to clone ${input.repoUrl} — repo may be private, nonexistent, or too large`,
        err
      );
    });

    const moveFiles = findMoveFiles(tmpDir);
    if (moveFiles.length === 0) {
      throw new GitCloneError(
        `No .move files found in ${input.repoUrl} — is this a Move/Sui project?`
      );
    }

    const MAX_FILES = 50;
    const filesToProcess = moveFiles.slice(0, MAX_FILES);
    if (moveFiles.length > MAX_FILES) {
      console.warn(`[git] Repo has ${moveFiles.length} .move files — capping at ${MAX_FILES}`);
    }

    const modules: ModuleInfo[] = filesToProcess.map(filePath => {
      const relativePath = path.relative(tmpDir, filePath);
      const source = fs.readFileSync(filePath, "utf-8");
      const moduleMatch = source.match(/module\s+\w+::\s*(\w+)/);
      const name = moduleMatch ? moduleMatch[1] : path.basename(filePath, ".move");
      return { name, source, disassembly: "", filePath: relativePath } as ModuleInfo & { filePath: string };
    });

    const repoName = input.repoUrl
      .replace(/https?:\/\/github\.com\//, "")
      .replace(/\.git$/, "");

    return {
      packageId:    `github:${repoName}`,
      network:      "testnet",
      mvrName:      null,
      sourceRepo:   input.repoUrl,
      version:      0,
      upgradeCount: 0,
      modules,
      fetchedAt:    new Date().toISOString(),
      inputType:    "git",
      fileCount:    moveFiles.length,
      cappedAt:     moveFiles.length > MAX_FILES ? MAX_FILES : null,
    };

  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function findMoveFiles(dir: string): string[] {
  const results: string[] = [];
  const EXCLUDE_DIRS = new Set(["build", "target", ".git", "node_modules", "deps"]);

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) walk(path.join(current, entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".move")) {
        results.push(path.join(current, entry.name));
      }
    }
  }

  walk(dir);
  return results;
}

function isValidGithubUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "github.com" &&
      parsed.pathname.split("/").filter(Boolean).length >= 2
    );
  } catch {
    return false;
  }
}
