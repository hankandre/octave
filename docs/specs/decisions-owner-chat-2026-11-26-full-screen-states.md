# Owner decision, 2026-11-26 (chat): one centred pattern for full-screen messages

The owner's words are in the chat of this date; this file records them in the repository. The design is `docs/specs/design/full-screen-states/brief.md` at commit b67d0ffd.

## The owner's feedback

On the old failed-switch mockup (`docs/specs/design/T4-06/16-switch-failed.png`), in the owner's words:

> "That error message is so ugly to read and is all justified left into the top, which on a TV is not going to be the primary place where people are looking."

## The question asked

The coordinator showed the owner the recommended layout, `docs/specs/design/full-screen-states/01-option-a-unreachable.png`, and asked:

> "Does the recommended layout and wording look right to you? Your approval will cover the proposed new headings, messages, the Who's watching? button and removing the 'What you can do' label. After that, I'll have the Product Owner add a task to fix the screens and prioritise it before account selection."

## The owner's answer, in full

> "I like the recommended design."

## What it covers

1. **Option A's layout**, the centred stack of the brief's section 2 (mockup 01), as the brief's section 3 draws it: mark, heading, sentence, server, then one centred row of actions, primary first, the rest secondary.
2. **The proposed words in the brief's section 4 table**, every bold string there:
   - Headings: "Can't reach the server", "This address redirects elsewhere", "This server needs an update", "Something went wrong", "This code has expired", "The server didn't accept this code".
   - Sentences: "Octave doesn't follow redirects, so choose the server's final address.", "Update it to Jellyfin 10.11 or newer, then try again.", "Octave couldn't check your sign-in.", "Octave couldn't finish signing in.", and "Check the address and that the server is running." standing alone, without the address.
   - "Check that the server is on, then try again." on the launch, switch, Home and playback unreachable rows, with no server name in it.
   - The actions and their order in each row of that table, the **Who's watching?** button on a failed switch among them.
3. **Removing the "What you can do" label.**

## What it does not cover

- Option B, and anything the brief lists as not chosen or not added.
- Words outside the brief's section 4 table, among them the reworded playback server-error sentence in the paragraph under the table, and any change to the session-ended row.
- The brief's open choices P3 to P7, the token values and the glyphs beyond what the mockups show. The Product Owner settles those under the delegation (`docs/specs/decisions-owner-chat-2026-11-25.md` §1) in `docs/specs/decisions-product-owner-2026-11-26f.md`, for the owner's veto.

## Tasks this approval names

- **T4-11** (new): the shared pattern, the launch's loading and couldn't-check screens.
- **T4-12** (new): Quick Connect's loading and failures and the not-found state in the same pattern.
- **T4-06**: the failed switch takes the pattern, with Try again and a Who's watching? button.
- **T4-10**: the saved server name in the pattern's server place.
- **T5-04**: Home's unreachable state takes the pattern and the approved words.
- **T8-17**: playback failures take the pattern; the unreachable sentence loses the server name.
