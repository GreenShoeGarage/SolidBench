/* v1 workflows, using the real server and FreeCAD worker. Same prerequisites as browser.cjs. */
const { chromium } = require("playwright"),
  { spawn } = require("child_process"),
  path = require("path"),
  fs = require("fs"),
  assert = require("assert");
(async () => {
  const root = path.resolve(__dirname, ".."),
    port = 8189,
    output = process.env.QA_OUTPUT || path.join(root, "qa-output");
  fs.mkdirSync(output, { recursive: true });
  const server = spawn(
    process.env.PYTHON || "python3",
    [path.join(root, "server.py"), "--port", String(port)],
    { env: process.env, stdio: "ignore" },
  );
  let browser, page;
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
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const model = async (action) => {
      const response = page.waitForResponse(async (r) => {
        if (
          !/\/api\/jobs\/[^/]+$/.test(r.url()) ||
          r.request().method() !== "GET"
        )
          return false;
        try {
          return ["complete", "failed", "cancelled"].includes(
            (await r.json()).state,
          );
        } catch {
          return false;
        }
      });
      await action();
      const body = await (await response).json();
      await page.locator("#busy").waitFor({ state: "hidden" });
      const result = body.result || { ok: false, error: body.error };
      assert(result.ok, JSON.stringify(result));
      return result;
    };
    const close = async (id) =>
      page.locator("#" + id + " .close-dialog").click();
    const tools = async (id) => {
      await page.locator("#moreTools").click();
      await page.locator("#" + id).click();
    };
    const fresh = async () => {
      await page.locator("#fileButton").click();
      await model(() => page.locator("#newProject").click());
    };
    const advanced = async (type, values = {}) => {
      await page.locator("#moreTools").click();
      await page.locator('[data-advanced="' + type + '"]').click();
      for (const [k, v] of Object.entries(values))
        await page.locator('#advancedForm [name="' + k + '"]').fill(String(v));
      return model(() =>
        page.locator("#advancedForm button[type=submit]").click(),
      );
    };
    await model(() => page.goto(`http://127.0.0.1:${port}`));
    await page.locator("#mode").selectOption("advanced");
    // Named parameters change exact geometry, including a sketch expression field.
    await page.locator("#projectBrowser").click();
    let r = await model(() => page.locator("#paramTemplate").click());
    assert(Math.abs(r.mesh.volume - Math.PI * (225 - 16) * 12) < 0.001);
    await tools("parametersTool");
    await page
      .locator("#parameterForm textarea")
      .fill("diameter = 40\nbore = 8\nthickness = 12");
    r = await model(() => page.locator("#parameterForm button").click());
    assert(Math.abs(r.mesh.volume - Math.PI * (400 - 16) * 12) < 0.001);
    // Browser revisions and host revisions retain old snapshots.
    await page.locator("#projectBrowser").click();
    await page.locator("#revisionLabel").fill("Spacer baseline");
    await page.locator("#saveRevision").click();
    await page.locator("[data-revisions]").first().waitFor();
    await page.locator("[data-revisions]").first().click();
    await page.locator("[data-restore-revision]").first().waitFor();
    assert(
      (await page.locator("#projectList").textContent()).includes(
        "Spacer baseline",
      ),
    );
    await model(() => page.locator('[data-restore-revision="1"]').click());
    await page.locator("#projectBrowser").click();
    await page.locator("#projectLocation").selectOption("server");
    await page.locator("#revisionLabel").fill("Host baseline");
    await page.locator("#saveProjectAs").click();
    await page.locator("[data-open-project]").first().waitFor();
    await model(() => page.locator("[data-open-project]").first().click());
    // Two independently placed bodies and one grounded slider control.
    await tools("bodiesTool");
    r = await model(() => page.locator("[data-body-copy]").first().click());
    assert.equal(r.bodies.length, 2);
    await page.locator("[data-body-edit]").last().click();
    await page.locator("#bodyForm [name=x]").fill("0");
    await page.locator("#bodyForm [name=kind]").selectOption("slider");
    await page.locator("#bodyForm [name=ax]").fill("1");
    await page.locator("#bodyForm [name=az]").fill("0");
    await page.locator("#bodyForm [name=value]").fill("5");
    r = await model(() => page.locator("#bodyForm button.primary").click());
    assert.equal(r.mesh.solids, 2);
    await tools("interferenceTool");
    await page.waitForFunction(() =>
      document
        .querySelector("#interferenceResult")
        .textContent.includes("Overlap:"),
    );
    await page.screenshot({ path: path.join(output, "interference.png") });
    await close("interferenceDialog");
    await tools("bodiesTool");
    await model(() => page.locator("[data-body-visible]").last().click());
    await close("bodiesDialog");
    // STEP export becomes an independent imported body.
    await page.locator("#exportButton").click();
    let promise = page.waitForEvent("download");
    await page
      .locator("#exportScope")
      .selectOption(
        await page.locator("#exportScope option").last().getAttribute("value"),
      );
    await page.locator("[data-export=step]").click();
    let download = await promise;
    const step = fs.readFileSync(await download.path());
    await page.waitForFunction(
      () => !document.querySelector("[data-export=step]").disabled,
    );
    await page.locator("#exportDialog .dialog-top button").click();
    r = await model(() =>
      page.locator("#fileInput").setInputFiles({
        name: "spacer.step",
        mimeType: "application/octet-stream",
        buffer: step,
      }),
    );
    assert(r.bodies.some((b) => b.name === "spacer"));
    assert(
      Math.abs(r.bodies.find((b) => b.name === "spacer").mesh.bounds[0] + 15) <
        0.001,
    );
    // Native constraint solve, use the profile, and assign a depth expression.
    await fresh();
    await page.locator("#sketch").click();
    await page.locator("#constraintsButton").click();
    await page.locator("#addConstraint").click();
    await model(() => page.locator("#solveSketch").click());
    assert(
      (await page.locator("#solverStatus").textContent()).includes(
        "closed profile",
      ),
    );
    await page.screenshot({ path: path.join(output, "constraints.png") });
    await model(() => page.locator("#useSolved").click());
    r = await model(() =>
      page.locator("#sketchForm button[type=submit]").click(),
    );
    assert(Math.abs(r.mesh.volume - 12000) < 0.001);
    await tools("parametersTool");
    await page.locator("#parameterForm textarea").fill("thickness = 5");
    await model(() => page.locator("#parameterForm button").click());
    await page.locator(".tree-row [data-id]").first().dblclick();
    await page.locator("#sketchExpressions").fill("depth = thickness");
    r = await model(() =>
      page.locator("#sketchForm button[type=submit]").click(),
    );
    assert(Math.abs(r.mesh.volume - 7500) < 0.001);
    // Face-attached sketches preserve the original supporting face when edited.
    await fresh();
    await page.locator('[data-create="box"]').click();
    await model(() =>
      page.locator('#featureForm button[type="submit"]').click(),
    );
    await page.locator("#inspect").click();
    await page.locator(".face-register summary").click();
    await page.locator('[data-face-sketch="6"]').click();
    await page.locator('[data-shape="circle"]').click();
    await page.locator('#sketchForm [name="x"]').fill("8");
    await page.locator('#sketchForm [name="y"]').fill("0");
    await page.locator('#sketchForm [name="radius"]').fill("4");
    await page.locator('#sketchForm [name="depth"]').fill("5");
    r = await model(() =>
      page.locator('#sketchForm button[type="submit"]').click(),
    );
    assert(Math.abs(r.mesh.volume - (12000 + Math.PI * 16 * 5)) < 0.001);
    await page.locator(".tree-row [data-id]").last().dblclick();
    await page.locator('#sketchForm [name="depth"]').fill("6");
    r = await model(() =>
      page.locator('#sketchForm button[type="submit"]').click(),
    );
    assert(Math.abs(r.mesh.volume - (12000 + Math.PI * 16 * 6)) < 0.001);
    // Advanced tool dialogs construct and edit native geometry.
    await fresh();
    r = await advanced("loft");
    assert(r.mesh.volume > 10000);
    await page.locator(".tree-row [data-id]").first().dblclick();
    await page
      .locator("#advancedForm [name=sectionsText]")
      .fill("0,0,0,20,20\n30,0,0,20,20");
    r = await model(() =>
      page.locator("#advancedForm button[type=submit]").click(),
    );
    assert(Math.abs(r.mesh.volume - 12000) < 0.001);
    await fresh();
    r = await advanced("sweep");
    assert(r.mesh.valid);
    await page.screenshot({ path: path.join(output, "sweep.png") });
    await fresh();
    await page.locator("[data-create=box]").click();
    await model(() => page.locator("#featureForm button[type=submit]").click());
    r = await advanced("shell");
    assert(r.mesh.volume < 12000);
    await model(() => page.locator("#undo").click());
    r = await advanced("draft");
    assert(r.mesh.valid);
    await model(() => page.locator("#undo").click());
    r = await advanced("pattern");
    assert.equal(Math.round(r.mesh.volume), 36000);
    await model(() => page.locator("#undo").click());
    r = await advanced("mirror");
    assert.equal(Math.round(r.mesh.volume), 24000);
    await model(() => page.locator("#undo").click());
    r = await advanced("transform", { dx: 20 });
    assert.equal(Math.round(r.mesh.bounds[0]), 20);
    await model(() => page.locator("#undo").click());
    // Dimension placement, tolerance, SVG, PDF, and stale-reference protection.
    await tools("drawingTool");
    await page.locator("#saveDrawing").waitFor({ state: "visible" });
    await page.waitForFunction(
      () => !document.querySelector("#saveDrawing").disabled,
    );
    await page.locator("#dimensionEditor summary").click();
    await page.locator("#dimensionKind").selectOption("aligned");
    await page.locator("#dimensionTolerance").fill(".05");
    await model(() => page.locator("#addDimension").click());
    assert(
      (await page.locator("#dimensionList").textContent()).includes(
        "Reference valid",
      ),
    );
    await page.locator("#dimensionEditor summary").click();
    await page.screenshot({ path: path.join(output, "drawing.png") });
    promise = page.waitForEvent("download");
    await page.locator("#saveDrawing").click();
    download = await promise;
    const svg = fs.readFileSync(await download.path(), "utf8");
    assert(svg.includes("± 0.05"));
    fs.copyFileSync(
      await download.path(),
      path.join(output, "dimensioned-sheet.svg"),
    );
    await page.evaluate(() => (window.print = () => {}));
    await page.locator("#printDrawing").click();
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: path.join(output, "dimensioned-sheet.pdf"),
      format: "A4",
    });
    await page.emulateMedia({ media: "screen" });
    await page.locator(".tree-row [data-id]").first().dblclick();
    await page.locator("#featureForm [name=x]").fill("5");
    await model(() => page.locator("#featureForm button[type=submit]").click());
    await tools("drawingTool");
    await page.waitForFunction(() =>
      document
        .querySelector("#drawingStatus")
        .textContent.includes("reference(s) changed"),
    );
    assert(await page.locator("#saveDrawing").isDisabled());
    await page.locator("#dimensionEditor summary").click();
    await model(() => page.locator("[data-remove-dimension]").click());
    assert(await page.locator("#saveDrawing").isEnabled());
    await close("drawingDialog");
    // A new body with its own history and a cross-body cut.
    await tools("bodiesTool");
    await model(() => page.locator("#newBody").click());
    await page.locator("[data-create=cylinder]").click();
    await page.locator("#featureForm [name=x]").fill("20");
    await page.locator("#featureForm [name=y]").fill("15");
    await model(() => page.locator("#featureForm button[type=submit]").click());
    await page.locator("#activeBody").selectOption("main");
    await page.locator("#moreTools").click();
    await page.locator("[data-advanced=boolean]").click();
    await page.locator("#advancedForm [name=operation]").selectOption("cut");
    r = await model(() =>
      page.locator("#advancedForm button[type=submit]").click(),
    );
    assert(r.bodies.find((b) => b.id === "main").mesh.volume < 12000);
    // Schema validation stops malformed numeric HTML before any geometry gets replaced.
    await page.locator("#fileButton").click();
    promise = page.waitForEvent("download");
    await page.locator("#saveJson").click();
    download = await promise;
    const p = JSON.parse(fs.readFileSync(await download.path()));
    await page.locator("#fileDialog .dialog-top button").click();
    p.features[0].width = '"><img src=x onerror=alert(1)>';
    await page.locator("#fileInput").setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(p)),
    });
    await page.waitForFunction(() =>
      document.querySelector("#status").textContent.includes("Import rejected"),
    );
    assert(
      (await page.locator("#status").textContent()).includes("Import rejected"),
    );
    assert.equal(await page.locator(".tree-row").count(), 3);
    // Mobile access to tools and persistent dialogs remains within the screen.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#fileButton").click();
    await page.locator("#toolsFromFile").click();
    assert(await page.locator("#toolsDialog").isVisible());
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({ path: path.join(output, "mobile-tools.png") });
    await close("toolsDialog");
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: [
            "parameter edits",
            "browser and host revisions",
            "body copies",
            "slider positioning",
            "interference",
            "body visibility",
            "STEP import",
            "constraint solve",
            "sketch expressions",
            "face sketch edit",
            "loft edit",
            "sweep",
            "shell",
            "draft",
            "pattern",
            "mirror",
            "transform",
            "reference dimensions and tolerance",
            "SVG/PDF",
            "stale dimension detection",
            "body boolean",
            "numeric import validation",
            "mobile tools",
          ],
        },
        null,
        2,
      ),
    );
  } catch (e) {
    if (page) {
      await page
        .screenshot({ path: path.join(output, "v1-failure.png") })
        .catch(() => {});
      console.error(
        await page
          .locator("dialog[open]")
          .allTextContents()
          .catch(() => []),
      );
    }
    throw e;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
