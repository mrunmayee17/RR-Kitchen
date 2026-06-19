"""Recipe storage and lookup, backed by SQLite (see db.py)."""

import json
import uuid
from datetime import datetime, timezone

from . import db

# Seeded once into an empty database. Stable ids keep seeding idempotent.
SEED_RECIPES = [
    {
        "id": "kundapur-ghee-roast",
        "title": "Kundapur Ghee Roast",
        "category": "Konkani coastal special",
        "prep": "25 min",
        "cook": "35 min",
        "serves": "4",
        "published": True,
        "image": "assets/kundapur-ghee-roast.png",
        "description": (
            "A deep red Kundapur-style ghee roast with roasted Byadgi chillies, "
            "coriander, pepper, tamarind, and slow-fried ghee masala. It is rich, "
            "tangy, and best with neer dosa or steamed rice."
        ),
        "ingredients": [
            "750 g chicken, paneer, prawns, or mushrooms",
            "3 tbsp thick curd",
            "1 tsp turmeric powder",
            "1 tbsp lemon juice",
            "Salt to taste",
            "10 Byadgi red chillies",
            "4 Guntur red chillies",
            "2 tbsp coriander seeds",
            "1 tsp cumin seeds",
            "1 tsp black peppercorns",
            "1/2 tsp fenugreek seeds",
            "8 garlic cloves",
            "1 small lime-sized ball of tamarind, soaked",
            "5 tbsp ghee",
            "2 sprigs curry leaves",
            "1 tsp jaggery, optional",
        ],
        "method": [
            "Marinate the chicken or chosen protein with curd, turmeric, lemon juice, and salt for at least 20 minutes.",
            "Dry roast the red chillies, coriander, cumin, pepper, and fenugreek on low heat until fragrant. Cool slightly.",
            "Grind the roasted spices with garlic and soaked tamarind into a smooth, thick masala paste.",
            "Heat 2 tbsp ghee in a heavy pan. Add the marinated protein and cook until nearly done, then remove it to a plate.",
            "Add the remaining ghee to the same pan with curry leaves. Fry the ground masala on low heat until the ghee separates and the color deepens.",
            "Return the cooked protein to the pan. Toss until every piece is coated and the masala clings well.",
            "Adjust salt, add jaggery if you like a rounded finish, and roast for another 3 to 5 minutes before serving hot.",
        ],
    },
    {
        "id": "melon-soda-float",
        "title": "Melon Soda Float",
        "category": "Sweet drinks",
        "prep": "5 min",
        "cook": "0 min",
        "serves": "1",
        "published": True,
        "image": "assets/melon-soda-float.png",
        "sourceName": "Next in Lime",
        "sourceUrl": "https://www.nextinlime.com/melon-soda-float/",
        "description": (
            "A bright Japanese-style melon cream soda with chilled fizz, sweet melon "
            "syrup, vanilla ice cream, and a cherry on top. Refreshing, playful, and "
            "ready in minutes."
        ),
        "ingredients": [
            "2 tbsp melon syrup",
            "1 cup chilled club soda",
            "1 scoop vanilla ice cream",
            "1 maraschino cherry, optional",
            "Ice cubes",
        ],
        "method": [
            "Add ice cubes to a tall serving glass.",
            "Pour the melon syrup over the ice.",
            "Slowly add chilled club soda, leaving room at the top for ice cream.",
            "Gently stir once or twice so the syrup blends without losing too much fizz.",
            "Top with a scoop of vanilla ice cream.",
            "Finish with a maraschino cherry if using, then serve immediately with a straw and spoon.",
        ],
    },
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _normalize(recipe, recipe_id):
    """Coerce an incoming recipe dict into the stored shape."""
    data = dict(recipe)
    data["id"] = recipe_id
    data["ingredients"] = list(data.get("ingredients") or [])
    data["method"] = list(data.get("method") or [])
    data["published"] = bool(data.get("published", False))
    return data


def seed_if_empty():
    """Insert the starter recipes only when the table is empty."""
    with db.get_conn() as conn:
        count = conn.execute("SELECT COUNT(*) AS n FROM recipes").fetchone()["n"]
        if count:
            return
        now = _now()
        for position, recipe in enumerate(SEED_RECIPES):
            conn.execute(
                "INSERT INTO recipes (id, data, position, updated_at) VALUES (?, ?, ?, ?)",
                (recipe["id"], json.dumps(recipe), position, now),
            )


def list_recipes():
    """All recipes, ordered by position (then update time)."""
    with db.get_conn() as conn:
        rows = conn.execute(
            "SELECT data FROM recipes ORDER BY position ASC, updated_at ASC"
        ).fetchall()
    return [json.loads(row["data"]) for row in rows]


def get_recipe(recipe_id):
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT data FROM recipes WHERE id = ?", (recipe_id,)
        ).fetchone()
    return json.loads(row["data"]) if row else None


def create_recipe(recipe):
    """Insert a new recipe at the top of the list; returns the stored dict."""
    recipe_id = recipe.get("id") or uuid.uuid4().hex
    data = _normalize(recipe, recipe_id)
    with db.get_conn() as conn:
        min_pos = conn.execute(
            "SELECT COALESCE(MIN(position), 0) AS p FROM recipes"
        ).fetchone()["p"]
        conn.execute(
            "INSERT INTO recipes (id, data, position, updated_at) VALUES (?, ?, ?, ?)",
            (recipe_id, json.dumps(data), min_pos - 1, _now()),
        )
    return data


def update_recipe(recipe_id, recipe):
    """Update an existing recipe; returns the stored dict or None if missing."""
    data = _normalize(recipe, recipe_id)
    with db.get_conn() as conn:
        exists = conn.execute(
            "SELECT 1 FROM recipes WHERE id = ?", (recipe_id,)
        ).fetchone()
        if not exists:
            return None
        conn.execute(
            "UPDATE recipes SET data = ?, updated_at = ? WHERE id = ?",
            (json.dumps(data), _now(), recipe_id),
        )
    return data


def delete_recipe(recipe_id):
    with db.get_conn() as conn:
        cur = conn.execute("DELETE FROM recipes WHERE id = ?", (recipe_id,))
        return cur.rowcount > 0


def replace_all(recipes):
    """Replace the entire recipe book (used by editor import)."""
    now = _now()
    with db.get_conn() as conn:
        conn.execute("DELETE FROM recipes")
        for position, recipe in enumerate(recipes):
            recipe_id = recipe.get("id") or uuid.uuid4().hex
            data = _normalize(recipe, recipe_id)
            conn.execute(
                "INSERT INTO recipes (id, data, position, updated_at) VALUES (?, ?, ?, ?)",
                (recipe_id, json.dumps(data), position, now),
            )
    return list_recipes()


def search_recipes(query, limit=5):
    """Case-insensitive search over title/category/description/ingredients/method.

    Returns compact recipe dicts suitable for Momo's tool response.
    """
    needle = (query or "").strip().lower()
    results = []
    for recipe in list_recipes():
        haystack = " ".join(
            [
                str(recipe.get("title", "")),
                str(recipe.get("category", "")),
                str(recipe.get("description", "")),
                " ".join(recipe.get("ingredients", [])),
                " ".join(recipe.get("method", [])),
            ]
        ).lower()
        if not needle or needle in haystack:
            results.append(
                {
                    "title": recipe.get("title"),
                    "category": recipe.get("category"),
                    "serves": recipe.get("serves"),
                    "prep": recipe.get("prep"),
                    "cook": recipe.get("cook"),
                    "description": recipe.get("description"),
                    "ingredients": recipe.get("ingredients", []),
                    "method": recipe.get("method", []),
                }
            )
        if len(results) >= limit:
            break
    return results
