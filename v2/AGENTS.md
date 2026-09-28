1. No private members.
2. No classes, except `App`.
3. Tests test business logic only, never that a third-party interface works.
4. Tests are synthetic at the boundary: Linear, HTTP, the process's io, the clock and every other
   outside service is a fake the test hands in. The database is the one real thing a test may use,
   so a full flow can be proven end to end: the test starts its own with `@oligarchy/fake-postgres`
   (a fresh, migrated Postgres on a free port), and stops it inside the test to prove what a real
   shutdown does. Nothing a test needs is started by hand.
