# Development and maintenance

No frontend build step. Serve `public/` through `server.py`; browser code uses local ES modules and bundled Three.js. Use the same compatible FreeCAD Python for the worker, test suite and native debugging.

| File | Responsibility |
|---|---|
| `public/app.js` | Project/history state, viewport, forms, sketches, bodies, revisions, drawings and local recovery |
| `public/style.css`, `index.html` | Responsive workbench and accessible controls |
| `public/sw.js` | Same-origin static interface cache; never caches API responses |
| `server.py` | HTTP/static routes, authentication, bounded workers and SQLite revisions |
| `worker.py` | Short-lived adapter entry point and structured error boundary |
| `schema.py` | Version/schema migration, numeric bounds and safe arithmetic expressions |
| `sketches.py` | Native Sketcher entities, constraints, datum placement and diagnostics |
| `kernel.py` | Geometry history, body positioning, tessellation, interference, drawings and export |
| `launch.py`, `start.*` | Direct environment diagnosis and service launch |
| `tests/` | Geometry, hosting, real-browser core, v1 and sign-in regression suites |
| `tools/package.py` | Release archive allowlist and SHA-256 manifest |

## Native tests

From the repository root:

```sh
micromamba run -n solidbench python -m unittest discover -s tests -v
micromamba run -n solidbench python launch.py --doctor
```

The tests build real geometry and check exact volumes, valid solids, meshes, exported native documents, STEP readback, coordinate planes, solver diagnostics, advanced operations, projections, representative parts, authentication, revision conflict handling and cancellation. Server tests use temporary directories and test-only credentials.

**FreeCAD embedding detail:** importing FreeCAD can initialize names in `__main__`. Keep the native adapter in an imported module. `worker.py` imports `kernel` and then its small command-line helpers. Do not replace it with direct execution of `kernel.py` without retesting namespace behavior.

## Browser tests

Install Playwright only for development, outside the release runtime if preferred:

```sh
npm install --no-save playwright
npx playwright install chromium
```

Run with `FREECAD_PYTHON` set to the absolute Python path of the environment created above:

```sh
FREECAD_PYTHON=/absolute/path/to/env/bin/python node tests/browser.cjs
FREECAD_PYTHON=/absolute/path/to/env/bin/python node tests/browser-v1.cjs
FREECAD_PYTHON=/absolute/path/to/env/bin/python node tests/browser-auth.cjs
```

Each script starts its own server and shuts it down. Ports are 8187, 8189 and 8191 respectively. Use a clean `SOLIDBENCH_DATA` path without a configured password for the first two; the auth suite creates and removes its own temporary password-protected directory. `QA_OUTPUT` selects the screenshot/download output directory. `CHROMIUM_PATH` optionally supplies a compatible browser executable. The scripts use software WebGL for headless reliability; an interactive hardware-accelerated browser should still be reviewed on target platforms.

## Service interface

All mutating calls accept JSON and require same-origin context. With a host password configured, data routes require the session cookie.

- `GET /api/session`; `POST /api/login`, `/api/logout`.
- `GET /api/health`: native engine and application version.
- `POST /api/jobs` with `action` `model`, `sketch`, `drawing` or `interference`. Poll `GET /api/jobs/<id>` and cancel with `POST /api/jobs/<id>/cancel`.
- `POST /api/export` with `project`, `format` and optional `bodyId`; returns bytes. `FCStd` always saves the whole document.
- `GET /api/projects`, `/api/projects/<id>`, `/api/projects/<id>/<revision>`.
- `POST /api/projects/save` with `project`, optional `id`, `expectedRevision` and `label`; conflicts return HTTP 409.
- Synchronous model/sketch/drawing/interference endpoints are retained and share worker admission limits. New UI modeling uses queued jobs.

Transient queue state is not a durable project store. Explicit revisions are separate from computation. Do not publish this API as a multi-tenant service without a substantially stronger security and resource-isolation design.

## Release procedure

1. Fix concrete geometry, data-loss and UI regressions before expanding features.
2. Keep `VERSION` in Python/UI/package script, the visible HTML version and service-worker cache version aligned.
3. Preserve the schema 1 migration and reject unsupported schemas. Extend schema 2 additively where safe; incompatible changes need a new schema and migration.
4. Run native and browser gates, inspect desktop/mobile/drawing screenshots, and document unverified platforms.
5. Update README, capability matrix, changelog, roadmap and test report.
6. Run `python3 tools/package.py`; the ZIP is written beside the project directory. Verify the included `SHA256SUMS` after extraction.

The optional Docker build runs native tests, but a successful direct installation does not certify that container/OS path. Deployment is a separate action; building a ZIP does not publish a service.
