import { CAPTCHA_KEY } from "../config.js";

// H30: CAPTCHA de Supabase Auth con Cloudflare Turnstile. Solo si config.js trae turnstileSiteKey; si no, todo esto
// no hace nada y la app funciona como siempre (sin el script de Cloudflare).
//  - Las vistas ponen captchaBox("<formulario>") donde va el recuadro; render() llama a mountCaptchas(), que carga
//    el script la primera vez y arma un widget por recuadro (con appearance "interaction-only" casi nunca se ve: solo si
//    Cloudflare pide tocarlo).
//  - Antes de cada llamada a Auth (crear cuenta, ingresar, código, recuperar contraseña, reenviar), captchaToken() da el
//    token de ese formulario; Supabase lo valida con Cloudflare. Un token sirve una sola vez: después se pide otro.
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=ttTurnstileReady";
const WAIT_MS = 8000;
let loading = null;
const widgets = new Map(); // recuadro → id del widget
const tokens = {}; // formulario → token sin usar
const waiting = {}; // formulario → quienes esperan su token

const captchaError = () => Object.assign(new Error("captcha_missing"), { code: "captcha_missing" });

function load() {
  if (!loading) {
    loading = new Promise((ok, fail) => {
      window.ttTurnstileReady = () => ok(window.turnstile);
      const script = document.createElement("script");
      script.src = SRC;
      script.async = true;
      script.onerror = () => {
        loading = null;
        script.remove();
        fail(new Error("captcha_load"));
      };
      document.head.append(script);
    });
  }
  return loading;
}

const gotToken = (form, token) => {
  tokens[form] = token;
  (waiting[form] || []).splice(0).forEach((resolve) => resolve());
};

// recuadro del widget (vacío si no hay CAPTCHA)
export function captchaBox(form) {
  return CAPTCHA_KEY ? `<div class="cf-box" data-captcha="${form}"></div>` : "";
}

// después de cada render(): saca los widgets de recuadros que ya no están y arma los de los nuevos
export function mountCaptchas() {
  if (!CAPTCHA_KEY) {
    return;
  }
  for (const [box, id] of widgets) {
    if (!box.isConnected) {
      window.turnstile.remove(id);
      widgets.delete(box);
    }
  }
  const boxes = [...document.querySelectorAll(".cf-box[data-captcha]")].filter((box) => !widgets.has(box));
  if (!boxes.length) {
    return;
  }
  load()
    .then((turnstile) => {
      for (const box of boxes) {
        if (!box.isConnected || widgets.has(box)) {
          continue;
        }
        const form = box.dataset.captcha;
        const id = turnstile.render(box, {
          sitekey: CAPTCHA_KEY,
          action: form.toLowerCase(),
          language: "es",
          theme: "auto",
          size: "flexible",
          appearance: "interaction-only",
          callback: (token) => gotToken(form, token),
          "expired-callback": () => delete tokens[form],
          "error-callback": () => {
            delete tokens[form];
          },
        });
        widgets.set(box, id);
      }
    })
    .catch(() => {});
}

// el token para la próxima llamada a Auth desde ese formulario (undefined si no hay CAPTCHA). Si todavía no llegó,
// espera hasta 8 segundos; si no llega, error captcha_missing ("Completá la verificación de seguridad").
export async function captchaToken(form) {
  if (!CAPTCHA_KEY) {
    return undefined;
  }
  if (!tokens[form]) {
    mountCaptchas();
    await new Promise((resolve) => {
      (waiting[form] = waiting[form] || []).push(resolve);
      setTimeout(resolve, WAIT_MS);
    });
  }
  const token = tokens[form];
  delete tokens[form];
  // un token sirve una sola vez (aunque la llamada falle): se pide otro para el próximo intento
  for (const [box, id] of widgets) {
    if (box.dataset.captcha === form && box.isConnected) {
      window.turnstile.reset(id);
    }
  }
  if (!token) {
    throw captchaError();
  }
  return token;
}
