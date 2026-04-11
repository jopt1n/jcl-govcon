/**
 * Scrape Descriptions — Browser-based SAM.gov description extraction
 *
 * Uses Playwright to navigate SAM.gov contract pages and extract description
 * text for contracts that don't yet have descriptions. Concurrent browser tabs
 * parallelize the work (~2.5h vs ~12h sequential).
 *
 * Usage:
 *   npx tsx --import ./scripts/load-env.ts scripts/scrape-descriptions.ts --dry-run --limit 5
 *   npx tsx --import ./scripts/load-env.ts scripts/scrape-descriptions.ts --concurrency 5 --limit 100
 *   npx tsx --import ./scripts/load-env.ts scripts/scrape-descriptions.ts --start-from abc123
 */

import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { db } from "../src/lib/db";
import { contracts } from "../src/lib/db/schema";
import { eq, and, or, sql } from "drizzle-orm";
import { delay } from "../src/lib/utils";

const __dir = dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let dryRun = false;
  let limit = 0;
  let skip = 0;
  let concurrency = 5;
  let batchSize = 500;
  let delayMs = 2500;
  let startFromId = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") {
      dryRun = true;
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (args[i] === "--skip" && args[i + 1]) {
      skip = parseInt(args[++i], 10);
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = Math.min(parseInt(args[++i], 10), 10);
    } else if (args[i] === "--batch-size" && args[i + 1]) {
      batchSize = parseInt(args[++i], 10);
    } else if (args[i] === "--delay" && args[i + 1]) {
      delayMs = parseInt(args[++i], 10);
    } else if (args[i] === "--start-from" && args[i + 1]) {
      startFromId = args[++i];
    }
  }

  return { dryRun, limit, skip, concurrency, batchSize, delayMs, startFromId };
}

// ── Types ─────────────────────────────────────────────────────────────────

interface ScrapeResult {
  noticeId: string;
  descriptionText: string;
  descriptionLength: number;
  selectorUsed: string;
  url: string;
}

interface ContractRow {
  noticeId: string;
  title: string;
}

// ── Shared state ──────────────────────────────────────────────────────────

let shutdownFlag = false;
let sharedIndex = 0;
let sharedDelayMs = 2500;
let successCount = 0;
let consecutiveFailures = 0;
let totalFlushed = 0;
let flushCount = 0;
let resultsBuffer: ScrapeResult[] = [];
let flushChain: Promise<void> = Promise.resolve();
const scrapedIds = new Set<string>();
const failed: { noticeId: string; error: string }[] = [];
const failuresPath = resolve(__dir, "scrape-failures.json");

// Progress tracking
let processedCount = 0;
const rateWindow: { time: number; count: number }[] = [];

// ── Text validation ──────────────────────────────────────────────────────

const GARBAGE_PATTERNS = [
  /^SAM\.gov$/i,
  /^Loading/i,
  /^An official website of the United States government/i,
  /^Home$/i,
  /^Search$/i,
];

const ARCHIVED_PATTERNS = [
  /opportunity cannot be found/i,
  /has been archived/i,
  /no longer available/i,
  /page not found/i,
];

function validateText(text: string): { valid: boolean; reason?: string } {
  const trimmed = text.trim().replace(/\n{3,}/g, "\n\n");
  if (trimmed.length < 20) return { valid: false, reason: "too short" };
  if (!trimmed.includes(" ")) return { valid: false, reason: "no spaces" };
  for (const pattern of GARBAGE_PATTERNS) {
    if (pattern.test(trimmed)) return { valid: false, reason: "garbage match" };
  }
  for (const pattern of ARCHIVED_PATTERNS) {
    if (pattern.test(trimmed)) return { valid: false, reason: "archived/not found" };
  }
  return { valid: true };
}

function cleanText(text: string): string {
  let cleaned = text.trim().replace(/\n{3,}/g, "\n\n");
  // Strip "Description" or "DescriptionView Changes" heading prefix
  cleaned = cleaned.replace(/^Description(?:View Changes)?\s*/i, "").trim();
  if (cleaned.length > 100_000) {
    console.log(`[scrape] WARNING: description truncated from ${cleaned.length} to 100000 chars`);
    cleaned = cleaned.slice(0, 100_000);
  }
  return cleaned;
}

// ── Selector strategies ──────────────────────────────────────────────────

async function trySelectors(page: Page): Promise<{ text: string; selector: string } | null> {
  // Strategy A: Elements containing "Description" heading/label → grab sibling content
  try {
    const descHeading = await page.waitForSelector(
      'h2:has-text("Description"), h3:has-text("Description"), h4:has-text("Description"), label:has-text("Description")',
      { timeout: 5000 }
    );
    if (descHeading) {
      const parent = await descHeading.evaluateHandle((el) => el.parentElement);
      const text = await parent.evaluate((el) => (el as HTMLElement).innerText || "");
      const { valid } = validateText(text);
      if (valid) return { text: cleanText(text), selector: "description-heading-sibling" };
    }
  } catch { /* selector not found */ }

  // Strategy B: class/id containing "description"
  try {
    const el = await page.waitForSelector('[class*="description"], [id*="description"]', { timeout: 5000 });
    if (el) {
      const text = await el.evaluate((el) => (el as HTMLElement).innerText || "");
      const { valid } = validateText(text);
      if (valid) return { text: cleanText(text), selector: "class*=description" };
    }
  } catch { /* selector not found */ }

  // Strategy C: specific selectors
  for (const sel of [".opportunity-description", "#description", '[data-test*="description"]']) {
    try {
      const el = await page.waitForSelector(sel, { timeout: 5000 });
      if (el) {
        const text = await el.evaluate((el) => (el as HTMLElement).innerText || "");
        const { valid } = validateText(text);
        if (valid) return { text: cleanText(text), selector: sel };
      }
    } catch { /* selector not found */ }
  }

  // Strategy D: Largest text block fallback
  try {
    const result = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll("p, div, section, article"));
      const EXCLUDE_PATTERNS = /nav|header|footer|menu|sidebar|cookie|banner|modal/i;

      let best = { text: "", length: 0 };
      for (const el of elements) {
        const htmlEl = el as HTMLElement;
        const text = htmlEl.innerText || "";
        if (text.length < 200) continue;

        const tagClass = `${el.tagName} ${el.className} ${el.id}`;
        if (EXCLUDE_PATTERNS.test(tagClass)) continue;
        if (text.startsWith("An official website")) continue;

        if (text.length > best.length) {
          best = { text, length: text.length };
        }
      }
      return best.text;
    });

    if (result) {
      const { valid } = validateText(result);
      if (valid) return { text: cleanText(result), selector: "FALLBACK-largest-block" };
    }
  } catch { /* evaluation failed */ }

  return null;
}

// ── Scrape single contract ───────────────────────────────────────────────

async function scrapeSingleContract(
  page: Page,
  contract: ContractRow,
  workerId: number
): Promise<ScrapeResult | null> {
  const primaryUrl = `https://sam.gov/opp/${contract.noticeId}/view`;

  // Try primary URL
  await page.goto(primaryUrl, { timeout: 30000, waitUntil: "networkidle" });

  // Check for redirects/error pages
  const currentUrl = page.url();
  if (!currentUrl.includes(`/opp/${contract.noticeId}`)) {
    console.log(`[scrape] [worker-${workerId}] ${contract.noticeId}: redirected to ${currentUrl}`);
    return null;
  }

  let result = await trySelectors(page);
  if (result) {
    if (result.selector === "FALLBACK-largest-block") {
      console.log(`[scrape] [worker-${workerId}] ${contract.noticeId}: used FALLBACK selector (text length: ${result.text.length})`);
    }
    if (result.text.length < 50) {
      console.log(`[scrape] [worker-${workerId}] WARNING: short description for ${contract.noticeId} (${result.text.length} chars)`);
    }
    return {
      noticeId: contract.noticeId,
      descriptionText: result.text,
      descriptionLength: result.text.length,
      selectorUsed: result.selector,
      url: primaryUrl,
    };
  }

  // Try alternate URL
  const altUrl = `https://sam.gov/workspace/contract/opp/${contract.noticeId}/view`;
  try {
    await page.goto(altUrl, { timeout: 30000, waitUntil: "networkidle" });
    result = await trySelectors(page);
    if (result) {
      return {
        noticeId: contract.noticeId,
        descriptionText: result.text,
        descriptionLength: result.text.length,
        selectorUsed: `alt:${result.selector}`,
        url: altUrl,
      };
    }
  } catch { /* alternate URL failed */ }

  return null;
}

// ── Database flush ───────────────────────────────────────────────────────

function scheduleFlush(
  dryRun: boolean,
  total: number,
  dryRunResults: { noticeId: string; title: string; descriptionLength: number; first200Chars: string; selectorUsed: string; url: string }[]
): Promise<void> {
  flushChain = flushChain.then(async () => {
    if (resultsBuffer.length === 0) return;

    const toFlush = resultsBuffer;
    resultsBuffer = [];

    if (dryRun) {
      for (const r of toFlush) {
        dryRunResults.push({
          noticeId: r.noticeId,
          title: "", // filled in by caller context if needed
          descriptionLength: r.descriptionLength,
          first200Chars: r.descriptionText.slice(0, 200),
          selectorUsed: r.selectorUsed,
          url: r.url,
        });
      }
      totalFlushed += toFlush.length;
      flushCount++;
      console.log(`[scrape] buffered ${toFlush.length} dry-run results (${totalFlushed}/${total} total)`);
      return;
    }

    const CHUNK = 500;
    for (let i = 0; i < toFlush.length; i += CHUNK) {
      const chunk = toFlush.slice(i, i + CHUNK);

      const valuesList = chunk
        .map((r) => {
          const nid = r.noticeId.replace(/'/g, "''");
          const desc = r.descriptionText.replace(/'/g, "''");
          return `('${nid}', '${desc}')`;
        })
        .join(",\n  ");

      await db.execute(sql`
        UPDATE contracts SET
          description_text = v.description,
          description_fetched = true,
          updated_at = NOW()
        FROM (VALUES
          ${sql.raw(valuesList)}
        ) AS v(notice_id, description)
        WHERE contracts.notice_id = v.notice_id
      `);
    }

    totalFlushed += toFlush.length;
    flushCount++;
    console.log(`[scrape] flushed ${toFlush.length} to database (${totalFlushed}/${total} total)`);

    if (failed.length > 0) {
      writeFileSync(failuresPath, JSON.stringify(failed, null, 2));
    }
  });
  return flushChain;
}

// ── Worker ────────────────────────────────────────────────────────────────

async function runWorker(
  id: number,
  page: Page,
  queue: ContractRow[],
  context: BrowserContext,
  batchSize: number,
  dryRun: boolean,
  total: number,
  dryRunResults: { noticeId: string; title: string; descriptionLength: number; first200Chars: string; selectorUsed: string; url: string }[]
) {
  let workerCount = 0;

  while (!shutdownFlag) {
    const idx = sharedIndex++;
    if (idx >= queue.length) break;
    const contract = queue[idx];

    let result: ScrapeResult | null = null;
    let lastError = "";

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (page.isClosed()) {
          console.log(`[scrape] [worker-${id}] page crashed, creating new page`);
          page = await context.newPage();
        }
        result = await scrapeSingleContract(page, contract, id);
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);

        // Detect rate limiting
        if (lastError.includes("403") || lastError.includes("429")) {
          sharedDelayMs = Math.min(sharedDelayMs * 2, 20000);
          console.log(`[scrape] [worker-${id}] rate limited, delay increased to ${sharedDelayMs}ms`);
        }

        if (attempt < 3) {
          const backoffMs = [5000, 15000, 45000][attempt - 1];
          console.log(`[scrape] [worker-${id}] ${idx + 1}/${total}: FAILED (noticeId: ${contract.noticeId}, attempt ${attempt}/3, error: ${lastError.slice(0, 100)})`);
          await delay(backoffMs);
        }
      }
    }

    processedCount++;

    if (result) {
      if (!scrapedIds.has(result.noticeId)) {
        scrapedIds.add(result.noticeId);
        resultsBuffer.push(result);
        successCount++;
      }
      consecutiveFailures = 0;
      console.log(`[scrape] [worker-${id}] ${idx + 1}/${total}: fetched (noticeId: ${contract.noticeId}, ${result.descriptionLength} chars)`);
    } else {
      failed.push({ noticeId: contract.noticeId, error: lastError || "no valid description found" });
      consecutiveFailures++;
      console.log(`[scrape] [worker-${id}] ${idx + 1}/${total}: FAILED (noticeId: ${contract.noticeId}, error: ${(lastError || "no valid description found").slice(0, 100)})`);
    }

    // Circuit breaker
    if (consecutiveFailures >= 50) {
      console.log(`[scrape] CIRCUIT BREAKER: 50 consecutive failures — stopping all workers`);
      shutdownFlag = true;
      break;
    }
    if (consecutiveFailures >= 20 && consecutiveFailures % 20 === 0) {
      console.log(`[scrape] WARNING: ${consecutiveFailures} consecutive failures — pausing 60s`);
      await delay(60000);
    }

    // Always wait after each contract
    await delay(sharedDelayMs + Math.floor(Math.random() * 500));

    // Page recycling every 1,000 contracts
    workerCount++;
    if (workerCount % 1000 === 0) {
      await page.close();
      page = await context.newPage();
      console.log(`[scrape] [worker-${id}] recycled page after 1000 contracts`);
    }

    // Trigger flush if buffer is full
    if (resultsBuffer.length >= batchSize) {
      await scheduleFlush(dryRun, total, dryRunResults);
    }
  }
}

// ── Progress logging ─────────────────────────────────────────────────────

function startProgressLogger(total: number): NodeJS.Timeout {
  return setInterval(() => {
    const now = Date.now();
    rateWindow.push({ time: now, count: processedCount });

    // Keep only last 5 minutes
    const fiveMinAgo = now - 5 * 60 * 1000;
    while (rateWindow.length > 0 && rateWindow[0].time < fiveMinAgo) {
      rateWindow.shift();
    }

    const rate =
      rateWindow.length >= 2
        ? ((rateWindow[rateWindow.length - 1].count - rateWindow[0].count) /
            ((rateWindow[rateWindow.length - 1].time - rateWindow[0].time) / 60000))
        : 0;

    const remaining = total - processedCount;
    const etaMin = rate > 0 ? remaining / rate : 0;
    const etaH = Math.floor(etaMin / 60);
    const etaM = Math.floor(etaMin % 60);
    const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const pct = ((processedCount / total) * 100).toFixed(1);

    console.log(`\n=== Progress Update (${new Date().toLocaleTimeString()}) ===`);
    console.log(`Processed:  ${processedCount.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`);
    console.log(`Successful: ${successCount.toLocaleString()} | Failed: ${failed.length.toLocaleString()} | Rate: ${rate.toFixed(1)}/min`);
    console.log(`DB Flushes: ${flushCount} | Buffer: ${resultsBuffer.length} pending`);
    console.log(`ETA:        ${etaH}h ${etaM}m remaining`);
    console.log(`Memory:     ${mem} MB heap`);
    console.log(`Delay:      ${sharedDelayMs}ms${sharedDelayMs > 2500 ? " (throttled)" : " (normal)"}`);
    console.log(`=======================================\n`);
  }, 5 * 60 * 1000);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const { dryRun, limit, skip, concurrency, batchSize, delayMs, startFromId } = parseArgs();
  sharedDelayMs = delayMs;

  console.log(`[scrape] Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`[scrape] Concurrency: ${concurrency}, Delay: ${delayMs}ms, Batch: ${batchSize}`);
  if (limit) console.log(`[scrape] Limit: ${limit}`);
  if (skip) console.log(`[scrape] Skip: ${skip}`);
  if (startFromId) console.log(`[scrape] Start from: ${startFromId}`);

  // 1. Chromium check
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    console.error("Error: Chromium browser not found. Run this first:");
    console.error("  npx playwright install chromium");
    process.exit(1);
  }

  // 2. DB query — unfetched OR description_text is an API URL (not real text)
  const needsScrape = or(
    eq(contracts.descriptionFetched, false),
    sql`${contracts.descriptionText} LIKE 'http%'`
  )!;

  const whereConditions = [needsScrape];
  if (startFromId) {
    whereConditions.push(sql`${contracts.noticeId} >= ${startFromId}`);
  }

  const all = await db
    .select({
      noticeId: contracts.noticeId,
      title: contracts.title,
    })
    .from(contracts)
    .where(and(...whereConditions))
    .orderBy(contracts.noticeId);

  console.log(`[scrape] Found ${all.length} contracts needing descriptions`);

  let queue = all;
  if (skip > 0) queue = queue.slice(skip);
  if (limit > 0) queue = queue.slice(0, limit);

  const total = queue.length;
  console.log(`[scrape] Processing ${total} contracts with ${concurrency} workers\n`);

  if (total === 0) {
    console.log("[scrape] Nothing to process.");
    await browser.close();
    process.exit(0);
  }

  // 3. Browser context with realistic user agent
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });

  // 4. Modal/banner dismissal — best effort
  try {
    const setupPage = await context.newPage();
    await setupPage.goto("https://sam.gov", { timeout: 15000 });
    await setupPage.waitForTimeout(3000);

    const dismissSelectors = [
      'button:has-text("Accept")',
      'button:has-text("OK")',
      'button:has-text("I Agree")',
      'button:has-text("Close")',
      'button:has-text("Got it")',
      '[aria-label="Close"]',
      ".modal-close",
      ".cookie-close",
    ];
    for (const sel of dismissSelectors) {
      try {
        const btn = await setupPage.$(sel);
        if (btn) await btn.click();
      } catch { /* ignore */ }
    }
    await setupPage.keyboard.press("Escape");
    await setupPage.close();
    console.log("[scrape] Modal dismissal complete");
  } catch {
    console.log("[scrape] SAM.gov initial page load timed out — proceeding without modal dismissal");
  }

  // 5. Create worker pages
  const pages: Page[] = [];
  for (let i = 0; i < concurrency; i++) {
    pages.push(await context.newPage());
  }

  // Dry run results collector
  const dryRunResults: { noticeId: string; title: string; descriptionLength: number; first200Chars: string; selectorUsed: string; url: string }[] = [];

  const startTime = Date.now();

  // Cleanup function — flush, write outputs, print summary, THEN close browser
  async function cleanup() {
    // (a) Flush remaining buffer to DB
    await scheduleFlush(dryRun, total, dryRunResults);

    clearInterval(progressInterval);

    // (b) Write failures
    if (failed.length > 0) {
      writeFileSync(failuresPath, JSON.stringify(failed, null, 2));
      console.log(`[scrape] Failed contracts written to: ${failuresPath}`);
    }

    // (c) Write dry-run output
    if (dryRun) {
      const titleMap = new Map(queue.map((c) => [c.noticeId, c.title]));
      for (const r of dryRunResults) {
        r.title = titleMap.get(r.noticeId) || "";
      }
      const dryRunPath = resolve(__dir, "scrape-dry-run.json");
      writeFileSync(dryRunPath, JSON.stringify(dryRunResults, null, 2));
      console.log(`[scrape] Dry run results written to: ${dryRunPath}`);
    }

    // (d) Print summary
    const durationMs = Date.now() - startTime;
    const durationH = Math.floor(durationMs / 3600000);
    const durationM = Math.floor((durationMs % 3600000) / 60000);

    console.log(`\n=== Scrape Complete ===`);
    console.log(`Total processed: ${processedCount.toLocaleString()}`);
    console.log(`Successful:      ${successCount.toLocaleString()}`);
    console.log(`Failed:          ${failed.length.toLocaleString()}`);
    console.log(`DB flushes:      ${flushCount}`);
    console.log(`Duration:        ${durationH}h ${durationM}m`);
    if (processedCount > 0) {
      console.log(`Avg per page:    ${(durationMs / 1000 / processedCount).toFixed(2)}s (with ${concurrency} concurrency)`);
    }

    // (e) Close browser LAST
    await browser.close();
  }

  // Graceful shutdown — set flag, then let main flow handle cleanup
  let sigintReceived = false;
  process.on("SIGINT", () => {
    if (sigintReceived) {
      console.log("\n[scrape] Second SIGINT — force exit");
      process.exit(1);
    }
    sigintReceived = true;
    console.log("\n[scrape] SIGINT received — shutting down gracefully (waiting for workers to stop)...");
    shutdownFlag = true;
  });

  // Progress logger
  const progressInterval = startProgressLogger(total);

  // 6. Launch workers
  const workers = Array.from({ length: concurrency }, (_, i) =>
    runWorker(i, pages[i], queue, context, batchSize, dryRun, total, dryRunResults)
  );
  await Promise.all(workers);

  // Workers done (naturally or via shutdownFlag) — run cleanup
  await cleanup();
  process.exit(0);
}

main().catch((err) => {
  console.error("[scrape] Fatal error:", err);
  process.exit(1);
});
