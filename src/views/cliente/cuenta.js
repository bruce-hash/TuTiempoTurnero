import { esc } from "../../lib/dom.js";
import { TODAY, nowHM } from "../../lib/fechas.js";
import { ME, isFol } from "../../lib/prestadores.js";
import { CAT } from "../../lib/rubros.js";
import { walletPanel } from "../../lib/saldo.js";
import { S } from "../../state.js";
import { P, store } from "../../store.js";
import { photoPicker } from "../../ui/fotos.js";
import { myUpcoming } from "./home.js";

export function delBox(who, a) {
  if (S.delAsk !== who) {
    return `<button class="lnk delbtn" data-act="delAsk" data-who="${who}">${who === "cli" ? "Eliminar mi cuenta" : "Eliminar mi perfil de prestador"}</button>`;
  }
  const t =
    who === "pro"
      ? store.BOOK.filter(
          (s) =>
            s.pid == ME() &&
            s.status === "confirmed" &&
            s.type !== "block" &&
            s.date + s.time >= TODAY() + nowHM(),
        ).length
      : a;
  return `<div class="panel delpanel"><b>${who === "cli" ? "Eliminar mi cuenta" : "Eliminar mi perfil de prestador"}</b>
   <ul class="dl">${who === "cli" ? `<li>Se borran tus datos, tu historial y los profesionales que seguís.</li><li>${t ? `Tenés <b>${t}</b> turno${t > 1 ? "s" : ""} reservado${t > 1 ? "s" : ""}: se cancela${t > 1 ? "n" : ""} y lo pagado no se devuelve.` : "No tenés turnos reservados."}</li>` : `<li>Tu perfil deja de aparecer en TuTiempo y nadie más puede reservarte.</li><li>${t ? `Tenés <b>${t}</b> turno${t > 1 ? "s" : ""} futuro${t > 1 ? "s" : ""}: se cancela${t > 1 ? "n" : ""} y a cada cliente se le devuelve todo lo que pagó.` : "No tenés turnos futuros."}</li><li>Tus fichas de clientes, finanzas y fotos se borran. Desconectamos tu Mercado Pago.</li>`}<li>No se puede deshacer.</li></ul>
   <label class="chk" style="justify-content:flex-start;margin:8px 0 12px"><input type="checkbox" id="delOk"> Entiendo que no se puede deshacer</label>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn btn-ghost" data-act="delNo">Cancelar</button><button class="btn btn-bad" data-act="delYes" data-who="${who}" id="delBtn" disabled>Eliminar definitivamente</button></div></div>`;
}
export function vCuenta() {
  const e = S.user;
  const a = myUpcoming().length;
  return `<div class="narrow stack" style="margin-top:20px"><h1 class="h1">Mi perfil</h1>
   <div class="panel contact">${photoPicker(e, "upAv")}<div><b>${esc(e.name)}</b><div class="hint">${esc(e.email)}</div><label class="lnk" for="upAv" style="cursor:pointer">📷 ${e.photo ? "Cambiar foto" : "Agregar foto"}</label></div></div>
   ${walletPanel()}
   <button class="tcard" data-go="misturnos"><div class="tdate"><span>Turnos</span><b>${a}</b></div><div class="tc-m"><b>📅 Mis turnos</b><span>${a ? `Tenés ${a} turno${a > 1 ? "s" : ""} reservado${a > 1 ? "s" : ""}` : "No tenés turnos reservados"}</span></div><span class="tc-go">›</span></button>
   <form class="panel" id="fCuenta" novalidate><p class="lbl">Mis datos</p>
    <div class="f"><label for="un">Nombre</label><input id="un" value="${esc(e.name)}" autocomplete="off"></div>
    <div class="f"><label for="ut">Celular</label><input id="ut" value="${esc(S.form.tel)}" autocomplete="off"></div>
    <div class="err" id="uerr"></div>
    <button class="btn btn-pri btn-block" type="submit">Guardar</button></form>
   <div class="panel"><p class="lbl">Profesionales que seguís</p>${(() => {
     const t = P.filter((s) => isFol(s.id) && !s.deleted);
     if (t.length) {
       return `<ul class="ag">${t.map((s) => `<li><span class="ag-t">${(CAT[s.cats[0]] || CAT.n).ic}</span><div><b>${esc(s.name)}</b><span>Te avisamos cuando tenga lugar</span></div><button class="btn btn-ghost" data-go="perfil" data-id="${s.id}">Ver</button></li>`).join("")}</ul>`;
     } else {
       return '<p class="note">Seguí a tus favoritos para enterarte cuando tienen lugar.</p>';
     }
   })()}</div>
   <div class="panel"><p class="lbl">Seguridad</p><dl class="kv"><dt>Email</dt><dd>${esc(e.email)}</dd></dl>
    <button class="btn btn-ghost btn-block" style="margin-top:10px" data-act="changePass">🔒 Cambiar contraseña</button></div>
   ${S.isAdmin ? '<button class="btn btn-ghost btn-block" data-act="toAdmin">🛠️ Panel de TuTiempo (admin)</button>' : ""}
   ${S.barberAuth ? '<button class="btn btn-pri btn-block" data-act="toPanel">Ir a mi panel de prestador</button>' : '<p class="note">¿Ofrecés servicios? <button class="lnk" data-go="prestador">Sumate como prestador</button></p>'}
   <button class="btn btn-ghost btn-block" data-act="logout">Cerrar sesión</button>
   ${delBox("cli", a)}
  </div>`;
}
