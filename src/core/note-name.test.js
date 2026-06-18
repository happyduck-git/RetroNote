import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTimestamp,
  noteFilename,
  isNoteFilename,
  compareNotesByName,
  safeBasename,
} from "./note-name.js";

test("formatTimestamp: 고정 Date → 초 단위 YYYY-MM-DD_HH-MM-SS", () => {
  // month 는 0-based: 5 = 6월.
  assert.equal(formatTimestamp(new Date(2026, 5, 18, 14, 30, 5)), "2026-06-18_14-30-05");
  assert.equal(formatTimestamp(new Date(2026, 0, 1, 0, 0, 0)), "2026-01-01_00-00-00");
});

test("noteFilename: note_ 접두 + .txt", () => {
  assert.equal(noteFilename(new Date(2026, 5, 18, 14, 30, 5)), "note_2026-06-18_14-30-05.txt");
});

test("isNoteFilename: 구(분)/신(초) 포맷 허용, 그 외 거부", () => {
  assert.equal(isNoteFilename("note_2026-06-18_14-30.txt"), true); // 구 분 단위
  assert.equal(isNoteFilename("note_2026-06-18_14-30-05.txt"), true); // 신 초 단위
  assert.equal(isNoteFilename("notes.txt"), false);
  assert.equal(isNoteFilename("note_x.md"), false);
  assert.equal(isNoteFilename("random.txt"), false);
  assert.equal(isNoteFilename("note_2026-06-18_14-30.md"), false);
});

test("compareNotesByName: 최신순 정렬(같은 분·다른 초 포함)", () => {
  const files = [
    "note_2026-06-18_14-30-05.txt",
    "note_2026-06-19_09-00-00.txt",
    "note_2026-06-18_14-30-59.txt",
    "note_2026-06-18_09-00-00.txt",
  ];
  assert.deepEqual([...files].sort(compareNotesByName), [
    "note_2026-06-19_09-00-00.txt",
    "note_2026-06-18_14-30-59.txt",
    "note_2026-06-18_14-30-05.txt",
    "note_2026-06-18_09-00-00.txt",
  ]);
});

test("safeBasename: 유효명은 그대로, traversal/Windows 케이스는 null", () => {
  assert.equal(safeBasename("note_2026-06-18_14-30-05.txt"), "note_2026-06-18_14-30-05.txt");
  assert.equal(safeBasename("note_2026-06-18_14-30.txt"), "note_2026-06-18_14-30.txt");
  // traversal / 경로 구분자
  assert.equal(safeBasename("../../secret.txt"), null);
  assert.equal(safeBasename("a/b.txt"), null);
  assert.equal(safeBasename("a\\b.txt"), null);
  assert.equal(safeBasename("note_../x.txt"), null);
  assert.equal(safeBasename("/abs/note_2026-06-18_14-30-05.txt"), null);
  assert.equal(safeBasename("C:\\note_2026-06-18_14-30-05.txt"), null);
  // Windows 예약어 / 후행 점·공백 / 선행 점
  assert.equal(safeBasename("CON"), null);
  assert.equal(safeBasename("note_2026-06-18_14-30.txt."), null);
  assert.equal(safeBasename("note_2026-06-18_14-30.txt "), null);
  assert.equal(safeBasename(".note_2026-06-18_14-30.txt"), null);
});
