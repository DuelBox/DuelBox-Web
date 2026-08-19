#!/usr/bin/env python3
"""
Seed the DuelBox backlog into GitHub.

Creates labels, milestones, platform issues, and per-game issues (one parent
epic plus a child per template). Idempotent: anything whose exact title already
exists is skipped, so it is safe to rerun after adding games or templates.

    python scripts/seed.py --repo owner/name --dry-run
    python scripts/seed.py --repo owner/name --only platform
    python scripts/seed.py --repo owner/name --only games --project 1

Requires: gh CLI authenticated with repo scope, PyYAML.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("Missing dependency. Run: pip install pyyaml")

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# Pace of issue creation. GitHub's secondary rate limit punishes bursts of
# content creation far more than it punishes a steady stream.
DELAY = 1.2
BACKOFF_START = 60


def gh(args: list[str], check: bool = True) -> str:
    proc = subprocess.run(["gh", *args], capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())
    return proc.stdout.strip()


def load(name: str) -> dict:
    with (DATA / name).open() as f:
        return yaml.safe_load(f)


# ------------------------------------------------------------------ rendering

def render_body(spec: dict, footer: str = "") -> str:
    """Turn a why/actions/acceptance spec into a consistent issue body."""
    parts: list[str] = []
    if spec.get("why"):
        parts.append(f"**Why this exists**\n\n{spec['why']}")
    if spec.get("actions"):
        items = "\n".join(f"- [ ] {a}" for a in spec["actions"])
        parts.append(f"**Action items**\n\n{items}")
    if spec.get("acceptance"):
        items = "\n".join(f"- [ ] {a}" for a in spec["acceptance"])
        parts.append(f"**Acceptance criteria**\n\n{items}")
    if footer:
        parts.append(footer)
    return "\n\n".join(parts)


def fmt(text: str, game: dict) -> str:
    return text.format(
        name=game["name"],
        id=game["id"],
        category=game.get("category", ""),
        archetype=game.get("archetype", ""),
    )


def platform_issues(data: dict) -> list[dict]:
    out = []
    for spec in data["issues"]:
        footer = f"---\n`epic:{spec.get('epic','platform')}` · platform backlog"
        out.append({
            "title": spec["title"],
            "body": render_body(spec, footer),
            "labels": spec.get("labels", []),
            "milestone": spec.get("milestone"),
            "group": None,
        })
    return out


def game_issues(catalog: dict, tpl: dict) -> list[dict]:
    """One parent epic per game, followed by its children."""
    out = []
    parent_tpl = tpl["parent"]
    for game in catalog["games"]:
        gid = game["id"]
        note = ""
        if game.get("rename"):
            note = (f"\n\n> Name note: the reference app calls this "
                    f"\"{game['was']}\". We ship it as **{game['name']}** to keep "
                    f"our naming clear of trademark risk. Rules and mechanics are "
                    f"not protected; names can be.")
        if game.get("confidence") == "research":
            note += ("\n\n> Mechanics for this game are not yet confirmed. The "
                     "research issue must be closed before the spec issue starts.")

        parent_footer = f"---\n`game:{gid}` · `{game.get('archetype')}` · `{game.get('category')}`"
        out.append({
            "title": fmt(parent_tpl["title"], game),
            "body": render_body({"why": fmt(parent_tpl["why"], game)}, parent_footer) + note,
            "labels": parent_tpl["labels"] + [f"game:{gid}", "type:epic"],
            "milestone": parent_tpl.get("milestone"),
            "group": gid,
            "is_parent": True,
        })

        for t in tpl["templates"]:
            allowed = t.get("archetypes")
            if allowed and game.get("archetype") not in allowed:
                continue
            if game.get("solo") and t["key"] in ("seatflip", "splitlayout", "bot"):
                continue
            footer = f"---\n`game:{gid}` · `template:{t['key']}`"
            out.append({
                "title": fmt(t["title"], game),
                "body": render_body({
                    "why": fmt(t["why"], game),
                    "actions": [fmt(a, game) for a in t.get("actions", [])],
                    "acceptance": [fmt(a, game) for a in t.get("acceptance", [])],
                }, footer),
                "labels": t.get("labels", []) + [f"game:{gid}"],
                "milestone": t.get("milestone"),
                "group": gid,
                "is_parent": False,
            })
    return out


# ------------------------------------------------------------------ creation

def ensure_labels(repo: str, labels: list[dict], dry: bool) -> None:
    existing: set[str] = set()
    if not dry:
        raw = gh(["label", "list", "--repo", repo, "--limit", "500", "--json", "name"], check=False)
        existing = {l["name"] for l in (json.loads(raw) if raw else [])}
    created = 0
    for l in labels:
        if l["name"] in existing:
            continue
        if dry:
            continue
        gh(["label", "create", l["name"], "--repo", repo, "--color", l["color"],
            "--description", l.get("description", "")], check=False)
        created += 1
    print(f"labels: {len(labels)} defined, {created} created")


def ensure_milestones(repo: str, milestones: list[dict], dry: bool) -> None:
    existing: set[str] = set()
    if not dry:
        raw = gh(["api", f"repos/{repo}/milestones?state=all&per_page=100"], check=False)
        existing = {m["title"] for m in (json.loads(raw) if raw else [])}
    for m in milestones:
        if m["name"] in existing or dry:
            continue
        gh(["api", f"repos/{repo}/milestones", "-X", "POST",
            "-f", f"title={m['name']}", "-f", f"description={m['description']}"], check=False)
    print(f"milestones: {len(milestones)} defined")


def existing_titles(repo: str) -> set[str]:
    raw = gh(["issue", "list", "--repo", repo, "--state", "all", "--limit", "5000",
              "--json", "title"], check=False)
    return {i["title"] for i in (json.loads(raw) if raw else [])}


def game_labels(catalog: dict) -> list[dict]:
    palette = ["1D76DB", "0E8A16", "5319E7", "D93F0B", "FBCA04", "006B75", "B60205", "C2E0C6"]
    return [{"name": f"game:{g['id']}", "color": palette[i % len(palette)],
             "description": f"{g['name']} ({g.get('category')})"}
            for i, g in enumerate(catalog["games"])]


def create_issue(repo: str, issue: dict, project: str | None, owner: str) -> str | None:
    args = ["issue", "create", "--repo", repo, "--title", issue["title"], "--body", issue["body"]]
    for l in issue.get("labels", []):
        args += ["--label", l]
    if issue.get("milestone"):
        args += ["--milestone", issue["milestone"]]

    backoff = BACKOFF_START
    for attempt in range(5):
        try:
            url = gh(args)
            if project:
                gh(["project", "item-add", project, "--owner", owner, "--url", url], check=False)
            return url
        except RuntimeError as e:
            msg = str(e).lower()
            if "secondary rate limit" in msg or "abuse" in msg or "was submitted too quickly" in msg:
                print(f"    rate limited, sleeping {backoff}s", flush=True)
                time.sleep(backoff)
                backoff = min(backoff * 2, 900)
            elif attempt == 4:
                print(f"    FAILED: {issue['title']}: {e}", file=sys.stderr, flush=True)
                return None
            else:
                time.sleep(5)
    return None


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--only", choices=["platform", "games", "all"], default="all")
    p.add_argument("--project")
    p.add_argument("--limit", type=int)
    args = p.parse_args()

    platform = load("platform_issues.yaml")
    catalog = load("catalog.yaml")
    tpl = load("game_templates.yaml")
    owner = args.repo.split("/")[0]

    all_labels = platform["labels"] + game_labels(catalog)
    ensure_labels(args.repo, all_labels, args.dry_run)
    ensure_milestones(args.repo, platform["milestones"], args.dry_run)

    issues: list[dict] = []
    if args.only in ("platform", "all"):
        issues += platform_issues(platform)
    if args.only in ("games", "all"):
        issues += game_issues(catalog, tpl)

    seen = set() if args.dry_run else existing_titles(args.repo)
    todo = [i for i in issues if i["title"] not in seen]
    if args.limit:
        todo = todo[: args.limit]

    print(f"{len(issues)} defined · {len(issues) - len(todo)} already exist · {len(todo)} to create")
    if args.dry_run:
        for i in todo[:15]:
            print(f"  [issue] {i['title']}")
        print(f"  ... and {max(0, len(todo) - 15)} more")
        print("\nDry run complete. Drop --dry-run to create.")
        return

    made = 0
    for n, issue in enumerate(todo, 1):
        url = create_issue(args.repo, issue, args.project, owner)
        if url:
            made += 1
        if n % 25 == 0 or n == len(todo):
            print(f"  [{n}/{len(todo)}] created {made}", flush=True)
        time.sleep(DELAY)

    print(f"\nDone. {made} issues created.")


if __name__ == "__main__":
    main()
