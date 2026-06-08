// 뷰 상태머신. 뷰 = { mount(screenEl, params, ctx), unmount?() }.
// navigate()는 이전 뷰를 unmount → 화면 비움 → 새 뷰 mount 한다.
// 뷰의 unmount()에서 채널 구독/타이머를 정리하면 누수가 자동으로 막힌다.
export function createRouter(screenEl, onChange) {
  let current = null; // { name, view, params }
  const views = new Map();
  const ctx = { navigate };

  function register(name, view) {
    views.set(name, view);
  }

  function navigate(name, params = {}) {
    const next = views.get(name);
    if (!next) throw new Error(`no view: ${name}`);
    if (current?.view.unmount) current.view.unmount();
    screenEl.replaceChildren();
    current = { name, view: next, params };
    next.mount(screenEl, params, ctx);
    if (onChange) onChange(name, params);
  }

  return { register, navigate };
}
