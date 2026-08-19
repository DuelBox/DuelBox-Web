#!/usr/bin/env python3
"""
Build the DuelBox backlog report as a self-contained HTML page.

    python scripts/build_report.py --repo owner/name --out /tmp/duelbox.html
"""
from __future__ import annotations

import argparse
import html
import json
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent

EPICS = [
    ("epic:setup", "Repo, tooling and CI"),
    ("epic:design", "Design system"),
    ("epic:site", "Website shell and routes"),
    ("epic:3d", "3D landing experience"),
    ("epic:engine", "Game engine core"),
    ("epic:input", "Two-player input"),
    ("epic:sdk", "Game SDK and match flow"),
    ("epic:meta", "Tournament and progression"),
    ("epic:audio", "Audio"),
    ("epic:a11y", "Accessibility"),
    ("epic:perf", "Performance"),
    ("epic:pwa", "Offline and installability"),
    ("epic:seo", "Discovery and SEO"),
    ("epic:backend", "Backend and data"),
    ("epic:analytics", "Analytics"),
    ("epic:legal", "Legal and compliance"),
    ("epic:i18n", "Internationalisation"),
    ("epic:qa", "Testing and QA"),
    ("epic:online", "Online multiplayer"),
    ("epic:docs", "Documentation"),
]
MS_ORDER = ["M0 Foundation", "M1 Playable Shell", "M2 Game Catalog",
            "M3 Premium Site", "M4 Online"]


def gh(args: list[str]) -> str:
    p = subprocess.run(["gh", *args], capture_output=True, text=True)
    if p.returncode != 0:
        sys.exit(p.stderr.strip())
    return p.stdout


def fetch(repo: str) -> list[dict]:
    out, page = [], 1
    while True:
        raw = gh(["api", f"repos/{repo}/issues?state=all&per_page=100&page={page}"])
        batch = json.loads(raw or "[]")
        if not batch:
            break
        out += [i for i in batch if "pull_request" not in i]
        if len(batch) < 100:
            break
        page += 1
    return out


e = html.escape


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    issues = fetch(args.repo)
    catalog = yaml.safe_load((ROOT / "data" / "catalog.yaml").read_text())
    games = catalog["games"]
    gmap = {g["id"]: g for g in games}

    legacy = [i for i in issues if any(l["name"] == "legacy-backlog" for l in i["labels"])]
    live = [i for i in issues if i not in legacy]

    by_epic: dict[str, list] = defaultdict(list)
    by_game: dict[str, list] = defaultdict(list)
    ms_count: Counter = Counter()
    for i in live:
        names = [l["name"] for l in i["labels"]]
        ms_count[(i.get("milestone") or {}).get("title") or "—"] += 1
        gid = next((n.split(":", 1)[1] for n in names if n.startswith("game:")), None)
        if gid:
            by_game[gid].append(i)
        else:
            ep = next((n for n in names if n.startswith("epic:")), "epic:docs")
            by_epic[ep].append(i)

    arche = Counter(g.get("archetype") for g in games)
    modes = Counter()
    for g in games:
        for m in (g.get("modes") or "").split(","):
            if m:
                modes[m] += 1

    def meta_bits(i):
        ns = [l["name"] for l in i["labels"]]
        pr = next((n.split(":")[1] for n in ns if n.startswith("priority:")), "")
        sz = next((n.split(":")[1] for n in ns if n.startswith("size:")), "")
        return pr, sz

    # ---------- sections ----------
    plat_html = []
    for key, title in EPICS:
        items = sorted(by_epic.get(key, []), key=lambda x: x["number"])
        if not items:
            continue
        rows = "".join(
            f"<li><a href='{i['html_url']}'>#{i['number']}</a>"
            f"<span class='t'>{e(i['title'])}</span>"
            f"<span class='tags'>{''.join(f'<b class=p{p}>{p}</b>' if p else '' for p in [meta_bits(i)[0]])}"
            f"{f'<i>{meta_bits(i)[1]}</i>' if meta_bits(i)[1] else ''}</span></li>"
            for i in items)
        plat_html.append(
            f"<details open><summary>{e(title)}<span class='n'>{len(items)}</span></summary>"
            f"<ul class='issues'>{rows}</ul></details>")

    game_html = []
    for gid in sorted(by_game, key=lambda g: gmap.get(g, {}).get("name", g)):
        items = sorted(by_game[gid], key=lambda x: x["number"])
        g = gmap.get(gid, {})
        rule = g.get("rule", "")
        ref = g.get("refName") or g.get("was") or ""
        mds = (g.get("modes") or "").replace(",", " · ")
        rows = "".join(
            f"<li><a href='{i['html_url']}'>#{i['number']}</a>"
            f"<span class='t'>{e(i['title'].split('] ', 1)[-1])}</span></li>"
            for i in items)
        game_html.append(
            f"<details><summary>{e(g.get('name', gid))}"
            f"<span class='arch'>{e(g.get('archetype',''))}</span>"
            f"<span class='n'>{len(items)}</span></summary>"
            f"<div class='gmeta'>"
            + (f"<p class='rule'>{e(rule)}</p>" if rule else "")
            + f"<p class='sub'>{'in the reference app: ' + e(ref) + ' · ' if ref else ''}"
              f"modes: {e(mds) or '—'}</p></div>"
            f"<ul class='issues'>{rows}</ul></details>")

    ms_rows = "".join(
        f"<tr><td>{e(m)}</td><td class='num'>{ms_count.get(m,0)}</td></tr>"
        for m in MS_ORDER if ms_count.get(m))

    arch_rows = "".join(
        f"<tr><td><code>{e(a)}</code></td><td class='num'>{n}</td></tr>"
        for a, n in arche.most_common())

    total_game_issues = sum(len(v) for v in by_game.values())
    total_plat = sum(len(v) for v in by_epic.values())

    page = f"""<title>DuelBox Build Plan</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Instrument+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{{
  --ink:#101420; --ground:#f6f7fb; --panel:#ffffff; --line:#e0e4ee;
  --fg:#171c28; --dim:#5d6479; --faint:#8b91a4;
  --p1:#e5405e; --p2:#0f9fb5; --gold:#b8860b;
  --shadow:0 1px 2px rgba(16,20,32,.06),0 8px 24px -12px rgba(16,20,32,.18);
}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{
  --ink:#e9ecf5; --ground:#0b0e17; --panel:#141926; --line:#242c3d;
  --fg:#e9ecf5; --dim:#98a0b6; --faint:#6c748c;
  --p1:#ff6b84; --p2:#39c9dd; --gold:#e3b341;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.6);
}}}}
:root[data-theme="dark"]{{
  --ink:#e9ecf5; --ground:#0b0e17; --panel:#141926; --line:#242c3d;
  --fg:#e9ecf5; --dim:#98a0b6; --faint:#6c748c;
  --p1:#ff6b84; --p2:#39c9dd; --gold:#e3b341;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -12px rgba(0,0,0,.6);
}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--ground);color:var(--fg);
  font:16px/1.6 "Instrument Sans",ui-sans-serif,system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}}
.wrap{{max-width:74rem;margin:0 auto;padding:0 1.5rem 6rem}}
h1,h2,h3,summary{{font-family:"Bricolage Grotesque","Instrument Sans",sans-serif;
  text-wrap:balance;letter-spacing:-.015em}}
/* hero: the seat split the research is about */
.hero{{position:relative;margin:0 -1.5rem 3.5rem;padding:5rem 1.5rem 3.5rem;overflow:hidden;
  background:linear-gradient(105deg,color-mix(in oklab,var(--p1) 12%,var(--ground)) 0%,
    color-mix(in oklab,var(--p1) 12%,var(--ground)) 47%,
    color-mix(in oklab,var(--p2) 12%,var(--ground)) 53%,
    color-mix(in oklab,var(--p2) 12%,var(--ground)) 100%);
  border-bottom:1px solid var(--line)}}
.hero .seam{{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(105deg,transparent 49.6%,var(--line) 49.6%,var(--line) 50.4%,transparent 50.4%)}}
.hero-in{{position:relative;max-width:74rem;margin:0 auto}}
.eyebrow{{font:600 .75rem/1 "JetBrains Mono",monospace;letter-spacing:.14em;
  text-transform:uppercase;color:var(--dim);margin:0 0 1rem}}
h1{{font-size:clamp(2.4rem,6vw,4rem);font-weight:800;margin:0 0 .75rem;line-height:1.02}}
h1 .a{{color:var(--p1)}} h1 .b{{color:var(--p2)}}
.lede{{font-size:1.15rem;color:var(--dim);max-width:44rem;margin:0 0 2rem}}
.stats{{display:flex;flex-wrap:wrap;gap:2.5rem;margin-top:2rem}}
.stat b{{display:block;font:600 2.1rem/1 "JetBrains Mono",monospace;
  font-variant-numeric:tabular-nums;color:var(--fg)}}
.stat span{{font-size:.8rem;color:var(--dim);text-transform:uppercase;letter-spacing:.08em}}
h2{{font-size:1.6rem;font-weight:700;margin:3.5rem 0 .4rem}}
h2+.sub{{margin-top:0}}
.sub{{color:var(--dim);margin:0 0 1.25rem;max-width:52rem}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1rem;margin:1.5rem 0}}
.card{{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:1.1rem 1.25rem;
  box-shadow:var(--shadow)}}
.card h3{{margin:0 0 .35rem;font-size:.95rem;font-weight:700}}
.card p{{margin:0;color:var(--dim);font-size:.9rem}}
table{{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);
  border-radius:10px;overflow:hidden;box-shadow:var(--shadow)}}
td,th{{padding:.6rem .9rem;border-bottom:1px solid var(--line);text-align:left;font-size:.92rem}}
tr:last-child td{{border-bottom:0}}
th{{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);font-weight:600}}
.num{{font-family:"JetBrains Mono",monospace;font-variant-numeric:tabular-nums;text-align:right;width:6rem}}
.cols{{display:grid;grid-template-columns:repeat(auto-fit,minmax(19rem,1fr));gap:1.25rem;align-items:start}}
details{{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin:0 0 .6rem;
  box-shadow:var(--shadow);overflow:hidden}}
summary{{cursor:pointer;padding:.8rem 1rem;font-weight:700;font-size:1rem;display:flex;
  align-items:center;gap:.6rem;list-style:none}}
summary::-webkit-details-marker{{display:none}}
summary::before{{content:"›";color:var(--faint);font-size:1.2rem;transition:transform .15s}}
details[open]>summary::before{{transform:rotate(90deg)}}
summary:focus-visible{{outline:2px solid var(--p2);outline-offset:-2px}}
.n{{margin-left:auto;font:600 .78rem/1 "JetBrains Mono",monospace;color:var(--dim);
  background:var(--ground);border:1px solid var(--line);border-radius:99px;padding:.25rem .55rem}}
.arch{{font:400 .7rem/1 "JetBrains Mono",monospace;color:var(--faint);
  border:1px solid var(--line);border-radius:4px;padding:.2rem .4rem}}
.gmeta{{padding:0 1rem .4rem 2.2rem;border-top:1px solid var(--line);padding-top:.8rem}}
.rule{{margin:0 0 .4rem;font-size:.92rem;color:var(--fg)}}
.gmeta .sub{{margin:0;font-size:.8rem}}
ul.issues{{list-style:none;margin:0;padding:.3rem 0 .6rem}}
ul.issues li{{display:flex;gap:.7rem;align-items:baseline;padding:.32rem 1rem .32rem 2.2rem;
  border-top:1px solid color-mix(in oklab,var(--line) 55%,transparent);font-size:.9rem}}
ul.issues li:first-child{{border-top:0}}
ul.issues a{{font:600 .8rem/1.5 "JetBrains Mono",monospace;color:var(--p2);
  text-decoration:none;flex:none;min-width:3.6rem;font-variant-numeric:tabular-nums}}
ul.issues a:hover{{text-decoration:underline}}
.t{{flex:1}}
.tags{{display:flex;gap:.35rem;flex:none}}
.tags b,.tags i{{font:600 .66rem/1 "JetBrains Mono",monospace;border-radius:4px;padding:.22rem .38rem;
  font-style:normal;border:1px solid var(--line);color:var(--dim)}}
.tags b.pP0{{color:var(--p1);border-color:color-mix(in oklab,var(--p1) 45%,var(--line))}}
.tags b.pP1{{color:var(--gold);border-color:color-mix(in oklab,var(--gold) 45%,var(--line))}}
.note{{border-left:3px solid var(--p1);background:var(--panel);border-radius:0 8px 8px 0;
  padding:.9rem 1.1rem;margin:1.25rem 0;color:var(--dim);font-size:.92rem}}
.note b{{color:var(--fg)}}
footer{{margin-top:4rem;padding-top:1.5rem;border-top:1px solid var(--line);
  color:var(--faint);font-size:.85rem}}
code{{font-family:"JetBrains Mono",monospace;font-size:.85em}}
@media (prefers-reduced-motion:reduce){{*{{transition:none!important}}}}
</style>

<header class="hero">
  <div class="seam"></div>
  <div class="hero-in">
    <p class="eyebrow">Build plan · {len(games)} games · {len(live)} issues</p>
    <h1><span class="a">Two players.</span><br><span class="b">One screen.</span></h1>
    <p class="lede">A browser collection of two-player mini-games, planned from playing the
      reference Android app rather than guessing at it. Every game's rules were transcribed
      from the app itself; every issue below traces back to something observed.</p>
    <div class="stats">
      <div class="stat"><b>{len(games)}</b><span>Games catalogued</span></div>
      <div class="stat"><b>{len([g for g in games if g.get('rule')])}</b><span>Rules documented</span></div>
      <div class="stat"><b>{total_plat}</b><span>Platform issues</span></div>
      <div class="stat"><b>{total_game_issues}</b><span>Game issues</span></div>
    </div>
  </div>
</header>

<div class="wrap">

<h2>What the research changed</h2>
<p class="sub">Four findings from playing the app reshaped the architecture. Each one would
have been expensive to discover after the engine was written.</p>
<div class="grid">
  <div class="card"><h3>Seat rotation</h3><p>On a turn change the play area rotates 180°
    and recolours to the active player, so each person reads it upright. This belongs in the
    engine, not in {len(games)} separate games.</p></div>
  <div class="card"><h3>Three play modes</h3><p>vs Friend ({modes['friend']}),
    vs Bot ({modes['bot']}), Solo ({modes['solo']}). Not every game has all three, so the
    manifest declares them or the lobby shows dead buttons.</p></div>
  <div class="card"><h3>Four win conditions</h3><p>First to N, lead by two, reduce health to
    zero, and highest accumulated score. A shared helper covers all four; per-game
    comparisons would drift.</p></div>
  <div class="card"><h3>Touch ownership</h3><p>A touch belongs to the seat it
    <em>started</em> in and keeps it across the midline. Get this wrong and every touch game
    is subtly broken.</p></div>
</div>

<div class="note"><b>Research boundary.</b> The app renders its text to canvas, so nothing was
readable through the accessibility tree — every rule below was transcribed by looking at the
screen while playing. No APK was unpacked, decompiled, or read. Mechanics and rules are not
protected; the art, audio, copy, and layout on our side are original.</div>

<div class="cols">
  <div>
    <h2>Milestones</h2>
    <table><tr><th>Milestone</th><th class="num">Issues</th></tr>{ms_rows}</table>
  </div>
  <div>
    <h2>Archetypes</h2>
    <p class="sub">Build one game per archetype first; the rest of each group are variations
      on a solved problem.</p>
    <table><tr><th>Archetype</th><th class="num">Games</th></tr>{arch_rows}</table>
  </div>
</div>

<h2>Platform and website backlog</h2>
<p class="sub">{total_plat} issues covering the site itself — the shell, the engine, the
input system, and everything a games portal needs to launch.</p>
{''.join(plat_html)}

<h2>Per-game backlog</h2>
<p class="sub">{total_game_issues} issues across {len(by_game)} games. Each game gets a parent
epic plus research, spec, scaffold, rules, input, simulation, scoring, rendering, layout,
match flow, bot, assets, tests, and a QA pass. Expand a game to see its rules as the
reference app states them.</p>
{''.join(game_html)}

<footer>
  Generated from <code>{e(args.repo)}</code>. {len(legacy)} earlier issues from the first
  generic plan are labelled <code>legacy-backlog</code> and excluded from these counts.
</footer>
</div>"""

    Path(args.out).write_text(page)
    print(f"wrote {args.out}: {len(live)} issues, {len(games)} games, "
          f"{total_plat} platform, {total_game_issues} game")


if __name__ == "__main__":
    main()
