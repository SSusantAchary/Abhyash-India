// Explicitly opt-in paid verification. Uses synthetic learner audio through the REAL
// Agora RTC/ASR/LLM/Murf pipeline. It never manufactures tool callbacks or outcomes.
const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
if (!process.argv.includes("--allow-paid-live-test")) {
  console.error(
    "This starts a real provider session. Pass --allow-paid-live-test only after approving the HTTPS bridge and paid test allowance.",
  );
  process.exit(1);
}
const root = path.resolve(__dirname, "..");
const base = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";
const fixturePath =
  process.env.ABHYASH_LIVE_AUDIO || "/private/tmp/abhyash-live-answer.wav";
if (!fs.existsSync(fixturePath))
  throw Error(
    "Provide an English PCM WAV with an interview answer and a request to save feedback, create a plan, and schedule practice. Set ABHYASH_LIVE_AUDIO.",
  );
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const scrub = (value) =>
  String(value)
    .replace(/007[A-Za-z0-9+/=]{30,}/g, "[rtc-token]")
    .slice(0, 1000);
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  let voiceId,
    runId,
    startedAt,
    run,
    audio = {},
    succeeded = false;
  const errors = [];
  const report = {
    verification: "REAL AGORA VOICE-TO-TOOL TEST WITH SYNTHETIC LEARNER INPUT",
    startedAt: new Date().toISOString(),
    publicEndpointTestApproved: true,
    inputAudio: path.basename(fixturePath),
    manuallyInjectedToolCalls: 0,
  };
  page.on("pageerror", (error) => errors.push(scrub(error.message)));
  page.on("response", async (response) => {
    if (
      response.url() === base + "/api/voice" &&
      response.request().method() === "POST" &&
      !response.ok()
    ) {
      try {
        report.voiceRequestError = (await response.json()).error;
        console.error(
          "Voice request rejected: " + scrub(report.voiceRequestError),
        );
      } catch {}
    }
    if (
      response.url() === base + "/api/voice" &&
      response.request().method() === "POST" &&
      response.ok()
    ) {
      try {
        const data = await response.json();
        if (data.id && data.token) {
          voiceId = data.id;
          startedAt = Date.now();
        }
      } catch {}
    }
  });
  await page.addInitScript(() => {
    const NativePC = window.RTCPeerConnection;
    window.__qaPeers = [];
    window.RTCPeerConnection = new Proxy(NativePC, {
      construct(Target, args, NewTarget) {
        const pc = Reflect.construct(Target, args, NewTarget);
        window.__qaPeers.push(pc);
        return pc;
      },
    });
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints?.audio || constraints.video)
        return original(constraints);
      const ctx = new AudioContext({ sampleRate: 48000 });
      const destination = ctx.createMediaStreamDestination();
      await ctx.resume();
      window.__qaInput = { ctx, destination };
      return destination.stream;
    };
    window.__qaRemoteStats = async () => {
      let packets = 0,
        bytes = 0,
        energy = 0,
        samples = 0;
      for (const pc of window.__qaPeers) {
        if (pc.connectionState === "closed") continue;
        try {
          const stats = await pc.getStats();
          stats.forEach((report) => {
            if (
              report.type === "inbound-rtp" &&
              (report.kind === "audio" || report.mediaType === "audio")
            ) {
              packets += report.packetsReceived || 0;
              bytes += report.bytesReceived || 0;
              energy += report.totalAudioEnergy || 0;
              samples += report.totalSamplesDuration || 0;
            }
          });
        } catch {}
      }
      return {
        packetsReceived: packets,
        bytesReceived: bytes,
        totalAudioEnergy: energy,
        totalSamplesDuration: samples,
      };
    };
  });
  try {
    const initial = await (await page.request.get(base + "/api/voice")).json();
    report.reservedMinutesBefore = initial.reservedSeconds / 60;
    if (!initial.ready || !initial.toolsConfigured || initial.active)
      throw Error(
        "Services/tunnel are not ready or another session is active. No paid test started.",
      );
    await page.goto(base);
    await page.getByLabel("Your name").fill("Live demo: synthetic learner");
    await page.getByLabel("Target role or situation").fill("Software engineer");
    await page
      .getByLabel("My goal")
      .fill(
        "Improve my interview answer, save specific feedback, and create a three-day plan with a reminder",
      );
    await page
      .getByLabel("Background")
      .fill(
        "This is an approved hackathon pipeline verification using a synthetic spoken interview answer.",
      );
    await page
      .getByLabel("Create an in-app reminder and calendar download")
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
    runId = (await (await page.request.get(base + "/api/journey")).json())
      .runs[0].id;
    report.runId = runId;
    await page
      .getByRole("button", { name: "Let’s practice", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "End practice", exact: true }),
    ).toBeVisible({ timeout: 35000 });
    console.log(
      "RTC joined and microphone published. Waiting briefly for coach greeting.",
    );
    const greetingDeadline = Date.now() + 15000;
    while (Date.now() < greetingDeadline) {
      audio = await page.evaluate(() => window.__qaRemoteStats());
      if (audio.totalAudioEnergy > 0) break;
      await sleep(1000);
    }
    report.firstCoachAudioMs =
      audio.totalAudioEnergy > 0 ? Date.now() - startedAt : null;
    if (audio.totalAudioEnergy > 0) await sleep(3500);
    const inputDuration = await page.evaluate(async (encoded) => {
      const { ctx, destination } = window.__qaInput;
      await ctx.resume();
      const bytes = Uint8Array.from(atob(encoded), (char) =>
        char.charCodeAt(0),
      );
      const buffer = await ctx.decodeAudioData(bytes.buffer);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(destination);
      source.start();
      window.__qaInput.source = source;
      return buffer.duration;
    }, fs.readFileSync(fixturePath).toString("base64"));
    report.inputAudioSeconds = inputDuration;
    console.log(
      "Synthetic interview answer is being sent through real RTC audio.",
    );
    const deadline = startedAt + 100000;
    let previousActions = "";
    while (Date.now() < deadline) {
      const snapshot = await (
        await page.request.get(base + "/api/journey")
      ).json();
      run = snapshot.runs.find((item) => item.id === runId);
      audio = await page.evaluate(() => window.__qaRemoteStats());
      const names = run.actions
        .map((action) => action.tool + ":" + action.status)
        .join(",");
      if (names !== previousActions) {
        console.log("Observed actual callbacks: " + names);
        previousActions = names;
      }
      if (
        run.feedback &&
        run.plan &&
        run.reminder &&
        audio.totalAudioEnergy > 0
      ) {
        succeeded = true;
        break;
      }
      if (
        (await page
          .getByRole("button", { name: "End practice", exact: true })
          .count()) === 0
      )
        throw Error(
          "Voice session ended before the expected outcomes were saved.",
        );
      await sleep(1500);
    }
    if (!succeeded)
      throw Error(
        "Live test reached its time limit before all audio/tool outcomes were verified.",
      );
    console.log(
      "Feedback, three-day plan, reminder, and non-silent coach audio verified.",
    );
  } catch (error) {
    report.error = scrub(report.voiceRequestError || error.message);
    console.error(report.error);
  } finally {
    if (voiceId) {
      // Explicit stop is attempted even if browser UI or verification fails.
      try {
        const response = await page.request.post(base + "/api/voice", {
          headers: {
            Origin: base,
            "x-abhyash-code": process.env.ABHYASH_DEMO_CODE || "",
          },
          data: { action: "stop", id: voiceId },
        });
        report.stopConfirmed = response.ok();
        if (!response.ok) report.stopError = (await response.json()).error;
      } catch (error) {
        report.stopConfirmed = false;
        report.stopError = scrub(error.message);
      }
    }
    try {
      if (runId) {
        run = (
          await (await page.request.get(base + "/api/journey")).json()
        ).runs.find((item) => item.id === runId);
        report.outcome = run;
      }
      const status = await (await page.request.get(base + "/api/voice")).json();
      report.reservedMinutesAfter = status.reservedSeconds / 60;
      report.activeAfterTest = status.active;
      if (run?.plan) {
        const calendar = await page.request.get(
          base + "/api/journey?calendar=" + runId,
        );
        report.calendarExportVerified =
          calendar.ok() && (await calendar.text()).includes("BEGIN:VCALENDAR");
        await page
          .getByRole("button", { name: "My practice plan", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Your three-day practice plan" }),
        ).toBeVisible({ timeout: 10000 });
        await page.screenshot({
          path: path.join(root, "artifacts/live-agent-outcome.png"),
          fullPage: true,
        });
      }
    } catch (error) {
      report.finalCheckError = scrub(error.message);
    }
    report.audio = audio;
    report.elapsedSeconds = startedAt
      ? Math.round((Date.now() - startedAt) / 1000)
      : 0;
    report.browserErrors = errors;
    report.passed =
      succeeded &&
      report.stopConfirmed &&
      report.calendarExportVerified &&
      !report.activeAfterTest;
    fs.writeFileSync(
      path.join(root, "artifacts/live-verification.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        passed: report.passed,
        elapsedSeconds: report.elapsedSeconds,
        stopConfirmed: report.stopConfirmed,
        activeAfterTest: report.activeAfterTest,
        reservedMinutesAfter: report.reservedMinutesAfter,
        report: "artifacts/live-verification.json",
      }),
    );
    await browser.close();
  }
  if (!report.passed) process.exitCode = 1;
})().catch((error) => {
  console.error(scrub(error.message));
  process.exitCode = 1;
});
