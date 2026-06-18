// 채팅 메시지 텍스트에서 URL을 찾아 토큰으로 분리하는 순수 함수.
// DOM/Tauri에 의존하지 않으므로 node:test 로 그대로 검증 가능하다.
// 실제 <a> 노드 생성과 외부 열기는 views(room-view) / platform(opener) 레이어가 담당한다.

// http/https 스킴이 명시된 URL만 인식한다(오탐 최소화). 공백 전까지를 URL 후보로 본다.
const URL_RE = /https?:\/\/[^\s]+/g;

// URL 끝에 붙기 쉬운 문장부호는 링크에서 제외한다. 예: "...example.com." 의 마침표,
// "(https://a.com)" 의 닫는 괄호. 제외된 부분은 뒤따르는 text 토큰으로 흘러간다.
const TRAILING_PUNCT = /[.,!?:;'")\]}>]+$/;

// text(string) → [{ type: "text", value }, { type: "url", value }, ...]
export function tokenizeMessage(text) {
  const tokens = [];
  let lastIndex = 0;
  for (const match of String(text).matchAll(URL_RE)) {
    const start = match.index;
    const url = match[0].replace(TRAILING_PUNCT, "");
    if (!url) continue;
    if (start > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    tokens.push({ type: "url", value: url });
    // 후행 문장부호는 URL에서 제외했으므로 다음 text 토큰에 포함되도록 url 길이만큼만 전진.
    lastIndex = start + url.length;
  }
  if (lastIndex < String(text).length) {
    tokens.push({ type: "text", value: String(text).slice(lastIndex) });
  }
  if (tokens.length === 0) tokens.push({ type: "text", value: String(text) });
  return tokens;
}
