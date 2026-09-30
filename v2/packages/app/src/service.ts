import type { AnyService, Bag, Given, Made, Needs, OptionsArgs } from "./types.ts";

// The only way to make a service. Deps names every service it wants, Options what it is told, and
// S the service it builds. make sees only the services Deps names, and must build an S. Creation
// is synchronous: a service that reaches something connects on first use. Options are one bag,
// NoOptions when there is nothing to tell; left out, they are {}.
// The overload is the typed face: the body hands make what it was handed and returns what it built.
export function createService<Deps extends AnyService, Options extends Bag, S extends AnyService>(
  make: (services: Needs<Deps>, options: Options) => S,
): (services: Given<Deps>, ...options: OptionsArgs<Options>) => Made<S>;
export function createService(
  make: (services: never, options: {}) => AnyService,
): (services: never, ...options: ReadonlyArray<{}>) => AnyService {
  return (services, ...options) => make(services, options[0] ?? {});
}
