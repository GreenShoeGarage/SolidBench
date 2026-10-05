"""Representative project corpus with analytic expected volumes."""

import json, math, pathlib, sys, unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import kernel

ROOT = pathlib.Path(__file__).resolve().parents[1]


class ExampleCorpus(unittest.TestCase):
    def tearDown(self):
        for name in list(kernel.App.listDocuments()):
            kernel.App.closeDocument(name)

    def test_representative_parts(self):
        expected = {
            "workbench-bracket": 42857.38957818435,
            "parametric-spacer": math.pi * (15**2 - 4**2) * 12,
            "instrument-enclosure": 60 * 40 * 20
            - 56 * 36 * 18
            + 60 * 40 * 2
            - 2 * math.pi * 2.5**2 * 2,
        }
        for name, volume in expected.items():
            with self.subTest(project=name):
                p = json.loads(
                    (ROOT / "examples" / f"{name}.solidbench.json").read_text()
                )
                doc, obj, history = kernel.build(p)
                self.assertAlmostEqual(obj.Shape.Volume, volume, places=3)
                self.assertTrue(kernel.mesh(obj.Shape)["valid"])
                views = kernel.drawing(obj.Shape)
                self.assertTrue(all(v["vertices"] for v in views.values()))


if __name__ == "__main__":
    unittest.main()
