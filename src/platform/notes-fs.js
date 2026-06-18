// 노트를 ~/Documents/retro-notes/ 에 .txt 로 저장/조회/편집 (Tauri fs 플러그인).
// 이 파일은 I/O 경계만 담당한다 — 파일명 정책/검증은 순수 모듈 core/note-name.js 가 소유.
// Tauri 외 환경(브라우저에서 채팅만 테스트할 때 등)에서는 fs 가 없어 명확히 실패한다.
import {
  noteFilename,
  isNoteFilename,
  compareNotesByName,
  safeBasename,
} from "../core/note-name.js";

const fs = window.__TAURI__?.fs;

const NOTES_DIR = "retro-notes";

// vault 내 경로 + baseDir 옵션을 한 곳에서 만든다(dir/baseDir 페어링 분산 방지).
function notePath(base) {
  return `${NOTES_DIR}/${base}`;
}
function opts() {
  return { baseDir: fs.BaseDirectory.Document };
}

// 검증된 basename 반환. 부정한 파일명(traversal 등)은 fs 호출 전에 차단.
function requireBasename(filename) {
  const base = safeBasename(filename);
  if (!base) throw new Error(`invalid note filename: ${filename}`);
  return base;
}

// vault 의 노트 파일명 목록(최신순). 디렉터리가 아직 없으면 빈 배열.
export async function listNotes() {
  if (!fs) throw new Error("file system unavailable (not running in Tauri)");
  let entries;
  try {
    entries = await fs.readDir(NOTES_DIR, opts());
  } catch {
    // 첫 저장 전이면 디렉터리가 없어 readDir 이 throw — "노트 없음"으로 취급.
    return [];
  }
  return entries
    .filter((e) => e.isFile && isNoteFilename(e.name))
    .map((e) => e.name)
    .sort(compareNotesByName);
}

export async function readNote(filename) {
  if (!fs) throw new Error("file system unavailable (not running in Tauri)");
  const base = requireBasename(filename);
  return fs.readTextFile(notePath(base), opts());
}

// 지정한 파일에 덮어쓰기(편집 저장의 primitive). 파일명을 반환.
export async function writeNote(filename, content) {
  if (!fs) throw new Error("file system unavailable (not running in Tauri)");
  const base = requireBasename(filename);
  await fs.mkdir(NOTES_DIR, { baseDir: fs.BaseDirectory.Document, recursive: true });
  await fs.writeTextFile(notePath(base), content, opts());
  return base;
}

// 새 노트 생성: 현재 시각으로 파일명을 발급해 저장(생성 wrapper).
export async function saveNote(content) {
  return writeNote(noteFilename(new Date()), content);
}
