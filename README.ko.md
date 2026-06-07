[English](README.md) | **한국어**

# retro-note

잠깐 떠오른 생각을 빠르게 적기 위한, 아늑한 레트로 CRT 터미널. 항상 떠 있어 언제든 손이 닿습니다.

<!-- 스크린샷이나 짧은 GIF를 여기에 추가하세요. 예: docs/preview.gif -->

## 소개

retro-note는 옛 CRT 컴퓨터 모습을 그대로 옮긴 한 화면짜리 메모 앱입니다. 켜고, 적고, 저장합니다. 폴더도, 마크다운도, 동기화도 없습니다 — 생각이 날아가기 전에 잠깐 부어두는 공간일 뿐입니다.

Tauri 2 기반으로 macOS와 Windows에서 네이티브로 동작합니다.

## 기능

- CRT 형광 초록 + 검정 배경에 기계식 키스트로크 사운드
- 항상 위에 표시 (always-on-top), 투명 배경, 테두리 없는 레트로 본체
- 메모 1건당 파일 1개로 Documents 폴더에 `.txt`로 저장
- 본체 아무 곳이나 드래그해서 창 이동
- 우측 하단 초록 세모 그립 드래그 또는 단축키로 창 크기 조절
- 본체 아트가 깨지지 않도록 종횡비 고정
- 키스트로크 사운드 음소거 토글

## 단축키

| 동작 | macOS | Windows |
|---|---|---|
| 창 키우기 | `⌘ =` | `Ctrl =` |
| 창 줄이기 | `⌘ -` | `Ctrl -` |
| 기본 크기로 리셋 | `⌘ 0` | `Ctrl 0` |
| 핀치 줌 | `⌘` + 스크롤 | `Ctrl` + 스크롤 |

## 메모는 어디에 저장되나요?

다음 위치에 일반 `.txt` 파일로 저장됩니다:

- **macOS**: `~/Documents/retro-notes/`
- **Windows**: `C:\Users\<사용자명>\Documents\retro-notes\`

파일명 형식: `note_YYYY-MM-DD_HH-MM.txt`

## 소스에서 빌드

Node.js, Rust (Cargo 포함), 그리고 OS별 [Tauri 사전 요구사항](https://tauri.app/start/prerequisites/)이 필요합니다.

```bash
npm install
npm run tauri dev      # 개발 모드
npm run tauri build    # 프로덕션 바이너리
```

빌드 산출물은 `src-tauri/target/release/bundle/`에 생성됩니다 — macOS는 `.dmg`, Windows는 `.msi` / `.exe`.

## 기술 스택

- [Tauri 2](https://tauri.app/) — Rust 백엔드, 시스템 WebView 프론트엔드
- Vanilla HTML / CSS / JS — 프론트엔드 빌드 스텝 없음
- 키스트로크 사운드는 Web Audio API

## 라이선스

미정
