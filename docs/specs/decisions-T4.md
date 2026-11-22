# T4 decisions

The owner's decisions of 2026-11-22 on finding servers, development builds, and a server address typed with a Unicode host. The coordinator relayed them to the Product Owner pass of the same day, which wrote them down here. This file holds the owner's decisions only; where each one was placed, and what gates what, is the Product Owner's call and is in `tasks/product-owner-log.md`.

## Which discovery replies are listed (T4-01, backlog line 173)

Decided by the owner on 2026-11-22, relayed by the coordinator.

Strict. A discovery reply is listed only when its `Address` host is:

- a private-LAN IP literal equal to the datagram's source address, or
- a `.local` name.

Loopback and public addresses are dropped. A server that advertises only an https domain does not appear in the list; it can still be typed by hand.

This goes into T4-01's acceptance.

## Which servers a development build may sign in to (T3-33, backlog line 176, first half)

Decided by the owner on 2026-11-22, relayed by the coordinator.

A development build may sign in only to:

- loopback,
- the emulator host `10.0.2.2`,
- an address in a build-time allowlist set on the developer's machine. The allowlist is never committed, and the spec names the mechanism.

The owner's real home server never qualifies unless it is listed.

## An https address typed with a Unicode host (T4-02, backlog lines 161 and 122)

Decided by the owner on 2026-11-22, relayed by the coordinator.

Refuse it, with this copy:

> This address uses characters Octave can't check. Type the server's plain address instead.

The punycode (`xn--`) form of the same address still works.

The sentence is the row "Sign-in, HTTPS address with a Unicode host" of `DESIGN.md` section 10, and T4-02 shows it.

## A denied command still stops a run

Decided by the owner on 2026-11-22, relayed by the coordinator.

Keep it strict: any denied command stops a run. The cause is cut by command hygiene instead, with a rule the coordinator adds to `AGENTS.md` separately. No task changes.
