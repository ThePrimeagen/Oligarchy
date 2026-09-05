import { Deferred, Effect, FileSystem, Layer, Option, PlatformError } from "effect";

export const fileInfo = (type: FileSystem.File.Type, size = 0): FileSystem.File.Info => ({
  type,
  mtime: Option.none(),
  atime: Option.none(),
  birthtime: Option.none(),
  dev: 0,
  ino: Option.none(),
  mode: 0o644,
  nlink: Option.none(),
  uid: Option.none(),
  gid: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(size),
  blksize: Option.none(),
  blocks: Option.none(),
});

export const notFound = (method: string, path: string): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
    syscall: method,
    cause: new Error(`ENOENT: no such file or directory, ${method} '${path}'`),
  });

export const permissionDenied = (method: string, path: string): PlatformError.PlatformError =>
  PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
    syscall: method,
    cause: new Error(`EACCES: permission denied, ${method} '${path}'`),
  });

export type Call = { readonly method: string; readonly args: ReadonlyArray<unknown> };

export type Entries = Readonly<Record<string, FileSystem.File.Type>>;

export type RecordingFs = {
  readonly calls: Array<Call>;
  readonly layer: Layer.Layer<FileSystem.FileSystem>;
};

// A FileSystem over a fixed table of paths that records every call; files read back the
// bytes scripted in `contents`, everything unscripted is `not implemented`.
export const recordingFs = (
  entries: Entries,
  options: {
    readonly contents?: Readonly<Record<string, Uint8Array>>;
    readonly overrides?: Partial<FileSystem.FileSystem>;
  } = {},
): RecordingFs => {
  const calls: Array<Call> = [];
  const record = (method: string, ...args: ReadonlyArray<unknown>) =>
    Effect.sync(() => {
      calls.push({ method, args });
    });
  const layer = FileSystem.layerNoop({
    stat: (path) =>
      record("stat", path).pipe(
        Effect.andThen(() => {
          const type = entries[path];
          return type === undefined
            ? Effect.fail(notFound("stat", path))
            : Effect.succeed(fileInfo(type));
        }),
      ),
    access: (path, accessOptions) =>
      record("access", path, accessOptions).pipe(
        Effect.andThen(() =>
          path in entries ? Effect.void : Effect.fail(notFound("access", path)),
        ),
      ),
    makeDirectory: (path, makeOptions) => record("makeDirectory", path, makeOptions),
    copyFile: (from, to) =>
      record("copyFile", from, to).pipe(
        Effect.andThen(() =>
          from in entries ? Effect.void : Effect.fail(notFound("copyfile", from)),
        ),
      ),
    readDirectory: (path) =>
      record("readDirectory", path).pipe(
        Effect.andThen(() =>
          entries[path] === "Directory"
            ? Effect.succeed(
                Object.keys(entries)
                  .filter((entry) => entry.startsWith(`${path}/`))
                  .map((entry) => entry.slice(path.length + 1))
                  .filter((entry) => !entry.includes("/")),
              )
            : Effect.fail(notFound("scandir", path)),
        ),
      ),
    readFile: (path) =>
      record("readFile", path).pipe(
        Effect.andThen(() => {
          const bytes = options.contents?.[path];
          return bytes === undefined ? Effect.fail(notFound("open", path)) : Effect.succeed(bytes);
        }),
      ),
    remove: (path, removeOptions) => record("remove", path, removeOptions),
    ...options.overrides,
  });
  return { calls, layer };
};

export const methods = (fs: RecordingFs): ReadonlyArray<string> =>
  fs.calls.map((call) => call.method);

export type Intercepted = {
  readonly calls: Array<Call>;
  // Paths whose writes fail with EACCES while present in the set.
  readonly failing: Set<string>;
  // Resolves with the next recorded call matching the predicate.
  readonly next: (predicate: (call: Call) => boolean) => Effect.Effect<Call>;
  readonly layer: Layer.Layer<FileSystem.FileSystem, never, FileSystem.FileSystem>;
};

type Waiter = {
  readonly predicate: (call: Call) => boolean;
  readonly deferred: Deferred.Deferred<Call>;
};

// The real FileSystem with its writes, renames, sinks and removes recorded, and writes to
// chosen paths made to fail on demand.
export const intercepting = (): Intercepted => {
  const calls: Array<Call> = [];
  const failing = new Set<string>();
  const waiters: Array<Waiter> = [];
  const record = (method: string, ...args: ReadonlyArray<unknown>) => {
    const call = { method, args };
    calls.push(call);
    for (const waiter of waiters.splice(0)) {
      if (waiter.predicate(call)) {
        Deferred.doneUnsafe(waiter.deferred, Effect.succeed(call));
      } else {
        waiters.push(waiter);
      }
    }
  };
  const next = (predicate: (call: Call) => boolean) =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<Call>();
      waiters.push({ predicate, deferred });
      return yield* Deferred.await(deferred);
    });
  // Recorded once the operation has settled, so a waiter sees the effect on disk.
  const recorded = <A, E>(
    method: string,
    args: ReadonlyArray<unknown>,
    effect: Effect.Effect<A, E>,
  ): Effect.Effect<A, E> =>
    effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          record(method, ...args);
        }),
      ),
    );
  const layer = Layer.effect(FileSystem.FileSystem)(
    Effect.map(FileSystem.FileSystem, (real) =>
      FileSystem.FileSystem.of({
        ...real,
        writeFileString: (path, data, options) =>
          recorded(
            "writeFileString",
            [path, data],
            failing.has(path)
              ? Effect.fail(permissionDenied("open", path))
              : real.writeFileString(path, data, options),
          ),
        writeFile: (path, data, options) =>
          recorded(
            "writeFile",
            [path],
            failing.has(path)
              ? Effect.fail(permissionDenied("open", path))
              : real.writeFile(path, data, options),
          ),
        rename: (from, to) => recorded("rename", [from, to], real.rename(from, to)),
        sink: (path, options) => {
          record("sink", path);
          return real.sink(path, options);
        },
        remove: (path, options) => recorded("remove", [path, options], real.remove(path, options)),
      }),
    ),
  );
  return { calls, failing, next, layer };
};
