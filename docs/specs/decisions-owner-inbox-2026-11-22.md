# Owner decisions from the decision inbox, 2026-11-22

The owner's answers of 2026-11-22 from the decision inbox. The coordinator relayed them to a directed Product Owner pass of the same day, which wrote them down here. This file holds the owner's decisions only. Where each one was placed, what gates what, and everything the pass derived or could not verify are the Product Owner's and are in `tasks/product-owner-log.md`.

## 1. The application ID (T11-01, T3-21)

The Android application ID is `cloud.jellyscale.octave`. The owner holds the matching domain.

The ID changes before the first install on a real TV, alongside the signing key of T3-21. This settles the first item of T11-01 ("the final Android application ID") and moves its last item (the change itself) into T3-21, ahead of T3-17.

## 2. The icon set

Tabler icons: MIT, shipped as fonts by `@tabler/icons-webfont`, loaded with expo-font, with no native module.

## 3. Continue watching (T5-01, T5-05, T9-03, T9-02)

- **Remove** hides the title from the row and keeps its progress.
- **Where Remove lives:** in a short menu opened by holding select.
- **The window:** Continue watching drops a title 90 days after it was last played.
- **The row** shows at most 20 titles, newest first.
- **The window can be changed per account:** 30, 90, 180 or 365 days, or Never.
- **An expired title is only hidden.** Its progress is kept, Resume on the title's page still works, and playing it again brings it back to the row.
- **Ageing is computed on the device** from `UserData.LastPlayedDate`. Nothing is asked of the server.

These settle the three owner decisions of T5-01 and go into T5-05, T9-03 and T9-02.

## 4. Which settings follow the account (T9-01, T9-02, T9-03)

The owner accepted the proposal of T9-01:

- **Per account:** subtitles, auto-play, the skip modes, and the Continue watching window.
- **Per device:** the streaming limits, and later passthrough and refresh rate.
- **Per-account settings are stored on the server's display preferences.**

The owner's note: "do whatever is best for the user… the most simple, accessible and intuitive."

Not asked, so not decided: the list and order of the sections on the settings screen, and what sits under an Advanced section. That item of T9-01 moves to T9-08 and stays the owner's.

## 5. Error copy (T8-25)

A screen shows only Octave's own fixed wording for each error code. It never shows reason text that came from the player, the system or the server.

## 6. Which discovery replies are listed (T4-01)

A `.home.arpa` name is listed too, alongside a `.local` name. This supersedes the literal reading of the listing rule in `docs/specs/decisions-T4.md` ("a `.local` name"). The rest of that rule stands.

## 7. The logo and the loader

- **The logo** is the "D1 bars" mark.
- **The loader** is "Signal": the D1 bars, where the brass bar pulses and sends out rings. The owner's addition: on each pulse one more letter of "octave" lights up, o first, then c, and so on.
- **Where space is tight** a small version shows the bars only.
- **It replaces the ring** as Octave's loading indicator in `DESIGN.md`.
- The direction is video first, not music.

The exact motion is to be confirmed by the owner from the coordinator's logo page, round 7.

## 8. Auto-merge on Product Owner and security-rule pull requests

Auto-merge stays on for Product Owner pull requests and for pull requests that change a security rule. The owner vetoes from the inbox. No task changes.
