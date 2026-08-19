#!/usr/bin/env python3
"""
Backfill observed rule text onto game parent epics that were created before the
seeder learned to include it. Idempotent: skips any epic that already has it.

    python scripts/backfill_rules.py --repo owner/name [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
PRETTY = {"friend": "vs Friend", "bot": "vs Bot", "solo": "Solo"}


def gh(args: list[str], check: bool = True) -> str:
    p = subprocess.run(["gh", *args], capture_output=True, text=True)
    if check and p.returncode != 0:
        raise RuntimeError(p.stderr.strip())
    return p.stdout.strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    catalog = yaml.safe_load((ROOT / "data" / "catalog.yaml").read_text())
    enriched = {g["name"]: g for g in catalog["games"] if g.get("rule") or g.get("modes")}
    if not enriched:
        print("nothing to backfill")
        return

    raw = gh(["issue", "list", "--repo", args.repo, "--state", "all", "--limit", "3000",
              "--search", "Build the game in:title", "--json", "number,title,body"])
    issues = json.loads(raw or "[]")

    done = 0
    for issue in issues:
        title = issue["title"]
        if not (title.startswith("[") and title.endswith("] Build the game")):
            continue
        name = title[1:-len("] Build the game")]
        game = enriched.get(name)
        if not game or "Observed rules" in (issue["body"] or ""):
            continue

        extra = ""
        if game.get("rule"):
            extra += (f"\n\n**Observed rules**\n\n{game['rule']}\n\n"
                      f"Recorded by playing the reference game. This describes the "
                      f"mechanics we reimplement from scratch; our own copy, art, and "
                      f"layout are original.")
        if game.get("modes"):
            modes = ", ".join(PRETTY.get(m, m) for m in game["modes"].split(","))
            extra += f"\n\n**Play modes observed:** {modes}"

        if args.dry_run:
            print(f"  would update #{issue['number']} {title}")
            done += 1
            continue

        gh(["issue", "edit", str(issue["number"]), "--repo", args.repo,
            "--body", (issue["body"] or "") + extra], check=False)
        print(f"  updated #{issue['number']} {title}", flush=True)
        done += 1
        time.sleep(1.0)

    print(f"\n{done} epics {'would be ' if args.dry_run else ''}updated.")


if __name__ == "__main__":
    main()
