// Whether the promise has settled yet, read after the microtasks it is waiting on have run.
export const track = <T>(promise: Promise<T>) => {
  const state: { settled: boolean; value: T | undefined } = { settled: false, value: undefined };
  void promise.then((value) => {
    state.settled = true;
    state.value = value;
  });
  return state;
};
