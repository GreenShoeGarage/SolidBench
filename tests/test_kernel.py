"""Run using the same Python as FreeCAD: python -m unittest discover -s tests -v."""

import unittest, sys, pathlib, math, tempfile, json

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import kernel

App, Part = kernel.App, kernel.Part


def project(*features):
    return {
        "app": "SOLIDBENCH",
        "schema": 1,
        "units": "mm",
        "name": "Test part",
        "features": [
            dict(id=str(i), name="Feature " + str(i), **f)
            for i, f in enumerate(features)
        ],
    }


BOX = {"type": "box", "width": 40, "height": 30, "depth": 10}


class GeometryTests(unittest.TestCase):
    def tearDown(self):
        for n in list(App.listDocuments()):
            App.closeDocument(n)

    def solid(self, p):
        d, o, h = kernel.build(p)
        self.assertTrue(o.Shape.isValid())
        return d, o, h

    def test_boolean_cut_and_intersection(self):
        d, o, h = self.solid(
            project(
                BOX,
                {
                    "type": "cylinder",
                    "x": 20,
                    "y": 15,
                    "z": -1,
                    "radius": 3,
                    "depth": 12,
                    "operation": "cut",
                },
            )
        )
        self.assertAlmostEqual(o.Shape.Volume, 12000 - math.pi * 90, 5)
        d, o, h = self.solid(project(BOX, dict(BOX, x=20, operation="intersect")))
        self.assertAlmostEqual(o.Shape.Volume, 6000, 5)

    def test_three_planes(self):
        for plane in ["XY", "XZ", "YZ"]:
            d, o, h = self.solid(
                project(
                    {
                        "type": "extrude",
                        "profile": "rectangle",
                        "plane": plane,
                        "width": 20,
                        "height": 10,
                        "depth": 3,
                        "offset": 2,
                    }
                )
            )
            self.assertAlmostEqual(o.Shape.Volume, 600, 5)

    def test_polygon_and_revolve(self):
        d, o, h = self.solid(
            project(
                {
                    "type": "extrude",
                    "profile": "polygon",
                    "points": [[0, 0], [20, 0], [0, 10]],
                    "depth": 4,
                }
            )
        )
        self.assertAlmostEqual(o.Shape.Volume, 400, 5)
        d, o, h = self.solid(
            project(
                {
                    "type": "revolve",
                    "profile": "rectangle",
                    "x": 10,
                    "y": 0,
                    "width": 5,
                    "height": 20,
                    "angle": 360,
                }
            )
        )
        self.assertAlmostEqual(o.Shape.Volume, math.pi * (225 - 100) * 20, 5)

    def test_fillets_chamfers(self):
        for typ in ["fillet", "chamfer"]:
            d, o, h = self.solid(project(BOX, {"type": typ, "radius": 1, "edges": [1]}))
            self.assertLess(o.Shape.Volume, 12000)

    def test_native_recompute_step_roundtrip(self):
        d, o, h = self.solid(
            project(
                BOX,
                {
                    "type": "cylinder",
                    "x": 20,
                    "y": 15,
                    "radius": 3,
                    "depth": 10,
                    "operation": "cut",
                },
            )
        )
        with tempfile.TemporaryDirectory() as t:
            f = str(pathlib.Path(t) / "part.FCStd")
            d.saveAs(f)
            App.closeDocument(d.Name)
            d = App.openDocument(f)
            self.assertAlmostEqual(
                d.getObject("Feature2").Shape.Volume, 12000 - math.pi * 90, 5
            )
            d.getObject("Feature1Tool").Length = 50
            d.recompute()
            result = d.getObject("Feature2")
            self.assertAlmostEqual(result.Shape.Volume, 15000 - math.pi * 90, 5)
            step = str(pathlib.Path(t) / "part.step")
            Part.export([result], step)
            s = Part.Shape()
            s.read(step)
            self.assertAlmostEqual(s.Volume, result.Shape.Volume, 4)
            stl = str(pathlib.Path(t) / "part.stl")
            result.Shape.exportStl(stl)
            self.assertGreater(pathlib.Path(stl).stat().st_size, 100)

    def test_suppression_and_bad_geometry(self):
        d, o, h = self.solid(project(BOX, dict(BOX, suppressed=True, operation="cut")))
        self.assertEqual(len(h), 1)
        for p in [
            project(dict(BOX, width=-1)),
            project(dict(BOX, operation="cut")),
            project(BOX, dict(BOX, operation="cut")),
            project(BOX, {"type": "fillet", "radius": 1, "edges": [999]}),
        ]:
            with self.assertRaises(ValueError):
                kernel.build(p)

    def test_mesh_consistency(self):
        d, o, h = self.solid(project(BOX))
        m = kernel.mesh(o.Shape)
        self.assertEqual(m["bounds"], [0, 0, 0, 40, 30, 10])
        self.assertEqual(m["faces"], 6)
        self.assertGreater(len(m["indices"]), 0)
        self.assertLess(max(m["indices"]), len(m["positions"]) // 3)


if __name__ == "__main__":
    unittest.main()
