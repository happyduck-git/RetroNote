// 템플릿: 이 파일을 같은 폴더에 `config.local.js`로 복사한 뒤 값을 채우세요.
//   cp src/config.local.example.js src/config.local.js
// config.local.js 는 .gitignore 되어 키가 저장소에 커밋되지 않습니다.
//
// 값 얻는 법: supabase.com 무료 프로젝트 → Project Settings → API 에서
//   url     = Project URL (예: https://xxxx.supabase.co — 경로 없이 베이스 주소만)
//   anonKey = Project API keys 의 "anon public" 키 (절대 service_role 키를 넣지 마세요)
export const SUPABASE = {
  url: "",
  anonKey: "",
};

// (선택) Tenor GIF 검색 키. 채팅 입력의 [gif] 버튼이 이 키로 Tenor v2 API 를 호출한다.
//   값 얻는 법: console.cloud.google.com → APIs & Services → Library → "Tenor API" Enable
//               → Credentials → Create credentials → API key.
//   비워두면 [gif] 버튼이 숨겨지고 채팅의 다른 기능은 영향 없다.
export const CHAT = {
  tenorApiKey: "",
};
