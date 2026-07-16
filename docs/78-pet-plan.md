# 픽셀 펫 기능 (issue #78) — 구현 계획

## Context (왜 이걸 만드는가)

issue #78 "펫 기능"은 Codex의 펫을 참고해 "키우기" 요소로 재미를 더하자는 요청입니다. 여기에
사용자의 개인적 바람을 얹습니다: **화면에 상주하는 픽셀 캐릭터**가 **스스로 돌아다니고**,
**새 채팅 메시지가 오면 반응 행동**을 하며, 그 위에 **안 읽음 빨간 점**을 띄우는 것.

Codex 펫을 소스로 검증한 결과: Codex 펫은 **터미널 UI 안**에 그래픽 프로토콜(Kitty/Sixel/iTerm2)로
렌더되는 **인-앱 펫**이며(별도 OS 창 아님), 우하단에 **고정**돼 에이전트 상태에 따라 애니메이션만 바꿉니다.
"돌아다니기"는 우리가 새로 얹는 부분입니다. 사용자 확정 방향은 **바탕화면 전체 배회가 아니라
앱 창 크기 내에서의 작은 움직임** → 별도 창/네이티브 변경 없이 **순수 프론트엔드 오버레이**로 구현합니다.

### 확정된 결정
- **방식**: 앱 창 안 오버레이 (별도 Tauri 창·Rust 변경 없음)
- **배회 공간**: CRT 화면 영역(`--screen-*-pct`) 안, 기본은 아래쪽 "바닥" 밴드를 좌우로 조금씩(튜닝 가능)
- **범위**: MVP (배회 + idle 애니 + 새 메시지 반응 + 빨간 점). 키우기(레벨/기분)·다종 펫·picker는 phase-2
- **아트**: PNG 스프라이트시트 + 이름 있는 애니메이션 세트. Codex의 one-shot→fallback 전이 패턴 차용. **기본 스프라이트시트 PNG는 사용자가 직접 제공**(레포엔 이미지 빌드 파이프라인이 없음). 프레임 규약은 §1 '스프라이트시트 규약' 참조. 렌더는 CSS `background-position` 퍼센트 방식(해상도 독립).
- **메시지 반응/빨간 점 기준**: **실시간(앱 focus 무관) 반응** + 빨간 점 = **'지금 보고 있지 않은 방'의 안 읽은 메시지**. OS 작업표시줄 배지 동작(focus 게이트)은 **그대로 유지** → 펫 전용 신호를 `message-notifier`에 **추가(비파괴)**

---

## 핵심 제약 (코드로 검증됨)

- **빌드 스텝 없음**: 신규 파일은 `src/` 아래 평범한 ES 모듈. `image-rendering: pixelated` + 레트로 팔레트 유지(모던 flat UI 금지).
- **라우터가 화면을 비운다**: `core/router.js`의 `navigate()`가 매 전환마다 `#screen`을 `replaceChildren()`. 따라서 상주 펫은 뷰가 아니라 **`#computer-wrap`의 형제 요소**로 1회 마운트(`.top-controls`/`#screen-mode-btn`와 동일 레이어). `initSound()`/`initScreenMode()`처럼 부트스트랩에서 한 번 초기화.
- **CSS 변수가 좌표계**: `--screen-{top,left,width,height}-pct`로 배치하면 베젤 모드(`body.bezel-mode`가 이 변수들을 재정의)에서 **자동 재배치·재스케일** — 별도 처리 불필요.
- **DI 팩토리 관례**: 순수 로직은 `make*` 팩토리로 분리해 `node --test`로 검증(레포에 DOM 테스트 하니스 없음; `platform/screen-mode.js`, `chat/message-notifier.js` 패턴).
- **새 메시지 신호가 이미 있음**: `chat/message-notifier.js`의 `messageNotifier.subscribe(cb)`(안 읽음 변화 시 발화) + `getUnreadByRoom()`(`Map<code,count>`). `lobby-view.js:81`가 이미 이걸로 초록 점(●)을 그림. 단, 이 카운트는 `handleInsert`의 `!isAppFocused()` 게이트(`message-notifier.js:95`)라 **늘 보이는 펫엔 부적합** → §4에서 focus 무관 펫 전용 신호를 추가한다(기존 배지 경로는 불변).
- **픽셀 절차적 그리기 선례**: `platform/badge.js`가 canvas로 빨간 점(`#e23b3b`)을 그림 → 빨간 점 색 재사용(단 펫 점은 원이 아닌 픽셀 사각 블록).
- **계획 재검증(2026-07-16, 실제 코드 대조 완료)**: 참조 지점 확인 — `main.js:49`(container)/`:52`(initScreenMode), `router.js:17`(replaceChildren), `message-notifier.js:91–99`(focus 게이트)/`:127`(exports), `room-view.js:69`(clearRoom)/`:328`(focus)/`:403`(cleanup), `styles.css:22–25`(screen 변수)·`:1187–1191`(bezel 재정의)·top-controls/screen-mode-btn `z-index:2`·피커 9/10/20/21·`.screen` inset:0, `dom.js`의 `el`이 `text`/`dataset`/`hidden:true` 지원. **사실관계 불일치 없음.**

---

## 1. 모듈 분해 (신규 `src/pet/`)

- **`src/pet/behavior.js` — 순수 로직 (DI 팩토리, 단위 테스트)**
  `makePetBehavior({ rng, floorBand })`. 상태 머신: `idle | walkLeft | walkRight | sleep | react`.
  정규화 위치 `x ∈ [0,1]`, `facing ∈ {left,right}`, 상태별 경과시간 누적. `tick(dtMs)`로 구동(실시간 타이머 X →
  seeded `rng`/고정 `dt`로 결정론적 테스트). `getState() → { state, x, facing }`, `react()`(반응 상태 강제 후 자동 idle 복귀).
  DOM/`Date.now()`/`rAF` 없음.

- **`src/pet/sprite.js` — 스프라이트시트 프레임 데이터 + 드로우 헬퍼 (얇음)**
  상태별 애니메이션 정의(프레임 인덱스 배열 + 프레임 duration + one-shot 여부 + fallback). Codex `Animation { frames, loop_start, fallback }` 모델 차용:
  `idle`(호흡 2프레임 루프), `walk`(2~4프레임 루프), `react`(one-shot → 끝나면 `idle`로 fallback), `sleep`(Zzz 1~2프레임).
  프레임 좌표→스프라이트시트 잘라 그리는 헬퍼. 프레임 정의(순수 데이터)는 가벼운 sanity 테스트 가능하나 렌더는 미테스트.

- **스프라이트시트 규약 (사용자 제공 PNG — `src/assets/pet-sprite.png`)**
  - **레이아웃**: 정사각 프레임을 **가로 1행 8열**(총 8프레임). 프레임 픽셀 크기는 균일하면 자유(권장 32×32 또는 16×16); 실제 값은 `sprite.js` 상단 `FRAME`/`COLS` 상수에 기록해 한 곳에서 관리.
  - **열 순서(0-indexed)**: `0,1`=idle(A,B) · `2,3`=walk(A,B) · `4,5`=react(A,B) · `6,7`=sleep(A,B).
  - **바라보는 방향**: **오른쪽 기준**으로 그림(왼쪽 이동은 CSS `scaleX(-1)`로 뒤집음).
  - **배경**: 투명(RGBA PNG). 팔레트는 CRT 레트로(권장 `--crt-green #00ff41` 계열).
  - 시트 규격이 위와 다르면 **`sprite.js`의 상수만** 고치면 됨(코드 다른 곳 불변). 이름있는 애니→열 매핑도 `sprite.js`가 소유.

- **`src/pet/pet.js` — DOM/렌더/배선 (얇음, 미테스트)**
  `makePet({ container, behavior, sprite, notifier, doc, raf })` + 기본 `initPet(container)`(실제 `messageNotifier`·DOM 배선).
  `message-notifier.js:132`의 `make*` + 기본 export 분리 패턴을 그대로 따름. 소유: 펫 DOM 서브트리 생성·`#computer-wrap`에 append,
  단일 rAF 루프(`dt` 계산 → `behavior.tick` → 렌더), 정규화 `x`/`facing`/`state`→픽셀·프레임·flip 매핑,
  `notifier.subscribe` 배선, 빨간 점 토글, 포커스/가시성 일시정지, `start()`/`stop()`.

- **테스트**: `src/pet/behavior.test.js` — **`package.json`의 `scripts.test` 목록에 추가**해야 CI에서 실행됨(안 하면 조용히 스킵).

분해 근거: `behavior`는 *상태 + 논리 위치*, `pet.js`는 *서브프레임 애니 cadence + px 매핑*. 애니 타이밍을 로직 테스트에서 분리.

---

## 2. 마운트 · 배치 · 클릭 통과

**마운트**: `src/main.js` `DOMContentLoaded`에서 `initScreenMode()` **뒤에** `initPet(container)` 추가
(`container = document.getElementById("computer-wrap")`는 `main.js:49`에 이미 있음). 앱 레벨·인증 무관 → 노트 전용 모드에서도 배회.

**DOM 서브트리** (`core/dom.js`의 `el()`로 생성; `innerHTML` 금지):
```
<div class="pet-layer">          ← CRT 화면 박스를 --screen-*-pct 로 덮음
  <div class="pet">              ← 스프라이트. JS가 transform 으로 이동
    <div class="pet-unread-dot" hidden></div>
  </div>
</div>
```

**배치**: `.pet-layer`는 `#note`/`.menu`와 같은 4개 변수(`position:absolute; top/left/width/height = --screen-*-pct`).
`body.bezel-mode`가 변수 재정의 → 베젤 모드 **자동 적응**(추가 코드 0). 펫은 화면 박스 하단 "바닥" 밴드(예: 하단 ~25%)에 국한해 텍스트 겹침 최소화.
`.pet`은 `transform: translateX(px)`(+ flip 시 `scaleX(-1)`)로 이동, `px = x * (layerWidth − spriteWidth)`로 경계 밖 클리핑 방지.

**클릭 통과(중요)**: `.pet-layer`, `.pet` 모두 `pointer-events: none` → 클릭이 아래 뷰(노트/채팅/버튼)로 통과. 부수효과로
`window-controls.js:151`의 창 드래그 핸들러(`#computer-wrap` mousedown)도 펫이 안 받으므로 드래그도 안 막고 시작도 안 함.
(phase-2에서 펫을 클릭 가능하게 하면 `.pet`만 `pointer-events:auto` + `dataset:{noDrag:""}` — `lobby-view.js:149`와 같은 가드.)

**z-order**: `.pet-layer { z-index: 1 }` — 뷰 콘텐츠(`#screen` ≈ 0)보다 위, 단 `.top-controls`/`.screen-mode-btn`(z-index 2)·모달/피커/라이트박스(9~21)보다 **아래**. 창 버튼·다이얼로그를 절대 안 가림.

---

## 3. 배회 / idle 행동 모델 (`behavior.js`)

- **전이**: `idle → {walk 60% / idle 25% / sleep 15%}`, walk는 지속시간 경과 또는 경계 도달까지, sleep은 길고 드묾(`react()`로 깨어남). 모든 지속시간은 `tick(dtMs)` 누적, 다음 상태는 주입된 `rng` → 결정론적 테스트.
- **facing/flip**: walk 방향으로 `facing` 설정 → 렌더는 CSS `transform: scaleX(-1)`(중앙 origin). `image-rendering: pixelated`와 호환.
- **경계**: `x ∈ [0,1]`만 방출. 0/1 도달 시 clamp + facing 반전(또는 idle 전이). 단위 없음 → 해상도 독립·테스트 용이.
- **루프/프레임 애니(권장)**: `pet.js`에 rAF 1개, **시간 기반 `dt`**(`window-controls.js:134` 선례). 이동은 부드럽게, *스프라이트 프레임*은 저 cadence(~8–10fps)로 교체해 청키한 레트로 느낌. `dt` clamp(≤100ms)로 오래 숨었다 복귀 시 순간이동 방지. `blur`/`visibilitychange`에 명시적 일시정지(`sound.js:92-94` 선례). `{state,frame,x-bucket}` 불변이면 재드로우 생략.
- **기본 상수(모두 튜닝 가능, `behavior.js` 상단 상수)**: walk 0.8–2.5s · idle 1.0–3.0s · sleep 5–12s(드묾) · 프레임 cadence ~8fps · 이동 속도는 정규화 x/s 소폭. react: 이미 `react` 중이면 재트리거 무시(디바운스), `sleep`이면 즉시 깨워 react.

---

## 4. 새 메시지 반응 + 빨간 점 (실시간 + '안 본 방' 기준)

**문제**: 기존 `messageNotifier`는 OS 배지용이라 `!isAppFocused()`일 때만 카운트 → 늘 보이는 펫은
"보고 있을 때 온 메시지"에 반응/점을 못 만듦. 해결: **펫 전용 신호를 `message-notifier`에 비파괴로 추가**하고,
"현재 보고 있는 방"을 기준으로 한다(앱 focus 무관). **기존 배지/로비 경로(focus 게이트)는 전혀 안 건드림.**

### `message-notifier.js` 추가 (모두 additive)
- **상태**: `activeRoom`(현재 보는 방 코드|null), `petUnreadByRoom`(펫 전용 안읽음 Map), `arrivedSubs`(반응 구독자), `petUnreadSubs`(점 구독자).
- **`handleInsert` 확장** — 순서가 핵심:
  ```
  if (row.sender_uid === userId) return;        // 내 메시지 제외 (기존)
  emitArrived(row.room_code);                    // (신규) 펫 반응: focus 무관, 모든 방
  if (row.room_code !== activeRoom)              // (신규) 펫 점: 지금 보는 방이 아니면
    petBump(row.room_code); emitPetUnread();      //         focus 무관하게 안읽음 +1
  if (isAppFocused()) return;                     // ↓ 기존 배지 경로 그대로 (불변)
  bump(row.room_code);
  ```
- **`setActiveRoom(code|null)`** (신규 export): `activeRoom` 설정. code가 방이면 그 방 `petUnreadByRoom` 제거(= 봤음) — **실제로 지워졌을 때만** `emitPetUnread()`(기존 `clearRoom`의 `if(delete) refresh()` 패턴 미러). **펫 안읽음을 지우는 유일한 지점(단일 출처).**
- **`clearRoom(code)`**: 펫 관련 변경 **없음** — 기존대로 `unreadByRoom`(배지)만 건드림. (입장 시 `clearRoom`+`setActiveRoom`이 함께 불려도 펫 맵은 `setActiveRoom`만 만지므로 **중복 통지 없음**.)
- **`clearAll()`/`stop()` 확장**: `petUnreadByRoom`도 비우고 `activeRoom=null`.
- **신규 export**: `onMessageArrived(cb)`(반응, unsub 반환), `petSubscribe(cb)`(점 변경, unsub 반환), `getPetUnreadTotal()`.

### `room-view.js` 배선 (2줄)
- 입장 직후(이미 `clearRoom(code)` 있는 `:69` 부근)에서 `messageNotifier.setActiveRoom(code)` 호출.
- `this._cleanup`(:403)에서 `messageNotifier.setActiveRoom(null)` — 방을 나가면 현재 방 해제.

### `pet.js` 배선
- **반응**: `notifier.onMessageArrived(() => behavior.react())` → 정면 바운스 + "!" 말풍선 애니(one-shot → idle fallback). 연속 도착 디바운스 + sleep 상태면 깨우기. (기본은 **모든 방** 반응 — 읽는 중 소음이면 활성 방 제외로 좁히기 쉬움: 튜닝 포인트.)
- **빨간 점**: `notifier.petSubscribe(() => updateDot())`, `updateDot()`은 `getPetUnreadTotal() > 0`이면 표시. `.pet-unread-dot`을 `.pet`의 자식으로 두어 펫 위에 항상 얹힘(`hidden` 토글). `badge.js:33` 빨강 `#e23b3b` **픽셀 사각 블록**(원 X) + `image-rendering: pixelated`.
- **읽음 처리 자동화**: 방 입장 → `setActiveRoom(code)` → 그 방 petUnread 제거 → `getPetUnreadTotal()` 하락 시 점 자동 숨김. 추가 배선 불필요.

### 시나리오 검산
- 노트 작성 중(앱 활성) 방 X에 메시지 → `activeRoom=null` → petUnread↑ → **점 표시 + 반응**(기존 배지는 focus라 무반응, 의도).
- 방 X 보는 중 방 X 메시지 → `activeRoom=X` → 점 **안** 뜸(이미 봄) + **반응은 함**.
- 방 X 보는 중 방 Y 메시지 → 점 표시(방 Y) + 반응.
- 앱 background에서 메시지 → 펫 루프는 일시정지라 애니는 안 돌지만 점 상태는 세팅 → 복귀 시 점 보임 + OS 배지도 켜짐(기존).

---

## 5. 라이프사이클 / 정리

- `initPet(container)`는 부트스트랩에서 1회, 채팅/노트 전용 **양쪽 모두**. 인증 게이팅 없음: `subscribe`는 `messageNotifier.start(userId)` 전까지 무발화 → 노트 전용에서는 점 영구 숨김·배회만(요청된 fallback).
- `pet.js` 보유: rAF id(`cancelAnimationFrame`), notifier unsub, `blur`/`visibilitychange`/`focus` 리스너. `stop()`이 전부 정리.
- `visibilitychange`(hidden)/`blur`에 루프 일시정지, `focus`/visible에 재개(`sound.js:92-94` 미러) → 최소화 시 CPU ≈ 0.

---

## 6. 수정/신규 파일

**신규**
- `src/pet/behavior.js` (순수 로직)
- `src/pet/sprite.js` (프레임 데이터 + 드로우)
- `src/pet/pet.js` (DOM/배선, `initPet` export)
- `src/pet/behavior.test.js` (단위 테스트)
- `src/assets/pet-sprite.png` — **사용자 제공** 스프라이트시트(규약: §1 '스프라이트시트 규약'). 코드에서 프레임 격자/애니 매핑은 `sprite.js` 상수가 소유

**수정**
- `src/main.js` — `initScreenMode()` 뒤에 `import { initPet }` + `initPet(container)` 호출
- `src/styles.css` — `.pet-layer`/`.pet`/`.pet-unread-dot` 규칙(`--screen-*-pct` 사용, 베젤 자동 적응)
- `src/chat/message-notifier.js` — 펫 전용 신호 **비파괴 추가**(§4): `activeRoom`/`petUnreadByRoom`/`arrivedSubs`/`petUnreadSubs`, `handleInsert` 확장, `setActiveRoom`/`onMessageArrived`/`petSubscribe`/`getPetUnreadTotal` export, `clearRoom`/`clearAll` 확장
- `src/chat/message-notifier.test.js` — 펫 경로 테스트 추가(focus=true에서도 `onMessageArrived` 발화 + petUnread 증가, `activeRoom` 방은 미증가, `setActiveRoom(X)`가 그 방 펫 맵을 지우고 통지, `clearRoom`은 펫 맵 불변). 이 파일은 이미 `scripts.test`에 있음
- `src/views/room-view.js` — 입장 시 `setActiveRoom(code)`(:69 부근), cleanup에서 `setActiveRoom(null)`(:403)
- `package.json` — `scripts.test`에 `src/pet/behavior.test.js` 추가(신규 파일이므로 필수)

**재사용(수정 없음)**: `core/dom.js`(`el`), `platform/badge.js`(빨강 색/개념), `platform/screen-mode.js`(DI 팩토리·베젤 변수 관례), `lobby-view.js`(subscribe/getUnreadByRoom 미러 패턴 참고).

---

## 7. phase-2 (이번엔 제외)
키우기(경험치/레벨/기분, `localStorage["retro-note.pet"]`, 성장 단계별 스프라이트 교체), 펫 여러 종 + 선택 picker,
클릭해서 쓰다듬기/먹이주기, 방 안에서 읽는 중에도 반응(room-view 훅), `prefers-reduced-motion` 대응.

---

## 8. 리스크 / 엣지케이스
- **성능**: rAF는 숨김 시 자동 스로틀 + blur 일시정지 → idle 저비용. `dt` clamp로 복귀 순간이동 방지. 저 fps + 변화 시에만 재드로우.
- **픽셀 스케일링**: 스프라이트를 고정 저해상(예: 32×32 프레임)으로 그리고 CSS가 `image-rendering: pixelated`로 확대 → resize 시 JS 재계산 없이 항상 선명(`computer.png` 방식).
- **가독성**: 펫이 콘텐츠 위 → 작게 + 바닥 밴드 국한 + `pointer-events:none` + (옵션) 약한 반투명.
- **최소 창(400×360)**: 최소 스케일에서 스프라이트 가독성 확인.
- **반응 폭주/수면**: 연속 `react()` 디바운스, 새 메시지에 sleep에서 깨어나기 보장.

---

## 9. 검증 (구현 후)
1. `npm test` — `behavior.test.js`(상태 전이·경계 clamp·react 복귀; seeded `rng`) + `message-notifier.test.js` 확장분(**focus=true에서도** `onMessageArrived` 발화 + petUnread 증가, `activeRoom` 방은 미증가, `setActiveRoom(X)`가 그 방 펫 맵을 지움, `clearRoom`은 펫 맵 불변, 기존 배지 케이스 그대로 통과) 통과.
2. `npm run tauri dev` — 펫이 CRT 화면 바닥 밴드를 좌우로 배회, idle/sleep 전환, 방향 flip 확인.
3. 새 메시지(핵심 시나리오, §4 검산 재현): **앱을 보고 있는 상태**에서 다른 클라이언트가 (a) 내가 안 보는 방으로 전송 → 펫 실시간 반응 + 빨간 점, 그 방 입장 시 점 사라짐 / (b) 내가 지금 보는 방으로 전송 → 반응은 하되 점은 안 뜸.
4. 베젤 모드 토글(`[⛶]`) → 펫이 새 화면 박스로 자동 재배치·재스케일.
5. 노트 전용 모드(config.local 없음) → 펫은 배회, 빨간 점 영구 숨김(에러 없음).
6. 최소화/포커스 아웃 → 루프 일시정지(CPU idle), 복귀 시 순간이동 없이 재개.
7. `npm run test:integration` — 알림 관련 시나리오 회귀 없음 확인(message-notifier 변경이 RLS/Realtime 경로에 영향 없는지; 기존 3개 사전 실패는 origin/main 대비 A/B).
