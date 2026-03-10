#!/usr/bin/env python3
"""
Generate layered character sprite sheets using fal.ai (falsprite pipeline).
Uses nano-banana-2 for generation, OpenRouter LLM for prompt rewriting,
and BRIA for background removal.

Each sheet: 4x4 grid → 64x88px final (16x22 per frame)
Rows: down, left, right, up
Cols: idle1, idle2, walk1, walk2

Usage:
  python3 scripts/generate-sprites.py           # generate all
  python3 scripts/generate-sprites.py body      # just body layers
  python3 scripts/generate-sprites.py weapons   # just weapons
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
from pathlib import Path
from PIL import Image
from io import BytesIO

FAL_KEY = os.environ.get("FAL_KEY")
if not FAL_KEY:
    print("ERROR: FAL_KEY not set in environment")
    sys.exit(1)

OUT_DIR = Path("client/public/sprites/layers")

# Final sprite sheet dimensions
FRAME_W, FRAME_H = 16, 22
COLS, ROWS = 4, 4
SHEET_W = FRAME_W * COLS   # 64
SHEET_H = FRAME_H * ROWS   # 88

# fal.ai endpoints (same as falsprite)
NANO_BANANA = "fal-ai/nano-banana-2"
REMOVE_BG = "fal-ai/bria/background/remove"
REWRITE_ENDPOINT = "openrouter/router"
REWRITE_MODEL = "openai/gpt-4o-mini"
GRID_SIZE = 4

# ── Helpers ────────────────────────────────────────────────────────

def fal_request(url, payload=None, method="POST"):
    """Make an authenticated request to fal.ai."""
    headers = {
        "Authorization": f"Key {FAL_KEY}",
        "Content-Type": "application/json",
    }
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    resp = urllib.request.urlopen(req, timeout=60)
    return json.loads(resp.read())


def run_queued(endpoint, input_data, timeout_ms=240000):
    """Submit to fal queue and poll until complete."""
    submit = fal_request(f"https://queue.fal.run/{endpoint}", input_data)
    request_id = submit.get("request_id")
    if not request_id:
        # Direct result
        return submit

    status_url = f"https://queue.fal.run/{endpoint}/requests/{request_id}/status"
    result_url = f"https://queue.fal.run/{endpoint}/requests/{request_id}"
    deadline = time.time() + timeout_ms / 1000

    while time.time() < deadline:
        time.sleep(2)
        try:
            status = fal_request(status_url, method="GET")
        except Exception:
            continue

        state = status.get("status", "")
        if state == "COMPLETED":
            result = fal_request(result_url, method="GET")
            # Follow response_url if present
            if isinstance(result, dict) and isinstance(result.get("response_url"), str):
                try:
                    result = fal_request(result["response_url"], method="GET")
                except Exception:
                    pass
            return result
        if state == "FAILED":
            raise RuntimeError(f"Generation failed: {json.dumps(status)[:300]}")
        print(f"    polling... {state}")

    raise RuntimeError("Generation timed out")


def run_direct(endpoint, input_data):
    """Run a fal model directly (no queue)."""
    return fal_request(f"https://fal.run/{endpoint}", input_data)


def extract_image_url(data):
    """Extract first image URL from fal response."""
    if data.get("image", {}).get("url"):
        return data["image"]["url"]
    for img in data.get("images", []):
        if isinstance(img, str):
            return img
        if isinstance(img, dict) and img.get("url"):
            return img["url"]
    return None


def download_image(url):
    """Download URL to PIL Image."""
    resp = urllib.request.urlopen(url, timeout=30)
    return Image.open(BytesIO(resp.read()))


def rewrite_prompt(base_prompt):
    """Use LLM to rewrite prompt into detailed character + choreography."""
    system = "\n".join([
        "You are an animation director and character designer for a sprite sheet pipeline.",
        "Given a character concept, return exactly two sections:",
        "",
        "CHARACTER: Vivid description of appearance — body type, colors, silhouette, art style.",
        "",
        "CHOREOGRAPHY: A four-beat continuous animation loop.",
        "Beat 1: idle standing, facing camera (down).",
        "Beat 2: same idle, slight shift (breathing/weight).",
        "Beat 3: walking, left foot forward.",
        "Beat 4: walking, right foot forward.",
        "Describe exact limb positions for each beat.",
        "",
        "RULES:",
        "- Tiny chibi pixel art character, 16px wide, top-down RPG style.",
        "- This is ONE LAYER of a layered sprite system — ONLY describe the specific",
        "  element being generated (e.g., only the hair, only the boots).",
        "- Everything except the described element must be EMPTY/TRANSPARENT.",
        "- No text, numbers, labels, grids, or technical terms.",
    ])

    result = run_queued(REWRITE_ENDPOINT, {
        "model": REWRITE_MODEL,
        "prompt": f"Design and choreograph for: {base_prompt}",
        "system_prompt": system,
        "max_tokens": 350,
        "temperature": 0.6,
    }, 120000)

    # Result might be a string directly or a nested dict
    if isinstance(result, str) and len(result) > 20:
        return result.strip()

    if not isinstance(result, dict):
        return base_prompt

    # Extract text from various response shapes
    for path in [
        lambda d: d.get("choices", [{}])[0].get("message", {}).get("content"),
        lambda d: d.get("output", {}).get("choices", [{}])[0].get("message", {}).get("content") if isinstance(d.get("output"), dict) else None,
        lambda d: d.get("output") if isinstance(d.get("output"), str) else None,
        lambda d: d.get("text"),
        lambda d: d.get("result") if isinstance(d.get("result"), str) else None,
    ]:
        try:
            v = path(result)
            if isinstance(v, str) and len(v) > 20:
                return v.strip()
        except (IndexError, KeyError, TypeError, AttributeError):
            continue

    # Deep search for any string content
    for key in ["output", "text", "content", "result"]:
        v = result.get(key)
        if isinstance(v, str) and len(v) > 20:
            return v.strip()

    return base_prompt


def build_sprite_prompt(rewritten):
    """Wrap rewritten prompt with strict grid requirements."""
    return "\n".join([
        "STRICT TECHNICAL REQUIREMENTS FOR THIS IMAGE:",
        "",
        "FORMAT: A single image containing a four-by-four grid of equally sized cells.",
        "Every cell must be the exact same dimensions, perfectly aligned, no gaps.",
        "",
        "FORBIDDEN: No text, numbers, labels, watermarks, UI elements.",
        "ONLY the character illustration in each cell.",
        "",
        "BACKGROUND: Plain solid flat color background (will be removed).",
        "",
        "CONSISTENCY: The exact same single character element in every cell.",
        "Same proportions, same art style. Tiny chibi pixel art, 2D top-down RPG.",
        "",
        "GRID LAYOUT: 4 columns x 4 rows.",
        "Row 1: facing down (toward camera). Row 2: facing left.",
        "Row 3: facing right. Row 4: facing up (away from camera).",
        "Columns: idle1, idle2 (slight shift), walk1 (left step), walk2 (right step).",
        "",
        "CHARACTER AND ANIMATION DIRECTION:",
        rewritten,
    ])


# ── Sprite definitions ─────────────────────────────────────────────

# ── Mob sprite definitions ─────────────────────────────────────────
# Mobs use 16x16 frames → 64x64 sheets (unlike player 16x22 → 64x88)
MOB_FRAME_W, MOB_FRAME_H = 16, 16
MOB_SHEET_W = MOB_FRAME_W * COLS  # 64
MOB_SHEET_H = MOB_FRAME_H * ROWS  # 64
MOB_OUT_DIR = Path("client/public/sprites/mobs")

MOB_BASE_PROMPT = (
    "Single creature sprite sheet, pixel art, 16x16 pixel frames, "
    "top-down 2D RPG style like Pokemon or Zelda. "
    "Tiny cute chibi monster. No text, no labels, no UI."
)

# category → prompt describing the creature's appearance
MOB_SPRITE_DEFS: dict[str, str] = {
    # ── Village / early ──
    "wolf":      "Gray wolf, canine quadruped, pointy ears, bushy tail, fierce red eyes, gray fur",
    "rat":       "Giant brown rat, long pink tail, beady eyes, small rounded body, tan fur",
    "boar":      "Wild boar, tusks, brown bristly fur, stocky body, small hooves, aggressive",
    "slime":     "Green slime blob, translucent lime jelly body, no legs, amorphous, googly eyes",
    "goblin":    "Small green goblin, pointy ears, crude leather armor, holding a dagger, sneering",
    "bandit":    "Human bandit, dark hooded cloak, mask over face, leather armor, dagger in hand",
    # ── Meadow / forest ──
    "bear":      "Large brown bear, thick fur, powerful paws, standing on all fours, dark eyes",
    "spider":    "Giant purple spider, eight legs, fangs dripping venom, multiple red eyes, hairy body",
    "ent":       "Living tree creature, bark skin, mossy green-brown, branch arms, glowing green eyes, trunk body",
    "snake":     "Large olive-green serpent, coiled body, forked tongue, scales, slithering, no legs",
    # ── Dark forest ──
    "cultist":   "Dark robed cultist, purple hooded robe, glowing eyes, holding dark orb, skeletal hands",
    "undead":    "Undead knight, pale bone armor, glowing blue eyes, tattered cape, skeletal, rusted sword",
    "troll":     "Forest troll, large muscular, dark teal-green skin, club weapon, tusks, hunched posture",
    "golem":     "Stone golem, gray rocky body, glowing rune eyes, massive fists, cracked stone texture",
    "necromancer": "Dark necromancer, black and purple robes, skull staff, glowing green magic aura, hood",
    # ── Plains ──
    "stalker":   "Plains stalker cat, tawny golden fur, sleek feline predator, sharp claws, amber eyes",
    "wisp":      "Floating aurora wisp, ethereal blue-green glow, orb of light, trailing particles, no body",
    "harpy":     "Windborne harpy, feathered wings, bird-like talons, woman-like face, wind-swept feathers",
    "wraith":    "Ethereal wraith, translucent ghostly form, tattered floating robes, glowing purple eyes",
    "elemental": "Storm elemental, crackling lightning body, cloud-like form, electric blue-white energy",
    "drake":     "Skyward drake, small dragon with wings, blue-gray scales, fire breath, horned head",
    # ── Woods ──
    "treant":    "Thorned treant, massive tree creature, sharp thorny branches, dark bark, amber sap eyes",
    "serpent":   "Emerald serpent, bright green scaled snake, large, coiled, jewel-like green scales, fangs",
    "worg":      "Feral worg, huge dark wolf, matted black fur, massive fangs, bloodshot eyes, muscular",
    "specter":   "Ghostly specter, floating translucent spirit, wispy ethereal body, hollow glowing eyes",
    "guardian":  "Ancient stone guardian, armored construct, glowing blue core, shield and sword, bulky",
    "sentinel":  "Grom sentinel boss, massive stone warrior, green glowing runes, towering, ancient armor",
    # ── Mountains ──
    "yeti":      "Mountain yeti, large white-furred ape, massive arms, icy blue eyes, frost on fur",
    "basilisk":  "Rock basilisk, reptilian, stone-gray scales, petrifying yellow eyes, heavy armored hide",
    "condor":    "Storm condor, giant bird, dark feathers, electric blue wingtips, sharp beak and talons",
    "giant":     "Frost giant, massive humanoid, blue-white skin, icy beard, fur loincloth, ice club",
    "titan":     "Avalanche titan boss, enormous rocky giant, snow-covered, glowing ice-blue core, crushing fists",
    # ── Glade ──
    "fae":       "Fae guardian, small winged fairy warrior, glowing golden wings, tiny sword, magical aura",
    "dryad":     "Twilight dryad, tree-woman hybrid, flower crown, bark-skin lower body, purple leaf hair",
    "druid":     "Shadow druid, dark robed nature caster, antler headdress, staff with dark vines, menacing",
    "archdruid": "Moondancer archdruid boss, large, crescent moon staff, silver robes, lunar magic aura, horned crown",
    # ── Citadel ──
    "automaton": "Iron automaton, mechanical construct, gears visible, copper-bronze body, glowing red eye visor",
    "forgebound":"Molten forgebound, lava-infused golem, cracked obsidian skin, orange magma veins, fiery",
    "dweller":   "Deep dweller, cave creature, pale eyeless, long claws, hunched, translucent skin",
    "dwarf":     "Corrupted dwarf king, stocky, dark iron crown, glowing red veins, massive war hammer",
    "infernal":  "Forgemaster infernal boss, huge fire demon, molten armor, flaming sword, lava dripping",
    # ── Lake ──
    "luminous":  "Luminous wraith, bright glowing ghost, golden-white ethereal form, trailing light particles",
    "crystal":   "Crystal golem, transparent gemstone body, prismatic light refractions, sharp crystalline limbs",
    "drowned":   "Drowned knight, waterlogged armor, seaweed draped, barnacle-encrusted, ghostly blue glow",
    "lumen":     "Lumen serpent, bioluminescent water snake, glowing blue-white scales, long sinuous body",
    "horror":    "Sunken horror, deep sea aberration, tentacles, bioluminescent lure, massive maw, dark purple",
    "warden":    "Solaris warden boss, radiant armored angel, golden wings, blazing sun-sword, holy aura",
    # ── Chasm ──
    "dragonkin": "Azure dragonkin, bipedal dragon warrior, blue scales, dragon wings, clawed hands, armored",
    "weaver":    "Void weaver, dark matter spider-like creature, reality-warping tendrils, starfield body",
    "shard":     "Shard sentinel, living crystal construct, sharp geometric body, pulsing blue energy core",
    "wyrm":      "Chasm wyrm, massive serpentine dragon, dark scales, glowing blue underbelly, wingless",
    "devourer":  "Essence devourer, amorphous dark entity, consuming void, many eyes, tendrils of darkness",
    "dragon":    "Azurshard dragon boss, enormous blue dragon, crystalline scales, devastating breath, majestic wings",
}

SPRITE_DEFS = {
    "body": {
        "dir": "body",
        "variants": {
            "light": "Base body layer ONLY: light/pale caucasian skin tone, naked humanoid body silhouette, no clothes no hair no accessories, just the bare skin body shape of a tiny chibi RPG character",
            "medium": "Base body layer ONLY: medium tan/brown skin tone, naked humanoid body silhouette, no clothes no hair no accessories, just the bare skin body shape of a tiny chibi RPG character",
            "dark": "Base body layer ONLY: dark brown/african skin tone, naked humanoid body silhouette, no clothes no hair no accessories, just the bare skin body shape of a tiny chibi RPG character",
            "olive": "Base body layer ONLY: olive/mediterranean skin tone, naked humanoid body silhouette, no clothes no hair no accessories, just the bare skin body shape of a tiny chibi RPG character",
            "pale": "Base body layer ONLY: very pale porcelain white skin tone, naked humanoid body silhouette, no clothes no hair no accessories, just the bare skin body shape of a tiny chibi RPG character",
        },
    },
    "eyes": {
        "dir": "eyes",
        "variants": {
            "blue": "EYES ONLY layer: two small bright blue eye dots, nothing else visible, just tiny eye pixels on transparent/empty space, for a chibi RPG character sprite, minimal 2-pixel eye dots",
            "green": "EYES ONLY layer: two small green eye dots, nothing else visible, just tiny eye pixels on transparent/empty space, for a chibi RPG character sprite, minimal 2-pixel eye dots",
            "brown": "EYES ONLY layer: two small dark brown eye dots, nothing else visible, just tiny eye pixels on transparent/empty space, for a chibi RPG character sprite, minimal 2-pixel eye dots",
            "red": "EYES ONLY layer: two small glowing red eye dots, nothing else visible, just tiny eye pixels on transparent/empty space, for a chibi RPG character sprite, minimal 2-pixel eye dots",
            "gold": "EYES ONLY layer: two small golden/yellow eye dots, nothing else visible, just tiny eye pixels on transparent/empty space, for a chibi RPG character sprite, minimal 2-pixel eye dots",
        },
    },
    "hair": {
        "dir": "hair",
        "variants": {
            "short": "HAIR ONLY layer: short spiky white/gray hair on top of head, nothing else visible, grayscale hair for color tinting, chibi RPG character, only hair pixels everything else empty",
            "long": "HAIR ONLY layer: long flowing white/gray hair past shoulders, nothing else visible, grayscale hair for color tinting, chibi RPG character, only hair pixels everything else empty",
            "mohawk": "HAIR ONLY layer: tall mohawk white/gray hair, nothing else visible, grayscale hair for color tinting, chibi RPG character, only hair pixels everything else empty",
            "ponytail": "HAIR ONLY layer: ponytail white/gray hair tied back, nothing else visible, grayscale hair for color tinting, chibi RPG character, only hair pixels everything else empty",
        },
    },
    "chest": {
        "dir": "chest",
        "variants": {
            "cloth": "CHEST ARMOR ONLY layer: simple brown cloth tunic on torso area, nothing else visible, only the torso clothing pixels, chibi RPG character, transparent everywhere except chest armor",
            "leather": "CHEST ARMOR ONLY layer: brown leather vest armor on torso, nothing else visible, only the torso armor pixels, chibi RPG character, transparent everywhere except chest armor",
            "chain": "CHEST ARMOR ONLY layer: silver chainmail shirt on torso, nothing else visible, only the torso armor pixels, chibi RPG character, transparent everywhere except chest armor",
            "plate": "CHEST ARMOR ONLY layer: heavy steel plate chestplate on torso, nothing else visible, only the torso armor pixels with metallic sheen, chibi RPG character, transparent everywhere except chest armor",
        },
    },
    "legs": {
        "dir": "legs",
        "variants": {
            "cloth": "LEGS ARMOR ONLY layer: simple cloth pants/trousers on legs, nothing else visible, only leg clothing pixels, chibi RPG character with walking animation, transparent everywhere except legs",
            "leather": "LEGS ARMOR ONLY layer: brown leather leggings on legs, nothing else visible, only leg armor pixels, chibi RPG character with walking animation, transparent everywhere except legs",
            "chain": "LEGS ARMOR ONLY layer: chainmail leg armor greaves, nothing else visible, only leg armor pixels, chibi RPG character with walking animation, transparent everywhere except legs",
            "plate": "LEGS ARMOR ONLY layer: heavy steel plate leg armor, nothing else visible, only leg armor pixels with metallic sheen, chibi RPG character with walking animation, transparent everywhere except legs",
        },
    },
    "boots": {
        "dir": "boots",
        "variants": {
            "cloth": "BOOTS ONLY layer: simple cloth shoes/sandals on feet, nothing else visible, only foot pixels, tiny chibi RPG character, transparent everywhere except boots",
            "leather": "BOOTS ONLY layer: brown leather boots on feet, nothing else visible, only boot pixels, tiny chibi RPG character, transparent everywhere except boots",
            "iron": "BOOTS ONLY layer: iron plated steel boots on feet, nothing else visible, only boot pixels with metal sheen, tiny chibi RPG character, transparent everywhere except boots",
            "gold": "BOOTS ONLY layer: ornate golden boots on feet, nothing else visible, only boot pixels with gold color, tiny chibi RPG character, transparent everywhere except boots",
        },
    },
    "helm": {
        "dir": "helm",
        "variants": {
            "leather": "HELMET ONLY layer: leather cap/helmet on head, nothing else visible, only helmet pixels on top of head area, chibi RPG character, transparent everywhere except helmet",
            "iron": "HELMET ONLY layer: iron helmet with nose guard on head, nothing else visible, only helmet pixels, chibi RPG character, transparent everywhere except helmet",
            "plate": "HELMET ONLY layer: full steel plate helmet with visor on head, nothing else visible, only helmet pixels with metal sheen, chibi RPG character, transparent everywhere except helmet",
            "crown": "HELMET ONLY layer: golden royal crown on head, nothing else visible, only crown pixels with gold gleam, chibi RPG character, transparent everywhere except crown",
        },
    },
    "shoulders": {
        "dir": "shoulders",
        "variants": {
            "leather": "SHOULDERS ONLY layer: leather shoulder pads, nothing else visible, only shoulder pad pixels on shoulder area, chibi RPG character, transparent everywhere except shoulder armor",
            "iron": "SHOULDERS ONLY layer: iron pauldrons shoulder armor, nothing else visible, only pauldron pixels with metal sheen, chibi RPG character, transparent everywhere except shoulder armor",
            "plate": "SHOULDERS ONLY layer: heavy steel plate pauldrons, nothing else visible, only pauldron pixels with metallic sheen, chibi RPG character, transparent everywhere except shoulder armor",
        },
    },
    "weapons": {
        "dir": "weapons",
        "variants": {
            "sword": "WEAPON ONLY layer: iron sword held in right hand, nothing else visible, only the sword weapon pixels, chibi RPG character holding sword, transparent everywhere except weapon",
            "staff": "WEAPON ONLY layer: wooden magic staff with glowing tip held upright, nothing else visible, only the staff weapon pixels, chibi RPG character, transparent everywhere except weapon",
            "bow": "WEAPON ONLY layer: wooden longbow held in left hand, nothing else visible, only the bow weapon pixels, chibi RPG character, transparent everywhere except weapon",
            "dagger": "WEAPON ONLY layer: small dagger/knife in right hand, nothing else visible, only the dagger weapon pixels, chibi RPG character, transparent everywhere except weapon",
            "axe": "WEAPON ONLY layer: battle axe held in right hand, nothing else visible, only the axe weapon pixels, chibi RPG character, transparent everywhere except weapon",
            "mace": "WEAPON ONLY layer: iron mace held in right hand, nothing else visible, only the mace weapon pixels, chibi RPG character, transparent everywhere except weapon",
        },
    },
}


def generate_sprite(category, variant_id, prompt_text, out_path):
    """Generate one sprite sheet using the falsprite pipeline."""
    print(f"  [{category}/{variant_id}] Rewriting prompt...")
    rewritten = rewrite_prompt(prompt_text)
    print(f"    Rewritten ({type(rewritten).__name__}, {len(rewritten)} chars): {rewritten[:120]}...")

    full_prompt = build_sprite_prompt(rewritten)

    print(f"  [{category}/{variant_id}] Generating sprite sheet...")
    result = run_queued(NANO_BANANA, {
        "prompt": full_prompt,
        "aspect_ratio": "1:1",
        "resolution": "2K",
        "num_images": 1,
        "output_format": "png",
        "safety_tolerance": 2,
        "expand_prompt": True,
    })

    sprite_url = extract_image_url(result)
    if not sprite_url:
        raise RuntimeError(f"No image URL in result: {json.dumps(result)[:200]}")

    print(f"  [{category}/{variant_id}] Removing background...")
    try:
        bg_result = run_direct(REMOVE_BG, {"image_url": sprite_url})
        transparent_url = extract_image_url(bg_result)
        if transparent_url:
            sprite_url = transparent_url
            print(f"    Background removed.")
        else:
            print(f"    BG removal returned no URL, using original.")
    except Exception as e:
        print(f"    BG removal failed ({e}), using original.")

    print(f"  [{category}/{variant_id}] Downloading and resizing...")
    img = download_image(sprite_url)

    # Resize to exact 64x88 with NEAREST for pixel crispness
    sheet = img.resize((SHEET_W, SHEET_H), Image.Resampling.NEAREST)
    if sheet.mode != "RGBA":
        sheet = sheet.convert("RGBA")

    sheet.save(out_path)
    print(f"    Saved: {out_path} ({sheet.size[0]}x{sheet.size[1]})")


def generate_category(category):
    """Generate all variants for a category."""
    defn = SPRITE_DEFS.get(category)
    if not defn:
        print(f"Unknown category: {category}")
        print(f"Available: {', '.join(SPRITE_DEFS.keys())}, mobs")
        return

    out_dir = OUT_DIR / defn["dir"]
    out_dir.mkdir(parents=True, exist_ok=True)

    for variant_id, prompt_text in defn["variants"].items():
        if category == "weapons":
            filename = f"weapon-{variant_id}.png"
        else:
            filename = f"{defn['dir']}-{variant_id}.png"

        out_path = out_dir / filename

        if out_path.exists():
            print(f"  SKIP {out_path} (already exists, delete to regenerate)")
            continue

        try:
            generate_sprite(category, variant_id, prompt_text, out_path)
        except Exception as e:
            print(f"  ERROR [{category}/{variant_id}]: {e}")

        # Rate limit
        time.sleep(1)


# ── Mob sprite generation ──────────────────────────────────────────

def build_mob_sprite_prompt(rewritten):
    """Wrap rewritten mob prompt with strict grid requirements."""
    return "\n".join([
        "STRICT TECHNICAL REQUIREMENTS FOR THIS IMAGE:",
        "",
        "FORMAT: A single image containing a four-by-four grid of equally sized cells.",
        "Every cell must be the exact same dimensions, perfectly aligned, no gaps.",
        "",
        "FORBIDDEN: No text, numbers, labels, watermarks, UI elements.",
        "ONLY the creature illustration in each cell.",
        "",
        "BACKGROUND: Plain solid flat color background (will be removed).",
        "",
        "CONSISTENCY: The exact same single creature in every cell.",
        "Same proportions, same art style. Tiny pixel art, 2D top-down RPG, 16x16 pixel frames.",
        "",
        "GRID LAYOUT: 4 columns x 4 rows.",
        "Row 1: facing down (toward camera). Row 2: facing left.",
        "Row 3: facing right. Row 4: facing up (away from camera).",
        "Columns: idle1, idle2 (slight shift), walk1 (step forward), walk2 (other step).",
        "",
        "CREATURE AND ANIMATION DIRECTION:",
        rewritten,
    ])


def rewrite_mob_prompt(base_prompt):
    """Use LLM to rewrite a mob prompt into detailed creature + choreography."""
    system = "\n".join([
        "You are an animation director and creature designer for a pixel art sprite sheet pipeline.",
        "Given a creature concept, return exactly two sections:",
        "",
        "CHARACTER: Vivid description of the creature — body shape, colors, silhouette, distinguishing features.",
        "",
        "CHOREOGRAPHY: A four-beat continuous animation loop.",
        "Beat 1: idle standing/hovering, facing camera (down).",
        "Beat 2: same idle, slight shift (breathing/bobbing/weight).",
        "Beat 3: moving, first step/slither/flap.",
        "Beat 4: moving, second step/slither/flap.",
        "Describe exact body positions for each beat.",
        "",
        "RULES:",
        "- Tiny pixel art creature, 16x16 pixels, top-down 2D RPG style like Pokemon.",
        "- The ENTIRE creature fits inside 16x16 pixels. Very small and cute/chibi.",
        "- No text, numbers, labels, grids, or technical terms.",
        "- Solid colored background (will be removed).",
    ])

    result = run_queued(REWRITE_ENDPOINT, {
        "model": REWRITE_MODEL,
        "prompt": f"Design and choreograph for: {base_prompt}",
        "system_prompt": system,
        "max_tokens": 350,
        "temperature": 0.6,
    }, 120000)

    if isinstance(result, str) and len(result) > 20:
        return result.strip()

    if not isinstance(result, dict):
        return base_prompt

    for path in [
        lambda d: d.get("choices", [{}])[0].get("message", {}).get("content"),
        lambda d: d.get("output", {}).get("choices", [{}])[0].get("message", {}).get("content") if isinstance(d.get("output"), dict) else None,
        lambda d: d.get("output") if isinstance(d.get("output"), str) else None,
        lambda d: d.get("text"),
        lambda d: d.get("result") if isinstance(d.get("result"), str) else None,
    ]:
        try:
            v = path(result)
            if isinstance(v, str) and len(v) > 20:
                return v.strip()
        except (IndexError, KeyError, TypeError, AttributeError):
            continue

    for key in ["output", "text", "content", "result"]:
        v = result.get(key)
        if isinstance(v, str) and len(v) > 20:
            return v.strip()

    return base_prompt


def generate_mob_sprite(mob_id, description, out_path):
    """Generate one mob sprite sheet using the falsprite pipeline."""
    print(f"  [mob/{mob_id}] Rewriting prompt...")
    base = f"{MOB_BASE_PROMPT} {description}"
    rewritten = rewrite_mob_prompt(base)
    print(f"    Rewritten ({len(rewritten)} chars): {rewritten[:120]}...")

    full_prompt = build_mob_sprite_prompt(rewritten)

    print(f"  [mob/{mob_id}] Generating sprite sheet...")
    result = run_queued(NANO_BANANA, {
        "prompt": full_prompt,
        "aspect_ratio": "1:1",
        "resolution": "2K",
        "num_images": 1,
        "output_format": "png",
        "safety_tolerance": 2,
        "expand_prompt": True,
    })

    sprite_url = extract_image_url(result)
    if not sprite_url:
        raise RuntimeError(f"No image URL in result: {json.dumps(result)[:200]}")

    print(f"  [mob/{mob_id}] Removing background...")
    try:
        bg_result = run_direct(REMOVE_BG, {"image_url": sprite_url})
        transparent_url = extract_image_url(bg_result)
        if transparent_url:
            sprite_url = transparent_url
            print(f"    Background removed.")
        else:
            print(f"    BG removal returned no URL, using original.")
    except Exception as e:
        print(f"    BG removal failed ({e}), using original.")

    print(f"  [mob/{mob_id}] Downloading and resizing to {MOB_SHEET_W}x{MOB_SHEET_H}...")
    img = download_image(sprite_url)

    # Resize to exact 64x64 with NEAREST for pixel crispness
    sheet = img.resize((MOB_SHEET_W, MOB_SHEET_H), Image.Resampling.NEAREST)
    if sheet.mode != "RGBA":
        sheet = sheet.convert("RGBA")

    sheet.save(out_path)
    print(f"    Saved: {out_path} ({sheet.size[0]}x{sheet.size[1]})")


def generate_mobs(filter_id=None):
    """Generate mob sprite sheets."""
    MOB_OUT_DIR.mkdir(parents=True, exist_ok=True)

    targets = MOB_SPRITE_DEFS
    if filter_id:
        if filter_id not in MOB_SPRITE_DEFS:
            print(f"Unknown mob: {filter_id}")
            print(f"Available: {', '.join(MOB_SPRITE_DEFS.keys())}")
            return
        targets = {filter_id: MOB_SPRITE_DEFS[filter_id]}

    for mob_id, description in targets.items():
        out_path = MOB_OUT_DIR / f"mob-{mob_id}.png"

        if out_path.exists():
            print(f"  SKIP {out_path} (already exists, delete to regenerate)")
            continue

        try:
            generate_mob_sprite(mob_id, description, out_path)
        except Exception as e:
            print(f"  ERROR [mob/{mob_id}]: {e}")

        time.sleep(1)


def main():
    category = sys.argv[1] if len(sys.argv) > 1 else "all"

    print(f"FalSprite Generator")
    print(f"Pipeline: LLM rewrite → nano-banana-2 → BRIA bg removal → resize")
    print(f"Player layers output: {OUT_DIR}")
    print(f"Mob sprites output:   {MOB_OUT_DIR}")
    print()

    if category == "all":
        for cat in SPRITE_DEFS:
            print(f"\n{'='*50}")
            print(f"  {cat.upper()} ({len(SPRITE_DEFS[cat]['variants'])} variants)")
            print(f"{'='*50}")
            generate_category(cat)
        print(f"\n{'='*50}")
        print(f"  MOBS ({len(MOB_SPRITE_DEFS)} types)")
        print(f"{'='*50}")
        generate_mobs()
    elif category == "mobs":
        # python3 generate-sprites.py mobs          → all mobs
        # python3 generate-sprites.py mobs wolf     → just wolf
        mob_filter = sys.argv[2] if len(sys.argv) > 2 else None
        generate_mobs(mob_filter)
    else:
        generate_category(category)

    print(f"\nDone! Upload to R2 with: ./scripts/upload-assets.sh")


if __name__ == "__main__":
    main()
