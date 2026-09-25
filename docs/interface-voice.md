# Interface voice

This is not an invented voice. It is a description of the one the product already has,
measured across every player-facing string in the repository, plus the places where it is
not being kept.

The shipped copy is in three bodies, and they do not currently agree:

| Body | Size | Where it shows |
|---|---|---|
| Shell UI — `apps/web/src/app/**` and `apps/web/src/components/**` | ~130 strings | Every screen |
| Manifest `controls` strings — `packages/games/*/src/manifest.ts` | **214 strings**, 107 games × keyboard + pointer | The controls panel, before a match and from the pause menu |
| Catalogue `rule` strings — `data/catalog.yaml` | 107 strings | Each game page's paragraph, **and each page's `<meta description>`** |

The first two share one voice and keep it well. The third is scraped prose that never went
through anybody, and it is the body a search engine and a first-time visitor read first.
Most of the work this document asks for is there.

---

## The voice, in three adjectives

### Plain

No decoration, no volume, no apology.

Counted across the shell and all 214 manifest controls strings: **zero exclamation marks,
zero occurrences of "Oops", "Whoops", "Sorry" or "Something went wrong".** Errors are
declarative sentences — `This game is not playable yet`, `Copy failed`, `Game not found`.
Nothing is ever "just" or "simply" anything. That restraint is already the house style; it
does not need arguing for, it needs holding.

> **Is:** `This game is not playable yet. Its rules and controls are settled, but the build
> has not landed. Try another game.`
>
> **Is not:** `Oops! Something went wrong 😬 We're working on it!`

### Specific

Name the actual thing. Not "the piece" but "the near seat's ringed red snake". Not "your
device" but "your own half".

> **Is:** `Tap a die to keep it, tap Roll, then tap the box to spend the hand in`
>
> **Is not:** `Use the controls to play your turn`

> **Is:** `The board is exactly where you left it.` (the pause screen — it answers the
> question the player actually has)
>
> **Is not:** `Game paused`

The best line in the product is `Tap anywhere in your own half. Where you tap makes no
difference — only when.` It teaches the mechanic in nine words by naming what does *not*
matter. Aim there.

### Level

The same register whether you are winning, losing, or looking at a broken page. No
cheerleading, no consolation, no second-guessing.

The result screen says `Bo wins` or `A draw`, and stops. The countdown is `3 2 1 Go` with no
punctuation. The score line is `Pip 2 — 1 Bo · first to 2 takes it`. None of it is trying to
make you feel anything, which is why it survives being read forty times an evening by two
people who are already having the feeling.

> **Is:** `Pip 2 — 1 Bo · first to 2 takes it`
>
> **Is not:** `So close! Pip is leading 2-1 — can Bo fight back?!`

### What the three are for

Two strangers share one phone and read the same screen from opposite ends, sixty times in an
evening. Copy that is loud the first time is unbearable the twentieth. Copy that is vague
costs a turn while somebody works out whose half is whose. Level, plain and specific is not a
personality choice — it is what survives repetition at arm's length.

---

## Rules

### 1. No exclamation marks. None.

The shell and the manifests already manage this — 0 out of ~344 strings. The catalogue rules
manage it in 44 of 107, which means **63 of 107 game pages ship an exclamation mark**, 32 of
them two or more, and every one of those is also the page's meta description.

Shipping today: `Chess! Capture your opponent's king and keep yours alive!` ·
`Snowball fight! Pull back to aim. Release to throw. Hit your opponent. First to reduce their
opponent's health to zero wins!`

Rewrite target: `Capture your opponent's king and keep yours alive.` The exclamation mark was
adding nothing that the word "capture" was not.

### 2. Sentence case everywhere, including buttons.

All 29 rendered headings are sentence case; 0 are title case. Buttons are sentence case too,
with **one exception in the whole product**: `GameCard`'s `vs Bot`. Elsewhere "bot" is
lowercase in all six places it appears. Fix `vs Bot` to match, or drop it — the same component
already says `Two players` for the other mode.

`ALL CAPS` is not the voice. The design canvas proposes `SHARED SCREEN`, `NOW PLAYING`,
`NEEDS 4 TO WIN`; if that direction is adopted it is a deliberate change to this document,
not a per-screen decision.

### 3. Second person for what is yours; third person for the players.

Both are already in use and the split is coherent, so make it explicit:

- **Second person for ownership and instruction.** `your own half` (39 manifests), `your
  turn`, `your mallet`, `Tap the square you want`. This is the register of every controls
  string and every instruction.
- **Third person for the scoreboard.** `Bo wins`, `Pip has 3 points`, `Bo’s skill`. Two people
  are sharing one screen: "you win" is ambiguous by construction, because the screen cannot
  know which of them is reading it.

That second point is the reason, and it is worth stating because it looks like an
inconsistency until you see it. **Never write "You win" on a shared screen.** The design
canvas's `You` label for the local seat is only correct in single-seat presentation, and
single-seat is not shipped.

### 4. Name the seat by where the person sits, never by where the piece is.

`packages/games/snakes/src/manifest.ts` already argues this in a comment and it is the right
argument: both snakes roam the whole arena and have swapped sides within seconds of the
countdown, so "the left snake" is wrong within a second of being read. The seat does not move.

`apps/web/src/data/controls.test.ts` enforces a version of this — every keyboard string must
name a seat, and `left and right`, `left arrow` and `near key` do not count. It also refuses
`W A S D or the arrow keys`, because eighteen manifests said it and it tells a player what the
game *accepts* rather than what is *theirs*.

### 5. One word per concept.

Six concepts currently have between two and six words each. The right-hand column is the
decision this document makes; the point is less which word wins than that one does.

| Concept | In use today | Use |
|---|---|---|
| Where a person sits | seat (79), player (46), side (5), half (4), lane | **seat** in shell chrome; **your half** when talking about the play area a person controls |
| One contest | match (84), game (189), round (66) | **game** = a title in the catalogue. **match** = one sitting. **round** = one leg of a best-of |
| Bot strength | levels, strengths, tiers, skill, difficulty | **difficulty**, shown as `Easy` / `Normal` / `Hard` |
| Playing with someone present | friend, Two players, together | **Two players** in labels; `friend` stays an internal mode id |
| The collection | catalogue, catalog, All games, Games | **catalogue** in copy (British, matching `colour`); `catalog` stays in filenames that already exist |
| Not built yet | two different sentences | one string, imported by both surfaces |

The `Match over` / `Game over` split on the same screen — chosen by whether `rounds > 1` — is
the sharpest case. Under the table above it is **`Match over`** in both, because a single
round is still one sitting.

### 6. The same verb from action to confirmation.

Four differently-worded controls currently lead to the same route, `/games/`:

| Control | Where | Lands on |
|---|---|---|
| `Play now` | header CTA | `All games` |
| `Start playing` | landing hero | `All games` |
| `See all 107 →` | landing, below the tiles | `All games` |
| `How it works` | landing hero | a page headed `How to play` |

Three of those promise play and deliver a list. The last one changes both the verb and the
noun between the button and the heading, while the header nav calls the identical route `How
to play`.

**The rule: a control's label and its destination's heading share their verb, or the control
names the destination.** `How it works` → `How to play`. `Play now` and `Start playing` → one
of them, and since the destination is a catalogue, `Browse games` is the honest label for at
least the two navigational ones. The landing page's own closing line already gets this right:
`Browse all games and pick one.`

`Quit match` returns you to the pre-match screen, which is where `Play` starts — so `Quit
match` is also arguably `Leave match`. Lower priority; it is at least not lying.

### 7. British spelling.

`colour`, `catalogue`, `greyscale`, `recognise`, `towards` — the shell and the manifests are
consistent. The catalogue rules are not: **8 use American `color` against 1 using `colour`**,
and they render beside a shell that spells it `colour` and a game literally named `Colour
Wars`.

### 8. Punctuation

- **Em dash, unspaced**, for a parenthetical or a turn in the sentence: `there is nothing to
  fire`, `— you cannot stop`. Already the habit in 25 of 107 keyboard strings.
- **But not for scores.** `Pip 2 — 1 Bo` uses an em dash as a score separator in a product
  that also uses em dash as a dash. Use an en dash with spaces for scores, `Pip 2 – 1 Bo`, or
  a colon. One glyph, one job.
- **Middot `·`** joins peer items: `No download · No account · Works offline`. Not for
  clauses.
- **Curly apostrophes** in prose (`Bo’s skill`). Six manifests are split 3–3 between curly and
  straight; make them all curly.
- **Terminal full stops in controls strings**: 13 of 107 keyboard strings end in one, 13 of
  107 pointer strings do. Pick none — they are labels, not sentences — and be consistent.
- **One ellipsis exists** in the entire product (`Loading …`) and it is the correct character.
  Keep it that way.

### 9. Numbers

- `107` as a numeral. The one place it is spelled out — the layout's meta description, `A
  hundred and seven games for two people` — should be a numeral too.
- Times: **one function.** There are two `formatRound` implementations that disagree.
  `apps/web/src/lib/format.ts` renders `about 2 minutes`; `GameCard.tsx` has a private
  duplicate rendering `2 min`. A card says `2 min` and the page it links to says `about 2
  minutes` for the same number. Delete the duplicate and use `lib/format.ts`, `about` and all
  — the round length is a guide, not a contract.
- `1 round` beside `Best of 3` is deliberate and documented in `MatchOptions.tsx`: the
  spelled-out version wraps on a 412px phone. Keep it, and keep the comment.

---

## The core strings

The current string beside the one this guide asks for. Where they are the same, that is the
point — most of this product is already right.

### Navigation and entry

| Surface | Today | Guide |
|---|---|---|
| Header CTA | `Play now` | `Browse games` |
| Landing primary | `Start playing` | `Browse games` |
| Landing secondary | `How it works` | `How to play` |
| Landing, below tiles | `See all 107 →` | `See all 107 games` |
| Footer line | `DuelBox — 107 games for two players. Runs in your browser; nothing to install.` | keep |
| Skip link | `Skip to content` | keep |

### Choosing a match

| Surface | Today | Guide |
|---|---|---|
| Mode: two people here | `Play together here` / `Two of you on this device, sharing the screen.` | keep — this line is named in `docs/differentiation-brief.md` as ours |
| Mode: bot | `Play against a bot` / `Pip or Bo takes the other seat, at three levels.` | `Play against Bo` / `Bo takes the other seat, at three difficulties.` — the bot is always Bo (`botSeatsFor` only ever returns `{ p2 }`), so "Pip or Bo" is not true |
| Mode: solo | `Play solo` / `Chase your own best score, no opponent needed.` | keep |
| Card mode labels | `Two players` / `vs Bot` / `Solo` | `Two players` / `vs bot` / `Solo` |
| Difficulty legend | `Bo’s skill` | `Difficulty` |
| Length legend | `Match length` | keep |

### In the match

| Surface | Today | Guide |
|---|---|---|
| Countdown | `3` `2` `1` `Go` | keep |
| Pause | `Paused` / `The board is exactly where you left it.` | keep — this is the model line |
| Pause buttons | `Resume` / `Quit match` | keep |
| Round end | `Round 2` / `Pip 1 — 1 Bo · first to 2 takes it` | en dash for the score |
| Match end | `Match over` or `Game over` | `Match over`, always |
| Winner | `{seat} wins` / `A draw` | keep |
| Rematch | `Rematch` / `Play {next game}` / `Back to all games` | keep |
| HUD middle | `Round 2 of 3` or `vs` | keep |
| HUD state | `turn` / `thinking` | keep |

### Empty and error states

There are four, and no `not-found.tsx`, `error.tsx` or `loading.tsx` anywhere in
`apps/web/src` — so an unknown URL gets Next's unstyled default, `404 · This page could not be
found`, with no DuelBox chrome. That is the largest hole in the product's voice, because it is
the one screen a lost visitor sees.

| State | Today | Guide |
|---|---|---|
| Game not built (catalogue) | `This game is still being built. Its rules and controls are settled; the playable build lands with its milestone.` | one shared string, imported by both |
| Game not built (play surface) | `This game is not playable yet` / `Its rules and controls are settled, but the build has not landed. Try another game.` | the shared string, with `Browse games` as the way out |
| Loading | `Loading four in a row…` | `Loading Drop Four…` — it currently renders the raw slug, not the game's name |
| 404 | Next's default | `This page is not here.` / `The game you wanted may have moved, or the link may be old.` / `Browse games` |
| Copy trace | `Copy trace` / `Copied` / `Copy failed` | keep — three states, no apology, exemplary |

### Pairing prompts

**None exist.** There is no remote play: `PlayMode` is `'friend' | 'bot'`, and there is no
`RTCPeerConnection`, no signalling and no room code anywhere in the repository. The landing
page nevertheless advertises `Two devices, anywhere` / `Open a link on the other device and
play across the room or the world`, and the design canvas has a full pairing flow with `ROOM
OPEN · CODE EXPIRES IN 4:58`.

Writing pairing copy now would be writing for a screen nobody can reach. What this guide can
fix is the promise: **the landing page should not describe a mode the product does not have.**
When pairing does ship, its copy is written against these rules and added here.

---

## The naming problem, which is a voice problem

Five systems currently name the two players. In a **friend** match the HUD reads **`Pip` vs
`Player two`** — because `PlaySurface.tsx` overrides only p2 with `Player two` while p1 falls
through to its default `Pip`. One seat has a name, the other has a number, on the same line.
The result screen then says either `Pip wins` or `Player two wins`.

That is not a typo, it is an undecided question showing through. Decide it:

- **`Pip` and `Bo` are the bot cast.** They have shapes (`Pip` a disc, `Bo` a rounded square),
  colours, and bios in the design canvas. Use them when a bot is playing, and in the controls
  legend where a name is shorter than a phrase.
- **`Player one` and `Player two` are people.** In a friend match, both seats are people, so
  both are `Player one` and `Player two`. Never one of each.
- The manifests should follow the same rule, and 20 of 107 currently write `player one`
  lowercase against 45 capitalised.

Two more names exist and neither is shipped: `near seat` / `far seat` (16 manifests — correct
and useful *inside* a controls string, where the physical position is the point) and `Coral` /
`Sky` (design canvas only, and not present in `tokens.ts`). Do not introduce a sixth.

---

## Checking that nothing is borrowed

`docs/differentiation-brief.md` already commits to this: *"Their button labels, their tone,
their names for things. 'Play together here' is ours; a phrase lifted from their pre-game
screen would not be."* The observed reference strings are recorded in
`docs/reference-analysis.md` — `PLAY VS FRIEND`, `PLAY VS BOT`, `HOW TO PLAY`, `PLAY
TOURNAMENT`, `NEW!`, `SINGLE PLAYER GAMES`.

Compared against ours: `Play together here` and `Play against Bo` are structurally different
from `PLAY VS FRIEND` / `PLAY VS BOT` — different verb frame, different casing, different
naming. `How to play` matches `HOW TO PLAY`, and it should stay: it is the ordinary English
name for that page, used by thousands of products, and paraphrasing it into something worse to
avoid a coincidence would be its own kind of tell. **The test is whether a phrase is
*distinctive* to them, not whether it is common to everyone.**

The one that fails: **the catalogue `rule` strings are not ours.** They read like scraped
store-listing copy — exclamation-heavy, American-spelled, and **48 of 107 describe an input the
game does not have**: `Use the left stick to move and the right to shoot!` for a game with no
sticks, `Click on your circles` for a game played by tap and key, `Use the joystick to steer.`
Two of them ship a stray leading apostrophe from a YAML quoting error, visible on the page and
in the meta description. One ships a grammar error, `First to 5 win!`.

Rewriting those 107 strings against this document is the largest and highest-value piece of
copy work in the repository, and it is what "no borrowed phrasing" actually costs. They are
the meta descriptions: they are also the first sentence anyone arriving from a search reads.

---

## What is enforced, and what is not

Acceptance criterion three of #2337 asks that **every user-facing string traces to the guide**.
Here is honestly how far that can be true today.

**Enforced by a test:**

- Every keyboard string names a seat, and does not offer `W A S D or the arrow keys` as one
  player's choice — `apps/web/src/data/controls.test.ts`.
- Card and manifest agree on name and round length — `catalogue-agrees.test.ts` (they
  disagreed for 51 of 107 games).
- Round lengths pluralise — `lib/format.test.ts`, after 98 pages read `about 1 minutes`.
- Controls strings are 4–120 characters — the manifest schema. `archery-master` is three
  characters from failing it.

**Not enforced by anything:**

- The exclamation-mark rule. A test over `data/catalog.yaml` refusing `!` would enforce rule 1
  across the largest body of copy, and would go red today on 63 games — which is exactly the
  kind of guard this repository has learned to write, because it fails on purpose the first
  time it runs.
- One `formatRound`. A test asserting `GameCard` uses `lib/format.ts` would close it.
- Sentence case, British spelling, and the one-word-per-concept table. These are review
  matters, not test matters, and this document is what a review points at.

**Do not claim the third criterion is met until the catalogue rules are rewritten.** Two
thirds of the player-facing prose in this product does not follow this guide today, and saying
otherwise would put a sixth phantom guard in a repository that has already found five.
