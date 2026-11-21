// Capture the existing UI and a previously verified demo outcome. No voice calls.
const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const dir = path.join(root, "artifacts/ui-snapshots");
const base = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";
const images = [];
(async () => {
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  let voicePosts = 0;
  const errors = [];
  async function context(width, height) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    ctx.on("request", (r) => {
      if (r.url() === base + "/api/voice" && r.method() === "POST")
        voicePosts++;
    });
    return ctx;
  }
  async function shot(
    page,
    name,
    title,
    device = "Desktop",
    locator = null,
    provenance = "Current application UI",
  ) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const file = `${name}.png`;
    if (locator)
      await locator.screenshot({
        path: path.join(dir, file),
        animations: "disabled",
      });
    else
      await page.screenshot({
        path: path.join(dir, file),
        fullPage: true,
        animations: "disabled",
      });
    images.push({ file, title, device, provenance });
  }
  try {
    const desktop = await context(1440, 1000);
    const page = await desktop.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await expect(
      page.getByRole("heading", { name: /Find your voice/ }),
    ).toBeVisible();
    await shot(page, "01-studio-desktop", "Practice studio");
    await shot(
      page,
      "02-preparation-desktop",
      "Preparation and action permissions",
      "Desktop",
      page.locator("details").filter({ has: page.getByLabel("My goal") }),
    );
    await page
      .getByRole("heading", {
        name: "What are we practicing today?",
        exact: true,
      })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(dir, "03-scenarios-desktop.png"),
      animations: "disabled",
    });
    images.push({
      file: "03-scenarios-desktop.png",
      title: "Scenarios and practice partner",
      device: "Desktop",
      provenance: "Current application UI",
    });
    await page.getByLabel("I’D LIKE TO SPEAK IN").selectOption("hi-IN");
    await page.screenshot({
      path: path.join(dir, "04-hindi-selection-desktop.png"),
      animations: "disabled",
    });
    images.push({
      file: "04-hindi-selection-desktop.png",
      title: "Hindi language selection",
      device: "Desktop",
      provenance: "Current application UI",
    });
    await page
      .getByRole("button", { name: "Connection setup", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shot(
      page,
      "05-connection-desktop",
      "Live connection and usage allowance",
      "Desktop",
      page.getByRole("dialog"),
    );
    await page
      .getByRole("button", { name: "Close connection setup", exact: true })
      .click();
    await page
      .getByRole("button", { name: "My sessions", exact: true })
      .click();
    await shot(
      page,
      "06-session-history-desktop",
      "Session history — new browser",
    );
    await page
      .getByRole("button", { name: "Practice guide", exact: true })
      .click();
    await shot(page, "07-practice-guide-desktop", "Practice guide");
    const report = JSON.parse(
      fs.readFileSync(
        path.join(root, "artifacts/demo/live-verification.json"),
        "utf8",
      ),
    );
    const store = JSON.parse(
      fs.readFileSync(
        path.join(root, "apps/web/.abhyash/journeys.json"),
        "utf8",
      ),
    );
    const run = store.runs.find((r) => r.id === report.runId);
    if (!report.passed || !run || !run.profile.name.includes("synthetic"))
      throw Error("Verified synthetic demo outcome is unavailable");
    const demo = await context(1440, 1000);
    await demo.addCookies([
      {
        name: "abhyash-learner",
        value: run.learnerId,
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const result = await demo.newPage();
    await result.goto(base);
    await result
      .getByRole("button", { name: "My practice plan", exact: true })
      .click();
    await expect(
      result.getByRole("heading", {
        name: "Your three-day practice plan",
        exact: true,
      }),
    ).toBeVisible();
    const evidence =
      "Actual saved outcome from the recorded Agora + Murf demo; synthetic learner input";
    await shot(
      result,
      "08-practice-plan-desktop",
      "Saved coaching feedback and three-day plan",
      "Desktop",
      null,
      evidence,
    );
    await shot(
      result,
      "09-feedback-desktop",
      "Feedback grounded in the spoken answer",
      "Desktop",
      result
        .getByRole("heading", { name: "What worked", exact: true })
        .locator("../.."),
      evidence,
    );
    await shot(
      result,
      "10-agent-actions-desktop",
      "Four actual agent tool executions",
      "Desktop",
      result.locator("details").filter({
        has: result.getByText("Agent actions · 4 completed", { exact: true }),
      }),
      evidence,
    );
    await result
      .getByRole("button", { name: "Practice studio", exact: true })
      .click();
    await shot(
      result,
      "11-prepared-profile-desktop",
      "Saved learner profile and preparation",
      "Desktop",
      result.locator("details").filter({ has: result.getByLabel("My goal") }),
      evidence,
    );
    const mobile = await context(390, 844);
    const phone = await mobile.newPage();
    await phone.goto(base);
    await shot(phone, "12-studio-mobile", "Practice studio", "Mobile");
    await shot(
      phone,
      "13-preparation-mobile",
      "Preparation and action permissions",
      "Mobile",
      phone.locator("details").filter({ has: phone.getByLabel("My goal") }),
    );
    await phone
      .getByRole("button", {
        name: /Live services configured|Set up your live connection/,
      })
      .click();
    await shot(
      phone,
      "14-connection-mobile",
      "Live connection settings",
      "Mobile",
      phone.getByRole("dialog"),
    );
    await phone
      .getByRole("button", { name: "Close connection setup", exact: true })
      .click();
    await phone
      .getByRole("button", { name: "Practice guide", exact: true })
      .click();
    await shot(phone, "15-practice-guide-mobile", "Practice guide", "Mobile");
    await demo.close();
    const mobileDemo = await context(390, 844);
    await mobileDemo.addCookies([
      {
        name: "abhyash-learner",
        value: run.learnerId,
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const mobileResult = await mobileDemo.newPage();
    await mobileResult.goto(base);
    await mobileResult
      .getByRole("button", { name: "My practice plan", exact: true })
      .click();
    await expect(
      mobileResult.getByRole("heading", {
        name: "Your three-day practice plan",
        exact: true,
      }),
    ).toBeVisible();
    await shot(
      mobileResult,
      "16-practice-plan-mobile",
      "Saved coaching feedback and plan",
      "Mobile",
      null,
      evidence,
    );
    await shot(
      mobileResult,
      "17-agent-actions-mobile",
      "Actual agent tool execution log",
      "Mobile",
      mobileResult.locator("details").filter({
        has: mobileResult.getByText("Agent actions · 4 completed", {
          exact: true,
        }),
      }),
      evidence,
    );
    for (const [route, title] of [
      ["login", "Sign in"],
      ["signup", "Create account"],
      ["setup", "Initial admin setup"],
    ]) {
      await page.goto(`${base}/${route}`);
      await page.waitForTimeout(400);
      await shot(page, `18-${route}-desktop`, title);
    }
    const recording = path.join(root, "artifacts/demo/Abhyash-India-Demo.mp4");
    if (fs.existsSync(recording)) {
      for (const [second, file, title] of [
        [45, "19-live-practice-recorded.png", "Live practice with Prathamesh"],
        [77, "20-transcript-history-recorded.png", "Saved conversation and transcript"],
      ]) {
        const frame = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(second), "-i", recording, "-frames:v", "1", path.join(dir,file)]);
        if (frame.status !== 0) throw Error("Could not extract the recorded UI frame");
        images.push({file, title, device:"Desktop", provenance:`Frame at ${second}s from the actual recorded demo; synthetic learner input`});
      }
    }
    expect(voicePosts).toBe(0);
    expect(errors).toEqual([]);
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          voiceCallsStarted: voicePosts,
          images,
        },
        null,
        2,
      ),
    );
    const escape = (s) =>
      s.replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
    fs.writeFileSync(
      path.join(dir, "index.html"),
      `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Abhyash-India · UI snapshots</title><style>body{margin:0;padding:40px;background:#f6f3fb;color:#302344;font:16px/1.5 system-ui}header{max-width:1100px;margin:auto auto 35px}h1{font-size:36px;margin:0}main{max-width:1500px;margin:auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{background:white;padding:20px;border:1px solid #e8def2;border-radius:20px}img{width:100%;height:330px;object-fit:contain;object-position:top;background:#faf8fc}h2{font-size:19px}small{color:#716381}a{color:#7549b8}p{margin:10px 0}</style><header><h1>Abhyash-India</h1><p>${images.length} UI snapshots · Desktop and mobile</p><p>Click an image to open the full-resolution PNG. Practice-plan screens show the actual saved result of the recorded demo with synthetic learner input. Session history shows the authentic empty state of a fresh browser. No paid voice calls were started for these captures.</p></header><main>${images.map((x) => `<article><small>${escape(x.device)}</small><h2>${escape(x.title)}</h2><a href="${x.file}"><img loading="lazy" src="${x.file}" alt="${escape(x.title)}"></a><p><small>${escape(x.provenance)}</small></p><a href="${x.file}" download>Download PNG</a></article>`).join("")}</main></html>`,
    );
    console.log(
      JSON.stringify({
        screenshots: images.length,
        voiceCallsStarted: voicePosts,
        folder: "artifacts/ui-snapshots",
        gallery: "artifacts/ui-snapshots/index.html",
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
