import { defineConfig, devices } from "@playwright/test";

// 화면 보호기 E2E(#73). 실제 Chromium 에서 조립된 src/ 를 그대로 구동한다.
// 정적 서버는 이미 devDep 인 esbuild 의 servedir 를 재사용(번들링 없이 올바른 MIME 으로 src/ 서빙).
// Tauri 없이도 앱은 notes-only 모드로 부팅되고 window.__screensaver 훅이 열린다.
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: "**/*.spec.js",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://127.0.0.1:5178",
  },
  projects: [
    {
      name: "chromium",
      // 앱 기본 창(800x720)과 동일 뷰포트 — 좌표/기하 검증 안정화.
      use: { ...devices["Desktop Chrome"], viewport: { width: 800, height: 720 } },
    },
  ],
  webServer: {
    command: "npx esbuild --servedir=src --serve=127.0.0.1:5178",
    url: "http://127.0.0.1:5178",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
