import { esc } from "../../lib/dom.js";
import { MESES, NOW } from "../../lib/fechas.js";
import { CAT, catInfo } from "../../lib/rubros.js";
import { S } from "../../state.js";
import { admBal } from "./balance.js";
import { admCom } from "./comision.js";
import { admData } from "./datos.js";
import { admProv } from "./prestadores.js";
import { admRes } from "./resumen.js";

// panel del administrador con cuatro pestañas; sin datos todavía, un esqueleto (o el aviso de falta de permiso)
export function vAdmin() {
  const data = admData();
  if (!data) {
    return `<div class="narrow stack" style="margin-top:20px"><h1 class="h1">Panel de TuTiempo</h1>${S.admErr ? '<div class="panel"><b>No tenés permiso de administrador.</b></div>' : '<div class="skel" style="min-height:300px"></div>'}</div>`;
  }
  const tab = ["res", "prov", "bal", "com"].includes(S.admT) ? S.admT : "res";
  const pending = data.pv.filter((prov) => prov.status === "pending");
  const now = NOW();
  return `<div class="narrow stack admin" style="margin-top:20px">
   <div><h1 class="h1" style="margin:0">Panel de TuTiempo</h1><p class="note" style="text-align:left;margin:4px 0 0">Olavarría · ${esc(MESES[now.getMonth()])} ${now.getFullYear()}${data.st.demo ? " · datos de ejemplo" : ""}</p></div>
   <div class="ptabs admtabs" role="tablist" aria-label="Secciones del panel">${[
     ["res", "Resumen"],
     ["prov", "Prestadores"],
     ["bal", "Balance"],
     ["com", "Comisión"],
   ]
     .map(
       ([id, label]) =>
         `<button role="tab" data-act="admT" data-t="${id}" aria-selected="${tab === id}">${label}${id === "prov" && pending.length ? ` <span class="tbadge">${pending.length}</span>` : ""}</button>`,
     )
     .join("")}</div>
   ${tab === "prov" ? admProv(data) : tab === "bal" ? admBal() : tab === "com" ? admCom(data) : admRes(data)}
  </div>`;
}
// íconos de los rubros de un prestador
export const admIc = (cats) => (cats || []).map((cat) => (CAT[cat] ? catInfo(cat).ic : "")).join(" ");
