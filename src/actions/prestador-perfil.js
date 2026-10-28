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
import { readSvcEditor, svcEditorError } from "../views/prestador/perfil.js";

registerClick("cashToggle", (ev, el, act) => {
  const conf = cfg(ME());
  conf.cash = conf.cash === false;
  api.m.saveSettings(conf);
  toast(conf.cash ? "Ahora aceptás el resto en efectivo." : "Ahora el resto también va por Mercado Pago.");
  render();
  return;
});
// borrar un trabajo pide un segundo toque en menos de 3 segundos
registerClick("mediaDel", (ev, el, act) => {
  const index = +el.dataset.i;
  if (S.mDelAsk !== index) {
    S.mDelAsk = index;
    toast("Tocá ✕ de nuevo para borrarlo");
    setTimeout(() => {
      S.mDelAsk = null;
    }, 3e3);
    return;
  }
  const media = store.COMM.media.splice(index, 1)[0];
  S.mDelAsk = null;
  if (media) {
    api.m.delMedia(media).catch(() => {});
  }
  toast("Trabajo borrado");
  render();
  return;
});
registerClick("svcOpts", (ev, el, act) => {
  readSvcEditor();
  S.edOpen = S.edOpen || {};
  const index = +el.dataset.i;
  S.edOpen[index] = !S.edOpen[index];
  render();
  return;
});
registerClick("addNew", (ev, el, act) => {
  readSvcEditor();
  const svc = S.edSvcs[+el.dataset.i];
  svc[5] = svc[5] || svcMeta(svc);
  if (svc[5].add.length >= 10) {
    toast("Máximo 10 adicionales por servicio");
    return;
  }
  svc[5].add.push(["", 0, 0, null]);
  render();
  return;
});
registerClick("addDel", (ev, el, act) => {
  readSvcEditor();
  S.edSvcs[+el.dataset.i][5].add.splice(+el.dataset.j, 1);
  render();
  return;
});
registerClick("svcAdd", (ev, el, act) => {
  readSvcEditor();
  S.edSvcs.push(["", 30, 0, S.edCats[0] || pr(ME()).cats[0], null]);
  render();
  const input = $("#sn" + (S.edSvcs.length - 1));
  if (input) {
    input.focus();
  }
  return;
});
registerClick("svcDel", (ev, el, act) => {
  readSvcEditor();
  if (S.edSvcs.length <= 1) {
    toast("Tenés que tener al menos un servicio.");
    return;
  }
  S.edSvcs.splice(+el.dataset.i, 1);
  render();
  return;
});
registerClick("publicar", (ev, el, act) => {
  const text = ($("#postTxt") || {}).value || "";
  if (!text.trim()) {
    toast("Escribí un mensaje primero");
    return;
  }
  api.m.post(text.trim().slice(0, 400));
  toast(`Aviso enviado a ${store.COMM.followers} seguidores`);
  render();
});
registerClick("responder", (ev, el, act) => {
  const index = +el.dataset.i;
  const text = ($("#rep" + index) || {}).value || "";
  if (!text.trim()) {
    toast("Escribí tu respuesta.");
    return;
  }
  store.COMM.reviews[index].reply = text.trim().slice(0, 600);
  api.m.reply(store.COMM.reviews[index]);
  toast("Respuesta publicada");
  render();
});
registerClick("mpConnect", (ev, el, act) => {
  if (LIVE) {
    api.m.mpConnect().catch((err) => toast(errMsg(err)));
    return;
  }
  S.mp = "auth";
  render();
});
registerClick("mpCancel", (ev, el, act) => {
  S.mp = "none";
  render();
});
registerClick("mpOk", (ev, el, act) => {
  S.mp = "ok";
  toast("Mercado Pago conectado");
  render();
});
// Desconectar (Bloque 1, H23): primero se explica qué pasa; recién al confirmar se desconecta de verdad en la base
registerClick("mpDesc", (ev, el, act) => {
  S.mpAsk = true;
  render();
});
registerClick("mpAskNo", (ev, el, act) => {
  S.mpAsk = false;
  render();
});
registerClick("mpDescOk", (ev, el, act) => {
  S.mpAsk = false;
  if (LIVE) {
    api.m
      .mpDisconnect()
      .then((st) => {
        S.mpSt = st || {};
        S.mp = st && st.can_charge ? "ok" : "none";
        toast("Mercado Pago desconectado: no recibís reservas nuevas con seña hasta reconectar");
        render();
      })
      .catch(() => {}); // saved() ya avisó el error
    return;
  }
  S.mp = "none";
  toast("Mercado Pago desconectado: no recibís reservas nuevas con seña hasta reconectar");
  render();
});
// avisos de cobros del panel: "Entendido" los marca leídos
registerClick("noticesRead", (ev, el, act) => {
  (S.notices || []).forEach((notice) => (notice.read = true));
  api.m.readNotices();
  render();
});
registerChange("msv", (ev) => {
  S.manSvc = +ev.target.value;
  const client = $("#mcl").value;
  const tel = $("#mtel").value;
  render();
  $("#mcl").value = client;
  $("#mtel").value = tel;
  return;
});
// Perfil, pasos para activar el perfil (H10): número de DNI y fotos, mientras el perfil no está verificado
registerSubmit("fDni", (ev) => {
  const dni = $("#dniN").value.trim();
  if (!/^\d{7,8}$/.test(dni)) {
    toast(errMsg("bad_dni"));
    return;
  }
  api.m
    .setDni(dni)
    .then(() => {
      S.dniSt = Object.assign({}, S.dniSt, { number: true });
      toast("Guardamos tu DNI.");
      render();
    })
    .catch(() => {});
  return;
});
const dniPhoto = (side, key) => (ev) => {
  const file = ev.target.files[0];
  if (!file) {
    return;
  }
  api.m
    .uploadDni(side, file)
    .then(() => {
      S.dniSt = Object.assign({}, S.dniSt, { [key]: true });
      toast("Recibimos la foto. Te avisamos cuando esté verificado.");
      render();
    })
    .catch(() => {});
  return;
};
registerChange("dniFront", dniPhoto("frente", "front"));
registerChange("dniBack", dniPhoto("dorso", "back"));
registerChange("upPhoto", (ev) => {
  onPhoto(ev.target, "pro");
  return;
});
// subir trabajos: se muestran al instante (URL local) y se suben de fondo, hasta 10 de 15 MB
registerChange("upMedia", (ev) => {
  [...ev.target.files].slice(0, 10).forEach((file) => {
    if (file.size > 15728640) {
      toast("Máximo 15 MB por archivo");
      return;
    }
    const media = {
      label: file.name.slice(0, 80),
      url: URL.createObjectURL(file),
      video: file.type.startsWith("video"),
    };
    store.COMM.media.unshift(media);
    api.m
      .upload(file, media)
      .then(render)
      .catch(() => {});
  });
  toast("Publicado en tus trabajos");
  render();
});
// tarjetas de sellos: cada servicio marcado necesita su meta de 15 a 20 (y en vivo, estar guardado)
registerSubmit("fStamps", (ev) => {
  const prov = pr(ME());
  const stamps = stampCfg(ME());
  const showErr = (msg) => {
    $("#sterr").textContent = msg;
  };
  const on = $("#stOn").checked;
  if (!prov.svcs.length) {
    return showErr("Cargá al menos un servicio en Mis datos.");
  }
  const goals = {};
  let invalid = false;
  document.querySelectorAll("[data-sts]").forEach((box) => {
    if (!box.checked) {
      return;
    }
    const svc = prov.svcs[+box.dataset.sts];
    const goal = +(document.querySelector(`[data-stg="${box.dataset.sts}"]`) || {}).value;
    if (svc) {
      if (LIVE && !svc[4]) {
        invalid = true;
        return;
      }
      if (!(goal >= 15) || !(goal <= 20)) {
        invalid = true;
        return;
      }
      goals[skey(svc)] = goal;
    }
  });
  if (invalid) {
    return showErr(LIVE ? "Guardá primero tus servicios en Mis datos." : "Cada tarjeta lleva de 15 a 20 sellos.");
  }
  if (on && !Object.keys(goals).length) {
    return showErr("Elegí al menos un servicio que sume sello.");
  }
  stamps.on = on;
  stamps.goals = goals;
  api.m.saveSettings(cfg(ME()));
  api.m.saveStampGoals(prov, goals);
  const count = Object.keys(goals).length;
  toast(on ? `Tarjetas activas en ${count} servicio${count > 1 ? "s" : ""}.` : "Tarjetas de sellos desactivadas.");
  render();
  return;
});
// datos y servicios del perfil: valida el editor y guarda; removed = servicios que se sacaron (quedan inactivos)
registerSubmit("fDatos", (ev) => {
  const prov = pr(ME());
  const showErr = (msg) => {
    $("#derr").textContent = msg;
  };
  const numErr = svcEditorError();
  if (numErr) {
    return showErr(numErr);
  }
  readSvcEditor();
  const name = $("#dn").value.trim();
  if (name.length < 2) {
    return showErr("El nombre visible tiene que tener al menos 2 letras.");
  }
  if (!S.edCats.length) {
    return showErr("Elegí al menos un rubro.");
  }
  const bad = S.edSvcs.findIndex(
    (svc) =>
      svc[0].length < 2 ||
      svc[1] < 5 ||
      svc[1] > 480 ||
      svc[2] <= 0 ||
      (svc[5] && svc[5].add.some((addon) => addon[0].length < 2)),
  );
  if (bad >= 0) {
    return showErr(
      `Revisá el servicio ${bad + 1}: nombre, minutos (5 a 480), precio y nombres de los adicionales.`,
    );
  }
  const emptyCats = S.edCats.filter((cat) => !S.edSvcs.some((svc) => svc[3] === cat));
  if (emptyCats.length) {
    return showErr(`Agregá al menos un servicio de ${emptyCats.map(catName).join(", ")} o quitá ese rubro.`);
  }
  const removed = prov.svcs.map((svc) => svc[4]).filter((id) => id && !S.edSvcs.some((svc) => svc[4] === id));
  prov.name = name.slice(0, 80);
  prov.bio = $("#dd").value.trim().slice(0, 600);
  prov.addr = $("#da").value.trim().slice(0, 160);
  prov.ig = $("#di").value.trim().slice(0, 60);
  const before = prov.svcs.map((svc) => svc.slice());
  prov.cats = S.edCats.slice();
  prov.svcs = S.edSvcs.map((svc) => {
    const copy = svc.slice();
    copy[5] &&= {
      every: copy[5].every,
      note: copy[5].note,
      add: copy[5].add.map((addon) => addon.slice()),
    };
    return copy;
  });
  prov.before = before;
  S.edSvcs = null;
  S.svc = 0;
  S.list = null;
  S.counts = null;
  if (!prov.cats.includes(S.pctx)) {
    S.pctx = null;
  }
  api.m.saveProfile(prov, removed).catch(() => {});
  toast("Datos guardados. Ya se ven en tu perfil.");
  render();
  return;
});
