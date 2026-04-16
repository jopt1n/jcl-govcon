/**
 * Test for weekly-digest: count-only Telegram message.
 *
 * Verifies the digest renders GOOD/MAYBE/DISCARD totals and
 * triage activity without listing individual contracts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  fromCallCount: 0,
  sentMessage: null as string | null,
  queryResults: [] as Array<unknown>,
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
        const result = state.queryResults[state.fromCallCount] ?? [];
        state.fromCallCount++;
        return makeChain(result);
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

describe("sendWeeklyDigest", () => {
  beforeEach(() => {
    state.fromCallCount = 0;
    state.queryResults = [];
    state.sentMessage = null;
    vi.resetModules();
  });

  it("renders count-only summary with GOOD/MAYBE/DISCARD totals", async () => {
    state.queryResults = [
      // 1: crawl_runs row
      [
        {
          id: "run-1",
          windowStart: new Date("2026-04-07"),
          windowEnd: new Date("2026-04-14"),
          contractsFound: 500,
          digestSentAt: null,
        },
      ],
      // 2: GOOD count
      [{ count: 12 }],
      // 3: MAYBE count
      [{ count: 5 }],
      // 4: DISCARD count
      [{ count: 483 }],
      // 5: triaged rows
      [],
      // 6: transition rows
      [],
    ];

    const { sendWeeklyDigest } =
      await import("@/lib/notifications/weekly-digest");
    const result = await sendWeeklyDigest("run-1");

    expect(result.good).toBe(12);
    expect(result.maybe).toBe(5);
    expect(state.sentMessage).toContain("12 GOOD");
    expect(state.sentMessage).toContain("5 MAYBE");
    expect(state.sentMessage).toContain("483 DISCARD");
    expect(state.sentMessage).toContain("500 crawled from SAM.gov");
    expect(state.sentMessage).not.toContain("top");
  });

  it("includes triage activity when present", async () => {
    state.queryResults = [
      [
        {
          id: "run-1",
          windowStart: new Date("2026-04-07"),
          windowEnd: new Date("2026-04-14"),
          contractsFound: 100,
          digestSentAt: null,
        },
      ],
      [{ count: 3 }],
      [{ count: 2 }],
      [{ count: 95 }],
      // triaged rows
      [{ id: "c1" }, { id: "c2" }],
      // transition rows
      [
        { status: "PURSUING" },
        { status: "PURSUING" },
        { status: "BID_SUBMITTED" },
      ],
    ];

    const { sendWeeklyDigest } =
      await import("@/lib/notifications/weekly-digest");
    const result = await sendWeeklyDigest("run-1");

    expect(result.triaged).toBe(2);
    expect(result.transitions).toEqual({ PURSUING: 2, BID_SUBMITTED: 1 });
    expect(state.sentMessage).toContain("2 triaged");
    expect(state.sentMessage).toContain("2 → pursuing");
    expect(state.sentMessage).toContain("1 → bid submitted");
  });
});
