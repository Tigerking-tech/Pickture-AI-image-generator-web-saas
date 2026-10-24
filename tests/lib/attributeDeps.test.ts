import { describe, expect, it } from "vitest";
import { applyAttributeDeps, preferValues } from "@/lib/attributeDeps";
import { emptyVistaTree, type VistaGroup, type VistaTree } from "@/lib/vista";

function setAttr(
  tree: VistaTree,
  group: VistaGroup,
  key: string,
  value: string,
  candidates: string[],
  source?: "llm" | "image" | "user",
): void {
  tree[group][key] = { value, candidates, mode: "auto", ...(source ? { source } : {}) };
}

describe("preferValues", () => {
  it("moves preferred values to the front, keeps relative order, ignores unknowns", () => {
    expect(preferValues(["a", "b", "c"], ["c", "x"])).toEqual(["c", "a", "b"]);
  });
});

describe("applyAttributeDeps", () => {
  it("sunset boosts warm lighting.temperature to the front of candidates", () => {
    const tree = emptyVistaTree();
    setAttr(tree, "environment", "timeofday", "sunset", ["sunset"]);
    setAttr(tree, "lighting", "temperature", "", ["neutral", "warm", "cool"]);
    applyAttributeDeps(tree);
    expect(tree.lighting.temperature?.candidates[0]).toBe("warm");
  });

  it("fills an empty value with the preferred value already in candidates", () => {
    const tree = emptyVistaTree();
    setAttr(tree, "environment", "timeofday", "sunset", ["sunset"]);
    setAttr(tree, "lighting", "temperature", "", ["neutral", "warm", "cool"]);
    applyAttributeDeps(tree);
    expect(tree.lighting.temperature?.value).toBe("warm");
  });

  it("never invents a value that is not in candidates", () => {
    const tree = emptyVistaTree();
    setAttr(tree, "environment", "timeofday", "sunset", ["sunset"]);
    setAttr(tree, "lighting", "temperature", "", ["neutral", "cool"]);
    applyAttributeDeps(tree);
    expect(tree.lighting.temperature?.value).toBe("");
  });

  it("never touches user-picked attributes", () => {
    const tree = emptyVistaTree();
    setAttr(tree, "environment", "timeofday", "sunset", ["sunset"]);
    setAttr(tree, "lighting", "temperature", "cool", ["cool", "warm"], "user");
    const adjusted = applyAttributeDeps(tree);
    expect(tree.lighting.temperature?.candidates).toEqual(["cool", "warm"]);
    expect(tree.lighting.temperature?.value).toBe("cool");
    expect(adjusted).not.toContain("lighting.temperature");
  });

  it("does nothing when the trigger attribute has no value", () => {
    const tree = emptyVistaTree();
    setAttr(tree, "environment", "timeofday", "", ["sunset"]);
    setAttr(tree, "lighting", "temperature", "", ["neutral", "warm"]);
    expect(applyAttributeDeps(tree)).toEqual([]);
  });

  it("does nothing when the trigger value matches no rule", () => {
    const tree = emptyVistaTree();
    setAttr(tree, "environment", "timeofday", "morning", ["morning"]);
    setAttr(tree, "lighting", "temperature", "", ["neutral", "warm"]);
    expect(applyAttributeDeps(tree)).toEqual([]);
  });

  it("night rule boosts neon lighting type", () => {
    const tree = emptyVistaTree();
    setAttr(tree, "environment", "timeofday", "night", ["night"]);
    setAttr(tree, "lighting", "type", "", ["ambient", "neon", "practical lamps"]);
    applyAttributeDeps(tree);
    expect(tree.lighting.type?.candidates[0]).toBe("neon");
  });

  it("returns the ids of every adjusted attribute", () => {
    const tree = emptyVistaTree();
    setAttr(tree, "environment", "timeofday", "sunset", ["sunset"]);
    setAttr(tree, "lighting", "temperature", "", ["neutral", "warm"]);
    setAttr(tree, "lighting", "color", "", ["blue", "golden"]);
    const adjusted = applyAttributeDeps(tree);
    expect(adjusted).toContain("lighting.temperature");
    expect(adjusted).toContain("lighting.color");
  });
});
