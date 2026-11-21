const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs");
(async () => {
  fs.mkdirSync("artifacts", { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // React reports hydration mismatches through console.error, not pageerror.
    page.on("console", (message) => {
      if (message.type() === "error" && /hydrat|didn't match/i.test(message.text())) {
        errors.push(message.text());
      }
    });
    const base = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3100";
    const response = await page.goto(base);
    expect(response.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: /Find your voice/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Find your everyday voice/ })
      .click();
    await expect(
      page.getByRole("button", { name: /Find your everyday voice/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("I’D LIKE TO SPEAK IN").selectOption("kn-IN");
    await expect(page.getByLabel("I’D LIKE TO SPEAK IN")).toHaveValue("kn-IN");
    // Inspect setup directly; never click Start or spend provider minutes.
    await page
      .getByRole("button", { name: "Connection setup", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Your live connection" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close connection setup" }).click();
    await page.screenshot({
      path: "artifacts/studio-desktop.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "My sessions", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Every conversation counts." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Practice guide", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Say it out loud." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Practice studio", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "artifacts/studio-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", {
        name: /Set up your live connection|Live services configured|Session active/,
      }),
    ).toBeVisible();
    expect(errors).toEqual([]);
    const status = await (await page.request.get(base + "/api/voice")).json();
    console.log(
      JSON.stringify({
        desktop: "passed",
        mobile: "passed",
        scenarioSelection: "passed",
        languageSelection: "passed",
        connectionSetup: "passed",
        navigation: "passed",
        runtimeErrors: errors.length,
        reservedMinutes: status.reservedSeconds / 60,
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
