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
- **휘발성 채팅** — 코드로 방에 입장해 실시간 대화, 메시지는 1시간 후 사라짐 (선택 기능, 무료 Supabase 프로젝트 필요)

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

## 채팅 (휘발성)

앱을 켜면 화면에 **[ NOTE ]** 와 **[ CHAT ]** 가 뜹니다. CHAT을 고르면:

1. 닉네임을 한 번 설정합니다 (로컬 저장, 처음에만 물어봄).
2. **방 생성**으로 6자리 코드를 발급받거나, 공유받은 코드를 **입력해 입장**합니다.
3. 실시간으로 대화합니다. 메시지는 **1시간 후 사라지며**, 나중에 들어온 사람은 **입장 이후 메시지만** 봅니다 — 이전 기록은 없습니다.

채팅은 순수 broadcast 방식이라 서버에 아무것도 저장되지 않습니다. 방 코드가 유일한 접근 수단이므로 민감한 정보는 주고받지 마세요.

### 채팅 설정 (Supabase)

채팅에는 실시간 백엔드가 필요합니다. [Supabase](https://supabase.com) **무료 플랜**으로 충분합니다:

1. 무료 Supabase 프로젝트를 생성합니다.
2. **Project Settings → API** 에서 **Project URL** 과 **anon public** 키를 복사합니다.
3. 템플릿을 복사해 값을 채웁니다 (`config.local.js` 는 gitignore 되어 키가 저장소에 안 올라갑니다):
   ```bash
   cp src/config.local.example.js src/config.local.js
   ```
   ```js
   // src/config.local.js
   export const SUPABASE = {
     url: "https://YOUR-PROJECT.supabase.co", // 경로(/rest/v1) 없이 베이스 주소만
     anonKey: "YOUR-ANON-PUBLIC-KEY",
   };
   ```
   `src/config.js` 가 실행 시 이 키를 불러옵니다. `config.local.js` 가 없어도 앱은 정상 실행되며 채팅만 비활성화됩니다.
4. 다시 빌드/실행합니다. 두 값이 비어 있으면 **[ CHAT ]** 버튼이 비활성화되고 노트 기능만 동작합니다.

참고:
- anon key는 공개 가능한 키라 커밋해도 안전합니다. Supabase의 **Realtime Authorization** 은 기본값(off)으로 두어야 익명 클라이언트가 broadcast 채널을 쓸 수 있습니다.
- 무료 플랜 프로젝트는 약 1주 미사용 시 일시정지됩니다. 대시보드에서 **Restore** 를 누르면 재개됩니다 (무료 유지, 데이터 보존).
- 이 앱은 `csp: null` 이라 WebSocket 연결이 허용됩니다. 추후 Content-Security-Policy를 설정한다면 `connect-src https://*.supabase.co wss://*.supabase.co` 를 추가하세요.

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
