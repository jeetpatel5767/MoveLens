// F20 verification — Landing page: address validation + source submit + navigation
//
// Step 1: Open localhost:3000 — verify hero heading, two tabs, Run Audit button
// Step 2: Type invalid address → inline error shown, no API call fired
// Step 3: Switch to Paste Source tab, paste fixture, click Run Audit
// Step 4: Verify navigation to /audit/[id] (URL changes and audit ID in path)
//
// Uses Playwright headless Chromium.

import { chromium } from "playwright";
import { readFileSync } from "fs";
import { join } from "path";

const BASE = "http://localhost:3000";

function pass(msg: string) { console.log("PASS", msg); }
function fail(msg: string) { console.error("FAIL", msg); process.exit(1); }

async function main() {
  let passed = 0;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Track API calls to /api/audit (POST) to verify no spurious calls on validation error
  const auditPosts: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/audit") && req.method() === "POST") {
      auditPosts.push(req.url());
    }
  });

  try {
    // ── Step 1: Load landing page ────────────────────────────────────────────
    console.log("\n  [step1] Navigate to localhost:3000…");

    await page.goto(BASE, { waitUntil: "networkidle" });

    const title = await page.title();
    console.log(`       page title: "${title}"`);

    // Verify hero heading contains "MoveLens"
    const heading = await page.locator("h1").first().textContent();
    if (!heading?.includes("MoveLens")) {
      fail(`step1: expected h1 to contain "MoveLens", got: "${heading}"`);
    }

    // Verify two tabs exist
    const packageTab = page.getByRole("button", { name: /Package Address/i });
    const sourceTab  = page.getByRole("button", { name: /Paste Source/i });
    if (!await packageTab.isVisible()) fail("step1: Package Address tab not visible");
    if (!await sourceTab.isVisible())  fail("step1: Paste Source tab not visible");

    // Verify Run Audit button
    const runBtn = page.getByRole("button", { name: /Run Audit/i });
    if (!await runBtn.isVisible()) fail("step1: Run Audit button not visible");

    pass(`step1: landing page loaded — h1="${heading?.trim()}", both tabs visible, Run Audit button present`);
    passed++;

    // ── Step 2: Invalid address → inline error, no API call ──────────────────
    console.log("\n  [step2] Type invalid address → expect inline validation error…");

    const addressInput = page.locator('input[placeholder*="0x0000"]');
    await addressInput.fill("notanaddress");
    await addressInput.blur(); // trigger onBlur validation

    // Wait for error message to appear
    await page.waitForSelector("text=/Must be a 0x/i", { timeout: 3000 });
    const errorMsg = await page.locator("text=/Must be a 0x/i").first().textContent();
    console.log(`       error shown: "${errorMsg?.trim()}"`);

    // Verify no API POST was fired
    if (auditPosts.length > 0) {
      fail(`step2: API POST was fired despite validation error! URLs: ${auditPosts.join(", ")}`);
    }

    // Also try clicking Run Audit with invalid address and verify still no POST
    await runBtn.click();
    await page.waitForTimeout(500);
    if (auditPosts.length > 0) {
      fail(`step2: API POST fired after clicking Run Audit with invalid address`);
    }

    pass(`step2: invalid address shows inline error "${errorMsg?.trim()?.slice(0, 60)}" — no API call fired`);
    passed++;

    // ── Step 3+4: Source tab → paste fixture → submit → navigate ─────────────
    console.log("\n  [step3+4] Switch to Paste Source tab, paste fixture, submit…");

    // Clear invalid address first, then switch to source tab
    await addressInput.fill("");
    await sourceTab.click();

    // Verify textarea is visible
    const textarea = page.locator("textarea");
    if (!await textarea.isVisible()) fail("step3: source textarea not visible after tab switch");

    // Paste the fixture source
    const src = readFileSync(join(process.cwd(), "test/fixtures/overflow.move"), "utf8");
    await textarea.fill(src);
    console.log(`       filled textarea with ${src.length} chars of Move source`);

    // Track navigation
    const navigationPromise = page.waitForURL(/\/audit\/[a-f0-9-]{36}/, { timeout: 15_000 });

    // Click Run Audit
    const postsBefore = auditPosts.length;
    await runBtn.click();

    // Wait for POST to fire
    await page.waitForTimeout(1000);
    if (auditPosts.length <= postsBefore) {
      fail("step3: Run Audit did not fire a POST to /api/audit");
    }
    console.log(`       POST fired to: ${auditPosts[auditPosts.length - 1]}`);

    // Wait for navigation to /audit/[id]
    await navigationPromise;
    const finalUrl = page.url();
    const idMatch = finalUrl.match(/\/audit\/([a-f0-9-]{36})/);
    if (!idMatch) {
      fail(`step4: expected navigation to /audit/<uuid> but got: ${finalUrl}`);
    }

    const auditId = idMatch[1];
    console.log(`       navigated to: ${finalUrl}`);
    console.log(`       auditId: ${auditId}`);

    pass(`step3: Paste Source tab worked — POST fired, navigated to /audit/${auditId}`);
    passed++;

    pass(`step4: navigation to /audit/[id] confirmed — URL: ${finalUrl}`);
    passed++;

  } finally {
    await browser.close();
  }

  console.log(`\nF20: ${passed}/4 steps passed ✓`);
}

main().catch((e) => { console.error(e); process.exit(1); });
