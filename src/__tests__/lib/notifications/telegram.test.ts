import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  sendTelegram,
  TelegramConfigError,
  TelegramSendError,
} from "@/lib/notifications/telegram";

const originalFetch = global.fetch;
const originalNodeEnv = process.env.NODE_ENV;
const originalToken = process.env.TELEGRAM_BOT_TOKEN;
const originalChatId = process.env.TELEGRAM_CHAT_ID;

function mockFetchOk(payload: unknown = { ok: true, result: {} }) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function mockFetch5xxThenOk() {
  let calls = 0;
  return vi.fn().mockImplementation(async () => {
    calls++;
    if (calls < 3) {
      return new Response("server error", { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true, result: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

describe("sendTelegram", () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "fake-token";
    process.env.TELEGRAM_CHAT_ID = "12345";
    // Override the readonly NODE_ENV via assignment through process.env
    (process.env as Record<string, string>).NODE_ENV = "test";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    (process.env as Record<string, string>).NODE_ENV = originalNodeEnv ?? "";
    if (originalToken !== undefined) {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    } else {
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
    if (originalChatId !== undefined) {
      process.env.TELEGRAM_CHAT_ID = originalChatId;
    } else {
      delete process.env.TELEGRAM_CHAT_ID;
    }
  });

  it("sends a message with the correct URL and body", async () => {
    const fetchMock = mockFetchOk();
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendTelegram("hello world");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/botfake-token/sendMessage");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ chat_id: "12345", text: "hello world" });
  });

  it("applies parseMode and disableWebPagePreview options", async () => {
    const fetchMock = mockFetchOk();
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendTelegram("h", {
      parseMode: "Markdown",
      disableWebPagePreview: true,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.parse_mode).toBe("Markdown");
    expect(body.disable_web_page_preview).toBe(true);
  });

  it("retries 2x on 5xx and succeeds on the third attempt", async () => {
    const fetchMock = mockFetch5xxThenOk();
    global.fetch = fetchMock as unknown as typeof fetch;

    await sendTelegram("x");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats {ok:false} API response as a retryable-but-ultimately-fatal error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: false, description: "chat not found" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(sendTelegram("x")).rejects.toThrow(TelegramSendError);
    // Non-retryable (200 with ok:false, HTTP is 200 not 5xx) → single attempt
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws TelegramConfigError in production when env is missing", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.TELEGRAM_BOT_TOKEN;

    await expect(sendTelegram("x")).rejects.toThrow(TelegramConfigError);
  });

  it("no-ops silently in dev when env is missing", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    const fetchMock = mockFetchOk();
    global.fetch = fetchMock as unknown as typeof fetch;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(sendTelegram("x")).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("throws TelegramSendError after retries exhausted on persistent 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("down", { status: 503 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(sendTelegram("x")).rejects.toThrow(TelegramSendError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
