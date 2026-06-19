"""Central configuration for Rupa & Ruchi's Kitchen, loaded from the project-root .env."""

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

# --- App secrets ---
EDITOR_TOKEN = os.getenv("EDITOR_TOKEN", "")
SESSION_SECRET = os.getenv("SESSION_SECRET", "")
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")


def make_genai_client():
    """A google-genai client configured for Vertex AI (ADC) or the Developer API."""
    from google import genai

    if USE_VERTEX:
        return genai.Client(
            vertexai=True,
            project=GOOGLE_CLOUD_PROJECT,
            location=GOOGLE_CLOUD_LOCATION,
        )
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"])
