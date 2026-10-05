# Direct hosting, backup and operations

## Local use: no Docker

Use the README setup and `start.sh`, `start.command` or `start.bat`. The default listener is `127.0.0.1:8080`; local operation requires no password. Only localhost/loopback Host headers are accepted in password-free mode. A FreeCAD runtime compatible with its Python interpreter is required; `launch.py --doctor` tests that pairing.

## Remote use with a host password

1. On the intended host, in the same environment/data directory used by the service, configure a password:

```sh
micromamba run -n solidbench python server.py --set-password
```

The prompt requires at least 12 characters and confirmation. Only a salted PBKDF2 hash is stored. Do not put the password into shell command arguments, project files or source control. Passwords are not included in this ZIP.

2. Start the service on loopback behind a reverse proxy:

```sh
micromamba run -n solidbench python server.py --host 127.0.0.1 --port 8080
```

3. Serve it on a dedicated HTTPS hostname. `deploy/Caddyfile.example` shows a minimal proxy for a domain you control. Set DNS and TLS prerequisites using [Caddy's HTTPS documentation](https://caddyserver.com/docs/automatic-https). The application is supported at the hostname root; arbitrary subpath hosting has not been verified.

```caddyfile
cad.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy supplies `X-Forwarded-Proto` and forwards the request Host for this HTTP upstream. Preserve those headers with other proxies; see [the reverse proxy reference](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy). The application uses the forwarded HTTPS signal for Secure cookies. Restrict the service port to the proxy/local machine. The Python HTTP service does not terminate TLS.

For private LAN binding, `--host 0.0.0.0` is available **only after a password is configured**. Use HTTPS before transmitting a password across a network. Authentication applies to all geometry, export and project APIs. The interface files themselves are public, while local browser copies remain on the device. This is one shared owner/password, not separate user identities or permissions.

Sessions last up to 12 hours in memory; a service restart signs everyone out. Login attempts are bounded per source IP. Behind a proxy all clients share that proxy IP for the limit. **Help → Sign out of this host** invalidates the current session but retains browser projects. To change the password, stop the service, run `--set-password` again with the same data directory, then restart.

## Run as a system service

`deploy/solidbench.service.example` documents a direct systemd service. Adapt paths, create an unprivileged `solidbench` account, install the compatible environment, and grant that account access to the application and writable data directory. The example expects `/srv/solidbench` for source, `/opt/solidbench-env/bin/python` for the environment and `/var/lib/solidbench` for data. Configure the password with the same `SOLIDBENCH_DATA` before starting.

The service recipe is supplied for administrator review; systemd, live TLS provisioning and production reverse proxy operation were not executed in the authoring environment. Use the release native/server tests and the doctor on the final host.

## Storage and restore

`SOLIDBENCH_DATA` overrides the default `data/` directory beside `server.py`. It contains:

- `projects.sqlite3`: project catalog and immutable JSON revision records.
- `auth.json`: password salt and hash, when configured.

Stop the service before copying the entire data directory to a protected backup location. To restore, stop the service, keep a copy of the existing data, replace it with the backup, ensure the service account owns it, and restart. Do not expose this directory through a static web server. API routes do not serve it. Browser-only projects must be exported as JSON separately.

Deleting a host project is not exposed in v1.0. To reset a personal installation completely, stop it and move `data/` aside, then configure any desired password again. This leaves a recoverable copy rather than deleting revisions. **File → New project** only replaces the current working design and is undoable.

## Queue and diagnosis

Two isolated FreeCAD subprocesses may execute concurrently, with eight admitted jobs total. Each execution times out at 90 seconds. The model progress indicator offers Cancel. Results are temporary and periodically expire; project revisions are separate SQLite records. Worker failures preserve project source. The server logs HTTP requests without logging request bodies or passwords.

- **FreeCAD unavailable:** run `launch.py --doctor`; check interpreter ABI/module path.
- **Port in use:** use `launch.py --port 8081` or stop the old service.
- **Reference changed:** edit the identified feature; inspect/rebind edges or recreate a drawing reference.
- **Invalid solid:** check closed profiles, cut overlap, wall thickness, radius and feature order; Undo preserves the previous editable state.
- **Request too large:** remove unnecessary imported geometry or split the design into projects.
- **Save conflict:** open the newer host revision or save your work as a new project; export JSON before switching if desired.
- **Browser save failed:** export JSON immediately; check browser storage/quota/private-mode restrictions.

## Optional Docker recipe

Docker is optional, not the default. The recipe targets Linux amd64 and contains a native test gate. A Docker daemon was not available for release verification. Native installation with the same pinned FreeCAD package was tested instead.

```sh
docker compose build
docker compose run --rm solidbench python server.py --set-password
docker compose up -d
```

Open http://localhost:8080 and sign in with the password you just configured. The password is necessary because the service listens on `0.0.0.0` inside its container. The published port is restricted to host loopback. A named volume persists `/app/data`; `docker compose down` retains it. `docker compose down -v` removes the volume and its projects, so do not use `-v` unless intentionally resetting with a backup.

The image uses its non-root micromamba user. Its health check verifies the HTTP session endpoint; use the doctor/API health after sign-in to check the native engine. Review architecture support and volume permissions on the actual machine, especially when running x86 emulation on ARM hosts.
