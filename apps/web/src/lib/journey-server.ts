import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import {
  defaultProfile,
  type JourneyRun,
  type JourneySnapshot,
  type LearnerProfile,
  type PracticeTask,
} from "./journey";
import { languages, scenarios } from "./abhyash";
import { chooseSpeaker } from "./speaker-server";
import { speakerByName, speakersForLanguage } from "./speakers";

type StoredRun = JourneyRun & {
  learnerId: string;
  capabilityHash?: string;
  capabilityExpires?: number;
  voiceId?: string;
  voiceSequence?: number;
  receipts: Record<string, { fingerprint: string; result: unknown }>;
};
type Store = {
  version: 1;
  learners: Record<string, LearnerProfile>;
  runs: StoredRun[];
};
export class JourneyError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const directory = () =>
  process.env.ABHYASH_DATA_DIR || path.join(process.cwd(), ".abhyash");
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const newLearnerId = () => randomBytes(24).toString("hex");
export const validLearnerId = (id: string | undefined): id is string =>
  !!id && /^[a-f0-9]{48}$/.test(id);
export async function withJourney<T>(
  work: (store: Store) => T | Promise<T>,
): Promise<T> {
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const file = path.join(directory(), "journeys.json"),
    lockPath = file + ".lock";
  let lock;
  // Brief retries handle simultaneous UI polling and agent callbacks, without holding network I/O.
  for (let i = 0; i < 30; i++) {
    try {
      lock = await open(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!lock)
    throw new JourneyError(
      "Your practice is being updated. Please retry shortly.",
      409,
    );
  try {
    let store: Store;
    try {
      store = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new JourneyError(
          "Practice storage could not be read. Nothing has been overwritten.",
          503,
        );
      store = { version: 1, learners: {}, runs: [] };
    }
    if (store.version !== 1 || !Array.isArray(store.runs) || !store.learners)
      throw new JourneyError("Practice storage is invalid.", 503);
    const result = await work(store);
    const handle = await open(file + ".tmp", "w", 0o600);
    try {
      await handle.writeFile(JSON.stringify(store));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(file + ".tmp", file);
    return result;
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
function text(
  value: unknown,
  label: string,
  max = 500,
  optional = false,
): string {
  if (
    typeof value !== "string" ||
    (!optional && !value.trim()) ||
    value.length > max
  )
    throw new JourneyError(
      `${label} must be ${optional ? "at most" : "between 1 and"} ${max} characters.`,
    );
  return value.trim();
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new JourneyError("Expected a JSON object.");
  return value as Record<string, unknown>;
}
function list(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3)
    throw new JourneyError(`${label} must contain one to three items.`);
  return value.map((item) => text(item, label, 500));
}
export function validateProfile(value: unknown): LearnerProfile {
  const input = record(value);
  if (!["starting", "practicing", "confident"].includes(String(input.level)))
    throw new JourneyError("Choose your current confidence level.");
  for (const key of ["allowPlan", "allowReminder", "allowReview"])
    if (typeof input[key] !== "boolean")
      throw new JourneyError("Choose the actions your coach may take.");
  const reminderAt = text(input.reminderAt, "Reminder", 50, true);
  if (
    input.allowReminder &&
    (!Number.isFinite(Date.parse(reminderAt)) ||
      Date.parse(reminderAt) <= Date.now() ||
      Date.parse(reminderAt) > Date.now() + 30 * 86400_000)
  )
    throw new JourneyError("Choose a reminder time within the next 30 days.");
  return {
    name: text(input.name, "Name", 80, true),
    targetRole: text(input.targetRole, "Target role", 120, true),
    goal: text(input.goal, "Goal"),
    background: text(input.background, "Background", 1200, true),
    level: input.level as LearnerProfile["level"],
    allowPlan: input.allowPlan as boolean,
    allowReminder: input.allowReminder as boolean,
    allowReview: input.allowReview as boolean,
    reminderAt,
  };
}
export async function toolsBaseUrl(): Promise<string | null> {
  let candidate = process.env.ABHYASH_TOOLS_BASE_URL;
  if (!candidate) {
    try {
      candidate = JSON.parse(
        await readFile(path.join(directory(), "tool-endpoint.json"), "utf8"),
      ).url;
    } catch {
      return null;
    }
  }
  try {
    const url = new URL(candidate!);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
function publicRun(run: StoredRun): JourneyRun {
  const {
    learnerId: _owner,
    capabilityHash: _hash,
    capabilityExpires: _expires,
    voiceId: _voice,
    voiceSequence: _sequence,
    receipts: _receipts,
    ...visible
  } = run;
  return structuredClone(visible);
}
function previousSpeakerGender(store: Store, learnerId: string) {
  const previous = store.runs
    .filter((run) => run.learnerId === learnerId && run.state !== "prepared")
    .sort(
      (a, b) =>
        (b.voiceSequence || 0) - (a.voiceSequence || 0) ||
        Date.parse(b.endedAt || b.createdAt) -
          Date.parse(a.endedAt || a.createdAt),
    )[0];
  return (
    previous?.speaker?.gender ||
    speakerByName(
      languages.find((language) => language.id === previous?.language)?.voice ||
        "",
    )?.gender
  );
}
export async function getJourney(learnerId: string): Promise<JourneySnapshot> {
  const toolsConfigured = Boolean(await toolsBaseUrl());
  return withJourney((store) => {
    for (const run of store.runs) {
      if (
        run.learnerId === learnerId &&
        run.state === "prepared" &&
        !run.speaker
      )
        run.speaker = chooseSpeaker(
          run.language,
          previousSpeakerGender(store, learnerId),
        );
    }
    return {
      profile: store.learners[learnerId] || { ...defaultProfile },
      runs: store.runs
        .filter((run) => run.learnerId === learnerId)
        .slice(-30)
        .reverse()
        .map(publicRun),
      toolsConfigured,
    };
  });
}
export async function prepareJourney(
  learnerId: string,
  input: unknown,
  scenario: string,
  language: string,
) {
  const profile = validateProfile(input);
  if (
    !scenarios.some((item) => item.id === scenario) ||
    !languages.some((item) => item.id === language)
  )
    throw new JourneyError(
      "Choose a supported practice scenario and language.",
    );
  return withJourney((store) => {
    store.learners[learnerId] = profile;
    const latest = [...store.runs]
      .reverse()
      .find((run) => run.learnerId === learnerId);
    const speaker =
      latest?.state === "prepared" &&
      latest.language === language &&
      latest.speaker
        ? latest.speaker
        : chooseSpeaker(language, previousSpeakerGender(store, learnerId));
    const run: StoredRun = {
      id: randomUUID(),
      learnerId,
      scenario,
      language,
      speaker,
      profile: { ...profile },
      state: "prepared",
      createdAt: new Date().toISOString(),
      actions: [],
      receipts: {},
    };
    store.runs.push(run);
    return publicRun(run);
  });
}
export async function beginJourney(
  learnerId: string,
  runId: string,
  voiceId: string,
  scenario: string,
  language: string,
) {
  const toolsUrl = await toolsBaseUrl();
  if (!toolsUrl)
    throw new JourneyError(
      "Start the action bridge in a second terminal with npm run tools:dev, then try again.",
      503,
    );
  // Quick Tunnel routes can take a moment to become ready. Retry health checks
  // before creating an agent, so cold-start failures never spend voice allowance.
  let reachable = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${toolsUrl}/api/agent-tools`, {
        cache: "no-store",
        signal: AbortSignal.timeout(3000),
      });
      if (
        response.ok &&
        (await response.json()).service === "abhyash-agent-tools"
      ) {
        reachable = true;
        break;
      }
    } catch {
      /* A failed probe creates no agent and has no billable voice use. */
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (!reachable)
    throw new JourneyError(
      "The action bridge is unreachable. Restart npm run tools:dev before starting a paid session.",
      503,
    );
  return withJourney((store) => {
    const run = store.runs.find(
      (item) => item.id === runId && item.learnerId === learnerId,
    );
    if (!run || run.state !== "prepared")
      throw new JourneyError(
        "Prepare a new practice before starting a call.",
        409,
      );
    if (run.scenario !== scenario || run.language !== language)
      throw new JourneyError(
        "Your scenario or language changed. Save your preparation again.",
        409,
      );
    const capability = randomBytes(32).toString("hex");
    const previousGender = previousSpeakerGender(store, learnerId);
    if (
      !run.speaker ||
      run.speaker.gender === previousGender ||
      !speakersForLanguage(language).some(
        (speaker) => speaker.voiceId === run.speaker?.voiceId,
      )
    )
      run.speaker = chooseSpeaker(language, previousGender);
    run.capabilityHash = hash(capability);
    run.capabilityExpires = Date.now() + 330_000;
    run.voiceId = voiceId;
    run.voiceSequence =
      Math.max(
        0,
        ...store.runs
          .filter((item) => item.learnerId === learnerId)
          .map((item) => item.voiceSequence || 0),
      ) + 1;
    run.state = "live";
    const recent = store.runs
      .filter(
        (item) =>
          item.learnerId === learnerId && item.id !== run.id && item.feedback,
      )
      .slice(-3)
      .map((item) => ({
        goal: item.profile.goal,
        feedback: item.feedback,
        completedTasks:
          item.plan?.tasks
            .filter((task) => task.completedAt)
            .map((task) => task.title) || [],
      }));
    return {
      runId,
      toolsUrl,
      capability,
      speaker: run.speaker,
      context: { profile: run.profile, recentPractice: recent },
    };
  });
}
export type AgentWorkflow = Awaited<ReturnType<typeof beginJourney>>;
export async function updateJourneyVoice(
  voiceId: string,
  state: "rejected" | "uncertain" | "completed",
) {
  return withJourney((store) => {
    const run = store.runs.find((item) => item.voiceId === voiceId);
    if (!run) return;
    if (state === "rejected") {
      run.state = "prepared";
      delete run.voiceId;
    } else {
      run.state = state;
      if (state === "completed") run.endedAt = new Date().toISOString();
    }
    if (state !== "uncertain") {
      delete run.capabilityHash;
      delete run.capabilityExpires;
    }
  });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export async function executeAgentTool(
  authorization: string | null,
  input: unknown,
) {
  const body = record(input);
  const runId = text(body.runId, "Run", 100),
    tool = text(body.tool, "Tool", 80),
    callId = text(body.callId, "Call ID", 150);
  const args = record(body.args || {}),
    supplied = authorization?.replace(/^Bearer /, "") || "";
  let failure: JourneyError | undefined;
  const result = await withJourney((store) => {
    const run = store.runs.find((item) => item.id === runId);
    const suppliedHash = hash(supplied);
    if (
      !run?.capabilityHash ||
      !timingSafeEqual(
        Buffer.from(run.capabilityHash),
        Buffer.from(suppliedHash),
      )
    )
      throw new JourneyError("Invalid tool capability.", 401);
    if (
      run.state !== "live" ||
      !run.capabilityExpires ||
      run.capabilityExpires < Date.now()
    )
      throw new JourneyError("This practice can no longer execute tools.", 410);
    const fingerprint = hash(canonical({ tool, args }));
    const receipt = run.receipts[callId];
    if (receipt) {
      if (receipt.fingerprint !== fingerprint)
        throw new JourneyError(
          "Call ID was already used for a different action.",
          409,
        );
      return receipt.result;
    }
    const started = Date.now();
    let outcome: unknown;
    let summary = "";
    try {
      if (tool === "getLearnerContext") {
        const past = store.runs
          .filter(
            (item) =>
              item.learnerId === run.learnerId &&
              item.id !== run.id &&
              item.feedback,
          )
          .slice(-3);
        outcome = {
          profile: run.profile,
          previousFeedback: past.map((item) => item.feedback),
          completedTasks: past.flatMap(
            (item) =>
              item.plan?.tasks
                .filter((task) => task.completedAt)
                .map((task) => task.title) || [],
          ),
          currentDate: new Date().toISOString(),
        };
        summary =
          "Retrieved your goal, preferences, and recent practice memory.";
      } else if (tool === "saveCoachingFeedback") {
        run.feedback = {
          strengths: list(args.strengths, "Strengths"),
          improvements: list(args.improvements, "Improvements"),
          evidenceQuote: text(args.evidenceQuote, "Learner quote", 600),
          savedAt: new Date().toISOString(),
        };
        outcome = {
          saved: true,
          strengths: run.feedback.strengths,
          improvements: run.feedback.improvements,
        };
        summary = "Saved coaching feedback grounded in your answer.";
      } else if (tool === "createPracticePlan") {
        if (!run.profile.allowPlan)
          throw new JourneyError(
            "The learner did not authorize saving a practice plan.",
            403,
          );
        if (!run.feedback)
          throw new JourneyError(
            "Save coaching feedback from a real answer before creating a plan.",
            409,
          );
        if (!run.plan) {
          if (!Array.isArray(args.tasks) || args.tasks.length !== 3)
            throw new JourneyError("Provide exactly three daily tasks.");
          const tasks: PracticeTask[] = args.tasks.map((value, index) => {
            const task = record(value),
              minutes = Number(task.minutes);
            if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10)
              throw new JourneyError(
                "Task duration must be between 1 and 10 minutes.",
              );
            return {
              id: randomUUID(),
              day: index + 1,
              title: text(task.title, "Task title", 120),
              instructions: text(task.instructions, "Task instructions", 700),
              minutes,
            };
          });
          run.plan = {
            id: randomUUID(),
            summary: text(args.summary, "Plan summary", 500),
            tasks,
            createdAt: new Date().toISOString(),
          };
        }
        outcome = {
          saved: true,
          planId: run.plan.id,
          summary: run.plan.summary,
          tasks: run.plan.tasks,
        };
        summary = "Created your three-day practice plan.";
      } else if (tool === "schedulePractice") {
        if (!run.profile.allowReminder || !run.profile.reminderAt)
          throw new JourneyError(
            "The learner has not selected and authorized a reminder time.",
            403,
          );
        if (!run.plan)
          throw new JourneyError(
            "Create the practice plan before scheduling a reminder.",
            409,
          );
        if (Date.parse(run.profile.reminderAt) <= Date.now())
          throw new JourneyError(
            "The selected reminder time has passed. Ask the learner to choose another time.",
            409,
          );
        run.reminder ||= {
          at: run.profile.reminderAt,
          createdAt: new Date().toISOString(),
        };
        outcome = {
          saved: true,
          at: run.reminder.at,
          calendarDownloadReady: true,
          delivery:
            "in-app reminder and downloadable calendar file; no email or calendar account was contacted",
        };
        summary = "Scheduled an in-app reminder; calendar download is ready.";
      } else if (tool === "requestCoachReview") {
        if (!run.profile.allowReview)
          throw new JourneyError(
            "The learner has not authorized a human review request.",
            403,
          );
        run.review ||= {
          id: randomUUID(),
          reason: text(args.reason, "Review reason", 500),
          state: "pending",
          requestedAt: new Date().toISOString(),
        };
        outcome = {
          saved: true,
          reviewId: run.review.id,
          state: run.review.state,
          delivery: "internal review queue; no person has been contacted",
        };
        summary = "Added a request to the internal human review queue.";
      } else throw new JourneyError("Unknown agent tool.");
      run.receipts[callId] = { fingerprint, result: outcome };
    } catch (error) {
      failure =
        error instanceof JourneyError
          ? error
          : new JourneyError("The action could not be completed.", 503);
      summary = failure.message;
    }
    run.actions.push({
      id: callId,
      tool,
      status: failure ? "failed" : "succeeded",
      summary,
      at: new Date().toISOString(),
      latencyMs: Date.now() - started,
      origin: "agent",
    });
    return outcome;
  });
  if (failure) throw failure;
  return result;
}
export async function updateTask(
  learnerId: string,
  runId: string,
  taskId: string,
  completed: boolean,
) {
  return withJourney((store) => {
    const run = store.runs.find(
      (item) => item.id === runId && item.learnerId === learnerId,
    );
    const task = run?.plan?.tasks.find((item) => item.id === taskId);
    if (!run || !task) throw new JourneyError("Practice task not found.", 404);
    if (completed) task.completedAt = new Date().toISOString();
    else delete task.completedAt;
    return publicRun(run);
  });
}
export async function resolveReview(
  learnerId: string,
  runId: string,
  resolution: unknown,
) {
  return withJourney((store) => {
    const run = store.runs.find(
      (item) => item.id === runId && item.learnerId === learnerId,
    );
    if (!run?.review) throw new JourneyError("Review request not found.", 404);
    run.review.state = "resolved";
    run.review.resolution = text(resolution, "Review notes", 1000);
    run.actions.push({
      id: randomUUID(),
      tool: "resolveCoachReview",
      status: "succeeded",
      summary: "Human review notes saved.",
      at: new Date().toISOString(),
      latencyMs: 0,
      origin: "learner",
    });
    return publicRun(run);
  });
}
const calendarEscape = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
const calendarTime = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z/, "Z");
export async function calendarForRun(learnerId: string, runId: string) {
  return withJourney((store) => {
    const run = store.runs.find(
      (item) => item.id === runId && item.learnerId === learnerId,
    );
    if (!run?.reminder || !run.plan)
      throw new JourneyError(
        "No scheduled practice exists for this session.",
        404,
      );
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Abhyash India//Practice//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${run.id}@abhyash.local`,
      `DTSTAMP:${calendarTime(new Date().toISOString())}`,
      `DTSTART:${calendarTime(run.reminder.at)}`,
      `DTEND:${calendarTime(new Date(Date.parse(run.reminder.at) + run.plan.tasks[0].minutes * 60_000).toISOString())}`,
      `SUMMARY:${calendarEscape("Abhyash practice: " + run.plan.tasks[0].title)}`,
      `DESCRIPTION:${calendarEscape(run.plan.tasks[0].instructions)}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT10M",
      "ACTION:DISPLAY",
      "DESCRIPTION:Time for your speaking practice",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
  });
}
