import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makePetDisplayController } from "./pet-display.js";

// fake loadImage: base 별 pending Promise 를 붙잡아 두고 테스트가 직접 resolve/reject → 타이밍 조작.
function harness() {
  const log = []; // show/hide/render 호출 순서 기록
  const pending = new Map(); // base → { resolve, reject }
  const loadImage = (base) =>
    new Promise((resolve, reject) => pending.set(base, { resolve, reject }));
  const ctl = makePetDisplayController({
    loadImage,
    show: () => log.push("show"),
    hide: () => log.push("hide"),
    render: (id) => log.push(`render:${id}`),
  });
  // 마이크로태스크(then/catch) 비움
  const flush = () => Promise.resolve().then(() => Promise.resolve());
  const resolveLoad = async (base) => {
    pending.get(base).resolve();
    await flush();
  };
  const rejectLoad = async (base) => {
    pending.get(base).reject(new Error("no asset"));
    await flush();
  };
  return { ctl, log, resolveLoad, rejectLoad };
}

const BASE = (c) => `assets/pet/${c}/`;

describe("makePetDisplayController", () => {
  test("none → hide 만(로드 없음)", async () => {
    const h = harness();
    h.ctl.setCat("none");
    assert.deepEqual(h.log, ["hide"]);
  });

  test("무효 id → none 취급 → hide", async () => {
    const h = harness();
    h.ctl.setCat("ghost");
    assert.deepEqual(h.log, ["hide"]);
  });

  test("유효 색: 로드 성공 → render 후 show(순서 보장)", async () => {
    const h = harness();
    h.ctl.setCat("grey");
    assert.deepEqual(h.log, []); // 아직 로드 전 → 아무것도 안 함
    await h.resolveLoad(BASE("grey"));
    assert.deepEqual(h.log, ["render:grey", "show"]);
  });

  test("로드 실패(onerror) → show 안 함", async () => {
    const h = harness();
    h.ctl.setCat("grey");
    await h.rejectLoad(BASE("grey"));
    assert.deepEqual(h.log, []); // render/show 모두 없음
  });

  test("none→색→none: 늦게 도착한 색 로드가 show 하지 않음(유령 창 방지)", async () => {
    const h = harness();
    h.ctl.setCat("grey"); // 로드 시작(pending)
    h.ctl.setCat("none"); // 즉시 hide, desired=none
    assert.deepEqual(h.log, ["hide"]);
    await h.resolveLoad(BASE("grey")); // stale 성공 도착
    assert.deepEqual(h.log, ["hide"]); // 여전히 show 없음
  });

  test("색1→색2, 로드 역순 도착 → 마지막 색만 표시(last-wins)", async () => {
    const h = harness();
    h.ctl.setCat("grey"); // 요청1
    h.ctl.setCat("black"); // 요청2 (desired=black)
    await h.resolveLoad(BASE("black")); // 요청2 먼저 완료
    assert.deepEqual(h.log, ["render:black", "show"]);
    await h.resolveLoad(BASE("grey")); // 요청1 늦게 완료 → 버려짐
    assert.deepEqual(h.log, ["render:black", "show"]); // grey 표시 안 됨
  });
});
