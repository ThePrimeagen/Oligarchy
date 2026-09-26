// Loaded by the wrapper ahead of main.ts: it registers the Bun plugin that compiles the Solid
// JSX in screen.tsx for OpenTUI's reconciler, which Bun's own transpiler cannot, and gives
// solid-js its client build in place of the server build Bun would pick.
import "@opentui/solid/preload";
