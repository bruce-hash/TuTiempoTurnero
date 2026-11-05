// Estado de la pantalla (lo que se ve y lo que se está editando). Los nombres cortos vienen del original:
// view/pid (pantalla del cliente), role (cliente, barbero = prestador, admin), btab (pestaña del panel),
// svc/day/slot/rep (la reserva en curso), me (prestador del panel).
export const fresh = () => ({
  // C02: true hasta que el enrutador resolvió la dirección y la sesión; mientras tanto solo se dibuja la carga
  booting: true,
  role: "cliente",
  view: "home",
  pid: null,
  me: 7,
  followingBy: {},
  adds: [],
  intake: {},
  rateFor: null,
  rateN: 0,
  edOpen: {},
  pctx: null,
  q: "",
  list: null,
  counts: null,
  edSvcs: null,
  user: null,
  prev: "home",
  barberAuth: false,
  // la ventana de ingreso (true: abierta) y si S.after es solo la página donde estaba (el prestador va a su Agenda)
  authModal: null,
  // 4/11 · Bloque 3: Clientes → "clientes" o "seguidores"; los huecos ofrecidos a un seguidor ("<cuenta>|día|hora") y
  // a quién se le está eligiendo un turno para ofrecer
  ctab: "clientes",
  offeredTo: {},
  offerFor: null,
  // 4/11: "Crear cuenta" en ventana encima de /ingresar: lo que tenía la página (adónde volver, acción pendiente)
  authOnPage: null,
  // 4/11: cambiar contraseña en dos pasos ("form" y "code"); la nueva queda solo en memoria hasta confirmar el código
  npStep: null,
  npNew: null,
  npResendAt: 0,
  afterSoft: false,
  login: {
    mode: "in",
    email: "",
    err: "",
  },
  // Ingreso y registro: la acción que pidió ingresar (lib/pendiente.js) y los pasos del alta guardados por prestador
  pending: null,
  setupBy: {},
  // Registrá tu negocio: el paso que se ve (0 = la cuenta; 1 a 5; "listo")
  bizStep: 0,
  biz: {},
  svc: 0,
  // celular de ejemplo de la demo (en vivo lo reemplaza el del perfil)
  form: {
    tel: "2284 555123",
  },
  btab: "agenda",
  inbox: [],
  payM: "mp",
  ptab: "svc",
  delAsk: null,
  cat: "todos",
  preview: false,
  sv: "semana",
  swk: 0,
  smo: 0,
  syr: null,
  fy: null,
  buyI: null,
  prodOpen: false,
  cf: "todos",
  cli: null,
  fp: "semana",
  goal: 15e5,
  gOpen: false,
  mEdit: null,
  manName: "",
  wk: null,
  rep: 0,
  sel: null,
  offered: {},
  seriesMsg: "",
  day: null,
  slot: null,
  reprog: null,
  turnoId: null,
  justBooked: false,
  // Paso 1 (v4): vuelta de Mercado Pago (/turno/<id>?pago=<token>): el token, el estado (checkout_status) y "mp" de la vuelta
  payToken: null,
  payStatus: null,
  payLoading: false,
  payTries: 0,
  payBack: null,
  payFromApp: false,
  payResume: null,
  // C52 (V8): el total a pagar que mostró la confirmación del turno
  payShown: null,
  // Bloque C: app instalable y notificaciones push (src/lib/pwa.js, src/lib/push.js)
  canInstall: false,
  updateReady: false,
  pwaGuide: false,
  push: { avail: "none", on: false },
  cancelAsk: false,
  aday: null,
  bAsk: null,
  manOpen: false,
  manSvc: 0,
  newT: 0,
  hErr: null,
  walk: [],
  walkOpen: false,
  mp: "none",
  // vuelta de Mercado Pago: "ok" o el motivo por el que no se conectó (mp_error de mp-oauth)
  mpBack: null,
  following: false,
  earnToday: 0,
  jobsToday: 0,
  after: null,
});
export let S = fresh();
// Reinicio de la demo: S pasa a ser un estado nuevo (los módulos que importan S ven el nuevo).
export function resetState() {
  S = fresh();
  // la app ya arrancó: un estado nuevo no vuelve a la carga del arranque (C02)
  S.booting = false;
}
