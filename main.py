# ============================================================
#  DISHCOVERY AI — main.py
#  FastAPI backend: YOLO ingredient detection + recipe matching
#
#  Install:
#    pip install fastapi uvicorn ultralytics python-multipart pandas
#
#  Run:
#    python -m uvicorn main:app --reload --port 8000
# ============================================================

import os
import ast
import shutil
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from ultralytics import YOLO

# ── Config ────────────────────────────────────────────────────
UPLOAD_DIR   = Path("uploads")
DATASET_PATH = Path("cleaned_dataset.csv")
MODEL_PATH   = "best.pt"          # your trained YOLOv8 weights
TOP_N        = 5                   # recipes returned per query
CONF_THRESH  = 0.01              # minimum YOLO confidence

UPLOAD_DIR.mkdir(exist_ok=True)

# ── App ───────────────────────────────────────────────────────
app = FastAPI(
    title="Dishcovery AI",
    description="Ingredient detection + recipe suggestion API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Load YOLO model ───────────────────────────────────────────
try:
    model = YOLO(MODEL_PATH)
    print(f"[OK] YOLO model loaded from '{MODEL_PATH}'")
except Exception as e:
    print(f"[WARN] Could not load '{MODEL_PATH}': {e}")
    print("[INFO] Falling back to YOLOv8n (COCO) — food classes only")
    model = YOLO("yolov8n.pt")

# ── Load recipe dataset ───────────────────────────────────────
try:
    df = pd.read_csv(DATASET_PATH)
    df["ingredients"] = df["ingredients"].apply(
        lambda x: ast.literal_eval(x) if isinstance(x, str) and x.startswith("[") else []
    )
    # Drop rows with no ingredients
    df = df[df["ingredients"].map(len) > 0].reset_index(drop=True)
    print(f"[OK] Dataset loaded — {len(df)} recipes")
except FileNotFoundError:
    print(f"[WARN] '{DATASET_PATH}' not found — recipe endpoint will return empty list")
    df = pd.DataFrame(columns=["recipe_name", "ingredients", "cooking_method",
                                "cuisine", "image", "tags", "prep_time", "serves"])

# ── Recipe matching ───────────────────────────────────────────
def find_recipes(user_ingredients: list[str], top_n: int = TOP_N) -> list[dict]:
    """
    Fuzzy-match user ingredients against every recipe in the dataset.
    Returns top_n recipes sorted by number of matched ingredients.
    """
    if df.empty or not user_ingredients:
        return []

    user_set = {i.strip().lower() for i in user_ingredients}
    results  = []

    for _, row in df.iterrows():
        recipe_ings = [str(ing).lower() for ing in row["ingredients"]]

        matched = set()
        for recipe_ing in recipe_ings:
            for user_item in user_set:
                if user_item in recipe_ing:
                    matched.add(recipe_ing)
                    break

        score = len(matched)
        if score == 0:
            continue

        total      = len(recipe_ings)
        match_pct  = round((score / total) * 100) if total else 0

        # Parse cuisine — stored as a Python list string like "['American']"
        raw_cuisine = row.get("cuisine", "")
        try:
            cuisine_list = ast.literal_eval(raw_cuisine) if isinstance(raw_cuisine, str) and raw_cuisine.startswith("[") else [raw_cuisine]
            cuisine = cuisine_list[0] if cuisine_list else "International"
        except Exception:
            cuisine = str(raw_cuisine) if raw_cuisine else "International"

        results.append({
            "recipe_name":          row.get("recipe_name", "Unknown"),
            "matched_count":        score,
            "match_percent":        match_pct,
            "matched_ingredients":  list(matched),
            "all_ingredients":      [str(i) for i in row["ingredients"]],
            "instructions":         row.get("cooking_method", ""),
            "cuisine":              cuisine,
            "image":                row.get("image", ""),
            "tags":                 str(row.get("tags", "")),
            "prep_time":            str(row.get("prep_time", "")),
            "serves":               str(row.get("serves", "")),
        })

    results.sort(key=lambda x: x["matched_count"], reverse=True)
    return results[:top_n]

# ── Parse YOLO instructions field ────────────────────────────
def parse_instructions(raw) -> list[str]:
    """Convert the cooking_method field (Python list string or plain text) to a list of steps."""
    if not raw or raw != raw:   # nan check
        return []
    raw = str(raw).strip()
    if raw.startswith("["):
        try:
            steps = ast.literal_eval(raw)
            return [s.strip() for s in steps if str(s).strip()]
        except Exception:
            pass
    # plain text fallback — split by period
    return [s.strip() for s in raw.split(". ") if s.strip()]

# ── Endpoints ─────────────────────────────────────────────────

@app.get("/")
def root():
    return {"status": "Dishcovery AI is running 🍳"}


@app.get("/health")
def health():
    return {
        "status":       "ok",
        "model":        MODEL_PATH,
        "dataset_rows": len(df),
        "classes":      list(model.names.values()) if hasattr(model, "names") else [],
    }


@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    """
    Step 1 — Upload a food image.
    Returns a list of detected ingredient labels with confidence scores.
    """
    # Validate file type
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")

    # Save upload
    dest = UPLOAD_DIR / file.filename
    with open(dest, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    # Run YOLO
    try:
        results = model(str(dest))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Model inference failed: {e}")

    # Collect detections above threshold
    detections = []
    seen_labels = set()

    for r in results:
        for box in r.boxes:
            conf  = float(box.conf[0])
            if conf < CONF_THRESH:
                continue
            label = model.names[int(box.cls[0])]
            detections.append({"label": label, "confidence": round(conf, 3)})
            seen_labels.add(label)

    return {
        "file":        file.filename,
        "detections":  detections,
        "ingredients": list(seen_labels),   # unique labels — pass these to /recipes
    }


@app.post("/recipes")
async def get_recipes(payload: dict):
    """
    Step 2 — Pass detected ingredients, get matching recipes.

    Request body:
        { "ingredients": ["tomato", "garlic", "onion"] }

    Returns top-N recipes sorted by match count.
    """
    ingredients = payload.get("ingredients", [])
    if not ingredients:
        raise HTTPException(status_code=400, detail="'ingredients' list is required.")

    top_n   = int(payload.get("top_n", TOP_N))
    matches = find_recipes(ingredients, top_n)

    # Enrich instructions into a clean list
    for m in matches:
        m["steps"] = parse_instructions(m.pop("instructions", ""))

    return {
        "query":       ingredients,
        "total_found": len(matches),
        "recipes":     matches,
    }


@app.get("/recipes/all")
def all_recipes(limit: int = 50, offset: int = 0):
    """Return paginated recipe list (no ingredient filter)."""
    if df.empty:
        return {"recipes": [], "total": 0}

    subset = df.iloc[offset: offset + limit]
    out    = []

    for _, row in subset.iterrows():
        raw_cuisine = row.get("cuisine", "")
        try:
            cl = ast.literal_eval(raw_cuisine) if isinstance(raw_cuisine, str) and raw_cuisine.startswith("[") else [raw_cuisine]
            cuisine = cl[0] if cl else "International"
        except Exception:
            cuisine = str(raw_cuisine) if raw_cuisine else "International"

        steps = parse_instructions(row.get("cooking_method", ""))

        out.append({
            "recipe_name": row.get("recipe_name", ""),
            "all_ingredients": [str(i) for i in row["ingredients"]],
            "steps":       steps,
            "cuisine":     cuisine,
            "image":       row.get("image", ""),
            "tags":        str(row.get("tags", "")),
            "prep_time":   str(row.get("prep_time", "")),
            "serves":      str(row.get("serves", "")),
        })

    return {"recipes": out, "total": len(df), "limit": limit, "offset": offset}


# ── Entry point ───────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
