import { registerChange, registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { demoStash } from "../demo/usuarios.js";
import { $ } from "../lib/dom.js";
import { TODAY, nowHM } from "../lib/fechas.js";
import { onPhoto } from "../lib/imagenes.js";
import { ME, pr } from "../lib/prestadores.js";
import { freed } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { go, render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

registerClick("toAdmin", (ev, el, act) => {
  S.role = "admin";
  S.adm = null;
  S.admFin = null;
  render();
  window.scrollTo(0, 0);
  return;
});
registerClick("changePass", (ev, el, act) => {
  S.npMode = "change";
  go("newpass");
});
registerClick("toPanel", (ev, el, act) => {
  if (!S.barberAuth) {
    return;
  }
  S.role = "barbero";
  S.btab = "agenda";
  render();
  window.scrollTo(0, 0);
});
registerClick("delAsk", (ev, el, act) => {
  S.delAsk = el.dataset.who;
  render();
  const box = $(".delpanel");
  if (box && box.scrollIntoView) {
    box.scrollIntoView({
      block: "center",
    });
  }
});
registerClick("delNo", (ev, el, act) => {
  S.delAsk = null;
  render();
});
// eliminar cuenta o perfil. En vivo lo hace la base; en la demo: si es el cliente, sus turnos se cancelan sin
// devolución; si es el prestador, sus turnos futuros se cancelan devolviendo seña y comisión
registerClick("delYes", (ev, el, act) => {
  if (!$("#delOk") || !$("#delOk").checked) {
    return;
  }
  S.delAsk = null;
  if (LIVE) {
    (el.dataset.who === "cli" ? api.m.deleteAccount() : api.m.deleteProvider())
      .then(() => sb.auth.signOut())
      .then(() => {
        toast(el.dataset.who === "cli" ? "Tu cuenta fue eliminada." : "Tu perfil fue eliminado.");
        S.user = null;
        S.barberAuth = false;
        S.role = "cliente";
        S.view = "home";
        S.list = null;
        S.counts = null;
        render();
      })
      .catch(() => {});
    return;
  }
  if (el.dataset.who === "cli") {
    store.BOOK.forEach((booking) => {
      if (booking.mine && booking.status === "confirmed") {
        booking.status = "cancelled";
        booking.refund = 0;
        freed(booking);
      }
      if (booking.mine) {
        booking.mine = false;
        booking.cliente = "Cliente eliminado";
      }
    });
    S.user = null;
    S.following = false;
    S.form = {
      tel: "",
    };
    S.after = null;
    toast("Tu cuenta fue eliminada. Gracias por usar TuTiempo.");
    go("home");
  } else {
    const prov = pr(ME());
    prov.deleted = true;
    S.list = null;
    S.counts = null;
    let cancelled = 0;
    store.BOOK.forEach((booking) => {
      if (
        booking.pid == ME() &&
        booking.status === "confirmed" &&
        booking.type !== "block" &&
        booking.date + booking.time >= TODAY() + nowHM()
      ) {
        booking.status = "cancelled";
        booking.refund = (booking.paid || 0) + (booking.fee || 0);
        cancelled++;
      }
    });
    S.barberAuth = false;
    S.role = "cliente";
    S.view = "home";
    S.preview = false;
    toast(
      `Tu perfil fue eliminado.${cancelled ? ` Cancelamos ${cancelled} turno${cancelled > 1 ? "s" : ""} y les devolvemos lo pagado a los clientes.` : ""}`,
    );
    render();
    window.scrollTo(0, 0);
  }
});
registerClick("logout", (ev, el, act) => {
  if (LIVE) {
    sb.auth.signOut();
  } else {
    demoStash();
  }
  S.user = null;
  S.followingBy = {};
  store.BOOK = store.BOOK.filter((booking) => !booking.mine || !LIVE);
  toast("Cerraste sesión");
  go("home");
});
registerChange("delOk", (ev) => {
  const btn = $("#delBtn");
  if (btn) {
    btn.disabled = !ev.target.checked;
  }
  return;
});
registerChange("upAv", (ev) => {
  onPhoto(ev.target, "me");
  return;
});
// Bloque 3: avisos de los turnos por email
registerChange("uMail", (ev) => {
  const on = ev.target.checked;
  S.user.emailNotices = on;
  api.m.setEmailNotices(on);
  toast(on ? "Listo: te mandamos los avisos de tus turnos por email." : "Listo: ya no te mandamos emails. Los avisos siguen en Mis turnos.");
  return;
});
registerSubmit("fCuenta", (ev) => {
  const name = $("#un").value.trim();
  if (!name) {
    $("#uerr").textContent = "El nombre no puede quedar vacío.";
    return;
  }
  S.user.name = name.slice(0, 120);
  S.form.tel = $("#ut").value.trim().slice(0, 40);
  api.m.saveMe(S.user.name, S.form.tel);
  toast("Datos guardados");
  render();
  return;
});
