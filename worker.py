"""Import the FreeCAD adapter outside __main__; FreeCAD initializes that namespace."""

import kernel
import sys, json, pathlib

if __name__ == "__main__":
    try:
        kernel.run(sys.argv[1], sys.argv[2])
    except Exception as exc:
        pathlib.Path(sys.argv[2]).write_text(
            json.dumps({"ok": False, "error": str(exc)})
        )
        sys.exit(1)
