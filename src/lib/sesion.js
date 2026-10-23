import { $ } from "./dom.js";
import { S } from "../state.js";
import { go } from "../ui/render.js";
import { afterPathFor, navigate } from "../router.js";
import { toast } from "../ui/toast.js";

export function afterLogin() {
  S.login = {
    mode: "in",
    email: "",
    err: "",
  };
  toast("Hola, " + S.user.name.split(" ")[0] + ". Ya ingresaste.");
  goAfter();
}
// después de ingresar: a la pantalla o dirección que estaba esperando (S.after) o al inicio
export function goAfter() {
  const next = S.after || "home";
  S.after = null;
  if (String(next).startsWith("/")) {
    navigate(next);
  } else {
    go(next);
  }
}
// Recuerda a qué dirección volver después de ingresar con Google (la página se recarga al volver).
export function saveAfter(view) {
  try {
    sessionStorage.setItem("tt_after", JSON.stringify({ path: afterPathFor(view) }));
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
