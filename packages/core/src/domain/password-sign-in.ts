// Which failure each answer to a password sign-in is (T4-04 D4). It duck-types errors instead of importing ports/.
export type PasswordSignInFailure = "wrong-credentials" | "refused" | "unreachable" | "redirect" | "other";

// On both servers a 403 is not a wrong password: a locked or disabled account, or too many failed sign-ins.
function statusFailure(status: unknown): PasswordSignInFailure {
  if (status === 401) return "wrong-credentials";
  return status === 403 ? "refused" : "other";
}

/** Read from `name`, `kind`, `code` and `status`, never from a message. Undefined for a cancellation. */
export function passwordSignInFailure(error: unknown): PasswordSignInFailure | undefined {
  if (typeof error !== "object" || error === null) return "other";
  const { name, kind, code, status } = error as { name?: unknown; kind?: unknown; code?: unknown; status?: unknown };
  if (name === "SignInFailure") return kind === "redirect" ? "redirect" : "other";
  if (name === "AbortError") return undefined;
  switch (code) {
    case "cancelled":
      return undefined;
    case "network":
    case "timeout":
      return "unreachable";
    case "redirect":
      return "redirect";
    case "status":
      return statusFailure(status);
    default:
      return "other";
  }
}
