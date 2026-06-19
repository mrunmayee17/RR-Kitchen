# Rupa & Ruchi's Kitchen

A Konkani Amchi recipe site with **Momo**, a real-time voice agent powered by the
Gemini Live API.

## Layout

- `frontend/` — static site
  - `index.html`, `script.js` — public recipe browsing
  - `momo.js`, `momo-worklet.js` — Momo voice client (Google or email/password sign-in + Gemini Live audio)
  - `editor.html`, `editor.js` — private recipe editor (served only at a secret URL)
  - `styles.css`, `assets/`
- `backend/`
  - `server.py` — FastAPI app (REST, auth, the `/ws/momo` WebSocket, static mount)
  - `config.py` — env/settings + the Vertex `google-genai` client
  - `db.py` — SQLite (recipes, users, conversation memory)
  - `recipes.py` — recipe CRUD + search
  - `auth.py` — Google Sign-In + email/password accounts + sessions
  - `momo_live.py` — the Gemini Live voice proxy
- `data/rupa.db` — SQLite database (created on first run, gitignored)

## What Momo is

Momo is a **general voice assistant** that talks in real time using **Gemini Live
native audio**. It is not limited to recipes, but Rupa's full Konkani recipe book is
injected into its context, so it answers cooking questions accurately. Each signed-in
user gets **persistent conversation memory** across sessions.

> Note: the browser never sees Vertex credentials. Audio is relayed through a backend
> WebSocket proxy (`/ws/momo`) that holds the Application Default Credentials.
>
> Recipes are provided to Momo via **context injection** rather than a live tool call:
> Gemini Live currently returns no audio after a function response (a known upstream
> bug), and the recipe book is small enough to keep in context.

## Run it

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then fill in the values below
gcloud auth application-default login
uvicorn backend.server:app --host 0.0.0.0 --port 8001
```

Open <http://localhost:8001/>.

### Required configuration (`.env`)

| Variable | What it is |
|----------|-----------|
| `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` | Vertex AI project/region (auth via ADC) |
| `MOMO_LIVE_MODEL` | Gemini Live model (default `gemini-live-2.5-flash-native-audio`) |
| `EDITOR_TOKEN` | Secret token for the editor URL |
| `SESSION_SECRET` | Signs login session cookies |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Sign-In web client ID (optional — email/password sign-in works without it) |

Generate the two secrets with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Sign-in

Momo requires login. Users have two options:

- **Email + password** — anyone can create an account from the Momo panel
  ("Create an account"). Passwords are stored as salted PBKDF2-SHA256 hashes in the
  `users` table. This works with no extra configuration.
- **Google Sign-In** — optional, for one-tap login with a Gmail account. Create an
  **OAuth 2.0 Web client ID** in the GCP console (APIs & Services → Credentials), add
  `http://localhost:8001` as an authorized JavaScript origin, and put the client ID in
  `GOOGLE_OAUTH_CLIENT_ID`. If `GOOGLE_OAUTH_CLIENT_ID` is unset, the Google button is
  hidden and only email/password sign-in is offered.

## Editing recipes

Recipes are shared and server-stored. Only the holder of the secret URL can edit them:

```text
http://localhost:8001/editor/<EDITOR_TOKEN>
```

Any other token returns 404. Add, edit, delete, import, and export recipes there; the
public site and Momo pick up changes immediately.

## Diagnostics

```text
http://localhost:8001/api/diagnostics
```

Shows the active backend, Live model, project/region, and which secrets are configured.
