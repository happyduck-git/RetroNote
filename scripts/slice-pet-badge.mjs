// 펫 알림 배지(발바닥) 자르기 (개발용, 1회성). UI 시트(CatUI.png)에서 발바닥 아이콘 하나를
// 잘라 src/assets/pet/badge-paw.png 로 저장한다. PNG는 gitignore 처리(유료 에셋).
//
// 좌표: CatUI.png(512×944)의 발바닥 4개 중 1번(왼쪽, 균일한 캐러멜 톤) — 알파 스캔으로 확정한
// 절대 영역 (327,153)-(362,183), 즉 35×30px. (스프라이트 시트와 달리 셀 격자가 아니라 아이콘
// 하나라 좌표를 직접 박아둔다.)
//
// 사용: node scripts/slice-pet-badge.mjs [--src <catui.png>]   (또는 PET_BADGE_SRC 환경변수)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

// 원본 CatUI.png 치수와 발바닥 1번 절대 좌표(좌상단 포함, 우하단 배제).
const SRC_W = 512;
const SRC_H = 944;
const PAW = { x0: 327, y0: 153, x1: 362, y1: 183 };

function parseSrc() {
  const i = process.argv.indexOf("--src");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  if (process.env.PET_BADGE_SRC) return process.env.PET_BADGE_SRC;
  return path.join(os.homedir(), "Downloads", "CatMegaBundle", "CatUserInterface", "CatUI.png");
}

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// 완전 투명(내용 없음)인지 — 좌표가 어긋나면 빈 영역을 잘랐다는 신호.
function isBlank(png) {
  for (let i = 3; i < png.data.length; i += 4) if (png.data[i] !== 0) return false;
  return true;
}

const SRC = parseSrc();
const OUT = fileURLToPath(new URL("../src/assets/pet/badge-paw.png", import.meta.url));

console.log(`src  : ${SRC}`);
console.log(`out  : ${OUT}\n`);

if (!fs.existsSync(SRC)) fail(`원본 없음: ${SRC}`);
let sheet;
try {
  sheet = PNG.sync.read(fs.readFileSync(SRC));
} catch (e) {
  fail(`원본 PNG 읽기 실패(손상/PNG 아님): ${SRC}\n  ${e.message}`);
}
if (sheet.width !== SRC_W || sheet.height !== SRC_H)
  fail(`CatUI.png 치수 예상과 다름: ${sheet.width}×${sheet.height} (기대 ${SRC_W}×${SRC_H})`);

const w = PAW.x1 - PAW.x0;
const h = PAW.y1 - PAW.y0;
const out = new PNG({ width: w, height: h, fill: true });
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const si = ((PAW.y0 + y) * sheet.width + (PAW.x0 + x)) * 4;
    const di = (y * w + x) * 4;
    out.data[di] = sheet.data[si];
    out.data[di + 1] = sheet.data[si + 1];
    out.data[di + 2] = sheet.data[si + 2];
    out.data[di + 3] = sheet.data[si + 3];
  }

if (isBlank(out)) fail(`잘라낸 영역이 완전 투명(좌표 오류 의심): ${JSON.stringify(PAW)}`);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, PNG.sync.write(out));
console.log(`✓ badge-paw.png 저장 (${w}×${h})`);
