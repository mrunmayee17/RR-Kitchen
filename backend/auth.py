"""Sign-in for Momo: Google ID tokens or email/password accounts, tracked in the session."""

import hashlib
import hmac
import secrets

from fastapi import HTTPException, Request, WebSocket

from . import config, db

# --- Email / password accounts (for users without a Google login) ----------

_PBKDF2_ROUNDS = 240_000


def hash_password(password):
    """Return a salted PBKDF2-SHA256 hash, encoded as algo$rounds$salt$hash."""
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ROUNDS)
    return f"pbkdf2_sha256${_PBKDF2_ROUNDS}${salt.hex()}${derived.hex()}"


def verify_password(password, stored):
    """Check a password against a stored hash, comparing in constant time."""
    try:
        _algo, rounds, salt_hex, hash_hex = stored.split("$")
        derived = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(rounds)
        )
    except (AttributeError, ValueError):
        return False
    return hmac.compare_digest(derived.hex(), hash_hex)


def _store_session(request: Request, user):
    request.session["user"] = {"sub": user["sub"], "email": user["email"], "name": user["name"]}
    return user


def signup(request: Request, email, password, name):
    """Create an email/password account, sign the user in, and return them."""
    email = (email or "").strip().lower()
    password = password or ""
    if "@" not in email or "." not in email.split("@")[-1]:
        raise ValueError("Please enter a valid email address.")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")
    if db.get_user_by_email(email):
        raise ValueError("An account with this email already exists. Try signing in.")

    name = (name or "").strip() or email.split("@")[0]
    sub = "local:" + secrets.token_hex(12)
    db.create_local_user(sub, email, name, hash_password(password))
    return _store_session(request, {"sub": sub, "email": email, "name": name})


def password_login(request: Request, email, password):
    """Verify an email/password account and store the user in the session."""
    email = (email or "").strip().lower()
    row = db.get_user_by_email(email)
    if not row or not row["password_hash"] or not verify_password(password or "", row["password_hash"]):
        raise ValueError("Incorrect email or password.")
    return _store_session(request, {"sub": row["sub"], "email": row["email"], "name": row["name"]})


# --- Google Sign-In --------------------------------------------------------


def verify_google_token(credential):
    """Verify a Google Identity Services ID token and return user claims."""
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    if not config.GOOGLE_OAUTH_CLIENT_ID:
        raise RuntimeError("GOOGLE_OAUTH_CLIENT_ID is not configured.")

    claims = google_id_token.verify_oauth2_token(
        credential,
        google_requests.Request(),
        config.GOOGLE_OAUTH_CLIENT_ID,
    )
    return {
        "sub": claims["sub"],
        "email": claims.get("email", ""),
        "name": claims.get("name") or claims.get("email", "") or "Friend",
        "picture": claims.get("picture", ""),
    }


def login(request: Request, credential):
    """Verify the credential, persist the user, and store them in the session."""
    user = verify_google_token(credential)
    db.upsert_user(user["sub"], user["email"], user["name"])
    request.session["user"] = {"sub": user["sub"], "email": user["email"], "name": user["name"]}
    return user


def logout(request: Request):
    request.session.pop("user", None)


def current_user(request: Request):
    return request.session.get("user")


def require_user(request: Request):
    """FastAPI dependency: 401 unless a user is signed in."""
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Sign in required.")
    return user


def websocket_user(websocket: WebSocket):
    """Return the signed-in user from the WebSocket session, or None."""
    session = websocket.scope.get("session") or {}
    return session.get("user")
