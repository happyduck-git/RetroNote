# 펫 알림 배지 — 빨간 원 → 발바닥 모양 교체

## 배경 / 문제

펫 창(`src/pet.html`)에는 안 읽은 메시지가 있고 메인 창이 포커스되지 않았을 때 뜨는 알림 배지가 있다.
지금은 순수 CSS로 그린 빨간 원(`background:#e23b3b; border-radius:50%`)이다. 이 모양을
CatMegaBundle(유료 에셋, ToffeeCraft Cat Pochi)의 UI 스프라이트 시트 `CatUI.png`에 있는
발바닥(paw) 아이콘 모양으로 바꾼다.

## 범위

- 배지의 **모양만** 바꾼다. 표시/숨김 로직(`unread > 0 && !mainFocused`), 통통 튀는 애니메이션,
  배지가 뜨는 위치(펫 머리 위)는 그대로 유지한다.
- 배지 색은 CatUI.png 원본의 캐러멜색(연갈색, 4개 발바닥 아이콘 중 1번)을 그대로 쓴다. 고양이
  선택 색상에 따라 바뀌지 않는 고정 단일 이미지다.

## 원본 에셋 좌표 (확정됨)

`~/Downloads/CatMegaBundle/CatUserInterface/CatUI.png` (512×944px)에서 알파 채널 스캔으로 확인:

- 발바닥 4개가 한 행에 있음, 모두 같은 모양·크기(35×30px), 색만 다름.
- 이번에 쓸 것은 1번(왼쪽 첫 번째, 균일한 캐러멜 톤): 절대 좌표 `(327, 153) - (362, 183)`.

## 컴포넌트별 변경

### 1. 로컬 에셋 생성 스크립트 — `scripts/slice-pet-badge.mjs` (신규)

기존 `scripts/slice-pet-sprites.mjs`와 같은 관례를 따른다:

- `pngjs`로 PNG 읽기/쓰기 (이미 `package.json`의 devDependency).
- 원본 경로는 `--src` 인자 또는 `PET_BADGE_SRC` 환경변수로 override 가능, 기본값
  `~/Downloads/CatMegaBundle/CatUserInterface/CatUI.png`.
- 원본 치수(512×944)를 검증하고 다르면 `fail()`로 즉시 종료 (기존 스크립트의 `fail()` 패턴과 동일).
- 고정 좌표 `(327,153)-(362,183)`를 잘라 `src/assets/pet/badge-paw.png`로 저장.
- 잘라낸 결과가 완전 투명이면(좌표 오류 의심) 실패 처리 — 기존 `isBlank()` 검증과 동일한 안전장치.
- `package.json`에 `"slice:pet-badge": "node scripts/slice-pet-badge.mjs"` 스크립트 추가.

**`.gitignore` 변경 불필요** — 기존 규칙 `src/assets/pet/**/*.png`가 이 파일(하위 디렉토리 없이
`pet/` 바로 아래)도 이미 커버한다.

### 2. CSS — `src/pet.html`

`.pet-dot` 규칙에서:

- `background: #e23b3b;` / `border-radius: 50%;` 제거.
- `background: url("assets/pet/badge-paw.png") no-repeat center / contain;` 추가.
- `image-rendering: pixelated;` 추가 (`.pet` 규칙에서 이미 쓰는 것과 동일한 픽셀아트 처리).
- `aspect-ratio: 1 / 1` → `35 / 30`으로 변경 (발바닥 원본 비율에 맞춤; 실제 앱 실행 후 육안으로
  크기/위치가 어색하면 `width`/`top`/`left` 값을 미세 조정할 수 있음 — 이건 구현 중 실기기 확인 후
  판단).
- 위 규칙 바로 위 Korean 주석("안 읽음 빨간 점 — … 동그란 점 …")을 실제 모양(발바닥)에 맞게 수정.
- `pet-dot-bounce` 애니메이션과 `.pet-dot[hidden]` 규칙은 변경 없음.

`pet-window.js`는 변경 없음 — 배지는 항상 같은 정적 이미지 하나만 쓰므로(장난감처럼 매번 다른
배경이미지를 JS로 지정할 필요가 없음), CSS만으로 충분하다.

### 3. 릴리스 CI — `.github/workflows/release.yml`

기존 "Copy pet sprites into place" 스텝 근처(또는 별도 스텝)에서 `.pet-assets/badge-paw.png`를
`src/assets/pet/badge-paw.png`로 복사하고, 기존 toys 체크와 같은 패턴으로 파일이 없으면
`::error::` 를 찍고 빌드를 실패시키는 가드를 추가한다.

### 4. Private 에셋 저장소 (`retro-note-assets`, 로컬 클론: `/Users/happyduck/Documents/tmp/retro-note-assets`)

동일한 35×30 `badge-paw.png`를 만들어 이 로컬 클론 루트에 추가한다 (색상별 폴더/`toys/`와 같은
레벨). **이 저장소에 대한 커밋/푸시는 파일을 추가한 뒤 별도로 사용자에게 확인받고 진행한다** —
원격 공유 저장소에 영향을 주는 작업이기 때문.

## 에러 처리

기존 파이프라인과 동일한 "실패는 조용히 넘어가지 않는다" 원칙을 따른다:

- 슬라이스 스크립트: 원본 파일 없음/치수 다름/잘라낸 결과가 투명함 → 즉시 실패, 에러 메시지 출력.
- 릴리스 CI: 주입된 파일이 없으면 빌드 실패 (기존 toys 가드와 동일 패턴).

## 테스트 / 검증

`.pet-dot` 스타일을 다루는 자동화 테스트는 없음(확인됨 — `*.test.js` 어디에도 `pet-dot` 참조
없음). 이번 변경도 시각적 스타일 변경이라 자동 테스트 대상이 아니다. 검증은:

1. `npm run slice:pet-badge` 실행 → `src/assets/pet/badge-paw.png` 생성 확인.
2. `npm run tauri dev`로 앱 실행, 안 읽은 메시지가 있고 메인 창이 비포커스인 상태를 만들어 배지가
   발바닥 모양으로 뜨는지, 통통 튀는 애니메이션이 자연스러운지 육안 확인.

## 스코프 밖

- 고양이 색상별로 배지 색을 다르게 하는 것 (이번엔 고정 단일 색).
- 배지 이미지에 CSS로 색을 다시 입히는 것(mask 기법) — 원본 색 그대로 사용하기로 결정됨.
- CatUI.png의 다른 UI 요소(버튼, 스위치 등)에 대한 슬라이싱 인프라 구축 — 이번 작업 범위 아님.
