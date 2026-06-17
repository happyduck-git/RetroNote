[English](DEVELOPMENT.md) | **한국어**

# 개발 & 셀프 호스팅

retro-note를 소스에서 빌드하고 선택 기능인 채팅 백엔드를 구성하는 방법입니다. **앱을 사용하는 일반 사용자에게는 필요 없는 내용**입니다 — 앱 사용법은 [README](../README.ko.md)를 참고하세요.

## 소스에서 빌드

Node.js, Rust (Cargo 포함), 그리고 OS별 [Tauri 사전 요구사항](https://tauri.app/start/prerequisites/)이 필요합니다.

```bash
npm install
npm run tauri dev      # 개발 모드
npm run tauri build    # 프로덕션 바이너리
```

빌드 산출물은 `src-tauri/target/release/bundle/`에 생성됩니다 — macOS는 `.dmg`, Windows는 `.msi` / `.exe`.

## 채팅 백엔드 (Supabase)

채팅은 선택 기능이며 실시간 백엔드가 필요합니다. [Supabase](https://supabase.com) **무료 플랜**으로 충분합니다. 설정하지 않아도 앱은 정상 실행되며 채팅만 비활성화됩니다.

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
   `src/config.js` 가 실행 시 이 키를 불러옵니다.
4. **데이터베이스 스키마를 적용합니다.** Supabase 대시보드 → **SQL Editor** 에서 `db/migrations/` 의 마이그레이션을 파일명 순서(`0001_baseline.sql` → `0004_add_membership_alias.sql`)대로 실행합니다. `messages`·`room_memberships` 테이블과 채팅이 의존하는 row-level security 정책이 생성됩니다. [`db/README.md`](../db/README.md) 참고.
5. **이메일 로그인을 활성화합니다.** 채팅에는 계정(Supabase Auth, 이메일+비밀번호)이 필요합니다. 기본 Email 공급자면 충분하며, 이메일 확인을 켜둔 경우 신규 사용자는 확인 후에 로그인할 수 있습니다.
6. 다시 빌드/실행합니다. 두 값이 비어 있으면 **[ CHAT ]** 버튼이 비활성화되고 노트 기능만 동작합니다.

참고:
- anon key는 공개 가능한 키라 커밋해도 안전합니다. 채팅은 RLS로 보호되는 테이블 위에서 인증된 Realtime(`postgres_changes`)을 사용하므로 각 사용자가 로그인해야 하며, 접근 제어는 마이그레이션의 row-level security 정책이 담당합니다.
- 무료 플랜 프로젝트는 약 1주 미사용 시 일시정지됩니다. 대시보드에서 **Restore** 를 누르면 재개됩니다 (무료 유지, 데이터 보존).
- 이 앱은 `csp: null` 이라 WebSocket 연결이 허용됩니다. 추후 Content-Security-Policy를 설정한다면 `connect-src https://*.supabase.co wss://*.supabase.co` 를 추가하세요.
