"""Central configuration for Rupa & Ruchi's Kitchen, loaded from the project-root .env."""

import json
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

# Load .env from the project root if python-dotenv is available. Real shell
# environment variables still take precedence.
try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env")
except ImportError:
    pass


def _flag(name):
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes"}


# --- Gemini / Vertex ---
USE_VERTEX = _flag("GOOGLE_GENAI_USE_VERTEXAI")
GOOGLE_CLOUD_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT")
GOOGLE_CLOUD_LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
MOMO_LIVE_MODEL = os.getenv("MOMO_LIVE_MODEL", "gemini-live-2.5-flash-native-audio")
GOOGLE_SERVICE_ACCOUNT_JSON = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "")

# --- App secrets ---
EDITOR_TOKEN = os.getenv("EDITOR_TOKEN", "")
SESSION_SECRET = os.getenv("SESSION_SECRET", "")
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")


def make_genai_client():
    """A google-genai client configured for Vertex AI or the Developer API."""
    from google import genai

    if USE_VERTEX:
        credentials = None
        if GOOGLE_SERVICE_ACCOUNT_JSON:
            from google.oauth2 import service_account

            credentials = service_account.Credentials.from_service_account_info(
                json.loads(GOOGLE_SERVICE_ACCOUNT_JSON),
                scopes=["https://www.googleapis.com/auth/cloud-platform"],
            )
        return genai.Client(
            vertexai=True,
            credentials=credentials,
            project=GOOGLE_CLOUD_PROJECT,
            location=GOOGLE_CLOUD_LOCATION,
        )
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"])
