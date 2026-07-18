import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CATS, CAT_IDS, catById, isValidCat, normalizeCat, assetBaseFor } from "./cats.js";

describe("cats 카탈로그", () => {
  test("none 이 첫 항목, id 는 중복 없음", () => {
    assert.equal(CATS[0].id, "none");
    assert.equal(new Set(CAT_IDS).size, CAT_IDS.length);
  });

  test("none 은 assetDir 없음, 나머지는 있음", () => {
    assert.equal(catById("none").assetDir, undefined);
    for (const c of CATS.filter((c) => c.id !== "none")) {
      assert.ok(c.assetDir, `${c.id} 는 assetDir 필요`);
    }
  });

  test("isValidCat: 유효/무효", () => {
    assert.equal(isValidCat("orange"), true);
    assert.equal(isValidCat("none"), true);
    assert.equal(isValidCat("nope"), false);
    assert.equal(isValidCat(undefined), false);
  });

  test("normalizeCat: none/유효 유지, 미지값 → none", () => {
    assert.equal(normalizeCat("none"), "none");
    assert.equal(normalizeCat("black"), "black");
    assert.equal(normalizeCat("ghost"), "none");
    assert.equal(normalizeCat(null), "none");
    assert.equal(normalizeCat(""), "none");
  });

  test("assetBaseFor: none/무효 → null, 색 → 경로", () => {
    assert.equal(assetBaseFor("none"), null);
    assert.equal(assetBaseFor("bogus"), null);
    assert.equal(assetBaseFor("cream"), "assets/pet/cream/");
    assert.equal(assetBaseFor("grey"), "assets/pet/grey/");
    assert.equal(assetBaseFor("white"), "assets/pet/white/");
  });
});
