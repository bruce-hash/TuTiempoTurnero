// Solo en los builds de desarrollo y de prueba (VITE_TEST_HOOKS): expone el estado y las funciones de la app como
// globales, igual que en el script único, para crawl.js, e2e.js y comparar.js. Producción no lo incluye.
import { store } from "./store.js";

const STORE_VARS = ["ADM_READY","AEID","BID","BOOK","CFGS","CLIENTS","CLOSINGS","COMISION","COMM","COMMBY","DEMO_ACL","DEMO_AEXP","DEMO_INBOX","DEMO_NOTES","DEMO_OWNER","DEMO_PENDING","DEMO_ST","DEMO_STAMPS","DEMO_USERS","FIN","GASTOS","GID","MSGS","MTOT","NID","OCCD","PRODS","REGFILES","SID","STORY_T","WAIT"];

export function exponerParaPruebas() {
  const modulos = import.meta.glob(["./**/*.js", "!./main.js", "!./ganchos-prueba.js", "!./demo/barra.js", "!./demo/prestadores.js", "!./demo/sembrar.js", "!./demo/estado.js", "!./demo/reiniciar.js", "!./demo/index.js"], { eager: true });
  const desde = {};
  for (const mod of Object.values(modulos)) {
    for (const name of Object.keys(mod)) {
      desde[name] = mod;
    }
  }
  const nombres = [...Object.keys(desde), ...STORE_VARS];
  const tt = {};
  for (const name of nombres) {
    const get = () => (name in desde ? desde[name][name] : store[name]);
    const set = (value) => {
      if (STORE_VARS.includes(name)) {
        store[name] = value;
      } else {
        throw new Error("No se puede reasignar " + name);
      }
    };
    Object.defineProperty(tt, name, { get, set, enumerable: true });
    if (!(name in window)) {
      Object.defineProperty(window, name, { get, set, configurable: true });
    }
  }
  window.__TT__ = tt;
}
