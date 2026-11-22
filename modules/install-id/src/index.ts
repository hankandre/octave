// The install id module's JavaScript surface (T4-09): one function. Types only: the one place that loads the native
// module is apps/tv/src/host/install-id-module.android.ts.
//
// keep(candidate) answers the stored id; when none is stored it stores the candidate and answers it. It answers null
// when the candidate is not a lowercase version 4 UUID or the store cannot be read or written. The id is not a secret.

export interface OctaveInstallIdNative {
  keep(candidate: string): Promise<string | null>;
}
