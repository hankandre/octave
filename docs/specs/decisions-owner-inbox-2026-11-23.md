# Owner decisions, 2026-11-22 and 2026-11-23

The owner's answers on the decisions page, recorded by the coordinator. Each names the task it settles. Placement and order are the Product Owner's.

## 1. Player errors that "Try again" won't fix (T8-25)

Answered 2026-11-23. Three of the six player errors that had no row in `DESIGN.md` §10 get their own row; the other three (`unsupported-request`, `malformed-media`, `decoder-failed`) use the general playback error row.

| Error | Title | Message | Actions |
|---|---|---|---|
| `session-ended` | Playback stopped | Your session on {server} has ended. Sign in again to keep watching. | Sign in, Back to details |
| `decoder-unavailable` | Playback stopped | This device can't play this video or audio format. | Back to details |
| `audio-output-failed` | Playback stopped | Couldn't play the sound on this device. Check the TV's audio output, then try again. | Retry, Back to details |

The title of these rows is "Playback stopped", because "Playback could not start" is wrong for a failure partway through a film.

## 2. The release and the missing Jellyscale features (T10-05, T10-06 to T10-13)

Answered 2026-11-23. The Play Store release does not wait for the Jellyscale features still missing as a group. The dogfood week (T10-05) decides: a gap that made the owner reach for another client during the week becomes a launch task.

## 3. PRODUCT.md describes the product; tasks live in tasks/prd.json

Answered 2026-11-23, the owner's note: "Tasks should not go in the product MD. The product MD should just explain what the product is. Product tasks should go into the PRD.json."

- The features the launch scope review moved after launch are not named in `PRODUCT.md`.
- `PRODUCT.md` is cleaned so it describes the product and no longer carries task ids, task lists or a phase-by-phase roadmap; those live in `tasks/prd.json`. This file is the owner approval for that wording change (backlog line of the same date).

## 4. The Shield's connection (T3-37)

Answered 2026-11-23: the owner sometimes reaches the Shield by name or pairing, or is not sure. T3-37 keeps blocking real-TV installs until the scripts hide the address a named adb serial resolves to.

## 5. The Signal loader at launch (T3-35)

Answered 2026-11-23: the Signal loader stays at launch, as `DESIGN.md` describes.
