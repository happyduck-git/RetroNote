// 방 코드 생성/정규화/검증. 혼동 문자(0/O/1/I)를 뺀 32자 알파벳, 6자리.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LEN = 6;

export function generate6() {
  const buf = new Uint32Array(LEN);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < LEN; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

export function normalize(code) {
  return String(code || "").trim().toUpperCase();
}

export function isValid(code) {
  const c = normalize(code);
  return c.length === LEN && [...c].every((ch) => ALPHABET.includes(ch));
}

export const CODE_LENGTH = LEN;
