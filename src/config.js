// Supabase 프로젝트 설정. 두 값을 채우면 채팅이 활성화된다.
// 둘 다 비어 있으면 홈 화면의 [CHAT] 버튼이 비활성 상태로 표시된다.
//
// 값 얻는 법: supabase.com 무료 프로젝트 생성 → Project Settings → API 에서
//   url    = Project URL
//   anonKey = Project API keys 의 "anon public" 키
// anon key는 공개 가능한 키라 커밋해도 안전하다(Realtime Authorization을 켜지 않은 경우).
export const SUPABASE = {
  url: "",
  anonKey: "",
};

export function isChatConfigured() {
  return !!(SUPABASE.url && SUPABASE.anonKey);
}
