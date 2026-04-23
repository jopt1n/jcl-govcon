import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import {
  TelegramConfigError,
  requireTelegramConfig,
  sendTelegram,
} from "@/lib/notifications/telegram";
import { runWatchCheck } from "@/lib/watch/watch-check";

type CronLog = {
  kind: "watch-check";
  step: string;
  status: "ok" | "error";
  durationMs: number;
  data?: Record<string, unknown>;
  error?: string;
};

function log(entry: CronLog): void {
  console.log(JSON.stringify(entry));
}

async function alert(message: string): Promise<void> {
  try {
    await sendTelegram(`⚠️ JCL GovCon watch-check alert\n${message}`);
  } catch (err) {
    console.error("[watch-check] Failed to send Telegram alert:", err);
  }
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    requireTelegramConfig();
  } catch (err) {
    if (err instanceof TelegramConfigError) {
      log({
        kind: "watch-check",
        step: "telegram_config",
        status: "error",
        durationMs: 0,
        error: err.message,
      });
      return NextResponse.json(
        { error: "Telegram config missing", message: err.message },
        { status: 500 },
      );
    }
    throw err;
  }

  const startedAt = Date.now();

  try {
    const result = await runWatchCheck();
    log({
      kind: "watch-check",
      step: "done",
      status: "ok",
      durationMs: Date.now() - startedAt,
      data: result,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({
      kind: "watch-check",
      step: "run",
      status: "error",
      durationMs: Date.now() - startedAt,
      error: message,
    });
    await alert(message);
    return NextResponse.json(
      { error: "Watch check failed", message },
      { status: 500 },
    );
  }
}
