/* Browser sign-in/sign-out against a password-protected real host. */
const { chromium } = require("playwright"),
  { spawn } = require("child_process"),
  path = require("path"),
  fs = require("fs"),
  os = require("os"),
  crypto = require("crypto"),
  assert = require("assert");
(async () => {
  const root = path.resolve(__dirname, ".."),
    data = fs.mkdtempSync(path.join(os.tmpdir(), "solidbench-auth-")),
    salt = "00".repeat(16),
    password = "solidbench-browser-test",
    port = 8191;
  fs.writeFileSync(
    path.join(data, "auth.json"),
    JSON.stringify({
      salt,
      hash: crypto
        .pbkdf2Sync(password, Buffer.from(salt, "hex"), 600000, 32, "sha256")
        .toString("hex"),
    }),
  );
  const server = spawn(
    process.env.PYTHON || "python3",
    [path.join(root, "server.py"), "--port", String(port)],
    { env: { ...process.env, SOLIDBENCH_DATA: data }, stdio: "ignore" },
  );
  let browser;
  try {
    await new Promise((r) => setTimeout(r, 500));
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
      args: [
        "--no-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    });
    const page = await browser.newPage({
        viewport: { width: 1100, height: 850 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}`);
    await page.locator("#loginDialog").waitFor();
    await page.locator("#loginForm [name=password]").fill("wrong");
    await page.locator("#loginForm button").click();
    await page.waitForFunction(
      () =>
        document.querySelector("#loginError").textContent ===
        "Incorrect password",
    );
    await page.locator("#loginForm [name=password]").fill(password);
    await page.locator("#loginForm button").click();
    await page.locator("#loginDialog").waitFor({ state: "hidden" });
    await page.waitForFunction(() =>
      document.querySelector("#geometryStats").textContent.includes("1 solid"),
    );
    assert.equal(
      (
        await page.request.get(`http://127.0.0.1:${port}/api/projects`)
      ).status(),
      200,
    );
    await page.locator("#help").click();
    await page.locator("#signOutHost").click();
    await page.locator("#loginDialog").waitFor();
    assert.equal(
      (
        await page.request.get(`http://127.0.0.1:${port}/api/projects`)
      ).status(),
      401,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: password rejection, sign-in, native computation, sign-out and API session expiry",
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise((r) => server.once("exit", r));
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
