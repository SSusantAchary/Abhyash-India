import { NextResponse } from "next/server";
import { executeAgentTool, JourneyError } from "@/lib/journey-server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return NextResponse.json(
    { service: "abhyash-agent-tools", version: 1 },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new JourneyError("A JSON tool request is required.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32_768) {
        await reader.cancel();
        throw new JourneyError("Tool request is too large.", 413);
      }
      chunks.push(value);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new JourneyError("Invalid JSON tool request.");
    }
    const result = await executeAgentTool(
      request.headers.get("authorization"),
      body,
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof JourneyError
            ? error.message
            : "The action could not be saved. No success was confirmed.",
      },
      {
        status: error instanceof JourneyError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
