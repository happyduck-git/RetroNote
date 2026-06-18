// 노트 파일명 정책 (순수 — window/fs 의존 없음 → node 테스트 가능).
// 파일명 = note_YYYY-MM-DD_HH-MM-SS.{txt|md}. (구버전 분 단위 note_..._HH-MM.txt 도 유효로 인정.)
import { pad2 } from "./dom.js";

// 보안 경계: 아래 anchored allowlist 가 fs 진입을 막는 본질이다.
// ASCII 숫자/하이픈/리터럴 .txt|.md 만 허용 → 절대경로·NUL·유니코드 homoglyph·
// Windows 예약어(CON/AUX)·후행 점/공백을 전부 자동 거부. 절대 약화하지 말 것.
const NOTE_FILENAME_RE = /^note_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(-\d{2})?\.(txt|md)$/;

// Date → "YYYY-MM-DD_HH-MM-SS". 인자로 Date 를 받는 순수 함수(시계 무의존 → 테스트 가능).
// 초 단위까지 포함해 같은 분에 만든 노트끼리 파일명이 충돌하지 않게 한다.
export function formatTimestamp(date) {
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `_${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`
  );
}

// markdown:true 이면 .md, 아니면 기존 .txt. 확장자는 위 allowlist 가 인정하는 둘뿐.
export function noteFilename(date, { markdown = false } = {}) {
  return `note_${formatTimestamp(date)}.${markdown ? "md" : "txt"}`;
}

export function isNoteFilename(name) {
  return NOTE_FILENAME_RE.test(name);
}

// 최신순(내림차순). 타임스탬프가 zero-pad 되어 사전식 정렬과 시간순이 일치하므로 역순 비교.
export function compareNotesByName(a, b) {
  return b.localeCompare(a);
}

// 검증 통과 시 basename 그대로, 아니면 null. 호출부는 null 이면 throw 하여 fs 호출 전 차단.
export function safeBasename(filename) {
  return isNoteFilename(filename) ? filename : null;
}
