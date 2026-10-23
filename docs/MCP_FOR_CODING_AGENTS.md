# Project-Ops MCP for coding agents

A self-host instance exposes Streamable HTTP MCP at
`http://127.0.0.1:3201/api/v1/mcp`. Use a scoped Personal Access Token (`po_pat_`)
owned by a signed-in user. Complete the local admin bootstrap in
[README.md](../README.md) first.

## Create an expiring PAT on localhost

The single mint route is `POST /api/v1/auth/pats`. Authenticate it with the
short-lived session JWT returned by `POST /api/v1/auth/login`; a PAT cannot mint
another PAT. The response field `plaintext` is returned only once. Keep it in
your agent client's secret store, never in a repository or a transcript.

Run the following in a private, interactive terminal with Python 3. It prompts
for your generated admin email/password, keeps the session JWT in memory, and
mints a read-only token that expires in one day. Do not redirect or record the
output. No server access or signing secret is needed.

```bash
python3 - <<'PYTHON'
import datetime
import getpass
import json
import sys
import urllib.request

if not sys.stdout.isatty():
    raise SystemExit("Use a private terminal; do not redirect token output.")

base = "http://127.0.0.1:3201/api/v1"

def post(path, body, bearer=None):
    headers = {"Content-Type": "application/json"}
    if bearer:
        headers["Authorization"] = "Bearer " + bearer
    request = urllib.request.Request(
        base + path, json.dumps(body).encode(), headers, method="POST"
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)

# /dev/tty is needed because the script itself is read from stdin.
with open("/dev/tty", "r") as terminal:
    print("Admin email: ", end="", flush=True)
    email = terminal.readline().strip()
password = getpass.getpass("Admin password: ")
session = post("/auth/login", {"email": email, "password": password})
password = None
expiry = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1)
pat = post("/auth/pats", {
    "name": "Local coding agent",
    "scopes": ["read:projects", "read:tasks"],
    "expiresAt": expiry.isoformat(),
}, session["access_token"])
session = None
print("PAT ID:", pat["id"])
print("Save this token now:", pat["plaintext"])
PYTHON
```

Configure your agent client with:

- Transport: Streamable HTTP.
- URL: `http://127.0.0.1:3201/api/v1/mcp`.
- Header: `Authorization: Bearer <the one-time po_pat_ value>`.

The token is bound to the admin's default workspace. Ask MCP for `tools/list`
to discover the installed tool set. Grant only the needed scopes: the example
can read projects/tasks, but cannot create or update them. Use
`GET /api/v1/auth/pats/scopes` with your session to inspect supported scopes.
A new PAT must be minted to change scopes.

To revoke a token, use `DELETE /api/v1/auth/pats/:id` with a signed-in session;
`GET /api/v1/auth/pats` lists your token metadata without revealing secrets.
Omitting `expiresAt` creates a non-expiring PAT in this API, so always set it.

For an optional OIDC instance, the normal browser session can authenticate the
same PAT route. No direct JWT signing or access to the database is required.
