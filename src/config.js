// 채팅 백엔드 설정. 이 파일은 항상 저장소에 존재하며(빈 기본값), 앱이 깨지지 않게 한다.
//
// 실제 키는 공개 저장소에 올리지 않는다. 대신 gitignore된 `config.local.js`에 넣으면
// loadConfig()가 런타임에 동적으로 병합한다. config.local.js 가 없으면(CI/클론 등)
// 채팅만 비활성화되고 노트 기능은 정상 동작한다.
//
// 설정법: `cp src/config.local.example.js src/config.local.js` 후 값 입력.
export let SUPABASE = { url: "", anonKey: "" };

export function isChatConfigured() {
  return !!(SUPABASE.url && SUPABASE.anonKey);
}

// config.local.js (gitignore됨)가 있으면 키를 불러와 병합한다. 없으면 조용히 넘어간다.
export async function loadConfig() {
  try {
    const mod = await import("./config.local.js");
    if (mod?.SUPABASE?.url && mod?.SUPABASE?.anonKey) {
      SUPABASE = mod.SUPABASE;
    }
  } catch {
    // config.local.js 없음 → 채팅 비활성 (정상 동작)
  }
}
