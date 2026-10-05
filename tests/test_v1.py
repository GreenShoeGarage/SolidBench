import unittest, sys, pathlib, math, base64, tempfile, json

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import kernel
from schema import migrate, expression

A, P = kernel.App, kernel.Part


def project(features, bodies=None, parameters=None):
    return {
        "app": "SOLIDBENCH",
        "schema": 2,
        "units": "mm",
        "name": "Release test",
        "parameters": parameters or [],
        "bodies": bodies or [{"id": "main", "name": "Main", "visible": True}],
        "features": [
            dict(id="f" + str(i), name="Feature " + str(i), bodyId="main", **f)
            for i, f in enumerate(features)
        ],
    }


BOX = dict(type="box", width=20, height=20, depth=20)


class ReleaseGeometry(unittest.TestCase):
    def tearDown(self):
        for n in list(A.listDocuments()):
            A.closeDocument(n)

    def solid(self, p):
        d, o, h = kernel.build(p)
        self.assertIsNotNone(o)
        self.assertTrue(o.Shape.isValid())
        self.assertTrue(kernel.mesh(o.Shape)["valid"])
        return d, o, h

    def test_legacy_migration(self):
        p = project([BOX])
        p["schema"] = 1
        p.pop("bodies")
        p["features"][0].pop("bodyId")
        m = migrate(p)
        self.assertEqual(m["schema"], 2)
        self.assertEqual(m["features"][0]["bodyId"], "main")

    def test_parameters(self):
        p = project(
            [dict(BOX, expressions={"width": "length", "depth": "wall * 2"})],
            parameters=[
                {"name": "wall", "value": "3"},
                {"name": "length", "value": "wall * 10"},
            ],
        )
        d, o, h = self.solid(p)
        self.assertAlmostEqual(o.Shape.Volume, 3600, 5)
        for expr in ['__import__("os")', "a.b", "[1][0]", "2**100000", "missing+2"]:
            with self.assertRaises(Exception):
                expression(expr, {})

    def test_constrained_sketch(self):
        d = A.newDocument()
        g = [
            {"kind": "line", "x1": 0, "y1": 0, "x2": 19, "y2": 1},
            {"kind": "line", "x1": 19, "y1": 1, "x2": 19, "y2": 10},
            {"kind": "line", "x1": 19, "y1": 10, "x2": 0, "y2": 10},
            {"kind": "line", "x1": 0, "y1": 10, "x2": 0, "y2": 0},
        ]
        c = [
            {"kind": "Coincident", "a": i + 1, "pa": 2, "b": (i + 1) % 4 + 1, "pb": 1}
            for i in range(4)
        ] + [
            {"kind": "Horizontal", "a": 1},
            {"kind": "Horizontal", "a": 3},
            {"kind": "Vertical", "a": 2},
            {"kind": "Vertical", "a": 4},
            {"kind": "Distance", "a": 1, "value": 20},
            {"kind": "Distance", "a": 2, "value": 10},
            {"kind": "Coincident", "a": 1, "pa": 1, "b": 4, "pb": 2},
        ]
        # Deliberate duplicate coincidence must be diagnosed.
        from sketches import make_profile

        with self.assertRaises(ValueError):
            make_profile(
                d, {"profile": "custom", "geometry": g, "constraints": c}, "Bad"
            )
        A.closeDocument(d.Name)
        d = A.newDocument()
        s, n, diag = make_profile(
            d, {"profile": "custom", "geometry": g, "constraints": c[:-1]}, "Good"
        )
        self.assertTrue(s.Shape.Wires[0].isClosed())
        self.assertFalse(diag["fullyConstrained"])
        self.assertAlmostEqual(s.Geometry[0].length(), 20, 5)

    def test_arc_profile(self):
        g = [
            {"kind": "arc", "cx": 0, "cy": 0, "radius": 10, "start": 0, "end": 180},
            {"kind": "line", "x1": -10, "y1": 0, "x2": 10, "y2": 0},
        ]
        d, o, h = self.solid(
            project(
                [{"type": "extrude", "profile": "custom", "geometry": g, "depth": 5}]
            )
        )
        self.assertAlmostEqual(o.Shape.Volume, math.pi * 100 / 2 * 5, 5)

    def test_loft_sweep(self):
        d, o, h = self.solid(
            project(
                [
                    {
                        "type": "loft",
                        "sections": [
                            {
                                "profile": "rectangle",
                                "width": 20,
                                "height": 20,
                                "offset": 0,
                            },
                            {
                                "profile": "rectangle",
                                "width": 20,
                                "height": 20,
                                "offset": 30,
                            },
                        ],
                    }
                ]
            )
        )
        self.assertAlmostEqual(o.Shape.Volume, 12000, 4)
        d, o, h = self.solid(
            project(
                [
                    {
                        "type": "sweep",
                        "radius": 3,
                        "path": [[0, 0, 0], [0, 0, 30], [20, 0, 50]],
                    }
                ]
            )
        )
        self.assertGreater(o.Shape.Volume, 1000)

    def test_shell_draft(self):
        d, o, h = self.solid(
            project([BOX, {"type": "shell", "faces": [6], "thickness": 2}])
        )
        self.assertLess(o.Shape.Volume, 8000)
        d, o, h = self.solid(
            project(
                [
                    BOX,
                    {
                        "type": "draft",
                        "faces": [1, 2, 3, 4],
                        "neutralFace": 5,
                        "angle": 5,
                    },
                ]
            )
        )
        self.assertLess(o.Shape.Volume, 8000)

    def test_mirror_pattern_transform(self):
        d, o, h = self.solid(
            project([dict(BOX, x=5), {"type": "mirror", "nx": 1, "keep": True}])
        )
        self.assertAlmostEqual(o.Shape.Volume, 16000, 4)
        d, o, h = self.solid(project([BOX, {"type": "pattern", "count": 3, "dx": 30}]))
        self.assertAlmostEqual(o.Shape.Volume, 24000, 4)
        d, o, h = self.solid(
            project([BOX, {"type": "transform", "dx": 25, "angle": 90, "az": 1}])
        )
        self.assertAlmostEqual(o.Shape.BoundBox.XMax, 25, 4)

    def test_multi_body_joint_and_interference(self):
        p = project([BOX, BOX])
        p["bodies"].append(
            {
                "id": "second",
                "name": "Second",
                "visible": True,
                "joint": {
                    "kind": "slider",
                    "ax": 1,
                    "az": 0,
                    "value": 10,
                    "min": 0,
                    "max": 50,
                },
            }
        )
        p["features"][1]["bodyId"] = "second"
        d, o, h = self.solid(p)
        items = kernel.outputs(d, p)
        self.assertEqual(len(items), 2)
        self.assertAlmostEqual(
            items[0][1].Shape.common(items[1][1].Shape).Volume, 4000, 4
        )
        self.assertAlmostEqual(o.Shape.BoundBox.XMax, 30, 4)

    def test_step_import_and_drawings(self):
        with tempfile.TemporaryDirectory() as t:
            f = pathlib.Path(t) / "source.step"
            P.makeBox(10, 20, 30).exportStep(str(f))
            p = project(
                [{"type": "import", "step": base64.b64encode(f.read_bytes()).decode()}]
            )
            d, o, h = self.solid(p)
            self.assertAlmostEqual(o.Shape.Volume, 6000, 5)
            views = kernel.drawing(o.Shape)
            self.assertEqual(set(views), {"top", "front", "right"})
            self.assertIn("<path", views["top"]["svg"])
            self.assertEqual(views["top"]["bounds"], [0, -20, 10, 0])
            self.assertEqual(
                [round(v, 5) for v in views["front"]["bounds"]], [0, -30, 10, 0]
            )
            self.assertEqual(
                [round(v, 5) for v in views["right"]["bounds"]], [0, -30, 20, 0]
            )

    def test_edge_reference_and_native_final_recompute(self):
        d, o, h = self.solid(project([BOX]))
        ref = kernel.signature(o.Shape.Edges[0], o.Shape)
        d, o, h = self.solid(
            project(
                [BOX, {"type": "fillet", "radius": 1, "edges": [1], "edgeRefs": [ref]}]
            )
        )
        self.assertLess(o.Shape.Volume, 8000)
        with self.assertRaises(ValueError):
            self.solid(
                project(
                    [
                        dict(BOX, width=25),
                        {
                            "type": "fillet",
                            "radius": 1,
                            "edges": [1],
                            "edgeRefs": [ref],
                        },
                    ]
                )
            )
        d, o, h = self.solid(project([BOX]))
        d.getObject("Feature1Tool").Length = 30
        d.recompute()
        self.assertAlmostEqual(o.Shape.Volume, 12000, 4)


if __name__ == "__main__":
    unittest.main()
