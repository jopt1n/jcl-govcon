/**
 * Test for Commit 2 (#7): weekly-digest single-query window function.
 *
 * Seeds >MAX_GOOD_SHOWN rows where the window function count(*) OVER ()
 * reports the true total, and asserts the rendered message shows the
 * "...and N more" overflow derived from (totalCount - renderedRowsLength).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  fromCallCount: 0,
  goodRowsResult: [] as Array<Record<string, unknown>>,
  maybeRowsResult: [] as Array<Record<string, unknown>>,
  runRowsResult: [] as Array<Record<string, unknown>>,
  sentMessage: null as string | null,
}));

function makeChain(resolveValue: unknown) {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => {
          Promise.resolve(resolveValue).then(resolve);
        };
      }
      return vi.fn().mockReturnValue(new Proxy({}, handler));
    },
  };
  return new Proxy({}, handler);
}

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn((...a: unknown[]) => a),
  gte: vi.fn(),
  isNull: vi.fn(),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

vi.mock("@/lib/db/schema", () => ({
  contracts: {
    id: "id",
    title: "title",
    agency: "agency",
    classification: "classification",
    createdAt: "created_at",
    awardCeiling: "award_ceiling",
    responseDeadline: "response_deadline",
    reviewedAt: "reviewed_at",
    statusChangedAt: "status_changed_at",
    status: "status",
  },
  crawlRuns: { id: "id", digestSentAt: "digest_sent_at" },
}));

vi.mock("@/lib/db", () => {
  return {
    db: {
      select: vi.fn().mockImplementation(() => {
        state.fromCallCount++;
        if (state.fromCallCount === 1) return makeChain(state.runRowsResult);
        if (state.fromCallCount === 2) return makeChain(state.goodRowsResult);
        if (state.fromCallCount === 3) return makeChain(state.maybeRowsResult);
        return makeChain([]);
      }),
      update: vi.fn().mockImplementation(() => ({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      })),
    },
  };
});

vi.mock("@/lib/notifications/telegram", () => ({
  sendTelegram: vi.fn().mockImplementation((msg: string) => {
    state.sentMessage = msg;
    return Promise.resolve();
  }),
}));

describe("sendWeeklyDigest window-function overflow", () => {
  beforeEach(() => {
    state.fromCallCount = 0;
    state.goodRowsResult = [];
    state.maybeRowsResult = [];
    state.runRowsResult = [];
    state.sentMessage = null;
    vi.resetModules();
  });

  it("renders '...and N more' based on count(*) OVER () total", async () => {
    state.runRowsResult = [
      {
        id: "run-1",
        windowStart: new Date("2026-04-07"),
        windowEnd: new Date("2026-04-14"),
        contractsFound: 50,
        digestSentAt: null,
      },
    ];
    state.goodRowsResult = Array.from({ length: 5 }, (_, i) => ({
      id: `g${i}`,
      title: `Contract ${i}`,
      agency: "DoD",
      awardCeiling: "100000",
      responseDeadline: new Date("2026-05-01"),
      totalCount: 12,
    }));
    state.maybeRowsResult = [];

    const { sendWeeklyDigest } =
      await import("@/lib/notifications/weekly-digest");
    const result = await sendWeeklyDigest("run-1");

    expect(result.good).toBe(12);
    expect(state.sentMessage).toContain("…and 7 more.");
    expect(state.sentMessage).toContain("12 new GOOD");
  });

  it("no overflow when total equals rendered", async () => {
    state.runRowsResult = [
      {
        id: "run-1",
        windowStart: new Date("2026-04-07"),
        windowEnd: new Date("2026-04-14"),
        contractsFound: 10,
        digestSentAt: null,
      },
    ];
    state.goodRowsResult = Array.from({ length: 3 }, (_, i) => ({
      id: `g${i}`,
      title: `Contract ${i}`,
      agency: "DoD",
      awardCeiling: "100000",
      responseDeadline: new Date("2026-05-01"),
      totalCount: 3,
    }));
    state.maybeRowsResult = [];

    const { sendWeeklyDigest } =
      await import("@/lib/notifications/weekly-digest");
    const result = await sendWeeklyDigest("run-1");

    expect(result.good).toBe(3);
    expect(state.sentMessage).not.toContain("more.");
  });
});
