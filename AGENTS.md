Two kinds of agent work here. The code lives in `v2/`; `v1/` is the previous implementation, kept
runnable and untouched as a reference.

- A developing agent changes the code under `v2/`. Read [v2/development.md](v2/development.md).
- A driving agent uses `./client` to drive a guest and `./ctrl` to record the result for a task given
  in Linear. It never reads or changes code. Read [v2/client.md](v2/client.md) and
  [v2/ctrl.md](v2/ctrl.md); their first lines are a table of contents, consult that first.
