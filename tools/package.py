#!/usr/bin/env python3
"""Create a clean, checksummed release archive without runtime/user data."""
import hashlib, pathlib, sys, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
VERSION = "1.0.0"
SKIP = {"data", "__pycache__", "node_modules", ".git", "qa-output"}
ALLOWED_ROOT = {
    ".gitignore",
    ".dockerignore",
    "README.md",
    "ROADMAP.md",
    "CHANGELOG.md",
    "TEST-REPORT.md",
    "THIRD-PARTY-NOTICES.md",
    "LICENSE",
    "Dockerfile",
    "compose.yaml",
    "environment.yml",
    "server.py",
    "worker.py",
    "kernel.py",
    "schema.py",
    "sketches.py",
    "launch.py",
    "start.sh",
    "start.command",
    "start.bat",
}
ALLOWED_DIRS = {"public", "docs", "deploy", "tests", "examples", "tools"}


def main():
    target = (
        pathlib.Path(sys.argv[1]).resolve()
        if len(sys.argv) > 1
        else ROOT.parent / f"SOLIDBENCH-v{VERSION}-github-ready.zip"
    )
    files = []
    for file in sorted(ROOT.rglob("*")):
        if not file.is_file():
            continue
        rel = file.relative_to(ROOT)
        if any(part in SKIP for part in rel.parts) or file.suffix in [
            ".pyc",
            ".zip",
            ".sqlite3",
        ]:
            continue
        if (len(rel.parts) == 1 and rel.name in ALLOWED_ROOT) or (
            len(rel.parts) > 1 and rel.parts[0] in ALLOWED_DIRS
        ):
            files.append((rel, file))
    checksums = "".join(
        hashlib.sha256(file.read_bytes()).hexdigest() + "  " + rel.as_posix() + "\n"
        for rel, file in files
    )
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel, file in files:
            z.write(file, rel.as_posix())
        z.writestr("SHA256SUMS", checksums)
    print(f"{target}\n{len(files)+1} entries; {target.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
