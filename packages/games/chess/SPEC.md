# Chess — specification

**Archetype:** `turn-board` · **Category:** Board · **Logical box:** 900 × 900 ·
**Zone split:** shared-board · **Round length:** 300 s advertised

> **Written from the implementation, not before it.** **[ours]** marks our decisions.
> Every number below was measured against `dist/` with scripts in the session scratchpad,
> and each table says how many matches it is made of. Where a number surprised us, it is
> the surprising number that is written down.

A board that turns to face whoever is to move. Tap a piece to lift it, tap a dot to put it
down. Seat one's army stands on discs, seat two's on squares, and every piece carries its
letter. Mate the other king, or take enough of the army that nothing is left to mate with.

## Observed rules

The catalogue row reads: _"Chess! Capture your opponent's king and keep yours alive!"_ —
`confidence: observed`, `hasOptions: true`, modes `friend,bot`.

We built **checkmate**, not literal king capture, and the two are the same game. "Capture
the king" is only reachable if a player is allowed to leave their own king attacked; forbid
that — which "keep yours alive" is the reference row's way of saying — and the position
where the king could be taken next move and cannot escape is checkmate. Playing to an
actual capture would mean generating illegal moves so the opponent could punish them, which
is a worse game and a longer file.

`hasOptions: true` is not built. The shell owns difficulty, rematch and seat rotation; there
is nothing left for a per-game options panel to hold that would not be a bespoke copy of
furniture the SDK already provides.

## What is in the rules, and what is deliberately not

### In

All six pieces with their full movement. Castling on both wings, with every condition:
the right, the rook home and unmoved, the squares between empty, and the king neither
starting in check, nor crossing an attacked square, nor landing on one. En passant.
Promotion. Check, checkmate and stalemate. Three draws — threefold repetition, the
fifty-move rule and insufficient material — and one ceiling of our own.

The generator is checked against the published perft counts rather than against our own
opinion of it. From the opening array: 20, 400, 8 902, 197 281 at one to four plies. From
"Kiwipete", the position the chess-programming world uses precisely because it breaks naive
generators: 48, 2 039, 97 862. From the rook-and-pawn position that exercises en passant
and pins along a rank: 14, 191, 2 812, 43 238. All exact.

### Out: under-promotion **[ours]**

A pawn reaching the last rank becomes a queen. Always.

This is the one place our counts are *meant* to differ from the published ones, and it is
worth being exact about by how much, because "close enough" is how a generator bug hides.
Every promotion the standard counts four ways we count once, so our perft is the published
one minus three quarters of its promotion nodes. Two checks of that arithmetic:

| position | published | promotions in it | ¾ removed | ours |
|---|---|---|---|---|
| Kiwipete, four plies | 4 085 603 | 15 172 | 11 379 | **4 074 224** |
| the promotion position, one ply | 44 | 4 | 3 | **41** |

Both land exactly. A generator that was merely *approximately* right would not.

What it costs: an under-promotion is right roughly once in a thousand games, when a new
queen would stalemate and a rook would not, or when a knight comes with check. What it
buys: no promotion menu. A menu is a third press in a game whose whole input idiom is two,
and it would have to be drawn, rotated for the far seat, and dismissed — for a choice that
is a queen every time it is ever offered to these bots or to almost every human.

### Out: the rest of the FIDE insufficient-material list **[ours]**

King against king, and king and one minor against a bare king or another single minor. Not
two knights against a king, and not the same-coloured-bishops case. Those are dead draws
that the fifty-move rule catches a hundred plies later, and the extra branches cost more
bytes than the hundred plies cost anybody. What the short list *does* buy is the ending
that actually happens: two weak bots trade down to nothing and would otherwise shuffle for
a hundred plies before anything noticed.

### Out: the parts of FIDE that are not about the position

No clocks, no resignation, no draw by agreement, no claim procedure. The fifty-move rule
and threefold repetition fire **automatically** here rather than on a claim, which is the
seventy-five-move and fivefold behaviour applied at fifty and three. A claim is a fourth
thing a player can press, and nobody sitting down to a phone wants a fourth thing.

### Simplified: the en-passant square is set on every double push **[ours]**

FIDE only records an en-passant target when a capture is actually available. We record it
whenever a pawn moves two squares.

This is visible in exactly one place: the en-passant square is part of what makes two
positions the same position, so a repetition that FIDE would count we may count one ply
later. It can only ever *delay* a draw, never cause one, and the delay is bounded by the
fifty-move rule sitting behind it. The alternative is an extra attack scan on every double
push, in the hottest function in the package, to change nothing anybody can see.

## The board, and the mirror

Sixty-four signed bytes, row-major from the top. Seat one sits at the bottom on row 7; a
piece is `+type` for seat one and `−type` for seat two, so the sign *is* the seat.

Everything in `rules.ts` is written to be covariant under **σ = (flip the rows) ∘ (swap the
seats)**, and the opening array is exactly invariant under it. Two things had to be arranged
rather than hoped for:

- **Squares are visited in the mover's own frame.** `orient` walks 0…63 for seat one and
  its σ-image for seat two, so the k-th square seat one looks at is the σ-image of the k-th
  square seat two looks at. Walking 0…63 for both would generate the two seats' moves in
  unrelated orders, and every tie-break downstream — alpha-beta keeps the *first* of two
  moves it cannot separate — would then decide a mirrored position differently. That is
  lesson 11 of the brief in its most literal form.
- **Directions are (row, column) deltas with the row half multiplied by the seat's sign.**
  A knight's k-th jump for seat two is the σ-image of its k-th jump for seat one, for free,
  for every piece at once.

### The one thing the mirror suite caught

`evaluate` returned **`-0`** for a level position seen from seat two, and `0` seen from seat
one. Nothing played differently — the two are equal to every comparison the search makes —
but they are not equal to `Object.is`, so the property could not be asserted. This is
exactly the family lesson 8 names: *a value a state variable lands on exactly by
construction rather than by coincidence, reached from opposite ends by the two seats,
differing in the last bit*. A level board is an everyday event, not a measure-zero one: it
is where every match starts. The fix is `| 0` on the way out, with the reason written beside
it.

### Seat balance is a proof, not a sample

Because σ-covariance holds and the two bots share one generator that both draw from exactly
twice per decision, **a match opened by seat two is bit-for-bit the σ-image of the same
seed opened by seat one.** So over paired seeds seat one's share is 50%, exactly, by
construction.

Measured, 60 seed pairs a tier — 120 matches — driven through `ChessGame` exactly as
`balance-aggregate.test.ts` drives it:

| tier | seat one | seat two | share of decided | seed pairs that were exact mirrors |
|---|---|---|---|---|
| easy | 22 | 22 | **50.0%** | 60 / 60 |
| normal | 47 | 47 | **50.0%** | 60 / 60 |
| hard | 32 | 32 | **50.0%** | 60 / 60 |

`balance-aggregate.test.ts` itself, on its own fifty seeds, reports chess at **50.0%** of 76
decided matches, with 38 of 50 seed pairs ending differently when only the opening seat
changed — so it is reading the opening seat, and it is reading it in a game whose two halves
are mirrors.

`rules.test.ts` asserts the property board by board rather than only in aggregate: over 160
positions reached by random legal play, `generate` (both modes) returns the mirrored list in
the mirrored order, `evaluate`, `inCheck`, `hasLegalMove` and `materialOf` agree, and every
bot at every tier chooses the mirrored move. Then twelve whole matches a tier are played
from both opening seats and required to be exact mirrors, piece for piece.

### First-mover advantage, separately

Seat balance and first-mover advantage are different questions and this game answers them
differently. Seat one is 50.0% because the opener alternates. The **opener**, over 60
matches an equal-tier pairing, wins 50.0% at `easy`, 54.2% at `normal` and 52.9% at `hard`.
That is a real contest rather than a coin toss decided at the start — which it was not
before the change below.

## The root shuffle, and why a chess bot needed one **[ours]**

Alpha-beta replaces its best move only on a *strict* improvement, so when several root moves
come back with the same score the one played is whichever the generator emitted first. With
`hard`'s blunder rate at zero, nothing else in the bot consumes randomness — so **every
`hard` match was the same game, seed for seed.** Twenty seeds measured the opener at 100.0%,
and the honest reading of that number was "one match, and the opener won it".

The root move list is now shuffled before it is ordered, keyed on the second of the two
floats `chooseWith` already draws. It cannot change how strong the bot is: a move's score
comes from the position after it, which no permutation of its siblings touches, and
most-valuable-victim ordering is re-applied immediately afterwards. All that moves is the
choice between moves the search cannot separate.

| | opener's share, `hard` v `hard` | distinct matches in 100 |
|---|---|---|
| before | 100.0% (of one match played 40 times) | 1 |
| after | 52.9% | 90 |

Two properties it keeps by construction rather than by luck: it costs **no extra random
draw**, so a decision is still exactly two and the seats stay uncoupled; and the permutation
is a function of the index and the key alone, never of the board, so the mirrored position's
list — which holds the mirrored moves in the same order — is permuted identically. A shuffle
keyed on squares would be lesson 11 again with the board coordinates hidden inside a hash.

## Termination

### The proof

Every ply increments `ply`. Nothing anywhere decrements it. `resultOf` returns a non-null
result the moment `ply` reaches `MAX_PLIES = 400`, adjudicating on material. Therefore **no
match exceeds 400 plies** — and at 0.4 s of think time a ply, that is 160 simulated seconds
against `termination.test.ts`'s ten-minute ceiling. `rules.test.ts` asserts both halves separately:
that the counter only ever goes up by exactly one, and that the ceiling fires on a board
where no other rule would.

The ceiling exists because **chess's own drawing rules do not bound a game**. Between two
irreversible moves a game may run 99 plies; there are at most 126 irreversible moves
available — 96 pawn steps and 30 captures — so FIDE alone permits something near 12 700
plies, which is over an hour of simulated play. "It ends eventually" is not a bound
somebody can check.

### The distance between the bound and reality

The ceiling has never fired. Over 120 matches a tier, both opening seats:

| tier | mean plies | longest match | ceiling |
|---|---|---|---|
| easy | 122 | 273 | 400 |
| normal | 82 | 159 | 400 |
| hard | 103 | 243 | 400 |

In simulated seconds that is 51.8, 35.3 and 44.0 against the 600 the harness allows.

### What actually ends a match

120 matches a tier, both opening seats:

| | `easy` | `normal` | `hard` |
|---|---|---|---|
| checkmate | 44 | 94 | 64 |
| threefold repetition | 30 | 24 | 56 |
| stalemate | 40 | 0 | 0 |
| insufficient material | 4 | 2 | 0 |
| fifty-move rule | 2 | 0 | 0 |
| ply ceiling | 0 | 0 | 0 |

Three things are worth reading off that table.

**The drawing rules are load-bearing, not decorative.** Delete repetition and 30 of 120
`easy` matches and 56 of 120 `hard` ones lose the thing that stops them. `easy`'s two
fifty-move draws are few but they are not zero, which is the difference between a rule that
works and a rule nobody has watched fire.

**`easy` stalemates a third of the time.** That is the 20% blunder rate: a bot a queen up
that plays a random legal move every fifth turn eventually plays the one that leaves the
other king with nothing to do. It is a real chess outcome for weak play rather than a
defect, and it is the reason `easy`'s draw rate is 63%.

**`hard` draws by repetition, and that is a known hole** — 56 of its 120. The search cannot
see a repetition — the history is not threaded through it — so two engines of identical strength
in a balanced position have no reason to prefer a new position to an old one. See the open
holes at the bottom.

## The bot

Difficulty is **search depth and deliberate error, and nothing else**. Every tier reads the
same board through the same function; there is no privileged state, no extra clock, and
after the sweep below there is no third field on the profile either.

| tier | deepening levels | blunder rate |
|---|---|---|
| `easy` | 1 | 0.20 |
| `normal` | 2 | 0.08 |
| `hard` | 3 | 0 |

### The measured ladder

30 seed pairs a cell, both opening seats, so 120 matches a pairing. Score is
wins + ½ draws, from the row tier's point of view.

| | v `easy` | v `normal` | v `hard` |
|---|---|---|---|
| `easy` | 50.0% (opener's share) | **6.7%** | **1.7%** |
| `normal` | 93.3% | 54.2% (opener's share) | **5.0%** |
| `hard` | 98.3% | 95.0% | 52.9% (opener's share) |

Monotone, and steep. The steepness is a fact about chess rather than about our tuning: one
extra ply of search is worth several hundred rating points, and no arrangement of three
depths produces three tiers a hundred points apart. What the blunder rate buys is that the
gaps are not *total* — at 20% error `easy` still takes 4 wins and 8 draws off `normal` over
120 games, where at the 30% we first shipped it took none at all.

Draw rates at equal skill: `easy` 63.3%, `normal` 21.7%, `hard` 46.7%. Nothing saturates:
the same 120 matches a tier produce 44, 94 and 64 decisive results, which is a sample rather
than a verdict.

### Every knob was swept alone, and one was deleted

**Blunder rate**, at one level, against the shipped `normal`, 80 matches each:

| 0 | 0.05 | 0.1 | 0.2 | 0.3 | 0.45 | 0.6 |
|---|---|---|---|---|---|---|
| 35.6% | 20.6% | 15.0% | 11.9% | 3.1% | 0.6% | 0.6% |

Monotone over its whole range and in the direction it claims. It saturates above about 0.45
— a bot playing at random loses whatever else is true — so the useful range is 0 to 0.3, and
the three tiers sit inside it.

**Deepening levels**, blunder 0, against the shipped `normal`:

| 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|
| 34.0% | 80.0% | 94.0% | 94.2% | 94.2% |

Monotone to three and then exactly flat, because the node ceiling stops depth four
completing and `deepen` keeps the last depth that finished. `hard` sits at 3 — the last
value where the knob still moves.

**The node ceiling, deleted from the profile.** `BotProfile` carried a `nodes` field. The
sweep is what found it was dead: **400 nodes and 12 000 nodes produced byte-identical
matches**, which no real ceiling can. The budget is a module-level singleton and
`chooseWith` only ever called `reset()` on it, so the field was carried, documented, and
never read. It is gone, per the brief's fourth lesson, and the one real ceiling was then
swept properly by rebuilding:

| ceiling | `hard` v shipped `normal` | worst single decision |
|---|---|---|
| 1 500 | 78.3% | 0.56 ms |
| 2 600 | 77.5% | 1.00 ms |
| 6 000 | 88.3% | 2.26 ms |
| **12 000** | **94.2%** | **3.96 ms** |
| 25 000 | 95.0% | 8.20 ms |
| 60 000 | 95.0% | 19.02 ms |

The right-hand column is a wall clock and inherits every objection above; it is used here
only as a *relative* reading, and the six values came from one uninterrupted run so they are
comparable with each other. 12 000 is the knee. A full depth-three sweep costs about 7 400 nodes, so 25 000 only pays
for the rare wide position; 60 000 puts the worst decision past a whole 60 Hz frame, which
is the thing a ceiling exists to prevent.

**The mop-up weight, swept over 0…48**, and it did not move what it was put in for:

| weight | K+Q v bare king, 40 placements | decisive matches, `hard` v `hard` | head to head v weight 6 |
|---|---|---|---|
| 0 | 8 mated, 27 repeated | 48% | 50.0% |
| 6 | 5 mated, 30 repeated | 52% | — |
| 10 | 26 mated, 9 repeated | 58% | — |
| **12** | **29 mated, 6 repeated** | **56%** | **48.5%** |
| 16 and above | 20 mated, 15 repeated | 54% | — |

It changes **nothing** about how strong the bot is — 100 matches at weight 12 against weight
6 score 48.5%, and against weight 0, 50.0% — and it changes a great deal about whether a won
ending gets *finished*. Non-monotone, and the shape explains itself: the term has to
out-vote the queen's own centrality (1 a square) and the king term (3 a square) before it
decides anything, which happens between 8 and 10; above about 14 it swamps them and the
winning side walks its king in without keeping the queen anywhere useful. Twelve is the top
of a two-point plateau rather than a lucky spike. The value shipped was 6, which the sweep
showed sat in the dead zone below the threshold — the term was there and doing nothing.

### Quiescence, and issue #2495

The brief says `deepen` assumes deeper is monotonically better, that this is false without
quiescence, that Solitaire maps level → 2·level−1 to keep every iteration on the same side
of an exchange, and that we should do the same or say why not. So it was measured.

**Deeper is monotonically better here, at every depth the ceiling can pay for.** Head to
head at equal everything else, 120 matches a pair:

| | score |
|---|---|
| depth 2 v depth 1 | 86.3% |
| depth 3 v depth 2 | 85.4% |
| depth 4 v depth 3 | 53.8% (39W 51D 30L) |
| depth 5 v depth 4 | 50.4% |

No inversion at any parity. The flattening at four is the node ceiling, not the exchange.

The inversion #2495 describes was then looked for deliberately, with quiescence switched
off, and **it is not there either** — 0.0%, 21.0%, 31.0%, 63.0% at one to four plies against
the shipped `normal`, still monotone. What the ablation found instead is that quiescence is
the single largest lever in the whole bot:

| | with quiescence | without |
|---|---|---|
| depth 1 v shipped `normal` | 34.0% | 0.0% |
| depth 2 | 80.0% | 21.0% |
| depth 3 | **94.0%** | **31.0%** |
| depth 4 | 94.2% | 63.0% |

**So `depthFor` is the identity, and here is the cost of the alternative.** Levels 1, 2, 3
are depths 1, 2, 3 — three usable rungs at 34%, 80% and 94%. Under level → 2·level−1 they
would be depths 1, 3, 5, and depth 5 does not fit in 12 000 nodes: measured, level 3 under
that mapping spends 11 888 of its 12 000 and falls back, so `normal` and `hard` would
collapse onto the same search and the ladder would lose its middle rung.

### Move ordering is not polish

Most-valuable-victim, least-valuable-attacker, then promotions, then generation order.
Measured over 3 900 `hard` decisions, against no ordering at all:

| | mean nodes a decision | decisions that hit the ceiling |
|---|---|---|
| ordered | **5 246** | **11.4%** |
| unordered | 8 264 | 48.0% |

Nearly half of an unordered `hard`'s moves would be a depth-two answer wearing a
depth-three label.

### Cost

A node ceiling rather than a clock, because rule 8 says a phone and a laptop must step the
identical match and a stopwatch cannot give that. 12 000 nodes, one ceiling for all three
tiers.

The **deterministic** half, over a full tier of matches from both opening seats. These
numbers are the same on any machine, which is the whole point of counting nodes:

| tier | decisions | mean nodes | worst | ceiling reached |
|---|---|---|---|---|
| `easy` | 10 026 | 118 | 6 874 | 0.0% |
| `normal` | 6 800 | 647 | 8 865 | 0.0% |
| `hard` | 8 472 | 4 822 | 12 000 | 9.9% |

The **wall-clock** half, and it is quoted as a range on purpose. The same three runs on the
same machine, which was shared with six other agents building six other games:

| tier | mean | p99 | worst single decision |
|---|---|---|---|
| `easy` | 0.05–0.07 ms | 0.5–0.7 ms | 2.4–15.4 ms |
| `normal` | 0.26–0.47 ms | 1.9–5.9 ms | 3.3–25.4 ms |
| `hard` | **1.0–1.9 ms** | **3.9–7.4 ms** | **4.4–18.9 ms** |

The spread is the machine, not the search: the node counts above are identical across all
three runs to the last node. On a quiet run `hard`'s worst decision is **4.4 ms**, a quarter
of a 60 Hz frame, and it happens on one step in twenty-four — the rest of the time the bot
is counting down its think delay and doing nothing at all. This is exactly the objection
`bot-cost.test.ts` makes to clocks, aimed back at our own measurement of one; that file
scales its 22 ms ceiling to the machine and passes chess in 305 ms of driving.

## Playing it

### Two presses, and no drag anywhere

A move is two presses: lift a piece, then say where it goes. It is the same idiom Checkers
uses and the only one identical for a thumb, a trackpad and a keyboard.

Chess is the easiest game in the collection to make fair across devices, and worth saying
why: it has **no continuous quantity and no timing element at all**. A move is a choice from
a finite set. There is no aim to place more finely with a thumb than with a key, no reaction
to resolve on a timestamp, and no precision envelope to negotiate. It is not same-class-only
and there is nothing in it that could make it so.

| | Seat one | Seat two |
|---|---|---|
| Keyboard | `W A S D` to move the cursor, `Space` to lift and place | arrow keys, `Enter` |
| Pointer | tap a piece, then tap a dot | tap a piece, then tap a dot |

Only on your own turn, and never while the board is part-way through its half-turn — the
square under a finger is moving, so a tap then would name one the player did not mean.

**Castling needs no third press.** A king moving two squares can be nothing else, so the
rules resolve the pair of squares into the move the player must have meant. **En passant
needs none either** — the dot is simply on the empty square. **Promotion needs none**,
because it is always a queen. Every special move in chess is reachable by the same two
presses as every ordinary one, which is the whole reason to keep the input this thin.

Pressing another of your own pieces re-lifts rather than being refused. A player changing
their mind is the common case, and making them press twice to undo a selection is worse than
believing the second press.

### What is drawn, and why

Only **legal** destinations are dotted, castling and en passant included. Chess's hardest
lesson for a new player is the pinned piece, and showing only legal destinations teaches it
without a word. The king in check gets a ring. The last move's two squares stay shaded,
because on a board where every piece looks like every other of its type "what just moved" is
otherwise unanswerable — and on a shared device the person who was not watching has just
picked the phone up.

### Rule 7

Seat one's pieces stand on **discs**, seat two's on **squares**, and every piece carries its
letter in ink: `P N B R Q K`. The seats are told apart by the plate, which is a shape and
not a colour; the pieces are told apart from each other by the letter, which is a label and
also not a colour. A player who sees no colour at all loses nothing, and
`greyscale.test.ts` agrees: seat one draws a filled circle that seat two never draws in its
own colour, and seat two a filled rect that seat one never draws.

Note what is *not* doing the work. Both armies carry the same six letters — a knight is `N`
for everybody — so the letters cannot separate the seats and are not asked to. Shipping the
usual light-and-dark pieces would have failed rule 7 outright: that is colour, and only
colour, which is exactly the case the rule was written about.

### Scoring

The scoreline is **pieces taken**, per seat. Not material and not "who is winning" — those
are the bot's opinion, and the shell shows a number to a person. A count of enemy pieces off
the board is the one figure both players can check by looking.

The winner is decided by the rules and never by that count: a mate delivered a rook down
still wins. The only place material decides anything is the ply ceiling, which has never
fired in any measured match.

### Turn order

`turn-board`, so `getActiveSeat()` is answered every step and the shell owns the turn
indicator, the flip and the result card. `init` reads **`GameContext.openingSeat`** and the
match opens with that seat. The armies never move — seat one is always at the bottom — and
only the side to move changes, which is exactly the σ-symmetry, so opening as seat two is
the same match seen from the other side rather than a different one.

The final position is held for one second before the score reports a winner, so whoever lost
sees the move that did it.

## Size

**Estimated 6.2 KB gzipped against the 12.0 KB budget**, and it is an estimate because
`pnpm build` is the orchestrator's to run — six other games were being built in the same
tree. The estimate is calibrated rather than guessed: strip comments and blank lines from
each game's non-test source, gzip it, and compare against the chunk size `check-size.mjs`
reported for nine shipped games. The ratio is 0.743 with a spread of 0.73 to 0.76 across all
nine, so the figure is good to about ±0.2 KB.

Nothing was cut for size; there was no need. The two reductions above — queen-only promotion
and the short insufficient-material list — were made for the reasons given, and together
they are worth perhaps 0.3 KB. What keeps the file small is that the whole simulation is
integers in typed arrays: a position is 64 bytes plus six numbers, a move is one integer,
and there is not an object allocated anywhere in the search.

## Open holes

Written down rather than left to be discovered.

**The search cannot see a repetition.** The match history is not threaded into it, so a bot
with an overwhelming position and nothing to capture has no reason to prefer a new position
to an old one. This is what 56 of 120 `hard` matches ending by repetition is, and it is the
remaining 6 of 40 unconverted bare-king endings after the mop-up sweep. The fix is real and
not small: thread the position history through `search` and score a repetition as a draw.
Worth doing if `hard`'s draw rate ever becomes a complaint.

**`easy` stalemates 40 times in 120.** Lowering the blunder rate fixes it and makes `easy`
harder; the current value is the one that keeps `easy` weak while still taking games off
`normal`. A stalemate-aware blunder — pick randomly among moves that do not stalemate — would
be a bot with information a careless human does not have, so it is not on.

**`presentation-parity.test.ts`'s generic gesture does not move this game.** The harness
taps the middle of the board, and the middle of a chess board is four empty squares. Chess
is on that file's list of games whose scripted-hand arm is identical to its no-hands arm,
alongside twelve others. The file reports it on every run and the game is compared under its
bot arms, which do move; a bespoke gesture script per game is a larger piece of work than
that file.

**The ply ceiling has never fired.** It is insurance, and insurance nobody has watched pay
out is worth being suspicious of — so `rules.test.ts` fires it directly on a constructed
board rather than waiting for a match to reach it.
