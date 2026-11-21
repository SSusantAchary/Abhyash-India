import { NextResponse } from "next/server";
import {
  authorize,
  serviceStatus,
  startSession,
  stopSession,
  sessionHistory,
  VoiceError,
} from "@/lib/voice-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  return reply(
    {
      error:
        error instanceof VoiceError
          ? error.message
          : "Voice service is temporarily unavailable. Check the server and retry.",
    },
    error instanceof VoiceError ? error.status : 503,
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("session")) {
      authorize(request);
      return reply(await sessionHistory(url.searchParams.get("session")!));
    }
    return reply(await serviceStatus());
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    authorize(request, true);
    const body = await request.json();
    if (
      body.action === "start" &&
      typeof body.language === "string" &&
      typeof body.scenario === "string"
    )
      return reply(await startSession(body.language, body.scenario));
    if (body.action === "stop" && typeof body.id === "string")
      return reply(await stopSession(body.id));
    if (body.action === "recover")
      return reply(await stopSession(undefined, true));
    throw new VoiceError("Invalid voice request.");
  } catch (error) {
    return failure(error);
  }
}
