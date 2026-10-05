# SOLIDBENCH v1.0.0 verification

Release verification: **2026-10-05**. Tests exercise real FreeCAD geometry, not a simulated modeling backend. Source and regression suites are included in this archive.

## Verified environment

- Linux x86-64, glibc 2.39.
- conda-forge `freecad=2026.09.16`, reporting FreeCAD 26.3.0; compatible Python 3.11.
- Chromium 153.0.8010.0, automated through Playwright with software WebGL. Browser tests launch the Python service and native workers themselves.
- Direct installation and launch. Docker was not used.

## Results

| Gate | Result | Evidence / coverage |
|---|---|---|
| Native geometry + server suite | **21 tests passed** | `python -m unittest discover -s tests -v`; primitives and exact boolean volumes, coordinate planes, polygon/revolution, fillet/chamfer, native recompute and STEP readback, mesh indices, migration, arithmetic safety, real constraints and redundant/conflicting constraints, arcs, loft/sweep, shell/draft, mirror/pattern/transform, body/joint placement, references, native projections and representative example corpus. |
| Core browser suite | **Passed** | `tests/browser.cjs`: starter geometry, upstream edits, undo/redo, reload persistence, JSON round trip and rejected imports, numeric/pointer sketching, invalid-geometry recovery, native STEP/STL/FCStd downloads, views/projection, themes, section, reports, edge selection, suppression, filtering, panels, previous autosave, offline cached reload/reconnect and mobile layout. |
| v1 workflow suite | **Passed** | `tests/browser-v1.cjs`: named parameters, local/host revision restore, copy/visibility, slider positioning, interference, selected-body STEP export and reimport, real constraint solve, sketch expressions, face-attached sketch edit, loft edit, sweep, shell/draft, mirror/pattern/transform, body boolean, drawing dimensions/tolerances, SVG/PDF, changed-reference export blocking, numeric import validation and mobile tools. |
| Authentication browser suite | **Passed** | `tests/browser-auth.cjs`: incorrect-password feedback, sign-in, authenticated native modeling, sign-out and rejected API calls after session invalidation. |
| Hosting regression | **Passed within native/server suite** | Unauthenticated access rejected; cross-origin POST rejected; revision 1 preserved after revision 2; stale save returns 409; queued native job succeeds; canceled job reports cancellation; unsupported project schema rejected. |
| Direct launcher / doctor | **Passed** | Doctor reports native engine and app versions; direct launcher starts service, invokes the browser URL and serves native health. Browser opening was checked with a controlled launcher stub because this environment is headless. Password-free service rejects unrelated Host headers. |
| Final visual review | **Passed** | Desktop, mobile, constrained sketch and drawing screenshots inspected. Drawing PDF renders as one A4 page. Front/right drawing orientations match viewport conventions. Mobile autosave state remains visible and the page does not overflow horizontally. |
| Packaging | **Clean source archive** | Allowlisted source/assets/docs/tests/examples; no runtime data, credentials, database, environments or node_modules. Archive includes `SHA256SUMS` for its source files. |

## Representative analytic checks

- Bracket: joined plate/flange minus two mounting holes and upright bore; approximately **42,857.390 mm³**.
- Parametric spacer: `π × (15² − 4²) × 12` mm³; changing named dimensions recomputes the solid.
- Instrument enclosure: open rectangular shell plus independently positioned cover with two holes; volume checked against primitive arithmetic, and native drawing views generated.
- Circular/arc profile extrusion, straight loft, repeated bodies and slider overlap checked against expected geometry/volume.
- Valid swept solids can contain degenerate native edges; the release regression checks their browser mesh conversion as well as BRep validity.

## Important verification boundaries

These checks demonstrate the stated workflows on the environment above. They are not certification of general CAD correctness for arbitrary inputs.

- Native macOS, Windows and ARM installations were **not tested**. Scripts and setup guidance are provided; dependency availability and ABI compatibility must be checked on the target host. WSL2 operation was not executed here.
- Docker build/run, systemd installation, live DNS/TLS and reverse-proxy deployment were **not tested**. Recipes are supplied, with the direct native installation as the verified primary path. No external deployment was performed.
- Firefox/Safari, hardware GPU drivers, touch hardware, screen-reader testing and formal accessibility compliance remain unverified.
- Tests cover small mechanical parts/modest assemblies. No long-running soak test, large-assembly benchmark, hostile native-parser fuzzing or penetration test was performed.
- Geometry-dependent shell, draft, fillet, sweep and boolean operations can fail. The UI retains project source and reports the failure; a successfully displayed solid still requires engineering review for the intended use.
- Drawings are bounded by `docs/CAPABILITIES.md`: fitted view scales, conservative point references, no full GD&T/production drawing standard. Advanced FCStd features may be snapshots; JSON is the authoritative editable web project.

See `docs/DEVELOPMENT.md` for reproduction commands and source responsibilities. Unverified items remain on the roadmap rather than being reported as completed validation.
