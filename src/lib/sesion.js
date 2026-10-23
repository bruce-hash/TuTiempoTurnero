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
  const next = S.after || "home";
  S.after = null;
  go(next);
}
// Recuerda a qué pantalla volver después de ingresar con Google (la página se recarga al volver).
export function saveAfter(view) {
  try {
    sessionStorage.setItem(
      "tt_after",
      JSON.stringify({
        v: view,
        pid: S.pid,
      }),
    );
  } catch (err) {}
}
export const authErr = (msg, fieldId) => {
  const box = $("#aerr");
  if (box) {
    box.textContent = msg;
  }
  if (fieldId) {
    const field = $("#" + fieldId);
    if (field) {
      field.focus();
    }
  }
};
