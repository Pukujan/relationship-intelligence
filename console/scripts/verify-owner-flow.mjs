/**
 * Real user-flow verification of owner mode against live Octo.
 *
 * First run opens a headed Chromium window: a human completes Google sign-in
 * through the adapter (Octo owns the handshake). The sealed session is saved
 * to the ACS scratch dir and reused by later runs, which then run headless.
 *
 *   node console/scripts/verify-owner-flow.mjs
 *
 * Verifies: owner world reads canonical ledger people; signals render; the
 * copilot answers live and attributes the principal; design mode proposes a
 * milestone referencing real people; approval materializes it in Octo SQL.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(new URL("../../app/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const BASE = "http://localhost:5173/console";
const STATE = path.join(
  process.env.HOME ?? "~",
  ".cache/acs/scratch/ri-owner-state.json",
);
const PRE = path.join(here, "../../console-preview");
const log = (...a) => console.log(...a);

const browser = await chromium.launch({ headless: fs.existsSync(STATE) });
const context = fs.existsSync(STATE)
  ? await browser.newContext({ storageState: STATE, viewport: { width: 1600, height: 1000 } })
  : await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));

await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });

if (!fs.existsSync(STATE)) {
  log(">>> SIGN IN with Google in the opened Chromium window. Waiting up to 10 minutes…");
  await page.getByText("Continue with Google").click();
  const deadline = Date.now() + 600_000;
  let authenticated = false;
  while (Date.now() < deadline && !authenticated) {
    await page.waitForTimeout(3000);
    authenticated = await page
      .evaluate(() =>
        fetch("/app-api/session", { credentials: "same-origin" })
          .then((r) => r.json())
          .then((d) => Boolean(d.authenticated))
          .catch(() => false),
      )
      .catch(() => false);
  }
  if (!authenticated) {
    log("FAIL: sign-in did not complete");
    await browser.close();
    process.exit(1);
  }
  await context.storageState({ path: STATE });
  log("session saved for later runs");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
}

// 1. canonical people from the ledger, not the demo seed
await page.goto(BASE + "/people", { waitUntil: "networkidle" });
await page.getByText("Jane Doe").first().waitFor({ timeout: 30000 });
const demoLeak = await page.getByText("Dana Whitfield").count();
log("1 owner people: Jane Doe present | demo person leaked:", demoLeak > 0);
await page.screenshot({ path: PRE + "/owner-people.png" });

// 2. signals on Today
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.getByText("Needs attention").first().waitFor({ timeout: 30000 });
await page.screenshot({ path: PRE + "/owner-today.png" });
log("2 owner today: needs-attention rendered");

// 3. live copilot, principal-attributed
const principalId = await page.evaluate(() =>
  fetch("/app-api/session", { credentials: "same-origin" })
    .then((r) => r.json())
    .then((d) => d.principal?.id ?? ""),
);
await page.keyboard.press("Meta+k");
await page.getByLabel("Ask the copilot").waitFor({ timeout: 10000 });
await page.getByLabel("Ask the copilot").fill("Who is going cold and what should I do next?");
await page.getByRole("button", { name: "Run" }).click();
await page.getByText("live model", { exact: true }).waitFor({ timeout: 100000 });
await page.waitForTimeout(7000);
await page.screenshot({ path: PRE + "/owner-copilot.png" });
log("3 owner copilot: live model | principal:", principalId.slice(0, 8));

// 4. design -> hold -> approve -> milestone in Octo
await page.getByRole("button", { name: "Design" }).click();
await page.getByLabel("Ask the copilot").fill("Re-engage Jane Doe on open-source tooling with a sourced brief");
await page.getByRole("button", { name: "Run" }).click();
await page.getByText("Proposed milestone — held for you").waitFor({ timeout: 100000 });
await page.waitForTimeout(7000);
await page.screenshot({ path: PRE + "/owner-design.png" });
await page.getByRole("button", { name: "Hold for approval" }).click();
await page.getByText("In your approval inbox").waitFor({ timeout: 20000 });
const href = await page.getByRole("link", { name: "Open in inbox" }).getAttribute("href");
const id = href.split("focus=")[1];
await page.getByRole("link", { name: "Open in inbox" }).click();
const card = page.locator("#approval-" + id);
await card.waitFor({ timeout: 15000 });
const missionName = ((await card.innerText()).match(/New milestone: (.+)/) || [])[1]?.trim();
await card.getByRole("button", { name: "Approve" }).click();
await page.waitForTimeout(2500);
await page.getByRole("link", { name: "Milestones", exact: true }).first().click();
await page.waitForURL("**/milestones", { timeout: 15000 });
await page.waitForTimeout(1500);
const created = missionName ? await page.getByText(missionName, { exact: false }).count() : 0;
log("4 owner milestone created in Octo:", created > 0, "|", missionName);
await page.screenshot({ path: PRE + "/owner-milestone.png" });

log("ERRORS:", errs.length ? errs.join(" | ") : "none");
await browser.close();
