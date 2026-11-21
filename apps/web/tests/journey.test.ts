// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultProfile } from "../src/lib/journey";
import {
  beginJourney,
  calendarForRun,
  executeAgentTool,
  getJourney,
  newLearnerId,
  prepareJourney,
  resolveReview,
  updateJourneyVoice,
  updateTask,
  validateProfile,
  withJourney,
} from "../src/lib/journey-server";
import {
  agentConfiguration,
  serviceStatus,
  startSession,
} from "../src/lib/voice-server";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "abhyash-journey-"));
  vi.stubEnv("ABHYASH_DATA_DIR", directory);
  vi.stubEnv("ABHYASH_TOOLS_BASE_URL", "https://tools.example.com");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ABHYASH_ACCESS_CODE", "");
  for (const key of [
    "AGORA_APP_ID",
    "AGORA_APP_CERTIFICATE",
    "AGORA_CUSTOMER_ID",
    "AGORA_CUSTOMER_SECRET",
    "MURF_API_KEY",
  ])
    vi.stubEnv(key, "a".repeat(32));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ service: "abhyash-agent-tools" })),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});
const feedback = {
  strengths: ["Explains the situation clearly"],
  improvements: ["Describe the measurable result"],
  evidenceQuote: "I led the team to finish the project on time.",
};
const plan = {
  summary: "Build stronger STAR answers",
  tasks: [1, 2, 3].map((day) => ({
    title: `STAR practice ${day}`,
    instructions: "Record one answer, include a result, and try again.",
    minutes: 4,
  })),
};
async function prepared(overrides = {}) {
  const learner = newLearnerId();
  const run = await prepareJourney(
    learner,
    {
      ...defaultProfile,
      allowReminder: true,
      allowReview: true,
      reminderAt: new Date(Date.now() + 86400_000).toISOString(),
      ...overrides,
    },
    "interview",
    "en-IN",
  );
  const workflow = await beginJourney(
    learner,
    run.id,
    "voice-session",
    "interview",
    "en-IN",
  );
  const call = (tool: string, args = {}, callId = crypto.randomUUID()) =>
    executeAgentTool(`Bearer ${workflow.capability}`, {
      runId: run.id,
      tool,
      args,
      callId,
    });
  return { learner, run, workflow, call };
}
describe("agentic practice journey", () => {
  it("persists preparation, executes dependent actions, and produces a usable calendar event", async () => {
    const { learner, run, call } = await prepared({
      name: "Asha",
      targetRole: "Software engineer",
    });
    expect(await call("getLearnerContext")).toMatchObject({
      profile: { name: "Asha" },
    });
    await call("saveCoachingFeedback", feedback);
    await call("createPracticePlan", plan);
    await call("schedulePractice");
    const saved = (await getJourney(learner)).runs[0];
    expect(saved.actions.map((action) => action.tool)).toEqual([
      "getLearnerContext",
      "saveCoachingFeedback",
      "createPracticePlan",
      "schedulePractice",
    ]);
    expect(saved.plan?.tasks).toHaveLength(3);
    expect(saved.feedback?.evidenceQuote).toBe(feedback.evidenceQuote);
    const calendar = await calendarForRun(learner, run.id);
    expect(calendar).toContain("BEGIN:VCALENDAR\r\n");
    expect(calendar).toContain("BEGIN:VALARM");
    expect(calendar).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    await updateTask(learner, run.id, saved.plan!.tasks[0].id, true);
    expect(
      (await getJourney(learner)).runs[0].plan!.tasks[0].completedAt,
    ).toBeTruthy();
  });
  it("enforces dependencies and records real action failures", async () => {
    const { learner, call } = await prepared();
    await expect(call("createPracticePlan", plan)).rejects.toMatchObject({
      status: 409,
    });
    await expect(call("schedulePractice")).rejects.toMatchObject({
      status: 409,
    });
    const saved = (await getJourney(learner)).runs[0];
    expect(saved.plan).toBeUndefined();
    expect(saved.actions.every((item) => item.status === "failed")).toBe(true);
  });
  it("enforces server-saved consent even if the model requests unauthorized actions", async () => {
    const { learner, call } = await prepared({
      allowPlan: false,
      allowReminder: false,
      allowReview: false,
    });
    await call("saveCoachingFeedback", feedback);
    await expect(call("createPracticePlan", plan)).rejects.toMatchObject({
      status: 403,
    });
    await expect(call("schedulePractice")).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      call("requestCoachReview", { reason: "Please check the answer" }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await getJourney(learner)).runs[0].review).toBeUndefined();
  });
  it("deduplicates successful tool calls and rejects reused IDs with changed arguments", async () => {
    const { learner, call } = await prepared();
    const first = await call("saveCoachingFeedback", feedback, "same-call");
    expect(await call("saveCoachingFeedback", feedback, "same-call")).toEqual(
      first,
    );
    await expect(
      call(
        "saveCoachingFeedback",
        { ...feedback, evidenceQuote: "Different quote" },
        "same-call",
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await getJourney(learner)).runs[0].actions).toHaveLength(1);
    await call("createPracticePlan", plan, "plan-one");
    const saved = await call("createPracticePlan", plan, "plan-two");
    expect(saved).toMatchObject({
      planId: (await getJourney(learner)).runs[0].plan!.id,
    });
  });
  it("isolates learner records and never exposes callback capabilities in browser snapshots", async () => {
    const { learner, run, workflow, call } = await prepared();
    await call("saveCoachingFeedback", feedback);
    await call("createPracticePlan", plan);
    await call("schedulePractice");
    const other = newLearnerId();
    expect((await getJourney(other)).runs).toEqual([]);
    await expect(calendarForRun(other, run.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(updateTask(other, run.id, "task", true)).rejects.toMatchObject(
      { status: 404 },
    );
    const snapshot = JSON.stringify(await getJourney(learner));
    expect(snapshot).not.toContain(workflow.capability);
    expect(snapshot).not.toContain("capabilityHash");
    expect(snapshot).not.toContain("receipts");
    expect(
      await readFile(path.join(directory, "journeys.json"), "utf8"),
    ).not.toContain(workflow.capability);
    await expect(
      executeAgentTool("Bearer wrong", {
        runId: run.id,
        tool: "getLearnerContext",
        callId: "wrong",
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
  it("expires callback capabilities and revokes them when the voice session ends", async () => {
    const { call } = await prepared();
    await withJourney((store) => {
      store.runs[0].capabilityExpires = Date.now() - 1;
    });
    await expect(call("getLearnerContext")).rejects.toMatchObject({
      status: 410,
    });
    await updateJourneyVoice("voice-session", "completed");
    await expect(call("getLearnerContext")).rejects.toMatchObject({
      status: 401,
    });
  });
  it("remembers relevant feedback and completed tasks in the next session", async () => {
    const { learner, run, call } = await prepared();
    await call("saveCoachingFeedback", feedback);
    await call("createPracticePlan", plan);
    const previous = (await getJourney(learner)).runs[0];
    await updateTask(learner, run.id, previous.plan!.tasks[0].id, true);
    await updateJourneyVoice("voice-session", "completed");
    const next = await prepareJourney(
      learner,
      defaultProfile,
      "interview",
      "en-IN",
    );
    const workflow = await beginJourney(
      learner,
      next.id,
      "next-session",
      "interview",
      "en-IN",
    );
    expect(workflow.context.recentPractice[0]).toMatchObject({
      feedback,
      completedTasks: ["STAR practice 1"],
    });
  });
  it("creates a pending human review and supports a manual resolution", async () => {
    const { learner, run, call } = await prepared();
    await call("requestCoachReview", {
      reason: "Learner requests a coach's assessment",
    });
    expect((await getJourney(learner)).runs[0].review?.state).toBe("pending");
    await resolveReview(
      learner,
      run.id,
      "Add one concrete result to the answer.",
    );
    expect((await getJourney(learner)).runs[0].review).toMatchObject({
      state: "resolved",
      resolution: "Add one concrete result to the answer.",
    });
  });
  it("rejects malformed plans, invalid time selections, and changed preparation", async () => {
    expect(() =>
      validateProfile({
        ...defaultProfile,
        allowReminder: true,
        reminderAt: "yesterday",
      }),
    ).toThrow("reminder time");
    const { learner, run, call } = await prepared();
    await call("saveCoachingFeedback", feedback);
    await expect(
      call("createPracticePlan", { ...plan, tasks: [{ title: "Invalid" }] }),
    ).rejects.toThrow("three daily tasks");
    await expect(
      beginJourney(learner, run.id, "another", "workplace", "hi-IN"),
    ).rejects.toThrow();
  });
  it("declares actual Agora HTTPS tools with run-scoped auth and tool-call idempotency", async () => {
    const { workflow } = await prepared();
    const config = agentConfiguration(
      "channel",
      "token",
      100,
      "en-IN",
      "interview",
      workflow,
    );
    expect(config.properties.advanced_features?.enable_tools).toBe(true);
    expect(config.properties.llm.tools).toHaveLength(5);
    for (const tool of config.properties.llm.tools!) {
      expect(tool.server.url).toBe("https://tools.example.com/api/agent-tools");
      expect(tool.server.body.runId).toBe(workflow.runId);
      expect(tool.server.body.callId).toBe("{{tool_call_id}}");
      expect(tool.function.name).toMatch(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/);
    }
    expect(config.properties.llm.template_variables?.coaching_capability).toBe(
      `Bearer ${workflow.capability}`,
    );
    expect(config.properties.llm.system_messages[0].content).toContain(
      "never pretend it succeeded",
    );
  });
  it("retries a cold callback route before creating the voice session", async () => {
    const learner = newLearnerId();
    const run = await prepareJourney(
      learner,
      defaultProfile,
      "interview",
      "en-IN",
    );
    const probe = vi
      .fn()
      .mockResolvedValueOnce(new Response("Starting", { status: 503 }))
      .mockImplementation(async () =>
        Response.json({ service: "abhyash-agent-tools" }),
      );
    vi.stubGlobal("fetch", probe);
    await beginJourney(learner, run.id, "voice-session", "interview", "en-IN");
    expect(probe).toHaveBeenCalledTimes(2);
    expect((await serviceStatus()).reservedSeconds).toBe(0);
  });
  it("does not spend voice allowance when the callback endpoint cannot be reached", async () => {
    const learner = newLearnerId();
    const run = await prepareJourney(
      learner,
      defaultProfile,
      "interview",
      "en-IN",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unavailable", { status: 503 })),
    );
    await expect(
      startSession("en-IN", "interview", { learnerId: learner, runId: run.id }),
    ).rejects.toThrow("unreachable");
    expect((await serviceStatus()).reservedSeconds).toBe(0);
    expect((await getJourney(learner)).runs[0].state).toBe("prepared");
  });
});
