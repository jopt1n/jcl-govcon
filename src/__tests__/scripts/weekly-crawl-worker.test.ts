import { describe, it, expect, vi } from "vitest";
import { runWeeklyCrawlWorker } from "../../../scripts/weekly-crawl-worker";

describe("weekly-crawl-worker", () => {
  it("returns exit 0 and closes the DB on successful job results", async () => {
    const closeDb = vi.fn().mockResolvedValue(undefined);
    const runWeeklyCrawlJob = vi.fn().mockResolvedValue({
      httpStatus: 200,
      exitCode: 0,
      body: { ok: true, status: "classifying", runId: "run-1" },
    });

    await expect(
      runWeeklyCrawlWorker({ runWeeklyCrawlJob, closeDb }),
    ).resolves.toBe(0);

    expect(runWeeklyCrawlJob).toHaveBeenCalledOnce();
    expect(closeDb).toHaveBeenCalledOnce();
  });

  it("returns exit 1 and closes the DB on failed job results", async () => {
    const closeDb = vi.fn().mockResolvedValue(undefined);
    const runWeeklyCrawlJob = vi.fn().mockResolvedValue({
      httpStatus: 500,
      exitCode: 1,
      body: { error: "Crawl failed", runId: "run-1" },
    });

    await expect(
      runWeeklyCrawlWorker({ runWeeklyCrawlJob, closeDb }),
    ).resolves.toBe(1);

    expect(closeDb).toHaveBeenCalledOnce();
  });

  it("returns exit 1 and closes the DB on unhandled errors", async () => {
    const closeDb = vi.fn().mockResolvedValue(undefined);
    const runWeeklyCrawlJob = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(
      runWeeklyCrawlWorker({ runWeeklyCrawlJob, closeDb }),
    ).resolves.toBe(1);

    expect(closeDb).toHaveBeenCalledOnce();
  });
});
