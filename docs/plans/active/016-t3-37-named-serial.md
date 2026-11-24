# 016: T3-37 named serial and host paths

## Goal / Done when

The TV scripts learn the addresses a named adb serial (host name, mDNS name, USB serial) resolves to, replace them in every spelling, refuse a host or mDNS serial whose addresses cannot be learned, and print SDK and APK paths repository-relative or with the home directory as `~` (T3-37). Approach and decisions: `docs/specs/T3-37.md`.

- [x] 1 Observe on the own emulator
- [ ] 2 `scripts/tv-adb-addresses.mjs`, the address pass
- [ ] 3 `openDeviceAdb`, the guard, the callers
- [ ] 4 `scripts/tv-host-paths.mjs` and the path sites
- [ ] 5 Documents
- [ ] 6 Device runs on the own emulator

## Progress

- [x] 1

## Decision log

- 2026-11-24: Spec-check note 1 (an `other` serial): option (b). Option (a), refusing an `other` serial when `ip` exits non-zero, contradicts the frozen test "a USB-style serial that learns nothing is not refused", whose fake exits 1 for `ip` when it is given no answer. The case is named in the spec's Risks and in the new `docs/security.md` row's "Not covered" list.
- 2026-11-24: Spec-check note 3: the frozen tests already give their fakes `emulator: true` (the T3-21 install guard) and the refusal test asserts `could not be learned`; the spec's Test plan now says so.

## Surprises & discoveries

Milestone 1, own emulator `t311_tv` started read-only on port 5580 (`emulator-5580`), under the lock `locks/t337-emulator.lock`. adb `37.0.3`. Addresses below are the emulator's own (10.0.2.0/24 and `fec0::/10` are the emulator's private network, not a home network); the link-local ones are the emulator's.

- `adb connect localhost:5581` printed `connected to localhost:5581`; `adb devices` listed `emulator-5580	device` and `localhost:5581	device`. The named serial is printed as given, never as an address.
- `adb -s localhost:5581 shell ip -o addr show` exits 0 as the shell user and prints:

  ```
  1: lo    inet 127.0.0.1/8 scope host lo\       valid_lft forever preferred_lft forever
  1: lo    inet6 ::1/128 scope host \       valid_lft forever preferred_lft forever
  2: dummy0    inet6 fe80::3872:8eff:fe7b:96f2/64 scope link \       valid_lft forever preferred_lft forever
  15: eth0    inet 10.0.2.15/24 brd 10.0.2.255 scope global eth0\       valid_lft forever preferred_lft forever
  15: eth0    inet6 fec0::9038:1d22:aa9d:a7f0/64 scope site temporary dynamic \       valid_lft 86396sec preferred_lft 14396sec
  15: eth0    inet6 fec0::3bf:a1f2:28d2:f865/64 scope site dynamic mngtmpaddr stable-privacy \       valid_lft 86396sec preferred_lft 14396sec
  15: eth0    inet6 fe80::b7ea:d5dd:141a:8619/64 scope link stable-privacy \       valid_lft forever preferred_lft forever
  ```

  So `ip` is usable and the fixture format (`IP_OUTPUT`) matches. No `ifconfig` fallback is needed.
- `adb -s localhost:5581 logcat -d` holds the device's addresses: 26 lines matched `10.0.2.15`, `fe80::` or `fec0::` (for example `DhcpClient: Received packet: ... OFFER, ip /10.0.2.15, netmask /255.255.255.0 ...`). This is the leak the learning closes.
- `adb disconnect localhost:5581` printed `disconnected localhost:5581`.
