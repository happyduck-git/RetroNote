// 로그인/회원가입 화면. 부팅 시 세션이 없으면 첫 화면으로 표시된다.
// 성공 시 home 으로 이동. 모드는 SIGN IN ↔ SIGN UP 토글.
import { el, onEnter } from "../core/dom.js";
import { playKey } from "../platform/sound.js";
import { signIn, signUp } from "../auth/auth.js";

export const loginView = {
  mount(screenEl, params, ctx) {
    let mode = "signin"; // "signin" | "signup"

    const label = el("div", { class: "form-label", text: "Welcome!" });
    const emailInput = el("input", {
      class: "field",
      type: "email",
      placeholder: "email",
      maxlength: "100",
      spellcheck: "false",
      autocomplete: "off",
      dataset: { noDrag: "" },
    });
    const pwInput = el("input", {
      class: "field",
      type: "password",
      placeholder: "password",
      maxlength: "100",
      spellcheck: "false",
      autocomplete: "off",
      dataset: { noDrag: "" },
    });
    const submitBtn = el("button", { class: "btn form-btn", text: "[ SIGN IN ]" });
    const toggleBtn = el("button", { class: "btn form-btn form-btn-small", text: "[ need account? SIGN UP ]" });
    const forgotBtn = el("button", { class: "btn form-btn form-btn-small", text: "[ forgot password? ]" });
    const err = el("div", { class: "form-error" });

    function refreshLabels() {
      // 상단 라벨은 모드와 무관하게 항상 환영 문구.
      submitBtn.textContent = mode === "signin" ? "[ SIGN IN ]" : "[ SIGN UP ]";
      toggleBtn.textContent =
        mode === "signin" ? "[ need account? SIGN UP ]" : "[ have account? SIGN IN ]";
    }

    async function submit() {
      const email = emailInput.value.trim();
      const password = pwInput.value;
      if (!email || !password) {
        err.textContent = "email and password required";
        return;
      }
      err.textContent = "";
      submitBtn.disabled = true;
      toggleBtn.disabled = true;
      try {
        if (mode === "signin") {
          await signIn(email, password);
        } else {
          const data = await signUp(email, password);
          // 이메일 확인이 필요한 프로젝트는 session이 null로 돌아온다 → 안내.
          if (!data?.session) {
            err.textContent = "check your email to confirm, then sign in";
            mode = "signin";
            refreshLabels();
            return;
          }
        }
        ctx.navigate("home");
      } catch (e) {
        err.textContent = e?.message || "auth failed";
        console.error("auth failed:", e);
      } finally {
        submitBtn.disabled = false;
        toggleBtn.disabled = false;
      }
    }

    submitBtn.addEventListener("click", submit);
    toggleBtn.addEventListener("click", () => {
      mode = mode === "signin" ? "signup" : "signin";
      err.textContent = "";
      refreshLabels();
      emailInput.focus();
    });
    forgotBtn.addEventListener("click", () => ctx.navigate("reset"));
    [emailInput, pwInput].forEach((input) => {
      input.addEventListener("keydown", () => playKey()); // 레트로 일관성: 로그인 입력도 키사운드
      onEnter(input, submit);
    });

    screenEl.append(el("div", { class: "form" }, [label, emailInput, pwInput, submitBtn, toggleBtn, forgotBtn, err]));
    setTimeout(() => emailInput.focus(), 0);
  },
};
