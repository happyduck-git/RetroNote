// 채팅방: 메시지 목록 + 입력 + 전송 + 나가기. 연결 상태/온라인 인원 표시.
// 영속 메시지는 Postgres에서 history fetch → store.seed. 새 메시지는 postgres_changes echo.
// 송신은 transport.send (DB INSERT) → echo로 자기 자신에게도 돌아오지만 store의 id dedup이 처리.
// UI 컴포넌트(헤더/입력행/picker/lightbox/메시지 렌더)는 ./room/* 모듈로 분리. 여기서는 조립·배선만.
import { el } from "../core/dom.js";
import { playKey } from "../platform/sound.js";
import { getRoomNickname, getClientId, openRoom, closeRoom, saveRoom, changeRoomNickname } from "../chat/session.js";
import { withDateDividers } from "../chat/date-divider.js";
import { uploadAttachment } from "../chat/attachment.js";
import { isGiphyConfigured } from "../chat/giphy.js";
import { buildHeader, STATUS_TEXT } from "./room/header.js";
import { buildNickEditor } from "./room/nick-editor.js";
import { buildInputRow } from "./room/input-row.js";
import { buildAttachPreview, buildAttachMenu } from "./room/attach.js";
import { buildGifPicker } from "./room/gif-picker.js";
import { buildLightbox } from "./room/lightbox.js";
import { buildEmojiPicker } from "./room/emoji-picker.js";
import { createScrollAnchor } from "./room/scroll-anchor.js";
import { renderMessageRow, renderDateDivider } from "./room/message-row.js";

// mount 토큰: 동일 뷰 객체가 register-once 싱글톤이라 await 중 재mount가 끼어들 수 있다.
// mount 진입 시 myToken 캡처 → unmount/재mount는 mountToken 증가 → 이전 await 분기가 자기 myToken 과의 불일치로 빠진다.
let mountToken = 0;

export const roomView = {
  _code: null,
  _cleanup: null,

  async mount(screenEl, params, ctx) {
    const code = params.code;
    const clientId = getClientId();
    const myToken = ++mountToken;

    // 안전망: 닉네임 없이 직접 진입한 경우(라우터 직접 호출 등) nickname으로 우회.
    // 여기서는 존재 여부만 본다 — 실제 표시값은 openRoom 의 양방향 sync 가 끝난 후 다시 읽는다.
    if (!getRoomNickname(code)) {
      ctx.navigate("nickname", { code });
      return;
    }

    // 로딩 중 화면(history fetch 동안 표시).
    const loading = el("div", { class: "form-label", text: "loading history…" });
    screenEl.append(el("div", { class: "room" }, [loading]));

    let entry;
    try {
      entry = await openRoom(code);
    } catch (e) {
      console.error("openRoom failed:", e);
      if (mountToken === myToken) ctx.navigate("lobby");
      return;
    }
    // mount 도중 사용자가 다른 화면으로 이동 → 정리하고 종료.
    if (mountToken !== myToken) {
      closeRoom(code);
      return;
    }
    this._code = code;
    saveRoom(code);
    const { transport, store, userId, backfill } = entry;

    // openRoom 의 "로컬·서버 다름 → 서버 우선" 분기가 localStorage 를 갱신했을 수 있다.
    // 다른 기기에서 닉네임을 바꾸고 이 기기에서 재입장한 케이스에 새 이름으로 헤더가 떠야 한다.
    const nickname = getRoomNickname(code);

    // --- DOM 구성 ---
    screenEl.replaceChildren();
    const nicknameEditor = buildNickEditor(
      () => getRoomNickname(code),
      (newNick) => changeRoomNickname(code, newNick),
    );
    const { headerEl, statusEl } = buildHeader(code, {
      onLeave: () => ctx.navigate("lobby"),
      nicknameEditor,
    });
    const list = el("div", { class: "room-list", dataset: { noDrag: "" } });
    const showGif = isGiphyConfigured();
    const { inputRowEl, emojiBtn, mediaBtn, fileInput, input, sendBtn } = buildInputRow({ showGif });
    // emoji picker 팝업은 input row 의 자식으로 append — input row 의 position: relative 가 앵커.
    const picker = buildEmojiPicker(input);
    inputRowEl.append(picker.popupEl);
    emojiBtn.addEventListener("click", () => {
      if (emojiBtn.disabled) return;
      picker.toggle();
    });

    // --- 첨부/GIF 상태 ---
    // 한 번에 하나의 첨부만 허용 — 업로드 완료 후 SEND 까지 보류한다. SEND 또는 [×] 로 해제.
    let pendingAttachment = null;
    // 미리보기에 보여 줄 첨부 라벨(파일명 또는 GIF 제목). 전송 실패 시 첨부 미리보기 복원에 쓴다.
    let pendingAttachmentLabel = "";
    // 업로드가 진행 중인 동안(아직 pendingAttachment 가 비어 있는 구간) [+] 버튼을 잠그는 플래그.
    // 이게 없으면 업로드 도중 고른 GIF 의 staging 이 업로드 완료 시점에 조용히 덮어써진다.
    let uploading = false;
    const attachPreview = buildAttachPreview({
      onRemove: () => {
        pendingAttachment = null;
        pendingAttachmentLabel = "";
        fileInput.value = "";
        attachPreview.hide();
        syncMediaBtn();
      },
    });
    // 첨부([+]) 버튼은 연결 전·첨부 보류 중·업로드 중에는 비활성 — 그 사이 메뉴를 못 열게 한다.
    function syncMediaBtn() {
      mediaBtn.disabled = connState !== "connected" || !!pendingAttachment || uploading;
    }

    // GIF picker·첨부 메뉴는 Giphy 키가 있을 때(showGif)만 만든다.
    // GIF 셀 클릭 → 즉시 전송하지 않고 첨부로 스테이징(이미지 첨부와 동일 흐름). 텍스트와 함께 SEND 로 보낸다.
    function onGifPick(gif) {
      // 한 번에 하나만 — 이미 첨부가 있거나 업로드 중이면 무시한다(파일 첨부 경로와 동일 정책).
      // 평소엔 syncMediaBtn 가 이 상태에서 [+] 버튼을 잠그지만, 만약을 위한 방어 가드.
      if (pendingAttachment || uploading) return;
      // 외부(Giphy) GIF 는 업로드가 없어 바로 ready.
      pendingAttachment = {
        url: gif.gifUrl,
        kind: "gif_external",
        mime: "image/gif",
        width: gif.gifW,
        height: gif.gifH,
        bytes: gif.gifBytes,
      };
      fileInput.value = "";
      const label = gif.title && gif.title.trim() ? gif.title.trim() : "GIF";
      pendingAttachmentLabel = label;
      attachPreview.show({ filename: label, status: "ready", bytes: gif.gifBytes });
      syncMediaBtn();
      input.focus();
    }
    // [img] 선택 → 파일 선택창, [gif] 선택 → Giphy picker. 메뉴는 항목 클릭 시 스스로 닫힌다.
    const gifPicker = showGif ? buildGifPicker(onGifPick) : null;
    const attachMenu = showGif
      ? buildAttachMenu({
          onPickImage: () => {
            if (!pendingAttachment) fileInput.click();
          },
          onPickGif: () => gifPicker.show(),
        })
      : null;
    if (gifPicker) inputRowEl.append(gifPicker.popupEl);
    if (attachMenu) inputRowEl.append(attachMenu.popupEl);

    // lightbox 는 .room 의 마지막 자식으로 → position: absolute + inset: 0 으로 자연스럽게 채움.
    const lightbox = buildLightbox();
    screenEl.append(el("div", { class: "room" }, [headerEl, list, attachPreview.el, inputRowEl, lightbox.el]));

    // 메시지 리스트의 이미지 클릭을 위임 처리 — 메시지마다 핸들러를 달지 않는다.
    // broken 폴백(span)이나 다른 영역 클릭은 .msg-image 매칭이 안 돼 자연스럽게 무시.
    list.addEventListener("click", (e) => {
      const img = e.target.closest?.(".msg-image");
      if (!img) return;
      const wrap = img.closest(".msg-image-wrap");
      lightbox.show(img.src, { kind: wrap?.dataset.kind || "" });
    });

    // [+] 클릭: 첨부 메뉴([img]/[gif]) 토글. Giphy 키가 없으면(showGif=false) 메뉴 없이 곧장 파일 선택.
    // 업로드 중에는 mount 가 갈아끼워질 수 있어 mountToken 가드로 늦은 setState 를 차단.
    mediaBtn.addEventListener("click", () => {
      if (mediaBtn.disabled) return;
      if (pendingAttachment) return; // 한 번에 하나만 — 기존 첨부 제거 후 다시 클릭해야 한다.
      if (attachMenu) attachMenu.toggle();
      else fileInput.click();
    });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (pendingAttachment || uploading) return;
      const filename = file.name;
      uploading = true;
      attachPreview.show({ filename, status: "uploading" });
      // 업로드 중에는 [+] 버튼을 잠근다 — 그 사이 메뉴로 GIF 를 골라도 staging 이 덮어써지지 않도록.
      syncMediaBtn();
      try {
        const att = await uploadAttachment(file, code);
        if (mountToken !== myToken) return;
        pendingAttachment = att;
        pendingAttachmentLabel = filename;
        attachPreview.show({ filename, status: "ready", bytes: att.bytes });
      } catch (e) {
        console.error("upload failed:", e);
        if (mountToken === myToken) {
          attachPreview.show({ filename, status: "error", message: e.message });
        }
      } finally {
        uploading = false;
        if (mountToken === myToken) {
          syncMediaBtn();
        }
        fileInput.value = "";
      }
    });

    // --- 상태 렌더링: 연결 상태 + 온라인 인원 ---
    let connState = "connecting";
    let onlineCount = null;
    function renderStatus() {
      statusEl.classList.toggle("room-status--error", connState === "error");
      if (connState === "connected") {
        statusEl.textContent = onlineCount != null ? `● ${onlineCount} online` : STATUS_TEXT.connected;
      } else {
        statusEl.textContent = STATUS_TEXT[connState] || connState;
      }
    }

    // --- 스크롤 앵커 + 메시지 렌더링 ---
    const { captureAnchor, restoreScroll } = createScrollAnchor(list);
    list.addEventListener("scroll", captureAnchor, { passive: true });
    const unsubStore = store.subscribe((messages) => {
      // 날짜가 바뀌는 첫 메시지 앞에 yyyy-mm-dd 구분선을 끼워 넣는다(로컬 시간대 기준).
      const rows = withDateDividers(messages);
      list.replaceChildren(
        ...rows.map((item) => (item.divider ? renderDateDivider(item.date) : renderMessageRow(item))),
      );
      restoreScroll();
    });
    const ro = new ResizeObserver(restoreScroll);
    ro.observe(list);
    // ResizeObserver 백업: Tauri 그립 드래그 시 .room-list 박스 변동이 한 박자 늦거나
    // 누락되는 경우를 대비해 window resize에도 보정한다.
    window.addEventListener("resize", restoreScroll);

    // --- backfill: 재연결/visibility 복귀 시 그동안 놓친 메시지를 보충 ---
    // backfill 인스턴스는 openRoom 에서 미리 만들어져 entry 에 들어 있다(테스트 가능성/단일 책임).

    // --- transport 이벤트 wiring ---
    // 첫 connected는 openRoom의 seed가 이미 처리했으므로 backfill 생략. 이후 재진입(재연결)에서만 호출.
    let hadConnectedOnce = false;
    const unsubStatus = transport.on("status", ({ state }) => {
      connState = state;
      const ok = state === "connected";
      // 송신만 게이팅 — input/emoji picker 는 local 동작이므로 disconnect 중에도
      // 메시지 작성/카오모지 삽입을 허용해 재연결 대기 시간을 가릴 수 있게 한다.
      // 첨부([+])는 외부 호출(업로드/Giphy)이라 연결 상태와 함께 토글한다.
      sendBtn.disabled = !ok;
      syncMediaBtn();
      renderStatus();
      if (ok) {
        if (hadConnectedOnce) backfill();
        hadConnectedOnce = true;
      }
    });
    // realtime 채널이 자신의 죽음을 모르는 경우 보강: 탭/창이 다시 보이게 되면 즉시 갭필.
    const onVisibility = () => {
      if (document.visibilityState === "visible") backfill();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const unsubPres = transport.on("presence", ({ count }) => {
      onlineCount = count;
      renderStatus();
    });

    // --- 송신: DB INSERT 하나로 보내고, postgres_changes echo가 자기 자신에게도 돌아옴.
    // 즉시 응답을 위해 낙관적 add도 함께 한다(중복은 store의 id dedup이 처리).
    async function doSend() {
      // disconnect 중에도 input 은 enabled 라 Enter 키가 그대로 들어옴 — sendBtn 게이트와
      // 동일하게 막아 transport.send 가 실패→failed 메시지로 박히는 것을 방지.
      if (sendBtn.disabled) return;
      const text = input.value.trim();
      // text 와 첨부 중 적어도 하나는 있어야 한다 — DB check constraint 와 동일 정책.
      if (!text && !pendingAttachment) return;
      // send 시점에 라이브로 다시 읽는다 — [✎]로 닉네임을 바꾼 직후 보낸 메시지는
      // 새 이름으로 박제되어야 한다(snapshot fallback 도 새 이름으로 남음).
      const liveNick = getRoomNickname(code) || nickname;
      const msg = { id: crypto.randomUUID(), clientId, senderUid: userId, nickname: liveNick, text, ts: Date.now() };
      if (pendingAttachment) msg.attachment = pendingAttachment;
      // 전송 실패 시 되돌리기 위해 비우기 전에 보관해 둔다.
      const prevText = input.value;
      const prevAttachment = pendingAttachment;
      const prevLabel = pendingAttachmentLabel;
      input.value = "";
      // 첨부는 한 번 박은 후 즉시 비움 — 다음 메시지는 빈 상태에서 시작.
      if (pendingAttachment) {
        pendingAttachment = null;
        pendingAttachmentLabel = "";
        attachPreview.hide();
        syncMediaBtn();
      }
      store.add(msg);
      try {
        await transport.send(msg);
      } catch (e) {
        console.error("send failed:", e);
        // 실패해도 메시지는 그대로 두되, failed 플래그로 시각적 피드백을 준다(사용자가 재전송 결정).
        store.update(msg.id, { failed: true });
        // 비워 둔 입력/첨부를 되돌려 곧바로 다시 보낼 수 있게 한다.
        // 단 그 사이 사용자가 새 입력/첨부를 시작했다면 덮어쓰지 않는다.
        if (prevText && !input.value.trim()) input.value = prevText;
        if (prevAttachment && !pendingAttachment) {
          pendingAttachment = prevAttachment;
          pendingAttachmentLabel = prevLabel;
          attachPreview.show({ filename: prevLabel || "attachment", status: "ready", bytes: prevAttachment.bytes });
          syncMediaBtn();
        }
      }
    }
    sendBtn.addEventListener("click", doSend);
    input.addEventListener("keydown", (e) => {
      playKey(); // 레트로 일관성: 채팅 입력도 키사운드 재생
      // IME composition 중 Enter 는 commit 키 → 무시. Chromium webview(WebView2/Chrome)에서
      // 한글 마지막 글자가 두 번 전송되는 버그 방지. WebKit(Safari/macOS WKWebView)에서는
      // 어차피 composing 중 keydown 이 안 와 변화 없음.
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        doSend();
      }
    });

    transport
      .connect(code, { nickname, clientId })
      .then(() => setTimeout(() => input.focus(), 0))
      .catch((e) => {
        console.error("connect failed:", e);
        // status 구독이 "CHANNEL_ERROR" 등을 받지 못한 경로(예: connect 자체가 reject)
        // 에서도 동일한 에러 상태로 수렴하도록 명시적으로 갱신.
        connState = "error";
        sendBtn.disabled = true;
        renderStatus();
      });

    this._cleanup = () => {
      picker.cleanup();
      if (attachMenu) attachMenu.cleanup();
      if (gifPicker) gifPicker.cleanup();
      lightbox.cleanup();
      unsubStore();
      unsubStatus();
      unsubPres();
      list.removeEventListener("scroll", captureAnchor);
      ro.disconnect();
      window.removeEventListener("resize", restoreScroll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  },

  unmount() {
    // 토큰을 한 번 더 굴려 진행 중이던 mount 가 myToken 비교에서 자동으로 빠지게 한다.
    mountToken++;
    if (this._cleanup) this._cleanup();
    this._cleanup = null;
    if (this._code) closeRoom(this._code);
    this._code = null;
  },
};
