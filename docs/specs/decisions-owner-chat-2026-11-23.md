# Owner decisions given in chat, 2026-11-23

The owner's answers of 2026-11-23, given in chat to the coordinator.

## 1. What the release signing location points to (T3-21)

The owner chose option A: the location is a properties file kept beside the keystore, outside every checkout. The file holds the keystore path, the alias and both passwords.

- The build reads only that file's path, from `OCTAVE_SIGNING_PROPERTIES`, set in the shell or in the gitignored `mise.local.toml`.
- Agents and `pnpm tv:build` can sign for a real TV without the owner at the keyboard.
- The real path is set only on the owner's machine and is never written into the repository.
- Without the variable the build fails and names what is missing; it never falls back to the debug keystore.

The owner has already created the key (the first owner step of T3-21 is done). The owner still uninstalls the old Octave from the Shield before the first private-key install.
