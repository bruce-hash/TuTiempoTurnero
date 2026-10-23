import { readReg } from "./alta-prestador.js";
import { registerChange, registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { $ } from "../lib/dom.js";
import { errMsg } from "../lib/errores.js";
import { onPhoto } from "../lib/imagenes.js";
import { ME, pr } from "../lib/prestadores.js";
import { catName } from "../lib/rubros.js";
import { svcMeta } from "../lib/servicios.js";
import { cfg, skey } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { stampCfg } from "../ui/sellos.js";
import { toast } from "../ui/toast.js";
import { readSvcEditor } from "../views/prestador/perfil.js";

registerClick("cashToggle", (e, x, v) => {
  const r = cfg(ME());
  r.cash = r.cash === false;
  api.m.saveSettings(r);
  toast(r.cash ? "Ahora aceptás el resto en efectivo." : "Ahora el resto también va por Mercado Pago.");
  render();
  return;
});
registerClick("mediaDel", (e, x, v) => {
  const r = +x.dataset.i;
  if (S.mDelAsk !== r) {
    S.mDelAsk = r;
    toast("Tocá ✕ de nuevo para borrarlo");
    setTimeout(() => {
      S.mDelAsk = null;
    }, 3e3);
    return;
  }
  const m = store.COMM.media.splice(r, 1)[0];
  S.mDelAsk = null;
  if (m) {
    api.m.delMedia(m).catch(() => {});
  }
  toast("Trabajo borrado");
  render();
  return;
});
registerClick("svcOpts", (e, x, v) => {
  readSvcEditor();
  S.edOpen = S.edOpen || {};
  const r = +x.dataset.i;
  S.edOpen[r] = !S.edOpen[r];
  render();
  return;
});
registerClick("addNew", (e, x, v) => {
  readSvcEditor();
  const r = S.edSvcs[+x.dataset.i];
  r[5] = r[5] || svcMeta(r);
  if (r[5].add.length >= 10) {
    toast("Máximo 10 adicionales por servicio");
    return;
  }
  r[5].add.push(["", 0, 0, null]);
  render();
  return;
});
registerClick("addDel", (e, x, v) => {
  readSvcEditor();
  S.edSvcs[+x.dataset.i][5].add.splice(+x.dataset.j, 1);
  render();
  return;
});
registerClick("svcAdd", (e, x, v) => {
  readSvcEditor();
  S.edSvcs.push(["", 30, 0, S.edCats[0] || pr(ME()).cats[0], null]);
  render();
  const r = $("#sn" + (S.edSvcs.length - 1));
  if (r) {
    r.focus();
  }
  return;
});
registerClick("svcDel", (e, x, v) => {
  readSvcEditor();
  if (S.edSvcs.length <= 1) {
    toast("Tenés que tener al menos un servicio.");
    return;
  }
  S.edSvcs.splice(+x.dataset.i, 1);
  render();
  return;
});
registerClick("publicar", (e, x, v) => {
  const r = ($("#postTxt") || {}).value || "";
  if (!r.trim()) {
    toast("Escribí un mensaje primero");
    return;
  }
  api.m.post(r.trim().slice(0, 400));
  toast(`Aviso enviado a ${store.COMM.followers} seguidores`);
  render();
});
registerClick("responder", (e, x, v) => {
  const r = +x.dataset.i;
  const m = ($("#rep" + r) || {}).value || "";
  if (!m.trim()) {
    toast("Escribí tu respuesta.");
    return;
  }
  store.COMM.reviews[r].reply = m.trim().slice(0, 600);
  api.m.reply(store.COMM.reviews[r]);
  toast("Respuesta publicada");
  render();
});
registerClick("mpConnect", (e, x, v) => {
  if (LIVE) {
    api.m.mpConnect().catch((r) => toast(errMsg(r)));
    return;
  }
  S.mp = "auth";
  render();
});
registerClick("mpCancel", (e, x, v) => {
  S.mp = "none";
  render();
});
registerClick("mpOk", (e, x, v) => {
  S.mp = "ok";
  toast("Mercado Pago conectado");
  render();
});
registerClick("mpDesc", (e, x, v) => {
  S.mp = "none";
  render();
});
registerChange("useW", (e) => {
  S.useWallet = e.target.checked;
  render();
  return;
});
registerChange("msv", (e) => {
  S.manSvc = +e.target.value;
  const n = $("#mcl").value;
  const o = $("#mtel").value;
  render();
  $("#mcl").value = n;
  $("#mtel").value = o;
  return;
});
registerChange("pf", (e) => {
  store.REGFILES = [...e.target.files].slice(0, 4);
  Object.assign(S.reg, readReg());
  S.reg.files = e.target.files.length;
  if (S.reg.errs) {
    delete S.reg.errs.files;
  }
  render();
  return;
});
registerChange("upPhoto", (e) => {
  onPhoto(e.target, "pro");
  return;
});
registerChange("upMedia", (e) => {
  [...e.target.files].slice(0, 10).forEach((n) => {
    if (n.size > 15728640) {
      toast("Máximo 15 MB por archivo");
      return;
    }
    const o = {
      label: n.name.slice(0, 80),
      url: URL.createObjectURL(n),
      video: n.type.startsWith("video"),
    };
    store.COMM.media.unshift(o);
    api.m
      .upload(n, o)
      .then(render)
      .catch(() => {});
  });
  toast("Publicado en tus trabajos");
  render();
});
registerSubmit("fStamps", (e) => {
  const a = pr(ME());
  const t = stampCfg(ME());
  const s = (c) => {
    $("#sterr").textContent = c;
  };
  const n = $("#stOn").checked;
  if (!a.svcs.length) {
    return s("Cargá al menos un servicio en Mis datos.");
  }
  const o = {};
  let i = false;
  document.querySelectorAll("[data-sts]").forEach((c) => {
    if (!c.checked) {
      return;
    }
    const d = a.svcs[+c.dataset.sts];
    const p = +(document.querySelector(`[data-stg="${c.dataset.sts}"]`) || {}).value;
    if (d) {
      if (LIVE && !d[4]) {
        i = true;
        return;
      }
      if (!(p >= 15) || !(p <= 20)) {
        i = true;
        return;
      }
      o[skey(d)] = p;
    }
  });
  if (i) {
    return s(LIVE ? "Guardá primero tus servicios en Mis datos." : "Cada tarjeta lleva de 15 a 20 sellos.");
  }
  if (n && !Object.keys(o).length) {
    return s("Elegí al menos un servicio que sume sello.");
  }
  t.on = n;
  t.goals = o;
  api.m.saveSettings(cfg(ME()));
  api.m.saveStampGoals(a, o);
  const l = Object.keys(o).length;
  toast(n ? `Tarjetas activas en ${l} servicio${l > 1 ? "s" : ""}.` : "Tarjetas de sellos desactivadas.");
  render();
  return;
});
registerSubmit("fDatos", (e) => {
  const a = pr(ME());
  readSvcEditor();
  const t = (c) => {
    $("#derr").textContent = c;
  };
  const s = $("#dn").value.trim();
  if (s.length < 2) {
    return t("El nombre visible tiene que tener al menos 2 letras.");
  }
  if (!S.edCats.length) {
    return t("Elegí al menos un rubro.");
  }
  const n = S.edSvcs.findIndex(
    (c) =>
      c[0].length < 2 ||
      c[1] < 5 ||
      c[1] > 480 ||
      c[2] <= 0 ||
      (c[5] && c[5].add.some((d) => d[0].length < 2)),
  );
  if (n >= 0) {
    return t(
      `Revisá el servicio ${n + 1}: nombre, minutos (5 a 480), precio y nombres de los adicionales.`,
    );
  }
  const o = S.edCats.filter((c) => !S.edSvcs.some((d) => d[3] === c));
  if (o.length) {
    return t(`Agregá al menos un servicio de ${o.map(catName).join(", ")} o quitá ese rubro.`);
  }
  const i = a.svcs.map((c) => c[4]).filter((c) => c && !S.edSvcs.some((d) => d[4] === c));
  a.name = s.slice(0, 80);
  a.bio = $("#dd").value.trim().slice(0, 600);
  a.addr = $("#da").value.trim().slice(0, 160);
  a.ig = $("#di").value.trim().slice(0, 60);
  const l = a.svcs.map((c) => c.slice());
  a.cats = S.edCats.slice();
  a.svcs = S.edSvcs.map((c) => {
    const d = c.slice();
    d[5] &&= {
      every: d[5].every,
      note: d[5].note,
      add: d[5].add.map((p) => p.slice()),
    };
    return d;
  });
  a.before = l;
  S.edSvcs = null;
  S.svc = 0;
  S.list = null;
  S.counts = null;
  if (!a.cats.includes(S.pctx)) {
    S.pctx = null;
  }
  api.m.saveProfile(a, i).catch(() => {});
  toast("Datos guardados. Ya se ven en tu perfil.");
  render();
  return;
});
