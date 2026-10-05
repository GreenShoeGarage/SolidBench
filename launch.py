#!/usr/bin/env python3
"""Direct launcher and diagnosis; no Docker required."""
import argparse, json, os, pathlib, subprocess, sys, tempfile, webbrowser, threading

ROOT = pathlib.Path(__file__).resolve().parent


def doctor():
    with tempfile.TemporaryDirectory() as d:
        a = pathlib.Path(d) / "in.json"
        b = pathlib.Path(d) / "out.json"
        a.write_text('{"action":"health"}')
        cmd = [
            os.getenv("FREECAD_PYTHON", sys.executable),
            str(ROOT / "worker.py"),
            str(a),
            str(b),
        ]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=30)
        except Exception as e:
            print("Cannot start FreeCAD Python:", e)
            return False
        if b.exists():
            result = json.loads(b.read_text())
            print(json.dumps(result, indent=2))
            return result.get("ok", False)
        print(
            "FreeCAD did not initialize. Use the Python from the installed solidbench environment.\n"
            + r.stderr.decode(errors="replace")[-1500:]
        )
        return False


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--doctor", action="store_true")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    if not doctor():
        sys.exit(1)
    if args.doctor:
        sys.exit(0)
    proc = subprocess.Popen(
        [sys.executable, str(ROOT / "server.py"), "--port", str(args.port)]
    )
    timer = None
    if not args.no_browser:
        timer = threading.Timer(
            1,
            lambda: (
                webbrowser.open(f"http://localhost:{args.port}")
                if proc.poll() is None
                else None
            ),
        )
        timer.start()
    try:
        sys.exit(proc.wait())
    except KeyboardInterrupt:
        proc.terminate()
        proc.wait()
        sys.exit(0)
    finally:
        if timer:
            timer.cancel()
