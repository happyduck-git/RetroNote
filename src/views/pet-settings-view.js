// 펫 설정 화면: none + 색상별 고양이를 고른다. 고르면 즉시 반영·저장(재시작 복원).
// 클릭은 pet-cat pref 만 바꾸고(SSOT), 실제 펫 표시는 브리지가 pet:set-cat 으로 처리한다.
import { el } from "../core/dom.js";
import { CATS, assetBaseFor, normalizeCat } from "../pet/cats.js";
import { ANIMATIONS } from "../pet/sprite.js";
import { getPetCat, setPetCat, onPetCatChange } from "../platform/pet-cat.js";
import { playKey } from "../platform/sound.js";

// 미리보기 채우기. background-image 는 onerror 가 없어 new Image() 로 먼저 존재를 확인한 뒤 적용
// (에셋 없으면 '?' placeholder).
function fillPreview(previewEl, base) {
  const src = base + ANIMATIONS.idle.img;
  const apply = () => {
    previewEl.classList.remove("empty");
    previewEl.textContent = "";
    previewEl.style.backgroundImage = `url(${src})`;
    previewEl.style.backgroundSize = `${ANIMATIONS.idle.frames * 100}% 100%`;
    previewEl.style.backgroundPosition = "left center";
  };
  const img = new Image();
  img.onload = apply;
  img.onerror = () => {
    previewEl.classList.add("empty");
    previewEl.textContent = "?";
  };
  img.src = src;
  if (img.complete && img.naturalWidth > 0) apply(); // 캐시 즉시완료 폴백
}

export const petSettingsView = {
  mount(screenEl, params, ctx) {
    const title = el("div", { class: "menu-title", text: "PET" });
    const list = el("div", { class: "pet-picker" });
    const rows = new Map();

    for (const cat of CATS) {
      const preview = el("div", { class: "pet-preview empty" });
      const base = assetBaseFor(cat.id);
      if (base) {
        fillPreview(preview, base);
      } else {
        preview.classList.add("off");
        preview.textContent = "OFF";
      }
      const row = el(
        "button",
        {
          class: "btn pet-picker-item",
          dataset: { noDrag: "" },
          onClick: () => {
            playKey();
            setPetCat(cat.id);
          },
        },
        [preview, el("span", { class: "pet-picker-label", text: cat.label })],
      );
      rows.set(cat.id, row);
      list.append(row);
    }

    // 현재 선택 강조 + 외부 변경(우클릭 Remove 등)도 최신화. 저장값이 손상돼도 normalizeCat 으로 접어 어긋남 방지.
    const applyActive = (id) => {
      for (const [rid, row] of rows) row.classList.toggle("active", rid === id);
    };
    applyActive(normalizeCat(getPetCat()));
    // 구독 핸들은 뷰 객체에(lobby-view 의 this._unsub 관례). 라우터가 mount 전 unmount 보장.
    this._unsub = onPetCatChange(applyActive);

    screenEl.append(el("div", { class: "menu pet-settings" }, [title, list]));
  },
  unmount() {
    this._unsub?.();
    this._unsub = null;
  },
};
