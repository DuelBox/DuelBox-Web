# Observed game rules

Rule summaries as stated by the reference app on each game's own pre-game screen,
transcribed while playing it on the emulator. These are research notes recording the
**mechanics** we reimplement from scratch. Mechanics and rules are not protected;
all of our copy, art, audio, and layout is original.

**Coverage: 107 of 107 games — complete.**

**Nothing on this page ships.** These rows are the provenance record: what the screen said,
and which game it said it on. The `rule` text in `data/catalog.yaml` — the `<meta>` description
each game's page carries — is written from that game's own `SPEC.md` and manifest, in our
voice, and is deliberately not this text (#2513 item 7, CLAUDE.md rule 1).
`apps/web/src/data/research-provenance.test.ts` holds both ends of that: every observed game
keeps a row here and no other game gains one, and a catalogue rule that comes back to matching
the row beside it fails the build.

Method: five emulator sweeps driving the app with `adb`, then parallel transcription of
every captured screen. The app draws its text to canvas, so nothing was readable through
the accessibility tree — every line below came from looking at the screen, and no APK was
ever unpacked or decompiled.

## Catalog completeness, verified

The catalog was checked against the app rather than assumed complete. A separate
scan captured the whole grid in 60 overlapping steps — small enough that no row
could fall between two captures — and twelve readers enumerated every card.

- **111** distinct card titles were read
- **4** of those were partial reads of cards clipped at the screen edge
  (`IC TAC TOE`, `LADDERS`, `PERSON`, `SHUT TI`)
- **107** real games remain, and every one maps to a catalog entry
- **0** catalog entries are absent from the grid

Both directions agree, so the catalog is complete: nothing in the app is missing
from our backlog, and nothing in our backlog was invented.

## What the modes tell us

- **vs Friend:** 100 games — every game, as expected
- **vs Bot:** 99 games — so 8 have no CPU opponent
- **Solo:** 10 games — a score-attack mode distinct from both
- **Per-game options gear:** 15 games

A game's manifest must declare which modes it supports; assuming all three would put dead
buttons on the lobby for the games that lack them.

## Rules

| Game (ours) | In reference app | Modes | Options | Rules as stated |
|---|---|---|---|---|
| **Air Hockey** | Air Hockey | friend, bot |  | Score in the opposing goal! Use your finger to move your paddle and get 3 goals! |
| **Animal Stack** | Animal Stack | friend, bot, solo | gear | Take turns dropping animals. First player to drop an animal off the platform loses, so take care to drag left & right, and tap to rotate before you drop. |
| **Archery** | Archery | friend, bot | gear | Tap the screen, drag to aim, and release the arrow. Watch out for the wind! Hit the inner rings for higher scores. The player with the most points after three rounds wins. |
| **Archery Master** | Archery Master | friend, bot |  | Load your bow and hit 70 targets before your opponent! |
| **Backgammon** | Backgammon | friend, bot |  | Move your fifteen checkers according to the roll of two dice. The objective is to move all checkers into your home board and then bear them off. You can also hit opponent's blots to send them to the bar, delaying their progress. |
| **Ball Games** | Ballgames Physics | friend, bot |  | Shoot and score with every part of your body |
| **Basketball** | Basket Ball | friend, bot |  | Hoop! Take the ball when it's in your half of the field and shoot. Until the ball bounces off the ground, the opponent can't touch it! |
| **Beach Ball** | Beach Ball | friend, bot |  | Try to shoot the beachball over the opponent's side. First to 3 wins. |
| **Blocks** | Blocks | solo |  | Place blocks in the 9x9 board and fill rows, columns or squares to clear them from the game. |
| **Bowling** | Bowling | friend, bot | gear | Classic 10 pin bowling. Swipe to shoot your ball and knock down the pins. Highest score after 4 rounds wins! |
| **Brick Blast** | Brick Blast | friend, bot |  | Move the paddle with your finger to keep the balls in play. If you miss, your opponent scores a point. |
| **Broken Tiles** | Broken Tiles | friend, bot |  | Run around but watch out, the ice breaks every time you run over it or stop on it. |
| **Cannon Duel** | Cannon Duel | friend, bot |  | Use timing to aim and shoot your opponent's cannon. Watch out for the wind! First to get 3 hits wins |
| **Carrom** | Carrom | friend, bot |  | Pot all your pucks before your opponent and win. The Queen can be potted anytime but it must be potted before the last puck and must be covered immediately in the same turn. |
| **Checkers** | Checkers | friend, bot | gear | Capture all your opponent's pieces! |
| **Chess** | Chess | friend, bot | gear | Chess! Capture your opponent's king and keep yours alive! |
| **Chicken Jump** | Chicken Jump | friend, bot |  | Jump to stack blocks and get points if the block stops in the middle before the chicken lands on it. |
| **Colour Wars** | Color Wars | friend, bot |  | Try to fill the entire field with your color. Click on your circles to enlarge the dots by one. Take 4 new squares when you reach 4 white dots in a circle. |
| **Cornhole** | Cornhole | friend, bot | gear | Throw your bags into the hole and try to push the other players' bags off the board. |
| **Crabby Volley** | Crabby Volley | friend, bot |  | Drop the ball into your opponent's field! Five points to win! |
| **Crash It** | Crash It | friend, bot |  | Drive, jump and flip your car by tapping the buttons. Hit your opponent on the head with your car to score points and watch your own head so that nothing touches it! |
| **Cup Pong** | Cup Pong | friend, bot |  | Swipe up to throw balls into cups!
Land in the cup to remove it. First to clear all your cups wins! |
| **Darts** | Darts | friend, bot | gear | Take turns throwing darts and be the first to score 301 points. The last dart must hit the exact score. |
| **Dice Yatzy** | Yazy | friend, bot | gear | Take turns rolling the dice and try to score as many points as possible based on the combinations on the sheet. |
| **Disco Battle** | Disco Battle | friend, bot |  | Go wild at the disco! Press at the right moment when the notes hit your platform! Each mistake will lower your score, the one with more points at the end of the song wins! |
| **Dots and Boxes** | Dots And Boxes | friend, bot | gear | Take turns tapping horizontal or vertical lines to connect the boxes. The last line that completes a box turns it into the line color. Own the most boxes to win. |
| **Drop Four** | 4 In A Row | friend, bot |  | Connect 4 of the same colored discs in a row to win. |
| **Dung Battle** | Dung Battle | friend, bot |  | Move your beetle and bring the precious brown ball to your base! Don't get too close to ladybugs! |
| **Explosive Festival** | Explosive Festival | friend, bot |  | Hit your opponent's side of the screen! Press to fire your rocket! |
| **Fatal Siege** | Fatal Siege | friend, bot |  | Don't let the enemy soldiers get close, smash them first! Press at the right moment and hold to shoot farther! |
| **Flappy Jump** | Flappy Jump | friend, bot |  | Tap to jump and shoot as many baskets as you can. First to 10 wins. |
| **Frogs Fight** | Frogs Fight | friend, bot |  | Jump among the water lilies and catch the bugs! The dragonfly is worth 5 points and the first to reach 10 wins! |
| **Frozen Beaks** | Frozen Beaks | friend, bot |  | Collect 30 fish! Move your finger to walk and release it to slide on the ice! Don't fall in the hole! |
| **Fruit Duel** | Fruit Duel | friend, bot |  | Watch the icon in the center and tap the saber as soon as you see a fruit (watermelon, pomgrenade, orange). First to 10 wins. |
| **Golf Football** | Golf Football | friend, bot |  | Score points by shooting the ball into the hole. Find the right angle and the right power. The longer you press, the stronger the shot. |
| **Gravity Run** | Gravity Run | friend, bot |  | Tap to change gravity. Run fast and don't fall! |
| **Guard and Thief** | Guard And Thief | friend, bot |  | The thief has to collect the coins, the guard must catch the thief. Whoever has more coins at the end of the match wins! |
| **Guess Who** | Guess The Person | friend, bot | gear | Ask yes/no questions to narrow down which character the other player chose and guess it before they do. |
| **Hammer Hit** | Hammer Hit | friend, bot | gear | Hit the hammer when the needle is pointing up. The closer to the white line, the stronger the hit. The best score in 3 rounds wins! |
| **Hand Slap** | Hand Slap | friend, bot |  | Slap to score. Dodge to avoid. Dodging without a slap gives the attacker a point. First to 5 points wins! |
| **Happy Birds** | Happy Birds | friend, bot |  | Tap to fly. Avoid the spikes! Survive 3 times to win. |
| **Happy Hippos** | Happy Hippos | friend, bot |  | Tap to eat balls and score. +2 points for your color, and -1 if you eat your opponent's color. First to 50 points wins! |
| **Hot Potato** | Hot Potato | friend, bot |  | Tap at the right moment to make the potato fly into your opponent's arms. |
| **King of the Yard** | King Of The Yard | friend, bot |  | Take the crown and keep it on your head until the time is expired! Don't let your opponent touch you! |
| **Knife Thrower** | Knife Thrower | friend, bot |  | Tap to throw knives. Land in the wood, avoiding other knives. First to 20 wins. |
| **Light Fingers** | Light Fingers | friend, bot |  | Steal the diamond faster than your opponent! First to 5 wins! |
| **Ludo Dash** | Ludo | friend, bot |  | Race one token from start to finish according to the rolls of a die. The first player to move one tokens to the end wins the game. Roll a six to move a token out of the starting area. Capture opponents' tokens by landing on the same space. |
| **Lumberjack** | Lumber Jack | friend, bot |  | Tap on the left or right side to cut down the tree. But be careful not to get hit by the branches! |
| **Mancala Pits** | Mancala | friend, bot |  | Move your stones counterclockwise across the board and try to collect more stones than your opponent! |
| **Match Rush** | Find Match | friend, bot |  | Compare the 2 sets of objects. Find the 1 matching object before your opponent to earn a point. First to 10 points wins! |
| **Math Duel** | Math Quiz | friend, bot |  | The first player to solve the task gets a point. For any wrong answer the opponent gets a point. First to 10 wins. |
| **Maze Paint** | Maze Paint | solo |  | Swipe to paint all squares to complete each level! |
| **Memory Match** | Memory | friend, bot |  | Flip 2 cards and find pairs. |
| **Mini Golf** | Mini Golf | friend, bot |  | Hole in one! The player with 2 points more than the other wins! |
| **Mini Soccer** | Mini Soccer | friend, bot |  | Move your finger to control your team! Who has scored more after 90 seconds wins! |
| **Money Grabber** | Money Grabber | friend, bot |  | Drag the money to your safe box using all the fingers of your hand! |
| **Nuts and Bolts** | Nuts And Bolts | solo |  | Move nuts between the bolts until all the nuts on each bolt are the same colour!

You can only move nuts onto other nuts of the same colour. |
| **Paint Fight** | Paint Fight | friend, bot |  | Paint the screen with your color! The winner is the one who painted the most after 45 seconds! |
| **Penalty Kicks** | Penalty Kicks | friend, bot |  | Swipe your finger to dive or to kick the ball! First to 5 win! |
| **Pinball Duel** | Pinball | friend, bot |  | Tap left and right to fire the ball right in your opponent goal! |
| **Ping Pong** | Ping Pong | friend, bot |  | Use your finger to move the racket and to spin the ball. Get 7 points to win! |
| **Piranha Rush** | Piranha Rush | friend, bot |  | Run from the piranhas! And watch out for corals! |
| **Pizza Memory** | Pizza Memory | friend, bot |  | Watch the order and recompose the pizza exactly as you saw it. When you're done, remember to ring the bell! |
| **Pool** | Pool | friend, bot |  | A classic! Throw the balls of your color into the holes and finally the black ball! |
| **Pop It** | Pop It | friend, bot |  | Players take turns pressing down any number of bubbles in a single row and consecutively. The player who presses down the last bubble loses the game. |
| **Pull the Rope** | Pull The Rope | friend, bot |  | Tap as fast as you can to pull hard! Pull the flag across the line to win! |
| **Racing Cars** | Racing Cars | friend, bot |  | Compete against your opponent and finish first! Move your finger to drive the car. |
| **Rat Race** | Rat Race | friend, bot |  | Press to run! Run away from the cats' paws and collect the pieces of cheese before your opponent! |
| **Reversi** | Reversi | friend, bot |  | Fill the board with more pieces of your color than the opponents to win! |
| **Road Dodge** | Road Dodge | friend, bot |  | Tap to steer left and right to dodge obstacles on the road |
| **Robot Arena** | Robot Arena | friend, bot |  | Survive the obstacles in the deadly robot arena! Dodge lasers, spinning blades and cannonballs! |
| **Rock Paper Scissors** | Rock Paper Scissors | friend, bot |  | Press the button of your choice before the hand stops. First to 3 wins. |
| **Sea Battle** | Sea Battle | friend, bot |  | Place your ships without showing your opponent and take turns guessing your opponent's ship locations |
| **Ship Battle** | Ship Battle | friend, bot |  | Protect your ship from your opponent's cannon shots! Move your finger to move the shield! |
| **Shuriken** | Shuriken Bamboo | friend, bot |  | Cut the bamboo canes of your opponent! Grab the shuriken and throw it! Move your finger to add spin to your shot. |
| **Shut the Box** | Shut The Box | friend, bot |  | Roll the dice, then flip one or more numbered tiles that add up to your roll. Keep playing until no move is possible. |
| **Sliding Puzzle** | Sliding Puzzle | solo |  | This is a classic Sliding Puzzle game. Move the boxes into the correct order. |
| **Sling Puck** | Sling Puck | friend, bot |  | Shoot all pucks into the opponent's side of the board to win |
| **Slot Cars** | Slot Cars | friend, bot |  | Tap the screen and race your car round the laps as fast as you can. But be careful, if flames come out of the car, you should slow down in the curves by taking your finger off the screen! |
| **Snake Clash** | Snakes | friend, bot |  | Don't touch the other player's snake body! Move your finger to change direction and stay alive! |
| **Snakes and Ladders** | Snakes & Ladders | friend, bot |  | Roll a die to move across the board. Land on a ladder to climb higher, or a snake to slide down. First to reach or pass the last field wins! |
| **Snowball Throw** | Throw | friend, bot |  | Snowball fight! Pull back to aim. Release to throw. Hit your opponent. First to reduce their opponent's health to zero wins! |
| **Soccer Pool** | Soccer Pool | friend, bot |  | Take turns to hit the ball and score. |
| **Solitaire** | Solitaire | solo | gear | This is a classic Solitaire game. Depending on the selected difficulty, different numbers of cards are revealed. |
| **Spike Attacks** | Spike Attacks | friend, bot |  | Hide behind the stones so you don't get hit by the spikes. |
| **Spin War** | Spin War | friend, bot |  | Push your opponent out of the bowl! Use your finger to move the spinner! 4 points to win! |
| **Stampede** | Stampede | friend, bot |  | Look for dangers coming from the left or right and jump to avoid them |
| **Star Catcher** | Star Catcher | friend, bot |  | Catch all the stars and be aware of black holes! First to get 7 stars wins! |
| **Sticky Tongues** | Sticky Tongues | friend, bot |  | Use your tongue to catch the dragonfly, and use the joystick to escape from your opponent's blows! Don't miss too many shots or you'll lose the match! |
| **Sudoku** | Sudoku | solo | gear | Play Sudoku, train your brain and beat your highscore |
| **Sumo Push** | Sumo | friend, bot |  | Tap as fast as you can to push out your opponent! Stay in the ring! |
| **Sword Throwing** | Sword Thrower | friend, bot |  | Draw your sword and throw it towards the targets of your enemy. Hold it in your hand and move it to parry your opponents throws! |
| **Tanks** | Tanks | friend, bot |  | Destroy the enemy tank. Use the left stick to move and the right to shoot! |
| **Tap Match** | Tap Match | solo |  | Tap to collect cards. Complete sets of 3 to clear cards. You can hold up to 7 cards in your stack, so collect strategically. |
| **Target Practice** | Target Practice | friend, bot |  | Shoot targets to score points. Small targets score double. First to 10 points wins. Tap to start, then tap to aim up, then tap to fire. |
| **Taxi Race** | Taxi Race | friend, bot |  | Drive your taxi past the other cars or jump over them. Swipe your finger to the left, right or up. |
| **Tennis** | Tennis | friend, bot |  | Click to jump with the player and hit the ball. If you hit it with the center of the tennis racket, the ball will go really fast. |
| **The Last Sashimi** | The Last Sashimi | friend, bot |  | Eat all before your opponent! First to 15 wins, sashimi is worth 1 point, onigiri is worth 3 point and for every mistake you lose a point! |
| **Tic Tac Toe** | Tic Tac Toe | friend, bot | gear | Red is cross, blue is circle! |
| **Traffic Jam** | Traffic Jam | friend, bot |  | Crash your opponent and be careful not to fall into the water! Use the joystick to steer. |
| **Ultimate Tic Tac Toe** | Ultimate Tic Tac Toe | friend, bot |  | Play on a big board with nine small tic-tac-toe games. Where you place your mark tells the other player where they must play next. Win small boards, then get three small boards in a row to win. |
| **Unfair Fishing** | Unfair Fishing | friend, bot |  | Throw the bait and rewind the reel! First to catch 25 fishes wins! |
| **Water Game** | Water Game | friend, bot |  | The balls swim in water. Give the balls speed by pressing the buttons. Let the ball fly through the basket. First to 15 wins. |
| **Whack a Mole** | Whack A Mole | friend, bot |  | Hit the moles, but only those of your color! The first one that gets to 30 wins! |
| **Wheelie** | Wheelie | friend, solo |  | Accelerate your bike to pull up a wheelie. Earn more points the longer you maintain a wheelie. |
| **Wobble Stack** | Brainrot Stack | friend, bot, solo | gear | Take turns dropping brainrots. First player to drop a brainrots off the platform loses, so take care to drag left & right, and tap to rotate before you drop. |
| **Wrestle** | Wrestle | friend, bot |  | Jump and try not to fall on your head. Try to push your opponent to the ground instead. Watch the wind! |
