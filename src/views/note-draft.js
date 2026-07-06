// 새 노트 미저장 초안 저장소(메모리 전용, DOM 비의존) — note-view 에서 분리해 테스트 가능하게 함.
// 화면 재진입 시 초안을 복원하되, 로그아웃 시엔 비워 세션 내 사용자 전환 누수를 막는 것이 목적.
//
// 핵심 불변식: clear() 는 저장 내용을 비우는 동시에 진행 중인 캡처 클로저도 해제한다.
// 따라서 로그아웃 경로에서 clear() 와 (unmount 가 부르는) captureAndDisarm() 의 호출 순서가
// 어떻든 결과가 같다 — clear 이후의 captureAndDisarm 은 초안을 되살리지 못한다.
export function createDraftStore() {
  let content = ""; // 보존된 초안 텍스트
  let capture = null; // 현재 마운트의 캡처 클로저 | null

  return {
    // 마운트 시 에디터 초기값으로 사용(새 노트일 때만 호출).
    seed: () => content,
    // 마운트에서 무장: readDoc() 로 라이브 doc 을 읽고, keep() 이 참일 때만 보존.
    // (keep 은 보통 "새 노트로 시작 && 아직 첫 저장 전"을 뜻한다.)
    arm: (readDoc, keep) => {
      capture = () => {
        if (keep()) content = readDoc();
      };
    },
    // unmount 시 호출: destroy 전에 doc 을 읽어 보존한 뒤 캡처를 해제한다.
    captureAndDisarm: () => {
      capture?.();
      capture = null;
    },
    // 첫 저장 완료 시: 초안이 다음 새 노트에 재등장하지 않도록 비운다.
    clearOnSave: () => {
      content = "";
    },
    // 로그아웃(SIGNED_OUT) 시: 초안 폐기 + 진행 중 캡처 무효화(호출 순서 무관).
    clear: () => {
      content = "";
      capture = null;
    },
  };
}
