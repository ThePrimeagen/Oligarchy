# Prompts

Ready-to-send prompts for agents that drive a QEMU guest through the oligarchy CLI (`src/qemu/cli.ts`). Each file is self-contained on purpose: the commands, the key encoding, and the working loop are inlined so the agent never has to explore this repo to operate the guest. When the CLI's interface changes, change these files with it.

The bases are templates: pick the one matching where the server runs, replace every `{{...}}`, and put the work in `{{TASK}}`. The CI prompt is not a base — fill in the ISO path and send it as-is.

- [base-local.md](base-local.md) — the server is on the agent's machine at the default `127.0.0.1:42069`, and the ISO is a local path. Fill `{{ISO}}` and `{{TASK}}`.
- [base-remote.md](base-remote.md) — the server is elsewhere; the agent exports `OLIGARCHY_ADDR` (host:port, no scheme — the CLI speaks plain HTTP). The ISO must be an http(s) URL for the server to download and cache, and `--disk` is never passed. Fill `{{ADDR}}`, `{{ISO_URL}}`, and `{{TASK}}`.
- [ci-boot-to-desktop.md](ci-boot-to-desktop.md) — the CI smoke test. A proxy is already running locally and an ISO is already on disk; the agent boots a session, drives the installer, creates a user, signs in, and must end its reply with `PASS <session-id>` or `FAIL: <reason>`, leaving `desktop.png` and the numbered `step-NN.png` screenshots behind. Fill `{{ISO}}`.

Two checks before sending:

- `grep '{{' <file>` — a leftover placeholder means it is not ready.
- The agent's shell must be on the machine the prompt assumes. The CI prompt means `127.0.0.1` literally: run it with an agent on the CI runner itself (e.g. the `cursor-agent` CLI). A cloud agent started through `src/cursor-agent/client.ts` runs on its own VM and cannot see the runner's localhost.
