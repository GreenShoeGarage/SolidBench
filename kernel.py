"""SOLIDBENCH native geometry adapter: explicit project schema, no project code execution."""

import json, sys, os, math, pathlib, tempfile, base64

for path in [
    os.getenv("FREECAD_LIB", ""),
    str(pathlib.Path(sys.prefix) / "lib"),
    "/usr/lib/freecad/lib",
    "/usr/local/lib",
]:
    if path and path not in sys.path:
        sys.path.append(path)
import FreeCAD as App, Part, Sketcher
from schema import num, number, migrate, VERSION
from sketches import make_profile, solved_geometry

V = App.Vector
validate = migrate


def signature(edge, shape):
    b = shape.BoundBox
    d = max(b.DiagonalLength, 1e-6)
    c = edge.CenterOfMass
    try:
        curve = type(edge.Curve).__name__
    except (TypeError, ValueError):
        curve = "Degenerate"
    return {
        "curve": curve,
        "length": round(edge.Length / d, 8),
        "center": [
            round((c.x - b.XMin) / max(b.XLength, 1e-6), 7),
            round((c.y - b.YMin) / max(b.YLength, 1e-6), 7),
            round((c.z - b.ZMin) / max(b.ZLength, 1e-6), 7),
        ],
    }


def resolve_edges(f, shape):
    indices = f.get("edges", [])
    refs = f.get("edgeRefs", [])
    if not isinstance(indices, list) or not 1 <= len(indices) <= 100:
        raise ValueError("Choose 1–100 edges")
    if refs:
        mapped = []
        for ref in refs:
            matches = [
                i + 1 for i, e in enumerate(shape.Edges) if signature(e, shape) == ref
            ]
            if len(matches) != 1:
                raise ValueError(
                    "An edge reference changed or became ambiguous. Edit this feature and reselect its edges."
                )
            mapped.append(matches[0])
        return mapped
    if any(type(e) != int or not 1 <= e <= len(shape.Edges) for e in indices):
        raise ValueError("Edge reference no longer exists; reselect it")
    return indices


def checked(shape):
    if (
        shape.isNull()
        or not shape.isValid()
        or shape.Volume <= 1e-8
        or not shape.Solids
    ):
        raise ValueError(
            "Operation produced no valid solid. Check overlap, profile, dimensions or references."
        )
    return shape


def shaped(doc, name, shape):
    obj = doc.addObject("Part::Feature", name)
    obj.Shape = checked(shape)
    return obj


def advanced(doc, f, name, previous, body_objects):
    typ = f["type"]
    shape = previous.Shape if previous else None
    if typ == "import":
        raw = f.get("step", "")
        if not isinstance(raw, str) or len(raw) > 16_000_000:
            raise ValueError("STEP data exceeds 12 MB")
        try:
            data = base64.b64decode(raw, validate=True)
        except Exception:
            raise ValueError("Invalid STEP encoding")
        if b"ISO-10303-21" not in data[:200]:
            raise ValueError("Only STEP exchange files are accepted")
        with tempfile.TemporaryDirectory() as td:
            path = pathlib.Path(td) / "part.step"
            path.write_bytes(data)
            s = Part.Shape()
            s.read(str(path))
        return shaped(doc, name + "Tool", s), False
    if typ == "loft":
        sections = f.get("sections", [])
        if not 2 <= len(sections) <= 12:
            raise ValueError("Loft needs 2–12 closed profiles")
        wires = []
        for i, sec in enumerate(sections):
            sk, _, _ = make_profile(doc, sec, name + "Section" + str(i))
            if len(sk.Shape.Wires) != 1 or not sk.Shape.Wires[0].isClosed():
                raise ValueError("Each loft section must contain one closed wire")
            wires.append(sk.Shape.Wires[0])
        return (
            shaped(
                doc,
                name + "Tool",
                Part.makeLoft(wires, True, bool(f.get("ruled", False))),
            ),
            False,
        )
    if typ == "sweep":
        pts = f.get("path", [])
        if not 2 <= len(pts) <= 64:
            raise ValueError("Sweep path needs 2–64 3D points")
        vectors = [V(*[number(v) for v in pt]) for pt in pts if len(pt) == 3]
        if len(vectors) != len(pts):
            raise ValueError("Path points need x,y,z")
        tangent = vectors[1] - vectors[0]
        if tangent.Length < 1e-6:
            raise ValueError("Sweep path contains a zero segment")
        path = Part.Wire(Part.makePolygon(vectors).Edges)
        wire = Part.Wire(
            [Part.makeCircle(num(f, "radius", 3, True), vectors[0], tangent)]
        )
        return (
            shaped(doc, name + "Tool", path.makePipeShell([wire], True, False, 2)),
            False,
        )
    if typ == "boolean":
        source = body_objects.get(f.get("sourceBody"))
        if not source or source == previous:
            raise ValueError("Choose another earlier body with a solid")
        return shaped(doc, name + "Tool", source.Shape.copy()), False
    if shape is None:
        raise ValueError("Create a solid before this modifier")
    if typ == "shell":
        faces = f.get("faces", [])
        if not faces or any(
            type(i) != int or not 1 <= i <= len(shape.Faces) for i in faces
        ):
            raise ValueError("Select valid faces to remove")
        s = shape.makeThickness(
            [shape.Faces[i - 1] for i in faces], -num(f, "thickness", 2, True), 0.001
        )
    elif typ == "draft":
        faces = f.get("faces", [])
        neutral = int(num(f, "neutralFace", 1))
        if (
            not faces
            or any(type(i) != int or not 1 <= i <= len(shape.Faces) for i in faces)
            or not 1 <= neutral <= len(shape.Faces)
        ):
            raise ValueError("Choose valid draft faces and a neutral face")
        body = doc.addObject("PartDesign::Body", name + "DraftBody")
        base = body.newObject("PartDesign::Feature", name + "DraftBase")
        base.Shape = shape
        draft = body.newObject("PartDesign::Draft", name + "Draft")
        draft.Base = (base, ["Face" + str(i) for i in faces])
        draft.NeutralPlane = (base, ["Face" + str(neutral)])
        draft.Angle = num(f, "angle", 5)
        doc.recompute()
        checked(draft.Shape)
        return draft, True
    elif typ == "transform":
        s = shape.copy()
        axis = V(num(f, "ax", 0), num(f, "ay", 0), num(f, "az", 1))
        angle = num(f, "angle")
        if angle and axis.Length < 1e-8:
            raise ValueError("Rotation axis cannot be zero")
        if angle:
            s.rotate(V(0, 0, 0), axis, angle)
        s.translate(V(num(f, "dx"), num(f, "dy"), num(f, "dz")))
    elif typ == "mirror":
        n = V(num(f, "nx", 1), num(f, "ny"), num(f, "nz"))
        if n.Length < 1e-8:
            raise ValueError("Mirror normal cannot be zero")
        s = shape.copy()
        s = s.mirror(V(num(f, "ox"), num(f, "oy"), num(f, "oz")), n)
        if f.get("keep", True):
            s = shape.fuse(s).removeSplitter()
    elif typ == "pattern":
        count = int(num(f, "count", 3, True))
        if not 2 <= count <= 30:
            raise ValueError("Use 2–30 instances")
        shapes = [shape]
        for i in range(1, count):
            part = shape.copy()
            if f.get("pattern", "linear") == "circular":
                part.rotate(
                    V(num(f, "ox"), num(f, "oy"), num(f, "oz")),
                    V(0, 0, 1),
                    num(f, "angle", 360) * i / count,
                )
            else:
                part.translate(
                    V(num(f, "dx", 30) * i, num(f, "dy") * i, num(f, "dz") * i)
                )
            shapes.append(part)
        s = shapes[0].fuse(shapes[1:]).removeSplitter()
    else:
        raise ValueError("Unsupported modifier")
    return shaped(doc, name, s), True


def build(p):
    original = p
    p = migrate(p)
    doc = App.newDocument("Solidbench")
    doc.Label = p.get("name", "Untitled part")
    body_objects = {}
    history = []
    for i, f in enumerate(p["features"]):
        if f.get("suppressed"):
            continue
        name = "Feature" + str(i + 1)
        typ = f["type"]
        bid = f.get("bodyId", "main")
        previous = body_objects.get(bid)
        diagnostics = None
        modifier = False
        try:
            if typ in ["box", "cylinder", "sphere"]:
                tool = doc.addObject(
                    {
                        "box": "Part::Box",
                        "cylinder": "Part::Cylinder",
                        "sphere": "Part::Sphere",
                    }[typ],
                    name + "Tool",
                )
                if typ == "box":
                    tool.Length = num(f, "width", 40, True)
                    tool.Width = num(f, "height", 30, True)
                    tool.Height = num(f, "depth", 10, True)
                else:
                    tool.Radius = num(f, "radius", 10, True)
                    if typ == "cylinder":
                        tool.Height = num(f, "depth", 10, True)
                tool.Placement.Base = V(num(f, "x"), num(f, "y"), num(f, "z"))
            elif typ in ["extrude", "revolve"]:
                sk, normal, diagnostics = make_profile(
                    doc, f, name + "Sketch", previous.Shape if previous else None
                )
                if typ == "extrude":
                    tool = doc.addObject("Part::Extrusion", name + "Tool")
                    tool.Base = sk
                    tool.Dir = normal * num(f, "depth", 10, True)
                    tool.Solid = True
                else:
                    tool = doc.addObject("Part::Revolution", name + "Tool")
                    tool.Source = sk
                    tool.Axis = sk.Placement.Rotation.multVec(V(0, 1, 0))
                    tool.Base = sk.Placement.Base
                    angle = num(f, "angle", 360, True)
                    if angle > 360:
                        raise ValueError("Revolve angle must be ≤360°")
                    tool.Angle = angle
                    tool.Solid = True
            elif typ in ["fillet", "chamfer"]:
                if previous is None:
                    raise ValueError("Create a solid before modifying edges")
                edges = resolve_edges(f, previous.Shape)
                r = num(f, "radius", 1, True)
                tool = doc.addObject(
                    "Part::Fillet" if typ == "fillet" else "Part::Chamfer", name
                )
                tool.Base = previous
                tool.Edges = [(e, r, r) for e in edges]
                modifier = True
            else:
                tool, modifier = advanced(doc, f, name, previous, body_objects)
            doc.recompute()
            checked(tool.Shape)
            if not modifier:
                operation = f.get("operation", "join")
                if previous is None:
                    if operation != "join":
                        raise ValueError(
                            "First active feature in a body must add material"
                        )
                    result = tool
                else:
                    result = doc.addObject(
                        {
                            "join": "Part::Fuse",
                            "cut": "Part::Cut",
                            "intersect": "Part::Common",
                        }[operation],
                        name,
                    )
                    result.Base = previous
                    result.Tool = tool
                    result.Refine = True
                    doc.recompute()
            else:
                result = tool
            checked(result.Shape)
            result.Label = f.get("name", typ.title())
            body_objects[bid] = result
            history.append(
                {
                    "id": f["id"],
                    "bodyId": bid,
                    "volume": result.Shape.Volume,
                    "solids": len(result.Shape.Solids),
                    "edges": len(result.Shape.Edges),
                    "sketch": diagnostics,
                }
            )
        except Exception as exc:
            raise ValueError(f'Feature {i+1} ({f.get("name",typ)}): {exc}') from exc
    # Body placements describe a grounded component plus a single fixed, revolute or slider coordinate.
    visible = []
    outputs = []
    for b in p["bodies"]:
        obj = body_objects.get(b["id"])
        if obj is None:
            continue
        placement = b.get("placement", {})
        joint = b.get("joint", {})
        s = obj.Shape.copy()
        axis = V(num(joint, "ax", 0), num(joint, "ay", 0), num(joint, "az", 1))
        kind = joint.get("kind", "fixed")
        value = num(joint, "value")
        if kind in ["revolute", "slider"]:
            if axis.Length < 1e-8:
                raise ValueError("Joint axis cannot be zero")
            lower = num(joint, "min", -360)
            upper = num(joint, "max", 360)
            if not lower <= value <= upper:
                raise ValueError("Joint coordinate is outside its limits")
            axis.normalize()
            if kind == "revolute":
                s.rotate(
                    V(num(joint, "px"), num(joint, "py"), num(joint, "pz")), axis, value
                )
            else:
                s.translate(axis * value)
        rotation = num(placement, "angle")
        if rotation:
            s.rotate(V(0, 0, 0), V(0, 0, 1), rotation)
        s.translate(V(num(placement, "x"), num(placement, "y"), num(placement, "z")))
        placed = doc.addObject("Part::Compound", "BodyResult" + str(len(outputs)))
        placed.Links = [obj]
        placed.Placement = s.Placement.multiply(obj.Shape.Placement.inverse())
        placed.Label = b.get("name", "Body")
        doc.recompute()
        outputs.append((b, placed))
        if b.get("visible", True):
            visible.append(placed)
    for obj in doc.Objects:
        if hasattr(obj, "Visibility"):
            obj.Visibility = obj in visible
    if len(visible) == 1:
        final = visible[0]
    elif visible:
        final = shaped(
            doc, "VisibleAssembly", Part.makeCompound([o.Shape for o in visible])
        )
        final.Visibility = False
    else:
        final = None
    metadata = doc.addObject("App::FeaturePython", "SolidbenchProject")
    metadata.addProperty("App::PropertyString", "ProjectJSON", "SOLIDBENCH")
    metadata.ProjectJSON = json.dumps(original)
    return doc, final, history


def mesh(shape, tolerance=0.05):
    positions = []
    indices = []
    for face in shape.Faces:
        vertices, triangles = face.tessellate(tolerance)
        start = len(positions) // 3
        positions.extend(c for v in vertices for c in (v.x, v.y, v.z))
        indices.extend(start + c for tri in triangles for c in tri)
        if len(indices) > 1_500_000:
            raise ValueError(
                "Display mesh exceeds 500,000 triangles; simplify the part"
            )
    edges = []
    for i, e in enumerate(shape.Edges):
        try:
            points = e.discretize(Deflection=tolerance)
        except Exception:
            points = [v.Point for v in e.Vertexes]
        edges.append(
            {
                "id": i + 1,
                "length": e.Length,
                "ref": signature(e, shape),
                "points": [[v.x, v.y, v.z] for v in points],
            }
        )
    faces = []
    for i, f in enumerate(shape.Faces):
        c = f.CenterOfMass
        entry = {
            "id": i + 1,
            "area": f.Area,
            "center": [c.x, c.y, c.z],
            "planar": isinstance(f.Surface, Part.Plane),
        }
        if entry["planar"]:
            n = f.normalAt(0, 0)
            entry["normal"] = [n.x, n.y, n.z]
        faces.append(entry)
    b = shape.BoundBox
    return {
        "positions": positions,
        "indices": indices,
        "edges": edges,
        "faceInfo": faces,
        "bounds": [b.XMin, b.YMin, b.ZMin, b.XMax, b.YMax, b.ZMax],
        "volume": shape.Volume,
        "area": shape.Area,
        "solids": len(shape.Solids),
        "faces": len(shape.Faces),
        "valid": shape.isValid(),
    }


def outputs(doc, p):
    out = []
    n = 0
    for b in migrate(p)["bodies"]:
        # Match final body features through ordered active feature membership.
        if not any(
            not f.get("suppressed") and f.get("bodyId", "main") == b["id"]
            for f in migrate(p)["features"]
        ):
            continue
        obj = doc.getObject("BodyResult" + str(n))
        n += 1
        if obj:
            out.append((b, obj))
    return out


def drawing(shape):
    import TechDraw

    result = {}
    for key in ["top", "front", "right"]:
        # Normalize to a Z projection so drawing axes match the viewport views.
        source = shape.copy()
        direction = V(0, 0, 1)
        if key == "front":
            source.rotate(V(0, 0, 0), V(1, 0, 0), -90)
        elif key == "right":
            source.rotate(V(0, 0, 0), V(1, 1, 1), -120)
        parts = TechDraw.project(source, direction)
        valid = [s for s in parts if not s.isNull()]
        compound = Part.makeCompound(valid)
        b = compound.BoundBox
        circles = []
        for e in compound.Edges:
            try:
                curve = e.Curve
            except (TypeError, ValueError):
                continue
            if isinstance(curve, Part.Circle):
                c = curve.Center
                item = {"x": c.x, "y": -c.y, "diameter": curve.Radius * 2}
                if item not in circles:
                    circles.append(item)
        result[key] = {
            "svg": TechDraw.projectToSVG(source, direction),
            "bounds": [b.XMin, -b.YMax, b.XMax, -b.YMin],
            "circles": circles,
            "vertices": list(
                {(round(v.Point.x, 7), round(-v.Point.y, 7)) for v in compound.Vertexes}
            )
            + [[c["x"], c["y"]] for c in circles],
        }
    return result


def run(job, out):
    req = json.loads(pathlib.Path(job).read_text())
    action = req.get("action")
    if action == "health":
        result = {
            "ok": True,
            "engine": "FreeCAD",
            "version": ".".join(App.Version()[:3]),
            "appVersion": VERSION,
        }
    elif action == "sketch":
        d = App.newDocument("SketchSolve")
        s, n, diag = make_profile(d, req["sketch"], "Profile")
        result = {
            "ok": True,
            "diagnostics": diag,
            "geometry": solved_geometry(s),
            "closed": bool(s.Shape.Wires) and all(w.isClosed() for w in s.Shape.Wires),
        }
        App.closeDocument(d.Name)
    else:
        p = req["project"]
        doc, obj, history = build(p)
        body_results = outputs(doc, p)
        if action == "export":
            selected = req.get("bodyId")
            chosen = (
                next((o for b, o in body_results if b["id"] == selected), None)
                if selected
                else obj
            )
            if chosen is None:
                raise ValueError("There is no visible solid to export")
            fmt = req["format"]
            target = str(pathlib.Path(out).with_suffix("." + fmt))
            if fmt == "step":
                Part.export([chosen], target)
            elif fmt == "stl":
                chosen.Shape.exportStl(target)
            elif fmt == "FCStd":
                doc.recompute()
                doc.saveAs(target)
            elif fmt == "brep":
                chosen.Shape.exportBrep(target)
            else:
                raise ValueError("Unsupported export format")
            result = {"ok": True, "file": target}
        elif action == "drawing":
            if not obj:
                raise ValueError("Create a visible solid first")
            shape = obj.Shape
            section = req.get("section")
            if section is not None:
                z = number(section)
                b = shape.BoundBox
                box = Part.makeBox(
                    max(1, b.XLength + 2),
                    max(1, b.YLength + 2),
                    max(0.001, z - b.ZMin + 1),
                    V(b.XMin - 1, b.YMin - 1, b.ZMin - 1),
                )
                shape = shape.common(box)
                checked(shape)
            result = {
                "ok": True,
                "views": drawing(shape),
                "parts": [
                    {
                        "id": b["id"],
                        "name": b.get("name", "Body"),
                        "volume": o.Shape.Volume,
                        "visible": b.get("visible", True),
                    }
                    for b, o in body_results
                ],
            }
        elif action == "interference":
            hits = []
            for i, (a, x) in enumerate(body_results):
                for b, y in body_results[i + 1 :]:
                    volume = x.Shape.common(y.Shape).Volume
                    if volume > 1e-6:
                        hits.append(
                            {
                                "a": a["id"],
                                "b": b["id"],
                                "volume": volume,
                                "severity": "warning",
                                "confidence": "high",
                            }
                        )
            result = {"ok": True, "interferences": hits}
        else:
            bodies = [
                {
                    "id": b["id"],
                    "name": b.get("name", "Body"),
                    "visible": b.get("visible", True),
                    "color": b.get("color", "#91a6ad"),
                    "mesh": mesh(o.Shape),
                    "sourceMesh": mesh(o.Links[0].Shape),
                }
                for b, o in body_results
            ]
            result = {
                "ok": True,
                "engine": "FreeCAD",
                "mesh": mesh(obj.Shape) if obj else None,
                "bodies": bodies,
                "history": history,
                "parameters": migrate(p)["_values"],
            }
        App.closeDocument(doc.Name)
    pathlib.Path(out).write_text(json.dumps(result))
