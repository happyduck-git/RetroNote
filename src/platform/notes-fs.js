// 노트를 ~/Documents/retro-notes/note_<timestamp>.txt 로 저장 (Tauri fs 플러그인).
const { writeTextFile, mkdir, BaseDirectory } = window.__TAURI__.fs;

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
  await mkdir(NOTES_DIR, {
    baseDir: BaseDirectory.Document,
    recursive: true,
  });
  const filename = `note_${timestamp()}.txt`;
  await writeTextFile(`${NOTES_DIR}/${filename}`, content, {
    baseDir: BaseDirectory.Document,
  });
  return filename;
}
