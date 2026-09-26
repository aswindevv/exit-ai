"""One-time admin script -- Phase 8 KT calendar OAuth setup.

Authorizes the sender account from .env for calendar booking, once. Every KT
event for every ExitAI user then gets
created on that one account's calendar (KT_CALENDAR_ID) via the resulting
refresh token -- there is no per-user Google login in this demo; production
would use a service account or per-user calendars instead.

Uses the existing "Exit Auth" Google OAuth Web client (GOOGLE_CLIENT_ID/
GOOGLE_CLIENT_SECRET, already in .env). Before running, add GOOGLE_REDIRECT_URI
(default below) to that client's Authorized redirect URIs in Google Cloud
Console -- Web clients accept a registered http://localhost redirect for
exactly this kind of local, interactive flow.

access_type=offline + prompt=consent is what makes Google hand back a
refresh token (otherwise you only get a short-lived access token, and a
repeat consent for the same client+account can omit it entirely).

Scope: calendar.events only (create/update/delete events, not read/manage
the whole calendar) -- least privilege for "book a KT slot".

Run once (from repo root, with agents/.venv active):
    python -m agents.oauth_setup

It opens your browser -- sign in as the sender account from .env and consent
-- then prints the refresh token here. Copy it into .env as GOOGLE_REFRESH_TOKEN;
this script never writes .env itself.
"""
from __future__ import annotations

import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests

from .core.config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI

_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_SCOPE = "https://www.googleapis.com/auth/calendar.events"

_received: dict[str, str] = {}


class _CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 -- stdlib-mandated name
        code = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get("code", [None])[0]
        if code:
            _received["code"] = code
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h3>Authorized. You can close this tab.</h3>")

    def log_message(self, *args) -> None:  # silence default access logging
        pass


def _wait_for_code() -> str:
    parsed = urllib.parse.urlparse(GOOGLE_REDIRECT_URI)
    server = HTTPServer((parsed.hostname, parsed.port or 80), _CallbackHandler)
    while "code" not in _received:
        server.handle_request()  # loops past stray requests (e.g. favicon.ico)
    return _received["code"]


def run() -> str:
    if not (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET):
        raise RuntimeError("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env before running this.")

    auth_url = f"{_AUTH_URL}?{urllib.parse.urlencode({
        'client_id': GOOGLE_CLIENT_ID,
        'redirect_uri': GOOGLE_REDIRECT_URI,
        'response_type': 'code',
        'scope': _SCOPE,
        'access_type': 'offline',
        'prompt': 'consent',
    })}"
    print(f"Opening browser for consent -- sign in as the shared demo account:\n{auth_url}\n")
    webbrowser.open(auth_url)

    code = _wait_for_code()
    resp = requests.post(_TOKEN_URL, data={
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": GOOGLE_REDIRECT_URI,
    })
    resp.raise_for_status()
    refresh_token = resp.json().get("refresh_token")
    if not refresh_token:
        raise RuntimeError(
            "No refresh_token in the response -- Google only issues one on first "
            "consent for this client+account. Revoke prior access at "
            "https://myaccount.google.com/permissions and re-run."
        )
    print(f"\nGOOGLE_REFRESH_TOKEN={refresh_token}\n\nCopy that into .env, then re-run the Phase 8 check.")
    return refresh_token


if __name__ == "__main__":
    run()
