import math
from schema import num, number
import FreeCAD as A, Part, Sketcher

V = A.Vector


def entities(f):
    typ = f.get("profile", "rectangle")
    x, y = num(f, "x"), num(f, "y")
    if typ == "circle":
        return [
            {"kind": "circle", "cx": x, "cy": y, "radius": num(f, "radius", 10, True)}
        ]
    if typ == "rectangle":
        w, h = num(f, "width", 40, True), num(f, "height", 30, True)
        pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
    elif typ == "polygon":
        pts = f.get("points", [])
    elif typ == "custom":
        geos = f.get("geometry", [])
        if not isinstance(geos, list) or not 1 <= len(geos) <= 64:
            raise ValueError("Use 1–64 sketch entities")
        return geos
    else:
        raise ValueError("Unknown profile")
    if not 3 <= len(pts) <= 64:
        raise ValueError("A polygon needs 3–64 vertices")
    out = []
    for i, pt in enumerate(pts):
        to = pts[(i + 1) % len(pts)]
        if len(pt) != 2 or len(to) != 2:
            raise ValueError("Invalid polygon vertex")
        out.append(
            dict(
                kind="line",
                x1=number(pt[0]),
                y1=number(pt[1]),
                x2=number(to[0]),
                y2=number(to[1]),
            )
        )
    return out


def make_profile(doc, f, name, body_shape=None):
    s = doc.addObject("Sketcher::SketchObject", name)
    for e in entities(f):
        if e.get("kind") == "line":
            a = V(num(e, "x1"), num(e, "y1"), 0)
            b = V(num(e, "x2"), num(e, "y2"), 0)
            if (a - b).Length < 1e-7:
                raise ValueError("Zero-length sketch line")
            geo = Part.LineSegment(a, b)
        elif e.get("kind") in ["circle", "arc"]:
            circle = Part.Circle(
                V(num(e, "cx"), num(e, "cy"), 0), V(0, 0, 1), num(e, "radius", 10, True)
            )
            geo = (
                circle
                if e["kind"] == "circle"
                else Part.ArcOfCircle(
                    circle,
                    math.radians(num(e, "start")),
                    math.radians(num(e, "end", 180)),
                )
            )
        else:
            raise ValueError("Unsupported sketch entity")
        s.addGeometry(geo, bool(e.get("construction", False)))
    constraints = f.get("constraints", [])
    if not isinstance(constraints, list) or len(constraints) > 200:
        raise ValueError("Maximum 200 sketch constraints")
    for c in constraints:
        typ = c.get("kind")
        a = int(num(c, "a", 1)) - 1
        b = int(num(c, "b", 2)) - 1
        if not 0 <= a < len(s.Geometry):
            raise ValueError("Constraint references missing geometry")
        if typ in [
            "Coincident",
            "Parallel",
            "Perpendicular",
            "Equal",
            "Tangent",
        ] and not 0 <= b < len(s.Geometry):
            raise ValueError("Constraint references missing geometry")
        if typ in ["Horizontal", "Vertical", "Block"]:
            args = [typ, a]
        elif typ in ["Parallel", "Perpendicular", "Equal", "Tangent"]:
            args = [typ, a, b]
        elif typ == "Coincident":
            args = [typ, a, int(num(c, "pa", 2)), b, int(num(c, "pb", 1))]
        elif typ in ["Distance", "Radius", "Diameter"]:
            args = [typ, a, num(c, "value", 1, True)]
        elif typ in ["DistanceX", "DistanceY"]:
            args = [typ, a, int(num(c, "pa", 1)), num(c, "value")]
        else:
            raise ValueError("Unknown sketch constraint")
        s.addConstraint(Sketcher.Constraint(*args))
    code = s.solve()
    doc.recompute()
    conflicts = list(s.ConflictingConstraints)
    redundant = list(s.RedundantConstraints)
    diagnostics = {
        "code": code,
        "fullyConstrained": bool(s.FullyConstrained),
        "conflicts": conflicts,
        "redundant": redundant,
        "dof": getattr(s, "DoF", None),
    }
    if code != 0 or conflicts or redundant:
        raise ValueError(
            f"Sketch constraints conflict or are redundant (solver {code}; conflicts {conflicts}; redundant {redundant}). Remove or edit the listed constraints."
        )
    plane = f.get("plane", "XY")
    rot = {
        "XY": A.Rotation(),
        "XZ": A.Rotation(V(1, 0, 0), 90),
        "YZ": A.Rotation(V(0, 1, 0), 90),
    }
    if plane == "CUSTOM":
        rotation = A.Rotation(
            V(num(f, "nx"), num(f, "ny"), num(f, "nz", 1)), 0
        )  # normal-to-plane, no implied roll
        normal = V(num(f, "nx"), num(f, "ny"), num(f, "nz", 1))
        if normal.Length < 1e-9:
            raise ValueError("Datum normal cannot be zero")
        rotation = A.Rotation(V(0, 0, 1), normal)
        origin = V(num(f, "ox"), num(f, "oy"), num(f, "oz"))
    elif plane == "FACE":
        if body_shape is None:
            raise ValueError("Face sketch needs a preceding solid")
        idx = int(num(f, "face", 1)) - 1
        if idx < 0 or idx >= len(body_shape.Faces):
            raise ValueError("Sketch face no longer exists")
        face = body_shape.Faces[idx]
        if not isinstance(face.Surface, Part.Plane):
            raise ValueError("Choose a planar face")
        normal = face.normalAt(0, 0)
        rotation = A.Rotation(V(0, 0, 1), normal)
        origin = face.CenterOfMass
        ref = f.get("faceRef")
        if ref and (V(*ref["center"]) - origin).Length > 1e-5:
            raise ValueError(
                "Face changed after an upstream edit. Reselect its plane to avoid attaching the sketch to the wrong face."
            )
    else:
        if plane not in rot:
            raise ValueError("Unknown sketch plane")
        rotation = rot[plane]
        origin = V(0, 0, 0)
    normal = rotation.multVec(V(0, 0, 1))
    s.Placement = A.Placement(origin + normal * num(f, "offset"), rotation)
    s.Label = str(f.get("name", "Profile")) + " · Sketch"
    doc.recompute()
    return s, normal, diagnostics


def solved_geometry(s):
    result = []
    for i, g in enumerate(s.Geometry):
        if isinstance(g, Part.LineSegment):
            d = {
                "kind": "line",
                "x1": g.StartPoint.x,
                "y1": g.StartPoint.y,
                "x2": g.EndPoint.x,
                "y2": g.EndPoint.y,
            }
        elif isinstance(g, Part.Circle):
            d = {
                "kind": "circle",
                "cx": g.Center.x,
                "cy": g.Center.y,
                "radius": g.Radius,
            }
        elif isinstance(g, Part.ArcOfCircle):
            d = {
                "kind": "arc",
                "cx": g.Center.x,
                "cy": g.Center.y,
                "radius": g.Radius,
                "start": math.degrees(g.FirstParameter),
                "end": math.degrees(g.LastParameter),
            }
        else:
            continue
        d["construction"] = s.getConstruction(i)
        result.append(d)
    return result
