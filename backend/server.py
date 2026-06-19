import contextlib
import importlib.util
import platform

from fastapi import (
    Body,
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from . import auth, config, db, momo_live, recipes

app = FastAPI(title="Rupa & Ruchi's Kitchen")
app.add_middleware(
    SessionMiddleware,
    secret_key=config.SESSION_SECRET or "dev-insecure-secret",
    same_site="lax",
    https_only=False,
)


@app.on_event("startup")
def _startup():
    db.init_db()
    recipes.seed_if_empty()


# --- Authentication (Google Sign-In) ---------------------------------------

@app.post("/api/auth/google")
def auth_google(payload: dict = Body(...), request: Request = None):
    credential = (payload or {}).get("credential")
    if not credential:
        raise HTTPException(status_code=400, detail="Missing Google credential.")
    try:
        user = auth.login(request, credential)
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Sign-in failed: {exc}") from exc
    return {"sub": user["sub"], "email": user["email"], "name": user["name"]}


@app.post("/api/auth/signup")
def auth_signup(payload: dict = Body(...), request: Request = None):
    """Create an email/password account for users without a Google login."""
    payload = payload or {}
    try:
        user = auth.signup(request, payload.get("email"), payload.get("password"), payload.get("name"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"sub": user["sub"], "email": user["email"], "name": user["name"]}


@app.post("/api/auth/login")
def auth_login(payload: dict = Body(...), request: Request = None):
    """Sign in with an email/password account."""
    payload = payload or {}
    try:
        user = auth.password_login(request, payload.get("email"), payload.get("password"))
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return {"sub": user["sub"], "email": user["email"], "name": user["name"]}


@app.post("/api/auth/logout")
def auth_logout(request: Request):
    auth.logout(request)
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    user = auth.current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not signed in.")
    return user


@app.get("/api/momo/history")
def momo_history(user: dict = Depends(auth.require_user)):
    """The signed-in user's previous Momo chats, newest first."""
    return db.conversation_sessions(user["sub"])


@app.post("/api/momo/session")
def momo_new_session(user: dict = Depends(auth.require_user)):
    """Start a fresh Momo chat session for the signed-in user."""
    return db.start_momo_session(user["sub"])


@app.delete("/api/momo/history/{session_id}")
def momo_delete_history(session_id: str, user: dict = Depends(auth.require_user)):
    """Delete one previous Momo chat for the signed-in user."""
    if not db.delete_momo_session(user["sub"], session_id):
        raise HTTPException(status_code=404, detail="Chat not found.")
    return {"deleted": session_id}


# --- Editor access: the single owner uses a secret URL/token ---------------

def require_editor(x_editor_token: str = Header(default="")):
    """Guard write endpoints behind the secret editor token."""
    if not config.EDITOR_TOKEN or x_editor_token != config.EDITOR_TOKEN:
        raise HTTPException(status_code=403, detail="Valid editor token required.")


@app.get("/editor/{token}")
def editor_page(token: str):
    """Serve the editor only at the secret URL; any other token is a 404."""
    if not config.EDITOR_TOKEN or token != config.EDITOR_TOKEN:
        raise HTTPException(status_code=404, detail="Not found.")
    return FileResponse(config.FRONTEND_DIR / "editor.html")


# --- Site pages (each section is its own URL) ------------------------------

@app.get("/heritage")
def heritage_page():
    return FileResponse(config.FRONTEND_DIR / "heritage.html")


@app.get("/recipes")
def recipes_page():
    return FileResponse(config.FRONTEND_DIR / "recipes.html")


# --- Recipes ---------------------------------------------------------------

@app.get("/api/recipes")
def get_recipes():
    return recipes.list_recipes()


@app.post("/api/recipes", dependencies=[Depends(require_editor)])
def create_recipe(payload: dict = Body(...)):
    if not (payload.get("title") or "").strip():
        raise HTTPException(status_code=400, detail="Recipe title is required.")
    return recipes.create_recipe(payload)


@app.put("/api/recipes/{recipe_id}", dependencies=[Depends(require_editor)])
def update_recipe(recipe_id: str, payload: dict = Body(...)):
    updated = recipes.update_recipe(recipe_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Recipe not found.")
    return updated


@app.delete("/api/recipes/{recipe_id}", dependencies=[Depends(require_editor)])
def remove_recipe(recipe_id: str):
    if not recipes.delete_recipe(recipe_id):
        raise HTTPException(status_code=404, detail="Recipe not found.")
    return {"deleted": recipe_id}


@app.put("/api/recipes", dependencies=[Depends(require_editor)])
def replace_recipes(payload: list = Body(...)):
    """Replace the whole recipe book (editor import)."""
    if not isinstance(payload, list) or not payload:
        raise HTTPException(status_code=400, detail="Expected a non-empty recipe list.")
    return recipes.replace_all(payload)


# --- Diagnostics -----------------------------------------------------------

# --- Momo real-time voice (Gemini Live over WebSocket) ---------------------

@app.websocket("/ws/momo")
async def momo_ws(websocket: WebSocket):
    user = auth.websocket_user(websocket)
    if not user:
        await websocket.close(code=4401)  # unauthorized
        return
    await websocket.accept()
    db.ensure_momo_session(user["sub"])
    memory = momo_live.format_memory(db.recent_messages(user["sub"]))

    def save_message(role, text):
        db.save_message(user["sub"], role, text)

    try:
        await momo_live.run_session(websocket, user, memory=memory, save_message=save_message)
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # surface the real reason to the client, then close
        with contextlib.suppress(Exception):
            await websocket.send_json({"type": "error", "detail": str(exc)})
        with contextlib.suppress(Exception):
            await websocket.close()


@app.get("/api/config")
def public_config():
    """Public, browser-safe config (the OAuth client ID is not a secret)."""
    return {"google_client_id": config.GOOGLE_OAUTH_CLIENT_ID}


@app.get("/api/diagnostics")
def diagnostics():
    return {
        "python": platform.python_version(),
        "machine": platform.machine(),
        "genai_package_found": importlib.util.find_spec("google.genai") is not None,
        "backend": "vertex" if config.USE_VERTEX else "gemini_api",
        "vertex_project": config.GOOGLE_CLOUD_PROJECT,
        "vertex_location": config.GOOGLE_CLOUD_LOCATION,
        "live_model": config.MOMO_LIVE_MODEL,
        "editor_token_set": bool(config.EDITOR_TOKEN),
        "session_secret_set": bool(config.SESSION_SECRET),
        "oauth_client_id_set": bool(config.GOOGLE_OAUTH_CLIENT_ID),
        "recipe_count": len(recipes.list_recipes()),
    }


# Static site last, so /api/* and /editor/* win over the catch-all mount.
app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIR), html=True), name="site")
