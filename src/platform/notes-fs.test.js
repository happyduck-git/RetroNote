import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

// notes-fs 는 모듈 로드 시점에 window.__TAURI__?.fs 를 캡처한다.
// → import 전에 fake fs 를 전역에 심고, 같은 객체를 유지하며 호출 로그만 초기화한다.
const fsCalls = [];
const fakeFs = {
  BaseDirectory: { Document: "Document" },
  dirEntries: [],
  dirThrows: false,
  fileContent: "hello",
  async readDir(dir, opts) {
    fsCalls.push(["readDir", dir, opts]);
    if (fakeFs.dirThrows) throw new Error("ENOENT: no such directory");
    return fakeFs.dirEntries;
  },
  async readTextFile(path, opts) {
    fsCalls.push(["readTextFile", path, opts]);
    return fakeFs.fileContent;
  },
  async writeTextFile(path, content, opts) {
    fsCalls.push(["writeTextFile", path, content, opts]);
  },
  async mkdir(dir, opts) {
    fsCalls.push(["mkdir", dir, opts]);
  },
  async remove(path, opts) {
    fsCalls.push(["remove", path, opts]);
  },
};

const savedWindow = globalThis.window;
globalThis.window = { __TAURI__: { fs: fakeFs } };

const { listNotes, readNote, writeNote, deleteNote, saveNote } = await import("./notes-fs.js");

after(() => {
  globalThis.window = savedWindow;
});

beforeEach(() => {
  fsCalls.length = 0;
  fakeFs.dirEntries = [];
  fakeFs.dirThrows = false;
  fakeFs.fileContent = "hello";
});

const called = (name) => fsCalls.some((c) => c[0] === name);
const lastCall = (name) => [...fsCalls].reverse().find((c) => c[0] === name);

describe("traversal 가드: fs I/O 진입 전에 부정한 파일명 차단", () => {
  test("readNote(traversal) → reject, readTextFile 미호출", async () => {
    await assert.rejects(() => readNote("../../secret.txt"), /invalid note filename/);
    assert.equal(called("readTextFile"), false);
  });

  test("writeNote(traversal) → reject, mkdir/writeTextFile 미호출", async () => {
    await assert.rejects(() => writeNote("a/b.txt", "x"), /invalid note filename/);
    assert.equal(called("mkdir"), false);
    assert.equal(called("writeTextFile"), false);
  });

  test("deleteNote(traversal) → reject, remove 미호출 (유일한 보안 관문)", async () => {
    await assert.rejects(() => deleteNote("a\\b.txt"), /invalid note filename/);
    assert.equal(called("remove"), false);
  });
});

describe("정상 경로 구성 (retro-notes/<base> + Document baseDir)", () => {
  test("readNote(valid) → readTextFile 를 vault 경로로 호출하고 내용 반환", async () => {
    fakeFs.fileContent = "저장된 내용";
    const content = await readNote("note_2026-06-18_14-30-05.txt");
    assert.equal(content, "저장된 내용");
    const c = lastCall("readTextFile");
    assert.equal(c[1], "retro-notes/note_2026-06-18_14-30-05.txt");
    assert.deepEqual(c[2], { baseDir: "Document" });
  });

  test("writeNote(valid) → mkdir 먼저, 그다음 writeTextFile, base 반환", async () => {
    const base = await writeNote("note_2026-06-18_14-30-05.txt", "본문");
    assert.equal(base, "note_2026-06-18_14-30-05.txt");
    const w = lastCall("writeTextFile");
    assert.equal(w[1], "retro-notes/note_2026-06-18_14-30-05.txt");
    assert.equal(w[2], "본문");
    const mkdirIdx = fsCalls.findIndex((c) => c[0] === "mkdir");
    const writeIdx = fsCalls.findIndex((c) => c[0] === "writeTextFile");
    assert.ok(mkdirIdx >= 0 && mkdirIdx < writeIdx, "mkdir 가 writeTextFile 보다 먼저여야 한다");
  });

  test("deleteNote(valid) → remove 를 vault 경로로 호출", async () => {
    await deleteNote("note_2026-06-18_14-30-05.txt");
    assert.equal(lastCall("remove")[1], "retro-notes/note_2026-06-18_14-30-05.txt");
  });
});

describe("listNotes", () => {
  test("파일이 아니거나 노트명이 아닌 항목은 걸러내고 최신순 정렬", async () => {
    fakeFs.dirEntries = [
      { isFile: true, name: "note_2026-06-18_09-00-00.txt" },
      { isFile: true, name: "note_2026-06-19_09-00-00.txt" },
      { isFile: false, name: "note_2026-06-20_09-00-00.txt" }, // 디렉터리 → 제외
      { isFile: true, name: "random.txt" }, // 노트명 아님 → 제외
      { isFile: true, name: "note_2026-06-18_14-30-05.md" }, // .md 도 노트
    ];
    assert.deepEqual(await listNotes(), [
      "note_2026-06-19_09-00-00.txt",
      "note_2026-06-18_14-30-05.md",
      "note_2026-06-18_09-00-00.txt",
    ]);
  });

  test("디렉터리가 아직 없어 readDir 이 throw 하면 빈 배열", async () => {
    fakeFs.dirThrows = true;
    assert.deepEqual(await listNotes(), []);
  });
});

describe("saveNote", () => {
  test("현재 시각으로 노트 파일명을 발급해 저장하고 그 이름을 반환", async () => {
    const base = await saveNote("새 노트");
    assert.match(base, /^note_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.txt$/);
    const w = lastCall("writeTextFile");
    assert.equal(w[1], `retro-notes/${base}`);
    assert.equal(w[2], "새 노트");
  });

  test("markdown:true 이면 .md 로 발급", async () => {
    const base = await saveNote("# 제목", { markdown: true });
    assert.match(base, /^note_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.md$/);
  });
});
