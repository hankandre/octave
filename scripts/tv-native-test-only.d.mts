export function filterFrom(args: string[]): { filter: string; error?: undefined } | { filter?: undefined; error: string };
export function judgeFiltered(targets: { project: string; xml: string[] }[]): { line: string; errors: string[] };
