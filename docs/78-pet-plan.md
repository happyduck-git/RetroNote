# 픽셀 펫 기능 (issue #78) — 구현 계획 (개정판: 별도 창 방식)

> **개정 이력**: 최초 계획은 "앱 창 안 오버레이"(별도 창·Rust 변경 없음)였다. 사용자 요청으로
> **펫만 들어있는 별도 Tauri 창**을 띄우는 방식으로 전면 개정했다. 순수 로직(`behavior.js`)과
> 새 메시지 신호(`message-notifier` §4 비파괴 추가)는 그대로 재사용하고, 마운트/좌표계/배선을 새로 쓴다.

## Context (왜 이걸 만드는가)

issue #78 "펫 기능"은 Codex의 펫을 참고해 "키우기" 요소로 재미를 더하자는 요청이다. 여기에
사용자 바람을 얹는다: **화면에 상주하는 픽셀 캐릭터**(고양이)가 **스스로 움직이고**, **새 채팅
메시지가 오면 반응 행동**을 하며, 그 위에 **안 읽음 빨간 점**을 띄운다.

사용자 확정 방향은 **"펫만 들어있는 작은 별도 창"**이다. 바탕화면 전체를 헤매는 데스크톱 펫이
아니라, 유저가 원하는 위치로 끌어다 둘 수 있는 독립 창 하나이고, 펫은 그 창 안에서 조금 움직이거나
제자리에서 idle 애니(하품/기지개/잠 등)를 한다.

### 확정된 결정 (이번 대화에서 합의)

- **방식**: 펫 전용 **별도 Tauri 창**(`label:"pet"`). 별도 HTML 진입점(`src/pet.html`). 메인 창과 독립.
- **창 속성**: 투명 · 테두리 없음(`decorations:false`) · **항상 위 아님**(다른 창 뒤로 갈 수 있음) ·
  **리사이즈 가능(범위 제한)** · 작업표시줄 숨김(`skipTaskbar`) · Windows 그림자 끔.
  MVP 크기 대략값(차차 조정): 기본 **200×180**, 최소 **140×130**, 최대 **400×360**.
- **이동/독립성**: 유저가 **좌클릭 드래그로 창 위치 이동**(= 독립적). 펫은 창 안에서 정규화 x 로 조금 배회.
  창이 좁아 배회가 어색하면 제자리 + idle 애니로 폴백(사용자 승인된 폴백).
- **제거/복귀**: 펫 창 **우클릭 = 제거(숨김)**. 메인 창 상단 컨트롤에 **펫 켜기/끄기 토글 버튼** 추가로 복귀.
  숨김/표시 상태는 `localStorage`에 기억.
- **클릭**: 펫 창은 클릭을 받는다(클릭 통과 아님). 좌클릭 = 창 잡기(드래그). 쓰다듬기 등 상호작용은 phase-2.
- **범위**: MVP (배회 + idle/sleep 애니 + 새 메시지 반응 + 빨간 점 + 토글/제거). 키우기·다종 펫·picker는 phase-2.
- **아트**: ToffeeCraft **Cat Pack – Pochi**(유료, 상업 이용 가능). `Pochi/Sprites/`의 **애니메이션별
  64×64 개별 스트립**을 그대로 사용(§'스프라이트' 참조). 이미지 가공/빌드 파이프라인 없음.
- **빨간 점 기준**: **안 읽은 메시지 있음(§4 pet-unread > 0) AND 메인 창이 포커스(맨 앞)가 아님**.
  메인을 맨 앞으로 올려 그 방을 열면 사라짐. (창 쌓임 순서 z-order 직접 감지는 크로스플랫폼 API가
  없어, `document.hasFocus()` + 포커스 이벤트로 "메인이 맨 앞이냐"를 판단 — 사용자가 말한 세 조건
  "메인 최소화 / 메인이 펫 뒤 / 둘 다 다른 앱 뒤"를 모두 자연스럽게 덮는다.)

---

## 핵심 제약 (실제 코드로 대조, 2026-07-16)

- **빌드 스텝 없음**: 신규 파일은 `src/` 아래 평범한 ES 모듈. `frontendDist:"../src"`이므로 `src/pet.html`은
  두 번째 창의 URL(`"pet.html"`)로 그대로 서빙된다. 스프라이트도 개별 PNG를 파일 그대로 참조(가공 X).
- **두 번째 창 = 별개 JS 컨텍스트**: 펫 창은 메인 창과 **다른 WebView**라 메인의 모듈 상태
  (`messageNotifier` 등)를 직접 못 부른다 → **Tauri 이벤트(`emitTo`/`listen`) 다리**가 필요(§4·§'브리지').
- **capabilities는 창 label 로 스코프**: 현재 `capabilities/default.json`이 `"windows": ["main"]`.
  펫 창용 권한을 새 capability 파일(`capabilities/pet.json`, `"windows":["pet"]`)로 추가해야 한다
  (창 드래그·hide/show·이벤트 listen 등). 정확한 permission 식별자는 구현 중 런타임 거부로 확정한다.
- **새 메시지 신호가 이미 있음**: `chat/message-notifier.js`. 단 `handleInsert`는 `!isAppFocused()`
  게이트(`:95`)라 늘 보이는 펫엔 부적합 → §4에서 focus 무관 펫 전용 신호를 **비파괴 추가**한다.
- **`isAppFocused()` = `document.hasFocus()`** (`platform/badge.js:21`). 이 값을 메인이 펫 창에 이벤트로
  중계해 빨간 점 게이팅에 쓴다.
- **상단 버튼은 정적 HTML**: `src/index.html`의 `.top-controls`에 `[≡]home / [♪]mute / [_]minimize /
  [X]close` + 좌상단 `[⛶]screen-mode`. 펫 토글은 여기 **버튼 하나** 추가(CSS는 `.top-controls .btn` 상속,
  `styles.css:184` 부근).
- **라우터가 화면을 비운다**: `core/router.js`가 매 전환마다 `#screen`을 교체 → 펫은 **메인 창의 뷰가 아니라
  아예 다른 창**이므로 라우터와 무관(원래 오버레이 방식의 마운트 고민이 사라짐).
- **참조 지점(대조 완료)**: `main.js:48`(DOMContentLoaded)/`:49`(container)/`:52`(initScreenMode)/`:93,111`
  (`messageNotifier.start`), `message-notifier.js:91–103`(handleInsert)/`:127`(exports)/`:132`(기본 인스턴스),
  `room-view.js:38`(code)/`:69`(clearRoom, 입장)/`:328`(창 포커스 시 clearRoom)/`:403`(_cleanup)/`:420`(unmount),
  `index.html:47–54`(top-controls/버튼), `styles.css:175`(.top-controls)/`:184`(.top-controls .btn 공용),
  `.gitignore`(`src/config.local.js` 선례), `capabilities/default.json`(`"windows":["main"]`),
  `src-tauri/src/lib.rs:14–20`(Windows `set_shadow(false)` 선례), `tauri.conf.json:12–25`(main 창 정의).

---

## 1. 모듈 분해 (신규 `src/pet/` + `src/pet.html`)

- **`src/pet/behavior.js` — 순수 로직 (DI 팩토리, 단위 테스트)** — *최초 계획 그대로 재사용*
  `makePetBehavior({ rng, ... })`. 상태 머신: `idle | walkLeft | walkRight | sleep | react`.
  정규화 위치 `x ∈ [0,1]`, `facing ∈ {left,right}`, 상태별 경과시간 누적. `tick(dtMs)`로 구동(실시간 타이머 X →
  seeded `rng`/고정 `dt`로 결정론적 테스트). `getState() → { state, x, facing }`, `react()`(반응 강제 후 idle 복귀).
  DOM/`Date.now()`/`rAF` 없음. **창이 어디든 무관**(정규화 좌표라 창 몸통에 그대로 매핑).

- **`src/pet/sprite.js` — 애니메이션 → 스트립 매핑 + 드로우 헬퍼 (얇음)**
  Pochi 스트립을 **파일별**로 매핑(§'스프라이트'). 상태별: 프레임 수 · 프레임 duration · one-shot 여부 · fallback.
  예: `idle:{img:"Idle.png", frames:6, fps:6}`, `walk:{img:"Running.png", frames:6, fps:8}`,
  `sleep:{img:"Sleeping.png", frames:4}`, `react:{img:"Surprised.png", frames:4, oneShot:true, fallback:"idle"}`.
  프레임 크기·격자는 상단 상수(`FRAME=64`)로 한 곳에서 관리. 프레임 정의(순수 데이터)는 가벼운 sanity 테스트 가능.

- **`src/pet/pet-window.js` — 펫 창 부트스트랩 + 렌더/배선 (얇음, 미테스트)**
  펫 창의 `pet.html`이 로드하는 진입 모듈. 소유:
  - 펫 DOM 서브트리 생성(`core/dom.js`의 `el`; `innerHTML` 금지), 단일 rAF 루프
    (`dt` 계산 → `behavior.tick` → 렌더), 정규화 `x`/`facing`/`state` → px·프레임·flip 매핑
  - **좌클릭 드래그**로 창 이동(`getCurrentWindow().startDragging()`; `window-controls.js:152` 선례)
  - **우클릭(contextmenu)** → `preventDefault` 후 창 `hide()` + 메인에 `pet:dismissed` 이벤트
  - 브리지 이벤트 `listen`(§'브리지'): `pet:message-arrived → behavior.react()`,
    `pet:unread → updateDot()`, `pet:main-focus → updateDot()`
  - 빨간 점 토글, 자기 창 `visibilitychange`/`blur`에 루프 일시정지, `start()`/`stop()`

- **`src/pet/bridge.js`(또는 main.js에 인라인) — 메인 → 펫 이벤트 중계 (얇음)**
  메인 창에서 `messageNotifier.onMessageArrived`/`petSubscribe` + 메인 창 포커스 변화를 구독해
  `emitTo("pet", ...)`로 펫 창에 전달. 펫 창 표시/숨김/토글도 여기서 관리(`localStorage` 상태 + 버튼).

- **테스트**: `src/pet/behavior.test.js` — **`package.json`의 `scripts.test` 목록에 추가**해야 CI에서 실행됨.

분해 근거: `behavior`는 *상태 + 논리 위치*(테스트), `sprite`는 *애니 데이터*, `pet-window`는 *렌더 cadence
+ 창 배선*(미테스트), `bridge`는 *창 간 신호 중계*. 애니 타이밍/창 API를 로직 테스트에서 분리.

---

## 2. 별도 창 생성 · capabilities · Rust

### 창 선언 (`src-tauri/tauri.conf.json`)
`app.windows[]`에 두 번째 창 추가(정적 선언, 앱 시작 시 생성):
```jsonc
{
  "label": "pet",
  "url": "pet.html",
  "width": 200, "height": 180,
  "minWidth": 140, "minHeight": 130,
  "maxWidth": 400, "maxHeight": 360,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": false,        // 요청: 다른 창 뒤로 갈 수 있어야 함
  "resizable": true,           // 범위 제한 리사이즈
  "skipTaskbar": true,
  "visible": false             // 시작 시 숨김 → 메인이 localStorage 선호에 따라 show
}
```
초기 위치를 메인 창 근처로 두려면 메인이 `setPosition`으로 배치(선택; 안 하면 OS 기본 위치). 표시 여부는
메인의 `localStorage` 선호로 결정(마지막에 제거해 뒀으면 계속 숨김).

### capabilities (`src-tauri/capabilities/pet.json`, 신규)
`"windows": ["pet"]` 스코프로 펫 창이 부를 API만 허용(대략):
- `core:window:allow-start-dragging` (드래그 이동)
- `core:window:allow-hide` (우클릭 제거) — 메인이 show/hide 하려면 메인 capability에도 `allow-show`/`allow-hide` 추가
- `core:event:allow-listen`, `core:event:allow-emit` (브리지)
- (선택) 초기 배치용 위치/모니터 권한

> **정확한 permission 식별자는 구현 중 런타임 거부 메시지로 확정한다** — 이 앱은 빌드 검증이 없어
> `tauri.conf`/capabilities 오타가 조용히 런타임에서만 터지므로, `npm run tauri dev`로 각 API를 실제 호출해 확인.

### Rust (`src-tauri/src/lib.rs`)
`setup`에서 **펫 창에도** Windows 그림자 끄기(기존 main 처리와 동일 패턴, `:14–20`):
```rust
#[cfg(windows)]
if let Some(pet) = _app.get_webview_window("pet") { let _ = pet.set_shadow(false); }
```
그 외 Rust 변경 없음(창 생성은 tauri.conf 정적 선언이 담당).

---

## 3. 스프라이트 (ToffeeCraft Cat Pack – Pochi)

- **출처/라이선스**: `toffeecraft.itch.io/cat-retro`(유료). 라이선스 요지 —
  *"For commercial or personal use" · "can be used and edit freely" · **"Not redistribute or resell this assets"**
  · "can be used for game development and other productions"* (크레딧 의무 아님).
  → 앱에 넣어 배포(릴리스 바이너리)는 OK. **원본 PNG를 공개 레포에 그대로 커밋하는 건 재배포로 해석될 위험**.
- **레포 취급 (공개 레포이므로)**:
  - `src/assets/pet/*.png` 는 **`.gitignore`에 추가**(레포에 안 올림).
  - `src/assets/pet/README.md`(배치 안내: "ToffeeCraft Cat Pochi 유료 에셋. `Pochi/Sprites/`의 스트립을
    여기에 복사")만 커밋.
  - 로컬 개발: 필요한 스트립을 직접 복사. 릴리스 CI: 비공개 위치에서 빌드 전 주입(`config.local.js` CI 주입 선례).
- **에셋 규격 (확인됨)**: `Pochi/Sprites/` = 애니메이션별 가로 스트립, **전부 높이 64px = 프레임 64×64 정사각**.
  파일 폭 ÷ 64 = 프레임 수. MVP 매핑:

  | 우리 상태 | 파일 | 프레임 |
  |---|---|---|
  | idle (기본) | `Idle.png` | 6 |
  | walk (느리게 재생) | `Running.png` | 6 |
  | sleep (Zzz) | `Sleeping.png` | 4 |
  | react (새 메시지 놀람, one-shot→idle) | `Surprised.png` | 4 |
  | *(여유 시 idle 변주)* | `Chilling.png`(8) · `Happy.png`(10) · `Box1.png`(12) | — |

- **방향**: 스트립은 한 방향 기준 → 반대 이동은 CSS `transform: scaleX(-1)`로 뒤집음.
- **렌더**: `image-rendering`을 **pixelated / 부드럽게(auto)** 둘 다 시험해 고른다(이 고양이는 소프트한 톤이라
  pixelated가 거칠어 보일 수 있음). CRT 초록 팔레트와 색이 다른 점은 취향 — 필요 시 CSS 톤 보정(선택).
- **애니 구동**: 상태별 스트립을 `background-image`로 걸고 `background-position-x`를 프레임 단위로 스텝
  (전부 64px 폭이라 균일). 상태 전환 시 이미지 교체.

---

## 4. 새 메시지 반응 + 빨간 점 (`message-notifier` §4 추가 + 브리지)

**문제**: 기존 `messageNotifier`는 OS 배지용이라 `!isAppFocused()`일 때만 카운트(`:95`). 늘 보이는 펫엔 부적합.
**해결**: 펫 전용 신호를 `message-notifier`에 **비파괴 추가**하고, "현재 보는 방"을 기준으로 한다(앱 focus 무관).
**기존 배지/로비 경로(focus 게이트)는 전혀 안 건드림.** 그리고 그 신호를 브리지가 펫 창에 중계한다.

### `message-notifier.js` 추가 (모두 additive)
- **상태**: `activeRoom`(현재 보는 방 코드|null), `petUnreadByRoom`(펫 전용 안읽음 Map),
  `arrivedSubs`(반응 구독자), `petUnreadSubs`(점 구독자).
- **`handleInsert` 확장** — 순서가 핵심(기존 라인은 그대로 두고 위에 신규 추가):
  ```
  if (!row) return;                              // 기존
  if (row.sender_uid === userId) return;         // 내 메시지 제외 (기존)
  emitArrived(row.room_code);                    // (신규) 펫 반응: focus 무관, 모든 방
  if (row.room_code !== activeRoom) {            // (신규) 펫 점: 지금 보는 방이 아니면
    petBump(row.room_code); emitPetUnread();     //         focus 무관하게 안읽음 +1
  }
  if (isAppFocused()) return;                     // ↓ 기존 배지 경로 그대로 (불변)
  bump(row.room_code);
  ```
- **`setActiveRoom(code|null)`** (신규 export): `activeRoom` 설정. code가 방이면 그 방 `petUnreadByRoom`
  제거(= 봤음) — **실제로 지워졌을 때만** `emitPetUnread()`(기존 `clearRoom`의 `if(delete) refresh()` 미러).
  **펫 안읽음을 지우는 유일한 지점(단일 출처).**
- **`clearRoom(code)`**: 펫 관련 변경 **없음** — 기존대로 `unreadByRoom`(배지)만. (입장 시 `clearRoom`+
  `setActiveRoom`이 함께 불려도 펫 맵은 `setActiveRoom`만 만지므로 **중복 통지 없음**.)
- **`clearAll()`/`stop()` 확장**: `petUnreadByRoom`도 비우고 `activeRoom=null`.
- **신규 export**: `onMessageArrived(cb)`(반응, unsub 반환), `petSubscribe(cb)`(점 변경, unsub 반환),
  `getPetUnreadTotal()`, `setActiveRoom(code)`.

### `room-view.js` 배선 (2줄)
- 입장 직후(`:69` `clearRoom(code)` 부근)에서 `messageNotifier.setActiveRoom(code)` 호출.
- `this._cleanup`(`:403`)에서 `messageNotifier.setActiveRoom(null)` — 방 나가면 현재 방 해제.

### 브리지 (메인 창 → 펫 창)
- 메인에서 `onMessageArrived(code => emitTo("pet","pet:message-arrived",{code}))`,
  `petSubscribe(() => emitTo("pet","pet:unread",{ total: getPetUnreadTotal() }))`.
- 메인 창 **포커스 변화**를 `getCurrentWindow().onFocusChanged` (또는 DOM `focus`/`blur`)로 잡아
  `emitTo("pet","pet:main-focus",{ focused })`. 초기값은 `document.hasFocus()`.

### `pet-window.js` 소비
- **반응**: `listen("pet:message-arrived", () => behavior.react())` → 놀람(Surprised) one-shot → idle 복귀.
  연속 도착 디바운스 + sleep이면 깨우기. (기본은 **모든 방** 반응 — 읽는 중 소음이면 활성 방 제외로 좁히기 쉬움: 튜닝.)
- **빨간 점**: 상태 두 개 보관 — `petUnreadTotal`(from `pet:unread`), `mainFocused`(from `pet:main-focus`).
  `updateDot()` → 점 표시 = **`petUnreadTotal > 0 && !mainFocused`**. 색은 `#e23b3b`(badge.js와 통일),
  픽셀 사각 블록. `.pet` 위에 얹힘(`hidden` 토글).
- **읽음 처리 자동화**: 방 입장 → `setActiveRoom(code)` → petUnread 하락 → `pet:unread` 통지 → 점 갱신.

### 시나리오 검산
- 메인 최소화 상태에서 방 X 메시지 → petUnread↑ + `mainFocused=false` → **점 표시 + 반응**. (기존 OS 배지도 켜짐.)
- 메인 포커스(맨 앞)로 보는 중, 안 보는 방 Y 메시지 → petUnread↑지만 `mainFocused=true` → **점 숨김**(요청대로),
  반응은 함. 다른 앱으로 넘어가면(포커스 잃음) 점 표시.
- 방 X 보는 중 방 X 메시지 → `activeRoom=X` → petUnread 미증가(점 없음) + 반응.
- 펫 창을 클릭(펫 포커스)해 메인이 뒤로 → `mainFocused=false` → 점 표시(= "메인이 펫 뒤" 조건).

---

## 5. 토글 버튼 · 우클릭 제거 · 라이프사이클

- **토글 버튼**: `src/index.html` `.top-controls`에 버튼 하나 추가
  (예 `<button class="btn pet-btn" id="pet-btn" title="Pet">[^ω^]</button>` — 정확한 글리프는 레트로 톤에
  맞춰 확정, 이모지보다 ASCII 권장). 클릭 → 펫 창 `show()`/`hide()` 토글 + `localStorage` 선호 갱신 + 버튼 상태 반영.
- **우클릭 제거**: 펫 창에서 `contextmenu` → `hide()` + 메인에 `pet:dismissed` → 메인이 `localStorage` 선호를
  "숨김"으로 갱신 + 토글 버튼 상태 반영. (완전 close 대신 hide → 위치/상태 유지, 복귀가 가벼움.)
- **인증 무관**: 펫 창은 노트 전용 모드에서도 뜬다. `messageNotifier.start(userId)` 전(로그인 전/노트 전용)엔
  펫 신호가 안 오므로 **점은 영구 숨김·배회만**(요청된 fallback). 브리지는 무발화라 에러 없음.
- **정리**: 펫 창 rAF/`listen` unsub/`blur`·`visibilitychange` 리스너는 `stop()`이 정리. 앱 종료 시 창도 닫힘.
- **성능**: 펫 창은 항상 보이지만 작고 저 fps + 변화 시에만 재드로우. 자기 창 숨김/blur 시 rAF 일시정지
  (단, `pet:unread`/`pet:main-focus`는 계속 받아 점 상태는 유지). `dt` clamp(≤100ms)로 복귀 순간이동 방지.

---

## 6. 수정/신규 파일

**신규**
- `src/pet.html` — 펫 창 진입 문서(투명 배경, `pet-window.js` 로드)
- `src/pet/behavior.js` (순수 로직, 최초 계획 재사용)
- `src/pet/sprite.js` (Pochi 스트립 매핑 + 드로우)
- `src/pet/pet-window.js` (펫 창 부트스트랩/렌더/드래그/우클릭/점)
- `src/pet/bridge.js` (또는 main.js 인라인 — 메인→펫 이벤트 중계 + 토글/표시 관리)
- `src/pet/behavior.test.js` (단위 테스트)
- `src/assets/pet/README.md` (스프라이트 배치 안내) + `src/assets/pet/*.png` (**gitignore**, 로컬 배치)
- `src-tauri/capabilities/pet.json` (펫 창 권한)

**수정**
- `src-tauri/tauri.conf.json` — `app.windows[]`에 `pet` 창 추가(§2)
- `src-tauri/capabilities/default.json` — 메인이 펫 창 show/hide 하도록 `allow-show`/`allow-hide` 추가(필요 시)
- `src-tauri/src/lib.rs` — 펫 창 Windows 그림자 끄기(§2)
- `src/index.html` — `.top-controls`에 펫 토글 버튼 추가
- `src/main.js` — 브리지 배선(`messageNotifier` 펫 신호 → `emitTo`) + 펫 토글 버튼 핸들러 + 메인 포커스 중계
- `src/chat/message-notifier.js` — 펫 전용 신호 **비파괴 추가**(§4)
- `src/chat/message-notifier.test.js` — 펫 경로 테스트 추가(이미 `scripts.test`에 있음)
- `src/views/room-view.js` — 입장 시 `setActiveRoom(code)`(`:69` 부근), cleanup에서 `setActiveRoom(null)`(`:403`)
- `src/styles.css` — 펫 토글 버튼 스타일(대부분 `.top-controls .btn` 상속, 필요 시 소량)
- `package.json` — `scripts.test`에 `src/pet/behavior.test.js` 추가(신규 파일이라 필수)
- `.gitignore` — `src/assets/pet/*.png` 추가

**재사용(수정 없음)**: `core/dom.js`(`el`), `platform/badge.js`(빨강 색/개념), `window-controls.js`
(startDragging 선례), `lobby-view.js`(subscribe/getUnreadByRoom 미러 패턴 참고).

---

## 7. phase-2 (이번엔 제외)
키우기(경험치/레벨/기분, `localStorage`, 성장 단계별 스프라이트 교체), 펫 여러 종/색 + 선택 picker,
클릭해서 쓰다듬기/먹이주기(펫 창 클릭 상호작용), 초기 위치를 메인 창에 상대 배치, `prefers-reduced-motion` 대응,
펫 창 상태(위치/크기) 영속화.

---

## 8. 리스크 / 엣지케이스
- **capabilities/tauri.conf 오타**: 빌드 검증이 없어 런타임에서만 터짐 → 각 창 API를 `tauri dev`로 실제 호출해 확인.
- **투명·비-always-on-top 창의 플랫폼 차이**: macOS/Windows 렌더·포커스 동작 차이(멀티 모니터 포함) 실기 확인.
- **z-order 감지 한계**: "펫이 특정 창 앞/뒤"는 직접 못 잼 → "메인 포커스 여부"로 근사(§4). 실사용 느낌 확인.
- **라이선스**: 원본 PNG 레포 커밋 금지(gitignore). 릴리스 주입 경로 확인.
- **픽셀/소프트 스케일링**: 64×64 스트립을 리사이즈되는 창에서 확대 → pixelated vs auto 중 나은 쪽 선택.
- **반응 폭주/수면**: 연속 `react()` 디바운스, 새 메시지에 sleep에서 깨어나기 보장.
- **점 깜빡임**: 메인 포커스 토글이 잦으면 점이 자주 깜빡일 수 있음 → 필요 시 짧은 디바운스(튜닝 포인트).

---

## 9. 검증 (구현 후)
1. `npm test` — `behavior.test.js`(상태 전이·경계 clamp·react 복귀; seeded `rng`) + `message-notifier.test.js`
   확장분(**focus=true에서도** `onMessageArrived` 발화 + petUnread 증가, `activeRoom` 방은 미증가,
   `setActiveRoom(X)`가 그 방 펫 맵을 지움, `clearRoom`은 펫 맵 불변, 기존 배지 케이스 그대로 통과) 통과.
2. `npm run tauri dev` — 펫 창이 뜨고, 창 안에서 배회/idle/sleep + 방향 flip, **좌클릭 드래그로 창 이동**,
   **우클릭 제거**, **상단 토글로 복귀**, **리사이즈** 동작 확인.
3. 새 메시지(핵심 시나리오, §4 검산 재현): (a) **메인이 포커스 아님**(최소화/뒤/다른 앱)에서 안 보는 방 메시지
   → 펫 반응 + 빨간 점, 그 방 입장 시 점 사라짐 / (b) **메인 포커스 중** 안 보는 방 메시지 → 반응은 하되 점은 안 뜸
   / (c) 지금 보는 방 메시지 → 반응만, 점 없음.
4. 노트 전용 모드(config.local 없음) → 펫은 배회, 빨간 점 영구 숨김(에러 없음).
5. 최소화/포커스 아웃 → 펫 루프 일시정지(CPU idle), 복귀 시 순간이동 없이 재개. 점 상태는 유지.
6. `npm run test:integration` — 알림 관련 시나리오 회귀 없음(§4 변경이 RLS/Realtime 경로에 영향 없는지;
   기존 사전 실패는 origin/main 대비 A/B).
7. (릴리스 전) 스프라이트 gitignore 확인 + 빌드 시 주입 경로 점검.
