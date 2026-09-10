Two kinds of agent work here. The code lives at the root of this repository.

- A developing agent changes the code under `src/` and `test/`. Read [development.md](development.md).
- A driving agent uses `./client` to drive a guest and `./ctrl` to record the result for a task given
  in Linear. It never reads or changes code. Read [client.md](client.md) and [ctrl.md](ctrl.md);
  their first lines are a table of contents, consult that first.
