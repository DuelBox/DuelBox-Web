# Input latency lab (#133)

`GameHost` now connects `LatencyMeter` to its real input-consumption path when a
development page has `?debug=1`. Open `/play/mini-soccer/?debug=1`, start a match,
and press a bound key, use the board pointer, or change an assigned controller's
mapped stick/button. The overlay reports sample count, mean, last and maximum
milliseconds per input family. No samples means unmeasured, not instantaneous.

## What the number measures

Keyboard and pointer rows are **browser event-to-step**: `Event.timeStamp` to
`performance.now()` immediately before the live fixed step calls `input.beginStep`.
This includes time waiting for a step and any delay delivering the browser event.
It excludes physical hardware/OS latency before the browser created the event,
game update duration, drawing and display scanout. The DOM clock is the event's
creation time, not the listener's arrival time ([DOM Standard](https://dom.spec.whatwg.org/#dom-event-timestamp)).

The gamepad row is **browser sample-to-step**. The optional observer in
`browserGamepadSource` sees the exact native array that the adapter converts for
the manager's single poll. After assignment, deadzone and input quantization, the
meter records only a changed assigned seat's effective intent with a fresh valid
`Gamepad.timestamp`. It never polls the platform a second time or substitutes the
poll time. That timestamp describes received axes/button data, not the physical
press ([Gamepad specification](https://www.w3.org/TR/gamepad/#dom-gamepad-timestamp)).
The platform supplies its latest sample; intermediate controller changes between
polls cannot be reconstructed. DOM and controller rows therefore have different
starting boundaries and must not be used to rank hardware.

Each family contributes at most one observation per consuming step. A burst keeps
the earliest pending source timestamp, measuring the longest wait in that window.
Unbound keys, browser chords, key repeats and pointer hover are excluded. Pointer
drag/release/cancel are measured only after a tracked down. Unassigned controllers,
unmapped buttons, unchanged held state and stick changes below the input envelope
are excluded. Zero, nonfinite, future and epoch-based timestamps are unavailable;
stale controller timestamps do not produce new measurements. Precision reduction
in the browser's clock limits the precision of these results.

Pause/resume, lost focus, modifier-release and surface loss discard pending
observations without erasing completed statistics. Controller state is primed on
attachment/reassignment/resume, so an old held sample is not reported as a new
press. A fresh game host starts fresh statistics.

## Reproducing the lab

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium webkit firefox
pnpm e2e:latency
```

The dedicated Playwright configuration builds package outputs, starts Next's
development server on `127.0.0.1:4191`, refuses to reuse another server, and runs
Chromium, WebKit and Firefox sequentially with one worker. The ordinary production
E2E suite skips this file because the production export deliberately omits the
overlay. Run on an otherwise idle machine; concurrent builds and browser suites
change the quantity being measured.

The first test freezes animation-frame delivery while the real host receives all
three input families. The overlay must still report zero samples until a fixed
step runs, including after a deliberately delivered zero-delta render frame.
Known delayed source timestamps then provide lower bounds on the
measured latency; replacing them with listener/poll arrival time fails the test.
Unbound keys, a modifier chord, hover, repeats and held-pad timestamp refreshes
also have negative assertions. Unit tests cover invalid timestamps, burst windows,
assignment, quantization, pause and timestamp recovery with exact numbers.

The second test records 40 separately consumed edges for each family: Playwright
keyboard down/up, mouse down/up on the board, and controlled changes injected only
at `navigator.getGamepads`. Each edge is separated by two animation frames. This
is a reproducible cadence, not a randomized human-input distribution. It emits a
JSON attachment with unrounded statistics, browser version, CPU, OS, Node version
and run time under `test-results/input-latency/`. There is no universal latency
threshold in the test: it asserts measurement semantics and sample completeness,
not that a loaded CI runner meets a performance promise.

## Scope and production cost

This is a **headless development-build lab on one machine**, not a physical-device
baseline or a shipping-build performance claim. Keyboard/pointer events come from
browser automation. Gamepad results are specifically **injected-sample-to-step**;
no physical controller, USB/Bluetooth transport or native controller driver was
measured. Dev compilation, instrumentation, timer precision, compositor behavior
and host load can all affect the numbers. Touch, pen and trackpad follow the same
pointer code, but this mouse-driven run does not measure their hardware paths.

The meter and overlay are loaded only under the host's development build guard
and `?debug=1`. Production retains only an optional observer check in the existing
gamepad adapter; no observer is supplied, no extra platform poll runs, no timestamp
is read, and no measurement state is created. A focused adapter regression holds
that normal path. The dev step path reuses state and allocates no arrays/objects;
JSON and readout objects are created only on the overlay's 250ms sampling timer.
The production build guard checks both the overlay's runtime ID and the latency
helper's public `captureGamepads` method in emitted code, and disallows static
runtime imports of either debug module from the application.

## Recorded run

Recorded on **2026-09-26, 04:57–04:59 UTC**, Apple M5, Darwin 27.0.0,
Node 26.8.1, Playwright 1.62.1 and Next.js 15.5.25. All six browser checks passed;
all three browser projects ran headless, sequentially. Each measurement used a
fresh page; the preceding semantic test had compiled the route in the dev server.
The two animation-frame spacing is part of this workload. Values are milliseconds.

| Browser | Family | Samples | Mean | Min | Max |
| --- | --- | ---: | ---: | ---: | ---: |
| chromium 151.0.7922.34 | keyboard | 40 | 12.45 | 1.00 | 27.80 |
| chromium 151.0.7922.34 | pointer | 40 | 10.28 | 0.70 | 28.80 |
| chromium 151.0.7922.34 | Gamepad (injected sample) | 40 | 12.47 | 3.50 | 28.60 |
| webkit 26.5 | keyboard | 40 | 26.93 | 3.00 | 63.00 |
| webkit 26.5 | pointer | 40 | 27.13 | 10.00 | 63.00 |
| webkit 26.5 | Gamepad (injected sample) | 40 | 35.60 | 1.00 | 407.00 |
| firefox 153.0 | keyboard | 40 | 13.72 | 1.00 | 66.00 |
| firefox 153.0 | pointer | 40 | 28.80 | 4.00 | 128.00 |
| firefox 153.0 | Gamepad (injected sample) | 40 | 20.40 | 1.00 | 133.00 |

The [raw recorded JSON](input-latency-baseline.json) retains unrounded values,
last-sample values, versions and timestamps. The **407ms WebKit injected-gamepad
outlier is retained**, including in its mean; no observations were filtered or
re-run to obtain a lower number. These small samples establish a reproducible lab
baseline, not a latency guarantee or a hardware/browser ranking. The harness
measures stalls as well as ordinary frames; this run does not identify the cause
of any particular stall.
