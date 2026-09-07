# Tournament mode

The design (#156), decided. The machine that runs it is `apps/web/src/lib/tournament.ts`,
the storage around it is `apps/web/src/lib/tournament-store.ts`, and the progress track is
`apps/web/src/components/TournamentTrack.tsx`.

## What the reference app does

From `docs/reference-analysis.md`, observed by playing rather than inferred:

- A **PLAY TOURNAMENT** button in a bottom bar that is on every screen, between the two
  players' running scores.
- The pitch on the entry screen: _"See who is best! Play a set of 7 random games. Let's
  find the winner!"_
- **Two entry buttons**: player vs player, and player vs bot.
- A horizontal progress track of **seven nodes ending in a trophy**, with the red and blue
  player tokens advancing along it.
- **Random game selection.** No pick, no ban, no seeding was observed.
- The pair score in the bottom bar **resets when the app process restarts**.

Everything below either matches that or diverges from it on purpose, and each divergence
says why.

## The format

**Seven games, drawn at random, no game twice. Each game is one match. First to four
games wins. If seven are played without either player reaching four, whoever is ahead
wins; level is a drawn tournament.**

- **Seven, because the reference says seven**, and because seven single matches is a
  sitting rather than an evening. The number is `TOURNAMENT_LENGTH` and the machine reads
  the line-up's length rather than the constant, so a stored tournament of another length
  still resumes and still knows what winning it takes.
- **One match per game, not a best-of.** The tournament _is_ the best-of. Seven
  best-of-threes is twenty-one matches, which is a different product. A leg is therefore
  played at `rounds: 1` whatever the player's remembered match length says, and the
  pre-match options are not offered during a leg — the tournament has already settled
  them.
- **First to four ends it.** Four of seven is a strict majority, so the remaining legs
  cannot change the answer, and three dead rubbers are three chances for a pair to stop
  playing. `legsToWin` is `floor(n / 2) + 1` rather than the SDK's `ceil(n / 2)`, because
  a majority of an even line-up is not half of it: a 3–3 finish is level, not a win.
- **A drawn game is played and counted as a draw.** Neither player advances. Draws are
  what make "first to four" reachable-but-not-guaranteed, which is why the fallback rule
  exists at all: 3–3 with one drawn game is a real seven-game tournament that nobody won
  four of.
- **A level tournament is a draw.** There is no decider. An eighth game would break both
  "seven games" and the shape of the track, and sudden death after seven games is a rule
  a pair has to be told about at the worst possible moment. This is the same answer
  `matchOutcomeOf` gives a level best-of in `packages/game-sdk/src/match.ts`, and giving
  the same answer in the same words is worth more than inventing a tiebreak.

## Why not the other formats

- **A knockout bracket** needs more than two players. There are two seats.
- **A ladder or accumulating points** (three for a win, one for a draw) decides the same
  thing as counting wins, with arithmetic a player has to be taught. Counting wins is what
  the track already draws.
- **Play all seven regardless** is the reference's likeliest reading of "advance to the
  trophy", and it is rejected on one ground: it makes the last two legs meaningless in the
  common case where one player is better. Ending at four is the version that stays a
  contest to its last game.
- **Pick and ban** was not observed and is a second screen and a second vocabulary for a
  feature whose entire pitch is "seven random games".

## Where it lives, and why

It runs on the **play route**, driven by what is in storage, and it has no route of its
own.

A tournament is a sequence of matches, and a match already lives at `/play/<slug>/` — the
countdown, the HUD, the pause menu, the result screen and the bot are all there. A
`/tournament/` route would either host matches itself, which is a second copy of
`PlaySurface`, or redirect to the play route, which is a route that exists to send you
somewhere else. Neither is worth a page.

The size budget agrees, and it is the stronger half of the argument.
`scripts/check-size.mjs` bills every route that is not `/play/` to the **shell** — the
bytes every visitor pays before choosing anything — and bills the play route to **on
demand**, which only somebody who has already chosen a game downloads. A tournament is by
definition something a player has chosen, so its code belongs in the second budget. A
`/tournament/` page, its own segment chunk, and a client control able to draw a line-up
and write it down would all have landed in the first, which had about 1.9 kB of headroom
and a note in `size-budget.json` warning the next non-play change to argue for itself.

The one part that unavoidably reaches the shell is `TOURNAMENT_KEY`, because
`lib/player-data.ts` joins every store's key so export, import and erase carry it, and
`/settings/` loads that eagerly. That is why `tournament-store.ts` holds nothing but the
key, the read, the write and the sanitiser, and imports the machine's **types only**: a
value import would have pulled the whole reducer into the shell for the sake of a string.

**Entry is the two buttons at the bottom of any game's lobby** — "Tournament together" and
"Tournament against Bo" — which is the reference's two entry buttons in the place this
product can afford to put them. The divergence from the reference is that there is no
persistent bottom bar: a control on every page is shell weight on every page, and the
bar's other content (a running pair score that resets when the app restarts) is something
this product already does better and permanently in the head-to-head record.

**The first leg is the game you started from**, and the other six are drawn. This follows
from the entry point rather than from taste: the press happens in a game's lobby, so
starting anywhere else would mean navigating away from the page the player just pressed
on, before they have seen the line-up. The remaining six are drawn at random, so six of
the seven games are still a surprise.

## Random selection (#159)

`pickTournamentGames` in `lib/tournament.ts` draws the line-up. It does not implement a
weighting of its own — it calls `pickQuickPlay` in a loop, removing each pick from the
pool before the next draw.

That is deliberate, and it is why the weighting is identical to "Surprise me" rather than
merely similar: the game played last is not offered, the two before it are offered at a
quarter weight, and everything else is even. A tournament drawn on a long evening
therefore reaches for the games the pair have not just played, which is the same thing the
button in the header is for. Writing a second weighted picker would have been a second
rule to keep in step with the first, for a difference nobody asked for.

Sampling **without replacement** is the whole of what this adds, and it is the acceptance
criterion: a tournament never repeats a game within itself. It is enforced twice on
purpose — the loop cannot draw a slug it has removed, and `reduce`'s `start` runs the
line-up it is given through `uniqueStrings`, so a line-up assembled anywhere else cannot
introduce a repeat either.

If the catalogue is smaller than the line-up — which only a test can arrange today, with
108 playable games — the tournament is as long as there are distinct games, and every rule
above still applies to that length.

## How it interacts with the head-to-head record

**A leg is recorded exactly as any other match is, once, under the game it was played at
and under the opponent who played it.** `lib/head-to-head.ts` is not told that a
tournament is happening and does not need to be: a match played to its end is a match
played to its end, and a tournament whose games did not count would make the per-game
record quietly wrong for anyone who plays tournaments.

There is deliberately **no second record of tournaments won**. It would be a new store, a
new shape and a new set of failure paths for a number that is not the one the pair keep
asking each other about, and #164's share card is where a finished tournament should go
when it goes anywhere.

## How it interacts with the bot

A tournament is against a friend or against the bot, chosen once at the start and fixed
for all seven legs — the reference's two entry buttons, and the only way the result means
one thing. The bot's tier is whatever that player has already chosen for themselves in the
ordinary pre-match options; the tournament does not offer a tier of its own, because a
ladder that changed difficulty between legs would not be a tournament of the same thing.

Mixed tournaments — some legs against the bot, some against the other seat — are not
offered. The head-to-head store keeps those two kinds of match apart for a good reason,
and a tournament that mixed them would be a result that belongs to neither map.

## Resumability

The acceptance criterion of #157 is that progress survives a reload, and every leg change
_is_ a reload: leg three is a different URL from leg two, so the state cannot live in
React.

What is written down is `{ games, results, opponent }` under one versioned key. **The
phase is not stored**, because it is derived: a tournament whose line-up and results are
known is complete or still running by arithmetic, and a stored phase is a second copy of
that answer able to disagree with it. `resume()` is the one function that computes it, and
`reduce` computes it through the same function, so a resumed tournament and a live one
cannot be in different states from the same facts.

Reading follows the same conventions as every other store — sanitise on the way out, never
throw, treat an unknown version as no data at all:

- **A future version** is nothing this build can interpret, so it reads as no tournament.
  `readVersioned` already does that for every store.
- **A corrupt line-up** — not an array, or an array with no usable slug in it — is no
  tournament.
- **Corrupt results** are truncated at the first entry that is not an outcome, rather than
  having the bad entries skipped. Results are positional: leg three's outcome is
  `results[2]`, so dropping a bad `results[1]` would silently re-label every leg after it.
  A tournament that resumes at leg two having lost leg three's result is wrong by one
  game; one that renumbers every remaining leg is wrong about all of them.
- **More results than games** is truncated to the line-up.

Two things the store deliberately does **not** check, because it cannot check them where it
sits. It knows nothing about which games are playable — `data/registry.ts` carries a dynamic
import for all 108 of them and pulling it into a module `/settings/` loads eagerly would
cost every visitor the whole registry — so a line-up naming a game this build has no route
for would offer a link to a page that is not there. That is reachable only by importing a
player-data file written by a different build, or by editing the document by hand; a line-up
this build drew is drawn from `PLAYABLE`. The same argument covers a game whose manifest
does not offer the tournament's opponent: manifests arrive with the game's own chunk, long
after the line-up is drawn, and today every playable manifest declares both `friend` and
`bot`. If a solo-only game ever ships, the line-up needs a filter that knows about modes,
and that filter has to live where the manifests do.

## Deliberately not in v1

- **Cross-device tournaments** (#1878). Remote play is not built.
- **A persistent entry point on every page.** Shell bytes, and the argument is in "Where
  it lives" above. If the shell budget is raised for something else, this is the first
  thing that should be reconsidered.
- **More than one tournament at a time.** One key, one tournament. Starting a second
  replaces the first, and the control that does it says so.
- **A confirmation on leaving.** The destructive buttons on `/settings/` arm on the first
  press because what they erase cannot be rebuilt; a tournament is seven games and one
  press to start another. The button is labelled "Leave the tournament" rather than
  something ambiguous, and that is the whole of the protection.
- **A trophy cabinet, a history, a streak.** #164's share card is the natural home for a
  finished tournament, and a store that recorded them would need to exist before it has a
  reader.
- **Naming the upcoming games on the track.** The track shows position, not schedule:
  seven names do not fit at 320px, and knowing which game is fourth changes nothing a
  player can act on. The next game is named where it is offered.
- **Changing the line-up mid-tournament** — a re-draw, a skip, a substitution for a game
  neither player likes. Every one of them is a way to lose, which is the reason to want
  it.
- **A rematch of a finished leg counting for anything.** The result screen still offers
  Rematch, because the tournament is not a reason to take a button away, but only the
  route the tournament is waiting on can report a result. A replayed leg is a friendly
  game: it goes on the head-to-head record, like any other match, and not on the
  tournament.
