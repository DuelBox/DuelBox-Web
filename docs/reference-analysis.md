# Reference app analysis — observed behaviour

Research method: the app was installed on a rooted Android emulator (`emulator-5554`,
1080x2400) and driven with `adb shell input` while capturing `adb exec-out screencap`.
Everything below was **observed by playing**. No APK was decompiled, unpacked, or read;
no asset was extracted. Mechanics and rules are not protected and are reimplemented from
scratch; art, audio, copy, and exact layouts on our side are original.

Session date: 2026-08-19. Package: `com.JindoBlu.TwoPlayerGamesChallenge`.

---

## 1. Information architecture

```
HOME (game grid)
├── mode toggle: [2 Players] [1 Player]      ← filters the whole grid
├── settings (gear, top-left)
├── language (flag, top-right)
├── scrollable 2-column card grid
│   ├── two-player section (~99 cards)
│   └── "SINGLE PLAYER GAMES" section header → ~7 cards
├── bottom bar (fixed): [P1 score] [PLAY TOURNAMENT] [P2 score]
└── card tap → PRE-GAME
     ├── title + one-line rule summary
     ├── HOW TO PLAY (video)
     ├── PLAY VS FRIEND
     ├── PLAY VS BOT
     ├── favourite (star, top-right)
     └── Back
          → MATCH → RESULT → rematch / exit
```

## 2. Card grid

- Two columns, square thumbnails, title overlaid at the bottom of each card.
- Badges observed: **NEW!** (yellow, top-centre) and a **globe** icon (top-left) marking
  games that support online play.
- Card art is a single illustrated square per game; no animated previews.
- The grid is one long scroll — no categories, no search, no filters.

## 3. Bottom bar (persistent)

- Left: P1 score in a **red** figure; right: P2 score in a **blue** figure.
- Red = Player 1, blue = Player 2, consistently across every screen and every game.
- Centre: PLAY TOURNAMENT.
- The pair score shown here resets when the app process restarts.

## 4. Pre-game screen

Every game funnels through the same screen: title, a short rule statement, a HOW TO
PLAY video button, the mode buttons, a favourite star, and — on some games — a gear
opening per-game options. The win condition is stated in one or two sentences before
the match rather than taught by a tutorial.

**Three play modes exist, and not every game offers all three:**

| Mode | Meaning | Observed on |
|---|---|---|
| Play vs Friend | Two humans, one device | Every game |
| Play vs Bot | One human against the CPU | Most games |
| Play Solo | Score attack, no opponent | Wheelie, Brainrot Stack |

Wheelie offers Friend and Solo but no Bot; Brainrot Stack offers all three. So the
manifest must declare which modes a game supports, and the shell must render only
those. Assuming every game has a bot would produce dead buttons.

### Rule text captured verbatim from the pre-game screens

These are the reference app's own summaries, recorded as research notes to define
the mechanics we implement independently. Our own copy is written from scratch.

| Game | Rule as stated | What it implies |
|---|---|---|
| Guess the Person | Ask yes/no questions to narrow down which character the other player chose and guess it before they do | Hidden information, needs the pass-and-play blackout |
| Ultimate Tic Tac Toe | Nine small boards; where you place your mark dictates which board the opponent must play next; win three small boards in a row | Nested board state, constraint propagation, non-trivial bot |
| Crash It | Drive, jump and flip your car by tapping buttons; hit the opponent's head with your car and protect your own | Real-time vehicle physics with a vulnerable hitbox |
| Throw | Snowball fight: pull back to aim, release to throw; first to reduce the opponent's health to zero wins | Drag-to-aim plus a **health/HP win condition** |
| Wheelie | Accelerate to pull a wheelie; earn more points the longer you hold it | Balance simulation, score accumulates over time held |
| Shut the Box | Roll dice, flip numbered tiles summing to the roll, continue until no move is possible | Dice + subset-sum move generation |
| Brainrot Stack | Take turns dropping objects; first to drop one off the platform loses; drag to position and tap to rotate | Turn-based stacking physics, drag plus tap controls |
| Slot Cars | Tap and hold to race; release in the curves or the car flames out | Hold-to-accelerate with a corner-speed constraint |

Two win-condition patterns appear here that the shared helper library must cover
beyond first-to-N: **reduce opponent health to zero**, and **highest accumulated
score when the round ends**.

## 5. In-match HUD

- **Left edge:** a score pill, rotated 90°, showing P2 over P1 (blue above red).
- **Right edge:** an EXIT pill, rotated 90°.
- Both are half-circles anchored off-screen so they never overlap the play area.
- Turn prompt ("Your turn") appears as a large coloured bubble at the bottom edge.

## 6. The single most important mechanic: screen orientation per player

Two people share one phone, sitting on opposite sides. In turn-based games the app
**rotates the entire play area and its text 180°** when the turn passes, and recolours
the field to the active player's colour (red field for P1, blue for P2). The "Your turn"
prompt renders upside-down relative to the previous player so it reads correctly for
whoever is now acting.

This is the defining constraint of the whole product and must be a first-class concept
in the web engine, not a per-game hack.

## 7. Match structure (Mini Golf, played in full)

- Turn-based, alternating. Drag-and-release putt from behind the ball; drag vector sets
  direction and power.
- Sinking the ball scores a point and immediately hands the turn over with the 180° flip.
- Win condition: **first to lead by 2 points** (not first to N).
- Each successive hole adds obstacles — hole 1 was an empty rectangle, hole 2 added two
  diamond blocks between ball and cup. Layout complexity escalates per hole.
- Feedback: ball settles, score pill updates, board flips, next hole draws in.

## 8. Tournament mode

- "See who is best! Play a set of 7 random games. Let's find the winner!"
- A horizontal progress track of **7 nodes ending in a trophy**, with the red and blue
  player tokens advancing along it.
- Two entry buttons: player vs player, player vs bot.
- Random game selection — no pick/ban observed.

## 9. Bot opponent

Every game offers PLAY VS BOT from the same pre-game screen, so a CPU opponent is not
optional per game — it is a platform-level requirement that every game must satisfy.

## 10. What this means for the web build

| Observation | Consequence for the website |
|---|---|
| 180° rotation per turn | Rotation must live in the engine/HUD layer, applied per player seat |
| Red P1 / blue P2 everywhere | One palette token pair, used by shell and every game |
| Same pre-game screen for all games | One shared route + manifest per game; games never build their own |
| Score pill + EXIT anchored to edges | Shared HUD component; games render only their play area |
| Every game has a bot | The AI interface is part of the game contract, not an add-on |
| "Lead by 2" style win conditions | Win conditions are data in the manifest where possible |
| One long grid, no search | We can beat this: search, categories, filters are a real improvement |
| Tournament = 7 random games | Tournament is a shell-level state machine over the game registry |
| Card grid with static art | We can beat this with animated previews, but must keep them cheap |

## 11. Full observed catalog

Two-player games seen on the grid (names as displayed; our implementations use our own
names where a name is trademark-risky):

Guess the Person · Ultimate Tic Tac Toe · Crash It · Throw · Cup Pong · Match · Wheelie ·
Shut the Box · Brainrot Stack · Slot Cars · Archery · Animal Stack · Stampede ·
Target Practice · Gravity Run · Golf Football · Brick Blast · Darts · Tennis · Cannon Duel ·
Ludo · Backgammon · Soccer Pool · Sea Battle · Knife Thrower · Pull the Rope · Happy Hippos ·
Tic Tac Toe · 4 in a Row · Traffic Jam · Hand Slap · Memory · Pool · Rock Paper Scissors ·
Sumo · Air Hockey · Money Grabber · Pinball · Racing Cars · Tanks · Basketball ·
Sword Throwing · Chess · Mini Golf · Ship Battle · The Last Sashimi · Star Catcher ·
Mini Soccer · Whack · Shuriken · Checkers · Crabby Volley · Paint Fight · Unfair Fishing ·
Light Fingers · Guard and Thief · Explosive Festival · Archery Master · Disco Battle ·
Frozen Beaks · Fatal Siege · Bowling · Sticky Tongues · Dung Battle · Rat Race ·
Pizza Memory · King of the Yard · Piranha Rush · Fruit Duel · Beach Ball · Happy Birds ·
Hot Potato · Pop It · Math Quiz · Dots and Boxes · Water Game · Lumber Jack · Mancala ·
Hammer Hit · Cornhole · Carrom · Flappy Jump · Chicken Jump · Ballgames Physics ·
Spike Attacks · Yazy · Broken Tiles · Color Wars · Taxi Race · Wrestle · Reversi ·
Road Dodge · Snakes & Ladders · Sling Puck

Single-player section: Nuts and Bolts · Maze Paint · Tap Match · Blocks · Solitaire ·
Sliding Puzzle · Sudoku

Games marked with the globe badge (online-capable in the reference app): Pull the Rope,
Tic Tac Toe, Pinball, Whack, Archery Master, Fruit Duel, Dots and Boxes.

Per-game mechanics beyond the above are recorded in each game's own research issue —
they are filled in by playing that specific game, never guessed.
