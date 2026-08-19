# Keyboard rollover, ghosting, and why the default bindings are what they are

Two people sharing a laptop have one keyboard between them. That keyboard is a piece of
hardware with limits neither player can see and neither chose, and if the defaults ignore
those limits the second player's controls stop working at exactly the moment the game
gets interesting — when both of them are holding keys down.

This is not a preference. It decides which keys we may hand out.

## What actually goes wrong

**Ghosting** is a keyboard reporting a key that nobody pressed. **Blocking** — the more
common failure, and the one that matters here — is a keyboard silently dropping a real
press because it cannot represent it. Both come from the same cause.

A commodity membrane keyboard does not have a switch per key wired to its own line. It has
a grid: rows and columns, one contact where they cross. The controller scans the grid and
infers which keys are down from which crossings conduct. With two keys held this is
unambiguous. With three, it sometimes is not: three corners of a rectangle in the grid
conduct exactly as all four would, so the controller either invents the fourth key
(ghosting) or, on any keyboard made in the last twenty years, refuses to report the third
(blocking). Diodes per key would remove the ambiguity; they cost money, so cheap keyboards
do not have them.

The consequence for us: **on many laptop and desktop keyboards, only two or three
simultaneous keys are guaranteed, and which combinations fail depends on the grid layout
of that specific model.** There is no way to detect this from the browser. `KeyboardEvent`
reports what the controller reported; a press that was blocked simply never arrives.

## What this rules out

Our worst case is both seats moving diagonally while both press their action key: six keys
at once. No membrane keyboard will do that reliably, and no arrangement of bindings makes
it work. What we can do is choose keys that fail as *late* and as *fairly* as possible.

Three rules follow.

**Keep the two seats in different regions of the grid.** Keys that are physically far
apart are usually on different rows and different columns, so a rectangle spanning both
seats is less likely. Two seats sharing a region is the arrangement most likely to have
one player's press cancel the other's.

**Prefer the modifier-adjacent keys the controller special-cases.** Most keyboards wire
the modifiers — Shift, Control, Alt, and usually Space and Enter — outside the ambiguous
part of the grid, precisely because they are held while other keys are pressed. An action
key chosen from that set survives when an ordinary letter would not.

**Never put a seat's action on a letter if a modifier-adjacent key is available.** The
action is the key most likely to be pressed *while* a direction is held, which is exactly
the case that blocks.

## The defaults, and why

```
seat one   W A S D   +  Space
seat two   ↑ ↓ ← →   +  Enter
```

- **Opposite ends of the keyboard.** WASD sits at the far left, the arrow cluster at the
  far right. On a standard layout they are about as far apart in the grid as two reachable
  regions can be, so a rectangle spanning both is unlikely.
- **Both action keys are modifier-adjacent.** Space and Enter are the two keys most
  commonly wired outside the ambiguous grid, so each seat's action is the press least
  likely to be dropped while that seat is holding a direction.
- **Neither half needs a modifier.** A binding requiring Shift or Control would collide
  with the browser and the OS, and we deliberately ignore any keydown carrying Ctrl, Meta
  or Alt so that Cmd+W, Ctrl+R and Alt+Tab keep working. A player must never be trapped in
  the page.
- **The arrow cluster is an inverted-T, not a diamond.** Its keys are physically separated
  in the grid in a way that a four-letter square such as IJKL is not.

### What we deliberately did not choose

- **IJKL / ESDF for seat two.** Both sit in the crowded centre of the grid, close to seat
  one's cluster, and neither has a nearby action key that is modifier-adjacent.
- **Shift or Control as an action.** Collides with browser shortcuts, and on some layouts
  the two Shift keys share a scan line with each other.
- **Numeric keypad for seat two.** Not present on the laptops this product is mostly played
  on, and absent entirely on the compact keyboards it is played on otherwise.

## What we can honestly claim

**Each seat alone, at full tilt, works everywhere.** One seat holding two directions plus
its action is three keys within one region, which every keyboard handles.

**Both seats at moderate tilt works on essentially everything.** One direction each plus
one action is four keys spread across two distant regions.

**Both seats diagonal with both actions is not guaranteed on membrane hardware, and cannot
be.** On a keyboard with per-key diodes — most mechanical keyboards, and Apple's built-in
laptop keyboards, which have unusually good rollover — it works. On a cheap membrane
keyboard it may not, and no binding scheme we could ship would change that.

## Consequences for game design

Because the six-key case cannot be guaranteed, **no game may require both seats to hold a
diagonal and press an action at the same instant to play correctly.** A game whose core
loop needs that is a game that does not work on a shared keyboard, and it should declare
`sameInputClassOnly` in its manifest rather than shipping something that fails on hardware
we cannot see.

Games where each seat's action is a discrete tap rather than a held key are unaffected.
That is most of the catalogue.

## What is verified, and what is not

Tested in the browser suite: both seats register in the same step, direction and action
together; every diagonal of both seats is normalised to unit length so a diagonal is never
faster than a straight line; a keydown carrying Ctrl, Meta or Alt is ignored entirely; and
releasing a modifier clears held keys, because on macOS a letter pressed with Command held
never delivers its keyup and would otherwise stay down for the rest of the match.

**Not yet verified: the physical-hardware claim.** The acceptance criterion on #2421 asks
for verification on at least three physical keyboards, and a browser test cannot provide
it — Playwright synthesises key events downstream of the controller, so it reports what
the code does with a press, never whether that press would have survived the hardware.
That check needs three real keyboards of different classes (a membrane laptop, an external
membrane, and one with per-key diodes) and a person to hold the keys down.
