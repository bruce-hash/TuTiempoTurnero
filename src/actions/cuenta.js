import { registerChange, registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE, sb } from "../config.js";
import { demoStash } from "../demo/usuarios.js";
import { $ } from "../lib/dom.js";
import { TODAY, nowHM } from "../lib/fechas.js";
import { onPhoto } from "../lib/imagenes.js";
import { ME, pr } from "../lib/prestadores.js";
import { refundPay } from "../lib/saldo.js";
import { freed } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { go, render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

registerClick("toAdmin", (e, x, v) => {
  S.role = "admin";
  S.adm = null;
  S.admFin = null;
  render();
  window.scrollTo(0, 0);
  return;
});
registerClick("changePass", (e, x, v) => {
  S.npMode = "change";
  go("newpass");
});
registerClick("toPanel", (e, x, v) => {
  if (!S.barberAuth) {
    return;
  }
  S.role = "barbero";
  S.btab = "agenda";
  render();
  window.scrollTo(0, 0);
});
registerClick("delAsk", (e, x, v) => {
  S.delAsk = x.dataset.who;
  render();
  const r = $(".delpanel");
  if (r && r.scrollIntoView) {
    r.scrollIntoView({
      block: "center",
    });
  }
});
registerClick("delNo", (e, x, v) => {
  S.delAsk = null;
  render();
});
registerClick("delYes", (e, x, v) => {
  if (!$("#delOk") || !$("#delOk").checked) {
    return;
  }
  S.delAsk = null;
  if (LIVE) {
    (x.dataset.who === "cli" ? api.m.deleteAccount() : api.m.deleteProvider())
      .then(() => sb.auth.signOut())
      .then(() => {
        toast(x.dataset.who === "cli" ? "Tu cuenta fue eliminada." : "Tu perfil fue eliminado.");
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
  if (x.dataset.who === "cli") {
    store.BOOK.forEach((r) => {
      if (r.mine && r.status === "confirmed") {
        r.status = "cancelled";
        r.refund = 0;
        freed(r);
      }
      if (r.mine) {
        r.mine = false;
        r.cliente = "Cliente eliminado";
      }
    });
    S.user = null;
    S.following = false;
    S.wallet = 0;
    S.wmov = [];
    S.form = {
      tel: "",
    };
    S.after = null;
    toast("Tu cuenta fue eliminada. Gracias por usar TuTiempo.");
    go("home");
  } else {
    const r = pr(ME());
    r.deleted = true;
    S.list = null;
    S.counts = null;
    let m = 0;
    store.BOOK.forEach((f) => {
      if (
        f.pid == ME() &&
        f.status === "confirmed" &&
        f.type !== "block" &&
        f.date + f.time >= TODAY() + nowHM()
      ) {
        f.status = "cancelled";
        f.refund = (f.paid || 0) + (f.fee || 0);
        if (f.mine) {
          refundPay(f, f.svc + " en " + pr(f.pid).name);
        }
        m++;
      }
    });
    S.barberAuth = false;
    S.role = "cliente";
    S.view = "home";
    S.preview = false;
    toast(
      `Tu perfil fue eliminado.${m ? ` Cancelamos ${m} turno${m > 1 ? "s" : ""} y les devolvemos lo pagado a los clientes.` : ""}`,
    );
    render();
    window.scrollTo(0, 0);
  }
});
registerClick("logout", (e, x, v) => {
  if (LIVE) {
    sb.auth.signOut();
  } else {
    demoStash();
  }
  S.user = null;
  S.followingBy = {};
  store.BOOK = store.BOOK.filter((r) => !r.mine || !LIVE);
  S.wallet = LIVE ? 0 : S.wallet;
  toast("Cerraste sesión");
  go("home");
});
registerChange("delOk", (e) => {
  const n = $("#delBtn");
  if (n) {
    n.disabled = !e.target.checked;
  }
  return;
});
registerChange("upAv", (e) => {
  onPhoto(e.target, "me");
  return;
});
registerSubmit("fCuenta", (e) => {
  const a = $("#un").value.trim();
  if (!a) {
    $("#uerr").textContent = "El nombre no puede quedar vacío.";
    return;
  }
  S.user.name = a.slice(0, 120);
  S.form.tel = $("#ut").value.trim().slice(0, 40);
  api.m.saveMe(S.user.name, S.form.tel);
  toast("Datos guardados");
  render();
  return;
});
