// 비밀번호 재설정 화면. 2단계:
//   1) 이메일 입력 → SEND CODE → Supabase가 OTP 메일 발송
//   2) OTP + 새 비번 입력 → RESET → 검증 후 비밀번호 교체 → home 으로
// 성공 시 자동 로그인된 상태가 된다(verifyOtp가 세션을 발급).
import { el } from "../core/dom.js";
import { requestPasswordReset, verifyResetOtp, updatePassword } from "../auth/auth.js";

export const resetView = {
  mount(screenEl, params, ctx) {
    let codeSent = false;

    const label = el("div", { class: "form-label", text: "RESET PASSWORD" });
    const emailInput = el("input", {
      class: "field",
      type: "email",
      placeholder: "email",
      maxlength: "100",
      spellcheck: "false",
      autocomplete: "off",
      dataset: { noDrag: "" },
    });
    const sendBtn = el("button", { class: "btn form-btn", text: "[ SEND CODE ]" });

    const otpInput = el("input", {
      class: "field",
      type: "text",
      placeholder: "code from email",
      maxlength: "10",
      spellcheck: "false",
      autocomplete: "off",
      dataset: { noDrag: "" },
    });
    const newPwInput = el("input", {
      class: "field",
      type: "password",
      placeholder: "new password",
      maxlength: "100",
      spellcheck: "false",
      autocomplete: "off",
      dataset: { noDrag: "" },
    });
    const resetBtn = el("button", { class: "btn form-btn", text: "[ RESET ]" });

    const backBtn = el("button", { class: "btn form-btn", text: "[ < BACK TO SIGN IN ]" });
    const msg = el("div", { class: "form-error" });

    // 2단계는 처음엔 숨김. SEND 성공 시 노출.
    otpInput.hidden = true;
    newPwInput.hidden = true;
    resetBtn.hidden = true;

    function showStep2() {
      codeSent = true;
      otpInput.hidden = false;
      newPwInput.hidden = false;
      resetBtn.hidden = false;
      msg.style.color = ""; // 기본 에러색 복원
      otpInput.focus();
    }

    async function doSend() {
      const email = emailInput.value.trim();
      if (!email) {
        msg.textContent = "email required";
        return;
      }
      msg.textContent = "";
      sendBtn.disabled = true;
      try {
        await requestPasswordReset(email);
        msg.style.color = "#7fff7f"; // 성공 안내는 초록 톤
        msg.textContent = "code sent — check your email";
        showStep2();
      } catch (e) {
        msg.style.color = "";
        msg.textContent = e?.message || "request failed";
        console.error("reset request failed:", e);
      } finally {
        sendBtn.disabled = false;
      }
    }

    async function doReset() {
      const email = emailInput.value.trim();
      const otp = otpInput.value.trim();
      const newPw = newPwInput.value;
      if (!email || !otp || !newPw) {
        msg.style.color = "";
        msg.textContent = "all fields required";
        return;
      }
      msg.style.color = "";
      msg.textContent = "";
      resetBtn.disabled = true;
      try {
        await verifyResetOtp(email, otp);
        await updatePassword(newPw);
        ctx.navigate("home");
      } catch (e) {
        msg.textContent = e?.message || "reset failed";
        console.error("reset failed:", e);
      } finally {
        resetBtn.disabled = false;
      }
    }

    sendBtn.addEventListener("click", doSend);
    resetBtn.addEventListener("click", doReset);
    backBtn.addEventListener("click", () => ctx.navigate("login"));

    [emailInput, otpInput, newPwInput].forEach((input) =>
      input.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (!codeSent) doSend();
        else doReset();
      }),
    );

    screenEl.append(
      el("div", { class: "form" }, [
        label,
        emailInput,
        sendBtn,
        otpInput,
        newPwInput,
        resetBtn,
        backBtn,
        msg,
      ]),
    );
    setTimeout(() => emailInput.focus(), 0);
  },
};
