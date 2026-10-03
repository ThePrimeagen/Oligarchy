# Locator

Where to click on a screenshot, from a description of what is visibly there. One call, `locate`,
asks the `decision-api` service (Cloudflare Clef) once per round; `@oligarchy/screen-grid` cuts and
grids the pictures with sharp.

## Create

```ts
import * as DecisionApi from "@oligarchy/decision-api";
import * as Locator from "@oligarchy/locator";

const decisionApi = DecisionApi.create({ http }, { accountId, token });
const locator = Locator.create({ "decision-api": decisionApi }, {
  grid: config.locator.grid,
  rounds: config.locator.rounds,
  power: config.locator.power,
  boxScale: config.locator.boxScale,
  threshold: config.locator.threshold,
  overviewScale: config.locator.overviewScale,
  gridImageScale: config.locator.gridImageScale,
  quality: config.locator.quality,
  callTimeoutMs: config.locator.callTimeout,
  retries: config.locator.retries,
  retryWaitMs: config.locator.retryWait,
});
```

Every option comes from `oligarchy.json`'s `locator` section. Creation does no work.

| Setting | Checked in | What it does |
| --- | --- | --- |
| `grid` | 4 | cells per side: 4 is a 4x4 grid, 16 questions a round (8 at most: 64) |
| `rounds` | 3 | how many times the box shrinks; the last round's point is the click |
| `power` | 4 | each cell's weight is `p ^ power` |
| `boxScale` | 1.5 | the next round's box is this many cells across, around the point; below `grid` |
| `threshold` | 0.45 | round one's best cell below this is `NotFound` |
| `overviewScale` | 0.5 | the whole screen, no grid, shrunk to this share of its size (0.5 of 1280x800 is 640x400) |
| `gridImageScale` | 1 | the gridded picture is this share of the screen's width: round one's is the screen, later rounds' the box enlarged to it |
| `quality` | 80 | WebP quality of both pictures, 1 to 100: lower is smaller and faster to send |
| `callTimeout` | 5 seconds | one Clef call |
| `retries` | 1 | how many more times a busy, down or slow Clef call is asked |
| `retryWait` | 1 second | the wait before each of those |

Clef appears to scale every picture to about a megapixel, so neither scale is above 1.

## Locate

```ts
const found = await services.locator.locate({
  screen, // PNG, JPEG or WebP bytes, e.g. the guest's image
  target: "the word 'Lock'",
  hint: "'Lock' is the label of the second entry of the System menu, written just right of a padlock icon.",
  task: "Lock the session using the mouse.",
  signal,
});
if (jarl.is_err(found)) return found;
const { x, y } = jarl.value(found); // fractions of the screen: what mouse_move takes
```

Name what is written or drawn, not the widget: "the word 'Lock'" rather than "the Lock entry".
Asking about the entry aimed at its icon, outside the clickable row.

Each round:

1. Draws a `grid` x `grid` lettered and numbered grid over the box (round one: the whole screen),
   enlarged to `gridImageScale` of the screen's width, and sends it after the overview: the whole
   screen at `overviewScale`. Both are WebP at `quality`.
2. Asks one noul per cell: `In image 2, is <target> in grid cell C3 (column C, row 3)? <hint>`.
3. Weights each cell's centre by `p ^ power` over the sum of every cell's, and takes that point.
   A high power keeps the many cells that answer a small yes from pulling the point off the
   target.
4. The next round looks at a box `boxScale` x a cell around that point, kept on the screen.

The last round's point is the answer. `rounds` holds every round's box, cells, best `p`, point and
input tokens, for a log or a picture of what was asked.

## Failures

| Error | When |
| --- | --- |
| `NotFound` | round one's best cell scored below `threshold`; carries `best` and `threshold` |
| `ScreenGrid.ImageInvalid` | the screen bytes are not an image; nothing is asked |
| `DecisionApi.RateLimited`, `Unavailable`, `TimedOut` | still failing after `retries` more asks, `retryWait` apart |
| `DecisionApi.InvalidRequest`, `Refused`, `InvalidResponse` | returned at once, not asked again |
| `Async.Aborted` | the signal aborted, before an ask or while waiting to ask again |
| `ScreenGrid.BoxInvalid` | never for a box the locator cuts; there for the type |

Each Clef call is bounded by `callTimeout`.

## Measured

With the checked-in settings (grid 4, three rounds, power 4, boxScale 1.5), on 106 production
screenshots of the System menu, one per session, the click landed inside the Lock row every time,
at least 14.8 px from its edge: 2.8 s median, 3.4 s p90, 10,200 input tokens (about $0.0024). On 45
screenshots with the menu closed, every call was `NotFound` after round one, in about 0.9 s. Round
one's best cell was 0.68 or more with the menu open and 0.27 or less with it closed; the
threshold, 0.45, sits between them. All 106 share one menu layout: other screens are untested.

## Fake

```ts
import * as Fake from "@oligarchy/locator/testing";

const { locator, asked } = Fake.locator({
  reply: jarl.ok({ x: 0.46, y: 0.39, pixel: { x: 590, y: 315 }, rounds: [] }),
});
const missing = Fake.locator({ reply: jarl.err(Locator.notFound(0.2, 0.45)) });
```

`reply` can also be a function of the request. Run tests with fake timers, as V2 requires.
