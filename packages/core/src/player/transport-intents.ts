// The pauses and seeks the engine was asked for and has not reported yet (T8-04 D3, spec check issue 4). The engine sends
// one `state` event per accepted call, in call order, so each event of a kind retires the oldest request of that kind. A
// later press therefore builds on the newest request, not on a snapshot that an earlier one has not reached.

// One request, kept by identity so a refused call withdraws only itself.
interface Intent<Value> {
  value: Value;
}

export class PendingIntents<Value> {
  private pending: Intent<Value>[] = [];

  add(value: Value): Intent<Value> {
    const intent = { value };
    this.pending.push(intent);
    return intent;
  }

  /** The value of the newest request still outstanding. */
  latest(): Value | undefined {
    return this.pending.at(-1)?.value;
  }

  /** The engine reported the oldest request. */
  landed(): void {
    this.pending.shift();
  }

  /** The engine refused this request. */
  withdraw(intent: Intent<Value>): void {
    this.pending = this.pending.filter((candidate) => candidate !== intent);
  }

  clear(): void {
    this.pending = [];
  }
}
