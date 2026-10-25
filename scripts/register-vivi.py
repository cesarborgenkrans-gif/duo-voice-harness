"""Register existing Vivi poses from their boots; never modify the source PNGs.

Developer tool: Python + Pillow. Runtime uses the generated catalog values only.
Run from any directory: python scripts/register-vivi.py
"""
from pathlib import Path
import hashlib
import json
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "src/motion/sprite-actions.js"
PREFIX = "window.DiscussionSpriteActions = Object.freeze("
THRESHOLD, BOOT_BAND, ANCHOR_X, SOLE_Y = 128, 18, 192, 465


def main():
    source = CATALOG.read_text(encoding="utf-8").strip()
    if not source.startswith(PREFIX) or not source.endswith(");"):
        raise ValueError("Unexpected catalog format; inspect it before regenerating.")
    catalog = json.loads(source[len(PREFIX):-2])
    actor = catalog["actors"]["vivi"]
    width, height = actor["canvas"]
    report = {"actor": "vivi", "alphaThreshold": THRESHOLD,
              "bootBandSourcePixels": BOOT_BAND, "anchor": [ANCHOR_X, SOLE_Y],
              "canvas": actor["canvas"], "sheets": {}}
    scales = {r["scale"] for action in actor["actions"] for r in action["registration"]}
    if len(scales) != 1:
        raise ValueError("Vivi must retain one common display scale.")
    for action in actor["actions"]:
        sheet = action["sheet"]
        if sheet not in report["sheets"]:
            sheet_path = ROOT / sheet
            image = Image.open(sheet_path).convert("RGBA")
            measured = []
            for frame, registration in enumerate(action["registration"]):
                x, y, w, h = registration["crop"]
                if x < 0 or y < 0 or x+w > image.width or y+h > image.height:
                    raise ValueError(f"Invalid crop: {sheet}:{frame}")
                alpha = image.crop((x, y, x+w, y+h)).getchannel("A")
                mask = alpha.point(lambda a: 255 if a >= THRESHOLD else 0)
                bounds, full = mask.getbbox(), alpha.getbbox()
                if not bounds or not full or bounds[1] < 2 or bounds[3] >= h-2:
                    raise ValueError(f"Empty or unsafe frame: {sheet}:{frame}")
                band = mask.crop((0, bounds[3]-BOOT_BAND, w, bounds[3])).getbbox()
                foot_x, sole_y = (band[0]+band[2])/2, bounds[3]-1
                scale = registration["scale"]
                tx, ty = ANCHOR_X-foot_x*scale, SOLE_Y-sole_y*scale
                output = [full[0]*scale+tx, full[1]*scale+ty,
                          full[2]*scale+tx, full[3]*scale+ty]
                if output[0] < 2 or output[1] < 2 or output[2] > width-2 or output[3] > height-2:
                    raise ValueError(f"Registered frame would clip: {sheet}:{frame}")
                measured.append({"frame": frame, "sourceFoot": [foot_x, sole_y],
                                 "sourceAlphaBounds": list(full), "outputAlphaBounds": output,
                                 "scale": scale, "tx": tx, "ty": ty})
            report["sheets"][sheet] = {"sha256": hashlib.sha256(sheet_path.read_bytes()).hexdigest(),
                                       "size": list(image.size), "frames": measured}
        for registration, measured in zip(action["registration"], report["sheets"][sheet]["frames"]):
            registration.update(tx=measured["tx"], ty=measured["ty"])
    CATALOG.write_text(PREFIX+json.dumps(catalog, ensure_ascii=True, separators=(",", ":"))+");\n", encoding="utf-8")
    (ROOT / "characters/vivi/registration.json").write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    print(f"Registered {sum(len(s['frames']) for s in report['sheets'].values())} frames across {len(report['sheets'])} unchanged sheets at {ANCHOR_X}, {SOLE_Y}.")


if __name__ == "__main__":
    main()
