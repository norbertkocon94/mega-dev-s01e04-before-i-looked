# Review preview

Preparation for issue #7, plan §3. Publication requires separate human approval immediately
before publishing. A pushed workflow does not publish anything: its only trigger is
`workflow_dispatch`. Keep #7 open until the public link and plan issues reach the course reviewer.

## Local export

Use Node 26 and pnpm 12.4.1. From the repository root, supply an output path outside this
checkout (including through symlinks):

```sh
pnpm export:preview /absolute/private/preview/index.html
```

The command starts `createApp` on `127.0.0.1` with an ephemeral port, fetches
`/digest/2026-10-28`, writes one standalone HTML file, and closes the server in `finally`.
It does not start a heartbeat, load `.env`, or print the HTML or marker. It reads `runs/`
without modifying it. The page uses inline CSS, no external assets and no client JavaScript.

Only for an intentional local marked export, explicitly load the ignored `.env`:

```sh
pnpm exec tsx --env-file-if-exists=.env scripts/export-preview.ts /absolute/private/preview-marked/index.html
```

Cleanup exports use caller-supplied environment without loading `.env`, even when it exists:

```sh
env -u LANE_MARKER pnpm export:preview /absolute/private/preview-clean/index.html
```

Never commit these files or `.env`, or attach preview content to an issue or chat.

## Manual publication after approval

1. Integrate the reviewed workflow into the default branch so GitHub offers its manual trigger.
   Confirm the selected revision contains issues #1–#6 and the reviewed export command.
2. Obtain separate human approval for publishing the sample data and course marker. Only then
   enable Pages with **GitHub Actions** as its source, configure repository secret `LANE_MARKER`
   using the private course value, and allow the selected branch in the `github-pages` environment.
   Never put the marker in source, workflow inputs, commands, or issue text.
3. Run **Actions → Review preview → Run workflow**, selecting the approved branch and leaving
   `include_marker` enabled. A missing or blank secret fails before upload or deployment.
4. The workflow installs pinned pnpm on an ephemeral runner, runs frozen install, tests and
   typecheck, and exports only `$RUNNER_TEMP/rig-preview/index.html`. Only that directory is
   uploaded; the artifact expires after one day. Artifact expiry does not remove the live page.
5. Use the URL returned by the deployment, verify HTTPS, five job rows, one malformed line,
   and the expected marker without copying the HTML into logs. Send that link and the plan's
   GitHub issues to the course reviewer through the separately authorized submission flow.
   Preserve replies privately; a queued review is not an accepted review.

## Cleanup at the same URL after review

Run the same workflow on the approved revision with `include_marker` disabled. The export step
sets `LANE_MARKER=''` explicitly and never reads `.env`; the secret is not needed in this mode.
It replaces the same Pages site's `index.html`. Verify the same HTTPS URL now shows
`no marker set`, no longer contains the marker, and still has the five rows and one malformed
line. Do not create another site or change the URL to perform cleanup. Finish plan §4 and its
tracking issue only after that verification; move the plan into `docs/plans/done/` with its
issue list at that point.

Workflow references: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
[setup-node v7](https://github.com/actions/setup-node),
[Pages artifact retention](https://github.com/actions/upload-pages-artifact).
