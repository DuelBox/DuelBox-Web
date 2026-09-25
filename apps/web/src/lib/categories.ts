import type { CatalogueEntry } from '../data/catalogue.generated';
import { formatRound } from './format';

/**
 * The eighteen category hubs, and the copy each one is built from (#200).
 *
 * A hub answers a question somebody types into a search engine — "two player board games
 * on one screen" — which the catalogue page cannot answer, because it answers all eighteen
 * at once and therefore none of them well. So each category gets an address, a heading and
 * a paragraph written for it.
 *
 * The paragraphs are written by hand, one per category, and that is the whole point rather
 * than an oversight. Eighteen pages generated from one template with the category name
 * substituted in is the definition of thin duplicate content: it is the shape a search
 * engine is specifically looking for when it decides not to index a set of pages. What
 * makes a hub worth having is the part a template cannot produce — what these particular
 * games have in common, which of them are worth naming, and how long a round of one
 * actually takes. Every blurb below names real games from its own category and says
 * something true about that category and no other.
 *
 * Only the copy lives here. The games in a category come from the catalogue at render time,
 * so a game added to Board appears on the Board hub without this file being touched, and a
 * blurb can never claim a count that the grid below it contradicts.
 *
 * Ordered by how many games the category holds, largest first — `categories.test.ts` checks
 * that against the real catalogue. The order is load-bearing: the footer links the first six
 * from every page in the site, so the hubs a crawler reaches most cheaply are the ones with
 * the most behind them.
 *
 * Every string a hub page renders from this module is translated through the same lookup the
 * rest of the site uses (#220) and is registered in `lib/i18n/sources.ts` as
 * `category hub copy`, because the page passes it as a variable and the extractor reads
 * literals. The two sentences the *page* used to build for itself — the heading over the
 * games grid and the line about how long a round takes — are functions here rather than
 * private helpers there, for the reason the blurbs are here at all: what a page assembles
 * inline is copy nothing can register, hold to the house voice, or hand a translator. The
 * `intent` field is deliberately **not** registered: it reaches a reader only through the
 * route's `metadata`, which stays English (`docs/i18n.md`), and a registered string the site
 * never renders is an orphan `i18n.test.ts` refuses.
 */

/** One hub: where it lives, what it covers, and the prose that makes it worth indexing. */
export interface CategoryHub {
  readonly slug: string;
  readonly category: string;
  readonly title: string;
  readonly blurb: string;
  readonly intent: string;
}

/**
 * A category's address.
 *
 * Lower-cased, and every run of anything that is not a letter or a digit becomes one
 * hyphen — so "Racing & Trails" is `racing-trails` and the ampersand never reaches a URL.
 * A function rather than a field on each hub, because a slug written out by hand beside the
 * category it belongs to is a slug that can be written out wrongly; this cannot disagree
 * with the category it came from. `categories.test.ts` checks that no two of the eighteen
 * collide, which is the one failure the derivation could still produce.
 */
export function categorySlug(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The hubs as written, before each one is given the address its category implies. */
const WRITTEN: readonly Omit<CategoryHub, 'slug'>[] = [
  {
    category: 'Sports',
    title: 'Two-player sports games',
    intent: 'Two player sports games on one phone',
    blurb:
      'Games that take their rules from a real sport and shrink the pitch to one screen. Air ' +
      'Hockey and Tennis run in real time with both halves moving at once; Bowling and Darts ' +
      'take turns instead, and the board turns to face whoever is to play. Most finish inside ' +
      'two minutes, and Pool is the long one at about five.',
  },
  {
    category: 'Party',
    title: 'Party games for two players',
    intent: 'Party games for two people with nothing to set up',
    blurb:
      'The games to reach for when somebody has half a minute and no appetite for a rulebook. ' +
      'One idea each, learned by playing it: bank more of the drifting notes in Money Grabber, ' +
      'take the pond before the other frog does in Frogs Fight, own more of the floor in Paint ' +
      'Fight. Most are over inside a minute, and none of them runs past three.',
  },
  {
    category: 'Board',
    title: 'Two-player board games',
    intent: 'Board games for two on one screen',
    blurb:
      'Turn-based games with a board between the two players, so the screen turns a hundred ' +
      'and eighty degrees each turn and both people read it upright from their own side of ' +
      'the device. Chess, Checkers and Backgammon are here in full, castling and bearing off ' +
      'included, alongside shorter grids like Reversi and Dots and Boxes. Chess is budgeted ' +
      'at five minutes; Tic Tac Toe is a minute.',
  },
  {
    category: 'Shooter',
    title: 'Two-player shooting and aiming games',
    intent: 'Two player target and archery games',
    blurb:
      'Games about aiming rather than about being quick. Each one asks for a line and then a ' +
      'strength — the draw on the bow in Archery, the angle and the powder in Cannon Duel — ' +
      'and the shot then goes where it was sent while a crosswind or a moving target argues ' +
      'with it. Both seats fire under the same conditions, and most rounds take ninety ' +
      'seconds, with Tanks the quick one.',
  },
  {
    category: 'Solo',
    title: 'Solo games played as a duel',
    intent: 'Single player puzzles two people can take turns at',
    blurb:
      'Puzzles built for one person, dealt once and then played by two. Solitaire, Sudoku and ' +
      'Sliding Puzzle put a single board between both seats and alternate the moves, so a ' +
      'card sent to a foundation or a square answered correctly is a square the other player ' +
      'no longer has. Most take ninety seconds; Maze Paint is the short one at forty-five.',
  },
  {
    category: 'Racing',
    title: 'Two-player racing games',
    intent: 'Two player racing games on one device',
    blurb:
      'Games about a lane and the traffic in it. Both players run their own strip of road side ' +
      'by side and the same hazards arrive for both, so nobody is unlucky in a way the other ' +
      'was not: Road Dodge leaves exactly one lane open, Slot Cars charges two seconds for a ' +
      'corner taken too fast, and Wheelie makes speed itself the thing that tips you over. ' +
      'Nothing here runs beyond a minute and a quarter, and Crash It is settled in twenty ' +
      'seconds.',
  },
  {
    category: 'Arena',
    title: 'Two-player arena games',
    intent: 'Two player pushing and shoving games',
    blurb:
      'One floor, two bodies, and no turns to hide behind. Everything is decided by where you ' +
      'stand and how hard you arrive: Sumo Push wants the other wrestler past the edge of the ' +
      'ring, Spin War wants their top out of the dish, and King of the Yard wants the crown ' +
      'while making whoever wears it the one being chased. Nothing here runs longer than ' +
      'ninety seconds.',
  },
  {
    category: 'Reaction',
    title: 'Reaction games for two players',
    intent: 'Two player reaction speed games',
    blurb:
      'Both players see the same thing at the same instant, and the only question is who ' +
      'answers first. Math Duel shows one sum and four answers, Match Rush hides a single ' +
      'shared symbol in two sets of five, and Fruit Duel scores against anyone who cuts ' +
      'something that was not fruit. A wrong answer scores for the other seat in all three, ' +
      'so accuracy is worth more than speed, and no round is longer than ninety seconds.',
  },
  {
    category: 'Platform',
    title: 'Two-player platform games',
    intent: 'Two player jumping games on one screen',
    blurb:
      'Games about timing a jump. Each player gets a strip of their own — a sky in Happy ' +
      'Birds, a lane in Gravity Run, a perch in Chicken Jump — and the gap or the block ' +
      'arrives for both at the same moment, so the loser is whoever ran out of timing first. ' +
      'About a minute each, and Stampede is shorter.',
  },
  {
    category: 'Survival',
    title: 'Two-player survival games',
    intent: 'Two player survival games in a browser',
    blurb:
      'Games where the floor is the opponent. Robot Arena puts both robots on a disc that ' +
      'sweeps, fires and drops things on them; Spike Attacks sends a volley down a row of ' +
      'standing stones that crack a little further with every blow, so the cover runs out ' +
      'while the volleys do not. Whoever is still standing takes the round, three rounds take ' +
      'the match, and a round is about a minute.',
  },
  {
    category: 'Puzzle',
    title: 'Two-player puzzle games',
    intent: 'Two player puzzle games on one screen',
    blurb:
      'Two games with almost no rules and a great deal to think about. Pop It is a game of ' +
      'Nim in disguise: choose any run of neighbouring bubbles in one row, and whoever is ' +
      'left with the last bubble loses. Traffic Jam has the opposite temperament, two cars ' +
      'shouldering each other towards the water around one island — three minutes of ' +
      'arithmetic against forty-five seconds of shoving.',
  },
  {
    category: 'Memory',
    title: 'Memory games for two players',
    intent: 'Two player memory and matching games',
    blurb:
      'Games about holding something in your head a few seconds longer than the person ' +
      'opposite. Memory Match is the sixteen-card table, where a matched pair keeps the turn, ' +
      'so somebody who remembers can clear it in a single visit; Pizza Memory deals an order, ' +
      'hides it, and asks for it back from the rail in front of you. Either one is done in ' +
      'about a minute.',
  },
  {
    category: 'Dice',
    title: 'Two-player dice games',
    intent: 'Two player dice games with no dice needed',
    blurb:
      'The roll is all of the luck, and the decision is what to spend it on. Dice Yatzy gives ' +
      'you five dice, three rolls and thirteen boxes that each take exactly one hand, so the ' +
      'skill is in spending a bad roll cheaply; Shut the Box is the shorter one, closing ' +
      'numbered tiles until nothing adds up any more. Yatzy is the longest game in the ' +
      'catalogue at about seven minutes.',
  },
  {
    category: 'Arcade',
    title: 'Two-player arcade games',
    intent: 'Two player arcade games in a browser',
    blurb:
      'Two games built around a ball that never stops and a paddle you own one end of. Brick ' +
      'Blast puts a wall of bricks between the two baselines and keeps two balls in play at ' +
      'once; Pinball Duel gives each side a pair of flippers and a goal to defend. Both are ' +
      'first to five, and both are over inside a minute.',
  },
  {
    category: 'Stealth',
    title: 'Two-player stealth games',
    intent: 'A two player stealth game on one screen',
    blurb:
      'One game, and its whole idea is that neither role is assigned. Guard and Thief keeps ' +
      'the coins you can spend in the other player’s vault, so the moment you leave your own ' +
      'floor you are the thief and they are the guard — and you still have to come home to ' +
      'bank what you carried. About a minute, and a good part of it goes on deciding whether ' +
      'to set off at all.',
  },
  {
    category: 'Rhythm',
    title: 'Two-player rhythm games',
    intent: 'A two player rhythm game in a browser',
    blurb:
      'One game, and the only one in the catalogue timed by a track rather than by a clock. ' +
      'Disco Battle runs the same line of notes at both players at once, each note landing on ' +
      'that player’s own platform, and pays three for dead centre and one for near enough. A ' +
      'note let go costs you, and so does answering a note that was never there, all inside ' +
      'the forty seconds the song lasts.',
  },
  {
    category: 'Racing & Trails',
    title: 'Racing and trail games for two',
    intent: 'A two player snake game on one screen',
    blurb:
      'One game, in a category of its own because it is a race that leaves a wall behind it. ' +
      'Snake Clash puts two snakes in one arena where you can steer but cannot stop and ' +
      'cannot reverse, so the trail you have already laid is as dangerous to you as anything ' +
      'the other snake does. Ten pellets wins, inside two minutes.',
  },
  {
    category: 'Deduction',
    title: 'Two-player deduction games',
    intent: 'A two player guessing game on one device',
    blurb:
      'One game, and it is about asking the right question. Guess Who deals thirty characters ' +
      'and gives each player a different one to find, and a turn goes either on a question ' +
      'that halves the field or on naming a character outright — so guessing early is a real ' +
      'option and usually a poor one. Best of three, about a minute a game.',
  },
];

export const CATEGORY_HUBS: readonly CategoryHub[] = WRITTEN.map((hub) => ({
  ...hub,
  slug: categorySlug(hub.category),
}));

/** Built once: `generateStaticParams` renders every hub, so this is asked for eighteen times. */
const BY_SLUG: ReadonlyMap<string, CategoryHub> = new Map(
  CATEGORY_HUBS.map((hub) => [hub.slug, hub]),
);

/** The hub at an address, or nothing — which is the route's cue to render a 404. */
export function hubFor(slug: string): CategoryHub | undefined {
  return BY_SLUG.get(slug);
}

/**
 * The heading over a hub's games grid: "Board games".
 *
 * One string rather than the category name and the word "games" side by side, because word
 * order is the first thing a translation changes and a language that puts the noun first
 * cannot express it in two fragments the page assembles. `e2e/category-hubs.spec.ts` finds
 * the grid by this exact accessible name.
 */
export function gridHeading(category: string): string {
  return `${category} games`;
}

/**
 * How long a round takes, from the real `roundSeconds` of the games on the page.
 *
 * Compared as *rendered* strings rather than as seconds, which is the difference between a
 * useful line and a silly one: Memory holds a 60-second game and a 75-second one, and both
 * render as "about 1 minute", so comparing the numbers would produce "Rounds run from about
 * 1 minute to about 1 minute". `formatRound` is the one place that decides how a length
 * reads, so it is the thing to ask.
 *
 * It lived in the route file until #220 and moved here so that the strings it can produce
 * can be registered: there are eighteen of them, one per hub, and they are what
 * `lib/i18n/sources.ts` computes from this function over the catalogue, so the registered
 * set is the rendered set by construction rather than by a second copy of the arithmetic.
 * The route still calls it for its `metadata`, which stays English.
 */
export function roundLine(games: readonly CatalogueEntry[]): string {
  const seconds = games.map((game) => game.roundSeconds);
  const shortest = formatRound(Math.min(...seconds));
  const longest = formatRound(Math.max(...seconds));
  return shortest === longest
    ? `A round takes ${shortest}.`
    : `Rounds run from ${shortest} to ${longest}.`;
}
