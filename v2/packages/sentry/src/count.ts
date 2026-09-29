export type Count = {
  readonly open: () => number;
  readonly add: () => { readonly settle: () => void; readonly settled: Promise<void> };
  readonly idle: () => Promise<void>;
};

export const create = (): Count => {
  throw new Error("not implemented");
};
