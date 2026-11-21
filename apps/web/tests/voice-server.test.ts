// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  agentConfiguration,
  authorize,
  LIMIT_SECONDS,
  missingCredentials,
  reserve,
  serviceStatus,
  sessionHistory,
  startSession,
  stopSession,
  withLedger,
} from "../src/lib/voice-server";

let directory: string;
let upstream: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "abhyash-test-"));
  vi.stubEnv("ABHYASH_DATA_DIR", directory);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AGORA_APP_ID", "a".repeat(32));
  vi.stubEnv("AGORA_APP_CERTIFICATE", "b".repeat(32));
  vi.stubEnv("AGORA_CUSTOMER_ID", "test-customer");
  vi.stubEnv("AGORA_CUSTOMER_SECRET", "test-secret");
  vi.stubEnv("MURF_API_KEY", "test-murf-key");
  vi.stubEnv("ABHYASH_ACCESS_CODE", "");
  vi.stubEnv("LLM_API_KEY", "");
  upstream = vi
    .fn()
    .mockImplementation(async (url: string) =>
      Response.json(url.endsWith("/join") ? { agent_id: "test-agent" } : {}),
    );
  vi.stubGlobal("fetch", upstream);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("live integration and cost controls", () => {
  it("uses the chosen Indian locale for ASR and Murf and scenario-specific coaching", () => {
    const config = agentConfiguration(
      "channel",
      "token",
      100,
      "kn-IN",
      "interview",
    );
    expect(config.properties.asr.language).toBe("kn-IN");
    expect(config.properties.asr).not.toHaveProperty("credential_mode");
    expect(config.properties.tts.params).toMatchObject({
      voiceId: "Pooja",
      locale: "kn-IN",
      api_key: "test-murf-key",
      model: "falcon-2.1",
    });
    expect(config.properties.llm.system_messages[0].content).toContain("STAR");
    expect(config.properties.llm.credential_mode).toBe("managed");
    expect(() =>
      agentConfiguration("channel", "token", 100, "invalid", "interview"),
    ).toThrow("supported language");
  });
  it("rejects missing credentials without spending or calling Agora", async () => {
    vi.stubEnv("AGORA_APP_ID", "");
    await expect(startSession("en-IN", "interview")).rejects.toThrow(
      "needs server credentials",
    );
    expect(upstream).not.toHaveBeenCalled();
    expect((await serviceStatus()).reservedSeconds).toBe(0);
  });
  it("does not reserve time for invalid practice options", async () => {
    await expect(startSession("invalid", "interview")).rejects.toThrow(
      "supported language",
    );
    expect((await serviceStatus()).reservedSeconds).toBe(0);
  });
  it("persists reservations, allows only one agent, and verifies ownership", async () => {
    const session = await startSession("hi-IN", "everyday");
    expect(session.token.startsWith("007")).toBe(true);
    expect(JSON.stringify(session)).not.toContain("test-murf-key");
    expect((await serviceStatus()).reservedSeconds).toBe(300);
    await expect(startSession("en-IN", "interview")).rejects.toThrow(
      "already active",
    );
    await expect(stopSession("another-browser")).rejects.toThrow(
      "does not belong",
    );
    await stopSession(session.id);
    expect(
      JSON.parse(await readFile(path.join(directory, "usage.json"), "utf8")),
    ).toEqual({ version: 1, reservedSeconds: 300 });
    expect((await serviceStatus()).active).toBe(false);
  });
  it("blocks the eleventh reservation at 50 minutes, including early stops", async () => {
    for (let i = 0; i < 10; i++) {
      const session = await startSession("en-IN", "interview");
      await stopSession(session.id);
    }
    expect((await serviceStatus()).reservedSeconds).toBe(LIMIT_SECONDS);
    await expect(startSession("en-IN", "interview")).rejects.toMatchObject({
      status: 429,
    });
    expect(
      upstream.mock.calls.filter(([url]) => url.endsWith("/join")),
    ).toHaveLength(10);
  });
  it("holds the reservation and blocks spending after an ambiguous startup", async () => {
    upstream.mockRejectedValue(new Error("upstream leaked test-secret"));
    await expect(startSession("en-IN", "interview")).rejects.toThrow(
      "could not be confirmed",
    );
    const status = await serviceStatus();
    expect(status).toMatchObject({
      recoveryRequired: true,
      reservedSeconds: 300,
      active: true,
    });
    expect(JSON.stringify(status)).not.toContain("test-secret");
    await expect(startSession("en-IN", "interview")).rejects.toThrow(
      "already active",
    );
  });
  it("shows redacted validation errors and releases an unstarted reservation", async () => {
    upstream.mockImplementation(async () =>
      Response.json(
        {
          detail:
            "Invalid properties.asr.vendor with credential test-murf-key and secret test-secret",
        },
        { status: 400 },
      ),
    );
    await expect(startSession("en-IN", "interview")).rejects.toThrow(
      "Invalid properties.asr.vendor",
    );
    const status = await serviceStatus();
    expect(status).toMatchObject({
      reservedSeconds: 0,
      active: false,
      recoveryRequired: false,
    });
    await expect(startSession("en-IN", "interview")).rejects.not.toThrow(
      "test-murf-key",
    );
    await expect(startSession("en-IN", "interview")).rejects.not.toThrow(
      "test-secret",
    );
  });
  it("keeps a reservation and active block for an ambiguous upstream server failure", async () => {
    upstream.mockImplementation(async () =>
      Response.json({ detail: "Temporary failure" }, { status: 500 }),
    );
    await expect(startSession("en-IN", "interview")).rejects.toThrow(
      "could not be confirmed",
    );
    expect(await serviceStatus()).toMatchObject({
      reservedSeconds: 300,
      active: true,
    });
  });
  it("recovers an empty channel after the ambiguity grace period while keeping prior reservations", async () => {
    upstream.mockRejectedValueOnce(new Error("timeout"));
    await expect(startSession("en-IN", "interview")).rejects.toThrow();
    upstream.mockImplementation(async () =>
      Response.json({ data: { list: [] }, meta: { total: 0 } }),
    );
    await expect(stopSession(undefined, true)).rejects.toMatchObject({
      status: 409,
    });
    await withLedger(async (ledger, save) => {
      ledger.active!.deadline = Date.now() + 240_000 - 61_000;
      await save();
    });
    await stopSession(undefined, true);
    expect(await serviceStatus()).toMatchObject({
      reservedSeconds: 300,
      active: false,
    });
  });
  it("does not clear active state when stopping cannot be confirmed", async () => {
    const session = await startSession("en-IN", "interview");
    upstream.mockResolvedValue(
      new Response("submitted-secret", { status: 500 }),
    );
    await expect(stopSession(session.id)).rejects.toThrow(
      "Agora request failed (500)",
    );
    expect((await serviceStatus()).active).toBe(true);
  });
  it("recovers timed-out starts using only the server's unique channel", async () => {
    upstream.mockRejectedValueOnce(new Error("timeout"));
    await expect(startSession("en-IN", "interview")).rejects.toThrow();
    upstream.mockImplementation(async (url: string) =>
      Response.json(
        url.includes("/agents?")
          ? {
              data: { list: [{ agent_id: "recovered-id", status: "RUNNING" }] },
            }
          : {},
      ),
    );
    await stopSession(undefined, true);
    expect(
      upstream.mock.calls.some(([url]) => url.includes("channel=abhyash_")),
    ).toBe(true);
    expect(
      upstream.mock.calls.some(([url]) =>
        url.endsWith("/agents/recovered-id/leave"),
      ),
    ).toBe(true);
    expect((await serviceStatus()).active).toBe(false);
  });
  it("serializes reservations across concurrent workers", async () => {
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let acquired!: () => void;
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const first = withLedger(async (ledger) => {
      acquired();
      await blocked;
      reserve(ledger);
    });
    await ready;
    await expect(withLedger(async () => {})).rejects.toMatchObject({
      status: 409,
    });
    finish();
    await first;
  });
  it.each(["localhost:3100", "127.0.0.1:3100"])(
    "accepts the browser's actual host %s when Next uses an internal hostname",
    (host) => {
      expect(() =>
        authorize(
          new Request("http://localhost:3100/api/voice", {
            headers: { host, origin: `http://${host}` },
          }),
          true,
        ),
      ).not.toThrow();
    },
  );
  it.each([
    "https://other.site",
    "http://127.0.0.1:3101",
    "https://127.0.0.1:3100",
    "http://localhost:3100",
    "null",
    "",
  ])("rejects a mismatched or missing origin %s", (origin) => {
    expect(() =>
      authorize(
        new Request("http://localhost:3100/api/voice", {
          headers: { host: "127.0.0.1:3100", ...(origin ? { origin } : {}) },
        }),
        true,
      ),
    ).toThrow("origin");
  });
  it("enforces same-origin writes and production access codes", () => {
    expect(() =>
      authorize(
        new Request("http://localhost:3100/api/voice", {
          headers: { origin: "https://other.site" },
        }),
        true,
      ),
    ).toThrow("origin");
    vi.stubEnv("NODE_ENV", "production");
    expect(missingCredentials()).toContain("ABHYASH_ACCESS_CODE");
    vi.stubEnv("ABHYASH_ACCESS_CODE", "demo-secret");
    expect(() =>
      authorize(new Request("http://localhost:3100/api/voice")),
    ).toThrow("access code");
    expect(() =>
      authorize(
        new Request("http://localhost:3100/api/voice", {
          headers: {
            "x-abhyash-code": "demo-secret",
            origin: "http://localhost:3100",
          },
        }),
        true,
      ),
    ).not.toThrow();
  });
  it("only exposes conversation lines for the active browser session", async () => {
    const session = await startSession("en-IN", "interview");
    upstream.mockResolvedValue(
      Response.json({
        contents: [
          { role: "assistant", content: "Hello!", secret: "hidden" },
          { role: "system", content: "private" },
        ],
      }),
    );
    expect(await sessionHistory(session.id)).toEqual({
      contents: [{ role: "assistant", content: "Hello!" }],
    });
    await expect(sessionHistory("wrong-id")).rejects.toMatchObject({
      status: 410,
    });
  });
});
