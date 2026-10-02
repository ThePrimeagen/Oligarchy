1. No private members.
2. No classes, except `App`.
3. Tests test business logic only, never that a third-party interface works. Never test again
   what is already tested, or what the types already promise. A unit does not re-test the
   packages it calls: an app does not test env's refusal of a missing variable or an unknown
   flag, or how `oligarchy.json` is read, and a new config key, flag or variable adds no test of
   its own. Rule 5's errors are the ones the unit's own code decides what to do with.
4. Every service is faked in tests: HTTP, the process's io, the clock, all of them. The
   database is the one exception: a test starts its own with `@oligarchy/fake-postgres` and stops
   it inside the test, so a full flow and a real shutdown are proven. Nothing a test needs is
   started by hand.
5. Test at the error boundary. Every error a unit can meet gets its own test proving the unit
   behaves properly there: what it returns, what it says, what it stores, what it does next. One
   happy-path test is enough; do not add more.
6. When we do not yet know how a service behaves, its fake must still
   be able to produce every error the service can, so each error is tested now. How its happy
   path is tested gets settled once we know.
7. Read a jarl result through jarl. Take its value with `jarl.value(result)`, which compiles only
   once every error is handled; never `result.value`. Test it with `jarl.error.is(result, C)`,
   `jarl.is_err(result)` or `jarl.is_ok(result)`, never `result.error instanceof` or
   `jarl.error.is(result.error, C)`. Read `result.error` only where one of those has just named
   it an error, to handle that error. `oligarchy/result-through-jarl` lints both.
8. `jarl.unwrap` throws whatever error is left, so it is only for a throw that is caught on
   purpose: in the function a `jarl.fn` wraps or a `jarl.exec` runs, not a callback inside it,
   whose mapError keeps that error so the caller still gets it typed; or in a test, where the
   throw fails the test.
   Anywhere else, handle the error. `oligarchy/unwrap-inside-jarl-fn` lints it outside `test/`.
9. Keep naming stable.  path /abort should call function abort which performs the abort sequence.
10. An application should be created for any long running process that is expected to start at the
    start and end when the end signal comes in (signal, exit, or error).
    - Applications should, when dying, cause the rest of the system to die.
11. Services should only be created when:
    - they manipulate the database
    - they are required by multiple apps and depend nothing or other services (sentry, logger, db)
    - they make external calls
    - they are the contract line for this application and the rest of the system
12. create functions for long running should take in services and options and return the object of
    functions.  Do not create one mega object.  create(services, {...}) allows type checking at the
    service level easily.
13. pass the services object.  never decompose it and reconstruct the services object.  The type
    definition should narrow the services object to the ones that are needed and validate we are
    crafting the right services object.
14. jevlint should only be ran at the behest of the developer.
