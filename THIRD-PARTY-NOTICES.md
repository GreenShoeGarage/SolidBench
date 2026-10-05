# Third-party notices

SOLIDBENCH application source is copyright 2026 Green Shoe Garage / Michael Parks and licensed under GNU GPL v3 only. Full terms are in `LICENSE`.

- **Three.js 0.170.0**, including TrackballControls: MIT license, bundled in `public/vendor/`; full upstream license in `THREE-LICENSE.txt`. Source: https://github.com/mrdoob/three.js/tree/r170 . The browser renderer is bundled without source modifications.
- **FreeCAD**: independently installed geometry engine, not bundled in this ZIP. The tested conda-forge package is `freecad=2026.09.16`, reporting FreeCAD 26.3.0. FreeCAD and its dependencies retain their upstream licenses. Source and licensing: https://github.com/FreeCAD/FreeCAD . Conda recipe: https://github.com/conda-forge/freecad-feedstock . Installing the environment or Docker image downloads those third-party packages.
- **micromamba Docker base**: hosting recipe uses `mambaorg/micromamba:2.9.0`; documentation and source: https://micromamba-docker.readthedocs.io/en/latest/quick_start.html and https://github.com/mamba-org/micromamba-docker . The image is not bundled in this ZIP.

Autodesk Fusion and FreeCAD are names of their respective products. SOLIDBENCH is independent and uses its own branding, interface code and icons. Interface organization was informed by public modeling concepts (sketches, feature history, model browser), not copied proprietary source or assets.

Reference material consulted:
- https://www.freecad.org/features.php
- https://github.com/FreeCAD/FreeCAD-documentation
- https://help.autodesk.com/view/fusion360/ENU/?contextId=DESIGN_HISTORY
- https://help.autodesk.com/view/fusion360/ENU/?contextId=SKT-3D-SKETCH
