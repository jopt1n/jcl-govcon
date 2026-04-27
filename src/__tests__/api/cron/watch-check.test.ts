import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  mockRunWatchCheck,
  mockRequireTelegramConfig,
  mockSendTelegram,
  MockTelegramConfigError,
} = vi.hoisted(() => ({
  mockRunWatchCheck: vi.fn(),
  mockRequireTelegramConfig: vi.fn(),
  mockSendTelegram: vi.fn(),
  MockTelegramConfigError: class TelegramConfigError extends Error {},
}));

vi.mock("@/lib/watch/watch-check", () => ({
  runWatchCheck: mockRunWatchCheck,
}));

vi.mock("@/lib/notifications/telegram", () => ({
  TelegramConfigError: MockTelegramConfigError,
  requireTelegramConfig: mockRequireTelegramConfig,
  sendTelegram: mockSendTelegram,
}));

import { POST } from "@/app/api/cron/watch-check/route";

const VALID_SECRET = "watch-secret";

function req(token = VALID_SECRET): NextRequest {
  return new NextRequest("http://localhost/api/cron/watch-check", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  process.env.INGEST_SECRET = VALID_SECRET;
  mockRunWatchCheck.mockReset();
  mockRequireTelegramConfig.mockReset();
  mockSendTelegram.mockReset();
});

describe("POST /api/cron/watch-check", () => {
  it("returns 401 when the bearer token is invalid", async () => {
    const res = await POST(req("wrong"));
    expect(res.status).toBe(401);
  });

  it("returns 500 when Telegram config is missing", async () => {
    mockRequireTelegramConfig.mockImplementation(() => {
      throw new MockTelegramConfigError(
        "Telegram config missing: TELEGRAM_BOT_TOKEN",
      );
    });

    const res = await POST(req());
    expect(res.status).toBe(500);
  });

  it("returns the watch-check result on success", async () => {
    mockRunWatchCheck.mockResolvedValue({
      activeTargets: 2,
      opportunitiesScanned: 120,
      matchedNotices: 3,
      eventsInserted: 2,
      notificationsSent: 2,
    });

    const res = await POST(req());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.activeTargets).toBe(2);
  });
});
