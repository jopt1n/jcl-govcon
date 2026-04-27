/**
 * Railway cron entrypoint for the weekly crawl.
 *
 * The cron service should execute the task and terminate. This script keeps
 * env loading and DB shutdown at the process boundary so the shared job can be
 * used by both Railway and the authenticated API route.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";
import type { WeeklyCrawlJobResult } from "../src/lib/cron/weekly-crawl";

type WorkerDeps = {
  runWeeklyCrawlJob: () => Promise<WeeklyCrawlJobResult>;
  closeDb: () => Promise<void>;
};

export function loadLocalEnvIfPresent(
  envPath = resolve(process.cwd(), ".env"),
): void {
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

export async function runWeeklyCrawlWorker({
  runWeeklyCrawlJob,
  closeDb,
}: WorkerDeps): Promise<0 | 1> {
  try {
    const result = await runWeeklyCrawlJob();
    console.log("[weekly-crawl-worker] finished", {
      exitCode: result.exitCode,
      status: result.body.status ?? result.body.skipped ?? result.body.error,
      runId: result.body.runId ?? null,
    });
    return result.exitCode;
  } catch (err) {
    console.error("[weekly-crawl-worker] unhandled failure:", err);
    return 1;
  } finally {
    await closeDb().catch((err) => {
      console.error("[weekly-crawl-worker] failed to close database:", err);
    });
  }
}

export async function main(): Promise<0 | 1> {
  loadLocalEnvIfPresent();

  const [{ runWeeklyCrawlJob }, { closeDb }] = await Promise.all([
    import("../src/lib/cron/weekly-crawl"),
    import("../src/lib/db"),
  ]);

  return runWeeklyCrawlWorker({ runWeeklyCrawlJob, closeDb });
}

function isDirectRun(): boolean {
  return process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false;
}

if (isDirectRun()) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((err) => {
      console.error("[weekly-crawl-worker] fatal startup failure:", err);
      process.exitCode = 1;
    });
}
