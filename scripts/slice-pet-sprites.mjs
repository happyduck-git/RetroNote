// 펫 스프라이트 자르기 (개발용, 1회성). 모든 캐릭터 에셋이 들어가 있는 통합 시트(AllCats*.png)에서
// 19개 동작 스트립 전부를 색상별로 잘라 src/assets/pet/<catId>/*.png 로 저장한다.
// PNG는 gitignore 처리
//
// 격자: 시트는 1024×1216, 64px 셀의 16열×19행 = 한 줄이 한 동작(19줄=19동작, 1:1).
// 행 인덱스는 코드로 알 수 없어(비자명) 아래에 남긴다 — /Pochi/Sprites/<Name>.png(크림)를
// 시트 줄과 픽셀 대조해 확정했다(모든 색 시트가 동일 배치):
//   row 0  Idle(0..5)      row 5  Running(0..5)    row 10 Crying(0..3)       row 15 Dead1(0..5)
//   row 1  Excited(0..2)   row 6  Jump(0..11)      row 11 Dance(0..3)        row 16 Dead2(0..4)
//   row 2  Dead(0)         row 7  Box1(0..11)      row 12 Chilling(0..7)     row 17 Hurt(0..7)
//   row 3  Sleeping(0..3)  row 8  Box2(0..9)       row 13 Surprised(0,0,1,1) row 18 Attack(0..6)
//   row 4  Happy(0..9)     row 9  Box3(0..11)      row 14 Tickle(0..3)
// Surprised 만 특수: 시트엔 2프레임뿐 → 4프레임 [A,A,B,B] 재현(cols 0,0,1,1). 나머지는 cols 0..(프레임수-1).
//
// 사용: node scripts/slice-pet-sprites.mjs [--src <dir>]   (또는 PET_SRC 환경변수)
//   자동검증은 "치수/비어있음"만 잡는다. 의미상 올바른 행인지는 못 잡으므로,
//   스크립트가 마지막에 _contact-sheet.png 를 남긴다 → 반드시 눈으로 확인할 것(필수 게이트).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PNG } from "pngjs";
import { CAT_IDS } from "../src/pet/cats.js"; // 카탈로그와의 드리프트 검사용(cats.js 는 순수 ESM)

const CELL = 64;

// 애니메이션 = 시트의 (row, [col...]) 셀 목록. 순서대로 가로로 이어 붙여 스트립을 만든다.
const ANIMS = [
  { out: "Idle.png", row: 0, cols: [0, 1, 2, 3, 4, 5] },
  { out: "Excited.png", row: 1, cols: [0, 1, 2] },
  { out: "Dead.png", row: 2, cols: [0] },
  { out: "Sleeping.png", row: 3, cols: [0, 1, 2, 3] },
  { out: "Happy.png", row: 4, cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { out: "Running.png", row: 5, cols: [0, 1, 2, 3, 4, 5] },
  { out: "Jump.png", row: 6, cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { out: "Box1.png", row: 7, cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { out: "Box2.png", row: 8, cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { out: "Box3.png", row: 9, cols: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { out: "Crying.png", row: 10, cols: [0, 1, 2, 3] },
  { out: "Dance.png", row: 11, cols: [0, 1, 2, 3] },
  { out: "Chilling.png", row: 12, cols: [0, 1, 2, 3, 4, 5, 6, 7] },
  { out: "Surprised.png", row: 13, cols: [0, 0, 1, 1] },
  { out: "Tickle.png", row: 14, cols: [0, 1, 2, 3] },
  { out: "Dead1.png", row: 15, cols: [0, 1, 2, 3, 4, 5] },
  { out: "Dead2.png", row: 16, cols: [0, 1, 2, 3, 4] },
  { out: "Hurt.png", row: 17, cols: [0, 1, 2, 3, 4, 5, 6, 7] },
  { out: "Attack.png", row: 18, cols: [0, 1, 2, 3, 4, 5, 6] },
];

// catId ↔ 통합 시트 파일(아래 assert 로 cats.js 카탈로그와 동기 강제).
const SHEETS = [
  { catId: "cream", file: "AllCats.png" },
  { catId: "grey", file: "AllCatsGrey.png" },
  { catId: "black", file: "AllCatsBlack.png" },
  { catId: "greywhite", file: "AllCatsGreyWhite.png" },
  { catId: "orange", file: "AllCatsOrange.png" },
  { catId: "white", file: "AllCatsWhite.png" },
];

// SSOT 드리프트 방지: 만드는 폴더 집합이 cats.js 카탈로그(none 제외)와 어긋나면 바로 실패.
{
  const sheetIds = SHEETS.map((s) => s.catId);
  const catalogIds = CAT_IDS.filter((id) => id !== "none");
  const missing = catalogIds.filter((id) => !sheetIds.includes(id));
  const extra = sheetIds.filter((id) => !catalogIds.includes(id));
  if (missing.length || extra.length) {
    fail(`SHEETS 가 cats.js 카탈로그와 어긋남 — 카탈로그에만: [${missing}] / 스크립트에만: [${extra}]`);
  }
}

function parseSrc() {
  const i = process.argv.indexOf("--src");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (process.env.PET_SRC) return process.env.PET_SRC;
  return path.join(os.homedir(), "Downloads", "CatMegaBundle", "Pochi");
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// 시트에서 (row, col) 64×64 셀을 dst 의 (dx,0) 위치로 복사.
function blitCell(sheet, row, col, dst, dx) {
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const si = ((row * CELL + y) * sheet.width + (col * CELL + x)) * 4;
      const di = (y * dst.width + (dx + x)) * 4;
      dst.data[di] = sheet.data[si];
      dst.data[di + 1] = sheet.data[si + 1];
      dst.data[di + 2] = sheet.data[si + 2];
      dst.data[di + 3] = sheet.data[si + 3];
    }
  }
}

// 스트립이 완전 투명(내용 없음)인지.
function isBlank(png) {
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] !== 0) return false;
  return true;
}

const SRC = parseSrc();
const OUT_ROOT = path.resolve(new URL("..", import.meta.url).pathname, "src/assets/pet");

console.log(`src  : ${SRC}`);
console.log(`out  : ${OUT_ROOT}\n`);

// 결과를 모아 contact-sheet 로 쌓는다: 행=색, 열=[Idle|Running|Sleeping|Surprised].
const stripW = ANIMS.map((a) => a.cols.length * CELL);
const rowW = stripW.reduce((s, w) => s + w, 0) + (ANIMS.length - 1) * CELL; // 셀 간격 1칸
const contact = new PNG({ width: rowW, height: SHEETS.length * CELL, fill: true });

let ok = 0;
for (let s = 0; s < SHEETS.length; s++) {
  const { catId, file } = SHEETS[s];
  const sheetPath = path.join(SRC, file);
  if (!fs.existsSync(sheetPath)) fail(`시트 없음: ${sheetPath}`);
  const sheet = PNG.sync.read(fs.readFileSync(sheetPath));
  if (sheet.width !== 1024 || sheet.height !== 1216)
    fail(`${file} 치수 예상과 다름: ${sheet.width}×${sheet.height} (기대 1024×1216)`);

  const outDir = path.join(OUT_ROOT, catId);
  fs.mkdirSync(outDir, { recursive: true });

  let dx0 = 0;
  for (let a = 0; a < ANIMS.length; a++) {
    const anim = ANIMS[a];
    const w = anim.cols.length * CELL;
    const strip = new PNG({ width: w, height: CELL, fill: true });
    anim.cols.forEach((col, k) => blitCell(sheet, anim.row, col, strip, k * CELL));

    if (strip.width !== w || strip.height !== CELL)
      fail(`${catId}/${anim.out} 치수 오류: ${strip.width}×${strip.height}`);
    if (isBlank(strip)) fail(`${catId}/${anim.out} 가 완전 투명(행 인덱스 오류 의심)`);

    fs.writeFileSync(path.join(outDir, anim.out), PNG.sync.write(strip));

    for (let y = 0; y < CELL; y++)
      for (let x = 0; x < w; x++) {
        const si = (y * strip.width + x) * 4;
        const di = ((s * CELL + y) * contact.width + (dx0 + x)) * 4;
        contact.data[di] = strip.data[si];
        contact.data[di + 1] = strip.data[si + 1];
        contact.data[di + 2] = strip.data[si + 2];
        contact.data[di + 3] = strip.data[si + 3];
      }
    dx0 += w + CELL;
    ok++;
  }
  console.log(`✓ ${catId.padEnd(10)} ← ${file}  (${ANIMS.length} strips)`);
}

const contactPath = path.join(OUT_ROOT, "_contact-sheet.png");
fs.writeFileSync(contactPath, PNG.sync.write(contact));

console.log(`\n${ok} strips written (${SHEETS.length} colors × ${ANIMS.length} anims).`);
console.log(`육안 확인(필수): ${contactPath}`);
console.log(
  `  행 = 색(${SHEETS.map((s) => s.catId).join("/")}), 열 = ${ANIMS.map((a) => a.out.replace(/\.png$/, "")).join("|")}`,
);
