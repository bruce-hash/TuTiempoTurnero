import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { CAT } from "../../lib/rubros.js";
import { S } from "../../state.js";
import { P } from "../../store.js";
import { GLOGO, LOGO } from "../../ui/iconos.js";

// ingreso de prestadores en tres pasos (S.blogin.step): formulario, recuperar contraseña y link enviado.
// En la demo muestra botones para entrar como cada prestador de ejemplo (credenciales de demo: H18).
export function vLoginBarbero() {
  const login = S.blogin;
  if (login.step === "recover") {
    return `<div class="narrow"><form class="panel" id="fRecover" novalidate style="margin-top:24px">
   <div class="logo" style="justify-content:center;display:flex">${LOGO}</div>
   <h1 class="h1">Recuperar contraseña</h1><p class="lead">Ingresá tu email y te mandamos un link para crear una nueva.</p>
   <div class="f"><label for="re">Email</label><input id="re" type="email" autocomplete="off" value="${esc(login.email || "")}"></div>
   <div class="err" id="rerr">${esc(login.err || "")}</div>
   <button class="btn btn-pri btn-block" type="submit">Enviar link</button>
   <p class="note" style="margin-top:12px"><button type="button" class="lnk" data-act="bBack">← Volver al ingreso</button></p></form></div>`;
  } else if (login.step === "sent") {
    return `<div class="narrow"><div class="panel" style="margin-top:24px;text-align:center">
   <div style="font-size:40px">📩</div><h1 class="h1">Revisá tu email</h1><p class="lead">Si <b>${esc(login.email)}</b> tiene una cuenta, te llega un link para crear una contraseña nueva. Vence en 30 minutos.</p>
   <button class="btn btn-pri btn-block" data-act="bBack">Volver al ingreso</button></div></div>`;
  } else {
    return `<div class="narrow"><form class="panel" id="fBarb" novalidate style="margin-top:24px">
   <div class="logo" style="justify-content:center;display:flex">${LOGO}</div>
   <h1 class="h1">Acceso prestadores</h1><p class="lead">Entrá a tu panel para manejar tu agenda.</p>
   <div class="panel" style="background:var(--brand-soft);border-color:var(--brand-line);padding:12px;margin-bottom:14px;text-align:left;font-size:14px">
    ${
      LIVE
        ? "<b>Entrá con el email y la contraseña de tu cuenta de prestador.</b>"
        : `<b>Entrá como cualquier prestador de ejemplo:</b><div class="demologins">${P.filter(
            (prov) => !prov.deleted,
          )
            .map(
              (prov) =>
                `<button type="button" class="cchip seg-${prov.cats[0]}" data-act="demoLogin" data-id="${prov.id}">${(CAT[prov.cats[0]] || CAT.n).ic} ${esc(prov.name)}</button>`,
            )
            .join(
              "",
            )}</div><span class="hint">O con email y contraseña: filo@tutiempo.demo · barbero123</span>`
    }</div>
   <button type="button" class="gbtn" data-act="googleProv">${GLOGO} Entrar con Google</button><div class="or">o con tu email</div>
   <div class="f"><label for="be">Email</label><input id="be" type="email" value="${esc(login.email)}" autocomplete="email"></div>
   <div class="f"><label for="bp">Contraseña</label><div class="pw"><input id="bp" type="${login.show ? "text" : "password"}" value="${esc(login.pass)}" autocomplete="off"><button type="button" class="lnk" data-act="bShow">${login.show ? "Ocultar" : "Mostrar"}</button></div></div>
   <div class="err" id="berr">${esc(login.err || "")}</div>
   <button class="btn btn-pri btn-block" type="submit" ${login.locked ? "disabled" : ""}>Entrar al panel</button>
   <p class="note" style="margin-top:12px"><button type="button" class="lnk" data-act="bRecover" ${login.fails >= 2 ? 'style="font-weight:700"' : ""}>¿Olvidaste tu contraseña?</button></p>
   <p class="note">¿Todavía no sos prestador? <button type="button" class="lnk" data-go="prestador">Sumate</button></p>
  </form></div>`;
  }
}
