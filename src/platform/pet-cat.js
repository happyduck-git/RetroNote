// 고른 펫 저장 — localStorage 영속, 재시작 복원. DI factory 는 screen-mode.js 컨벤션.
// cats.js 를 import 하지 않는다(platform→pet 레이어 역전 회피): 유효성 정규화는 소비 지점에서,
// 여기선 null/빈값만 "none" 으로 접는다.
const PET_CAT_KEY = "retro-note.pet-cat";
const DEFAULT_CAT = "none";

export function makePetCat({ storage }) {
  let cat = storage.getItem(PET_CAT_KEY) || DEFAULT_CAT;
  const listeners = new Set();

  const get = () => cat;
  const set = (next) => {
    next = next || DEFAULT_CAT;
    if (next === cat) return;
    cat = next;
    storage.setItem(PET_CAT_KEY, cat);
    for (const fn of listeners) fn(cat);
  };
  const onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  return { get, set, onChange };
}

// 순수 유닛테스트 환경(localStorage 없음)에선 null.
const instance =
  typeof localStorage !== "undefined" ? makePetCat({ storage: localStorage }) : null;

export function getPetCat() {
  return instance ? instance.get() : DEFAULT_CAT;
}

export function setPetCat(id) {
  instance?.set(id);
}

export function onPetCatChange(fn) {
  return instance ? instance.onChange(fn) : () => {};
}
