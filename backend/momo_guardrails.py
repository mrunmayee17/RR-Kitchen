"""Guardrails for Momo.

Guardrails Hub validators handle PII, NSFW text, and profanity when installed.
The local cooking-topic check acts as the app's topic restriction because the
Hub topic validator URI is not available in this environment.
"""

from functools import lru_cache
import re

try:
    from guardrails import Guard, OnFailAction
    from guardrails.hub import DetectPII, NSFWText, ProfanityFree
except Exception:  # Guardrails is optional at runtime; keep the app bootable.
    Guard = None
    OnFailAction = None
    DetectPII = None
    NSFWText = None
    ProfanityFree = None

COOKING_TERMS = {
    "bake",
    "boil",
    "breakfast",
    "cook",
    "cooking",
    "cuisine",
    "dish",
    "dinner",
    "food",
    "fry",
    "ghee",
    "glass",
    "grill",
    "ingredient",
    "ingredients",
    "kitchen",
    "lunch",
    "marinate",
    "meal",
    "melon",
    "method",
    "next step",
    "pan",
    "pour",
    "recipe",
    "roast",
    "salt",
    "serve",
    "simmer",
    "spice",
    "step",
    "stir",
    "taste",
}

CONTEXTUAL_RECIPE_TERMS = {
    "again",
    "continue",
    "how much",
    "next",
    "repeat",
    "start over",
    "what's next",
    "what is next",
}

BLOCKED_TOPICS = {
    "adult",
    "credit card",
    "election",
    "hack",
    "jailbreak",
    "password",
    "politics",
    "ssn",
    "weapon",
}

REFUSAL = "I can help with cooking, recipes, ingredients, and kitchen steps only."
SAFETY_REFUSAL = "I can help with safe cooking and recipe questions only."

PII_PATTERNS = [
    re.compile(r"\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b"),
    re.compile(r"\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b"),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    re.compile(r"\b(?:\d[ -]*?){13,19}\b"),
]


@lru_cache(maxsize=1)
def _guard():
    """Build the installed Guardrails validators once per backend process."""
    if not all([Guard, OnFailAction, DetectPII, NSFWText, ProfanityFree]):
        return None
    guard = Guard()
    guard.use(
        DetectPII(
            pii_entities=[
                "EMAIL_ADDRESS",
                "PHONE_NUMBER",
                "CREDIT_CARD",
                "US_SSN",
            ],
            on_fail=OnFailAction.EXCEPTION,
        )
    )
    guard.use(
        NSFWText(
            threshold=0.8,
            validation_method="sentence",
            device="cpu",
            on_fail=OnFailAction.EXCEPTION,
        )
    )
    guard.use(ProfanityFree(on_fail=OnFailAction.EXCEPTION))
    return guard


def is_cooking_related(text):
    """Return True when a prompt is in Momo's cooking assistant scope."""
    normalized = f" {(text or '').strip().lower()} "
    if not normalized.strip():
        return False
    if any(topic in normalized for topic in BLOCKED_TOPICS):
        return False
    return any(term in normalized for term in COOKING_TERMS | CONTEXTUAL_RECIPE_TERMS)


def validate_text(text):
    """Validate a text prompt/response and return (ok, refusal_message)."""
    if not is_cooking_related(text):
        return False, REFUSAL
    if any(pattern.search(text or "") for pattern in PII_PATTERNS):
        return False, SAFETY_REFUSAL

    guard = _guard()
    if guard is None:
        return True, ""

    try:
        guard.validate(text)
    except Exception:
        return False, SAFETY_REFUSAL
    return True, ""
