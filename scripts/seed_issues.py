#!/usr/bin/env python3
"""
Seed the DuelBox backlog into a GitHub repo.

Creates labels, milestones, platform issues, and per-game issues expanded from
templates. Idempotent: existing labels/milestones are reused, and issues whose
exact title already exists are skipped.

Usage:
    python scripts/seed_issues.py --repo owner/name --dry-run
    python scripts/seed_issues.py --repo owner/name
    python scripts/seed_issues.py --repo owner/name --only games
    python scripts/seed_issues.py --repo owner/name --only platform --milestone "M0 Foundation"
    python scripts/seed_issues.py --repo owner/name --project 1   # also add to org/user project board

Requires: gh CLI authenticated (`gh auth login`) with repo scope. PyYAML.
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

BUILD_COST = {"S": 1, "M": 2, "L": 3}


# ---------------------------------------------------------------- gh helpers

def gh(args: list[str], check: bool = True) -> str:
    """Run a gh command and return stdout."""
    proc = subprocess.run(
        ["gh", *args], capture_output=True, text=True
    )
    if check and proc.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args)}\n{proc.stderr.strip()}")
    return proc.stdout.strip()


def ensure_gh_ready(repo: str) -> None:
    if subprocess.run(["which", "gh"], capture_output=True).returncode != 0:
        sys.exit("gh CLI not found. Install: https://cli.github.com")
    status = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True)
    if status.returncode != 0:
        sys.exit("gh is not authenticated. Run: gh auth login")
    try:
        gh(["repo", "view", repo, "--json", "name"])
    except RuntimeError as e:
        sys.exit(f"Cannot access repo {repo}.\n{e}")


# ---------------------------------------------------------------- data load

def load(path: Path) -> dict:
    with path.open() as f:
        return yaml.safe_load(f)


def expand_game_issues(games: list[dict], templates: list[dict]) -> list[dict]:
    """Cross-product games x templates into concrete issues."""
    out = []
    for g in games:
        cost = BUILD_COST.get(g.get("build", "M"), 2)
        for t in templates:
            fields = {
                "name": g["name"], "id": g["id"], "genre": g["genre"],
                "layout": g["layout"], "controls": g["controls"],
                "loop": g["loop"], "sim": g["sim"], "ai": g["ai"],
                "round": g["round"], "build": g["build"],
            }
            estimate = t["base"] * (cost if t.get("scales") else 1)
            out.append({
                "title": t["title"].format(**fields),
                "body": t["body"].format(**fields).rstrip()
                        + f"\n\n---\n`game:{g['id']}` · `template:{t['key']}` · "
                          f"build cost {g['build']} · estimate {estimate}",
                "labels": list(t["labels"]) + [f"game:{g['id']}"],
                "milestone": t["milestone"],
                "estimate": estimate,
            })
    return out


def game_labels(games: list[dict]) -> list[dict]:
    palette = ["1D76DB", "0E8A16", "5319E7", "D93F0B", "FBCA04", "006B75"]
    return [
        {"name": f"game:{g['id']}", "color": palette[i % len(palette)],
         "description": f"{g['name']} ({g['genre']})"}
        for i, g in enumerate(games)
    ]


# ---------------------------------------------------------------- creation

def ensure_labels(repo: str, labels: list[dict], dry: bool) -> None:
    existing: set[str] = set()
    if not dry:
        raw = gh(["label", "list", "--repo", repo, "--limit", "500", "--json", "name"],
                 check=False)
        existing = {l["name"] for l in (json.loads(raw) if raw else [])}
    for l in labels:
        if l["name"] in existing:
            continue
        if dry:
            print(f"  [label] {l['name']}")
            continue
        gh(["label", "create", l["name"], "--repo", repo,
            "--color", l["color"], "--description", l.get("description", "")],
           check=False)


def ensure_milestones(repo: str, milestones: list[dict], dry: bool) -> None:
    existing: set[str] = set()
    if not dry:
        raw = gh(["api", f"repos/{repo}/milestones?state=all&per_page=100"], check=False)
        existing = {m["title"] for m in (json.loads(raw) if raw else [])}
    for m in milestones:
        if m["name"] in existing:
            continue
        if dry:
            print(f"  [milestone] {m['name']}")
            continue
        gh(["api", f"repos/{repo}/milestones", "-X", "POST",
            "-f", f"title={m['name']}", "-f", f"description={m['description']}"],
           check=False)


def existing_titles(repo: str) -> set[str]:
    raw = gh(["issue", "list", "--repo", repo, "--state", "all",
              "--limit", "2000", "--json", "title"], check=False)
    return {i["title"] for i in (json.loads(raw) if raw else [])}


def create_issue(repo: str, issue: dict, dry: bool,
                 project: str | None = None, project_owner: str | None = None) -> None:
    body = issue["body"]
    if issue.get("estimate") and "estimate" not in body:
        body += f"\n\n---\nEstimate: {issue['estimate']} points"
    args = ["issue", "create", "--repo", repo,
            "--title", issue["title"], "--body", body]
    for l in issue.get("labels", []):
        args += ["--label", l]
    if issue.get("milestone"):
        args += ["--milestone", issue["milestone"]]
    if dry:
        print(f"  [issue] {issue['title']}")
        return
    for attempt in range(3):
        try:
            url = gh(args)
            print(f"  created {url}")
            if project and project_owner:
                gh(["project", "item-add", project, "--owner", project_owner,
                    "--url", url], check=False)
            return
        except RuntimeError as e:
            if attempt == 2:
                print(f"  FAILED {issue['title']}: {e}", file=sys.stderr)
            else:
                time.sleep(2 ** attempt)


# ---------------------------------------------------------------- main

def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True, help="owner/name")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--only", choices=["platform", "games", "all"], default="all")
    p.add_argument("--milestone", help="only seed issues in this milestone")
    p.add_argument("--limit", type=int, help="stop after N issues (for testing)")
    p.add_argument("--project", help="project number to add created issues to")
    p.add_argument("--project-owner", help="org/user owning the project (default: repo owner)")
    args = p.parse_args()

    if not args.dry_run:
        ensure_gh_ready(args.repo)

    project_owner = args.project_owner or args.repo.split("/")[0]

    platform = load(DATA / "issues.yaml")
    games = load(DATA / "games.yaml")["games"]
    templates = load(DATA / "game_issue_templates.yaml")["templates"]

    all_labels = platform["labels"] + game_labels(games)
    print(f"Labels: {len(all_labels)}  Milestones: {len(platform['milestones'])}")
    ensure_labels(args.repo, all_labels, args.dry_run)
    ensure_milestones(args.repo, platform["milestones"], args.dry_run)

    issues: list[dict] = []
    if args.only in ("platform", "all"):
        issues += platform["issues"]
    if args.only in ("games", "all"):
        issues += expand_game_issues(games, templates)

    if args.milestone:
        issues = [i for i in issues if i.get("milestone") == args.milestone]

    seen = set() if args.dry_run else existing_titles(args.repo)
    todo = [i for i in issues if i["title"] not in seen]
    if args.limit:
        todo = todo[: args.limit]

    total_pts = sum(i.get("estimate", 0) for i in todo)
    print(f"\n{len(issues)} defined · {len(issues) - len(todo)} already exist · "
          f"{len(todo)} to create · {total_pts} points\n")

    for i, issue in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}]", end=" ")
        create_issue(args.repo, issue, args.dry_run,
                     project=args.project, project_owner=project_owner)
        if not args.dry_run:
            time.sleep(0.7)  # stay under the secondary rate limit

    print("\nDone." if not args.dry_run else "\nDry run complete. Drop --dry-run to create.")


if __name__ == "__main__":
    main()
