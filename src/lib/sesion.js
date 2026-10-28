import { $ } from "./dom.js";
import { S } from "../state.js";
import { go, render } from "../ui/render.js";
import { refreshPush } from "./push.js";
import { afterPathFor, navigate } from "../router.js";
import { toast } from "../ui/toast.js";

export function afterLogin() {
  // Bloque C: ¿este dispositivo ya recibe las notificaciones de esta cuenta?
  refreshPush()
    .then(() => render())
    .catch(() => {});
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
  // primer ingreso de un prestador nuevo (Bloque D): a Perfil, con los pasos para activarlo
  if (S.firstPanel && S.barberAuth) {
    S.firstPanel = false;
    S.after = null;
    navigate("/panel/perfil");
    return;
  }
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
// Bloque D: errores al lado de cada campo, todos a la vez. errs: { idDelCampo: mensaje }. Marca el campo (borde rojo,
// aria-invalid y aria-describedby al mensaje), pone el mensaje debajo y lleva el foco al primero; el mensaje general
// (#aerr u otro) queda vacío. Al escribir en el campo, su error se borra (actions/formularios.js).
export function showFieldErrors(errs, generalId = "aerr") {
  document.querySelectorAll(".fe-msg").forEach((el) => el.remove());
  document.querySelectorAll("[aria-invalid=true]").forEach(clearFieldError);
  let first = null;
  for (const [id, msg] of Object.entries(errs)) {
    const field = document.getElementById(id);
    if (!field || !msg) {
      continue;
    }
    const box = field.closest(".f") || field.closest("label");
    const note = document.createElement("span");
    note.className = "ferr fe-msg";
    note.id = id + "_err";
    note.textContent = "⚠ " + msg;
    if (box && box.matches(".f")) {
      box.classList.add("bad");
      box.append(note);
    } else if (box) {
      box.after(note);
    }
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", note.id);
    first = first || field;
  }
  const general = document.getElementById(generalId);
  if (general) {
    general.textContent = "";
  }
  if (first) {
    first.focus();
  }
}
export function clearFieldError(field) {
  field.removeAttribute("aria-invalid");
  if (field.getAttribute("aria-describedby") === field.id + "_err") {
    field.removeAttribute("aria-describedby");
  }
  const note = document.getElementById(field.id + "_err");
  if (note) {
    note.remove();
  }
  const box = field.closest(".f");
  if (box && !box.querySelector("[aria-invalid=true]")) {
    box.classList.remove("bad");
  }
}
// un mensaje: al lado del campo si se dice cuál, si no en el general (#aerr)
export const authErr = (msg, fieldId) => {
  if (fieldId && $("#" + fieldId)) {
    showFieldErrors({ [fieldId]: msg });
    return;
  }
  const box = $("#aerr");
  if (box) {
    box.textContent = msg;
  }
};
// "Recordar mi email en este dispositivo" (Bloque D): solo el email, nunca la contraseña. Si el navegador no deja
// guardar (modo privado, almacenamiento bloqueado), no pasa nada: el campo arranca vacío.
const EMAIL_KEY = "tt_email";
export function rememberedEmail() {
  try {
    return localStorage.getItem(EMAIL_KEY) || "";
  } catch (err) {
    return "";
  }
}
export function rememberEmail(email, keep) {
  try {
    if (keep && email) {
      localStorage.setItem(EMAIL_KEY, email);
    } else {
      localStorage.removeItem(EMAIL_KEY);
    }
  } catch (err) {}
}
// Reenviar (el email de activación o el código): una vez por minuto, con la cuenta regresiva en el botón
export const RESEND_WAIT_MS = 60000;
export function resendLeft(at) {
  return Math.max(0, Math.ceil(((at || 0) - Date.now()) / 1000));
}
let resendTimer = null;
// mientras haya espera, actualiza cada segundo el texto de los botones [data-resend-at] (sin redibujar la pantalla)
export function tickResend() {
  clearInterval(resendTimer);
  resendTimer = setInterval(() => {
    const buttons = document.querySelectorAll("[data-resend-at]");
    if (!buttons.length) {
      clearInterval(resendTimer);
      return;
    }
    buttons.forEach((btn) => {
      const left = resendLeft(+btn.dataset.resendAt);
      btn.disabled = left > 0;
      btn.textContent = btn.dataset.label + (left > 0 ? ` (en 0:${String(left).padStart(2, "0")})` : "");
    });
  }, 1000);
}
