import { LIVE } from "../../config.js";
import { esc } from "../../lib/dom.js";
import { CAT } from "../../lib/rubros.js";
import { S } from "../../state.js";
import { P } from "../../store.js";
import { GLOGO, LOGO } from "../../ui/iconos.js";

export function vLoginBarbero() {
  const e = S.blogin;
  if (e.step === "recover") {
    return `<div class="narrow"><form class="panel" id="fRecover" novalidate style="margin-top:24px">
   <div class="logo" style="justify-content:center;display:flex">${LOGO}</div>
   <h1 class="h1">Recuperar contraseña</h1><p class="lead">Ingresá tu email y te mandamos un link para crear una nueva.</p>
   <div class="f"><label for="re">Email</label><input id="re" type="email" autocomplete="off" value="${esc(e.email || "")}"></div>
   <div class="err" id="rerr">${esc(e.err || "")}</div>
   <button class="btn btn-pri btn-block" type="submit">Enviar link</button>
   <p class="note" style="margin-top:12px"><button type="button" class="lnk" data-act="bBack">← Volver al ingreso</button></p></form></div>`;
  } else if (e.step === "sent") {
    return `<div class="narrow"><div class="panel" style="margin-top:24px;text-align:center">
   <div style="font-size:40px">📩</div><h1 class="h1">Revisá tu email</h1><p class="lead">Si <b>${esc(e.email)}</b> tiene una cuenta, te llega un link para crear una contraseña nueva. Vence en 30 minutos.</p>
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
            (a) => !a.deleted,
          )
            .map(
              (a) =>
                `<button type="button" class="cchip seg-${a.cats[0]}" data-act="demoLogin" data-id="${a.id}">${(CAT[a.cats[0]] || CAT.n).ic} ${esc(a.name)}</button>`,
            )
            .join(
              "",
            )}</div><span class="hint">O con email y contraseña: hidro.style@tutiempo.demo · barbero123</span>`
    }</div>
   <button type="button" class="gbtn" data-act="googleProv">${GLOGO} Entrar con Google</button><div class="or">o con tu email</div>
   <div class="f"><label for="be">Email</label><input id="be" type="email" value="${esc(e.email)}" autocomplete="email"></div>
   <div class="f"><label for="bp">Contraseña</label><div class="pw"><input id="bp" type="${e.show ? "text" : "password"}" value="${esc(e.pass)}" autocomplete="off"><button type="button" class="lnk" data-act="bShow">${e.show ? "Ocultar" : "Mostrar"}</button></div></div>
   <div class="err" id="berr">${esc(e.err || "")}</div>
   <button class="btn btn-pri btn-block" type="submit" ${e.locked ? "disabled" : ""}>Entrar al panel</button>
   <p class="note" style="margin-top:12px"><button type="button" class="lnk" data-act="bRecover" ${e.fails >= 2 ? 'style="font-weight:700"' : ""}>¿Olvidaste tu contraseña?</button></p>
   <p class="note">¿Todavía no sos prestador? <button type="button" class="lnk" data-go="prestador">Sumate</button></p>
  </form></div>`;
  }
}
