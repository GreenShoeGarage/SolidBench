import * as THREE from "three";
import { TrackballControls } from "./vendor/TrackballControls.js";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const VERSION = "1.0.0",
  KEY = "solidbench.project.v1",
  PREV = KEY + ".previous";
const clone = (x) => structuredClone(x),
  esc = (s) =>
    String(s ?? "").replace(
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
const uid = () =>
  crypto.randomUUID?.() ||
  "f" + Date.now() + Math.random().toString(36).slice(2);
const icons = {
  loft: "⋈",
  sweep: "∿",
  shell: "▣",
  draft: "⏢",
  mirror: "◫",
  pattern: "▦",
  transform: "✥",
  boolean: "◧",
  import: "⇥",
  box: "▰",
  cylinder: "◉",
  sphere: "◍",
  extrude: "▱",
  revolve: "⟳",
  fillet: "◜",
  chamfer: "◩",
};
const labels = {
  loft: "Loft",
  sweep: "Sweep",
  shell: "Shell",
  draft: "Draft",
  mirror: "Mirror",
  pattern: "Pattern",
  transform: "Transform",
  boolean: "Body boolean",
  import: "Imported STEP",
  box: "Box",
  cylinder: "Cylinder",
  sphere: "Sphere",
  extrude: "Extrude",
  revolve: "Revolve",
  fillet: "Fillet",
  chamfer: "Chamfer",
};
const fresh = () => ({
  app: "SOLIDBENCH",
  schema: 1,
  version: VERSION,
  units: "mm",
  name: "Untitled part",
  features: [],
});
const sample = () => ({
  app: "SOLIDBENCH",
  schema: 1,
  version: VERSION,
  units: "mm",
  name: "Workbench bracket",
  features: [
    {
      id: "base",
      name: "Base plate",
      type: "extrude",
      profile: "rectangle",
      plane: "XY",
      x: -40,
      y: -25,
      width: 80,
      height: 50,
      offset: 0,
      depth: 6,
      operation: "join",
    },
    {
      id: "wall",
      name: "Upright flange",
      type: "box",
      x: -40,
      y: 19,
      z: 6,
      width: 80,
      height: 6,
      depth: 45,
      operation: "join",
    },
    {
      id: "left",
      name: "Left mounting hole",
      type: "cylinder",
      x: -26,
      y: -8,
      z: -1,
      radius: 3.5,
      depth: 8,
      operation: "cut",
    },
    {
      id: "right",
      name: "Right mounting hole",
      type: "cylinder",
      x: 26,
      y: -8,
      z: -1,
      radius: 3.5,
      depth: 8,
      operation: "cut",
    },
    {
      id: "bore",
      name: "Upright bore",
      type: "extrude",
      profile: "circle",
      plane: "XZ",
      x: 0,
      y: 29,
      radius: 11,
      offset: -26,
      depth: 8,
      operation: "cut",
    },
  ],
});
let loadProblem = false;
let project = sample(),
  undo = [],
  redo = [],
  selected = null,
  selectedEdges = [],
  currentMesh = null,
  modelHistory = [],
  modelReady = false,
  engineReady = false,
  revision = 0,
  requestRunning = false,
  modelQueued = false,
  saveTimer,
  requestTimer,
  editingId = null,
  sketchState = {},
  lastError = "",
  fitNext = true;
const status = (s) => ($("#status").textContent = s);
function validate(p) {
  if (
    !p ||
    p.app !== "SOLIDBENCH" ||
    ![1, 2].includes(p.schema) ||
    p.units !== "mm" ||
    !Array.isArray(p.features) ||
    p.features.length > 200
  )
    throw Error(
      "Open a SOLIDBENCH schema 1 or 2 project in millimetres (maximum 200 features).",
    );
  p = clone(p);
  if (typeof p.name !== "string" || p.name.length > 120)
    throw Error("Invalid project name.");
  if (p.schema === 1) {
    p.schema = 2;
    p.bodies = [
      { id: "main", name: "Main body", visible: true, color: "#91a6ad" },
    ];
    p.features.forEach((f) => (f.bodyId = "main"));
  }
  if (!Array.isArray(p.bodies) || !p.bodies.length || p.bodies.length > 30)
    throw Error("Projects need 1–30 bodies.");
  const bid = new Set();
  p.bodies.forEach((b) => {
    if (typeof b.id !== "string" || bid.has(b.id))
      throw Error("Invalid body ID.");
    bid.add(b.id);
  });
  const ids = new Set();
  p.features.forEach((f) => {
    if (
      !f ||
      typeof f.id !== "string" ||
      ids.has(f.id) ||
      !Object.hasOwn(labels, f.type) ||
      typeof f.name !== "string" ||
      f.name.length > 120 ||
      !bid.has(f.bodyId)
    )
      throw Error("Invalid feature, body reference or duplicate ID.");
    ids.add(f.id);
    if (!["join", "cut", "intersect", undefined].includes(f.operation))
      throw Error("Invalid operation.");
  });
  p.parameters ??= [];
  validateGeometryData(p);
  p.version = VERSION;
  return p;
}
function validateGeometryData(p) {
  const nums = [
    "x",
    "y",
    "z",
    "x1",
    "y1",
    "x2",
    "y2",
    "cx",
    "cy",
    "start",
    "end",
    "width",
    "height",
    "depth",
    "radius",
    "angle",
    "offset",
    "thickness",
    "dx",
    "dy",
    "dz",
    "nx",
    "ny",
    "nz",
    "ox",
    "oy",
    "oz",
    "ax",
    "ay",
    "az",
    "px",
    "py",
    "pz",
    "count",
    "neutralFace",
    "face",
  ];
  const finite = (v) =>
    typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 10000;
  function geometry(f) {
    if (!f || typeof f !== "object") throw Error("Invalid geometry record.");
    for (const k of nums)
      if (k in f && !finite(f[k]))
        throw Error(k + ": use a finite number within ±10,000.");
    for (const k of ["points", "path"])
      if (
        k in f &&
        (!Array.isArray(f[k]) ||
          f[k].length > 64 ||
          f[k].some((v) => !Array.isArray(v) || v.some((n) => !finite(n))))
      )
        throw Error("Invalid profile or path points.");
    for (const k of ["geometry", "sections"])
      if (k in f) {
        if (!Array.isArray(f[k]) || f[k].length > 64)
          throw Error("Too many profile entities.");
        f[k].forEach(geometry);
      }
    for (const k of ["edges", "faces"])
      if (
        k in f &&
        (!Array.isArray(f[k]) ||
          f[k].some((n) => !Number.isInteger(n) || n < 1))
      )
        throw Error("Use positive edge and face numbers.");
    if (
      f.constraints &&
      (!Array.isArray(f.constraints) || f.constraints.length > 200)
    )
      throw Error("Invalid constraint list.");
    if (f.geometry?.some((g) => !["line", "arc", "circle"].includes(g.kind)))
      throw Error("Unknown sketch entity.");
  }
  p.features.forEach(geometry);
  p.bodies.forEach((b) => {
    if (typeof b.name !== "string" || b.name.length > 120)
      throw Error("Invalid body name.");
    if (b.placement) geometry(b.placement);
    if (b.joint) geometry(b.joint);
  });
  if (
    !Array.isArray(p.parameters) ||
    p.parameters.length > 100 ||
    p.parameters.some(
      (x) =>
        !x ||
        typeof x.name !== "string" ||
        !["string", "number"].includes(typeof x.value),
    )
  )
    throw Error("Invalid parameter list.");
  if (p.drawingDimensions) {
    if (!Array.isArray(p.drawingDimensions) || p.drawingDimensions.length > 100)
      throw Error("Too many drawing dimensions.");
    for (const d of p.drawingDimensions)
      if (
        !d ||
        !["top", "front", "right"].includes(d.view) ||
        !["horizontal", "vertical", "aligned"].includes(d.kind) ||
        ![d.a, d.b].every(
          (v) => Array.isArray(v) && v.length === 2 && v.every(finite),
        ) ||
        !finite(d.offset) ||
        !finite(d.tolerance) ||
        d.tolerance < 0
      )
        throw Error("Invalid drawing dimension.");
  }
}
let activeBody = "main",
  bodyMeshes = [],
  activeJob = null,
  serverProjectId = null,
  serverRevision = 0;

try {
  let raw = localStorage.getItem(KEY);
  if (raw) project = validate(JSON.parse(raw));
} catch (e) {
  loadProblem = true;
  project = fresh();
  lastError =
    "Saved project could not be read. Use File → Previous saved state to recover. " +
    e.message;
}
function persist() {
  durableSave();
}

function commit(change, message = "Project updated") {
  const before = clone(project);
  try {
    change();
    project = validate(project);
  } catch (e) {
    project = before;
    throw e;
  }
  undo.push(before);
  if (undo.length > 60) undo.shift();
  redo = [];
  project.version = VERSION;
  persist();
  revision++;
  modelReady = false;
  renderUI();
  scheduleModel();
  status(message);
}
function restore(which) {
  const from = which === "undo" ? undo : redo,
    to = which === "undo" ? redo : undo;
  if (!from.length) return;
  to.push(clone(project));
  project = from.pop();
  selected = null;
  selectedEdges = [];
  revision++;
  persist();
  renderUI();
  scheduleModel();
  status(which === "undo" ? "Undone" : "Redone");
}
function replaceProject(p, message) {
  commit(() => {
    project = validate(p);
    localProjectId = null;
    activeBody = project.bodies[0].id;
    serverProjectId = null;
    serverRevision = 0;
    selected = null;
    selectedEdges = [];
    fitNext = true;
  }, message);
}
function download(data, name, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const filename = () =>
  project.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") ||
  "solidbench-part";
function saveJSON() {
  download(JSON.stringify(project, null, 2), filename() + ".solidbench.json");
  status("Editable project exported");
}
function modal(id) {
  $("#" + id).showModal();
}
function togglePanel(id, force) {
  let el = $("#" + id),
    collapsed = force ?? !el.classList.contains("collapsed");
  el.classList.toggle("collapsed", collapsed);
  document.body.classList.toggle(
    id === "browserPanel" ? "browser-collapsed" : "inspector-collapsed",
    collapsed,
  );
  try {
    localStorage.setItem("solidbench." + id, collapsed ? "closed" : "open");
  } catch {}
  resize();
}
function featureSelect(id) {
  selected = id;
  activeBody = project.features.find((f) => f.id === id)?.bodyId || activeBody;
  renderBodies();
  selectedEdges = [];
  highlightEdges();
  $$("#tree .tree-row").forEach((row) =>
    row.classList.toggle(
      "selected",
      row.querySelector("[data-id]")?.dataset.id === id,
    ),
  );
  $$("#timeline [data-id]").forEach((b) =>
    b.classList.toggle("selected", b.dataset.id === id),
  );
  renderInspector();
}
function renderUI() {
  $("#projectName").value = project.name;
  $("#treeName").textContent = project.name;
  $("#featureCount").textContent = project.features.length;
  $("#undo").disabled = !undo.length;
  $("#redo").disabled = !redo.length;
  const search = $("#treeSearch").value.toLowerCase();
  $("#tree").innerHTML = project.features
    .filter((f) => f.name.toLowerCase().includes(search))
    .map(
      (f) =>
        `<div class="tree-row ${f.id === selected ? "selected" : ""} ${f.suppressed ? "suppressed" : ""}"><button class="select-feature" data-id="${esc(f.id)}" aria-label="Edit ${esc(f.name)}"><i class="tree-icon">${icons[f.type]}</i><span>${esc(f.name)}</span></button><button class="suppress" data-suppress="${esc(f.id)}" aria-label="${f.suppressed ? "Enable" : "Suppress"} ${esc(f.name)}" title="${f.suppressed ? "Enable" : "Suppress"} feature">${f.suppressed ? "○" : "●"}</button></div>`,
    )
    .join("");
  $("#timeline").innerHTML = project.features
    .map(
      (f, i) =>
        `<button data-id="${esc(f.id)}" class="${f.id === selected ? "selected" : ""} ${f.suppressed ? "suppressed" : ""}" title="${i + 1}. ${esc(f.name)} · ${labels[f.type]}" aria-label="Select ${esc(f.name)}">${icons[f.type]}</button>`,
    )
    .join("");
  $("#emptyState").hidden = project.features.length > 0;
  renderBodies();
  renderInspector();
}
const fmt = (n, d = 2) =>
  Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
function renderInspector() {
  let f = project.features.find((f) => f.id === selected),
    m = activeMesh() || currentMesh;
  $("#inspectorTitle").textContent = f
    ? "FEATURE PROPERTIES"
    : "PART PROPERTIES";
  let html = f
    ? `<div class="eyebrow">${labels[f.type].toUpperCase()} · ${f.operation || "join"}</div><h2>${esc(f.name)}</h2><p>${f.suppressed ? "Suppressed — omitted from the solid." : "Edit this feature to rebuild the downstream history."}</p>`
    : `<div class="eyebrow">${modelReady ? "VALID SOLID" : "DESIGN WORKSPACE"}</div><h2>${esc(project.name)}</h2><p>A dimension-driven part, made your way.</p><div class="swatch">SATIN ALUMINUM · DISPLAY ONLY</div>`;
  if (f) {
    for (let [k, v] of Object.entries(f)) {
      if (
        [
          "width",
          "height",
          "depth",
          "radius",
          "x",
          "y",
          "z",
          "offset",
          "angle",
        ].includes(k)
      )
        html += `<div class="kv"><span>${k[0].toUpperCase() + k.slice(1)}</span><b>${fmt(v)} ${k === "angle" ? "°" : "mm"}</b></div>`;
    }
    if (f.plane)
      html += `<div class="kv"><span>Sketch plane</span><b>${esc(f.plane)}</b></div>`;
    if (f.edges)
      html += `<div class="kv"><span>Edges</span><b>${esc(f.edges.join(", "))}</b></div>`;
    html += `<div class="inspector-actions"><button class="primary" id="editFeature">Edit feature</button><button id="duplicateFeature">Duplicate</button><button id="deleteFeature">Delete</button></div>`;
  } else if (m) {
    const b = m.bounds;
    html += `<div class="kv"><span>Envelope · mm</span><b>${fmt(b[3] - b[0], 1)} × ${fmt(b[4] - b[1], 1)} × ${fmt(b[5] - b[2], 1)}</b></div><div class="kv"><span>Volume</span><b>${fmt(m.volume / 1000)} cm³</b></div><div class="kv"><span>Surface area</span><b>${fmt(m.area)} mm²</b></div><div class="kv"><span>Solids / faces</span><b>${m.solids} / ${m.faces}</b></div><div class="kv"><span>Active features</span><b>${project.features.filter((x) => !x.suppressed).length}</b></div>`;
  }
  if (!f && m) {
    html += `<label class="edge-picker">Inspect edge<select id="edgePicker" aria-label="Inspect edge"><option value="">Choose an edge…</option>${m.edges.map((e) => `<option value="${e.id}" ${selectedEdges.includes(e.id) ? "selected" : ""}>Edge ${e.id} · ${fmt(e.length)} mm</option>`).join("")}</select></label>`;
  }
  if (selectedEdges.length && m) {
    html += `<div class="edge-panel"><h3>Selected edges ${selectedEdges.join(", ")}</h3><p>Total length: ${fmt(m.edges.filter((e) => selectedEdges.includes(e.id)).reduce((s, e) => s + e.length, 0))} mm</p><div class="inspector-actions"><button id="edgeFillet">Fillet</button><button id="edgeChamfer">Chamfer</button><button id="clearEdges">Clear</button></div></div>`;
  }
  html += `<div class="note">${f ? "History is ordered. A changed profile or dimension recomputes all later features." : "Select a model edge to inspect it or round it with a fillet. Shift-click selects multiple edges."}</div>`;
  $("#inspectorContent").innerHTML = html;
  if ($("#edgePicker"))
    $("#edgePicker").onchange = (e) => {
      selectedEdges = e.target.value ? [Number(e.target.value)] : [];
      highlightEdges();
      renderInspector();
    };
  if (f) {
    $("#editFeature").onclick = () => openFeature(f.type, f);
    $("#deleteFeature").onclick = deleteSelected;
    $("#duplicateFeature").onclick = () =>
      commit(() => {
        const copy = clone(f);
        copy.id = uid();
        copy.name += " copy";
        project.features.push(copy);
        selected = copy.id;
      }, "Feature duplicated; edit its position or dimensions");
  }
  if (selectedEdges.length) {
    $("#edgeFillet").onclick = () => openFeature("fillet");
    $("#edgeChamfer").onclick = () => openFeature("chamfer");
    $("#clearEdges").onclick = () => {
      selectedEdges = [];
      highlightEdges();
      renderInspector();
    };
  }
}
function deleteSelected() {
  if (!selected) return;
  commit(() => {
    project.features = project.features.filter((f) => f.id !== selected);
    selected = null;
  }, "Feature deleted · Undo restores it");
}
// True geometry is generated only by FreeCAD. Cached meshes are display-only.
async function health() {
  try {
    const r = await fetch("./api/health"),
      d = await r.json();
    if (r.status === 401) {
      showLogin();
      throw Error("Sign in required");
    }
    if (!r.ok || !d.ok) throw Error(d.error);
    engineReady = true;
    $("#kernelState").textContent = `FreeCAD ${d.version}`;
    $("#kernelDot").classList.add("ready");
    $("#kernelDetail").textContent = "Local geometry engine · connected";
  } catch (e) {
    engineReady = false;
    $("#kernelState").textContent = "FreeCAD unavailable";
    $("#kernelDot").classList.remove("ready");
    $("#kernelDetail").textContent =
      "Start the included server to rebuild solids.";
    status(
      "Geometry host unavailable. JSON editing and recovery remain available.",
    );
  }
  return engineReady;
}
function scheduleModel() {
  clearTimeout(requestTimer);
  requestTimer = setTimeout(() => {
    modelQueued = true;
    processModels();
  }, 150);
}
async function processModels() {
  if (requestRunning) return;
  requestRunning = true;
  while (modelQueued) {
    modelQueued = false;
    const rev = revision,
      snapshot = clone(project);
    $("#busy").hidden = false;
    $("#modelError").hidden = true;
    modelReady = false;
    try {
      const d = await cadJob({ action: "model", project: snapshot }, true);
      if (!d.ok) throw Error(d.error || "Modeling failed");
      if (rev !== revision) continue;
      currentMesh = d.mesh;
      bodyMeshes = d.bodies || [];
      modelHistory = d.history;
      modelReady = !!d.mesh;
      engineReady = true;
      lastError = "";
      setGeometry(d.mesh);
      if (fitNext && d.mesh) {
        fit();
        fitNext = false;
      }
      try {
        localStorage.setItem(
          "solidbench.mesh",
          JSON.stringify({
            source: JSON.stringify(snapshot),
            mesh: d.mesh,
            bodies: bodyMeshes,
          }),
        );
      } catch {}
      $("#geometryStats").textContent = d.mesh
        ? `${d.mesh.solids} solid${d.mesh.solids === 1 ? "" : "s"} · ${d.mesh.faces} faces · ${fmt(d.mesh.volume / 1000)} cm³`
        : "Empty project";
      status("Recomputed with FreeCAD");
    } catch (e) {
      if (rev !== revision) continue;
      lastError = e.message;
      modelReady = false;
      let cached = null;
      try {
        const c = JSON.parse(localStorage.getItem("solidbench.mesh"));
        if (c?.source === JSON.stringify(snapshot)) {
          cached = c.mesh;
          bodyMeshes = c.bodies || [];
        }
      } catch {}
      currentMesh = cached;
      if (!cached) bodyMeshes = [];
      setGeometry(cached);
      if (cached && fitNext) {
        fit();
        fitNext = false;
      }
      $("#modelError").textContent =
        (cached ? "Cached view only. " : "") +
        (/fetch|JSON|Unexpected|Network/i.test(e.message)
          ? "Cannot reach the FreeCAD host. Start the server or reconnect. Project edits remain saved."
          : e.message);
      $("#modelError").hidden = false;
      $("#geometryStats").textContent = cached
        ? "Cached geometry · reconnect to validate"
        : "Geometry unavailable";
      status("Recompute failed; project retained. Edit the feature or Undo.");
    } finally {
      if (rev === revision) {
        renderInspector();
        renderBodies();
        $("#busy").hidden = true;
      }
    }
  }
  requestRunning = false;
}
// Viewport: trackball orbit has no polar clamp, with a depth-tested world grid.
const host = $("#canvasHost"),
  scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.localClippingEnabled = true;
host.append(renderer.domElement);
let camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100000),
  controls,
  ortho = false,
  navMode = "orbit",
  objects = new THREE.Group(),
  edgeGroup = new THREE.Group(),
  meshObject = null;
scene.add(objects, edgeGroup);
const ambient = new THREE.HemisphereLight(0xffffff, 0x66717c, 2.3);
scene.add(ambient);
const light = new THREE.DirectionalLight(0xffffff, 3);
light.position.set(80, -100, 160);
scene.add(light);
const fill = new THREE.DirectionalLight(0xb7d7ea, 1.3);
fill.position.set(-100, 50, 70);
scene.add(fill);
const grid = new THREE.GridHelper(500, 50, 0x98aab4, 0xc7d1d7);
grid.rotation.x = Math.PI / 2;
grid.position.z = -0.04;
grid.material.transparent = true;
grid.material.opacity = 0.4;
scene.add(grid);
const axes = new THREE.AxesHelper(5);
axes.position.z = 0.02;
scene.add(axes);
const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 20);
function makeControls(target = new THREE.Vector3()) {
  if (controls) controls.dispose();
  controls = new TrackballControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.rotateSpeed = 3.3;
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 0.7;
  controls.staticMoving = true;
  controls.noRoll = false;
  controls.mouseButtons = {
    LEFT: navMode === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  };
  controls.keys = [];
}
camera.up.set(0, 0, 1);
camera.position.set(125, -160, 125);
makeControls();
function disposeGroup(group) {
  while (group.children.length) {
    const obj = group.children[0];
    group.remove(obj);
    obj.geometry?.dispose();
    obj.material?.dispose();
  }
}
function setGeometry(m) {
  disposeGroup(objects);
  disposeGroup(edgeGroup);
  meshObject = null;
  selectedEdges = [];
  if (!m) return;
  const visible = bodyMeshes.length
    ? bodyMeshes.filter((b) => b.visible)
    : [{ id: activeBody, color: "#91a6ad", mesh: m }];
  for (const body of visible) {
    const data = body.mesh,
      geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(data.positions, 3),
    );
    geo.setIndex(data.indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : "#91a6ad",
      roughness: 0.4,
      metalness: 0.35,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    mat.clippingPlanes = $("#section").classList.contains("active")
      ? [clip]
      : [];
    const object = new THREE.Mesh(geo, mat);
    object.userData.bodyId = body.id;
    objects.add(object);
    meshObject = object;
    data.edges.forEach((e) => {
      const g = new THREE.BufferGeometry().setFromPoints(
        e.points.map((v) => new THREE.Vector3(...v)),
      );
      const l = new THREE.Line(
        g,
        new THREE.LineBasicMaterial({
          color: 0x314750,
          transparent: true,
          opacity: 0.8,
        }),
      );
      l.userData = { edgeId: e.id, bodyId: body.id };
      l.material.clippingPlanes = mat.clippingPlanes;
      edgeGroup.add(l);
    });
  }
  $("#sectionZ").min = m.bounds[2];
  $("#sectionZ").max = m.bounds[5];
  $("#sectionZ").value = (m.bounds[2] + m.bounds[5]) / 2;
  clip.constant = Number($("#sectionZ").value);
}
function highlightEdges() {
  edgeGroup.children.forEach((e) => {
    const on =
      e.userData.bodyId === activeBody &&
      selectedEdges.includes(e.userData.edgeId);
    e.material.color.set(on ? 0xff9b29 : 0x314750);
    e.material.opacity = on ? 1 : 0.8;
  });
}

function resize() {
  const w = host.clientWidth,
    h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  if (camera.isPerspectiveCamera) camera.aspect = aspect;
  else {
    const half = (camera.top - camera.bottom) / 2;
    camera.left = -half * aspect;
    camera.right = half * aspect;
  }
  camera.updateProjectionMatrix();
  controls.handleResize();
}
new ResizeObserver(resize).observe(host);
function fit() {
  const b = currentMesh?.bounds || [-40, -25, 0, 40, 25, 50];
  const center = new THREE.Vector3(
    (b[0] + b[3]) / 2,
    (b[1] + b[4]) / 2,
    (b[2] + b[5]) / 2,
  );
  const size = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2], 10),
    aspect = host.clientWidth / Math.max(host.clientHeight, 1);
  let dir = camera.position.clone().sub(controls.target).normalize();
  if (!dir.length()) dir.set(1, -1, 0.8).normalize();
  controls.target.copy(center);
  if (ortho) {
    camera.top = (size * 0.9) / Math.min(aspect, 1);
    camera.bottom = -camera.top;
    camera.left = -camera.top * aspect;
    camera.right = camera.top * aspect;
    camera.zoom = 1;
  }
  camera.position.copy(
    center.clone().addScaledVector(dir, (size * 2.6) / Math.min(aspect, 1)),
  );
  camera.near = 0.01;
  camera.far = Math.max(size * 50, 10000);
  camera.updateProjectionMatrix();
  controls.update();
  status("Model fitted to view");
}
function setView(which) {
  const dirs = {
      top: [0, 0, 1],
      front: [0, -1, 0],
      right: [1, 0, 0],
      iso: [1, -1, 0.8],
    },
    v = new THREE.Vector3(...dirs[which]);
  camera.up.set(...(which === "top" ? [0, 1, 0] : [0, 0, 1]));
  camera.position.copy(
    controls.target.clone().addScaledVector(v.normalize(), 150),
  );
  camera.lookAt(controls.target);
  fit();
  $("#viewTitle").textContent = {
    top: "Top · XY",
    front: "Front · XZ",
    right: "Right · YZ",
    iso: ortho ? "Orthographic" : "Perspective",
  }[which];
}
function switchProjection() {
  const target = controls.target.clone(),
    pos = camera.position.clone(),
    up = camera.up.clone();
  ortho = !ortho;
  camera = ortho
    ? new THREE.OrthographicCamera(-100, 100, 80, -80, 0.01, 100000)
    : new THREE.PerspectiveCamera(38, 1, 0.01, 100000);
  camera.position.copy(pos);
  camera.up.copy(up);
  camera.lookAt(target);
  makeControls(target);
  resize();
  fit();
  $("#projection").classList.toggle("active", ortho);
  $("#projection").textContent = ortho ? "◈ Persp" : "▱ Ortho";
  $("#viewTitle").textContent = ortho ? "Orthographic" : "Perspective";
}
const ray = new THREE.Raycaster(),
  pointer = new THREE.Vector2();
let pointerStart;
renderer.domElement.addEventListener(
  "pointerdown",
  (e) => {
    pointerStart = [e.clientX, e.clientY];
    if (e.shiftKey) {
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    }
  },
  true,
);
window.addEventListener("pointerup", () => {
  controls.mouseButtons.LEFT =
    navMode === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
});
renderer.domElement.addEventListener("click", (e) => {
  if (
    !currentMesh ||
    !pointerStart ||
    Math.hypot(e.clientX - pointerStart[0], e.clientY - pointerStart[1]) > 4
  )
    return;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    (-(e.clientY - r.top) / r.height) * 2 + 1,
  );
  ray.setFromCamera(pointer, camera);
  ray.params.Line.threshold = Math.max(
    controls.target.distanceTo(camera.position) / 450,
    0.3,
  );
  const hits = ray.intersectObjects(edgeGroup.children);
  const solid = ray.intersectObjects(objects.children)[0];
  const hit = hits.find(
    (h) =>
      (!solid || h.distance < solid.distance + ray.params.Line.threshold * 2) &&
      (!$("#section").classList.contains("active") ||
        h.point.z <= clip.constant),
  );
  if (hit) {
    let id = hit.object.userData.edgeId;
    activeBody = hit.object.userData.bodyId;
    selectedEdges = e.shiftKey
      ? selectedEdges.includes(id)
        ? selectedEdges.filter((x) => x !== id)
        : [...selectedEdges, id]
      : [id];
    selected = null;
    highlightEdges();
    renderUI();
    togglePanel("inspector", false);
    status(`Edge ${id} selected`);
  } else {
    if (solid) {
      activeBody = solid.object.userData.bodyId;
      renderBodies();
    }
    selectedEdges = [];
    highlightEdges();
    renderInspector();
  }
});
function applyTheme(value) {
  document.body.dataset.theme = value;
  $("#theme").value = value;
  scene.background = new THREE.Color(
    value === "light" ? 0xedf1f3 : value === "contrast" ? 0x111111 : 0x1d252b,
  );
  grid.material.color?.set(value === "light" ? 0xc7d1d7 : 0x56616c);
  try {
    localStorage.setItem("solidbench.theme", value);
  } catch {}
}
(function frame() {
  requestAnimationFrame(frame);
  controls.update();
  renderer.render(scene, camera);
})();
const field = (key, label, value, min) =>
  `<label>${label}<input name="${key}" type="number" value="${esc(value ?? 0)}" step="any" max="10000" ${min !== undefined ? `min="${min}"` : ""} required></label>`;
function openFeature(type, old = null) {
  if (
    [
      "loft",
      "sweep",
      "shell",
      "draft",
      "mirror",
      "pattern",
      "transform",
      "boolean",
    ].includes(type)
  ) {
    openAdvanced(type, old);
    return;
  }
  if (type === "import") {
    status(
      "Imported geometry is retained as STEP data. Change its body placement in Bodies.",
    );
    return;
  }
  editingId = old?.id || null;
  if (["extrude", "revolve"].includes(type)) {
    openSketch(type, old);
    return;
  }
  if (["fillet", "chamfer"].includes(type) && !old && !currentMesh) {
    status("Create a valid solid first, then choose " + labels[type] + ".");
    selected = null;
    renderInspector();
    togglePanel("inspector", false);
    return;
  }
  const f = old || {
    type,
    name: labels[type],
    width: 40,
    height: 30,
    depth: 10,
    radius: type === "fillet" || type === "chamfer" ? 1 : 10,
    x: 0,
    y: 0,
    z: 0,
    edges: selectedEdges.length ? [...selectedEdges] : [1],
    operation: "join",
  };
  $("#featureTitle").textContent = (old ? "Edit " : "Add ") + labels[type];
  $("#featureEyebrow").textContent = old ? "UPDATE HISTORY" : "ADD FEATURE";
  $("#featureForm").dataset.type = type;
  $("#featureError").textContent = "";
  let h = `<label>Name<input name="name" value="${esc(f.name)}" maxlength="120" required></label>`;
  if (type === "box")
    h += `<div class="field-row">${field("width", "X length · mm", f.width, 0.01)}${field("height", "Y width · mm", f.height, 0.01)}</div>`;
  if (["cylinder", "sphere", "fillet", "chamfer"].includes(type))
    h += field(
      "radius",
      type === "chamfer" ? "Chamfer distance · mm" : "Radius · mm",
      f.radius,
      0.01,
    );
  if (["box", "cylinder"].includes(type))
    h += field("depth", "Z height · mm", f.depth, 0.01);
  if (!["fillet", "chamfer"].includes(type)) {
    h += `<div class="field-row">${field("x", type === "box" ? "Origin X · mm" : "Center X · mm", f.x)}${field("y", type === "box" ? "Origin Y · mm" : "Center Y · mm", f.y)}</div>${field("z", type === "sphere" ? "Center Z · mm" : "Base Z · mm", f.z)}<label>Operation<select name="operation"><option value="join">Join / add material</option><option value="cut">Cut / remove material</option><option value="intersect">Intersect / keep overlap</option></select></label>`;
  } else
    h += `<label>Edge numbers<input name="edges" value="${esc(f.edges.join(", "))}" required pattern="[0-9, ]+"></label>${old ? '<label><input type="checkbox" id="rebindEdges">Rebind to entered edge numbers</label>' : ""}<p>Edges refer to the preceding solid. After upstream changes, inspect and reselect edges if needed.</p>`;
  $("#featureFields").innerHTML = h;
  if ($("#featureForm select"))
    $("#featureForm select").value = f.operation || "join";
  modal("featureDialog");
}
function putFeature(f) {
  f.bodyId = f.bodyId || activeBody;
  if (["fillet", "chamfer"].includes(f.type) && !editingId) {
    f.edgeRefs = (activeMesh()?.edges || [])
      .filter((e) => f.edges.includes(e.id))
      .map((e) => e.ref);
  }
  if ($("#rebindEdges")?.checked) f.edgeRefs = [];
  if (editingId)
    commit(() => {
      const i = project.features.findIndex((x) => x.id === editingId);
      project.features[i] = { ...project.features[i], ...f };
      selected = editingId;
    }, "Feature updated");
  else
    commit(() => {
      f.id = uid();
      project.features.push(f);
      selected = f.id;
    }, "Feature added");
}
$("#featureForm").onsubmit = (e) => {
  e.preventDefault();
  const form = e.target,
    data = new FormData(form),
    type = form.dataset.type;
  try {
    let f = {
      type,
      name: String(data.get("name")).trim(),
      operation: data.get("operation") || "join",
    };
    if (!f.name) throw Error("Give this feature a name.");
    for (let [k, v] of data) {
      if (k === "edges") {
        f.edges = String(v)
          .split(",")
          .map((v) => Number(v.trim()));
        if (f.edges.some((v) => !Number.isInteger(v) || v < 1))
          throw Error("Enter comma-separated positive edge numbers.");
      } else if (!["name", "operation"].includes(k)) f[k] = Number(v);
    }
    putFeature(f);
    $("#featureDialog").close();
  } catch (err) {
    $("#featureError").textContent = err.message;
  }
};
function openSketch(type = "extrude", old = null) {
  editingId = old?.id || null;
  sketchState = {
    type,
    profile: "rectangle",
    plane: "XY",
    x: -25,
    y: -15,
    width: 50,
    height: 30,
    radius: 12,
    depth: 8,
    angle: 360,
    offset: 0,
    operation: "join",
    points: [],
    name: type === "revolve" ? "Revolve" : "Extrude",
    ...clone(old || {}),
    anchor: null,
  };
  const form = $("#sketchForm");
  fillPlaneOptions(old);
  for (let k of ["name", "plane", "offset", "depth", "angle", "operation"])
    form.elements[k].value = sketchState[k] ?? "";
  $("#sketchHeading").textContent =
    (old ? "Edit" : "Create") +
    (type === "revolve" ? " a revolved profile" : " a profile");
  $("#depthLabel").hidden = type === "revolve";
  form.elements.depth.required = type !== "revolve";
  $("#angleLabel").hidden = type !== "revolve";
  $("#revolveNote").hidden = type !== "revolve";
  $("#sketchError").textContent = "";
  $("#sketchExpressions")?.closest("label").remove();
  $("#sketchForm").insertAdjacentHTML(
    "beforeend",
    `<label class="advanced">Parameter expressions · field = expression<textarea id="sketchExpressions" rows="3">${esc(
      Object.entries(old?.expressions || {})
        .map(([k, v]) => k + " = " + v)
        .join("\n"),
    )}</textarea></label>`,
  );
  drawNumeric();
  drawSketch();
  modal("sketchDialog");
}
function drawNumeric() {
  const f = sketchState;
  let h = "";
  if (f.profile === "custom") {
    h =
      "<p>Custom profile · " +
      f.geometry.length +
      ' entities. Use Constraint editor to revise it.</p><button type="button" id="editCustom">Edit geometry & constraints</button>';
  } else if (f.profile === "polygon") {
    h = `<label>Vertices · x,y per line<textarea name="pointsText" rows="5" placeholder="0,0\n30,0\n20,20" required>${esc(f.points.map((p) => p.join(",")).join("\n"))}</textarea></label>`;
  } else {
    h += `<div class="field-row">${field("x", f.profile === "circle" ? "Center X · mm" : "Start X · mm", f.x)}${field("y", f.profile === "circle" ? "Center Y · mm" : "Start Y · mm", f.y)}</div>`;
    h +=
      f.profile === "circle"
        ? field("radius", "Radius · mm", f.radius, 0.01)
        : `<div class="field-row">${field("width", "Width · mm", f.width, 0.01)}${field("height", "Height · mm", f.height, 0.01)}</div>`;
  }
  $("#sketchNumeric").innerHTML = h;
  if ($("#editCustom")) $("#editCustom").onclick = openConstraints;
  $$("[data-shape]").forEach((b) =>
    b.classList.toggle("active", b.dataset.shape === f.profile),
  );
  $("#sketchHint").textContent =
    f.profile === "polygon"
      ? "Click each vertex. Create solid closes the loop. Or enter coordinates."
      : f.profile === "circle"
        ? "Click the center, then a point on the circumference."
        : "Click two opposite corners. Or enter dimensions on the right.";
  $("#sketchNumeric").oninput = () => {
    for (let k of ["x", "y", "width", "height", "radius"]) {
      let input = $(`#sketchNumeric [name=${k}]`);
      if (input && input.value !== "") f[k] = Number(input.value);
    }
    let t = $("#sketchNumeric textarea");
    if (t) {
      let points = t.value
        .trim()
        .split(/\n/)
        .map((l) => l.split(",").map(Number));
      if (points.every((p) => p.length === 2 && p.every(Number.isFinite)))
        f.points = points;
    }
    drawSketch();
  };
}
function drawSketch() {
  const f = sketchState;
  let max = 60;
  if (f.profile === "circle")
    max = Math.max(
      60,
      Math.abs(f.x) + f.radius + 10,
      Math.abs(f.y) + f.radius + 10,
    );
  else if (f.profile === "rectangle")
    max = Math.max(
      60,
      Math.abs(f.x) + f.width + 10,
      Math.abs(f.y) + f.height + 10,
    );
  else
    for (const p of f.points)
      max = Math.max(max, ...p.map((v) => Math.abs(v) + 10));
  max = Math.min(11000, max);
  const svg = $("#sketchCanvas");
  svg.setAttribute("viewBox", `${-max} ${-max * 0.75} ${max * 2} ${max * 1.5}`);
  let tick = 10 * Math.max(1, Math.ceil(max / 150));
  let h = `<defs><pattern id="sketchgrid" width="${tick}" height="${tick}" patternUnits="userSpaceOnUse"><path d="M ${tick} 0 H 0 V ${tick}" fill="none" stroke="#869aa333" stroke-width=".25"/></pattern></defs><rect x="${-max}" y="${-max}" width="${2 * max}" height="${2 * max}" fill="url(#sketchgrid)"/><path d="M ${-max} 0 H ${max}" stroke="#b46b65" stroke-width=".3"/><path d="M 0 ${-max} V ${max}" stroke="#669572" stroke-width=".3"/><text x="${max - 9}" y="-2" fill="#b46b65" font-size="4">X</text><text x="2" y="${-max * 0.75 + 7}" fill="#669572" font-size="4">Y</text><g transform="scale(1,-1)" stroke="#3984a5" stroke-width="${max / 140}" fill="#72b6d129">`;
  if (f.profile === "rectangle")
    h += `<rect x="${f.x}" y="${f.y}" width="${Math.max(0, f.width)}" height="${Math.max(0, f.height)}"/>`;
  else if (f.profile === "circle")
    h += `<circle cx="${f.x}" cy="${f.y}" r="${Math.max(0, f.radius)}"/>`;
  else if (f.profile === "custom") h += sketchSVG(f.geometry);
  else h += `<polygon points="${f.points.map((p) => p.join(",")).join(" ")}"/>`;
  const pts = f.profile === "polygon" ? f.points : f.anchor ? [f.anchor] : [];
  pts.forEach(
    (p) =>
      (h += `<circle cx="${p[0]}" cy="${p[1]}" r="${max / 90}" fill="#d69328" stroke="none"/>`),
  );
  h += "</g>";
  if (!["polygon", "custom"].includes(f.profile))
    h += `<text x="${-max + 5}" y="${max * 0.75 - 5}" font-size="${max / 17}" fill="#527b8c">${f.profile === "circle" ? "R " + fmt(f.radius) : fmt(f.width) + " × " + fmt(f.height)} mm</text>`;
  svg.innerHTML = h;
}
$("#sketchCanvas").onclick = (e) => {
  const svg = e.currentTarget,
    pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const v = pt.matrixTransform(svg.getScreenCTM().inverse()),
    snap = Number($("#sketchForm").elements.snap.value) || 1,
    p = [Math.round(v.x / snap) * snap, Math.round(-v.y / snap) * snap],
    f = sketchState;
  if (f.profile === "custom") return;
  if (f.profile === "polygon") {
    if (f.points.length >= 64) {
      $("#sketchError").textContent = "Maximum 64 vertices.";
      return;
    }
    f.points.push(p);
  } else if (!f.anchor) {
    f.anchor = p;
    f.x = p[0];
    f.y = p[1];
  } else {
    if (f.profile === "rectangle") {
      f.width = Math.max(snap, Math.abs(p[0] - f.anchor[0]));
      f.height = Math.max(snap, Math.abs(p[1] - f.anchor[1]));
      f.x = Math.min(p[0], f.anchor[0]);
      f.y = Math.min(p[1], f.anchor[1]);
    } else f.radius = Math.max(snap, Math.hypot(p[0] - f.x, p[1] - f.y));
    f.anchor = null;
  }
  drawNumeric();
  drawSketch();
};
$$("[data-shape]").forEach(
  (b) =>
    (b.onclick = () => {
      sketchState.profile = b.dataset.shape;
      sketchState.anchor = null;
      drawNumeric();
      drawSketch();
    }),
);
$("#clearSketch").onclick = () => {
  sketchState.points = [];
  sketchState.anchor = null;
  sketchState.width = 10;
  sketchState.height = 10;
  sketchState.radius = 5;
  drawNumeric();
  drawSketch();
};
$("#sketchForm").onsubmit = (e) => {
  e.preventDefault();
  try {
    let f = clone(sketchState);
    delete f.anchor;
    for (let [k, v] of new FormData(e.target)) {
      if (["name", "plane", "operation"].includes(k)) f[k] = String(v);
      else if (k === "pointsText")
        f.points = String(v)
          .trim()
          .split("\n")
          .map((l) => l.split(",").map(Number));
      else if (k !== "snap") f[k] = Number(v);
    }
    if (!f.name.trim()) throw Error("Give this feature a name.");
    if (
      f.profile === "polygon" &&
      (f.points.length < 3 ||
        f.points.length > 64 ||
        f.points.some(
          (p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)),
        ))
    )
      throw Error("Enter 3–64 vertices as x,y coordinate pairs.");
    f.expressions = parseExpressions($("#sketchExpressions").value);
    putFeature(f);
    $("#sketchDialog").close();
  } catch (e) {
    $("#sketchError").textContent = e.message;
  }
};
$$("[data-create]").forEach(
  (b) => (b.onclick = () => openFeature(b.dataset.create)),
);
$("#sketch").onclick =
  $("#emptySketch").onclick =
  $("#addFeature").onclick =
    () => openSketch();
$("#revolve").onclick = () => openSketch("revolve");
$$("[data-close]").forEach(
  (b) => (b.onclick = () => $("#" + b.dataset.close).close()),
);
$("#tree").onclick = (e) => {
  const s = e.target.closest("[data-suppress]"),
    b = e.target.closest("[data-id]");
  if (s)
    commit(() => {
      const f = project.features.find((f) => f.id === s.dataset.suppress);
      f.suppressed = !f.suppressed;
    }, "Feature suppression updated");
  else if (b) featureSelect(b.dataset.id);
};
$("#tree").ondblclick = (e) => {
  const b = e.target.closest("[data-id]");
  if (b) {
    const f = project.features.find((f) => f.id === b.dataset.id);
    openFeature(f.type, f);
  }
};
$("#timeline").onclick = (e) => {
  const b = e.target.closest("[data-id]");
  if (b) featureSelect(b.dataset.id);
};
$("#timeline").ondblclick = (e) => {
  const b = e.target.closest("[data-id]");
  if (b) {
    const f = project.features.find((f) => f.id === b.dataset.id);
    openFeature(f.type, f);
  }
};
$("#treeSearch").oninput = renderUI;
$("#projectName").onchange = (e) => {
  const v = e.target.value.trim() || "Untitled part";
  commit(() => (project.name = v), "Project renamed");
};
$("#undo").onclick = () => restore("undo");
$("#redo").onclick = () => restore("redo");
$("#fileButton").onclick = () => modal("fileDialog");
$("#help").onclick = () => modal("helpDialog");
$("#newProject").onclick = () => {
  replaceProject(
    fresh(),
    "New empty project · previous project available with Undo",
  );
  $("#fileDialog").close();
};
function loadSample() {
  replaceProject(
    sample(),
    "Bracket example loaded · previous project available with Undo",
  );
  $("#fileDialog").close();
}
$("#sample").onclick = $("#loadSample").onclick = loadSample;
$("#saveJson").onclick = $("#exportJson").onclick = saveJSON;
$("#openJson").onclick = () => $("#fileInput").click();
async function importFile(file) {
  try {
    if (!file) return;
    if (file.size > 18000000)
      throw Error("Project is larger than the 18 MB limit.");
    if (/\.(step|stp)$/i.test(file.name)) {
      await importSTEP(file);
      return;
    }
    const p = validate(JSON.parse(await file.text()));
    replaceProject(p, "Project imported");
    $("#fileDialog").close();
  } catch (e) {
    status("Import rejected: " + e.message);
    $("#modelError").textContent = "Import rejected: " + e.message;
    $("#modelError").hidden = false;
  }
}
$("#fileInput").onchange = (e) => {
  importFile(e.target.files[0]);
  e.target.value = "";
};
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  importFile(e.dataTransfer.files[0]);
});
$("#recovery").onclick = () => {
  try {
    const raw = localStorage.getItem(PREV);
    if (!raw) throw Error("No previous autosave exists yet.");
    replaceProject(
      validate(JSON.parse(raw)),
      "Previous autosave restored · Undo returns to current work",
    );
    $("#fileDialog").close();
  } catch (e) {
    status(e.message);
  }
};
$("#exportButton").onclick = () => {
  $("#exportScope").innerHTML =
    '<option value="">All visible bodies</option>' + bodyOptions();
  modal("exportDialog");
  $("#exportStatus").textContent = "";
};
$$("[data-export]").forEach(
  (b) =>
    (b.onclick = async () => {
      const fmt = b.dataset.export;
      const snapshot = clone(project),
        name = filename();
      $$("[data-export]").forEach((x) => (x.disabled = true));
      $("#exportStatus").textContent = "Rebuilding and exporting with FreeCAD…";
      try {
        const r = await fetch("./api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: snapshot,
            format: fmt,
            bodyId: fmt === "FCStd" ? null : $("#exportScope").value || null,
          }),
        });
        if (!r.ok) {
          const d = await r.json();
          throw Error(d.error);
        }
        download(await r.blob(), name + "." + fmt, "application/octet-stream");
        $("#exportStatus").textContent = fmt + " exported successfully.";
      } catch (e) {
        $("#exportStatus").textContent = "Export failed: " + e.message;
      } finally {
        $$("[data-export]").forEach((x) => (x.disabled = false));
      }
    }),
);
$("#fit").onclick = fit;
$("#projection").onclick = switchProjection;
$$("[data-view]").forEach((b) => (b.onclick = () => setView(b.dataset.view)));
$("#grid").onclick = () => {
  grid.visible = !grid.visible;
  axes.visible = grid.visible;
  $("#grid").classList.toggle("active", grid.visible);
};
for (const mode of ["orbit", "pan"])
  $("#" + mode).onclick = () => {
    navMode = mode;
    controls.mouseButtons.LEFT =
      mode === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    $("#orbit").classList.toggle("active", mode === "orbit");
    $("#pan").classList.toggle("active", mode === "pan");
    status(
      mode === "orbit"
        ? "Orbit mode · drag freely in any direction"
        : "Pan mode · drag to move the view",
    );
  };
$("#section").onclick = () => {
  const on = !$("#section").classList.contains("active");
  $("#section").classList.toggle("active", on);
  $("#sectionControl").hidden = !on;
  [...objects.children, ...edgeGroup.children].forEach((o) => {
    o.material.clippingPlanes = on ? [clip] : [];
  });
  status(
    on
      ? "Visual section enabled · exports retain the complete solid"
      : "Section disabled",
  );
};
$("#sectionZ").oninput = (e) => (clip.constant = Number(e.target.value));
$("#closeBrowser").onclick = () => togglePanel("browserPanel", true);
$("#openBrowser").onclick = () => togglePanel("browserPanel");
$("#closeInspector").onclick = () => togglePanel("inspector", true);
$("#openInspector").onclick = () => togglePanel("inspector");
$("#inspect").onclick = () => {
  selected = null;
  renderUI();
  togglePanel("inspector", false);
};
$("#theme").onchange = (e) => applyTheme(e.target.value);
$("#mode").onchange = (e) => {
  document.body.classList.toggle(
    "advanced-mode",
    e.target.value === "advanced",
  );
  try {
    localStorage.setItem("solidbench.mode", e.target.value);
  } catch {}
};
$("#retryKernel").onclick = async () => {
  await health();
  scheduleModel();
};
$("#report").onclick = () => {
  if (!currentMesh || !modelReady) {
    status("Recompute a valid solid before creating a report.");
    return;
  }
  const m = currentMesh;
  renderer.render(scene, camera);
  let node = $("#printReport");
  if (!node) {
    node = document.createElement("section");
    node.id = "printReport";
    node.hidden = true;
    document.body.append(node);
  }
  node.innerHTML = `<small>GREEN SHOE GARAGE · SOLIDBENCH v${VERSION}</small><h1>${esc(project.name)}</h1><p>Part review · ${new Date().toLocaleDateString()} · All dimensions in millimetres</p><img src="${renderer.domElement.toDataURL("image/png")}" alt="Current model view"><table><tr><th>Envelope</th><td>${m.bounds
    .slice(3)
    .map((v, i) => fmt(v - m.bounds[i]))
    .join(
      " × ",
    )} mm</td></tr><tr><th>Volume</th><td>${fmt(m.volume)} mm³</td></tr><tr><th>Surface area</th><td>${fmt(m.area)} mm²</td></tr><tr><th>Geometry</th><td>${m.solids} solids · ${m.faces} faces · FreeCAD valid</td></tr></table><h2>Feature history</h2><table><tr><th>Feature</th><th>Type</th><th>Operation</th><th>Status</th></tr>${project.features.map((f) => `<tr><td>${esc(f.name)}</td><td>${labels[f.type]}</td><td>${esc(f.operation || "join")}</td><td>${f.suppressed ? "Suppressed" : "Active"}</td></tr>`).join("")}</table><p>This review sheet is not a dimensioned manufacturing drawing. Geometry and fit should be checked before fabrication. ${$("#section").classList.contains("active") ? "The illustration shows a visual section; reported values describe the full solid." : ""}</p>`;
  window.print();
};
window.addEventListener("keydown", (e) => {
  if (
    ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) ||
    $("dialog[open]")
  )
    return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    restore(e.shiftKey ? "redo" : "undo");
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveJSON();
  } else if (e.key.toLowerCase() === "f") fit();
  else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
  else if (["0", "1", "2", "3"].includes(e.key))
    setView({ 0: "iso", 1: "top", 2: "front", 3: "right" }[e.key]);
});
window.addEventListener("beforeunload", () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(project));
  } catch {}
});
try {
  applyTheme(localStorage.getItem("solidbench.theme") || "light");
  const mode = localStorage.getItem("solidbench.mode") || "easy";
  $("#mode").value = mode;
  document.body.classList.toggle("advanced-mode", mode === "advanced");
  togglePanel(
    "browserPanel",
    innerWidth < 641 ||
      localStorage.getItem("solidbench.browserPanel") === "closed",
  );
  togglePanel(
    "inspector",
    innerWidth < 901 ||
      localStorage.getItem("solidbench.inspector") === "closed",
  );
} catch {
  applyTheme("light");
}
for (const id of ["browserPanel", "inspector"]) {
  try {
    const width = Number(localStorage.getItem("solidbench.width." + id));
    if (width && innerWidth >= 1200) $("#" + id).style.width = width + "px";
  } catch {}
  new ResizeObserver((entries) => {
    const width = entries[0].borderBoxSize?.[0]?.inlineSize;
    if (width && innerWidth >= 1200)
      try {
        localStorage.setItem("solidbench.width." + id, width);
      } catch {}
  }).observe($("#" + id));
}
if ("serviceWorker" in navigator && location.protocol !== "file:")
  navigator.serviceWorker
    .register("./sw.js")
    .catch(() =>
      status(
        "Offline interface caching unavailable; local hosting still works.",
      ),
    );

// v0.2–1.0 workbench extensions.
const bodyOptions = () =>
  project.bodies
    .map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`)
    .join("");
function activeMesh() {
  return (
    bodyMeshes.find((b) => b.id === activeBody)?.sourceMesh ||
    bodyMeshes.find((b) => b.id === activeBody)?.mesh ||
    null
  );
}
function renderBodies() {
  if (!project.bodies) project = validate(project);
  if (!project.bodies.some((b) => b.id === activeBody))
    activeBody = project.bodies[0].id;
  $("#bodyBar").innerHTML =
    `<label>Active body<select id="activeBody">${bodyOptions()}</select></label><button id="manageBodies" title="Manage bodies and assembly placement">⚙</button>`;
  $("#activeBody").value = activeBody;
  $("#activeBody").onchange = (e) => {
    activeBody = e.target.value;
    selected = null;
    selectedEdges = [];
    highlightEdges();
    renderInspector();
  };
  $("#manageBodies").onclick = openBodies;
}
function createDialog(id, title, content, wide = false) {
  let d = $("#" + id);
  if (d) d.remove();
  d = document.createElement("dialog");
  d.id = id;
  if (wide) d.className = "wide-dialog";
  d.innerHTML = `<div class="dialog-top"><h2>${esc(title)}</h2><button class="close-dialog" aria-label="Close">×</button></div>${content}`;
  document.body.append(d);
  d.querySelector(".close-dialog").onclick = () => d.close();
  d.showModal();
  return d;
}
async function api(path, data) {
  const r = await fetch(
    "./api/" + path,
    data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {},
  );
  const d = await r.json();
  if (r.status === 401 && path !== "login") {
    showLogin();
    throw Error("Sign in to the host to continue.");
  }
  if (!r.ok || !d.ok) throw Error(d.error || "Request failed");
  return d;
}
async function cadJob(req, track = false) {
  const created = await api("jobs", req);
  if (track) activeJob = created.id;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 120));
      const j = await api("jobs/" + created.id);
      if (j.state === "complete") return j.result;
      if (j.state === "failed" || j.state === "cancelled")
        throw Error(j.error || "Job cancelled");
    }
  } finally {
    if (track && activeJob === created.id) activeJob = null;
  }
}
$("#cancelJob").onclick = async () => {
  if (activeJob)
    try {
      await api("jobs/" + activeJob + "/cancel", {});
      status("Modeling cancelled. Your feature edits are retained.");
    } catch (e) {
      status(e.message);
    }
};
function showLogin() {
  if ($("#loginDialog")?.open) return;
  const d = createDialog(
    "loginDialog",
    "Sign in to your host",
    `<form id="loginForm"><label>Host password<input name="password" type="password" autocomplete="current-password" required></label><p class="error" id="loginError"></p><button class="primary">Sign in</button></form>`,
  );
  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api("login", { password: e.target.elements.password.value });
      d.close();
      health();
      scheduleModel();
    } catch (e) {
      $("#loginError").textContent = e.message;
    }
  };
}
function openTools() {
  const entries = [
    ["loft", "Loft", "Blend closed profiles"],
    ["sweep", "Sweep", "Circular profile along a 3D path"],
    ["shell", "Shell", "Hollow a solid through selected faces"],
    ["draft", "Draft", "Taper faces from a neutral plane"],
    ["mirror", "Mirror", "Reflect the active body"],
    ["pattern", "Pattern", "Repeat linearly or around Z"],
    ["transform", "Transform", "Move or rotate body geometry"],
    ["boolean", "Body boolean", "Join, cut or intersect another body"],
  ];
  const d = createDialog(
    "toolsDialog",
    "Modeling tools",
    `<div class="tool-menu">${entries.map(([id, title, desc]) => `<button data-advanced="${id}"><b>${title}</b><small>${desc}</small></button>`).join("")}</div><div class="dialog-actions"><button id="parametersTool">Parameters</button><button id="bodiesTool">Bodies & joints</button><button id="interferenceTool">Interference</button><button id="drawingTool">Drawing sheet</button></div><div class="dialog-actions"><label>Detail level <select id="toolsMode"><option value="easy">Easy</option><option value="advanced">Advanced</option></select></label><button id="stepTool">Import STEP</button></div>`,
    true,
  );
  $("#toolsMode").value = $("#mode").value;
  $("#toolsMode").onchange = (e) => {
    $("#mode").value = e.target.value;
    $("#mode").dispatchEvent(new Event("change"));
  };
  $$("[data-advanced]").forEach(
    (b) =>
      (b.onclick = () => {
        d.close();
        openAdvanced(b.dataset.advanced);
      }),
  );
  $("#parametersTool").onclick = () => {
    d.close();
    openParameters();
  };
  $("#bodiesTool").onclick = () => {
    d.close();
    openBodies();
  };
  $("#interferenceTool").onclick = () => {
    d.close();
    checkInterference();
  };
  $("#drawingTool").onclick = () => {
    d.close();
    openDrawing();
  };
  $("#stepTool").onclick = () => {
    d.close();
    $("#fileInput").click();
  };
}
$("#moreTools").onclick = openTools;
function operationSelect() {
  return `<label>Operation<select name="operation"><option value="join">Join / add material</option><option value="cut">Cut / remove material</option><option value="intersect">Keep intersection</option></select></label>`;
}
function openAdvanced(type, old = null) {
  editingId = old?.id || null;
  const f = old || {},
    numf = (k, l, v, min) => field(k, l, f[k] ?? v, min);
  let h = `<label>Name<input name="name" value="${esc(f.name || labels[type])}" maxlength="120" required></label>`;
  if (type === "loft") {
    h += `<p>Parallel sections in XY. Each row: Z, center X, center Y, width, height. Circle profiles use width as diameter. Section values are in mm.</p><label>Profile<select name="sectionShape"><option value="rectangle">Rectangle</option><option value="circle">Circle</option></select></label><label>Sections<textarea name="sectionsText" rows="5" required>${esc(f.sections?.map((s) => [s.offset, s.profile === "circle" ? s.x : s.x + s.width / 2, s.profile === "circle" ? s.y : s.y + s.height / 2, s.profile === "circle" ? s.radius * 2 : s.width, s.profile === "circle" ? s.radius * 2 : s.height].join(",")).join("\n") || "0,0,0,40,30\n30,0,0,20,15")}</textarea></label><label>Surface<select name="ruled"><option value="false">Smooth loft</option><option value="true">Ruled loft</option></select></label>${operationSelect()}`;
  }
  if (type === "sweep")
    h += `${numf("radius", "Profile radius · mm", 3, 0.01)}<label>Path · x,y,z per line<textarea name="pathText" rows="5" required>${esc(f.path?.map((p) => p.join(",")).join("\n") || "0,0,0\n0,0,30\n20,0,50")}</textarea></label>${operationSelect()}`;
  if (type === "shell")
    h += `${numf("thickness", "Wall thickness · mm", 2, 0.01)}<label>Faces to remove · comma-separated<input name="faces" value="${esc(f.faces?.join(",") || 6)}" required></label><p>Face numbers are listed in Inspect. Material is offset inward.</p>`;
  if (type === "draft")
    h += `<label>Faces to taper<input name="faces" value="${esc(f.faces?.join(",") || "1,2,3,4")}" required></label>${numf("neutralFace", "Neutral face number", 5, 1)}${numf("angle", "Draft angle · degrees", 5)}<p>Choose planar neutral geometry. Face numbering is checked during recompute.</p>`;
  if (type === "transform")
    h += `<div class="field-row">${numf("dx", "Move X · mm", 0)}${numf("dy", "Move Y · mm", 0)}</div>${numf("dz", "Move Z · mm", 0)}${numf("angle", "Rotation · degrees", 0)}<div class="field-row">${numf("ax", "Axis X", 0)}${numf("ay", "Axis Y", 0)}</div>${numf("az", "Axis Z", 1)}<p>Rotation is about the body origin, then translation.</p>`;
  if (type === "mirror")
    h += `<div class="field-row">${numf("nx", "Plane normal X", 1)}${numf("ny", "Plane normal Y", 0)}</div>${numf("nz", "Plane normal Z", 0)}<div class="field-row">${numf("ox", "Plane origin X · mm", 0)}${numf("oy", "Plane origin Y · mm", 0)}</div>${numf("oz", "Plane origin Z · mm", 0)}<label>Original geometry<select name="keep"><option value="true">Keep and join</option><option value="false">Replace with mirror</option></select></label>`;
  if (type === "pattern")
    h += `<label>Pattern<select name="pattern"><option value="linear">Linear</option><option value="circular">Circular about Z</option></select></label>${numf("count", "Instance count (includes original)", 3, 2)}<div class="field-row">${numf("dx", "Linear spacing X · mm", 50)}${numf("dy", "Linear spacing Y · mm", 0)}</div>${numf("dz", "Linear spacing Z · mm", 0)}${numf("angle", "Circular sweep · degrees", 360)}<p>Circular copies use evenly spaced angles within this sweep, about the body origin.</p>`;
  if (type === "boolean")
    h += `<label>Source body<select name="sourceBody">${project.bodies
      .filter((b) => b.id !== activeBody)
      .map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`)
      .join(
        "",
      )}</select></label>${operationSelect()}<p>Uses the source body's model geometry before assembly placement. The source remains independently editable.</p>`;
  h += `<label class="advanced">Parameter expressions · field = expression<textarea name="expressionText" rows="2" placeholder="depth = thickness * 2">${esc(
    Object.entries(f.expressions || {})
      .map(([k, v]) => k + " = " + v)
      .join("\n"),
  )}</textarea></label>`;
  const d = createDialog(
    "advancedDialog",
    (old ? "Edit " : "Add ") + labels[type],
    `<form id="advancedForm">${h}<p id="advancedError" class="error"></p><div class="dialog-actions"><button class="primary" type="submit">Apply feature</button></div></form>`,
  );
  const form = $("#advancedForm");
  for (const k of ["operation", "pattern", "sourceBody"])
    if (form.elements[k] && f[k]) form.elements[k].value = f[k];
  if (form.elements.keep) form.elements.keep.value = String(f.keep ?? true);
  if (form.elements.ruled) form.elements.ruled.value = String(f.ruled ?? false);
  if (form.elements.sectionShape)
    form.elements.sectionShape.value = f.sections?.[0]?.profile || "rectangle";
  form.onsubmit = (e) => {
    e.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(form));
      let next = {
        ...clone(f),
        type,
        name: data.name,
        bodyId: f.bodyId || activeBody,
        operation: data.operation || "join",
      };
      for (const [k, v] of Object.entries(data)) {
        if (["name", "operation", "pattern", "sourceBody"].includes(k))
          next[k] = v;
        else if (["keep", "ruled"].includes(k)) next[k] = v === "true";
        else if (k === "faces")
          next.faces = v.split(",").map((v) => Number(v.trim()));
        else if (
          ![
            "expressionText",
            "pathText",
            "sectionsText",
            "sectionShape",
          ].includes(k)
        )
          next[k] = Number(v);
      }
      next.expressions = parseExpressions(data.expressionText);
      if (type === "sweep") next.path = parseRows(data.pathText, 3);
      if (type === "loft")
        next.sections = parseRows(data.sectionsText, 5).map(
          ([z, x, y, w, h]) => ({
            profile: data.sectionShape,
            plane: "XY",
            offset: z,
            x: data.sectionShape === "circle" ? x : x - w / 2,
            y: data.sectionShape === "circle" ? y : y - h / 2,
            width: w,
            height: h,
            radius: w / 2,
          }),
        );
      putFeature(next);
      d.close();
    } catch (e) {
      $("#advancedError").textContent = e.message;
    }
  };
}
function parseRows(text, cols) {
  const rows = text
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => l.split(",").map((v) => Number(v.trim())));
  if (
    rows.some(
      (r) =>
        r.length !== cols ||
        r.some((v) => !Number.isFinite(v) || Math.abs(v) > 10000),
    )
  )
    throw Error(`Use ${cols} finite comma-separated values per line.`);
  return rows;
}
function parseExpressions(text = "") {
  const out = {};
  for (const line of text.split("\n").filter((x) => x.trim())) {
    const match = line.match(/^\s*([a-zA-Z]+)\s*=\s*(.+)$/);
    if (!match) throw Error("Use field = expression on each line.");
    out[match[1]] = match[2];
  }
  return out;
}
function openParameters() {
  const d = createDialog(
    "parametersDialog",
    "Named parameters",
    `<p>Dimensions in mm; angles in degrees. Values can reference parameters above them using + − * / and parentheses. Enter one name = expression per line.</p><form id="parameterForm"><textarea name="parameters" rows="10" style="width:100%" placeholder="thickness = 3\nwallHeight = thickness * 8">${esc(project.parameters.map((p) => p.name + " = " + p.value).join("\n"))}</textarea><p>Assign expressions to feature fields using Edit feature → Parameter expressions. Numeric values are used when no expression is set.</p><p id="parameterError" class="error"></p><button class="primary">Apply parameters</button></form>`,
  );
  $("#parameterForm").onsubmit = (e) => {
    e.preventDefault();
    try {
      const raw = e.target.elements.parameters.value;
      const rows = raw
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          const m = l.match(/^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.+)$/);
          if (!m) throw Error("Use name = value on each line.");
          return { name: m[1], value: m[2] };
        });
      commit(() => (project.parameters = rows), "Parameters updated");
      d.close();
    } catch (e) {
      $("#parameterError").textContent = e.message;
    }
  };
}
function openBodies() {
  const d = createDialog(
    "bodiesDialog",
    "Bodies & assembly placement",
    `<p>Each body has its own feature history. Assembly placement moves the component after its features are built.</p><div id="bodyRows"></div><div class="dialog-actions"><button id="newBody">+ New body</button><button id="interferenceBody">Check interference</button></div>`,
    true,
  );
  function rows() {
    $("#bodyRows").innerHTML = project.bodies
      .map(
        (b) =>
          `<div class="body-card"><div><button data-body-edit="${esc(b.id)}"><b>${esc(b.name)}</b></button><small>${project.features.filter((f) => f.bodyId === b.id).length} features · ${esc(b.joint?.kind || "fixed")}</small></div><input aria-label="${esc(b.name)} color" type="color" value="${esc(b.color || "#91a6ad")}" data-color="${esc(b.id)}"><button data-body-active="${esc(b.id)}">${activeBody === b.id ? "Active" : "Activate"}</button><button data-body-visible="${esc(b.id)}">${b.visible === false ? "Show" : "Hide"}</button><button data-body-copy="${esc(b.id)}">Copy</button></div>`,
      )
      .join("");
    $$("[data-body-edit]").forEach(
      (el) => (el.onclick = () => editBody(el.dataset.bodyEdit)),
    );
    $$("[data-body-active]").forEach(
      (el) =>
        (el.onclick = () => {
          activeBody = el.dataset.bodyActive;
          renderBodies();
          rows();
        }),
    );
    $$("[data-body-visible]").forEach(
      (el) =>
        (el.onclick = () => {
          commit(() => {
            const b = project.bodies.find(
              (b) => b.id === el.dataset.bodyVisible,
            );
            b.visible = b.visible === false;
          }, "Body visibility changed");
          rows();
        }),
    );
    $$("[data-color]").forEach(
      (el) =>
        (el.onchange = () =>
          commit(
            () =>
              (project.bodies.find((b) => b.id === el.dataset.color).color =
                el.value),
            "Body appearance changed",
          )),
    );
    $$("[data-body-copy]").forEach(
      (el) =>
        (el.onclick = () => {
          const b = project.bodies.find((b) => b.id === el.dataset.bodyCopy);
          commit(() => {
            const copy = clone(b);
            copy.id = uid();
            copy.name += " copy";
            copy.placement = {
              ...copy.placement,
              x: (copy.placement?.x || 0) + 50,
            };
            project.bodies.push(copy);
            const copied = project.features
              .filter((f) => f.bodyId === b.id)
              .map((f) => ({ ...clone(f), id: uid(), bodyId: copy.id }));
            project.features.push(...copied);
            activeBody = copy.id;
          }, "Body copied");
          rows();
        }),
    );
  }
  rows();
  $("#newBody").onclick = () => {
    commit(() => {
      const b = {
        id: uid(),
        name: "Body " + (project.bodies.length + 1),
        visible: true,
        color: "#bdc49e",
      };
      project.bodies.push(b);
      activeBody = b.id;
      selected = null;
    }, "New body created — add a feature");
    d.close();
  };
  $("#interferenceBody").onclick = () => {
    d.close();
    checkInterference();
  };
}
function editBody(id) {
  const b = project.bodies.find((b) => b.id === id),
    p = b.placement || {},
    j = b.joint || {};
  const d = createDialog(
    "bodyEditDialog",
    "Component properties",
    `<form id="bodyForm"><label>Name<input name="name" value="${esc(b.name)}" required maxlength="120"></label><div class="field-row">${field("x", "Position X · mm", p.x)}${field("y", "Position Y · mm", p.y)}</div>${field("z", "Position Z · mm", p.z)}${field("angle", "Rotation about Z · degrees", p.angle)}<label>Joint to the grounded coordinate system<select name="kind"><option value="fixed">Fixed</option><option value="revolute">Revolute</option><option value="slider">Slider</option></select></label>${field("value", "Joint coordinate · degrees or mm", j.value)}<div class="field-row">${field("min", "Lower limit", j.min ?? -360)}${field("max", "Upper limit", j.max ?? 360)}</div><div class="field-row">${field("ax", "Joint axis X", j.ax ?? 0)}${field("ay", "Joint axis Y", j.ay ?? 0)}</div>${field("az", "Joint axis Z", j.az ?? 1)}<div class="field-row">${field("px", "Pivot X · mm", j.px)}${field("py", "Pivot Y · mm", j.py)}</div>${field("pz", "Pivot Z · mm", j.pz)}<p>Joint motion is applied in body coordinates before assembly placement. This is a kinematic positioning control, without dynamics or a multi-mate solver.</p><div class="dialog-actions"><button type="button" id="removeBody">Delete body</button><button class="primary">Apply</button></div></form>`,
  );
  $('#bodyForm [name="kind"]').value = j.kind || "fixed";
  $("#bodyForm").onsubmit = (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    commit(() => {
      b.name = data.name;
      b.placement = Object.fromEntries(
        ["x", "y", "z", "angle"].map((k) => [k, Number(data[k])]),
      );
      b.joint = {
        kind: data.kind,
        ...Object.fromEntries(
          ["value", "min", "max", "ax", "ay", "az", "px", "py", "pz"].map(
            (k) => [k, Number(data[k])],
          ),
        ),
      };
    }, "Component placement updated");
    d.close();
    $("#bodiesDialog")?.close();
  };
  $("#removeBody").onclick = () => {
    if (project.bodies.length === 1) {
      status("Keep at least one body. Use New project for a fresh start.");
      return;
    }
    commit(() => {
      project.bodies = project.bodies.filter((x) => x.id !== id);
      project.features = project.features.filter((f) => f.bodyId !== id);
      activeBody = project.bodies[0].id;
      selected = null;
    }, "Body and its features removed · Undo restores them");
    d.close();
    $("#bodiesDialog")?.close();
  };
}
async function importSTEP(file) {
  if (file.size > 12000000) throw Error("STEP files must be below 12 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let raw = "";
  for (let i = 0; i < bytes.length; i += 8192)
    raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const id = uid();
  commit(() => {
    project.bodies.push({
      id,
      name: file.name.replace(/\.(step|stp)$/i, ""),
      visible: true,
      color: "#b8b1cf",
    });
    project.features.push({
      id: uid(),
      bodyId: id,
      name: "Imported " + file.name,
      type: "import",
      operation: "join",
      step: btoa(raw),
    });
    activeBody = id;
    fitNext = true;
  }, "STEP imported into a new body");
  $("#fileDialog").close();
}
async function checkInterference() {
  const d = createDialog(
    "interferenceDialog",
    "Assembly interference",
    `<p id="interferenceResult">Computing exact solid intersections…</p>`,
  );
  try {
    const result = await cadJob({
      action: "interference",
      project: clone(project),
    });
    $("#interferenceResult").innerHTML = result.interferences.length
      ? result.interferences
          .map(
            (h) =>
              `<span class="finding"><b>Warning · High confidence</b><br>${esc(project.bodies.find((b) => b.id === h.a)?.name)} ↔ ${esc(project.bodies.find((b) => b.id === h.b)?.name)}<br>Overlap: ${fmt(h.volume)} mm³</span>`,
          )
          .join("")
      : "No volumetric overlap detected between the current component positions. Touching faces are not reported as interference.";
  } catch (e) {
    $("#interferenceResult").textContent = e.message;
  }
}
function fillPlaneOptions(old) {
  const select = $('#sketchForm [name="plane"]');
  select.innerHTML =
    '<option>XY</option><option>XZ</option><option>YZ</option><option value="FACE">Planar face</option><option value="CUSTOM">Custom datum</option>';
  let fields = $("#planeFields");
  if (!fields) {
    fields = document.createElement("div");
    fields.id = "planeFields";
    select.closest("label").after(fields);
  }
  function update() {
    const f = old || sketchState;
    if (select.value === "FACE") {
      fields.innerHTML = `<label>Face<select name="face">${(
        activeMesh()?.faceInfo || []
      )
        .filter((f) => f.planar)
        .map(
          (f) =>
            `<option value="${f.id}">Face ${f.id} · ${fmt(f.area)} mm²</option>`,
        )
        .join("")}</select></label>`;
      if (fields.querySelector("select"))
        fields.querySelector("select").value =
          f.face || fields.querySelector("select").value;
    } else if (select.value === "CUSTOM") {
      fields.innerHTML = ["ox", "oy", "oz", "nx", "ny", "nz"]
        .map((k) =>
          field(
            k,
            (k[0] === "o" ? "Origin " : "Normal ") + k[1].toUpperCase(),
            f[k] ?? (k === "nz" ? 1 : 0),
          ),
        )
        .join("");
    } else fields.innerHTML = "";
  }
  select.onchange = update;
  select.value = old?.plane || "XY";
  update();
}
// FreeCAD sketch constraint editor with explicit geometry and constraint rows.
let constraintDraft;
function baseGeometry(f) {
  if (f.profile === "custom") return clone(f.geometry);
  if (f.profile === "circle")
    return [{ kind: "circle", cx: f.x, cy: f.y, radius: f.radius }];
  const p =
    f.profile === "polygon"
      ? f.points
      : [
          [f.x, f.y],
          [f.x + f.width, f.y],
          [f.x + f.width, f.y + f.height],
          [f.x, f.y + f.height],
        ];
  return p.map((a, i) => ({
    kind: "line",
    x1: a[0],
    y1: a[1],
    x2: p[(i + 1) % p.length][0],
    y2: p[(i + 1) % p.length][1],
  }));
}
function sketchSVG(geos) {
  return geos
    .map((e) =>
      e.kind === "line"
        ? `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}" ${e.construction ? 'stroke-dasharray="2 2"' : ""}/>`
        : e.kind === "circle"
          ? `<circle cx="${e.cx}" cy="${e.cy}" r="${e.radius}"/>`
          : (() => {
              let a = (e.start * Math.PI) / 180,
                b = (e.end * Math.PI) / 180;
              return `<path d="M ${e.cx + e.radius * Math.cos(a)} ${e.cy + e.radius * Math.sin(a)} A ${e.radius} ${e.radius} 0 ${Math.abs(e.end - e.start) > 180 ? 1 : 0} 1 ${e.cx + e.radius * Math.cos(b)} ${e.cy + e.radius * Math.sin(b)}"/>`;
            })(),
    )
    .join("");
}
function openConstraints() {
  constraintDraft = {
    geometry: baseGeometry(sketchState),
    constraints: clone(sketchState.constraints || []),
  };
  const d = createDialog(
    "constraintsDialog",
    "Sketch geometry & constraints",
    `<p>Edit entities, then add constraints. Geometry is numbered from 1. Line endpoints are 1 and 2; circle centers use point 3.</p><div class="constraint-layout"><div><svg id="constraintPreview" viewBox="-65 -45 130 90"></svg><div class="dialog-actions"><button data-entity="line">+ Line</button><button data-entity="arc">+ Arc</button><button data-entity="circle">+ Circle</button></div><div id="entityRows"></div></div><div><h3>Constraints</h3><div id="constraintRows"></div><button id="addConstraint">+ Constraint</button><p id="solverStatus" role="status">Not solved yet</p><div class="dialog-actions"><button id="solveSketch">Solve</button><button id="useSolved" class="primary">Use profile</button></div></div></div>`,
    true,
  );
  renderConstraintEditor();
  $$("[data-entity]").forEach(
    (b) =>
      (b.onclick = () => {
        constraintDraft.geometry.push(
          b.dataset.entity === "line"
            ? { kind: "line", x1: 0, y1: 0, x2: 20, y2: 0 }
            : b.dataset.entity === "circle"
              ? { kind: "circle", cx: 0, cy: 0, radius: 10 }
              : { kind: "arc", cx: 0, cy: 0, radius: 10, start: 0, end: 180 },
        );
        renderConstraintEditor();
      }),
  );
  $("#addConstraint").onclick = () => {
    constraintDraft.constraints.push({
      kind: "Horizontal",
      a: 1,
      b: 2,
      pa: 2,
      pb: 1,
      value: 10,
    });
    renderConstraintEditor();
  };
  $("#solveSketch").onclick = () => solveDraft(false);
  $("#useSolved").onclick = () => solveDraft(true);
}
function renderConstraintEditor() {
  const f = constraintDraft;
  const pts = f.geometry.flatMap((g) =>
    g.kind === "line"
      ? [
          [g.x1, g.y1],
          [g.x2, g.y2],
        ]
      : [
          [g.cx - g.radius, g.cy - g.radius],
          [g.cx + g.radius, g.cy + g.radius],
        ],
  );
  if (pts.length) {
    const xs = pts.map((p) => p[0]),
      ys = pts.map((p) => -p[1]),
      x = Math.min(...xs),
      y = Math.min(...ys),
      w = Math.max(...xs) - x,
      h = Math.max(...ys) - y,
      pad = Math.max(w, h, 10) * 0.15;
    $("#constraintPreview").setAttribute(
      "viewBox",
      `${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}`,
    );
  }
  $("#constraintPreview").innerHTML =
    `<path d="M -65 0 H 65 M 0 -45 V 45" stroke="#7892a355"/><g transform="scale(1,-1)" fill="none" stroke="#4b9ebd" stroke-width=".7">${sketchSVG(f.geometry)}</g>`;
  $("#entityRows").innerHTML = f.geometry
    .map(
      (e, i) =>
        `<div class="entity-row"><b>${i + 1} · ${e.kind}</b>${Object.keys(e)
          .filter((k) => !["kind", "construction"].includes(k))
          .map(
            (k) =>
              `<label>${k}<input type="number" step="any" data-geom="${i}" data-key="${k}" value="${esc(e[k])}"></label>`,
          )
          .join(
            "",
          )}<label>Construction<input type="checkbox" data-construction="${i}" ${e.construction ? "checked" : ""}></label><button data-remove-entity="${i}">×</button></div>`,
    )
    .join("");
  const types = [
    "Horizontal",
    "Vertical",
    "Coincident",
    "Parallel",
    "Perpendicular",
    "Equal",
    "Tangent",
    "Distance",
    "Radius",
    "Diameter",
    "DistanceX",
    "DistanceY",
    "Block",
  ];
  $("#constraintRows").innerHTML = f.constraints
    .map(
      (c, i) =>
        `<div class="constraint-row"><b>${i + 1}</b><select data-constraint="${i}" data-key="kind" aria-label="Constraint type">${types.map((t) => `<option ${c.kind === t ? "selected" : ""}>${t}</option>`).join("")}</select>${["a", "pa", "b", "pb", "value"].map((k) => `<label>${{ a: "Entity A", pa: "Point A", b: "Entity B", pb: "Point B", value: "Value" }[k]}<input type="number" step="any" data-constraint="${i}" data-key="${k}" value="${esc(c[k] ?? (k === "value" ? 10 : 1))}"></label>`).join("")}<button data-remove-constraint="${i}">×</button></div>`,
    )
    .join("");
  $$("[data-geom]").forEach(
    (el) =>
      (el.onchange = () => {
        f.geometry[+el.dataset.geom][el.dataset.key] = Number(el.value);
        renderConstraintEditor();
      }),
  );
  $$("[data-construction]").forEach(
    (el) =>
      (el.onchange = () => {
        f.geometry[+el.dataset.construction].construction = el.checked;
        renderConstraintEditor();
      }),
  );
  $$("[data-constraint]").forEach(
    (el) =>
      (el.onchange = () => {
        f.constraints[+el.dataset.constraint][el.dataset.key] =
          el.dataset.key === "kind" ? el.value : Number(el.value);
        $("#solverStatus").textContent = "Changed · solve to validate";
      }),
  );
  $$("[data-remove-constraint]").forEach(
    (el) =>
      (el.onclick = () => {
        f.constraints.splice(+el.dataset.removeConstraint, 1);
        renderConstraintEditor();
      }),
  );
  $$("[data-remove-entity]").forEach(
    (el) =>
      (el.onclick = () => {
        const removed = +el.dataset.removeEntity + 1;
        f.geometry.splice(removed - 1, 1);
        f.constraints = f.constraints
          .filter(
            (c) =>
              c.a !== removed &&
              (![
                "Coincident",
                "Parallel",
                "Perpendicular",
                "Equal",
                "Tangent",
              ].includes(c.kind) ||
                c.b !== removed),
          )
          .map((c) => ({
            ...c,
            a: c.a > removed ? c.a - 1 : c.a,
            b: c.b > removed ? c.b - 1 : c.b,
          }));
        renderConstraintEditor();
      }),
  );
}
async function solveDraft(use) {
  $("#solverStatus").textContent = "Solving with FreeCAD…";
  try {
    const result = await cadJob({
      action: "sketch",
      sketch: { profile: "custom", plane: "XY", ...clone(constraintDraft) },
    });
    constraintDraft.geometry = result.geometry;
    $("#solverStatus").textContent =
      (result.diagnostics.fullyConstrained
        ? "Fully constrained"
        : "Under-constrained — add dimensions or fix geometry") +
      (result.closed ? " · closed profile" : " · open profile");
    if (use) {
      if (!result.closed)
        throw Error("Close the profile before using it for a solid.");
      sketchState.profile = "custom";
      sketchState.geometry = clone(constraintDraft.geometry);
      sketchState.constraints = clone(constraintDraft.constraints);
      $("#constraintsDialog").close();
      drawNumeric();
      drawSketch();
    } else renderConstraintEditor();
  } catch (e) {
    $("#solverStatus").textContent = e.message;
  }
}
$("#constraintsButton").onclick = openConstraints;
// Durable browser project catalog, revisions and autosave in IndexedDB.
let dbPromise = null,
  pendingWrites = 0;
function localDB() {
  if (!dbPromise)
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open("solidbench", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("records");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  return dbPromise;
}
async function dbGet(key) {
  const db = await localDB();
  return new Promise((resolve, reject) => {
    const r = db.transaction("records").objectStore("records").get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function dbPut(key, value) {
  const db = await localDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.objectStore("records").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
let saveChain = Promise.resolve();
async function durableSave() {
  const snapshot = clone(project);
  pendingWrites++;
  $("#saveStatus").textContent = "● Saving…";
  saveChain = saveChain
    .catch(() => {})
    .then(async () => {
      const prev = await dbGet("autosave");
      if (prev) await dbPut("previous", prev);
      await dbPut("autosave", { project: snapshot, at: Date.now() });
    });
  try {
    await saveChain;
    $("#saveStatus").textContent = "● Saved locally";
    $("#saveStatus").classList.remove("bad");
  } catch (e) {
    $("#saveStatus").textContent = "● Save failed · export JSON";
    $("#saveStatus").classList.add("bad");
    status("Browser storage is unavailable. Save a JSON copy.");
  } finally {
    pendingWrites--;
  }
}
async function openProjects() {
  const d = createDialog(
    "projectsDialog",
    "Projects & revisions",
    `<div class="project-toolbar"><label>Location<select id="projectLocation"><option value="local">This browser</option><option value="server">My CAD host</option></select></label><label>Revision label<input id="revisionLabel" placeholder="Before adding mounting holes" maxlength="120"></label><button id="saveRevision" class="primary">Save current revision</button><button id="saveProjectAs">Save as new project</button></div><p id="projectMessage" role="status"></p><div id="projectList"></div><div class="dialog-actions"><button id="emptyTemplate">New empty</button><button id="bracketTemplate">Bracket template</button><button id="paramTemplate">Parametric spacer template</button><button id="backupProject">Export current JSON backup</button></div>`,
    true,
  );
  const refresh = async () => {
    try {
      const remote = $("#projectLocation").value === "server";
      let list = remote
        ? (await api("projects")).projects
        : (await dbGet("catalog")) || [];
      $("#projectList").innerHTML = list.length
        ? list
            .map(
              (p) =>
                `<div class="project-row"><b>${esc(p.name)}</b><span>Revision ${p.revision} · ${new Date(p.updated * (remote ? 1000 : 1)).toLocaleDateString()}</span><button data-open-project="${esc(p.id)}">Open latest</button><button data-revisions="${esc(p.id)}">Revisions</button></div>`,
            )
            .join("")
        : "<p>No saved projects here yet. Save a revision to begin.</p>";
      $$("[data-open-project]").forEach(
        (el) =>
          (el.onclick = async () => {
            try {
              const id = el.dataset.openProject;
              const record = remote
                ? await api(
                    "projects/" +
                      id +
                      "/" +
                      list.find((p) => p.id === id).revision,
                  )
                : await dbGet("project:" + id);
              const p = remote
                ? record.project
                : record.revisions.at(-1).project;
              replaceProject(p, "Saved project opened");
              if (remote) {
                serverProjectId = id;
                serverRevision = record.revision;
              } else localProjectId = id;
              d.close();
            } catch (e) {
              $("#projectMessage").textContent = e.message;
            }
          }),
      );
      $$("[data-revisions]").forEach(
        (el) =>
          (el.onclick = async () => {
            const id = el.dataset.revisions;
            try {
              const record = remote
                ? await api("projects/" + id)
                : await dbGet("project:" + id);
              const revs = remote
                ? record.revisions
                : record.revisions.map((r, i) => ({
                    revision: i + 1,
                    label: r.label,
                    created: r.at / 1000,
                  }));
              $("#projectList").innerHTML =
                `<button id="backProjects">← Projects</button>${revs.map((r) => `<div class="project-row"><b>r${r.revision} · ${esc(r.label)}</b><small>${new Date(r.created * 1000).toLocaleString()}</small><button data-restore-revision="${r.revision}">Open this revision</button></div>`).join("")}`;
              $("#backProjects").onclick = refresh;
              $$("[data-restore-revision]").forEach(
                (btn) =>
                  (btn.onclick = async () => {
                    const rev = Number(btn.dataset.restoreRevision),
                      row = remote
                        ? await api("projects/" + id + "/" + rev)
                        : record.revisions[rev - 1];
                    replaceProject(
                      row.project,
                      "Revision opened; later history is retained",
                    );
                    if (remote) {
                      serverProjectId = id;
                      serverRevision = list.find((p) => p.id === id).revision;
                    } else localProjectId = id;
                    d.close();
                  }),
              );
            } catch (e) {
              $("#projectMessage").textContent = e.message;
            }
          }),
      );
    } catch (e) {
      $("#projectMessage").textContent = e.message;
    }
  };
  const save = async (asNew) => {
    try {
      const label = $("#revisionLabel").value || "Saved revision";
      if ($("#projectLocation").value === "server") {
        const r = await api("projects/save", {
          id: asNew ? null : serverProjectId,
          expectedRevision: asNew ? 0 : serverRevision,
          project: clone(project),
          label,
        });
        serverProjectId = r.id;
        serverRevision = r.revision;
      } else {
        if (asNew || !localProjectId) localProjectId = uid();
        const rec = (await dbGet("project:" + localProjectId)) || {
          revisions: [],
        };
        rec.revisions.push({ label, project: clone(project), at: Date.now() });
        await dbPut("project:" + localProjectId, rec);
        const list = ((await dbGet("catalog")) || []).filter(
          (p) => p.id !== localProjectId,
        );
        list.unshift({
          id: localProjectId,
          name: project.name,
          revision: rec.revisions.length,
          updated: Date.now(),
        });
        await dbPut("catalog", list);
      }
      $("#projectMessage").textContent =
        "Revision saved. Earlier revisions are retained.";
      await refresh();
    } catch (e) {
      $("#projectMessage").textContent = e.message;
    }
  };
  $("#projectLocation").onchange = refresh;
  $("#saveRevision").onclick = () => save(false);
  $("#saveProjectAs").onclick = () => save(true);
  $("#backupProject").onclick = saveJSON;
  $("#emptyTemplate").onclick = () => {
    replaceProject(fresh(), "Empty project created");
    d.close();
  };
  $("#bracketTemplate").onclick = () => {
    replaceProject(sample(), "Bracket template loaded");
    d.close();
  };
  $("#paramTemplate").onclick = () => {
    replaceProject(
      {
        app: "SOLIDBENCH",
        schema: 2,
        name: "Parametric spacer",
        version: VERSION,
        units: "mm",
        parameters: [
          { name: "diameter", value: "30" },
          { name: "bore", value: "8" },
          { name: "thickness", value: "12" },
        ],
        bodies: [
          { id: "main", name: "Spacer", color: "#b5b8a0", visible: true },
        ],
        features: [
          {
            id: "outer",
            bodyId: "main",
            name: "Outside",
            type: "cylinder",
            radius: 15,
            depth: 12,
            expressions: { radius: "diameter / 2", depth: "thickness" },
            operation: "join",
          },
          {
            id: "bore",
            bodyId: "main",
            name: "Bore",
            type: "cylinder",
            radius: 4,
            depth: 12,
            expressions: { radius: "bore / 2", depth: "thickness" },
            operation: "cut",
          },
        ],
      },
      "Parametric spacer template loaded",
    );
    d.close();
  };
  await refresh();
}
let localProjectId = null;
$("#projectBrowser").onclick = openProjects;
$("#recovery").onclick = async () => {
  try {
    const previous = await dbGet("previous");
    const p = previous?.project || JSON.parse(localStorage.getItem(PREV));
    if (!p) throw Error("No previous saved state exists yet.");
    replaceProject(
      validate(p),
      "Previous autosave restored · Undo returns to current work",
    );
    $("#fileDialog").close();
  } catch (e) {
    status(e.message);
  }
};
// Exact orthographic projections with envelope, diameter and reference dimensions.
let drawingResult = null,
  drawingSection = null;
const drawingDimensions = () => project.drawingDimensions || [];
function dimensionValid(d) {
  const view = drawingResult?.views[d.view];
  return (
    view &&
    (d.section ?? null) === drawingSection &&
    [d.a, d.b].every((p) =>
      view.vertices.some((v) => Math.hypot(v[0] - p[0], v[1] - p[1]) < 1e-5),
    )
  );
}
function dimensionMarkup(d, font, stroke) {
  const [a, b] = [d.a, d.b];
  let p, q, value;
  if (d.kind === "horizontal") {
    const y = Math.max(a[1], b[1]) + d.offset;
    p = [a[0], y];
    q = [b[0], y];
    value = Math.abs(b[0] - a[0]);
  } else if (d.kind === "vertical") {
    const x = Math.min(a[0], b[0]) - d.offset;
    p = [x, a[1]];
    q = [x, b[1]];
    value = Math.abs(b[1] - a[1]);
  } else {
    value = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / value,
      ny = (b[0] - a[0]) / value;
    p = [a[0] + nx * d.offset, a[1] + ny * d.offset];
    q = [b[0] + nx * d.offset, b[1] + ny * d.offset];
  }
  const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2],
    tick = font * 0.25;
  return `<g stroke="#75481e" stroke-width="${stroke}" fill="none"><path d="M ${a} L ${p} L ${q} L ${b} M ${p[0] - tick} ${p[1] + tick} l ${tick * 2} ${-tick * 2} M ${q[0] - tick} ${q[1] + tick} l ${tick * 2} ${-tick * 2}"/></g><text x="${mid[0]}" y="${mid[1] - font * 0.3}" text-anchor="middle" fill="#75481e" stroke="white" stroke-width="${font * 0.15}" paint-order="stroke" font-size="${font}" font-family="sans-serif">${fmt(value, 3)}${d.tolerance ? " ± " + fmt(d.tolerance, 3) : ""}</text>`;
}
function drawingSVG(view, title, markers = false) {
  const [x0, y0, x1, y1] = view.bounds,
    w = x1 - x0,
    h = y1 - y0,
    dimensions = drawingDimensions().filter(
      (d) => d.view === title && dimensionValid(d),
    ),
    pad = Math.max(
      Math.max(w, h, 10) * 0.24,
      ...dimensions.map((d) => Math.abs(d.offset) + 5),
    ),
    font = Math.max((h + pad * 2.8) / 20, (w + pad * 2.8) / 40),
    stroke = font / 12;
  let lines = `<g fill="none" stroke="#174e72" stroke-width="${stroke}"><path d="M ${x0} ${y1 + pad * 0.2} V ${y1 + pad * 0.7} M ${x1} ${y1 + pad * 0.2} V ${y1 + pad * 0.7} M ${x0} ${y1 + pad * 0.5} H ${x1} M ${x0 - pad * 0.2} ${y0} H ${x0 - pad * 0.7} M ${x0 - pad * 0.2} ${y1} H ${x0 - pad * 0.7} M ${x0 - pad * 0.5} ${y0} V ${y1}"/></g><g fill="#174e72" font-family="sans-serif" font-size="${font}"><text text-anchor="middle" x="${(x0 + x1) / 2}" y="${y1 + pad * 0.48}">${fmt(w)} mm</text><text text-anchor="middle" transform="translate(${x0 - pad * 0.55},${(y0 + y1) / 2}) rotate(-90)">${fmt(h)} mm</text></g>`;
  // Space diameter leaders along the upper margin rather than on top of the part.
  const circles = view.circles.slice(0, 16);
  circles.forEach((c, i) => {
    const tx = x0 + ((i + 0.5) * w) / Math.max(1, circles.length),
      ty = y0 - pad * (0.5 + (i % 2) * 0.45);
    lines += `<path d="M ${c.x} ${c.y} L ${tx} ${ty}" stroke="#174e72" stroke-width="${stroke}" fill="none"/><text x="${tx}" y="${ty - font * 0.2}" text-anchor="middle" fill="#174e72" font-size="${font}" font-family="sans-serif">Ø${fmt(c.diameter)}</text>`;
  });
  lines += dimensions.map((d) => dimensionMarkup(d, font, stroke)).join("");
  const dots = markers
    ? view.vertices
        .map(
          (p, i) =>
            `<circle data-dim-point="${i}" data-dim-view="${title}" cx="${p[0]}" cy="${p[1]}" r="${font * 0.6}" fill="#d58930" fill-opacity=".45" stroke="#75481e" stroke-width="${stroke}" style="cursor:crosshair"><title>Point ${i + 1} · ${fmt(p[0])}, ${fmt(p[1])}</title></circle>`,
        )
        .join("")
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}" viewBox="${x0 - pad * 1.4} ${y0 - pad * 1.4} ${w + pad * 2.8} ${h + pad * 2.8}"><rect x="${x0 - pad * 1.4}" y="${y0 - pad * 1.4}" width="${w + pad * 2.8}" height="${h + pad * 2.8}" fill="white"/>${view.svg.replaceAll('stroke-width="1.0"', `stroke-width="${stroke * 1.5}"`)}${lines}${dots}</svg>`;
}
async function openDrawing() {
  const d = createDialog(
    "drawingDialog",
    "Drawing sheet",
    `<div class="project-toolbar"><label>Drawing note<input id="drawingNote" value="${esc(project.drawingNote || "Dimensions in mm. Verify fit and tolerances before fabrication.")}" maxlength="300"></label><label>Z section · optional<input id="drawingSection" type="number" step="any" placeholder="Whole part" value="${esc(project.drawingSection ?? "")}"></label><button id="refreshDrawing">Update views</button><button id="printDrawing" disabled>Print / PDF</button><button id="saveDrawing" disabled>Export SVG sheet</button></div><details id="dimensionEditor"><summary>Add dimensions between vertices or circle centers</summary><p>Select two points below or click the amber points in a view. Measurements come from the projected geometry. A changed or missing reference is flagged for reselection.</p><div class="project-toolbar"><label>View<select id="dimensionView"><option>top</option><option>front</option><option>right</option></select></label><label>Point A<select id="dimensionA"></select></label><label>Point B<select id="dimensionB"></select></label><label>Measurement<select id="dimensionKind"><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option><option value="aligned">Aligned</option></select></label><label>Offset · mm<input id="dimensionOffset" type="number" step="any" value="8"></label><label>Tolerance ± mm<input id="dimensionTolerance" type="number" min="0" step="any" value="0"></label><button id="addDimension">Add dimension</button></div><div id="dimensionList"></div></details><p id="drawingStatus" role="status">Generating native projections…</p><div id="drawingSheet"></div>`,
    true,
  );
  let nextPoint = "A";
  function pointOptions() {
    if (!drawingResult) return;
    const view = drawingResult.views[$("#dimensionView").value],
      opts = view.vertices
        .map(
          (v, i) =>
            `<option value="${i}">${i + 1} · ${fmt(v[0])}, ${fmt(v[1])}</option>`,
        )
        .join("");
    $("#dimensionA").innerHTML = $("#dimensionB").innerHTML = opts;
    $("#dimensionB").value = String(Math.min(1, view.vertices.length - 1));
    nextPoint = "A";
  }
  function renderSheet(markers = $("#dimensionEditor").open) {
    $("#drawingSheet").innerHTML =
      `<div class="sheet-title"><b>${esc(project.name)}</b><span>SOLIDBENCH ${VERSION} · ${new Date().toLocaleDateString()}</span></div><div class="drawing-views">${Object.entries(
        drawingResult.views,
      )
        .map(
          ([name, view]) =>
            `<figure>${drawingSVG(view, name, markers)}<figcaption>${name.toUpperCase()} · ${drawingSection !== null ? "Z SECTION" : "ORTHOGRAPHIC"}</figcaption></figure>`,
        )
        .join(
          "",
        )}</div><p class="drawing-note">${esc($("#drawingNote").value)}</p><table><thead><tr><th>Component</th><th>Qty</th><th>Volume · mm³</th></tr></thead><tbody>${drawingResult.parts
        .filter((b) => b.visible)
        .map(
          (b) =>
            `<tr><td>${esc(b.name)}</td><td>1</td><td>${fmt(b.volume)}</td></tr>`,
        )
        .join(
          "",
        )}</tbody></table><p class="sheet-scope">All dimensions in mm. Views are fitted independently. Component volumes describe the complete bodies. Envelope and diameter dimensions update automatically; reference dimensions require reselection when their projected points move. Datum systems and GD&T are outside this sheet's scope.</p>`;
    const stale = drawingDimensions().filter((x) => !dimensionValid(x));
    $("#drawingStatus").textContent = stale.length
      ? `${stale.length} dimension reference(s) changed or belong to another section. Remove and recreate them before exporting.`
      : "Views generated from the current solid. Dimensions show model measurements.";
    $("#printDrawing").disabled = $("#saveDrawing").disabled = stale.length > 0;
    $("#dimensionList").innerHTML = drawingDimensions()
      .map(
        (x, i) =>
          `<div class="project-row"><b>${i + 1} · ${esc(x.view)} / ${esc(x.kind)}</b><span>${dimensionValid(x) ? "Reference valid" : "Reference changed — reselect"}</span><button data-remove-dimension="${i}">Remove</button></div>`,
      )
      .join("");
    $$("[data-remove-dimension]").forEach(
      (b) =>
        (b.onclick = () => {
          commit(
            () =>
              project.drawingDimensions.splice(
                Number(b.dataset.removeDimension),
                1,
              ),
            "Drawing dimension removed",
          );
          renderSheet();
        }),
    );
    $$("[data-dim-point]").forEach(
      (b) =>
        (b.onclick = () => {
          if ($("#dimensionView").value !== b.dataset.dimView) {
            $("#dimensionView").value = b.dataset.dimView;
            pointOptions();
          }
          $("#dimension" + nextPoint).value = b.dataset.dimPoint;
          $("#drawingStatus").textContent =
            `Point ${nextPoint} selected · ${Number(b.dataset.dimPoint) + 1}`;
          nextPoint = nextPoint === "A" ? "B" : "A";
        }),
    );
  }
  async function refresh() {
    try {
      drawingSection =
        $("#drawingSection").value === ""
          ? null
          : Number($("#drawingSection").value);
      $("#printDrawing").disabled = $("#saveDrawing").disabled = true;
      drawingResult = await cadJob({
        action: "drawing",
        project: clone(project),
        section: drawingSection,
      });
      pointOptions();
      renderSheet();
    } catch (e) {
      $("#drawingStatus").textContent = e.message;
    }
  }
  $("#dimensionView").onchange = pointOptions;
  $("#dimensionEditor").ontoggle = () => {
    if (drawingResult) renderSheet();
  };
  $("#addDimension").onclick = () => {
    try {
      const view = $("#dimensionView").value,
        pts = drawingResult.views[view].vertices,
        a = pts[Number($("#dimensionA").value)],
        b = pts[Number($("#dimensionB").value)],
        kind = $("#dimensionKind").value,
        offset = Number($("#dimensionOffset").value),
        tolerance = Number($("#dimensionTolerance").value);
      if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-5)
        throw Error("Select two different points.");
      if (
        !Number.isFinite(offset) ||
        Math.abs(offset) > 1000 ||
        !Number.isFinite(tolerance) ||
        tolerance < 0 ||
        tolerance > 1000
      )
        throw Error(
          "Use an offset within ±1000 mm and tolerance from 0 to 1000 mm.",
        );
      if (drawingDimensions().length >= 100)
        throw Error("Maximum 100 reference dimensions per sheet.");
      commit(() => {
        project.drawingDimensions ??= [];
        project.drawingDimensions.push({
          view,
          a,
          b,
          kind,
          offset,
          tolerance,
          section: drawingSection,
        });
      }, "Drawing dimension saved");
      renderSheet();
    } catch (e) {
      $("#drawingStatus").textContent = e.message;
    }
  };
  $("#refreshDrawing").onclick = () => {
    commit(() => {
      project.drawingNote = $("#drawingNote").value;
      project.drawingSection =
        $("#drawingSection").value === ""
          ? null
          : Number($("#drawingSection").value);
    }, "Drawing settings saved");
    refresh();
  };
  $("#drawingNote").onchange = () => {
    commit(
      () => (project.drawingNote = $("#drawingNote").value),
      "Drawing note saved",
    );
    if (drawingResult) renderSheet();
  };
  $("#printDrawing").onclick = () => {
    renderSheet(false);
    let node = $("#printReport");
    if (!node) {
      node = document.createElement("section");
      node.id = "printReport";
      document.body.append(node);
    }
    node.innerHTML = $("#drawingSheet").innerHTML;
    node.hidden = true;
    d.close();
    window.print();
  };
  $("#saveDrawing").onclick = () => {
    const views = Object.entries(drawingResult.views)
      .map(
        ([name, v], i) =>
          `<g transform="translate(${20 + (i % 2) * 390},${70 + Math.floor(i / 2) * 320})"><text x="10" y="20" font-size="16">${esc(name.toUpperCase())}</text>${drawingSVG(v, name).replace("<svg ", '<svg x="0" y="25" width="370" height="270" ')}</g>`,
      )
      .join("");
    download(
      `<svg xmlns="http://www.w3.org/2000/svg" width="840" height="760" viewBox="0 0 840 760"><rect width="840" height="760" fill="white"/><text x="30" y="35" font-family="sans-serif" font-size="24">${esc(project.name)}</text><text x="30" y="60" font-family="sans-serif" font-size="12">All dimensions in mm · SOLIDBENCH v${VERSION}${drawingSection !== null ? " · Z section " + drawingSection : ""}</text>${views}<text x="30" y="745" font-family="sans-serif" font-size="11">${esc($("#drawingNote").value)}</text></svg>`,
      filename() + "-drawing.svg",
      "image/svg+xml",
    );
  };
  await refresh();
}
// Add parameter expression fields without replacing the original feature workflow.
const originalOpenFeature = openFeature;
openFeature = function (type, old = null) {
  originalOpenFeature(type, old);
  if ($("#featureDialog").open) {
    $("#featureFields").insertAdjacentHTML(
      "beforeend",
      `<label class="advanced">Parameter expressions · field = expression<textarea id="featureExpressions" rows="3" placeholder="depth = thickness * 2">${esc(
        Object.entries(old?.expressions || {})
          .map(([k, v]) => k + " = " + v)
          .join("\n"),
      )}</textarea></label>`,
    );
  }
};
const originalPutFeature = putFeature;
putFeature = function (f) {
  if ($("#featureDialog").open && $("#featureExpressions"))
    f.expressions = parseExpressions($("#featureExpressions").value);
  if (f.plane === "FACE") {
    const original = project.features.find((x) => x.id === editingId);
    // An edit refers to the pre-feature face, not the finished body's altered face.
    if (
      original?.plane === "FACE" &&
      original.face === f.face &&
      original.faceRef
    ) {
      f.faceRef = clone(original.faceRef);
    } else {
      const info = activeMesh()?.faceInfo.find((x) => x.id === Number(f.face));
      if (info) f.faceRef = { center: info.center };
    }
  }
  if (editingId && ["fillet", "chamfer"].includes(f.type)) {
    const original = project.features.find((x) => x.id === editingId);
    if (JSON.stringify(original?.edges) !== JSON.stringify(f.edges))
      f.edgeRefs = [];
  }
  originalPutFeature(f);
};
const originalRenderInspector = renderInspector;
renderInspector = function () {
  originalRenderInspector();
  if (!selected && activeMesh()?.faceInfo) {
    $("#inspectorContent").insertAdjacentHTML(
      "beforeend",
      `<details class="face-register"><summary>Faces & sketch planes</summary>${activeMesh()
        .faceInfo.map(
          (f) =>
            `<div class="kv"><span>Face ${f.id} · ${fmt(f.area)} mm²</span>${f.planar ? `<button data-face-sketch="${f.id}">Sketch</button>` : "Curved"}</div>`,
        )
        .join("")}</details>`,
    );
    $$("[data-face-sketch]").forEach(
      (b) =>
        (b.onclick = () => {
          openSketch();
          const id = Number(b.dataset.faceSketch);
          sketchState.plane = "FACE";
          sketchState.face = id;
          $('#sketchForm [name="plane"]').value = "FACE";
          $('#sketchForm [name="plane"]').dispatchEvent(new Event("change"));
          $('#sketchForm [name="face"]').value = id;
        }),
    );
  }
};
window.addEventListener("beforeunload", (e) => {
  if (pendingWrites) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function boot() {
  try {
    const auto = await dbGet("autosave");
    if (auto?.project) project = validate(auto.project);
    else project = validate(project);
  } catch (e) {
    project = validate(project);
    status(
      "Could not read the browser database; JSON backups remain available.",
    );
  }
  activeBody = project.bodies[0].id;
  renderUI();
  if (!loadProblem) persist();
  resize();
  await health();
  scheduleModel();
}
boot();

$("#projectsFromFile").onclick = () => {
  $("#fileDialog").close();
  openProjects();
};

$("#toolsFromFile").onclick = () => {
  $("#fileDialog").close();
  openTools();
};

$("#signOutHost").onclick = async () => {
  try {
    await api("logout", {});
    $("#helpDialog").close();
    const s = await api("session");
    if (s.required) showLogin();
    else status("Local host has no password configured.");
  } catch (e) {
    status(e.message);
  }
};

// Keep storage state visible on narrow screens without crowding the header.
const mobileSave = document.createElement("span");
mobileSave.id = "mobileSaveStatus";
mobileSave.setAttribute("role", "status");
$("#geometryStats").after(mobileSave);
const syncSaveStatus = () => {
  mobileSave.textContent = $("#saveStatus").textContent;
  mobileSave.classList.toggle(
    "bad",
    $("#saveStatus").classList.contains("bad"),
  );
};
new MutationObserver(syncSaveStatus).observe($("#saveStatus"), {
  childList: true,
  attributes: true,
  characterData: true,
  subtree: true,
});
syncSaveStatus();
