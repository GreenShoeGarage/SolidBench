# v1.0 capability and compatibility matrix

The release is a tested core mechanical CAD workbench. “Implemented” below means runnable code and workflows, not full parity with another CAD system.

| Area | Implemented | Boundary |
|---|---|---|
| Profiles | Rectangle, circle, polygon; lines, arcs, circles, construction entities; XY/XZ/YZ, planar face and custom datum | Closed planar wires for solids; no spline editor or 3D sketcher. Constraint editing uses numeric rows, not draggable constraint glyphs. |
| Constraints | FreeCAD Sketcher horizontal/vertical/coincident/parallel/perpendicular/equal/tangent/length/radius/diameter/X/Y and block | Applicable entity combinations must be valid. Under-constrained profiles may be used; conflicts and redundancy stop the solve. No automatic constraint inference. |
| Basic solids | Extrusion, revolution, box, cylinder, sphere, union/cut/common | Positive dimensions; first active body feature must add material. Disjoint joins can produce several solids. |
| Dress-up | Fillet, chamfer, inward shell, draft | Geometry-dependent; ambiguous edge references fail. Shell/draft face numbers require user review after topology changes. |
| Loft | 2–12 closed sections, smooth/ruled | UI supplies parallel XY rectangular or circular sections. No guide curves. Native API can process other supported planar profiles. |
| Sweep | Circular profile along a polyline of 2–64 3D points | Radius and path must form a valid solid; no arbitrary-profile UI or guide rail control. |
| Repetition | Mirror about a plane; linear or circular body pattern; transform | Whole cumulative body geometry, 2–30 instances. Circular pattern is about Z, with sweep divided by instance count. No selective face/feature pattern or lattice. |
| Parameters | 100 named values, ordered references, bounded arithmetic; feature-field expressions | No Python/eval, functions, units parser, exponentiation, forward references or cyclic dependencies. Profile entity coordinates are entered numerically. |
| Bodies | Up to 30 independent bodies, appearance, copy, visibility, history, transform, inter-body booleans | Linear global history; a body boolean consumes the source state available at that timeline point, before assembly placement. No dependency graph reordering. |
| Assemblies | Placement, grounded fixed/revolute/slider coordinate and limits, exact interference | One grounded motion per body. No mates between bodies, joint-network solve, dynamics or motion collision sweep. Hidden components participate in interference. |
| Drawings | Native top/front/right projections, Z cut, envelope/diameter dimensions, point-to-point dimensions and symmetric tolerance, note, parts list, SVG/PDF | Views fit separately. Changed point references must be recreated. No GD&T, datums, angular/radial manual dimensions, exploded views, shared scale or automatic label collision avoidance. |
| Projects | IndexedDB autosave/previous state, named browser revisions, host SQLite revisions, JSON backups, optimistic conflicts | Single owner; no live collaborative editing, roles, automatic remote sync or cloud account. Browser project association must be reopened after a reload before appending a named revision. |
| Hosting | Direct launch, doctor, optional password, session cookies, same-origin POST checks, bounded jobs and model cancellation | Serve behind an HTTPS proxy for remote use. No tenant sandbox, per-user authorization, audit log or high-availability deployment. |
| Offline | Fully local CAD while the local host runs; cached browser interface/source and matching model when disconnected | Geometry solving/native exports need FreeCAD. Browser storage can be unavailable or cleared. |
| UI | Fusion-inspired ribbon/browser/timeline, numeric editing, keyboard shortcuts, themes, mobile viewing/editing | Original application; no Autodesk assets or affiliation. No touch-optimized constraint manipulation. Formal accessibility conformance is not certified. |

## File compatibility

| Format | Input | Output | Round-trip behavior |
|---|---|---|---|
| SOLIDBENCH JSON | Schema 1 or 2 | Schema 2 | Authoritative fully editable web history, constraints, expressions, bodies and drawing annotations. Old projects migrate on opening. Unknown schemas are rejected. |
| STEP | Solid geometry up to 12 MB/file, embedded as base64 in project | Exact visible assembly or selected body | Original feature tree, materials, units metadata variations and assembly names are not reconstructed. Geometry read by FreeCAD is used in mm; verify imported scale. |
| STL | Not supported in v1 | Tessellated visible assembly or selected body | Numeric coordinates in mm, no unit metadata or feature history. |
| BRep | Not supported in v1 | Exact selected/visible shapes | Open with a compatible OpenCascade-based tool. |
| FCStd | Not supported in browser | Whole native FreeCAD document | Basic primitives, sketches, extrusions/revolutions and linked boolean/edge features remain native. Advanced operations may be `Part::Feature` snapshots or contain a snapshot base. The complete SOLIDBENCH JSON is embedded. Advanced native snapshots do not regenerate from edited upstream desktop features; edit those operations in SOLIDBENCH. Desktop edits do not rewrite the embedded web JSON. |
| SVG / PDF | Not supported | Drawing sheet or print output | Document output, not parametric CAD input. |

## Limits and assumptions

- Millimetres; no unit conversion UI. Coordinates and intermediate arithmetic are finite and within ±10,000. 200 history features, 30 bodies, 64 polygon/path vertices, 64 custom entities and 200 constraints. 100 manual drawing dimensions.
- 18 MB HTTP request/project limit; STEP base64 counts toward it. Several large imports can reach this project limit before the individual-file limit. Reduce the source STEP or split projects if a request is rejected.
- Two native jobs run at once, up to eight admitted jobs including queued work. Native execution limit is 90 seconds/job. UI model jobs are cancelable. A completed job result is transient, not a saved project revision.
- Mesh limit is 500,000 triangles per shape. Complex imported models can exceed practical memory or drawing projection limits earlier. This release targets small mechanical parts and modest assemblies; no large-assembly performance guarantee is made.
- Project data never contains executable macros. Native parsing still occurs inside FreeCAD/OpenCascade as the service user. Process separation is crash isolation, not an operating-system security sandbox.
- Aggregate assembly volume sums components, including overlap. Interference uses exact positive intersection volume; it does not evaluate contact clearance, tolerances, strength or manufacturability.

## Explicitly outside v1.0

CAM/toolpaths, FEA, sheet metal, full desktop workbench hosting, arbitrary FreeCAD macros/plugins, native FCStd browser import, synchronized multi-user collaboration, full mechanical mate networks, advanced surface modeling and certified production drawing standards.
