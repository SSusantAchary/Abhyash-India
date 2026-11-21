import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { RtcTokenBuilder, RtcRole } from "agora-token";
import { languages, scenarios } from "./abhyash";
import {
  beginJourney,
  toolsBaseUrl,
  updateJourneyVoice,
  type AgentWorkflow,
} from "./journey-server";
import { coachingTools, agentWorkflowInstructions } from "./agent-tools";

// Reserve five whole minutes, including up to 30 seconds for startup/cleanup.
export const LIMIT_SECONDS = 50 * 60;
export const RESERVATION_SECONDS = 5 * 60;
export const SESSION_SECONDS = 4 * 60;
type Active = {
  id: string;
  channel: string;
  agentId?: string;
  deadline: number;
  state: "starting" | "running" | "uncertain";
};
type Ledger = { version: 1; reservedSeconds: number; active?: Active };
const dataDir = () =>
  process.env.ABHYASH_DATA_DIR || path.join(process.cwd(), ".abhyash");
const required = [
  "AGORA_APP_ID",
  "AGORA_APP_CERTIFICATE",
  "AGORA_CUSTOMER_ID",
  "AGORA_CUSTOMER_SECRET",
  "MURF_API_KEY",
];

export class VoiceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export class AgoraRequestError extends VoiceError {
  constructor(
    public upstreamStatus: number,
    detail: string,
  ) {
    super(`Agora request failed (${upstreamStatus}). ${detail}`, 502);
  }
  get definitelyRejected() {
    return [400, 401, 403, 404, 422].includes(this.upstreamStatus);
  }
}

function safeProviderDetail(value: unknown) {
  if (typeof value !== "string")
    return "Check project credentials, enabled models, and the Agora console.";
  let detail = value;
  for (const [name, secret] of Object.entries(process.env)) {
    if (secret && /KEY|SECRET|CERTIFICATE|TOKEN/.test(name))
      detail = detail.split(secret).join("[redacted]");
  }
  return detail.replace(/007[A-Za-z0-9+/=]{30,}/g, "[rtc-token]").slice(0, 600);
}
export function missingCredentials() {
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (process.env.NODE_ENV === "production" && !process.env.ABHYASH_ACCESS_CODE)
    missing.push("ABHYASH_ACCESS_CODE");
  return missing;
}
export function authorize(request: Request, mutation = false) {
  if (mutation) {
    // Next.js can reconstruct request.url with its internal bind hostname.
    // The incoming Host header retains the address actually used by the browser.
    const target = new URL(request.url);
    const host = request.headers.get("host") || target.host;
    let allowed = false;
    try {
      const expected = new URL(`${target.protocol}//${host}`);
      allowed =
        expected.host === host.toLowerCase() &&
        request.headers.get("origin") === expected.origin;
    } catch {
      // Missing or malformed origins/hosts fail closed.
    }
    if (!allowed) throw new VoiceError("Request origin is not allowed.", 403);
  }
  const secret = process.env.ABHYASH_ACCESS_CODE;
  if (secret) {
    const supplied = request.headers.get("x-abhyash-code") || "";
    const a = Buffer.from(secret),
      b = Buffer.from(supplied);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      throw new VoiceError("Enter the demo access code to continue.", 401);
  } else if (process.env.NODE_ENV === "production") {
    throw new VoiceError(
      "Set ABHYASH_ACCESS_CODE on the server before enabling live practice.",
      503,
    );
  }
}

// Exclusive filesystem lock serializes reservations across Node workers. A stale
// lock fails closed: an operator must first verify no agent is still running.
export async function withLedger<T>(
  work: (ledger: Ledger, save: () => Promise<void>) => Promise<T>,
): Promise<T> {
  await mkdir(dataDir(), { recursive: true, mode: 0o700 });
  const file = path.join(dataDir(), "usage.json");
  const lockPath = path.join(dataDir(), "usage.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch {
    throw new VoiceError(
      "Another session operation is in progress. Retry shortly. If this persists after a restart, see the recovery guide.",
      409,
    );
  }
  try {
    let ledger: Ledger;
    try {
      ledger = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new VoiceError(
          "Usage ledger cannot be read. Live practice is locked for safety.",
          503,
        );
      ledger = { version: 1, reservedSeconds: 0 };
    }
    if (
      ledger.version !== 1 ||
      !Number.isFinite(ledger.reservedSeconds) ||
      ledger.reservedSeconds < 0 ||
      ledger.reservedSeconds > LIMIT_SECONDS
    )
      throw new VoiceError(
        "Invalid usage ledger. Live practice is locked.",
        503,
      );
    const save = async () => {
      const tmp = file + ".tmp";
      await open(tmp, "w", 0o600).then(async (handle) => {
        try {
          await handle.writeFile(JSON.stringify(ledger));
          await handle.sync();
        } finally {
          await handle.close();
        }
      });
      await rename(tmp, file);
    };
    return await work(ledger, save);
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

export function reserve(ledger: Ledger) {
  if (ledger.active)
    throw new VoiceError(
      "A practice session is already active. End or recover it before starting another.",
      409,
    );
  if (ledger.reservedSeconds + RESERVATION_SECONDS > LIMIT_SECONDS)
    throw new VoiceError(
      "The 50-minute hackathon test allowance has been used.",
      429,
    );
  ledger.reservedSeconds += RESERVATION_SECONDS;
}

export async function agoraRequest(endpoint: string, body?: unknown) {
  const auth = Buffer.from(
    `${process.env.AGORA_CUSTOMER_ID}:${process.env.AGORA_CUSTOMER_SECRET}`,
  ).toString("base64");
  const response = await fetch(
    `https://api.agora.io/api/conversational-ai-agent/v2/projects/${process.env.AGORA_APP_ID}${endpoint}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(18000),
      cache: "no-store",
    },
  );
  if (!response.ok) {
    // Relay only a bounded, redacted diagnostic field, never the raw request/body.
    const error = await response.json().catch(() => null);
    throw new AgoraRequestError(
      response.status,
      safeProviderDetail(error?.detail || error?.message || error?.reason),
    );
  }
  return response.json();
}

export function agentConfiguration(
  channel: string,
  agentToken: string,
  uid: number,
  languageId: string,
  scenarioId: string,
  workflow?: AgentWorkflow,
) {
  const language = languages.find((item) => item.id === languageId);
  const scenario = scenarios.find((item) => item.id === scenarioId);
  if (!language || !scenario)
    throw new VoiceError("Choose a supported language and practice scenario.");
  return {
    name: channel,
    properties: {
      channel,
      token: agentToken,
      agent_rtc_uid: "1",
      remote_rtc_uids: [String(uid)],
      enable_string_uid: false,
      idle_timeout: 10,
      ...(workflow ? { advanced_features: { enable_tools: true } } : {}),
      asr: {
        vendor: "ares",
        language: language.asr,
      },
      llm: {
        ...(workflow
          ? {
              tools: coachingTools(workflow),
              template_variables: {
                coaching_capability: `Bearer ${workflow.capability}`,
              },
            }
          : {}),
        credential_mode: process.env.LLM_API_KEY ? "byok" : "managed",
        vendor: "openai",
        style: "openai",
        url:
          process.env.LLM_BASE_URL ||
          "https://api.openai.com/v1/chat/completions",
        ...(process.env.LLM_API_KEY
          ? { api_key: process.env.LLM_API_KEY }
          : {}),
        system_messages: [
          {
            role: "system",
            content: `You are Abhyash, a patient voice practice coach for India. Speak in ${language.name}. Understand English code-switching, but follow the selected language. ${scenario.prompt} Keep turns to two or three short sentences. Ask one question at a time. After each answer, give one concrete, kind correction and a natural example. Never invent scores or claim to measure eye contact or pronunciation from text. At the end offer a three-step practice plan. Do not include markdown; your words are spoken aloud. ${workflow ? agentWorkflowInstructions + "\nLearner preparation: " + JSON.stringify(workflow.context) : ""}`,
          },
        ],
        greeting_message:
          language.id === "hi-IN"
            ? "नमस्ते! मैं अभ्यास हूँ। आज आप किस चीज़ की तैयारी करना चाहते हैं?"
            : language.id === "kn-IN"
              ? "ನಮಸ್ಕಾರ! ನಾನು ಅಭ್ಯಾಸ. ಇಂದು ನೀವು ಏನನ್ನು ಅಭ್ಯಾಸ ಮಾಡಲು ಬಯಸುತ್ತೀರಿ?"
              : "Hi, I'm Abhyash, your practice partner. What would you like to work on today?",
        failure_message: "Could you say that again?",
        max_history: 24,
        params: {
          model: process.env.LLM_MODEL || "gpt-4o-mini",
          max_tokens: 250,
        },
      },
      tts: {
        vendor: "murf",
        params: {
          api_key: process.env.MURF_API_KEY,
          base_url: "wss://global.api.murf.ai/v1/speech/stream-input",
          voiceId: language.voice,
          locale: language.id,
          model: "falcon-2.1",
          sample_rate: 24000,
          rate: 0,
          pitch: 0,
        },
      },
    },
  };
}

export async function startSession(
  language: string,
  scenario: string,
  journey?: { learnerId: string; runId: string },
) {
  if (missingCredentials().length)
    throw new VoiceError(
      "Live practice needs server credentials. Open Connection setup for the missing settings.",
      503,
    );
  // Validate before reserving any allowance.
  agentConfiguration("validate", "", 2, language, scenario);
  return withLedger(async (ledger, save) => {
    reserve(ledger);
    const id = randomBytes(24).toString("hex");
    const workflow = journey
      ? await beginJourney(
          journey.learnerId,
          journey.runId,
          id,
          scenario,
          language,
        )
      : undefined;
    const channel = `abhyash_${randomBytes(12).toString("hex")}`;
    const uid = randomInt(100, 2147483647);
    const appId = process.env.AGORA_APP_ID!,
      certificate = process.env.AGORA_APP_CERTIFICATE!;
    const token = (user: number) =>
      RtcTokenBuilder.buildTokenWithUid(
        appId,
        certificate,
        channel,
        user,
        RtcRole.PUBLISHER,
        SESSION_SECONDS + 20,
        SESSION_SECONDS + 20,
      );
    const agentToken = token(1),
      clientToken = token(uid);
    ledger.active = {
      id,
      channel,
      deadline: Date.now() + SESSION_SECONDS * 1000,
      state: "starting",
    };
    await save(); // Persist the reservation before any billable operation.
    try {
      const result = await agoraRequest(
        "/join",
        agentConfiguration(
          channel,
          agentToken,
          uid,
          language,
          scenario,
          workflow,
        ),
      );
      if (typeof result.agent_id !== "string" || !result.agent_id)
        throw new Error("No agent ID");
      ledger.active.agentId = result.agent_id;
      ledger.active.state = "running";
      await save();
      const stopWithRetry = async () => {
        try {
          await stopSession(id);
        } catch (error) {
          if (error instanceof VoiceError && error.status === 403) return;
          const retry = setTimeout(stopWithRetry, 5000);
          retry.unref();
        }
      };
      const timer = setTimeout(
        stopWithRetry,
        Math.max(0, ledger.active.deadline - Date.now()),
      );
      timer.unref();
      return {
        id,
        appId,
        channel,
        uid,
        token: clientToken,
        deadline: ledger.active.deadline,
      };
    } catch (error) {
      if (error instanceof AgoraRequestError && error.definitelyRejected) {
        // An explicit validation/auth rejection did not create a billable agent.
        delete ledger.active;
        ledger.reservedSeconds -= RESERVATION_SECONDS;
        await save();
        if (workflow) await updateJourneyVoice(id, "rejected");
        throw error;
      }
      // A timeout may have created an agent. Keep the reservation and block new calls.
      ledger.active.state = "uncertain";
      await save();
      if (workflow) await updateJourneyVoice(id, "uncertain").catch(() => {});
      throw new VoiceError(
        "Agent startup could not be confirmed. The allowance remains reserved. Use Recover connection before trying again.",
        502,
      );
    }
  });
}

async function stopActive(ledger: Ledger, save: () => Promise<void>) {
  const active = ledger.active;
  if (!active) return;
  let agentId = active.agentId;
  if (!agentId) {
    // Recover ambiguous joins by their unique channel/name, never by an arbitrary client ID.
    const result = await agoraRequest(
      `/agents?channel=${encodeURIComponent(active.channel)}&state=0,1,2,3,4,6&limit=100`,
    );
    const agents = result.data?.list || result.agents || [];
    const found = agents.find(
      (agent: { status: string }) =>
        !["STOPPED", "FAILED"].includes(agent.status),
    );
    if (
      !found &&
      (agents.length > 0 ||
        // Give an ambiguous join one minute to settle before trusting an empty
        // channel query. Do not force users to wait the full practice duration.
        (result.meta?.total === 0 &&
          Date.now() >= active.deadline - SESSION_SECONDS * 1000 + 60_000))
    ) {
      delete ledger.active;
      await save();
      await updateJourneyVoice(active.id, "completed");
      return;
    }
    if (!found)
      throw new VoiceError(
        "Startup is uncertain. Verify the agent in the Agora console and follow the recovery guide. New calls remain blocked.",
        409,
      );
    agentId = found.agent_id;
    active.agentId = agentId;
    await save();
  }
  // A failed stop retains active state and blocks further spending.
  try {
    await agoraRequest(`/agents/${encodeURIComponent(agentId!)}/leave`, {});
  } catch (error) {
    // Idle timeout may already have stopped it; clear only after a positive query.
    const result = await agoraRequest(
      `/agents?channel=${encodeURIComponent(active.channel)}&state=0,1,2,3,4,6&limit=100`,
    );
    const record = result.data?.list?.find(
      (agent: { agent_id: string }) => agent.agent_id === agentId,
    );
    if (!record || !["STOPPED", "FAILED"].includes(record.status)) throw error;
  }
  delete ledger.active;
  await save();
  await updateJourneyVoice(active.id, "completed");
}

export async function stopSession(id?: string, recover = false) {
  return withLedger(async (ledger, save) => {
    if (!ledger.active) return { stopped: true };
    if (!recover && ledger.active.id !== id)
      throw new VoiceError("Session does not belong to this browser.", 403);
    await stopActive(ledger, save);
    return { stopped: true };
  });
}

export async function serviceStatus() {
  const toolsConfigured = Boolean(await toolsBaseUrl());
  return withLedger(async (ledger, save) => {
    if (
      ledger.active &&
      Date.now() >= ledger.active.deadline &&
      ledger.active.agentId
    ) {
      await stopActive(ledger, save).catch(() => {});
    }
    const missing = missingCredentials();
    return {
      ready: missing.length === 0,
      missing,
      accessCodeRequired: Boolean(process.env.ABHYASH_ACCESS_CODE),
      reservedSeconds: ledger.reservedSeconds,
      limitSeconds: LIMIT_SECONDS,
      active: Boolean(ledger.active),
      recoveryRequired: Boolean(
        ledger.active &&
        (ledger.active.state === "uncertain" ||
          Date.now() >= ledger.active.deadline),
      ),
      toolsConfigured,
    };
  });
}

export async function sessionHistory(id: string) {
  const agentId = await withLedger(async (ledger) => {
    if (!ledger.active || ledger.active.id !== id || !ledger.active.agentId)
      throw new VoiceError("Session has ended.", 410);
    return ledger.active.agentId;
  });
  const result = await agoraRequest(
    `/agents/${encodeURIComponent(agentId)}/history`,
  );
  const contents = Array.isArray(result.contents) ? result.contents : [];
  return {
    contents: contents
      .filter(
        (line: { role?: string; content?: unknown }) =>
          ["user", "assistant"].includes(line.role || "") &&
          typeof line.content === "string",
      )
      .map((line: { role: string; content: string }) => ({
        role: line.role,
        content: line.content,
      })),
  };
}
