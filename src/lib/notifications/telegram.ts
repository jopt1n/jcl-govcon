/**
 * Telegram Bot API client.
 *
 * Single purpose: send a text message to a hardcoded chat ID via the bot
 * token in env. No SDK, no state, no chat_id discovery — the bot is
 * single-user (you) and the chat ID is provisioned manually via @BotFather
 * (see plan's "Telegram bot prerequisite" section).
 *
 * Behavior on missing env:
 *   NODE_ENV === "production" → throws TelegramConfigError. Cron handlers
 *     catch this and mark the crawl_runs row status="failed",
 *     errorStep="telegram_config". You see the failure on /admin/crawl-runs
 *     within minutes instead of discovering a silent outage next Sunday.
 *
 *   NODE_ENV !== "production" → console.warn and no-op. Local dev and the
 *     test suite can run without bot setup.
 *
 * Retries: 2x exponential backoff on 5xx or network error. `{ ok: false }`
 * from Telegram's API (they wrap errors in a 200 OK) is treated as an
 * error and retried.
 */

const API_BASE = "https://api.telegram.org";
const MAX_RETRIES = 3; // 1 initial + 2 retries
const BACKOFF_BASE_MS = 1_000;
const FETCH_TIMEOUT_MS = 10_000;

export class TelegramConfigError extends Error {
  constructor(missing: string) {
    super(
      `Telegram config missing: ${missing}. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in the environment.`,
    );
    this.name = "TelegramConfigError";
  }
}

export class TelegramSendError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TelegramSendError";
  }
}

export type SendOptions = {
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  /** Disable link previews in the message. Default: false. */
  disableWebPagePreview?: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Read Telegram config from env. Single source of truth for the env read +
 * prod-vs-dev branching. In prod, throws TelegramConfigError if either var
 * is missing. In dev/test, warns and returns null (callers treat null as a
 * no-op).
 *
 * NODE_ENV is read per-call so tests that mutate process.env.NODE_ENV inside
 * the test process affect subsequent calls.
 */
export function readTelegramConfig(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (token && chatId) {
    return { token, chatId };
  }

  const missing =
    !token && !chatId
      ? "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID"
      : !token
        ? "TELEGRAM_BOT_TOKEN"
        : "TELEGRAM_CHAT_ID";

  if (isProd()) {
    throw new TelegramConfigError(missing);
  }
  console.warn(`[telegram] ${missing} not set. Skipping (dev/test mode).`);
  return null;
}

/**
 * Preflight check for cron routes. Throws TelegramConfigError in prod when
 * config is missing; no-ops in dev/test. Call this at the top of a cron
 * route (after authorize) so the route fails loudly before doing any work
 * rather than halfway through on the alert/digest path.
 */
export function requireTelegramConfig(): void {
  readTelegramConfig();
}

/**
 * Send a text message to the configured Telegram chat.
 *
 * In production, throws if env is missing or the API is unreachable after
 * retries. In dev/test, missing env is a no-op (warn only); API failures
 * still throw so tests can assert them.
 *
 * The caller is responsible for keeping messages under Telegram's 4096-char
 * limit. Longer messages will be rejected by the API.
 */
export async function sendTelegram(
  text: string,
  opts: SendOptions = {},
): Promise<void> {
  const config = readTelegramConfig();
  if (!config) {
    // dev/test mode with missing config — readTelegramConfig warned
    console.warn(`[telegram] Skipping send. Text: ${text.slice(0, 80)}...`);
    return;
  }
  const { token, chatId } = config;

  const url = `${API_BASE}/bot${token}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
  };
  if (opts.parseMode) body.parse_mode = opts.parseMode;
  if (opts.disableWebPagePreview) body.disable_web_page_preview = true;

  // Structure: do the fetch inside a try for network errors only. HTTP
  // response handling (retryable vs non-retryable) happens outside the
  // try so we can throw non-retryable errors without the catch
  // misinterpreting them as network errors.
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let res: Response | null = null;
    let networkErr: unknown = null;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      networkErr = err;
    }

    if (networkErr) {
      const msg =
        networkErr instanceof Error
          ? `${networkErr.name}: ${networkErr.message}`
          : String(networkErr);
      if (attempt < MAX_RETRIES) {
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(
          `[telegram] Network error (${msg}), attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay}ms`,
        );
        await sleep(delay);
        lastError = networkErr;
        continue;
      }
      throw new TelegramSendError(
        `Telegram send failed after ${MAX_RETRIES} attempts: ${msg}`,
        networkErr,
      );
    }

    // Parse the response. Non-JSON is treated as an empty payload so the
    // ok-field check below catches it.
    let payload: { ok?: boolean; description?: string } = {};
    try {
      payload = await res!.json();
    } catch {
      // leave payload empty
    }

    if (res!.ok && payload.ok === true) {
      return; // success
    }

    const description = payload.description ?? `HTTP ${res!.status}`;
    const retryable = res!.status >= 500 || res!.status === 429;

    if (retryable && attempt < MAX_RETRIES) {
      const delay = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[telegram] Send failed (${description}), attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay}ms`,
      );
      await sleep(delay);
      lastError = new TelegramSendError(description);
      continue;
    }

    // Non-retryable (400/401/403/200 with ok:false) OR out of retries.
    throw new TelegramSendError(`Telegram send failed: ${description}`);
  }

  // Should be unreachable due to throws above, but TS wants it
  throw new TelegramSendError(
    `Telegram send failed after ${MAX_RETRIES} attempts`,
    lastError,
  );
}
