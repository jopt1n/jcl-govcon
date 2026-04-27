import { describe, it, expect } from "vitest";
import packageJson from "../../../package.json";
import weeklyCrawlConfig from "../../../railway.weekly-crawl.json";
import checkBatchesConfig from "../../../railway.check-batches.json";

describe("Railway weekly crawl config", () => {
  it("runs the Node worker on the Friday 15:00 UTC schedule", () => {
    expect(weeklyCrawlConfig.build.builder).toBe("RAILPACK");
    expect(weeklyCrawlConfig.deploy.startCommand).toBe(
      "npm run cron:weekly-crawl",
    );
    expect(packageJson.scripts["cron:weekly-crawl"]).toBe(
      "tsx scripts/weekly-crawl-worker.ts",
    );
    expect(packageJson.dependencies.tsx).toBeDefined();
    expect(weeklyCrawlConfig.deploy.cronSchedule).toBe("0 15 * * 5");
    expect(weeklyCrawlConfig.deploy.restartPolicyType).toBe("NEVER");
  });

  it("does not change the check-batches curl cron", () => {
    expect(checkBatchesConfig.deploy.startCommand).toContain(
      "/api/cron/check-batches",
    );
    expect(checkBatchesConfig.deploy.cronSchedule).toBe("*/30 * * * *");
  });
});
