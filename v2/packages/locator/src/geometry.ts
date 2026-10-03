import type * as ScreenGrid from "@oligarchy/screen-grid";

// Each cell's centre weighted by p^power over the sum of every cell's p^power. A high power lets
// the few cells that see the target outweigh the many that answer a small yes for nothing. When
// every cell answers zero there is nothing to weigh, and the centre of the cells is kept.
export const weightedCentre = (
  cells: ReadonlyArray<ScreenGrid.Box>,
  ps: ReadonlyArray<number>,
  power: number,
): ScreenGrid.Point => {
  const weights = ps.map((p) => p ** power);
  const total = weights.reduce((sum, w) => sum + w, 0);
  const share = (i: number) => (total > 0 ? (weights[i] ?? 0) / total : 1 / cells.length);
  return cells.reduce(
    (point, cell, i) => ({
      x: point.x + share(i) * ((cell.left + cell.right) / 2),
      y: point.y + share(i) * ((cell.top + cell.bottom) / 2),
    }),
    { x: 0, y: 0 },
  );
};

// The centre of the cell with the highest p, the first in reading order on a tie; no other cell
// pulls it. When every cell answers zero there is no best, and the centre of the cells is kept.
export const bestCentre = (
  cells: ReadonlyArray<ScreenGrid.Box>,
  ps: ReadonlyArray<number>,
): ScreenGrid.Point => {
  const best = ps.reduce((at, p, i) => (p > (ps[at] ?? 0) ? i : at), 0);
  return weightedCentre(
    cells,
    ps.map((p, i) => (i === best ? p : 0)),
    1,
  );
};

// The box the next round looks at: scale x a cell of `box`, centred on the point, moved (never
// shrunk) to stay on the screen, in whole pixels so it can be cut from the screenshot.
export const nextBox = (
  point: ScreenGrid.Point,
  box: ScreenGrid.Box,
  grid: number,
  scale: number,
  screen: { readonly width: number; readonly height: number },
): ScreenGrid.Box => {
  const width = Math.min(
    screen.width,
    Math.max(1, Math.round((scale * (box.right - box.left)) / grid)),
  );
  const height = Math.min(
    screen.height,
    Math.max(1, Math.round((scale * (box.bottom - box.top)) / grid)),
  );
  const left = Math.round(Math.min(Math.max(point.x - width / 2, 0), screen.width - width));
  const top = Math.round(Math.min(Math.max(point.y - height / 2, 0), screen.height - height));
  return { left, top, right: left + width, bottom: top + height };
};
