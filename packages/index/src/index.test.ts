import { describe, expect, test } from "vitest";
import { reciprocalRankFusion } from "./index.js";

describe("reciprocalRankFusion", () => {
  test("ranks an item appearing in both lists above one appearing in only one", () => {
    const lexical = ["doc-a", "doc-b", "doc-c"];
    const semantic = ["doc-c", "doc-a", "doc-d"];

    const fused = reciprocalRankFusion([lexical, semantic]);

    expect(fused[0]?.id).toBe("doc-a");
    expect(fused.map((hit) => hit.id)).toContain("doc-d");
  });

  test("is a pure function of its inputs", () => {
    const a = reciprocalRankFusion([
      ["x", "y"],
      ["y", "x"],
    ]);
    const b = reciprocalRankFusion([
      ["x", "y"],
      ["y", "x"],
    ]);
    expect(a).toEqual(b);
  });
});
