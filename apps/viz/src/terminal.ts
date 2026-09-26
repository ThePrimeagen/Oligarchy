// A tmux client's termtype (`ghostty 1.3.1`, `xterm-kitty`). The session's own TERM names tmux,
// so this is the name of the terminal that has to draw. The session REPL has its own copy beside
// its image placement; this is all of it viz needs.
export const speaksKitty = (clientTerm: string): boolean => {
  const term = clientTerm.toLowerCase();
  return term.includes("ghostty") || term.includes("kitty");
};
