// T3-05 item 8: each checkout runs the fixture servers under its own Compose project, so one checkout never adopts,
// recreates or stops another's containers. The name is derived from the checkout's real path; the host ports stay
// fixed (docs/specs/T3-05.md, "Compose projects"), so a second checkout stops and names the holder instead.
//
// Run as a script it prints this checkout's name, for the shell scripts. With --check-ports it also reads which
// Compose project publishes each fixture port and exits 1, printing the judge's lines, when another project does.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const composeFile = join(here, "docker-compose.yml");

// The host ports tests/integration/docker-compose.yml publishes.
export const FIXTURE_PORTS = [18096, 18097, 18098];

// "octave-" and the first 10 hex characters of the SHA-256 of the checkout's real path.
export function composeProjectName(root) {
  const real = realpathSync(root);
  return `octave-${createHash("sha256").update(real).digest("hex").slice(0, 10)}`;
}

// The arguments every `docker compose` call of this checkout passes first.
export function composeArgs() {
  return ["-p", composeProjectName(repo), "-f", composeFile];
}

// holders: [{ port, project }], project null when nothing publishes the port. Returns ERROR lines, empty when every
// port is free or held by ours. It never removes anything; it names the project and the command that would.
export function judgePortHolders(holders, ours) {
  const others = new Map();
  for (const { port, project } of holders) {
    if (project === null || project === undefined || project === ours) continue;
    const ports = others.get(project) ?? [];
    ports.push(port);
    others.set(project, ports);
  }
  return [...others].map(
    ([project, ports]) =>
      `ERROR fixture ports ${ports.join(", ")} are held by Compose project ${project}, not this checkout's ${ours}; stop it first if it is yours: docker compose -p ${project} down -v`,
  );
}

// Which Compose project publishes each fixture port, read from Docker. A container without the label holds the port
// as "(not Compose)".
export function readPortHolders(ports = FIXTURE_PORTS) {
  return ports.map((port) => {
    const out = execFileSync("docker", ["ps", "--filter", `publish=${port}`, "--format", '{{.Label "com.docker.compose.project"}}'], {
      encoding: "utf8",
    });
    if (out === "") return { port, project: null };
    const label = out.split("\n")[0].trim();
    return { port, project: label === "" ? "(not Compose)" : label };
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const name = composeProjectName(repo);
  if (process.argv.includes("--check-ports")) {
    const errors = judgePortHolders(readPortHolders(), name);
    for (const line of errors) console.error(line);
    process.exit(errors.length > 0 ? 1 : 0);
  }
  console.log(name);
}
