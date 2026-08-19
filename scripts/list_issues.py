#!/usr/bin/env python3
"""
Produce a complete listing of the repo's issues, grouped for reading.

    python scripts/list_issues.py --repo owner/name --format md  > BACKLOG.md
    python scripts/list_issues.py --repo owner/name --format html > backlog.html
    python scripts/list_issues.py --repo owner/name --format text
"""
from __future__ import annotations

import argparse
import html
import json
import subprocess
import sys
from collections import defaultdict

EPIC_TITLES = {
    "epic:setup": "Repo, tooling and CI",
    "epic:design": "Design system",
    "epic:site": "Website shell and routes",
    "epic:3d": "3D landing experience",
    "epic:engine": "Game engine core",
    "epic:input": "Two-player input system",
    "epic:sdk": "Game SDK and match flow",
    "epic:game": "Individual games",
    "epic:meta": "Tournament and progression",
    "epic:audio": "Audio",
    "epic:a11y": "Accessibility",
    "epic:perf": "Performance",
    "epic:pwa": "Offline and installability",
    "epic:seo": "Discovery and SEO",
    "epic:backend": "Backend and data",
    "epic:analytics": "Analytics",
    "epic:legal": "Legal and compliance",
    "epic:i18n": "Internationalisation",
    "epic:qa": "Testing and QA",
    "epic:online": "Online multiplayer",
    "epic:docs": "Documentation",
}
MILESTONE_ORDER = ["M0 Foundation", "M1 Playable Shell", "M2 Game Catalog",
                   "M3 Premium Site", "M4 Online", "(none)"]


def gh(args: list[str]) -> str:
    p = subprocess.run(["gh", *args], capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit(p.stderr.strip())
    return p.stdout


def fetch(repo: str) -> list[dict]:
    raw = gh(["issue", "list", "--repo", repo, "--state", "all", "--limit", "5000",
              "--json", "number,title,labels,milestone,state,url"])
    return json.loads(raw or "[]")


def classify(issue: dict) -> tuple[str, str]:
    names = [l["name"] for l in issue["labels"]]
    game = next((n for n in names if n.startswith("game:")), None)
    epic = next((n for n in names if n.startswith("epic:") and n != "epic:game"), None)
    if game and not epic:
        epic = "epic:game"
    return epic or "(unlabelled)", game or ""


def meta(issue: dict) -> str:
    names = [l["name"] for l in issue["labels"]]
    bits = [n for n in names if n.startswith(("priority:", "size:", "type:"))]
    return " ".join(sorted(bits))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--format", choices=["md", "html", "text"], default="md")
    ap.add_argument("--state", choices=["open", "all"], default="all")
    args = ap.parse_args()

    issues = fetch(args.repo)
    if args.state == "open":
        issues = [i for i in issues if i["state"].lower() == "open"]

    by_epic: dict[str, list[dict]] = defaultdict(list)
    by_game: dict[str, list[dict]] = defaultdict(list)
    by_ms: dict[str, int] = defaultdict(int)

    for i in issues:
        epic, game = classify(i)
        by_ms[(i.get("milestone") or {}).get("title") or "(none)"] += 1
        if game:
            by_game[game].append(i)
        else:
            by_epic[epic].append(i)

    total = len(issues)
    ms_lines = [(m, by_ms.get(m, 0)) for m in MILESTONE_ORDER if by_ms.get(m)]

    out: list[str] = []
    if args.format in ("md", "text"):
        out.append(f"# DuelBox backlog — {total} issues\n")
        out.append("## Issues per milestone\n")
        for m, c in ms_lines:
            out.append(f"- **{m}** — {c}")
        out.append("\n## Platform and website issues\n")
        for epic in EPIC_TITLES:
            items = by_epic.get(epic)
            if not items:
                continue
            out.append(f"\n### {EPIC_TITLES[epic]} ({len(items)})\n")
            for i in sorted(items, key=lambda x: x["number"]):
                out.append(f"- #{i['number']} {i['title']}  \n  `{meta(i)}`")
        out.append(f"\n## Per-game issues ({sum(len(v) for v in by_game.values())} "
                   f"across {len(by_game)} games)\n")
        for game in sorted(by_game):
            items = sorted(by_game[game], key=lambda x: x["number"])
            name = game.split(":", 1)[1]
            out.append(f"\n### {name} ({len(items)})\n")
            for i in items:
                out.append(f"- #{i['number']} {i['title']}")
        print("\n".join(out))
        return

    # html
    def esc(s: str) -> str:
        return html.escape(s)

    rows = []
    for epic in EPIC_TITLES:
        items = by_epic.get(epic)
        if not items:
            continue
        lis = "".join(
            f"<li><a href='{i['url']}'>#{i['number']}</a> {esc(i['title'])}"
            f"<span class='m'>{esc(meta(i))}</span></li>"
            for i in sorted(items, key=lambda x: x["number"]))
        rows.append(f"<section><h3>{esc(EPIC_TITLES[epic])} "
                    f"<span class='c'>{len(items)}</span></h3><ul>{lis}</ul></section>")
    game_rows = []
    for game in sorted(by_game):
        items = sorted(by_game[game], key=lambda x: x["number"])
        lis = "".join(f"<li><a href='{i['url']}'>#{i['number']}</a> {esc(i['title'])}</li>"
                      for i in items)
        game_rows.append(f"<section><h3>{esc(game.split(':',1)[1])} "
                         f"<span class='c'>{len(items)}</span></h3><ul>{lis}</ul></section>")

    print(f"""<title>DuelBox Backlog</title>
<style>
:root{{--bg:#fff;--fg:#14161c;--dim:#5b6070;--line:#e3e6ee;--accent:#c0304f}}
:root:not([data-theme=light]) {{ }}
@media (prefers-color-scheme:dark){{:root:not([data-theme=light]){{--bg:#0d0f14;--fg:#e8eaf0;--dim:#9298ab;--line:#242835;--accent:#ff6b89}}}}
:root[data-theme=dark]{{--bg:#0d0f14;--fg:#e8eaf0;--dim:#9298ab;--line:#242835;--accent:#ff6b89}}
body{{background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,sans-serif;margin:0;padding:2rem 1.25rem;max-width:60rem;margin-inline:auto}}
h1{{font-size:1.9rem;margin:0 0 .3rem}}h3{{font-size:1.05rem;margin:1.6rem 0 .5rem;border-bottom:1px solid var(--line);padding-bottom:.3rem}}
ul{{list-style:none;padding:0;margin:0}}li{{padding:.22rem 0;border-bottom:1px solid var(--line)}}
a{{color:var(--accent);text-decoration:none;font-variant-numeric:tabular-nums}}a:hover{{text-decoration:underline}}
.m{{color:var(--dim);font-size:.78rem;margin-left:.5rem}}.c{{color:var(--dim);font-weight:400;font-size:.85rem}}
.sum{{color:var(--dim);margin-bottom:1.5rem}}
</style>
<h1>DuelBox backlog</h1>
<p class='sum'>{total} issues · {" · ".join(f"{m} {c}" for m, c in ms_lines)}</p>
<h2>Platform and website</h2>{"".join(rows)}
<h2>Per-game</h2>{"".join(game_rows)}""")


if __name__ == "__main__":
    main()
