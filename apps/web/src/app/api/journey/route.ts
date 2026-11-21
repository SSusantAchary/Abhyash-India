import { NextRequest, NextResponse } from "next/server";
import { authorize, VoiceError } from "@/lib/voice-server";
import {
  calendarForRun,
  getJourney,
  JourneyError,
  newLearnerId,
  prepareJourney,
  resolveReview,
  updateTask,
  validLearnerId,
} from "@/lib/journey-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const LEARNER_COOKIE = "abhyash-learner";
function identity(request: NextRequest) {
  const existing = request.cookies.get(LEARNER_COOKIE)?.value;
  return validLearnerId(existing) ? existing : newLearnerId();
}
function reply(data: unknown, id: string, secure = false) {
  const response = NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
  response.cookies.set(LEARNER_COOKIE, id, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: 90 * 86400,
  });
  return response;
}
function failure(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof JourneyError || error instanceof VoiceError
          ? error.message
          : "Practice storage is temporarily unavailable.",
    },
    {
      status:
        error instanceof JourneyError || error instanceof VoiceError
          ? error.status
          : 503,
    },
  );
}
export async function GET(request: NextRequest) {
  try {
    authorize(request);
    const id = identity(request),
      calendar = request.nextUrl.searchParams.get("calendar");
    if (calendar)
      return new NextResponse(await calendarForRun(id, calendar), {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": 'attachment; filename="abhyash-practice.ics"',
          "Cache-Control": "no-store",
        },
      });
    return reply(
      await getJourney(id),
      id,
      request.nextUrl.protocol === "https:",
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    authorize(request, true);
    if (Number(request.headers.get("content-length")) > 20_000)
      throw new JourneyError("Practice request is too large.", 413);
    const body = await request.json(),
      id = identity(request);
    if (body.action === "prepare")
      return reply(
        await prepareJourney(id, body.profile, body.scenario, body.language),
        id,
        request.nextUrl.protocol === "https:",
      );
    if (
      body.action === "task" &&
      typeof body.runId === "string" &&
      typeof body.taskId === "string" &&
      typeof body.completed === "boolean"
    )
      return reply(
        await updateTask(id, body.runId, body.taskId, body.completed),
        id,
        request.nextUrl.protocol === "https:",
      );
    if (body.action === "resolveReview" && typeof body.runId === "string")
      return reply(
        await resolveReview(id, body.runId, body.resolution),
        id,
        request.nextUrl.protocol === "https:",
      );
    throw new JourneyError("Unknown practice action.");
  } catch (error) {
    return failure(error);
  }
}
