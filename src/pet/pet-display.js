// 펫 "표시 결정"의 순수 컨트롤러. 부수효과(이미지 로드·창 show/hide·스프라이트 렌더)는 콜백 주입.
// 비동기 로드의 경쟁상태를 last-wins 로 직렬화 → 유령 빈 창·부활(늦게 온 이전 색)·역순 표시 버그 차단.
import { assetBaseFor, normalizeCat } from "./cats.js";

export function makePetDisplayController({ loadImage, show, hide, render }) {
  let desired = "none"; // 마지막 요청 색(경쟁 판정 기준)

  function setCat(catId) {
    const id = normalizeCat(catId);
    desired = id;

    const base = assetBaseFor(id);
    if (!base) {
      hide();
      return;
    }

    // 선로드 성공 시에만 show(빈 창 방지). 커밋 직전 desired 재확인 → 순서 뒤바뀌어 와도 마지막 색만 반영.
    Promise.resolve(loadImage(base))
      .then(() => {
        if (id !== desired) return;
        render(id); // show 전에 스프라이트 확정 → 잔상 없음
        show();
      })
      .catch(() => {
        // 로드 실패 → show 안 함. 현재 표시는 건드리지 않음(일시 오류로 멀쩡한 펫 숨기지 않게).
      });
  }

  return { setCat };
}
