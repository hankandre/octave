export function retryDecision(input: { outcome: string | undefined; scriptStarted: boolean | undefined; shimFirst: boolean }): { retry: boolean; reason: string };
export function shimIsFirst(input: { pathValue: string | undefined; shimDir: string }): boolean;
