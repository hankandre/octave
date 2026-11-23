// Receives filtered reason text only (errorReason output); never state, an event or a prop.
export type FailureLog = (reason: string) => void;
