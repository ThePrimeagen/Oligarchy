1. No private members.
2. No classes, except `App`.
3. Tests test business logic only, never that a third-party interface works.
4. Every service is faked in tests: Linear, HTTP, the process's io, the clock, all of them. The
   database is the one exception: a test starts its own with `@oligarchy/fake-postgres` and stops
   it inside the test, so a full flow and a real shutdown are proven. Nothing a test needs is
   started by hand.
5. Test at the error boundary. Every error a unit can meet gets its own test proving the unit
   behaves properly there: what it returns, what it says, what it stores, what it does next. One
   happy-path test is enough; do not add more.
6. When we do not yet know how a service behaves (Linear's tickets, for one), its fake must still
   be able to produce every error the service can, so each error is tested now. How its happy
   path is tested gets settled once we know.
