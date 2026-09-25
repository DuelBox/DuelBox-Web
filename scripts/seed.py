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

# Pace of issue creation. GitHub caps content creation at roughly 500 requests
# per hour; a steady 8s gap stays just under that and never trips the secondary
# limit, which is far faster overall than bursting and then backing off for
# fifteen minutes at a time.
DELAY = 8.0
BACKOFF_START = 120


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
        # This branch used to test `confidence == "research"`, a value no row in
        # catalog.yaml has ever held - only `observed` and `original` are in use - so the
        # caveat it exists to print had never once been printed (#2514). The condition that
        # is really true is on disk: no game has a RESEARCH.md, so every seeded issue should
        # say so rather than none of them.
        observed = game.get("confidence") == "observed"
        if observed and not (ROOT / "packages" / "games" / gid / "RESEARCH.md").exists():
            note += ("\n\n> No RESEARCH.md exists for this game, so its in-play mechanics "
                     "are unconfirmed: what was observed of the reference app is its "
                     "pre-game screen, not a match. See `docs/research-status.md`.")

        if game.get("rule"):
            # What this sentence may claim is bounded by what was actually done. The rule text
            # is transcribed verbatim from the reference app's pre-game screen during the
            # emulator sweep in docs/observed-rules.md - it is one sentence read off a screen,
            # not a record of play - and for a `confidence: original` game there is no
            # reference app at all. The previous wording, "Recorded by playing the reference
            # game", claimed both, on every game, including the one we invented.
            if observed:
                provenance = ("Transcribed verbatim from the reference app's pre-game screen "
                              "(`docs/observed-rules.md`). It is the rule statement the app "
                              "shows before a match, not a record of playing one. The mechanics "
                              "are reimplemented from scratch; our copy, art, and layout are "
                              "original.")
            else:
                provenance = ("Ours. This game has no counterpart in the reference app "
                              "(`confidence: original`), so there is nothing to observe and no "
                              "research issue for it.")
            note += f"\n\n**Rules**\n\n{game['rule']}\n\n{provenance}"

        if game.get("modes"):
            pretty = {"friend": "vs Friend", "bot": "vs Bot", "solo": "Solo"}
            modes = ", ".join(pretty.get(m, m) for m in game["modes"].split(","))
            label = "Play modes observed" if observed else "Play modes"
            note += f"\n\n**{label}:** {modes}"
            if game.get("modesNote"):
                note += f"\n\n> Mode note: {game['modesNote']}"

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
            # A `confidence: original` game is ours; there is no reference app entry to play,
            # so a research issue on it could never be satisfied by the only method CLAUDE.md
            # rule 2 permits. GitHub agrees with this by accident rather than by rule - the 107
            # open research issues are exactly the 107 `observed` games, because `cricket` was
            # added after the last seeding run and has never been seeded at all. Without this
            # line the next run would give it an unsatisfiable one (#2514).
            if t["key"] == "research" and not observed:
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
        page = 1
        while True:
            raw = gh(["api", f"repos/{repo}/labels?per_page=100&page={page}"], check=False)
            try:
                batch = json.loads(raw) if raw else []
            except json.JSONDecodeError:
                break
            if not batch:
                break
            existing.update(l["name"] for l in batch)
            if len(batch) < 100:
                break
            page += 1
    created = 0
    for l in labels:
        if l["name"] in existing:
            continue
        if dry:
            continue
        gh(["api", "-X", "POST", f"repos/{repo}/labels",
            "-f", f"name={l['name']}", "-f", f"color={l['color']}",
            "-f", f"description={l.get('description', '')}"], check=False)
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
    """List every existing title over REST so the core budget is used, not GraphQL."""
    titles: set[str] = set()
    page = 1
    while True:
        raw = gh(["api", f"repos/{repo}/issues?state=all&per_page=100&page={page}"], check=False)
        try:
            batch = json.loads(raw) if raw else []
        except json.JSONDecodeError:
            break
        if not batch:
            break
        titles.update(i["title"] for i in batch if "pull_request" not in i)
        if len(batch) < 100:
            break
        page += 1
    return titles


def game_labels(catalog: dict) -> list[dict]:
    palette = ["1D76DB", "0E8A16", "5319E7", "D93F0B", "FBCA04", "006B75", "B60205", "C2E0C6"]
    return [{"name": f"game:{g['id']}", "color": palette[i % len(palette)],
             "description": f"{g['name']} ({g.get('category')})"}
            for i, g in enumerate(catalog["games"])]


def milestone_numbers(repo: str) -> dict[str, int]:
    raw = gh(["api", f"repos/{repo}/milestones?state=all&per_page=100"], check=False)
    return {m["title"]: m["number"] for m in (json.loads(raw) if raw else [])}


def wait_for_reset(repo: str, resource: str = "core") -> None:
    """Sleep until the named rate-limit bucket refills."""
    try:
        raw = gh(["api", "rate_limit"], check=False)
        data = json.loads(raw)["resources"][resource]
        wait = max(0, data["reset"] - int(time.time())) + 15
    except Exception:
        wait = 300
    print(f"    {resource} rate limit exhausted, sleeping {wait}s", flush=True)
    time.sleep(wait)


def create_issue(repo: str, issue: dict, ms_map: dict[str, int],
                 project: str | None = None, owner: str = "") -> str | None:
    """Create via the REST API, which draws on the core budget rather than GraphQL.

    `gh issue create` goes through GraphQL, whose points budget is consumed far
    faster; REST gives us a clean 5000/hour for the same work.
    """
    args = ["api", "-X", "POST", f"repos/{repo}/issues",
            "-f", f"title={issue['title']}", "-f", f"body={issue['body']}"]
    for l in issue.get("labels", []):
        args += ["-f", f"labels[]={l}"]
    ms = ms_map.get(issue.get("milestone") or "")
    if ms:
        args += ["-F", f"milestone={ms}"]

    backoff = BACKOFF_START
    attempt = 0
    while True:
        try:
            out = gh(args)
            data = json.loads(out) if out else {}
            url = data.get("html_url")
            if project and url:
                gh(["project", "item-add", project, "--owner", owner, "--url", url], check=False)
            return url
        except RuntimeError as e:
            msg = str(e).lower()
            # Rate limits are not failures - they are waits. They must never
            # consume the retry budget, or an unattended run gives up on every
            # remaining issue the moment the hourly cap is reached.
            if "rate limit already exceeded" in msg or "rate limit exceeded" in msg:
                wait_for_reset(repo, "core")
                continue
            if "secondary rate limit" in msg or "abuse" in msg or "submitted too quickly" in msg:
                print(f"    content-creation cap reached, sleeping {backoff}s", flush=True)
                time.sleep(backoff)
                backoff = min(backoff * 2, 600)
                continue
            attempt += 1
            if attempt >= 4:
                print(f"    FAILED: {issue['title']}: {e}", file=sys.stderr, flush=True)
                return None
            time.sleep(5)


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

    ms_map = milestone_numbers(args.repo)
    made = 0
    for n, issue in enumerate(todo, 1):
        url = create_issue(args.repo, issue, ms_map, args.project, owner)
        if url:
            made += 1
        if n % 25 == 0 or n == len(todo):
            print(f"  [{n}/{len(todo)}] created {made}", flush=True)
        time.sleep(DELAY)

    print(f"\nDone. {made} issues created.")


if __name__ == "__main__":
    main()
