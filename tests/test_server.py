import unittest, sys, pathlib, subprocess, os, tempfile, json, time, urllib.request, urllib.error, http.cookiejar, hashlib, socket

ROOT = pathlib.Path(__file__).resolve().parents[1]


class HostingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.t = tempfile.TemporaryDirectory()
        data = pathlib.Path(cls.t.name)
        salt = "00" * 16
        pw = "solidbench-test-password"
        digest = hashlib.pbkdf2_hmac(
            "sha256", pw.encode(), bytes.fromhex(salt), 600000
        ).hex()
        (data / "auth.json").write_text(json.dumps({"salt": salt, "hash": digest}))
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.base = "http://127.0.0.1:" + str(port)
        cls.s = subprocess.Popen(
            [sys.executable, str(ROOT / "server.py"), "--port", str(port)],
            env=dict(os.environ, SOLIDBENCH_DATA=str(data)),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.client = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )
        for _ in range(100):
            try:
                urllib.request.urlopen(cls.base + "/api/session", timeout=1)
                break
            except OSError:
                time.sleep(0.03)

    @classmethod
    def tearDownClass(cls):
        cls.s.terminate()
        cls.s.wait(timeout=5)
        cls.t.cleanup()

    def request(self, path, data=None, client=None, headers=None):
        req = urllib.request.Request(
            self.base + path,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"Content-Type": "application/json", **(headers or {})},
        )
        try:
            r = (client or self.client).open(req, timeout=20)
            return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def login(self):
        status, d = self.request("/api/login", {"password": "solidbench-test-password"})
        self.assertEqual(status, 200)

    def test_auth_origin_and_revisions(self):
        status, _ = self.request("/api/projects", client=urllib.request.build_opener())
        self.assertEqual(status, 401)
        self.assertEqual(self.request("/api/login", {"password": "wrong"})[0], 401)
        self.login()
        p = json.loads(
            (ROOT / "examples/workbench-bracket.solidbench.json").read_text()
        )
        self.assertEqual(
            self.request(
                "/api/projects/save",
                {"project": p},
                headers={"Origin": "https://unrelated.invalid"},
            )[0],
            403,
        )
        status, d = self.request("/api/projects/save", {"project": p, "label": "first"})
        self.assertEqual(status, 200)
        pid = d["id"]
        self.assertEqual(d["revision"], 1)
        self.assertEqual(
            self.request(
                "/api/projects/save", {"id": pid, "expectedRevision": 0, "project": p}
            )[0],
            409,
        )
        p["name"] = "Revision two"
        status, d = self.request(
            "/api/projects/save", {"id": pid, "expectedRevision": 1, "project": p}
        )
        self.assertEqual(d["revision"], 2)
        old = self.request("/api/projects/" + pid + "/1")[1]
        self.assertNotEqual(old["project"]["name"], p["name"])
        self.assertEqual(len(self.request("/api/projects/" + pid)[1]["revisions"]), 2)

    def test_queued_model_and_cancellation(self):
        self.login()
        p = json.loads(
            (ROOT / "examples/workbench-bracket.solidbench.json").read_text()
        )
        status, j = self.request("/api/jobs", {"action": "model", "project": p})
        self.assertEqual(status, 202)
        for _ in range(100):
            data = self.request("/api/jobs/" + j["id"])[1]
            if data["state"] in ["complete", "failed"]:
                break
            time.sleep(0.03)
        self.assertEqual(data["state"], "complete")
        self.assertTrue(data["result"]["mesh"]["valid"])
        status, j = self.request("/api/jobs", {"action": "model", "project": p})
        self.assertEqual(status, 202)
        self.request("/api/jobs/" + j["id"] + "/cancel", {})
        for _ in range(100):
            data = self.request("/api/jobs/" + j["id"])[1]
            if data["state"] not in ["queued", "running"]:
                break
            time.sleep(0.02)
        self.assertEqual(data["state"], "cancelled")

    def test_invalid_import_data(self):
        self.login()
        p = json.loads(
            (ROOT / "examples/workbench-bracket.solidbench.json").read_text()
        )
        p["schema"] = 999
        self.assertEqual(self.request("/api/model", {"project": p})[0], 422)


if __name__ == "__main__":
    unittest.main()
