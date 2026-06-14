// Supabase Auth 래퍼. 클라이언트 싱글톤 + signIn/signUp/signOut/getSession/onAuthChange.
// vendor 번들은 첫 호출 시 동적 import 한다 → 미사용 빌드는 로드 비용 0.
// 세션 영속화는 supabase-js 기본(localStorage) 동작에 위임한다.
import { SUPABASE } from "../config.js";

let clientPromise = null;

export async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const { createClient } = await import("../vendor/supabase.js");
      return createClient(SUPABASE.url, SUPABASE.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storage: typeof localStorage !== "undefined" ? localStorage : undefined,
        },
      });
    })();
  }
  return clientPromise;
}

export async function signIn(email, password) {
  const client = await getClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password) {
  const client = await getClient();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const client = await getClient();
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const client = await getClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  return data?.session || null;
}

// 현재 로그인 사용자의 auth.uid. 로그인 안 된 상태면 null.
// 메시지 ownership 판정(message-store) 및 본인 메시지 envelope 채움에 사용.
export async function getCurrentUserId() {
  const session = await getSession();
  return session?.user?.id || null;
}

// cb는 (event, session) 시그니처. unsubscribe 함수를 반환.
export async function onAuthChange(cb) {
  const client = await getClient();
  const { data } = client.auth.onAuthStateChange((event, session) => cb(event, session));
  return () => data?.subscription?.unsubscribe?.();
}

// 비밀번호 복구: 이메일로 6자리 OTP 코드 발송.
// (Supabase Dashboard → Auth → Email Templates → Reset Password 의 본문에
//  `{{ .Token }}` 가 포함되어 있어야 코드가 메일에 표시된다.)
export async function requestPasswordReset(email) {
  const client = await getClient();
  const { error } = await client.auth.resetPasswordForEmail(email);
  if (error) throw error;
}

// 메일로 받은 OTP를 검증하면 복구 세션이 생긴다.
export async function verifyResetOtp(email, otp) {
  const client = await getClient();
  const { data, error } = await client.auth.verifyOtp({
    email,
    token: otp,
    type: "recovery",
  });
  if (error) throw error;
  return data;
}

// 복구 세션 상태에서 호출하면 현재 사용자의 비밀번호가 교체된다.
export async function updatePassword(newPassword) {
  const client = await getClient();
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
