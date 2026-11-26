# Octave agent rules

Octave is a Jellyfin and Jellyscale client for the TV that plays the original file whenever the device can and shows every server conversion. These are the rules every agent follows. Where code lives is in `DOMAINS.md`; commands are in `docs/commands.md`; agents, models, and the task flow are in `WORKFLOW.md`.

## Read first

- Read `PRODUCT.md` before changing scope or user-facing behavior.
- Read `ARCHITECTURE.md` before changing server calls, playback, native code, or invariants.
- Read `DOMAINS.md` before adding or moving code.
- Read `WORKFLOW.md` before planning multi-step work.
- Read `docs/security.md` before touching tokens, the network, or redaction.
- Read `docs/commands.md` before running checks, builds, or device tests.

## Tasks

- Read and update tasks only through `pnpm task`; never load `tasks/prd.json` whole.
- Follow the `rules` array at the top of `tasks/prd.json`.
- Change only a task's `status`, `owner`, `passes`, and `evidence` fields.
- Keep evidence to 600 characters and name the PR or commit.
- Append deferred or newly found work to `tasks/backlog.jsonl` as one JSON line (fields in `WORKFLOW.md` §2a); any agent or pull request may.
- File every Jellyscale feature request as a GitHub issue on `jellyscale-org/jellyscale`, labelled `from:fluster`, for its Product Owner to evaluate; never edit the Jellyscale repository to request it.
- Write each Jellyscale issue in general wording, with its evidence and what is unproven: that repository is public.
- Leave adding, splitting, reordering, and dropping tasks to a Product Owner pass; `pnpm lint:flow` fails any other change.
- Edit acceptance items only in a Product Owner pass. Scope edits need its logged reason; on-screen wording, look, and product direction need an owner approval file.
- Treat every Product Owner decision as provisional: the owner can veto any of it.
- Send every question to the Product Owner, look, wording and direction included, until the owner ends the delegation (`docs/specs/decisions-owner-chat-2026-11-25.md` §1). Ask the owner only for UX/UI feedback during dogfooding.
- Link the task id in commits, plans, and PRs.
- Never commit a server address, a credential, or the owner's name; read the dogfood server from `OCTAVE_DOGFOOD_SERVER`.

## Hard rules

Playback

- Prefer direct play; fall back to direct stream, then transcode, only through Playback Negotiation.
- Never request a conversion for a source an engine on this device can play under the direct-play rules in `ARCHITECTURE.md` §3.
- Show every server conversion and its reason in the player.
- Send the same PlaybackInfo flags in the request body and the query string.
- Send the Octave DeviceProfile with every PlaybackInfo request; never add codec or container conditions to it.
- Use a `TranscodingUrl` only after Playback Negotiation validates and rebuilds it.
- Never let an HLS master playlist list subtitle or trickplay renditions.
- Validate every HLS playlist natively before the player reads it; refuse any URI that is not same-origin and credential-free. Every validator passes the shared HLS vectors.
- Refuse media sources that `ARCHITECTURE.md` §3 can neither play nor convert.
- Never add a generic player command, property, option, or header bridge.
- Treat every new native module method or event as an architecture change.
- Never fall back to a player or image path that cannot send the header.

Tokens and network

- Keep the token in native memory only (decision 0005); JavaScript holds an opaque session id and never sees the token.
- Send every server request through the one authenticated client; never open a network path around it.
- Add the header only for the session's origin; follow no redirect, use no proxy, store no cookie, and refuse any other origin.
- Strip the session's token, as written and percent-encoded, from every response body before it crosses to JavaScript.
- Keep the native session surface to the methods decision 0005 lists; adding a method or event needs a decision record.
- Load artwork natively by item id, image type, tag, size, and session id; never pass a URL, header, or token to an image view.
- Treat a 3xx answer and a status of 0 as errors everywhere.
- Never put a token in a URL, a React prop, an event, JavaScript storage, a cache, React state, or a log.
- Never log or display tokens, passwords, authenticated URLs, or play-session IDs.
- Never persist a token except as decision 0005's one Keystore-encrypted record.
- Sign in from a development build only to a development server.
- Pass a playback task only when its wire test passes against Jellyscale.
- Never work around a missing Jellyscale feature with a token in a URL.

Code boundaries

- Talk to Jellyfin and Jellyscale only through the core's gateway.
- Build media URLs only in Playback Negotiation.
- Keep the domain layer free of React, React Native, Expo, SDK, and HTTP imports.
- Keep the core free of platform APIs; take them through ports.
- Never introduce Flutter.

Dependencies

- Before adopting a dependency, verify from primary sources that it is actively maintained, and record the check in the task's spec.
- Re-check every dependency when a phase starts.

## Code style

- Prefer simple, explicit code over clever abstractions.
- Use `switch` statements in reducers.
- Use two-space indentation and semicolons in TypeScript.
- Use camelCase identifiers, PascalCase components, kebab-case multiword module files.
- Follow the Kotlin coding conventions; keep Kotlin behind interfaces a Swift implementation can mirror.
- Keep player commands typed and narrow.
- Split files that grow past about 400 lines along domain lines.

## Design

- Follow `DESIGN.md` for every UI change.
- Load the `frontend-design` and `impeccable` skills for every UI spec, implementation and review; `DESIGN.md` and the task's acceptance win over both.
- Use the design tokens; never hard-code colours, sizes, radii, or durations.
- Build screens from the shared controls; never use a platform picker or dialog the D-pad cannot style or focus.
- Make every screen work with the D-pad, select, and Back alone, and honour reduced motion.
- Map errors to plain copy; never show a transport error message.
- Include before and after screenshots at 1920×1080 in UI PRs.

## Tests

- Add a focused test with every behavior change.
- Never write a test for documentation: no test reads a document, spec, instruction file, template or comment to check its wording. Test behavior and code only.
- Check a documentation item by review (`gate: review`), not by a test.
- Never skip, weaken, or delete a test to pass a check.
- Never change or delete a frozen test (a file listed in `docs/specs/<TASK-ID>.tests.json`); report a wrong one and the Product Owner rules.
- Never write an implementation, stub, or probe to prove a test can pass before the implement step.
- Never stub a function to make a build pass.
- Use fixtures; never commit credentials or copyrighted media.

## Reasoning

- Prefer retrieval-led reasoning over training-led reasoning.
- Read the code, docs, and plans before relying on memory.
- Check APIs, versions, and library behavior against current sources.
- Cite the file, command output, or URL behind each claim.
- Say "unverified" when no source backs a claim.

## Navigating code

- Start unfamiliar work with codebase-memory `get_architecture`.
- Find code by intent with semble `search`.
- Outline files with serena `get_symbols_overview` before reading them.
- Read single symbols with serena `find_symbol`; avoid reading whole large files.
- Check callers with serena `find_referencing_symbols` before changing a signature.
- Use Grep only for literal strings.

## Working

- Fix a red check before starting the next milestone.
- Commit one milestone at a time with a Conventional Commit subject.
- Never review your own change.
- Never write long comments justifying a workaround; fix the cause or log it in the plan.
- Keep `AGENTS.md`, `CLAUDE.md`, agent and skill files to short imperative instructions; put history and reasons in `docs/decisions/`, `docs/specs/` or the plan.
- Record decisions in the active plan's decision log.
- Propose a test, lint, or rule after the second correction for the same mistake.
- Never claim a check passed without showing its output.
- When a command is denied, stop and report it; never retry it in another place or form.
- Run one plain command per tool call; never chain a removal, a kill, or a heredoc with other commands.

## Parallel work

- Work in your own git worktree.
- Commit only files you own.
- Never run `git stash` or `git reset --hard`.
- Never force-push `main` or another agent's branch.
- Rebase your own unmerged PR branch, then `git push --force-with-lease`.
- Never edit another agent's claimed milestone.
- Keep native module, player, and on-device work serial; use only your own emulator.

## Models

- Run each task as: refine + spec, spec check, failing tests, implement, verify, one review round, ship.
- Use the model `WORKFLOW.md` assigns to each stage.
- Fix critical, high, and medium review findings and every small low in the same pull request; send what is left to `tasks/backlog.jsonl` (`WORKFLOW.md` §2c).
- Lower effort before choosing a weaker model; escalate one tier after two failed attempts.
- Switch models only at task boundaries.

## Pull requests

- Ship every finished branch with the `ship` skill.
- Never commit directly to `main`.
- Merge only with green CI.
- Call out changes to invariants, `docs/security.md`, release signing, or CI in the PR.
- Explain user impact, testing performed, and direct-play, conversion, and security implications.
- List every untested device, Jellyfin, and Jellyscale gate.
- Include screenshots for visible UI changes.
- Link the plan or issue.
