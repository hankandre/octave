// T4-02 item 7 (docs/specs/T4-02.md, D6): the servers chosen in this launch, most recent first, one per id.
import { describe, expect, it } from "vitest";
import { MemoryRememberedServers } from "./remembered-servers";

const ONE = { id: "0123456789abcdef0123456789abcdef", name: "One", address: "https://one.example.test" };
const TWO = { id: "fedcba9876543210fedcba9876543210", name: "Two", address: "https://two.example.test" };

describe("T4-02 item 7: the remembered servers", () => {
  it("T4-02 item 7: starts empty", () => {
    expect(new MemoryRememberedServers().list()).toEqual([]);
  });

  it("T4-02 item 7: lists the most recent choice first", () => {
    const store = new MemoryRememberedServers();
    store.remember(ONE);
    store.remember(TWO);
    expect(store.list()).toEqual([TWO, ONE]);
  });

  it("T4-02 item 7: keeps one entry per id, and a later choice replaces the earlier one and moves to the front", () => {
    const store = new MemoryRememberedServers();
    store.remember(ONE);
    store.remember(TWO);
    const moved = { id: ONE.id, name: "One, moved", address: "https://one.example.test:8920" };
    store.remember(moved);
    expect(store.list()).toEqual([moved, TWO]);
  });

  it("T4-02 item 7: each launch has its own store", () => {
    new MemoryRememberedServers().remember(ONE);
    expect(new MemoryRememberedServers().list()).toEqual([]);
  });
});
