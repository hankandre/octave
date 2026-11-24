// Host paths in the TV scripts' output (T3-37; docs/specs/T3-37.md, "Host paths"). A path inside the repository is
// printed repository-relative and a path inside the home directory with `~`, so no console or CI log holds a home
// directory name. A path outside both (`/tmp/…`, `/opt/android-sdk`) holds none and is printed as it is.
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const usableHome = (home) => (typeof home === "string" && isAbsolute(home) && resolve(home) !== resolve("/") ? resolve(home) : null);
const inside = (root, path) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);

/** `path` repository-relative inside `repo`, `~/…` inside `home`, and as it is anywhere else. */
export function shownPath(path, { repo = REPO, home = homedir() } = {}) {
  const full = resolve(path);
  const root = resolve(repo);
  if (inside(root, full)) return relative(root, full).split(sep).join("/") || ".";
  const base = usableHome(home);
  if (base !== null && inside(base, full)) return `~${full.slice(base.length)}`.split(sep).join("/");
  return path;
}

/** `text` with every path of the repository and of the home directory in it written as `shownPath` writes it. */
export function hideHostPaths(text, { repo = REPO, home = homedir() } = {}) {
  let out = text;
  for (const [root, replacement] of [
    [resolve(repo), ""],
    [usableHome(home), "~"],
  ]) {
    if (root === null || root === resolve("/")) continue;
    const trimmed = root.replace(/[\\/]+$/, "");
    const separator = replacement === "" ? "(?=[\\\\/])[\\\\/]" : "(?=[\\\\/]|$|[\"'`\\s:,;)])";
    out = out.replace(new RegExp(`(?<![\\w.~-])${escapeRegExp(trimmed)}${separator}`, "g"), replacement);
  }
  return out;
}
