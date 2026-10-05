# SOLIDBENCH development batches

v1.0.0 delivers a bounded, usable core sketch-to-export workflow. The initial roadmap has been refined against working code and tests; platform certification and specialist parity are not implied by the release number.

| Batch | Delivered in v1.0 | Explicit boundary |
|---|---|---|
| v0.1 / v0.1.1 | Native geometry vertical slice, editable history, JSON/native exports; Docker-free launcher and doctor | Linux native execution verified; other native platforms need verification. |
| v0.2 | Entity and constraint editor with arcs, exact dimensions, solver diagnostics, custom/face sketch planes | Numeric constraint editing; no draggable constraint labels or spline editor. |
| v0.3 | Multiple bodies, appearance, copy/placement, booleans, STEP import and per-body exports, checked edge references | Conservative reference failure/rebinding rather than a universal topology naming system. |
| v0.4 | Loft, circular sweep, shell, draft, mirror, patterns, transforms and safe named parameter expressions | Documented profile, path and pattern limits; advanced FCStd features may be snapshots. |
| v0.5 | Orthographic/section drawings, envelope/diameter/reference dimensions, tolerances, SVG/PDF, parts list, grounded joints and interference | No GD&T/full drawing standard, complete mate solver or dynamics. |
| v0.6 | IndexedDB recovery, project templates, named local/host revisions and conflict protection | Explicit host saves, single owner; no automatic synchronization. |
| v0.7 | Password-protected hosting, bounded native queue, cancellation, direct deployment recipes | Dedicated unprivileged host required; not a tenant-isolated cloud CAD service. |
| v0.8 | Mobile tools, numeric/keyboard alternatives, themes, panel persistence and useful failures | Desktop remains the primary detailed modeling surface. |
| v0.9 | Native/server/browser regression suites, exact-volume checks, import/export, drawing and recovery tests | Linux + Chromium release gate; platform/performance matrices remain limited. |
| **v1.0** | **Stable schema 2, schema 1 migration, source archive, documented operations and compatibility** | **Scope is recorded in docs/CAPABILITIES.md; full FreeCAD/Fusion parity is not claimed.** |

## Next development priorities

1. **v1.1: native platform validation and performance.** Verify macOS/Windows/ARM environments, publish platform-specific dependency locks, improve large STEP/display memory use and add server project archival/deletion.
2. **v1.2: sketch and reference ergonomics.** Direct manipulation of constraint dimensions, richer entity selection, better topology reference repair, dependency visualization and history reordering.
3. **v1.3: drawings and assemblies.** Common-scale layouts, annotation collision management, stronger associative dimensions, datum/angle/radius tools and a defined component-to-component mate subset.
4. **Later, separately scoped:** CAM, FEA, sheet metal, complex surfaces, native FCStd import and collaborative editing. Each needs its own correctness and deployment work.

Fix geometry, data recovery and usability regressions before adding specialist workbenches. Future schema changes must migrate existing projects or reject them explicitly.
