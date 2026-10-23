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

registerClick("msgOpen", (ev, el, act) => {
  const names = realClients();
  const preset = el.dataset.pre;
  const sel = {};
  if (preset === "recuperar") {
    names.filter((name) => store.CLIENTS[name].last >= 35).forEach((name) => (sel[name] = true));
  }
  S.msg = {
    tpl: "extrano",
    txt: MSG_TPL[0][2],
    sel: sel,
  };
  S.msgOpen = true;
  S.contactOpen = false;
  render();
  return;
});
registerClick("msgClose", (ev, el, act) => {
  S.msgOpen = false;
  S.msg = null;
  render();
  return;
});
registerClick("msgTpl", (ev, el, act) => {
  const tpl = MSG_TPL.find((row) => row[0] === el.dataset.k);
  S.msg.tpl = tpl[0];
  S.msg.txt = tpl[2];
  render();
  return;
});
registerClick("msgPick", (ev, el, act) => {
  const group = el.dataset.k;
  S.msg.txt = ($("#msgTxt") || {}).value || S.msg.txt;
  const members = msgGroup(group);
  if (!members.length) {
    toast("No hay clientes en ese grupo.");
    return;
  }
  const allIn = members.every((name) => S.msg.sel[name]);
  members.forEach((name) => {
    if (allIn) {
      delete S.msg.sel[name];
    } else {
      S.msg.sel[name] = true;
    }
  });
  toast(allIn ? `Sacaste ${members.length} de la lista.` : `Agregaste ${members.length} a la lista.`);
  render();
  return;
});
// mensaje a los clientes elegidos: solo les llega a los que tienen la app (en vivo, por la base;
// en la demo, solo a la cuenta de ejemplo “Juan P.”)
registerClick("msgSend", (ev, el, act) => {
  const msg = S.msg;
  msg.txt = (($("#msgTxt") || {}).value || msg.txt).trim();
  const errBox = $("#msgErr");
  if (msg.txt.length < 2 || msg.txt.length > 500) {
    if (errBox) {
      errBox.textContent = "Escribí un mensaje (hasta 500 letras).";
    }
    return;
  }
  const selected = realClients().filter((name) => msg.sel[name]);
  if (!selected.length) {
    return;
  }
  const withApp = selected.filter(inApp);
  const withoutApp = selected.length - withApp.length;
  const done = (sent) => {
    msg.done = {
      app: sent,
      none: selected.length - sent,
    };
    selected.forEach((name) => (store.CLIENTS[name].contacted = true));
    render();
  };
  const body = msg.txt.replace(/\{negocio\}/g, pr(ME()).name).replace(/\{link\}/g, myLink());
  if (LIVE) {
    const ids = withApp.map((name) => store.CLIENTS[name].id).filter(Boolean);
    if (!ids.length) {
      done(0);
      return;
    }
    el.disabled = true;
    api.m
      .sendMessages(ids, body)
      .then((res) => done((res && res.sent) || 0))
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  withApp.forEach((name) => {
    if (name === "Juan P.") {
      store.DEMO_INBOX.unshift({
        id: Date.now(),
        pid: ME(),
        name: pr(ME()).name,
        photo: pr(ME()).photo,
        hue: pr(ME()).hue,
        body: fillMsg2(msg.txt, name),
        d: "recién",
        read: false,
      });
    }
  });
  done(withApp.length);
  return;
});
registerClick("msgOne", (ev, el, act) => {
  const name = S.cli;
  if (!name || !inApp(name)) {
    return;
  }
  S.msg = {
    tpl: "extrano",
    txt: MSG_TPL[0][2],
    sel: {
      [name]: true,
    },
  };
  S.msgOpen = true;
  S.contactOpen = false;
  S.cli = null;
  render();
  window.scrollTo(0, 0);
  return;
});
registerClick("contactOpen", (ev, el, act) => {
  S.contactOpen = true;
  S.msgOpen = false;
  S.newC = {};
  render();
  return;
});
registerClick("contactClose", (ev, el, act) => {
  S.contactOpen = false;
  render();
  return;
});
registerClick("pickContact", (ev, el, act) => {
  navigator.contacts
    .select(["name", "tel"], {
      multiple: false,
    })
    .then((picked) => {
      const contact = picked && picked[0];
      if (contact) {
        S.newC = {
          n: ((contact.name || [])[0] || "").slice(0, 80),
          t: ((contact.tel || [])[0] || "").slice(0, 20),
        };
        render();
      }
    })
    .catch(() => {});
  return;
});
// sumar un sello a mano (en la demo, uno por día y servicio)
registerClick("stampAdd", (ev, el, act) => {
  const name = S.cli;
  const client = store.CLIENTS[name];
  const svc = svcByKey(pr(ME()), el.dataset.sk);
  if (!name || !client || !svc) {
    return;
  }
  const goal = stampGoal(ME(), svc);
  if (LIVE) {
    el.disabled = true;
    api.m
      .giveStamp(client, svc[4])
      .then((res) => {
        setCliStamps(name, svc, (res && res.stamps) || cliStamps(name, svc) + 1);
        toast("Sello sumado");
        render();
      })
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  S.stampDay = S.stampDay || {};
  const dayKey = ME() + "|" + name + "|" + skey(svc);
  if (S.stampDay[dayKey] === TODAY()) {
    toast("Ya le sumaste un sello a mano hoy en este servicio.");
    return;
  }
  S.stampDay[dayKey] = TODAY();
  const have = cliStamps(name, svc) + 1;
  setCliStamps(name, svc, have);
  toast(`Sello sumado en ${svc[0]}: ${Math.min(have, goal)}/${goal}${have >= goal ? " · ¡ya tiene su premio!" : ""}`);
  render();
  return;
});
// canjear el premio pide un segundo toque en menos de 3 segundos
registerClick("stampRedeem", (ev, el, act) => {
  const name = S.cli;
  const client = store.CLIENTS[name];
  const svc = svcByKey(pr(ME()), el.dataset.sk);
  if (!name || !client || !svc) {
    return;
  }
  const goal = stampGoal(ME(), svc);
  const askKey = name + "|" + skey(svc);
  if (S.redeemAsk !== askKey) {
    S.redeemAsk = askKey;
    toast("Tocá de nuevo para canjear el premio");
    setTimeout(() => {
      S.redeemAsk = null;
    }, 3e3);
    return;
  }
  S.redeemAsk = null;
  if (LIVE) {
    el.disabled = true;
    api.m
      .redeemStamps(client, svc[4])
      .then((res) => {
        setCliStamps(name, svc, (res && res.stamps) || 0);
        toast("Premio canjeado. ¡Que lo disfrute!");
        render();
      })
      .catch(() => {
        el.disabled = false;
      });
    return;
  }
  setCliStamps(name, svc, cliStamps(name, svc) - goal);
  toast("Premio canjeado. ¡Que lo disfrute!");
  render();
  return;
});
registerClick("cliBack", (ev, el, act) => {
  S.cli = null;
  render();
});
registerClick("cliAgendar", (ev, el, act) => {
  S.manName = S.cli;
  S.cli = null;
  S.btab = "agenda";
  S.aday = S.aday || TODAY();
  S.manOpen = true;
  S.blockOpen = false;
  S.manSvc = 0;
  render();
  const form = $("#fManual");
  if (form && form.scrollIntoView) {
    form.scrollIntoView({
      block: "nearest",
    });
  }
});
registerClick("mEdit", (ev, el, act) => {
  const index = +el.dataset.i;
  S.mEdit = S.mEdit === index ? null : index;
  render();
});
registerClick("mSave", (ev, el, act) => {
  const index = +el.dataset.i;
  const text = $("#mtx" + index).value.trim();
  if (!text) {
    toast("El mensaje no puede quedar vacío");
    return;
  }
  store.MSGS[index].txt = text;
  api.m.saveTemplate(store.MSGS[index]);
  S.mEdit = null;
  toast("Mensaje guardado");
  render();
});
registerChange("msgAll", (ev) => {
  const on = ev.target.checked;
  realClients().forEach((name) => {
    S.msg.sel[name] = on;
  });
  document.querySelectorAll("[data-mc]").forEach((box) => (box.checked = on));
  updMsgCount();
  return;
});
// contacto agregado a mano; el cumpleaños DD/MM se guarda como MM-DD
registerSubmit("fContact", (ev) => {
  const name = $("#nc_n").value.trim().replace(/\s+/g, " ").slice(0, 80);
  const tel = $("#nc_t").value.trim();
  const bdayText = $("#nc_b").value.trim();
  const notes = $("#nc_x").value.trim().slice(0, 300);
  const showErr = (msg) => {
    $("#ncerr").textContent = msg;
  };
  if (name.length < 2) {
    return showErr("Escribí el nombre.");
  }
  if (Object.keys(store.CLIENTS).some((other) => other.toLowerCase() === name.toLowerCase())) {
    return showErr("Ya tenés un contacto con ese nombre.");
  }
  if (tel && !/^[+\d][\d\s()-]{7,19}$/.test(tel)) {
    return showErr("Ese celular no parece válido. Ejemplo: 2284 123456.");
  }
  let bday = "";
  if (bdayText) {
    const match = bdayText.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (!match || +match[1] < 1 || +match[1] > 31 || +match[2] < 1 || +match[2] > 12) {
      return showErr("Cumpleaños con formato DD/MM, por ejemplo 22/03.");
    }
    bday = String(match[2]).padStart(2, "0") + "-" + String(match[1]).padStart(2, "0");
  }
  const client = (store.CLIENTS[name] = {
    v: 0,
    n: 0,
    last: null,
    spend: 0,
    tel: tel,
    notes: notes,
    bday: bday,
    contacted: false,
    profile: {},
    manual: true,
  });
  api.m.upsertClient(name, client).catch(() => {});
  S.contactOpen = false;
  S.newC = null;
  toast("Contacto guardado");
  render();
  return;
});
registerSubmit("fNotas", (ev) => {
  const client = store.CLIENTS[S.cli];
  const bdayText = $("#cbd").value.trim();
  if (bdayText && !/^\d{1,2}\/\d{1,2}$/.test(bdayText)) {
    $("#nerr").textContent = "Escribí el cumpleaños como día/mes, por ejemplo 22/03.";
    return;
  }
  if (bdayText) {
    const [day, month] = bdayText.split("/").map(Number);
    if (day < 1 || day > 31 || month < 1 || month > 12) {
      $("#nerr").textContent = "Esa fecha no existe.";
      return;
    }
    client.bday = pad(month) + "-" + pad(day);
  } else {
    client.bday = "";
  }
  client.profile = client.profile || {};
  fichaFields().forEach(([key]) => {
    const input = $("#cf-" + key);
    if (input) {
      client.profile[key] = input.value.trim().slice(0, 200);
    }
  });
  client.notes = $("#cnotes").value.trim().slice(0, 1e3);
  client.tel = $("#ctel").value.trim().slice(0, 40) || client.tel;
  api.m.upsertClient(S.cli, client);
  toast("Ficha guardada");
  render();
  return;
});
