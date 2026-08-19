# Game catalog

**107 games.** Derived from the reference app's grid by observation, then
reimplemented from scratch. Archetype decides which issue template set a game gets and
which engine systems it needs — build one game per archetype first, and the rest of that
group become variations on a solved problem.

## Archetypes

| Archetype | Games | What it means |
|---|---|---|
| `turn-board` | 24 | Alternating turns on a shared board, 180° seat rotation |
| `turn-aim` | 21 | Alternating turns, drag-to-aim physics shot |
| `rt-split` | 41 | Real-time, both players act at once, screen split into two seats |
| `rt-arena` | 13 | Real-time, both players share one arena |
| `rt-race` | 8 | Real-time driving or running along a track |

## Categories

| Category | Games |
|---|---|
| Party | 20 |
| Sports | 19 |
| Board | 14 |
| Shooter | 8 |
| Reaction | 7 |
| Arena | 7 |
| Racing | 7 |
| Solo | 7 |
| Platform | 5 |
| Dice | 2 |
| Memory | 2 |
| Survival | 2 |
| Arcade | 2 |
| Deduction | 1 |
| Rhythm | 1 |
| Stealth | 1 |
| Puzzle | 1 |
| Racing & Trails | 1 |

## All games

`observed` = rules transcribed from the app. `research` = an open research issue must
be closed before its spec issue starts.

| Game | Category | Archetype | Modes | Rules |
|---|---|---|---|---|
| **Brick Blast** | Arcade | `rt-arena` | friend, bot | observed |
| **Pinball Duel** | Arcade | `rt-arena` | friend, bot | observed |
| **Dung Battle** | Arena | `rt-arena` | friend, bot | observed |
| **Explosive Festival** | Arena | `rt-arena` | friend, bot | observed |
| **Fatal Siege** | Arena | `rt-arena` | friend, bot | observed |
| **King of the Yard** | Arena | `rt-arena` | friend, bot | observed |
| **Spin War** | Arena | `rt-arena` | friend, bot | observed |
| **Sumo Push** | Arena | `rt-arena` | friend, bot | observed |
| **Wrestle** | Arena | `rt-arena` | friend, bot | observed |
| **Backgammon** | Board | `turn-board` | friend, bot | observed |
| **Checkers** | Board | `turn-board` | friend, bot | observed |
| **Chess** | Board | `turn-board` | friend, bot | observed |
| **Colour Wars** | Board | `turn-board` | friend, bot | observed |
| **Dots and Boxes** | Board | `turn-board` | friend, bot | observed |
| **Drop Four** | Board | `turn-board` | friend, bot | observed |
| **Ludo Dash** | Board | `turn-board` | friend, bot | observed |
| **Mancala Pits** | Board | `turn-board` | friend, bot | observed |
| **Reversi** | Board | `turn-board` | friend, bot | observed |
| **Sea Battle** | Board | `turn-board` | friend, bot | observed |
| **Ship Battle** | Board | `turn-board` | friend, bot | observed |
| **Snakes and Ladders** | Board | `turn-board` | friend, bot | observed |
| **Tic Tac Toe** | Board | `turn-board` | — | **research** |
| **Ultimate Tic Tac Toe** | Board | `turn-board` | friend, bot | observed |
| **Guess Who** | Deduction | `turn-board` | friend, bot | observed |
| **Dice Yatzy** | Dice | `turn-board` | friend, bot | observed |
| **Shut the Box** | Dice | `turn-board` | friend, bot | observed |
| **Memory Match** | Memory | `rt-split` | friend, bot | observed |
| **Pizza Memory** | Memory | `rt-split` | friend, bot | observed |
| **Animal Stack** | Party | `rt-split` | friend, bot, solo | observed |
| **Broken Tiles** | Party | `rt-split` | friend, bot | observed |
| **Frogs Fight** | Party | `rt-arena` | friend, bot | observed |
| **Frozen Beaks** | Party | `rt-split` | friend, bot | observed |
| **Hammer Hit** | Party | `turn-aim` | friend, bot | observed |
| **Happy Hippos** | Party | `rt-split` | — | **research** |
| **Hot Potato** | Party | `rt-split` | friend, bot | observed |
| **Light Fingers** | Party | `rt-split` | friend, bot | observed |
| **Lumberjack** | Party | `rt-split` | friend, bot | observed |
| **Money Grabber** | Party | `rt-split` | friend, bot | observed |
| **Paint Fight** | Party | `rt-split` | friend, bot | observed |
| **Piranha Rush** | Party | `rt-split` | friend, bot | observed |
| **Pull the Rope** | Party | `rt-split` | — | **research** |
| **Snowball Throw** | Party | `rt-split` | friend, bot | observed |
| **Star Catcher** | Party | `rt-split` | friend, bot | observed |
| **Sticky Tongues** | Party | `rt-split` | friend, bot | observed |
| **The Last Sashimi** | Party | `turn-aim` | friend, bot | observed |
| **Unfair Fishing** | Party | `rt-split` | friend, bot | observed |
| **Water Game** | Party | `rt-split` | friend, bot | observed |
| **Wobble Stack** | Party | `rt-split` | friend, bot, solo | observed |
| **Chicken Jump** | Platform | `rt-split` | friend, bot | observed |
| **Flappy Jump** | Platform | `rt-split` | friend, bot | observed |
| **Gravity Run** | Platform | `rt-split` | friend, bot | observed |
| **Happy Birds** | Platform | `rt-split` | friend, bot | observed |
| **Stampede** | Platform | `rt-split` | friend, bot | observed |
| **Traffic Jam** | Puzzle | `rt-race` | friend, bot | observed |
| **Crash It** | Racing | `rt-race` | friend, bot | observed |
| **Racing Cars** | Racing | `rt-race` | — | **research** |
| **Rat Race** | Racing | `rt-race` | friend, bot | observed |
| **Road Dodge** | Racing | `rt-race` | friend, bot | observed |
| **Slot Cars** | Racing | `rt-race` | friend, bot | observed |
| **Taxi Race** | Racing | `rt-race` | friend, bot | observed |
| **Wheelie** | Racing | `rt-race` | friend, solo | observed |
| **Snake Clash** | Racing & Trails | `rt-arena` | friend, bot | observed |
| **Fruit Duel** | Reaction | `rt-split` | — | **research** |
| **Hand Slap** | Reaction | `rt-split` | friend, bot | observed |
| **Match Rush** | Reaction | `rt-arena` | — | **research** |
| **Math Duel** | Reaction | `rt-split` | friend, bot | observed |
| **Pop It** | Reaction | `rt-split` | friend, bot | observed |
| **Rock Paper Scissors** | Reaction | `rt-split` | friend, bot | observed |
| **Whack a Mole** | Reaction | `rt-split` | friend, bot | observed |
| **Disco Battle** | Rhythm | `rt-split` | friend, bot | observed |
| **Archery** | Shooter | `turn-aim` | friend, bot | observed |
| **Archery Master** | Shooter | `turn-aim` | friend, bot | observed |
| **Cannon Duel** | Shooter | `turn-aim` | friend, bot | observed |
| **Knife Thrower** | Shooter | `turn-aim` | — | **research** |
| **Shuriken** | Shooter | `turn-aim` | friend, bot | observed |
| **Sword Throwing** | Shooter | `turn-aim` | friend, bot | observed |
| **Tanks** | Shooter | `turn-aim` | — | **research** |
| **Target Practice** | Shooter | `turn-aim` | friend, bot | observed |
| **Blocks** | Solo | `turn-board` | solo | observed |
| **Maze Paint** | Solo | `turn-board` | solo | observed |
| **Nuts and Bolts** | Solo | `turn-board` | solo | observed |
| **Sliding Puzzle** | Solo | `turn-board` | solo | observed |
| **Solitaire** | Solo | `turn-board` | solo | observed |
| **Sudoku** | Solo | `turn-board` | solo | observed |
| **Tap Match** | Solo | `turn-board` | solo | observed |
| **Air Hockey** | Sports | `rt-split` | friend, bot | observed |
| **Ball Games** | Sports | `rt-split` | friend, bot | observed |
| **Basketball** | Sports | `turn-aim` | friend, bot | observed |
| **Beach Ball** | Sports | `rt-split` | — | **research** |
| **Bowling** | Sports | `turn-aim` | friend, bot | observed |
| **Carrom** | Sports | `turn-aim` | friend, bot | observed |
| **Cornhole** | Sports | `turn-aim` | friend, bot | observed |
| **Crabby Volley** | Sports | `rt-split` | friend, bot | observed |
| **Cup Pong** | Sports | `turn-aim` | — | **research** |
| **Darts** | Sports | `turn-aim` | friend, bot | observed |
| **Golf Football** | Sports | `turn-aim` | friend, bot | observed |
| **Mini Golf** | Sports | `turn-aim` | friend, bot | observed |
| **Mini Soccer** | Sports | `rt-split` | friend, bot | observed |
| **Penalty Kicks** | Sports | `rt-split` | friend, bot | observed |
| **Ping Pong** | Sports | `rt-split` | friend, bot | observed |
| **Pool** | Sports | `turn-aim` | friend, bot | observed |
| **Sling Puck** | Sports | `turn-aim` | friend, bot | observed |
| **Soccer Pool** | Sports | `turn-aim` | friend, bot | observed |
| **Tennis** | Sports | `rt-split` | friend, bot | observed |
| **Guard and Thief** | Stealth | `rt-split` | friend, bot | observed |
| **Robot Arena** | Survival | `rt-arena` | friend, bot | observed |
| **Spike Attacks** | Survival | `rt-split` | friend, bot | observed |
