import { registerChange, registerClick, registerSubmit } from "./registro.js";
import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { $ } from "../lib/dom.js";
import { TODAY, pad } from "../lib/fechas.js";
import { ME, pr } from "../lib/prestadores.js";
import { skey } from "../lib/turnero.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { cliStamps, setCliStamps, stampGoal, svcByKey } from "../ui/sellos.js";
import { toast } from "../ui/toast.js";
import { fichaFields, realClients } from "../views/prestador/clientes.js";
import { MSG_TPL, fillMsg2, inApp, msgGroup, myLink, updMsgCount } from "../views/prestador/mensajes.js";

registerClick("msgOpen", (e, x, v) => {
  const r = realClients();
  const m = x.dataset.pre;
  const f = {};
  if (m === "recuperar") {
    r.filter((u) => store.CLIENTS[u].last >= 35).forEach((u) => (f[u] = true));
  }
  S.msg = {
    tpl: "extrano",
    txt: MSG_TPL[0][2],
    sel: f,
  };
  S.msgOpen = true;
  S.contactOpen = false;
  render();
  return;
});
registerClick("msgClose", (e, x, v) => {
  S.msgOpen = false;
  S.msg = null;
  render();
  return;
});
registerClick("msgTpl", (e, x, v) => {
  const r = MSG_TPL.find((m) => m[0] === x.dataset.k);
  S.msg.tpl = r[0];
  S.msg.txt = r[2];
  render();
  return;
});
registerClick("msgPick", (e, x, v) => {
  const r = x.dataset.k;
  S.msg.txt = ($("#msgTxt") || {}).value || S.msg.txt;
  const m = msgGroup(r);
  if (!m.length) {
    toast("No hay clientes en ese grupo.");
    return;
  }
  const f = m.every((u) => S.msg.sel[u]);
  m.forEach((u) => {
    if (f) {
      delete S.msg.sel[u];
    } else {
      S.msg.sel[u] = true;
    }
  });
  toast(f ? `Sacaste ${m.length} de la lista.` : `Agregaste ${m.length} a la lista.`);
  render();
  return;
});
registerClick("msgSend", (e, x, v) => {
  const r = S.msg;
  r.txt = (($("#msgTxt") || {}).value || r.txt).trim();
  const m = $("#msgErr");
  if (r.txt.length < 2 || r.txt.length > 500) {
    if (m) {
      m.textContent = "Escribí un mensaje (hasta 500 letras).";
    }
    return;
  }
  const f = realClients().filter((B) => r.sel[B]);
  if (!f.length) {
    return;
  }
  const u = f.filter(inApp);
  const E = f.length - u.length;
  const O = (B) => {
    r.done = {
      app: B,
      none: f.length - B,
    };
    f.forEach((F) => (store.CLIENTS[F].contacted = true));
    render();
  };
  const N = r.txt.replace(/\{negocio\}/g, pr(ME()).name).replace(/\{link\}/g, myLink());
  if (LIVE) {
    const B = u.map((F) => store.CLIENTS[F].id).filter(Boolean);
    if (!B.length) {
      O(0);
      return;
    }
    x.disabled = true;
    api.m
      .sendMessages(B, N)
      .then((F) => O((F && F.sent) || 0))
      .catch(() => {
        x.disabled = false;
      });
    return;
  }
  u.forEach((B) => {
    if (B === "Juan P.") {
      store.DEMO_INBOX.unshift({
        id: Date.now(),
        pid: ME(),
        name: pr(ME()).name,
        photo: pr(ME()).photo,
        hue: pr(ME()).hue,
        body: fillMsg2(r.txt, B),
        d: "recién",
        read: false,
      });
    }
  });
  O(u.length);
  return;
});
registerClick("msgOne", (e, x, v) => {
  const r = S.cli;
  if (!r || !inApp(r)) {
    return;
  }
  S.msg = {
    tpl: "extrano",
    txt: MSG_TPL[0][2],
    sel: {
      [r]: true,
    },
  };
  S.msgOpen = true;
  S.contactOpen = false;
  S.cli = null;
  render();
  window.scrollTo(0, 0);
  return;
});
registerClick("contactOpen", (e, x, v) => {
  S.contactOpen = true;
  S.msgOpen = false;
  S.newC = {};
  render();
  return;
});
registerClick("contactClose", (e, x, v) => {
  S.contactOpen = false;
  render();
  return;
});
registerClick("pickContact", (e, x, v) => {
  navigator.contacts
    .select(["name", "tel"], {
      multiple: false,
    })
    .then((r) => {
      const m = r && r[0];
      if (m) {
        S.newC = {
          n: ((m.name || [])[0] || "").slice(0, 80),
          t: ((m.tel || [])[0] || "").slice(0, 20),
        };
        render();
      }
    })
    .catch(() => {});
  return;
});
registerClick("stampAdd", (e, x, v) => {
  const r = S.cli;
  const m = store.CLIENTS[r];
  const f = svcByKey(pr(ME()), x.dataset.sk);
  if (!r || !m || !f) {
    return;
  }
  const u = stampGoal(ME(), f);
  if (LIVE) {
    x.disabled = true;
    api.m
      .giveStamp(m, f[4])
      .then((N) => {
        setCliStamps(r, f, (N && N.stamps) || cliStamps(r, f) + 1);
        toast("Sello sumado");
        render();
      })
      .catch(() => {
        x.disabled = false;
      });
    return;
  }
  S.stampDay = S.stampDay || {};
  const E = ME() + "|" + r + "|" + skey(f);
  if (S.stampDay[E] === TODAY()) {
    toast("Ya le sumaste un sello a mano hoy en este servicio.");
    return;
  }
  S.stampDay[E] = TODAY();
  const O = cliStamps(r, f) + 1;
  setCliStamps(r, f, O);
  toast(`Sello sumado en ${f[0]}: ${Math.min(O, u)}/${u}${O >= u ? " · ¡ya tiene su premio!" : ""}`);
  render();
  return;
});
registerClick("stampRedeem", (e, x, v) => {
  const r = S.cli;
  const m = store.CLIENTS[r];
  const f = svcByKey(pr(ME()), x.dataset.sk);
  if (!r || !m || !f) {
    return;
  }
  const u = stampGoal(ME(), f);
  const E = r + "|" + skey(f);
  if (S.redeemAsk !== E) {
    S.redeemAsk = E;
    toast("Tocá de nuevo para canjear el premio");
    setTimeout(() => {
      S.redeemAsk = null;
    }, 3e3);
    return;
  }
  S.redeemAsk = null;
  if (LIVE) {
    x.disabled = true;
    api.m
      .redeemStamps(m, f[4])
      .then((O) => {
        setCliStamps(r, f, (O && O.stamps) || 0);
        toast("Premio canjeado. ¡Que lo disfrute!");
        render();
      })
      .catch(() => {
        x.disabled = false;
      });
    return;
  }
  setCliStamps(r, f, cliStamps(r, f) - u);
  toast("Premio canjeado. ¡Que lo disfrute!");
  render();
  return;
});
registerClick("cliBack", (e, x, v) => {
  S.cli = null;
  render();
});
registerClick("cliAgendar", (e, x, v) => {
  S.manName = S.cli;
  S.cli = null;
  S.btab = "agenda";
  S.aday = S.aday || TODAY();
  S.manOpen = true;
  S.blockOpen = false;
  S.manSvc = 0;
  render();
  const r = $("#fManual");
  if (r && r.scrollIntoView) {
    r.scrollIntoView({
      block: "nearest",
    });
  }
});
registerClick("mEdit", (e, x, v) => {
  const r = +x.dataset.i;
  S.mEdit = S.mEdit === r ? null : r;
  render();
});
registerClick("mSave", (e, x, v) => {
  const r = +x.dataset.i;
  const m = $("#mtx" + r).value.trim();
  if (!m) {
    toast("El mensaje no puede quedar vacío");
    return;
  }
  store.MSGS[r].txt = m;
  api.m.saveTemplate(store.MSGS[r]);
  S.mEdit = null;
  toast("Mensaje guardado");
  render();
});
registerChange("msgAll", (e) => {
  const n = e.target.checked;
  realClients().forEach((o) => {
    S.msg.sel[o] = n;
  });
  document.querySelectorAll("[data-mc]").forEach((o) => (o.checked = n));
  updMsgCount();
  return;
});
registerSubmit("fContact", (e) => {
  const a = $("#nc_n").value.trim().replace(/\s+/g, " ").slice(0, 80);
  const t = $("#nc_t").value.trim();
  const s = $("#nc_b").value.trim();
  const n = $("#nc_x").value.trim().slice(0, 300);
  const o = (c) => {
    $("#ncerr").textContent = c;
  };
  if (a.length < 2) {
    return o("Escribí el nombre.");
  }
  if (Object.keys(store.CLIENTS).some((c) => c.toLowerCase() === a.toLowerCase())) {
    return o("Ya tenés un contacto con ese nombre.");
  }
  if (t && !/^[+\d][\d\s()-]{7,19}$/.test(t)) {
    return o("Ese celular no parece válido. Ejemplo: 2284 123456.");
  }
  let i = "";
  if (s) {
    const c = s.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!c || +c[1] < 1 || +c[1] > 31 || +c[2] < 1 || +c[2] > 12) {
      return o("Cumpleaños con formato DD/MM, por ejemplo 22/03.");
    }
    i = String(c[2]).padStart(2, "0") + "-" + String(c[1]).padStart(2, "0");
  }
  const l = (store.CLIENTS[a] = {
    v: 0,
    n: 0,
    last: null,
    spend: 0,
    tel: t,
    notes: n,
    bday: i,
    contacted: false,
    profile: {},
    manual: true,
  });
  api.m.upsertClient(a, l).catch(() => {});
  S.contactOpen = false;
  S.newC = null;
  toast("Contacto guardado");
  render();
  return;
});
registerSubmit("fNotas", (e) => {
  const a = store.CLIENTS[S.cli];
  const t = $("#cbd").value.trim();
  if (t && !/^\d{1,2}\/\d{1,2}$/.test(t)) {
    $("#nerr").textContent = "Escribí el cumpleaños como día/mes, por ejemplo 22/03.";
    return;
  }
  if (t) {
    const [s, n] = t.split("/").map(Number);
    if (s < 1 || s > 31 || n < 1 || n > 12) {
      $("#nerr").textContent = "Esa fecha no existe.";
      return;
    }
    a.bday = pad(n) + "-" + pad(s);
  } else {
    a.bday = "";
  }
  a.profile = a.profile || {};
  fichaFields().forEach(([s]) => {
    const n = $("#cf-" + s);
    if (n) {
      a.profile[s] = n.value.trim().slice(0, 200);
    }
  });
  a.notes = $("#cnotes").value.trim().slice(0, 1e3);
  a.tel = $("#ctel").value.trim().slice(0, 40) || a.tel;
  api.m.upsertClient(S.cli, a);
  toast("Ficha guardada");
  render();
  return;
});
