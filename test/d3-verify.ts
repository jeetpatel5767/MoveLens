/**
 * test/d3-verify.ts — D3 Gallery Overhaul + Cetus Hero verify
 *
 * Steps:
 *   1. gallery.json has exactly 3 entries: Cetus, movelens_demo, 0x2::coin
 *   2. Cetus entry has a highlight field calling out ML-INT-001
 *   3. Each blobId is fetchable from the Walrus aggregator (HTTP 200)
 *   4. homepage renders Cetus hero above the audit form (visual check via dev server)
 *
 * Run: npx tsx test/d3-verify.ts
 */

require("dotenv/config");

import { readFileSync } from "fs";

let passed = 0;
let failed = 0;

function pass(msg: string) { console.log(`PASS ${msg}`); passed++; }
function fail(msg: string) { console.error(`FAIL ${msg}`); failed++; }

interface GalleryEntry {
  id: string;
  packageName: string;
  packageId: string;
  network: string;
  riskGrade: string;
  blobId: string;
  walrusUrl: string;
  description?: string;
  highlight?: string;
  severityCounts: { critical: number; high: number; medium: number; low: number };
  totalFindings: number;
  auditedAt: string;
  layersRun: string[];
}

async function main() {
  // ── Step 1: gallery.json has exactly 3 entries ────────────────────────────────
  console.log("\n── Step 1: gallery.json structure — 3 entries ─────────────────────────────");
  const galleryRaw = readFileSync("src/app/gallery.json", "utf8");
  const gallery = JSON.parse(galleryRaw) as GalleryEntry[];

  if (gallery.length !== 3) {
    fail(`step1: expected 3 gallery entries, got ${gallery.length}`);
  } else {
    pass("step1: gallery.json has exactly 3 entries ✓");
  }

  const cetusEntry = gallery.find((e) => e.id === "cetus-clmm");
  const demoEntry  = gallery.find((e) => e.id === "movelens-demo");
  const coinEntry  = gallery.find((e) => e.id === "sui-framework-coin");

  if (cetusEntry) {
    pass("step1b: Cetus CLMM entry present ✓");
  } else {
    fail("step1b: Cetus CLMM entry (id='cetus-clmm') missing");
  }
  if (demoEntry) {
    pass("step1c: movelens-demo entry present ✓");
  } else {
    fail("step1c: movelens-demo entry (id='movelens-demo') missing");
  }
  if (coinEntry) {
    pass("step1d: Sui Framework coin entry present ✓");
  } else {
    fail("step1d: sui-framework-coin entry (id='sui-framework-coin') missing");
  }

  // ── Step 2: Cetus entry has highlight field with ML-INT-001 ───────────────────
  console.log("\n── Step 2: Cetus entry has highlight mentioning ML-INT-001 ────────────────");
  if (!cetusEntry) {
    fail("step2: skipping — Cetus entry not found");
  } else if (!cetusEntry.highlight) {
    fail("step2: Cetus entry missing highlight field");
  } else if (!cetusEntry.highlight.includes("ML-INT-001")) {
    fail(`step2: highlight doesn't mention ML-INT-001: "${cetusEntry.highlight}"`);
  } else {
    pass(`step2: Cetus highlight calls out ML-INT-001 ✓`);
    console.log(`  highlight: "${cetusEntry.highlight}"`);
  }

  // ── Step 3: Walrus aggregator returns 200 for all 3 blobIds ──────────────────
  console.log("\n── Step 3: all 3 blobIds fetchable from Walrus aggregator ─────────────────");
  for (const entry of gallery) {
    try {
      const resp = await fetch(entry.walrusUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(15_000),
      });
      if (resp.ok || resp.status === 206) {
        pass(`step3 [${entry.id}]: ${resp.status} ${entry.blobId.slice(0, 12)}… ✓`);
      } else {
        fail(`step3 [${entry.id}]: HTTP ${resp.status} for blob ${entry.blobId.slice(0, 12)}…`);
      }
    } catch (err) {
      fail(`step3 [${entry.id}]: fetch failed — ${err}`);
    }
  }

  // ── Step 4: page.tsx includes CetusHero and CETUS_PACKAGE_ID ─────────────────
  console.log("\n── Step 4: page.tsx has CetusHero component and onRunLive ─────────────────");
  const pageSource = readFileSync("src/app/page.tsx", "utf8");

  if (pageSource.includes("CetusHero")) {
    pass("step4: page.tsx defines CetusHero component ✓");
  } else {
    fail("step4: page.tsx missing CetusHero component");
  }

  if (pageSource.includes("CETUS_PACKAGE_ID")) {
    pass("step4b: page.tsx has CETUS_PACKAGE_ID constant ✓");
  } else {
    fail("step4b: page.tsx missing CETUS_PACKAGE_ID constant");
  }

  if (pageSource.includes("runLiveCetusAudit") && pageSource.includes("onRunLive")) {
    pass("step4c: Re-run live handler wired ✓");
  } else {
    fail("step4c: Re-run live handler (runLiveCetusAudit/onRunLive) missing");
  }

  if (pageSource.includes("View permanent audit on Walrus")) {
    pass("step4d: Walrus link present in CetusHero ✓");
  } else {
    fail("step4d: 'View permanent audit on Walrus' link missing");
  }

  if (pageSource.includes("highlight") && pageSource.includes("entry.highlight")) {
    pass("step4e: gallery cards render highlight field ✓");
  } else {
    fail("step4e: gallery card highlight rendering missing");
  }

  // ── Step 5: Cetus hero appears BEFORE the input card in JSX order ────────────
  console.log("\n── Step 5: CetusHero placed above input card in render ─────────────────────");
  const heroIdx  = pageSource.indexOf("<CetusHero");
  const inputIdx = pageSource.indexOf("{/* ── Input card");
  if (heroIdx !== -1 && inputIdx !== -1 && heroIdx < inputIdx) {
    pass("step5: CetusHero appears before the Input card in render ✓");
  } else {
    fail(`step5: CetusHero (${heroIdx}) must appear before Input card (${inputIdx})`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\nD3: ${passed}/${passed + failed} steps passed ${passed >= 10 ? "✓" : "✗"}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[d3-verify] Unexpected error:", err);
  process.exit(1);
});
