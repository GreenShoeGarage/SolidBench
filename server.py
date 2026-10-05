#!/usr/bin/env python3
"""Local CAD service, isolated bounded jobs, optional authentication and revision storage."""
import argparse, json, os, pathlib, subprocess, sys, tempfile, threading, time, secrets, hashlib, hmac, getpass, sqlite3, re
from concurrent.futures import ThreadPoolExecutor
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from http.cookies import SimpleCookie
from urllib.parse import urlsplit
from schema import migrate, VERSION

ROOT = pathlib.Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA = pathlib.Path(os.getenv("SOLIDBENCH_DATA", str(ROOT / "data"))).resolve()
SLOTS = threading.BoundedSemaphore(8)
POOL = ThreadPoolExecutor(max_workers=2)
LOCK = threading.RLock()
JOBS = {}
SESSIONS = {}
ATTEMPTS = {}
AUTH = None
MAX_REQUEST = 18_000_000
LIMIT = 90


def connect():
    db = sqlite3.connect(DATA / "projects.sqlite3", timeout=10)
    db.row_factory = sqlite3.Row
    return db


def init_storage():
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    with connect() as db:
        db.executescript(
            "CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT,revision INTEGER,updated REAL);CREATE TABLE IF NOT EXISTS revisions(project_id TEXT,revision INTEGER,label TEXT,data TEXT,created REAL,PRIMARY KEY(project_id,revision));"
        )
    try:
        os.chmod(DATA / "projects.sqlite3", 0o600)
    except OSError:
        pass


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode(), bytes.fromhex(salt), 600000
    ).hex()


def compute(request, job=None):
    with tempfile.TemporaryDirectory(prefix="solidbench-") as td:
        inp = pathlib.Path(td) / "job.json"
        out = pathlib.Path(td) / "result.json"
        inp.write_text(json.dumps(request))
        proc = subprocess.Popen(
            [
                os.getenv("FREECAD_PYTHON", sys.executable),
                str(ROOT / "worker.py"),
                str(inp),
                str(out),
            ],
            env=dict(os.environ, QT_QPA_PLATFORM="offscreen"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if job is not None:
            with LOCK:
                job["process"] = proc
                if job.get("cancelled"):
                    proc.terminate()
        try:
            stdout, stderr = proc.communicate(timeout=LIMIT)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()
            raise ValueError("Model exceeded 90 seconds; simplify it and retry")
        if job and job.get("cancelled"):
            raise ValueError("Job cancelled")
        if not out.exists():
            raise ValueError(
                "FreeCAD worker failed to start or exited. Run start.sh --doctor (or start.bat --doctor) and check the compatible Python environment. "
                + stderr.decode(errors="replace")[-240:]
            )
        result = json.loads(out.read_text())
        if not result.get("ok"):
            raise ValueError(result.get("error", "Geometry failed"))
        if request.get("action") == "export":
            return pathlib.Path(result["file"]).read_bytes()
        return result


def run_job(job, req):
    with LOCK:
        if job.get("cancelled"):
            job["state"] = "cancelled"
            job["finished"] = time.time()
            return
        job["state"] = "running"
    try:
        result = compute(req, job)
        with LOCK:
            job["result"] = result
            job["state"] = "cancelled" if job.get("cancelled") else "complete"
    except Exception as e:
        with LOCK:
            job["error"] = str(e)
            job["state"] = "cancelled" if job.get("cancelled") else "failed"
    finally:
        with LOCK:
            job.pop("process", None)
            job["finished"] = time.time()


def new_job(req, owner):
    with LOCK:
        now = time.time()
        for key, j in list(JOBS.items()):
            if j.get("finished", now) + 300 < now:
                JOBS.pop(key, None)
        # Retain only a bounded number of completed mesh results, in addition to time expiry.
        completed = sorted(
            ((key, j) for key, j in JOBS.items() if "finished" in j),
            key=lambda item: item[1]["finished"],
            reverse=True,
        )
        for key, _ in completed[16:]:
            JOBS.pop(key, None)
        if sum(j["state"] in ["queued", "running"] for j in JOBS.values()) >= 8:
            raise ValueError(
                "Model queue is full. Wait for an existing job or cancel it."
            )
        key = secrets.token_urlsafe(24)
        job = {
            "id": key,
            "owner": owner,
            "state": "queued",
            "created": now,
            "cancelled": False,
        }
        submit_bounded(run_job, job, req)
        JOBS[key] = job
    return job


def submit_bounded(fn, *args):
    if not SLOTS.acquire(blocking=False):
        raise ValueError("Model queue is full. Wait for an existing job or cancel it.")
    try:
        future = POOL.submit(fn, *args)
    except Exception:
        SLOTS.release()
        raise
    future.add_done_callback(lambda f: SLOTS.release())
    return future


def compute_sync(req):
    # Includes the possible wait behind six queued jobs; execution is separately limited.
    return submit_bounded(compute, req).result(timeout=LIMIT * 4 + 10)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(PUBLIC), **kw)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Cache-Control", "no-store" if self.path.startswith("/api/") else "no-cache"
        )
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        )
        super().end_headers()

    def send_json(self, code, data):
        raw = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def identity(self):
        if AUTH is None:
            return "local"
        try:
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
            token = cookies["solidbench"].value
            with LOCK:
                if SESSIONS.get(token, 0) > time.time():
                    return token
        except (KeyError, ValueError):
            pass
        return None

    def require_auth(self):
        owner = self.identity()
        if owner is None:
            self.send_json(
                401, {"ok": False, "error": "Sign in to your SOLIDBENCH host"}
            )
            return None
        return owner

    def same_origin(self):
        origin = self.headers.get("Origin")
        return self.headers.get("Sec-Fetch-Site") != "cross-site" and (
            not origin or urlsplit(origin).netloc == self.headers.get("Host")
        )

    def allowed_host(self):
        try:
            host = urlsplit("http://" + self.headers.get("Host", "")).hostname
        except ValueError:
            host = None
        if AUTH is None and host not in ["localhost", "127.0.0.1", "::1"]:
            self.send_json(
                403,
                {
                    "ok": False,
                    "error": "Use localhost or configure a password for remote access",
                },
            )
            return False
        return True

    def do_GET(self):
        if not self.allowed_host():
            return
        route = urlsplit(self.path).path
        if not route.startswith("/api/"):
            if ".." in route.split("/") or route.startswith("/."):
                self.send_error(404)
                return
            return super().do_GET()
        if route == "/api/session":
            self.send_json(
                200,
                {
                    "ok": True,
                    "authenticated": self.identity() is not None,
                    "required": AUTH is not None,
                    "version": VERSION,
                },
            )
            return
        owner = self.require_auth()
        if owner is None:
            return
        try:
            if route == "/api/health":
                self.send_json(200, compute_sync({"action": "health"}))
                return
            if route == "/api/projects":
                with connect() as db:
                    rows = [
                        dict(r)
                        for r in db.execute(
                            "SELECT * FROM projects ORDER BY updated DESC"
                        )
                    ]
                self.send_json(200, {"ok": True, "projects": rows})
                return
            m = re.fullmatch(r"/api/projects/([a-zA-Z0-9_-]{1,80})(?:/(\d+))?", route)
            if m:
                pid, rev = m.groups()
                with connect() as db:
                    if rev:
                        row = db.execute(
                            "SELECT * FROM revisions WHERE project_id=? AND revision=?",
                            (pid, int(rev)),
                        ).fetchone()
                        if row is None:
                            raise ValueError("Revision not found")
                        self.send_json(
                            200,
                            {
                                "ok": True,
                                "project": json.loads(row["data"]),
                                "revision": row["revision"],
                                "label": row["label"],
                            },
                        )
                    else:
                        rows = [
                            dict(r)
                            for r in db.execute(
                                "SELECT revision,label,created FROM revisions WHERE project_id=? ORDER BY revision DESC",
                                (pid,),
                            )
                        ]
                        self.send_json(200, {"ok": True, "revisions": rows})
                return
            m = re.fullmatch(r"/api/jobs/([a-zA-Z0-9_-]+)", route)
            if m:
                with LOCK:
                    job = JOBS.get(m.group(1))
                    if not job or job["owner"] != owner:
                        raise ValueError("Job not found or expired")
                    result = {
                        k: job[k]
                        for k in ["id", "state", "error", "result"]
                        if k in job
                    }
                self.send_json(200, {"ok": True, **result})
                return
            self.send_error(404)
        except ValueError as e:
            self.send_json(422, {"ok": False, "error": str(e)})
        except Exception:
            self.send_json(
                500,
                {
                    "ok": False,
                    "error": "Server operation failed; project data was retained",
                },
            )

    def do_POST(self):
        if not self.allowed_host():
            return
        route = urlsplit(self.path).path
        if not self.same_origin():
            self.send_json(
                403, {"ok": False, "error": "Cross-origin requests are not allowed"}
            )
            return
        if not self.headers.get("Content-Type", "").startswith("application/json"):
            self.send_json(415, {"ok": False, "error": "Use application/json"})
            return
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= MAX_REQUEST:
                raise ValueError("Request must be no larger than 18 MB")
            req = json.loads(self.rfile.read(size))
            if not isinstance(req, dict):
                raise ValueError("Expected a JSON object")
            if route == "/api/login":
                if AUTH is None:
                    self.send_json(200, {"ok": True})
                    return
                ip = self.client_address[0]
                now = time.time()
                with LOCK:
                    attempts = [t for t in ATTEMPTS.get(ip, []) if t > now - 300]
                    if len(attempts) >= 10:
                        self.send_json(
                            429,
                            {
                                "ok": False,
                                "error": "Too many attempts. Wait five minutes.",
                            },
                        )
                        return
                    ATTEMPTS[ip] = attempts + [now]
                pw = req.get("password", "")
                if (
                    not isinstance(pw, str)
                    or len(pw) > 1024
                    or not hmac.compare_digest(
                        password_hash(pw, AUTH["salt"]), AUTH["hash"]
                    )
                ):
                    self.send_json(401, {"ok": False, "error": "Incorrect password"})
                    return
                token = secrets.token_urlsafe(32)
                with LOCK:
                    SESSIONS[token] = now + 43200
                self.send_response(200)
                self.send_header(
                    "Set-Cookie",
                    f"solidbench={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200"
                    + (
                        "; Secure"
                        if self.headers.get("X-Forwarded-Proto") == "https"
                        else ""
                    ),
                )
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"ok":true}')
                return
            owner = self.require_auth()
            if owner is None:
                return
            if route == "/api/logout":
                with LOCK:
                    SESSIONS.pop(owner, None)
                self.send_json(200, {"ok": True})
                return
            if route == "/api/jobs":
                if req.get("action") not in [
                    "model",
                    "sketch",
                    "drawing",
                    "interference",
                ]:
                    raise ValueError("Unsupported queued action")
                if "project" in req:
                    migrate(req["project"])
                j = new_job(req, owner)
                self.send_json(202, {"ok": True, "id": j["id"], "state": j["state"]})
                return
            m = re.fullmatch(r"/api/jobs/([a-zA-Z0-9_-]+)/cancel", route)
            if m:
                with LOCK:
                    job = JOBS.get(m.group(1))
                    if not job or job["owner"] != owner:
                        raise ValueError("Job not found")
                    job["cancelled"] = True
                    if job.get("process"):
                        job["process"].terminate()
                self.send_json(200, {"ok": True})
                return
            if route == "/api/projects/save":
                p = req["project"]
                migrate(p)
                pid = req.get("id") or secrets.token_urlsafe(12)
                if not re.fullmatch("[a-zA-Z0-9_-]{1,80}", pid):
                    raise ValueError("Invalid project identifier")
                with connect() as db:
                    db.execute("BEGIN IMMEDIATE")
                    row = db.execute(
                        "SELECT revision FROM projects WHERE id=?", (pid,)
                    ).fetchone()
                    current = row["revision"] if row else 0
                    if req.get("expectedRevision", 0) != current:
                        self.send_json(
                            409,
                            {
                                "ok": False,
                                "error": "A newer revision exists on the host. Open it or save your work as a separate project.",
                            },
                        )
                        return
                    rev = current + 1
                    now = time.time()
                    db.execute(
                        "INSERT OR REPLACE INTO projects VALUES(?,?,?,?)",
                        (pid, p.get("name", "Untitled"), rev, now),
                    )
                    db.execute(
                        "INSERT INTO revisions VALUES(?,?,?,?,?)",
                        (
                            pid,
                            rev,
                            str(req.get("label", "Saved revision"))[:120],
                            json.dumps(p),
                            now,
                        ),
                    )
                self.send_json(200, {"ok": True, "id": pid, "revision": rev})
                return
            if route in [
                "/api/model",
                "/api/sketch",
                "/api/export",
                "/api/drawing",
                "/api/interference",
            ]:
                req["action"] = route.split("/")[-1]
                if "project" in req:
                    migrate(req["project"])
                if req["action"] == "export" and req.get("format") not in [
                    "step",
                    "stl",
                    "FCStd",
                    "brep",
                ]:
                    raise ValueError("Unsupported export format")
                # Legacy synchronous endpoints share the bounded pool with queued UI jobs.
                result = compute_sync(req)
                if isinstance(result, bytes):
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Content-Length", str(len(result)))
                    self.end_headers()
                    self.wfile.write(result)
                else:
                    self.send_json(200, result)
                return
            self.send_error(404)
        except (ValueError, KeyError, TypeError) as e:
            self.send_json(422, {"ok": False, "error": str(e)})
        except Exception:
            self.send_json(
                500,
                {
                    "ok": False,
                    "error": "Server operation failed; project data was retained",
                },
            )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--set-password", action="store_true")
    args = ap.parse_args()
    init_storage()
    authfile = DATA / "auth.json"
    if args.set_password:
        pw = getpass.getpass("Host password (minimum 12 characters): ")
        if len(pw) < 12:
            raise SystemExit("Use at least 12 characters")
        if pw != getpass.getpass("Repeat password: "):
            raise SystemExit("Passwords did not match")
        salt = secrets.token_hex(16)
        authfile.write_text(json.dumps({"salt": salt, "hash": password_hash(pw, salt)}))
        os.chmod(authfile, 0o600)
        print("Host password configured")
        raise SystemExit(0)
    if authfile.exists():
        AUTH = json.loads(authfile.read_text())
    if args.host not in ["127.0.0.1", "localhost", "::1"] and AUTH is None:
        raise SystemExit(
            "Remote binding requires a host password. Run python server.py --set-password first."
        )
    print(f"SOLIDBENCH v{VERSION} → http://{args.host}:{args.port}", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()
