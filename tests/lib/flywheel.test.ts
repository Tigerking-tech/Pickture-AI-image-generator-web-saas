import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  applyGlobalRerank,
  fetchPickStats,
  MIN_PICKS_PER_ATTR,
  type PickStats,
  rerankCandidates,
} from "@/lib/flywheel";
import { emptyVistaTree } from "@/lib/vista";

function mockDb(rows: Array<{ node_attr: string; candidate_value: string | null }> | null) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    limit: () => Promise.resolve({ data: rows, error: rows === null ? "boom" : null }),
  };
  return { from: () => chain } as unknown as Pick<SupabaseClient, "from">;
}

describe("rerankCandidates", () => {
  it("sorts candidates by historical pick count, descending", () => {
    const stats = new Map([
      ["b", 5],
      ["a", 1],
    ]);
    expect(rerankCandidates(["a", "b", "c"], stats)).toEqual(["b", "a", "c"]);
  });

  it("keeps original relative order on ties (stable)", () => {
    const stats = new Map([
      ["a", 2],
      ["c", 2],
    ]);
    expect(rerankCandidates(["a", "b", "c"], stats)).toEqual(["a", "c", "b"]);
  });

  it("returns candidates unchanged when nobody has stats", () => {
    expect(rerankCandidates(["a", "b"], new Map())).toEqual(["a", "b"]);
  });

  it("returns single-candidate lists unchanged", () => {
    expect(rerankCandidates(["a"], new Map([["a", 9]]))).toEqual(["a"]);
  });
});

describe("applyGlobalRerank", () => {
  it("reranks an attribute once it has enough samples", () => {
    const tree = emptyVistaTree();
    tree.lighting.direction = {
      value: "front light",
      candidates: ["front light", "backlight"],
      mode: "visual",
    };
    const stats: PickStats = new Map([
      [
        "lighting.direction",
        new Map([
          ["backlight", 15],
          ["front light", 10],
        ]),
      ],
    ]);
    const reranked = applyGlobalRerank(tree, stats);
    expect(tree.lighting.direction?.candidates).toEqual(["backlight", "front light"]);
    expect(reranked).toEqual(["lighting.direction"]);
  });

  it("skips attributes below the cold-start threshold", () => {
    const tree = emptyVistaTree();
    tree.lighting.direction = {
      value: "",
      candidates: ["front light", "backlight"],
      mode: "visual",
    };
    const stats: PickStats = new Map([
      ["lighting.direction", new Map([["backlight", MIN_PICKS_PER_ATTR - 1]])],
    ]);
    expect(applyGlobalRerank(tree, stats)).toEqual([]);
    expect(tree.lighting.direction?.candidates).toEqual(["front light", "backlight"]);
  });

  it("never touches the current value, only candidate order", () => {
    const tree = emptyVistaTree();
    tree.lighting.direction = {
      value: "front light",
      candidates: ["front light", "backlight"],
      mode: "visual",
    };
    const stats: PickStats = new Map([["lighting.direction", new Map([["backlight", 25]])]]);
    applyGlobalRerank(tree, stats);
    expect(tree.lighting.direction?.value).toBe("front light");
  });

  it("ignores stats for attributes the tree does not have", () => {
    const tree = emptyVistaTree();
    const stats: PickStats = new Map([["character.pose", new Map([["running", 30]])]]);
    expect(() => applyGlobalRerank(tree, stats)).not.toThrow();
  });
});

describe("fetchPickStats", () => {
  it("aggregates pick counts per attribute and value", async () => {
    const db = mockDb([
      { node_attr: "character.pose", candidate_value: "running" },
      { node_attr: "character.pose", candidate_value: "running" },
      { node_attr: "character.pose", candidate_value: "sitting" },
      { node_attr: "lighting.direction", candidate_value: "backlight" },
    ]);
    const stats = await fetchPickStats(db, ["character.pose", "lighting.direction"]);
    expect(stats.get("character.pose")?.get("running")).toBe(2);
    expect(stats.get("character.pose")?.get("sitting")).toBe(1);
    expect(stats.get("lighting.direction")?.get("backlight")).toBe(1);
  });

  it("skips rows with null candidate_value", async () => {
    const db = mockDb([{ node_attr: "character.pose", candidate_value: null }]);
    const stats = await fetchPickStats(db, ["character.pose"]);
    expect(stats.size).toBe(0);
  });

  it("returns an empty map on query failure (never breaks decompose)", async () => {
    const stats = await fetchPickStats(mockDb(null), ["character.pose"]);
    expect(stats.size).toBe(0);
  });

  it("returns an empty map when no attributes are requested", async () => {
    const stats = await fetchPickStats(mockDb([]), []);
    expect(stats.size).toBe(0);
  });
});
