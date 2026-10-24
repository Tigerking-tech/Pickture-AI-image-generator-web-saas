import { describe, expect, it } from "vitest";
import { candidateSimilarity, diversifyFill, jaccardSimilarity } from "@/lib/diversity";

describe("jaccardSimilarity", () => {
  it("identical strings score 1", () => {
    expect(jaccardSimilarity("golden hour", "golden hour")).toBe(1);
  });

  it("disjoint token sets score 0", () => {
    expect(jaccardSimilarity("running", "standing")).toBe(0);
  });

  it("partial overlap: golden hour vs golden sunset = 1/3", () => {
    expect(jaccardSimilarity("golden hour", "golden sunset")).toBeCloseTo(1 / 3);
  });

  it("empty side scores 0 (no signal)", () => {
    expect(jaccardSimilarity("", "walking")).toBe(0);
  });
});

describe("candidateSimilarity", () => {
  it("shared 4+ char affix counts as morphological similarity (0.5)", () => {
    // moonlight/daylight 词元不重叠（Jaccard 0），但共享后缀 "-ight"
    expect(candidateSimilarity("moonlight", "daylight")).toBe(0.5);
  });

  it("jaccard wins when token overlap is stronger", () => {
    expect(candidateSimilarity("golden hour", "golden sunset")).toBeCloseTo(1 / 3);
  });
});

describe("diversifyFill", () => {
  it("keeps LLM-selected values at the front, unchanged", () => {
    const out = diversifyFill(["walking"], ["standing", "running", "jumping"], 3);
    expect(out[0]).toBe("walking");
    expect(out).toHaveLength(3);
  });

  it("never duplicates already-selected values", () => {
    const out = diversifyFill(["walking"], ["walking", "running"], 2);
    expect(out).toEqual(["walking", "running"]);
  });

  it("returns short result when pool is exhausted", () => {
    expect(diversifyFill(["a"], ["a", "b"], 4)).toEqual(["a", "b"]);
  });

  it("prefers the least similar candidate over a same-family one", () => {
    // daylight 与已选 moonlight 同族（共享 -ight，形态学 0.5）；neon 无相似信号，应先被选
    const out = diversifyFill(["moonlight"], ["daylight", "neon"], 2);
    expect(out).toEqual(["moonlight", "neon"]);
  });

  it("breaks similarity ties by pool distance (regression: no sequential fill)", () => {
    // 全部单词候选、相似度并列时，顺序填充会给出 standing —— 多样性填充应跳得更远
    const out = diversifyFill(["walking"], ["walking", "standing", "sitting", "jumping"], 2);
    expect(out).toEqual(["walking", "jumping"]);
  });
});
