#!/usr/bin/env python3
"""Build Vue demo catalog from pm_test graph predictions.

Source mapping:
  singapo/exps/pred_graph/pred_graph/pm_test/<Category>@<model_id>@<view>.json
    -> data/<Category>/<model_id>/imgs/<view>.(png|jpg|jpeg|webp)

Output (non-destructive, outside data/):
  frontend-vue/public/demo_samples/index.json
  frontend-vue/public/demo_samples/graphs/<Category>/<model_id>/<view>.json
  frontend-vue/public/demo_samples/images/<Category>/<model_id>/<view>.<ext>
"""

from __future__ import annotations

import json
import shutil
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


def pick_image_file(img_dir: Path, view_id: str) -> Path | None:
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        candidate = img_dir / f"{view_id}{ext}"
        if candidate.exists():
            return candidate
    return None


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    pm_test_dir = root / "singapo" / "exps" / "pred_graph" / "pred_graph" / "pm_test"
    data_dir = root / "data"
    output_base = root / "frontend-vue" / "public" / "demo_samples"
    graph_out_base = output_base / "graphs"
    image_out_base = output_base / "images"
    output_base.mkdir(parents=True, exist_ok=True)
    graph_out_base.mkdir(parents=True, exist_ok=True)
    image_out_base.mkdir(parents=True, exist_ok=True)

    samples_by_category: dict[str, list[dict]] = defaultdict(list)
    skipped: list[dict] = []

    for graph_file in sorted(pm_test_dir.glob("*.json")):
        parts = graph_file.stem.split("@")
        if len(parts) != 3:
            skipped.append({"file": str(graph_file), "reason": "invalid_name_format"})
            continue

        category, model_id, view_id = parts
        src_img_dir = data_dir / category / model_id / "imgs"
        image_file = pick_image_file(src_img_dir, view_id)
        if image_file is None:
            skipped.append(
                {
                    "file": str(graph_file),
                    "reason": "missing_image",
                    "expected_dir": str(src_img_dir),
                    "view_id": view_id,
                }
            )
            continue

        graph_out_dir = graph_out_base / category / model_id
        image_out_dir = image_out_base / category / model_id
        graph_out_dir.mkdir(parents=True, exist_ok=True)
        image_out_dir.mkdir(parents=True, exist_ok=True)

        graph_copy = graph_out_dir / f"{view_id}.json"
        image_copy = image_out_dir / f"{view_id}{image_file.suffix.lower()}"
        shutil.copy2(graph_file, graph_copy)
        shutil.copy2(image_file, image_copy)

        sample = {
            "id": f"{category}@{model_id}@{view_id}",
            "category": category,
            "model_id": model_id,
            "view_id": view_id,
            "image_url": f"/demo_samples/images/{category}/{model_id}/{image_copy.name}",
            "graph_url": f"/demo_samples/graphs/{category}/{model_id}/{graph_copy.name}",
            "source_image_path": str(image_file.relative_to(root)),
            "source_graph_path": str(graph_file.relative_to(root)),
        }
        samples_by_category[category].append(sample)

    categories = []
    total = 0
    for category in sorted(samples_by_category):
        samples = sorted(samples_by_category[category], key=lambda s: (s["model_id"], s["view_id"]))
        total += len(samples)
        categories.append({"name": category, "count": len(samples), "samples": samples})

    index_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_samples": total,
        "category_count": len(categories),
        "categories": categories,
        "skipped": skipped,
    }

    index_file = output_base / "index.json"
    index_file.write_text(json.dumps(index_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"[demo-catalog] wrote {index_file}")
    print(f"[demo-catalog] samples={total}, categories={len(categories)}, skipped={len(skipped)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
