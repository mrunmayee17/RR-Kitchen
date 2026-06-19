"""SQLite storage for Rupa & Ruchi's Kitchen: recipes, users, and Momo chat memory."""

import sqlite3
import os
from contextlib import contextmanager
from pathlib import Path
from uuid import uuid4

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
if os.getenv("VERCEL"):
    DATA_DIR = Path("/tmp/rupa-kitchen")
DB_PATH = DATA_DIR / "rupa.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS recipes (
    id         TEXT PRIMARY KEY,
    data       TEXT NOT NULL,            -- full recipe JSON blob (includes id)
    position   INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    sub           TEXT PRIMARY KEY,      -- Google subject id, or "local:<token>" for email accounts
    email         TEXT,
    name          TEXT,
    password_hash TEXT,                  -- only set for email/password accounts
    current_momo_session_id TEXT,
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS momo_sessions (
    id         TEXT PRIMARY KEY,
    user_sub   TEXT NOT NULL,
    title      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_sub   TEXT NOT NULL,
    session_id TEXT,
    role       TEXT NOT NULL,            -- 'user' | 'momo'
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversations_user
    ON conversations (user_sub, id);

CREATE INDEX IF NOT EXISTS idx_momo_sessions_user
    ON momo_sessions (user_sub, updated_at);
"""


@contextmanager
def get_conn():
    """Yield a SQLite connection with row access by column name."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    """Create tables if they do not exist (and migrate older databases)."""
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        user_columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
        if "password_hash" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
        if "current_momo_session_id" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN current_momo_session_id TEXT")
        conversation_columns = {
            row["name"] for row in conn.execute("PRAGMA table_info(conversations)")
        }
        if "session_id" not in conversation_columns:
            conn.execute("ALTER TABLE conversations ADD COLUMN session_id TEXT")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations (session_id, id)"
        )


def upsert_user(sub, email, name):
    """Record (or refresh) a signed-in Google user."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO users (sub, email, name, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(sub) DO UPDATE SET email = excluded.email, name = excluded.name
            """,
            (sub, email, name, now),
        )


def get_user_by_email(email):
    """Return the user row for an email address (case-insensitive), or None."""
    with get_conn() as conn:
        return conn.execute(
            "SELECT sub, email, name, password_hash FROM users WHERE email = ? COLLATE NOCASE",
            (email,),
        ).fetchone()


def create_local_user(sub, email, name, password_hash):
    """Create an email/password account."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO users (sub, email, name, password_hash, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (sub, email, name, password_hash, now),
        )


def save_message(user_sub, role, content):
    """Append one Momo conversation utterance for a user."""
    from datetime import datetime, timezone

    content = (content or "").strip()
    if not content:
        return
    session_id = ensure_momo_session(user_sub)
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO conversations (user_sub, session_id, role, content, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_sub, session_id, role, content, now),
        )
        if role == "user":
            title = content[:80]
            conn.execute(
                """
                UPDATE momo_sessions
                SET title = COALESCE(title, ?), updated_at = ?
                WHERE id = ? AND user_sub = ?
                """,
                (title, now, session_id, user_sub),
            )
        else:
            conn.execute(
                "UPDATE momo_sessions SET updated_at = ? WHERE id = ? AND user_sub = ?",
                (now, session_id, user_sub),
            )


def start_momo_session(user_sub):
    """Create and select a fresh Momo chat session for the signed-in user."""
    from datetime import datetime, timezone

    session_id = uuid4().hex
    now = datetime.now(timezone.utc).isoformat()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO momo_sessions (id, user_sub, title, created_at, updated_at)
            VALUES (?, ?, NULL, ?, ?)
            """,
            (session_id, user_sub, now, now),
        )
        conn.execute(
            "UPDATE users SET current_momo_session_id = ? WHERE sub = ?",
            (session_id, user_sub),
        )
    return {"id": session_id, "date": now[:10], "title": "New chat", "messages": []}


def ensure_momo_session(user_sub):
    """Return the active Momo session id, creating one if needed."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT current_momo_session_id FROM users WHERE sub = ?",
            (user_sub,),
        ).fetchone()
        session_id = row["current_momo_session_id"] if row else None
        if session_id:
            existing = conn.execute(
                "SELECT id FROM momo_sessions WHERE id = ? AND user_sub = ?",
                (session_id, user_sub),
            ).fetchone()
            if existing:
                return session_id
        latest = conn.execute(
            """
            SELECT id FROM momo_sessions
            WHERE user_sub = ?
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (user_sub,),
        ).fetchone()
        if latest:
            return latest["id"]
    return start_momo_session(user_sub)["id"]


def delete_momo_session(user_sub, session_id):
    """Delete one previous Momo chat for a user."""
    session_id = (session_id or "").strip()
    if not session_id:
        return False

    with get_conn() as conn:
        if session_id.startswith("legacy-"):
            day = session_id.removeprefix("legacy-")
            result = conn.execute(
                """
                DELETE FROM conversations
                WHERE user_sub = ?
                  AND session_id IS NULL
                  AND substr(created_at, 1, 10) = ?
                """,
                (user_sub, day),
            )
            return result.rowcount > 0

        session = conn.execute(
            "SELECT id FROM momo_sessions WHERE id = ? AND user_sub = ?",
            (session_id, user_sub),
        ).fetchone()
        if not session:
            return False

        conn.execute(
            "DELETE FROM conversations WHERE user_sub = ? AND session_id = ?",
            (user_sub, session_id),
        )
        conn.execute(
            "DELETE FROM momo_sessions WHERE id = ? AND user_sub = ?",
            (session_id, user_sub),
        )
        conn.execute(
            """
            UPDATE users
            SET current_momo_session_id = NULL
            WHERE sub = ? AND current_momo_session_id = ?
            """,
            (user_sub, session_id),
        )
        return True


def recent_messages(user_sub, limit=20):
    """Return the user's most recent utterances, oldest-first."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT role, content FROM conversations WHERE user_sub = ? ORDER BY id DESC LIMIT ?",
            (user_sub, limit),
        ).fetchall()
    return [(row["role"], row["content"]) for row in reversed(rows)]


def conversation_sessions(user_sub, limit=400):
    """Return a user's previous Momo chats, newest first.

    New messages are grouped by explicit session id. Older databases did not
    have sessions, so null-session messages are still exposed as day buckets.
    """
    with get_conn() as conn:
        session_rows = conn.execute(
            """
            SELECT id, title, created_at, updated_at FROM momo_sessions
            WHERE user_sub = ?
              AND EXISTS (
                  SELECT 1 FROM conversations
                  WHERE conversations.session_id = momo_sessions.id
              )
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (user_sub, limit),
        ).fetchall()
        sessions = []
        for session in session_rows:
            messages = conn.execute(
                """
                SELECT role, content, created_at FROM conversations
                WHERE user_sub = ? AND session_id = ?
                ORDER BY id ASC
                """,
                (user_sub, session["id"]),
            ).fetchall()
            message_list = [
                {"role": row["role"], "content": row["content"], "created_at": row["created_at"]}
                for row in messages
            ]
            title = session["title"] or next(
                (m["content"] for m in message_list if m["role"] == "user"),
                message_list[0]["content"],
            )
            sessions.append(
                {
                    "id": session["id"],
                    "date": (session["created_at"] or "")[:10],
                    "title": title,
                    "messages": message_list,
                    "updated_at": session["updated_at"],
                }
            )

        legacy_rows = conn.execute(
            """
            SELECT role, content, created_at FROM conversations
            WHERE user_sub = ? AND session_id IS NULL
            ORDER BY id DESC LIMIT ?
            """,
            (user_sub, limit),
        ).fetchall()

    by_day, order = {}, []
    for row in legacy_rows:  # newest-first
        day = (row["created_at"] or "")[:10]
        if day not in by_day:
            by_day[day] = []
            order.append(day)
        by_day[day].append(
            {"role": row["role"], "content": row["content"], "created_at": row["created_at"]}
        )

    for day in order:
        messages = list(reversed(by_day[day]))  # oldest-first within the day
        title = next((m["content"] for m in messages if m["role"] == "user"), messages[0]["content"])
        sessions.append(
            {
                "id": f"legacy-{day}",
                "date": day,
                "title": title,
                "messages": messages,
                "updated_at": messages[-1]["created_at"],
            }
        )
    sessions.sort(key=lambda item: item.get("updated_at") or item.get("date") or "", reverse=True)
    return sessions
