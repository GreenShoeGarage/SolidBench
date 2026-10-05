"""Project migration and bounded arithmetic parameters. No eval or executable project data."""

import ast, math, re, copy

VERSION = "1.0.0"
TYPES = {
    "box",
    "cylinder",
    "sphere",
    "extrude",
    "revolve",
    "fillet",
    "chamfer",
    "loft",
    "sweep",
    "shell",
    "draft",
    "mirror",
    "pattern",
    "transform",
    "boolean",
    "import",
}


def number(v, positive=False):
    if (
        isinstance(v, bool)
        or not isinstance(v, (int, float))
        or not math.isfinite(v)
        or abs(v) > 10000
    ):
        raise ValueError("Use a finite value within ±10,000")
    if positive and v <= 0:
        raise ValueError("Value must be greater than zero")
    return float(v)


def num(f, k, default=0, positive=False):
    try:
        return number(f.get(k, default), positive)
    except ValueError as e:
        raise ValueError(f"{k}: {e}") from e


def expression(text, values):
    if not isinstance(text, str) or len(text) > 200:
        raise ValueError("Expression must be at most 200 characters")
    try:
        node = ast.parse(text, mode="eval")
    except SyntaxError as e:
        raise ValueError("Invalid parameter expression") from e
    if len(list(ast.walk(node))) > 64:
        raise ValueError("Expression is too complex")

    def visit(n):
        if isinstance(n, ast.Expression):
            return visit(n.body)
        if isinstance(n, ast.Constant):
            return number(n.value)
        if isinstance(n, ast.Name):
            if n.id == "pi":
                return math.pi
            if n.id not in values:
                raise ValueError("Unknown or forward parameter: " + n.id)
            return values[n.id]
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.UAdd, ast.USub)):
            return number(visit(n.operand) * (-1 if isinstance(n.op, ast.USub) else 1))
        if isinstance(n, ast.BinOp) and isinstance(
            n.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)
        ):
            a, b = visit(n.left), visit(n.right)
            return number(
                a + b
                if isinstance(n.op, ast.Add)
                else (
                    a - b
                    if isinstance(n.op, ast.Sub)
                    else a * b if isinstance(n.op, ast.Mult) else a / b
                )
            )
        raise ValueError("Use numbers, named parameters, + − * / and parentheses only")

    try:
        return visit(node)
    except ZeroDivisionError as e:
        raise ValueError("Parameter expression divides by zero") from e


def migrate(p):
    if (
        not isinstance(p, dict)
        or p.get("app") != "SOLIDBENCH"
        or p.get("schema") not in [1, 2]
    ):
        raise ValueError("Expected SOLIDBENCH schema 1 or 2")
    p = copy.deepcopy(p)
    if p.get("units") != "mm":
        raise ValueError("Only millimetres are supported")
    if not isinstance(p.get("name", ""), str) or len(p.get("name", "")) > 120:
        raise ValueError("Invalid project name")
    if not isinstance(p.get("features"), list) or len(p["features"]) > 200:
        raise ValueError("Maximum 200 features")
    if p["schema"] == 1:
        p["bodies"] = [
            {"id": "main", "name": "Main body", "visible": True, "color": "#91a6ad"}
        ]
        for f in p["features"]:
            f["bodyId"] = "main"
        p["schema"] = 2
    bodies = p.setdefault(
        "bodies", [{"id": "main", "name": "Main body", "visible": True}]
    )
    if not isinstance(bodies, list) or not 1 <= len(bodies) <= 30:
        raise ValueError("Use 1–30 bodies")
    ids = set()
    for b in bodies:
        if (
            not isinstance(b, dict)
            or not isinstance(b.get("id"), str)
            or not b["id"]
            or b["id"] in ids
        ):
            raise ValueError("Body IDs must be unique")
        ids.add(b["id"])
        if len(str(b.get("name", ""))) > 120:
            raise ValueError("Body name too long")
        if b.get("joint", {}).get("kind", "fixed") not in [
            "fixed",
            "revolute",
            "slider",
        ]:
            raise ValueError("Invalid joint kind")
    seen = set()
    for f in p["features"]:
        if not isinstance(f, dict) or f.get("type") not in TYPES:
            raise ValueError("Unsupported feature type")
        if not isinstance(f.get("id"), str) or f["id"] in seen or len(f["id"]) > 80:
            raise ValueError("Feature IDs must be unique")
        seen.add(f["id"])
        if f.get("bodyId", "main") not in ids:
            raise ValueError("Unknown feature body")
        if f.get("operation", "join") not in ["join", "cut", "intersect"]:
            raise ValueError("Unsupported boolean operation")
        if len(str(f.get("name", ""))) > 120:
            raise ValueError("Feature name too long")
    params = p.setdefault("parameters", [])
    if not isinstance(params, list) or len(params) > 100:
        raise ValueError("Maximum 100 named parameters")
    values = {}
    for row in params:
        name = row.get("name", "")
        if (
            not re.fullmatch("[A-Za-z_][A-Za-z_0-9]{0,39}", name)
            or name in values
            or name == "pi"
        ):
            raise ValueError("Parameter names must be unique identifiers")
        values[name] = expression(str(row.get("value", "0")), values)
    p["_values"] = values
    # Expressions belong to a feature's field map and resolve before modeling.
    for f in p["features"]:
        for key, value in f.get("expressions", {}).items():
            if key not in {
                "x",
                "y",
                "z",
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
            }:
                raise ValueError("Unsupported expression field: " + key)
            f[key] = expression(value, values)
    return p
