/* Optional browser QA: npm install --no-save playwright; npx playwright install chromium.
   FREECAD_PYTHON must identify the Python environment used by the FreeCAD service. */
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const assert = require("assert");
(async () => {
  const root = path.resolve(__dirname, ".."),
    port = 8187;
  const server = spawn(
    process.env.PYTHON || "python3",
    [path.join(root, "server.py"), "--port", String(port)],
    { env: process.env, stdio: "ignore" },
  );
  let browser;
  const output = process.env.QA_OUTPUT || path.join(root, "qa-output");
  fs.mkdirSync(output, { recursive: true });
  try {
    await new Promise((r) => setTimeout(r, 400));
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
      viewport: { width: 1440, height: 950 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
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
      const r = await response;
      const body = await r.json();
      await page.locator("#busy").waitFor({ state: "hidden" });
      return body.result || { ok: false, error: body.error };
    };
    let result = await model(() => page.goto(`http://127.0.0.1:${port}`));
    assert(result.ok && result.mesh.valid);
    assert.equal(result.mesh.solids, 1);
    assert.equal(await page.locator(".tree-row").count(), 5);
    assert(Math.abs(result.mesh.volume - 42857.3896) < 0.01);
    await page.screenshot({ path: path.join(output, "desktop.png") });
    // Edit upstream sketch, undo/redo, and reload persistence.
    await page.locator('[data-id="base"]').first().dblclick();
    await page.locator('#sketchForm [name="depth"]').fill("8");
    result = await model(() =>
      page.locator('#sketchForm button[type="submit"]').click(),
    );
    assert(result.ok);
    let editedVolume = result.mesh.volume;
    assert(editedVolume > 42857.3896);
    await model(() => page.locator("#undo").click());
    result = await model(() => page.locator("#redo").click());
    assert.equal(result.mesh.volume, editedVolume);
    result = await model(() => page.reload());
    assert.equal(result.mesh.volume, editedVolume);
    // JSON export and import round trip, new empty project and undo.
    await page.locator("#fileButton").click();
    let downloadPromise = page.waitForEvent("download");
    await page.locator("#saveJson").click();
    let dl = await downloadPromise;
    let json = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    assert.equal(json.features[0].depth, 8);
    await model(() => page.locator("#newProject").click());
    assert(await page.locator("#emptyState").isVisible());
    await model(() => page.locator("#undo").click());
    await model(() =>
      page
        .locator("#fileInput")
        .setInputFiles({
          name: "roundtrip.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(json)),
        }),
    );
    // Invalid imports preserve the project.
    await page
      .locator("#fileInput")
      .setInputFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"schema":999}'),
      });
    assert.equal(await page.locator(".tree-row").count(), 5);
    assert(
      (await page.locator("#status").textContent()).includes("Import rejected"),
    );
    // New part from numeric sketch, polygon alternative, native edge treatments.
    await page.locator("#fileButton").click();
    await model(() => page.locator("#newProject").click());
    await page.locator("#emptySketch").click();
    await page.locator('#sketchForm [name="x"]').fill("0");
    await page.locator('#sketchForm [name="y"]').fill("0");
    await page.locator('#sketchForm [name="width"]').fill("40");
    await page.locator('#sketchForm [name="height"]').fill("30");
    await page.locator('#sketchForm [name="depth"]').fill("10");
    result = await model(() =>
      page.locator('#sketchForm button[type="submit"]').click(),
    );
    assert.equal(Math.round(result.mesh.volume), 12000);
    // Deliberate invalid feature: shows failure; undo restores valid geometry.
    await page.locator('[data-create="box"]').click();
    await page.locator('#featureForm [name="operation"]').selectOption("cut");
    result = await model(() =>
      page.locator('#featureForm button[type="submit"]').click(),
    );
    assert(!result.ok);
    assert(await page.locator("#modelError").isVisible());
    result = await model(() => page.locator("#undo").click());
    assert(result.ok);
    // Export all real formats through the browser.
    await page.locator("#exportButton").click();
    for (const format of ["step", "stl", "FCStd"]) {
      downloadPromise = page.waitForEvent("download");
      await page.locator(`[data-export="${format}"]`).click();
      dl = await downloadPromise;
      const file = await dl.path();
      assert(fs.statSync(file).size > 100);
      fs.copyFileSync(file, path.join(output, "browser-export." + format));
      await page.waitForFunction(
        () => document.querySelector('[data-export="step"]').disabled === false,
      );
    }
    await page.locator("#exportDialog .dialog-top button").click();
    // Restore example; views, projection, pan/orbit, grid, section, themes, and report.
    await page.locator("#fileButton").click();
    await model(() => page.locator("#sample").click());
    for (const view of ["top", "front", "right", "iso"])
      await page.locator(`[data-view="${view}"]`).click();
    await page.locator("#projection").click();
    await page.locator("#projection").click();
    await page.locator("#pan").click();
    await page.locator("#orbit").click();
    await page.locator("#grid").click();
    await page.locator("#grid").click();
    await page.locator("#fit").click();
    await page.locator("#mode").selectOption("advanced");
    await page.locator("#section").click();
    await page.locator("#sectionZ").fill("20");
    await page.locator("#section").click();
    await page.locator("#theme").selectOption("dark");
    await page.screenshot({ path: path.join(output, "dark.png") });
    await page.locator("#theme").selectOption("contrast");
    await page.screenshot({ path: path.join(output, "contrast.png") });
    await page.locator("#theme").selectOption("light");
    await page.locator("#mode").selectOption("easy");
    await page.evaluate(() => (window.print = () => {}));
    await page.locator("#report").click();
    assert(
      (await page.locator("#printReport").textContent()).includes("42,857"),
    );
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: path.join(output, "part-review.pdf"),
      format: "A4",
    });
    await page.emulateMedia({ media: "screen" });
    await page.locator("#sketch").click();
    await page.locator('[data-shape="polygon"]').click();
    await page.locator("#sketchNumeric textarea").fill("0,0\n15,0\n8,15");
    await page.screenshot({ path: path.join(output, "sketch.png") });
    await page.locator('[data-close="sketchDialog"]').click();
    // Edge selection by keyboard-compatible inspector; fillet, suppression, duplicate/delete and recovery.
    await page.locator("#inspect").click();
    await page.locator("#edgePicker").selectOption("1");
    await page.locator("#edgeFillet").click();
    result = await model(() =>
      page.locator('#featureForm button[type="submit"]').click(),
    );
    assert(result.ok);
    await model(() => page.locator("#undo").click());
    await page.locator('[data-id="bore"]').first().click();
    await model(() => page.locator("#duplicateFeature").click());
    assert.equal(await page.locator(".tree-row").count(), 6);
    await model(() => page.locator("#deleteFeature").click());
    assert.equal(await page.locator(".tree-row").count(), 5);
    await model(() => page.locator('[data-suppress="bore"]').click());
    await model(() => page.locator('[data-suppress="bore"]').click());
    await page.locator("#treeSearch").fill("hole");
    assert.equal(await page.locator(".tree-row").count(), 2);
    await page.locator("#treeSearch").fill("");
    await page.locator("#closeBrowser").click();
    await page.locator("#openBrowser").click();
    await page.locator("#closeInspector").click();
    await page.locator("#openInspector").click();
    await page.locator("#fileButton").click();
    await model(() => page.locator("#recovery").click());
    await model(() => page.locator("#undo").click());
    // A drawn rectangle updates numeric dimensions using snapped coordinates.
    await page.locator("#sketch").click();
    const svg = page.locator("#sketchCanvas"),
      box = await svg.boundingBox();
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.6);
    assert(
      Number(await page.locator('#sketchForm [name="width"]').inputValue()) > 0,
    );
    await page.locator('[data-close="sketchDialog"]').click();
    // Cached offline reload keeps source editable and shows cached geometry explicitly.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(300);
    await context.setOffline(true);
    await page.reload();
    await page.locator("#modelError").waitFor({ state: "visible" });
    assert.equal(await page.locator(".tree-row").count(), 5);
    assert(
      (await page.locator("#modelError").textContent()).includes(
        "Cached view only",
      ),
    );
    await context.setOffline(false);
    await model(() => page.locator("#retryKernel").click());
    // Mobile does not overflow the page; numeric edit remains accessible.
    await page.setViewportSize({ width: 390, height: 844 });
    await model(() => page.reload());
    await page.screenshot({ path: path.join(output, "mobile.png") });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.locator("#sketch").click();
    await page.locator('#sketchForm [name="width"]').fill("45");
    await page.screenshot({ path: path.join(output, "mobile-sketch.png") });
    await page.locator('[data-close="sketchDialog"]').click();
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          ok: true,
          checks: [
            "sample geometry",
            "upstream edits",
            "undo/redo",
            "reload persistence",
            "JSON roundtrip",
            "invalid imports",
            "empty project",
            "numeric sketches",
            "invalid geometry recovery",
            "STEP/STL/FCStd downloads",
            "standard views",
            "projection",
            "section",
            "themes",
            "print report",
            "offline cache",
            "mobile layout",
          ],
          screenshots: output,
        },
        null,
        2,
      ),
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
