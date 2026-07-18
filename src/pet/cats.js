// 펫(고양이) 카탈로그 — 펫 창·설정 뷰·자르기 스크립트가 공유하는 단일 출처(순수 데이터/함수).
// id 는 저장 키(pet-cat pref)로도 쓰여 바꾸면 기존 저장값이 무효화된다(normalizeCat 이 방어).

export const CATS = [
  { id: "none", label: "NONE" }, // assetDir 없음 = 펫 숨김
  { id: "cream", label: "COOKIE", assetDir: "cream" },
  { id: "grey", label: "SMOKEY", assetDir: "grey" },
  { id: "black", label: "SHADOW", assetDir: "black" },
  { id: "greywhite", label: "SOCKS", assetDir: "greywhite" },
  { id: "orange", label: "MANGO", assetDir: "orange" },
  { id: "white", label: "MOCHI", assetDir: "white" },
];

export const CAT_IDS = CATS.map((c) => c.id);

export const catById = (id) => CATS.find((c) => c.id === id);

export const isValidCat = (id) => CAT_IDS.includes(id);

// 카탈로그에 없는 값(구버전 id·손상값) → "none" 으로 접어 안전하게 숨김.
export const normalizeCat = (id) => (isValidCat(id) ? id : "none");

export const assetBaseFor = (id) => {
  const c = catById(id);
  return c?.assetDir ? `assets/pet/${c.assetDir}/` : null;
};
