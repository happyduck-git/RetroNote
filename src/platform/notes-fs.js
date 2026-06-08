// 노트를 ~/Documents/retro-notes/note_<timestamp>.txt 로 저장 (Tauri fs 플러그인).
// Tauri 외 환경(브라우저에서 채팅만 테스트할 때 등)에서는 fs가 없으므로 저장 시 명확히 실패한다.
const fs = window.__TAURI__?.fs;

const NOTES_DIR = "retro-notes";

function pad(n) {
  return String(n).padStart(2, "0");
}

function timestamp() {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}`
  );
}

export async function saveNote(content) {
  if (!fs) throw new Error("file system unavailable (not running in Tauri)");
  await fs.mkdir(NOTES_DIR, {
    baseDir: fs.BaseDirectory.Document,
    recursive: true,
  });
  const filename = `note_${timestamp()}.txt`;
  await fs.writeTextFile(`${NOTES_DIR}/${filename}`, content, {
    baseDir: fs.BaseDirectory.Document,
  });
  return filename;
}
