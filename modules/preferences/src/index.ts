// The preferences module's JavaScript surface (T9-02): two functions. Types only: the one place that loads the native
// module is apps/tv/src/host/preferences-module.android.ts.
//
// read() answers the stored device preferences record, or null when none is stored, it cannot be read, or it is not a
// record the store accepts. write(record) stores the record and answers true; it answers false, and writes nothing,
// when the record is not one the store accepts or the store cannot be written. The store accepts only the device
// record's shape (docs/specs/T9-02.md, D4), so it is not a general store. The record is not a secret.

export interface OctavePreferencesNative {
  read(): Promise<string | null>;
  write(record: string): Promise<boolean>;
}
