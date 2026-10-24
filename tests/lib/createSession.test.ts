import { describe, expect, it } from "vitest";
import { type CreateSessionSnapshot, parseSession, serializeSession } from "@/lib/createSession";
import { emptyVistaTree } from "@/lib/vista";

function validSnapshot(): CreateSessionSnapshot {
  return {
    sentence: "a cat running at sunset",
    tree: emptyVistaTree(),
    nodeImages: { "character.pose": ["https://cdn.example/1.png"] },
    picked: { "character.pose": "running" },
    pickedImageUrl: "https://cdn.example/1.png",
    finalImage: null,
    sessionId: "s-1",
    regenCount: { "character.pose": 2 },
  };
}

describe("createSession", () => {
  it("round-trips a snapshot through serialize + parse", () => {
    const snap = validSnapshot();
    expect(parseSession(serializeSession(snap))).toEqual(snap);
  });

  it("returns null for null input", () => {
    expect(parseSession(null)).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseSession("not json {")).toBeNull();
  });

  it("returns null for a version mismatch", () => {
    expect(parseSession(JSON.stringify({ v: 999, ...validSnapshot() }))).toBeNull();
  });

  it("returns null when sessionId is missing or empty", () => {
    expect(parseSession(JSON.stringify({ v: 1, ...validSnapshot(), sessionId: "" }))).toBeNull();
  });

  it("returns null when the tree is missing a VISTA group", () => {
    const snap = { v: 1, ...validSnapshot(), tree: { info: {} } };
    expect(parseSession(JSON.stringify(snap))).toBeNull();
  });

  it("accepts a null tree (session saved before decompose)", () => {
    const snap = { ...validSnapshot(), tree: null };
    expect(parseSession(serializeSession(snap))).toEqual(snap);
  });

  it("returns null when nodeImages has a non-array value", () => {
    const snap = { v: 1, ...validSnapshot(), nodeImages: { "character.pose": "oops" } };
    expect(parseSession(JSON.stringify(snap))).toBeNull();
  });

  it("tolerates unknown extra fields (forward compatibility)", () => {
    const raw = JSON.stringify({ v: 1, ...validSnapshot(), futureField: { x: 1 } });
    const parsed = parseSession(raw);
    expect(parsed?.sentence).toBe(validSnapshot().sentence);
    expect(parsed && "futureField" in parsed).toBe(false);
  });
});
