// Local-only browser/API regression. This does NOT start a voice agent or public tunnel.
const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, file) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    file,
  );
process.env.ABHYASH_DATA_DIR ||= path.join(root, "apps/web/.abhyash");
const { withJourney } = require(
  path.join(root, "apps/web/src/lib/journey-server.ts"),
);
(async () => {
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  const base = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";
  let learnerId;
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const errors = [];
    let voiceStarts = 0;
    page.on("request", (request) => {
      if (request.url() === base + "/api/voice" && request.method() === "POST")
        voiceStarts++;
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /hydrat|didn't match/i.test(message.text())
      )
        errors.push(message.text());
    });
    await page.goto(base);
    await expect(
      page.getByRole("heading", { name: "Give your practice a purpose." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Let’s practice", exact: true })
      .click();
    await expect(page.getByLabel("My goal")).toBeFocused();
    await expect(page.getByLabel("My goal")).toBeInViewport();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(voiceStarts).toBe(0);
    await page.getByLabel("Your name").fill("LOCAL QA FIXTURE");
    await page.getByLabel("Target role or situation").fill("Software engineer");
    await page
      .getByLabel("My goal")
      .fill("LOCAL TEST FIXTURE: practice measurable interview results");
    await page
      .getByLabel("Create an in-app reminder and calendar download")
      .check();
    await page
      .getByLabel("Allow an internal human-review request if I need more help")
      .check();
    const next = new Date(Date.now() + 86400_000);
    const local = new Date(next.getTime() - next.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    await page.getByLabel("My next practice time").fill(local);
    await page
      .getByRole("button", { name: "Save preparation", exact: true })
      .click();
    await expect(
      page.getByText(
        "Preparation saved. Your coach can now turn this conversation into a practice plan.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Let’s practice", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByText("Preparation saved. You’re ready to start."),
    ).toBeVisible();
    await page
      .getByText("Preparation saved · edit for your next practice", {
        exact: true,
      })
      .click();
    await page
      .getByLabel("Target role or situation")
      .fill("Staff software engineer");
    await expect(
      page.getByRole("button", { name: "Complete preparation", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Let’s practice", exact: true })
      .click();
    await expect(page.getByLabel("My goal")).toBeFocused();
    await page
      .getByRole("button", { name: "Save preparation", exact: true })
      .click();
    await expect(
      page.getByText("Preparation saved. You’re ready to start."),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("Preparation saved. You’re ready to start."),
    ).toBeVisible();
    expect(voiceStarts).toBe(0);
    const snapshot = await (
      await page.request.get(base + "/api/journey")
    ).json();
    const run = snapshot.runs[0];
    if (!run) throw Error("Preparation was not saved for the browser identity");
    expect(run.speaker?.name).toBeTruthy();
    await expect(
      page.getByRole("heading", {
        name: `Meet ${run.speaker.name}, your practice partner`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(new RegExp(`${run.speaker.gender} voice`)),
    ).toBeVisible();
    learnerId = (await page.context().cookies()).find(
      (cookie) => cookie.name === "abhyash-learner",
    ).value;
    const capability = randomBytes(32).toString("hex");
    // Seed a test-only callback capability, then test the actual local HTTP endpoint.
    // No Agora/LLM callback is claimed here; records are deleted in finally.
    await withJourney((store) => {
      const stored = store.runs.find(
        (item) => item.id === run.id && item.learnerId === learnerId,
      );
      if (!stored || stored.profile.name !== "LOCAL QA FIXTURE")
        throw Error("Unexpected test learner");
      stored.state = "live";
      stored.capabilityHash = createHash("sha256")
        .update(capability)
        .digest("hex");
      stored.capabilityExpires = Date.now() + 120_000;
    });
    async function tool(name, args = {}, callId = "local-qa-" + name) {
      const response = await page.request.post(base + "/api/agent-tools", {
        headers: { Authorization: "Bearer " + capability },
        data: { runId: run.id, tool: name, args, callId },
      });
      const data = await response.json();
      expect(response.status(), JSON.stringify(data)).toBe(200);
      return data;
    }
    await tool("getLearnerContext");
    const feedback = {
      strengths: ["LOCAL TEST: clear situation"],
      improvements: ["LOCAL TEST: add a measurable result"],
      evidenceQuote: "LOCAL TEST FIXTURE: I finished the dashboard early.",
    };
    await tool("saveCoachingFeedback", feedback);
    await tool("saveCoachingFeedback", feedback);
    await tool("createPracticePlan", {
      summary: "LOCAL TEST FIXTURE: three interview drills",
      tasks: [1, 2, 3].map((day) => ({
        title: "LOCAL TEST drill " + day,
        instructions: "State a result and repeat your answer.",
        minutes: 4,
      })),
    });
    await tool("schedulePractice");
    await tool("requestCoachReview", {
      reason: "LOCAL TEST FIXTURE: review the answer",
    });
    const unauthorized = await page.request.post(base + "/api/agent-tools", {
      headers: { Authorization: "Bearer invalid" },
      data: {
        runId: run.id,
        tool: "getLearnerContext",
        callId: "unauthorized",
      },
    });
    expect(unauthorized.status()).toBe(401);
    await page
      .getByRole("button", { name: "My practice plan", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your three-day practice plan" }),
    ).toBeVisible();
    await expect(page.getByText("Agent actions · 5 completed")).toBeVisible();
    await page.getByLabel(/Day 1 · LOCAL TEST drill 1/).check();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(base + "/api/journey")).json()).runs[0]
            .plan.tasks[0].completedAt,
      )
      .toBeTruthy();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Add to calendar" }).click();
    const downloaded = await downloadPromise;
    expect(fs.readFileSync(await downloaded.path(), "utf8")).toContain(
      "BEGIN:VCALENDAR",
    );
    await page.getByText("Reviewer workspace", { exact: true }).click();
    await page
      .getByLabel("Reviewer feedback")
      .fill("LOCAL TEST: human reviewer suggests including a number.");
    await page.getByRole("button", { name: "Save human review notes" }).click();
    await expect(
      page.getByRole("heading", { name: "Human review · resolved" }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(root, "artifacts/journey-local-test-desktop.png"),
      fullPage: true,
    });
    await page.reload();
    await page
      .getByRole("button", { name: "My practice plan", exact: true })
      .click();
    await expect(page.getByLabel(/Day 1 · LOCAL TEST drill 1/)).toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: path.join(root, "artifacts/journey-local-test-mobile.png"),
      fullPage: true,
    });
    // Isolated browser fixtures verify each partner label and exported transcript.
    const partners = require(
      path.join(root, "apps/web/src/lib/speakers.ts"),
    ).speakers;
    await page.evaluate((voices) => {
      localStorage.setItem(
        "abhyash-sessions",
        JSON.stringify(
          voices.map((speaker) => ({
            id: `local-speaker-${speaker.name}`,
            title: `LOCAL QA ${speaker.name}`,
            language: "en-IN",
            scenario: "interview",
            seconds: 10,
            endedAt: new Date().toISOString(),
            speaker,
            transcript: [
              { role: "assistant", content: "LOCAL TEST speaker transcript" },
            ],
          })),
        ),
      );
    }, partners);
    await page.reload();
    await page
      .getByRole("button", { name: "My sessions", exact: true })
      .click();
    for (const speaker of partners) {
      const article = page.getByRole("article").filter({
        has: page.getByRole("heading", {
          name: `LOCAL QA ${speaker.name}`,
          exact: true,
        }),
      });
      await article.getByText("Read conversation", { exact: true }).click();
      await expect(
        article.getByText(`${speaker.name}:`, { exact: true }),
      ).toBeVisible();
      const exportedPromise = page.waitForEvent("download");
      await article
        .getByRole("button", { name: "Export", exact: true })
        .click();
      const exported = await exportedPromise;
      expect(fs.readFileSync(await exported.path(), "utf8")).toContain(
        `${speaker.name}: LOCAL TEST speaker transcript`,
      );
    }
    expect(errors).toEqual([]);
    console.log(
      JSON.stringify({
        verification: "LOCAL BROWSER/API TEST ONLY",
        preparation: "passed",
        partnerPreviewAndRefresh: "passed",
        partnerHistoryAndExport: "passed for all five names",
        persistence: "passed",
        toolEndpoint: "passed",
        idempotency: "passed",
        permissions: "passed",
        calendarExport: "passed",
        humanReview: "passed",
        mobile: "passed",
        voiceCallsStarted: 0,
        publicTunnelsStarted: 0,
      }),
    );
  } finally {
    if (learnerId)
      await withJourney((store) => {
        if (store.learners[learnerId]?.name === "LOCAL QA FIXTURE") {
          delete store.learners[learnerId];
          store.runs = store.runs.filter((run) => run.learnerId !== learnerId);
        }
      });
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
