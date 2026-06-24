// 메시지 한 줄 + 날짜 구분선 렌더. el()/textContent 만 다뤄 innerHTML 없이 안전하다.
import { el, pad2 } from "../../core/dom.js";
import { tokenizeMessage } from "../../chat/linkify.js";
import { openExternal } from "../../platform/opener.js";

function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 메시지 본문을 텍스트/링크 노드 배열로 변환. URL은 클릭 시 기본 브라우저로 연다.
// el()이 textContent/자식 노드만 다루므로 innerHTML 없이 안전하게 링크를 삽입한다.
export function renderMessageText(text) {
  return tokenizeMessage(text).map((tok) => {
    if (tok.type === "url") {
      return el("a", {
        class: "msg-link",
        href: tok.value,
        title: tok.value,
        onClick: (e) => {
          e.preventDefault();
          openExternal(tok.value);
        },
      }, [tok.value]);
    }
    return document.createTextNode(tok.value);
  });
}

// 메시지 한 줄을 DOM으로 변환. failed/mine 플래그로 클래스 결정.
// displayName: 각 메시지의 박제값(sender_nickname) 그대로 — 닉네임을 바꿔도 과거 메시지는 불변.
// 본인은 항상 "you" — 닉네임 변경 후에도 본인에게는 시각적 변화 없음.
// attachment 가 있으면 이미지가 캡션과 별 줄에 표시된다(flex-wrap). aspect-ratio 를 미리 박아
// 로딩 중에도 layout shift 가 없게 한다 — 스크롤 앵커가 깨지지 않는다.
export function renderMessageRow(m) {
  const who = el("span", { class: "msg-who", text: m.mine ? "you" : (m.displayName || m.nickname) });
  const time = el("span", { class: "msg-time", text: fmtTime(m.ts) });
  const children = [who];
  if (m.attachment) {
    // data-kind 는 CSS 가 본인 업로드(image) 에만 retro-palette 필터를 걸기 위한 마커.
    // gif_external 은 원본 색 그대로 보존 — 외부 GIF 는 이미 작가 의도된 톤이라 그대로 둔다.
    const wrap = el("div", { class: "msg-image-wrap", dataset: { kind: m.attachment.kind || "" } });
    if (m.attachment.width && m.attachment.height) {
      wrap.style.aspectRatio = `${m.attachment.width} / ${m.attachment.height}`;
    }
    const img = el("img", {
      class: "msg-image",
      src: m.attachment.url,
      alt: "",
      loading: "lazy",
    });
    img.addEventListener("error", () => {
      wrap.replaceChildren(el("span", { class: "msg-image-broken", text: "[ × broken ]" }));
    });
    wrap.append(img);
    children.push(wrap);
  }
  if (m.text) {
    children.push(el("span", { class: "msg-text" }, renderMessageText(m.text)));
  }
  children.push(time);
  let cls = "msg";
  if (m.attachment) cls += " has-attach";
  if (m.mine) cls += " mine";
  if (m.failed) cls += " failed";
  return el("div", { class: cls, dataset: { id: m.id }, title: m.failed ? "send failed" : null }, children);
}

// 날짜 구분선 한 줄. dataset.id 를 "date-<yyyy-mm-dd>" 로 박아 스크롤 앵커(dataset.id 기준)에 자연스럽게
// 잡히게 하고, 메시지 UUID 와 충돌하지 않게 한다. 좌우 hairline 은 CSS ::before/::after 가 그린다.
export function renderDateDivider(dateStr) {
  return el("div", { class: "msg-date-divider", dataset: { id: "date-" + dateStr } }, [
    el("span", { class: "msg-date-divider-text", text: dateStr }),
  ]);
}
