import { esc } from "../../lib/dom.js";
import { MESES, NOW } from "../../lib/fechas.js";
import { CAT, catInfo } from "../../lib/rubros.js";
import { S } from "../../state.js";
import { admBal } from "./balance.js";
import { admCom } from "./comision.js";
import { admData } from "./datos.js";
import { admProv } from "./prestadores.js";
import { admRes } from "./resumen.js";

export function vAdmin() {
  const e = admData();
  if (!e) {
    return `<div class="narrow stack" style="margin-top:20px"><h1 class="h1">Panel de TuTiempo</h1>${S.admErr ? '<div class="panel"><b>No tenés permiso de administrador.</b></div>' : '<div class="skel" style="min-height:300px"></div>'}</div>`;
  }
  const a = ["res", "prov", "bal", "com"].includes(S.admT) ? S.admT : "res";
  const t = e.pv.filter((n) => n.status === "pending");
  const s = NOW();
  return `<div class="narrow stack admin" style="margin-top:20px">
   <div><h1 class="h1" style="margin:0">Panel de TuTiempo</h1><p class="note" style="text-align:left;margin:4px 0 0">Olavarría · ${esc(MESES[s.getMonth()])} ${s.getFullYear()}${e.st.demo ? " · datos de ejemplo" : ""}</p></div>
   <div class="ptabs admtabs" role="tablist" aria-label="Secciones del panel">${[
     ["res", "Resumen"],
     ["prov", "Prestadores"],
     ["bal", "Balance"],
     ["com", "Comisión"],
   ]
     .map(
       ([n, o]) =>
         `<button role="tab" data-act="admT" data-t="${n}" aria-selected="${a === n}">${o}${n === "prov" && t.length ? ` <span class="tbadge">${t.length}</span>` : ""}</button>`,
     )
     .join("")}</div>
   ${a === "prov" ? admProv(e) : a === "bal" ? admBal() : a === "com" ? admCom(e) : admRes(e)}
  </div>`;
}
export const admIc = (e) => (e || []).map((a) => (CAT[a] ? catInfo(a).ic : "")).join(" ");
