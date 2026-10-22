import { $ } from "./dom.js";
import { S } from "../state.js";
import { go } from "../ui/render.js";
import { toast } from "../ui/toast.js";

export function afterLogin() {
  S.login = {
    mode: "in",
    email: "",
    err: "",
  };
  toast("Hola, " + S.user.name.split(" ")[0] + ". Ya ingresaste.");
  const e = S.after || "home";
  S.after = null;
  go(e);
}
export function saveAfter(e) {
  try {
    sessionStorage.setItem(
      "tt_after",
      JSON.stringify({
        v: e,
        pid: S.pid,
      }),
    );
  } catch (a) {}
}
export const authErr = (e, a) => {
  const t = $("#aerr");
  if (t) {
    t.textContent = e;
  }
  if (a) {
    const s = $("#" + a);
    if (s) {
      s.focus();
    }
  }
};
