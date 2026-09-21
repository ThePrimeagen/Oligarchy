Two kinds of agent work here.

- A developing agent changes the code. Read [development.md](development.md). A UI test asserts
  business logic only. Never add a presentational test: one that fails because a font, a size, a
  color, spacing, CSS, an icon, or the visual order of page chrome changed. Those test nothing
  real. What a page shows, what a search finds, and what a control does are the logic. Finding,
  including a fuzzy search, gets a couple of unit tests, not a markup snapshot.
- A driving agent uses `./client` to drive a guest and `./ctrl` to record the result for a task given
  in Linear. It never reads or changes code. Read [client.md](client.md) and
  [ctrl.md](ctrl.md); their first lines are a table of contents, consult that first.
