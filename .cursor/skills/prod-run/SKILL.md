---
name: prod-run
description: >-
  Kick off a production test run of every stored Oligarchy test: find the
  latest Omarchy ISO, then run ./ctrl test run testsuite with --env-file
  .prod-env. Use when the user asks for a prod run, a production test suite,
  or to file the full suite against the latest Omarchy.
---

# Prod run

File one ticket per stored test definition against the latest Omarchy, using production variables. This creates real Linear tickets. Do it only when the user asked for a prod run.

Read [prod-test-suite](../prod-test-suite/SKILL.md) and follow it. `.prod-env` supplies `DATABASE_URL`, `LINEAR_API_TOKEN`, `LINEAR_TEAM`, and `SERVER_URL`. Do not print those values.

From the repo root:

1. Stop if `.prod-env` is missing, or if any of those four keys is empty. Do not create the file.
2. Find the latest Omarchy release. `GET https://api.github.com/repos/omacom/omarchy/releases/latest` and read `tag_name` and `body`. Prefer an `https://iso.omarchy.org/omarchy-*.iso` URL in the body. Otherwise build `https://iso.omarchy.org/omarchy-<version>.iso` from the tag with the leading `v` removed. The version passed to ctrl is the version in that filename.
3. `curl -fsI` the ISO URL. A non-200 response means stop. Do not file tickets for an ISO that is not published.
4. Read `SERVER_URL` from `.prod-env` (that key only) and run, with a clean environment so a local export does not hide the file:

```bash
env -i PATH="$PATH" HOME="$HOME" \
  ./ctrl --env-file .prod-env test run testsuite \
  --server-url "$SERVER_URL" \
  --iso "$ISO" \
  --version "$VERSION"
```

5. The command prints JSON: the run id and each ticket identifier. Report that, plus the ISO URL and version. Do not paste `.prod-env`. A failure exits 1 with one headline, then the cause. Read the headline. Do not re-run after a partial failure: tickets already filed stay filed.
