import { test, expect } from "@playwright/test";

// 화면 보호기 E2E — 실제 Chromium 렌더링/입력/기하를 검증한다.
// 유휴 3분 타이밍 로직은 jsdom 배선 테스트(screensaver.dom.test.js)가 실제 setInterval+
// performance.now 경로로 커버하므로, 여기선 __screensaver.show() 훅으로 즉시 발동시켜
// "실제 브라우저에서만 확인 가능한" 것들(캔버스 애니메이션, 진짜 입력 해제, 클릭 삼킴, 기하)만 본다.

const overlay = (page) => page.locator(".screensaver");
const canvas = (page) => page.locator(".screensaver canvas");

test.beforeEach(async ({ page }) => {
  // 외부 CDN(구글 폰트/jsdelivr Galmuri) 차단 → 네트워크 플레이크 제거(폰트 비의존 검증).
  await page.route(/(fonts\.googleapis|fonts\.gstatic|jsdelivr)/, (r) => r.abort());
  // 깨우는 클릭 삼킴 검증용: 닫기 버튼 클릭 카운터를 페이지 스크립트보다 먼저 심는다.
  await page.addInitScript(() => {
    window.__closeClicks = 0;
    document.addEventListener("DOMContentLoaded", () => {
      document
        .getElementById("close-btn")
        ?.addEventListener("click", () => (window.__closeClicks += 1));
    });
  });
  await page.goto("/");
  await page.waitForFunction(() => !!window.__screensaver); // 부팅 + 훅 준비
});

for (const scene of ["starfield", "matrix"]) {
  test(`${scene}: 캔버스가 실제로 애니메이션한다(두 프레임이 다름)`, async ({ page }) => {
    await page.evaluate((s) => window.__screensaver.show(s), scene);
    await expect(canvas(page)).toBeVisible();

    const a = await canvas(page).screenshot();
    await page.waitForTimeout(300); // 매트릭스 STEP_MS=75 → ≥3스텝 보장
    const b = await canvas(page).screenshot();
    expect(Buffer.compare(a, b)).not.toBe(0);
  });
}

for (const dismiss of [
  { name: "마우스 이동", act: (page) => page.mouse.move(400, 350) },
  { name: "키 입력", act: (page) => page.keyboard.press("a") },
  { name: "휠", act: (page) => page.mouse.wheel(0, 120) },
]) {
  test(`실제 ${dismiss.name} → 즉시 해제, 이전 화면(홈) 유지`, async ({ page }) => {
    await page.evaluate(() => window.__screensaver.show("starfield"));
    await expect(overlay(page)).toBeVisible();

    await dismiss.act(page);

    await expect(overlay(page)).toHaveCount(0);
    await expect(page.locator("#screen .menu")).toBeVisible(); // 홈 메뉴 그대로
  });
}

test("깨우는 클릭은 삼켜져 아래 닫기 버튼에 닿지 않는다", async ({ page }) => {
  const box = await page.locator("#close-btn").boundingBox();
  // 마우스를 버튼 위에 먼저 올려둔 뒤(이 이동은 아직 화면 보호기가 없어 무해) 발동시킨다.
  // 그래야 뒤이은 pointerdown 이 "깨우는 첫 입력"이 된다(mouse.click 은 클릭 전 이동이
  // pointermove 로 먼저 해제시켜 pointerdown 이 깨우기가 되지 못한다).
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => window.__screensaver.show("starfield"));
  await expect(overlay(page)).toBeVisible();

  await page.mouse.down(); // 깨우는 pointerdown(이동 없음) → pointerWokeAt 설정
  await page.mouse.up(); // 600ms 내 pointerup/click → 삼킴

  await expect(overlay(page)).toHaveCount(0); // 클릭으로 깨워짐
  expect(await page.evaluate(() => window.__closeClicks)).toBe(0); // 버튼엔 안 닿음
});

test("베젤 모드에서도 오버레이가 CRT 화면 영역(94%)을 채운다", async ({ page }) => {
  await page.evaluate(() => document.getElementById("screen-mode-btn").click()); // 베젤 켜기
  await page.evaluate(() => window.__screensaver.show("matrix"));
  await expect(overlay(page)).toBeVisible();

  const o = await overlay(page).boundingBox();
  const s = await page.locator("#screen").boundingBox();
  // --screen-width/height-pct 는 베젤 모드에서 94% (styles.css body.bezel-mode)
  expect(Math.abs(o.width / s.width - 0.94)).toBeLessThan(0.01);
  expect(Math.abs(o.height / s.height - 0.94)).toBeLessThan(0.01);
});
