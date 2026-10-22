// Mapa de la mudanza del Bloque A1: a qué módulo va cada sentencia de primer nivel del <script> de
// src/prototipo.html en el commit de referencia. Las claves son el nombre declarado o "@<línea>" para las
// sentencias sin nombre (líneas del archivo en REFERENCIA). Lo usa tools/mudanza/mudanza.mjs.
export const REFERENCIA = "1368349";

export const MODULOS = {
  "src/lib/compat.js": ["W", "U", "J", "Q", "Y", "H"],
  "src/lib/dinero.js": ["COMISION", "pctTxt", "money", "mustPayTotal", "payNow", "feeFor"],
  "src/lib/dom.js": ["$", "esc", "ini", "safeRedirect"],
  "src/lib/rubros.js": ["CATS", "CAT", "@1157", "catInfo", "catName", "pcat", "RAMP", "RUBRO", "@1334"],
  "src/lib/servicios.js": ["META", "svcMeta", "rq", "selAdds", "selPrice", "selDur", "dueRetouches", "PREP", "intakeAlerts"],
  "src/lib/prestadores.js": ["pr", "ME", "ph", "minPrice", "avatar", "p0cat", "FOLLOW", "isFol", "norm", "activity", "rot"],
  "src/lib/fechas.js": [
    "DOW", "pad", "NOW", "dkey", "addDays", "TODAY", "toMin", "fromMin", "dayLabel", "longLabel", "MESES", "hoursUntil",
    "prevMonthDay", "_fmt", "isoToLocal", "localToIso", "minsBetween", "daysAgo", "relDate", "nowHM", "capW", "dm", "dmy",
    "dmyIso", "DIAS", "dayWord",
  ],
  "src/lib/turnero.js": [
    "R", "dayCfg", "skey", "defCfg", "ranges", "rangesTxt", "CFGS", "BOOK", "WAIT", "BID", "CLIENTS", "SID", "cfg", "cli",
    "uname", "isDayBlock", "busy", "overlaps", "happyAt", "slotsFor", "freeCount", "nextFree", "priceAt", "seriesDates", "freed",
  ],
  "src/lib/saldo.js": ["CASHBACK", "cbOf", "wMove", "walletPay", "applyPay", "refundPay", "walletBox", "walletPanel"],
  "src/lib/errores.js": ["ERRS", "errMsg"],
  "src/lib/validar.js": ["PWRULE", "pwScore", "pwOk", "EMAIL"],
  "src/lib/imagenes.js": ["shrinkImage", "onPhoto"],
  "src/lib/sesion.js": ["afterLogin", "saveAfter", "authErr"],
  "src/config.js": ["CFG", "LIVE", "sb", "CITY", "TZ", "PAGE"],
  "src/state.js": ["fresh", "S"],
  "src/api/saved.js": ["call", "saved"],
  "src/api/mapeo.js": ["upsertP", "svcsFromDb", "cfgFromDb", "cfgToDb"],
  "src/api/demo.js": ["demoApi"],
  "src/api/live/index.js": ["liveApi", "LM"],
  "src/api/index.js": ["api"],
  "src/ui/iconos.js": ["LOGO", "GLOGO"],
  "src/ui/render.js": ["nav", "segNow", "render", "renderInner", "renderMain", "go"],
  "src/ui/toast.js": ["toast", "notif"],
  "src/ui/picker.js": ["relBadge", "vPicker"],
  "src/ui/bookbar.js": ["bookBar", "misTurnosHtml"],
  "src/ui/tarjetas.js": ["cardInfo"],
  "src/ui/resenas.js": ["stars", "rating", "gallery", "reviewsHtml"],
  "src/ui/fotos.js": ["mediaUrl", "avatarUrl", "photoPicker"],
  "src/ui/sellos.js": [
    "stampCfg", "stampGoal", "stampEarns", "stampSvcs", "svcByKey", "myStamps", "setMyStamps", "cliStamps", "setCliStamps",
    "cliBest", "stampGrid", "stampBox", "myCards", "stampCard",
  ],
  "src/views/cliente/home.js": ["myUpcoming", "listKey", "loadList", "loadCounts", "vHome"],
  "src/views/cliente/perfil.js": ["ensureProvider", "vPerfil", "rateForm"],
  "src/views/cliente/historias.js": ["STORY_T", "vStory", "storyTick"],
  "src/views/cliente/checkout.js": ["vCheckoutTurno"],
  "src/views/cliente/turno.js": ["vTurnoOk"],
  "src/views/cliente/mis-turnos.js": ["vMisTurnosBase", "vMisTurnosCards", "vMisTurnos"],
  "src/views/cliente/cuenta.js": ["delBox", "vCuenta"],
  "src/views/auth/campos.js": ["pwField", "authHead"],
  "src/views/auth/login.js": ["vLogin"],
  "src/views/auth/contrasena-nueva.js": ["vNewPass"],
  "src/views/auth/acceso-prestadores.js": ["vLoginBarbero"],
  "src/views/auth/alta-prestador.js": ["vRegPrest"],
  "src/views/legal/terminos.js": ["vTerminos"],
  "src/views/prestador/panel.js": ["STORE", "demoClosings", "seedStore", "useProvider", "BTABS", "selectBtab", "vBarbero"],
  "src/views/prestador/agenda.js": ["vBAgendaT", "detailCard", "vManualForm", "vBlockForm"],
  "src/views/prestador/caja.js": ["MEDIOS", "vCaja"],
  "src/views/prestador/finanzas.js": [
    "FIN", "GASTOS", "GID", "CLOSINGS", "ymk", "feeOf", "YEARS", "dayLines", "finTot", "closeDay", "todayFin", "monthTotals",
    "vBFinanzas", "vCajaDia", "vFinMes", "vFinAnio",
  ],
  "src/views/prestador/clientes.js": [
    "demoLinkClients", "realClients", "thisMonthBday", "lastTxt", "vBClientes", "vAddContact", "fichaFields", "vFicha",
  ],
  "src/views/prestador/mensajes.js": [
    "MSG_DEF", "MSGS", "MSG_TPL", "msgGroup", "updMsgCount", "myLink", "fillMsg2", "inApp", "vMsgCompose", "vMsgDone",
    "fillMsg", "vMensajes", "provMsgs", "fillTpl", "pushNotice",
  ],
  "src/views/prestador/productos.js": ["PRODS", "soldToday", "vBProductos"],
  "src/views/prestador/horarios.js": ["PRESETS", "DNAME", "vBHorarios"],
  "src/views/prestador/bloqueo-dias.js": ["vDayBlocks", "blockDays", "pushCancel"],
  "src/views/prestador/estadisticas.js": [
    "OCCD", "MTOT", "workHours", "occAt", "dayOcc", "occCls", "weekStart", "patt", "quietWindows", "SMAX", "vBStats", "lowWindows",
  ],
  "src/views/prestador/comunidad.js": ["WORKS", "seedComm", "comm", "vBComunidad", "qr"],
  "src/views/prestador/perfil.js": ["svcEditor", "svcOpts", "readSvcEditor", "vBPerfil"],
  "src/views/admin/admin.js": ["vAdmin", "admIc"],
  "src/views/admin/datos.js": ["admFin", "admData"],
  "src/views/admin/resumen.js": ["admRes"],
  "src/views/admin/prestadores.js": ["ACT_LEVELS", "admProv"],
  "src/views/admin/ficha.js": ["admFile"],
  "src/views/admin/balance.js": ["Z5", "admBal", "admBalMonth"],
  "src/views/admin/comision.js": ["admCom"],
  "src/actions/reserva.js": ["liveBook", "readIntake"],
  "src/actions/alta-prestador.js": ["readReg", "REGFILES", "liveRegister"],
  "src/actions/formularios.js": ["SUBMIT_AT"],
  "src/main.js": ["@4622", "boot", "@12064"],
  // Solo modo demo (desarrollo y pruebas). Ninguno de estos módulos puede llegar al build de producción.
  "src/demo/prestadores.js": ["P", "JOBS30", "@1021"],
  "src/demo/turnos.js": ["seedTurnos"],
  "src/demo/panel.js": ["seedFees", "seedExtra"],
  "src/demo/sembrar.js": ["@1907", "@3044", "@3045"],
  "src/demo/admin.js": ["demoPending0", "ADM_LAUNCH", "admHist", "admMonthDemo", "nextM", "admDemo", "admFinDemo", "admCloseDemo"],
  "src/demo/usuarios.js": ["demoUsers0", "demoInbox0", "demoStamps0", "demoStash", "demoSignIn"],
  "src/demo/estado.js": [
    "COMM", "COMMBY", "DEMO_PENDING", "DEMO_NOTES", "DEMO_AEXP", "DEMO_ACL", "AEID", "NID", "ADM_READY", "DEMO_USERS",
    "DEMO_OWNER", "DEMO_ST", "DEMO_INBOX", "DEMO_STAMPS",
  ],
  "src/demo/reiniciar.js": ["P0", "COMM0", "@11896"],
};

// Declaraciones demasiado grandes para un solo módulo: se parten por propiedades, en el mismo orden.
export const PARTIR = {
  liveApi: {
    "src/api/live/lectura.js": ["live", "counts", "listProviders", "loadProvider"],
    "src/api/live/cuenta.js": ["session", "myBookings", "wallet", "myStamps", "commission"],
    "src/api/live/admin.js": ["adminCheck", "adminLoad", "adminFinance", "myMessages", "book"],
    "src/api/live/panel.js": ["loadMine", "monthTotals", "m"],
  },
  "@4034": {
    "src/api/live/m-panel.js": [
      "markBooking", "cancelProvider", "addBooking", "delBooking", "upsertClient", "contacted", "addWalk", "delWalk",
      "setStock", "addProduct", "addExpense", "delExpense", "saveTemplate", "saveSettings", "setGoal",
    ],
    "src/api/live/m-perfil.js": ["saveProfile", "post", "reply", "upload", "uploadDni", "deleteProvider", "mpConnect"],
    "src/api/live/m-cliente.js": [
      "review", "cancelClient", "follow", "waitlist", "saveMe", "deleteAccount", "setAvatar", "setProviderPhoto", "delMedia",
      "closeCash", "reopenCash", "blockDays",
    ],
    "src/api/live/m-admin.js": [
      "adminSetCommission", "adminSetProvider", "adminAddNote", "adminDelNote", "adminDeleteProvider", "adminClose", "adminReopen",
      "adminAddExp", "adminDelExp", "adminDni", "giveStamp", "redeemStamps", "saveStampGoals", "sendMessages", "readMessages",
    ],
  },
};

// Ramas de los manejadores de click (data-act) y submit (id del formulario), por pantalla.
// change e input: solo las ramas por id; las reglas por atributo quedan en src/actions/cambios.js, en su orden.
export const ACCIONES = {
  "src/actions/navegacion.js": {
    click: [
      "recover", "salirAdmin", "salirBarbero", "exitPreview", "preview", "volver", "toast", "verPublico", "verPublicoLocal",
      "copiarLink", "seguir",
    ],
  },
  "src/actions/cliente.js": {
    click: [
      "verTodos", "reloadList", "moreList", "ptab", "story", "storyClose", "storyPrev", "storyNext", "storyBook", "goLocal",
      "inboxAll", "rateOpen", "sendReview", "refreshMine", "verTurno",
    ],
    submit: ["fSearch"],
    input: ["csearch"],
  },
  "src/actions/reserva.js": {
    click: ["reservarT", "waitlist", "useReward", "rebook", "cancelAsk", "cancelNo", "cancelYes", "reprog", "reprogCancel"],
    submit: ["fTurno"],
  },
  "src/actions/cuenta.js": {
    click: ["changePass", "toAdmin", "toPanel", "logout", "delAsk", "delNo", "delYes"],
    submit: ["fCuenta"],
    change: ["delOk", "upAv"],
  },
  "src/actions/auth.js": {
    click: ["authMode", "pwShow", "loginBack", "reenviar", "demoRecoveryLink", "resendConfirm", "google"],
    submit: ["fLogin", "fForgot", "fMail", "fCode"],
    input: ["au_p", "np1"],
  },
  "src/actions/crear-cuenta.js": { submit: ["fSignup"] },
  "src/actions/contrasena-nueva.js": { submit: ["fNewPass"] },
  "src/actions/acceso-prestadores.js": {
    click: ["bBack", "demoLogin", "googleProv", "bShow", "bRecover"],
    submit: ["fRecover", "fBarb"],
  },
  "src/actions/alta-prestador.js": { click: ["regPanel", "regGoogle"], submit: ["fPrest"], change: ["dniUp"] },
  "src/actions/prestador-agenda.js": {
    click: [
      "turnosOn", "tabPrev", "tabNext", "offerGap", "manOpen", "manClose", "blockOpen", "blockClose", "walkFromAgenda",
      "selClose", "bCancel", "bCancelNo", "bCancelYes", "bDone", "bNoShow", "bUnblock",
    ],
    submit: ["fManual", "fBlock"],
  },
  "src/actions/prestador-caja.js": {
    click: ["walkOpen", "walkClose", "walkDel", "reopenDay", "closePast", "closeAllPast"],
    submit: ["fWalk", "fCloseDay"],
    change: ["wsv"],
  },
  "src/actions/prestador-finanzas.js": {
    click: ["goMonth", "gOpen", "gClose", "gDel", "copyPrevG", "closeMonth", "unlockMonth"],
    submit: ["fGasto"],
    change: ["gcat"],
  },
  "src/actions/prestador-clientes.js": {
    click: [
      "msgOpen", "msgClose", "msgTpl", "msgPick", "msgSend", "msgOne", "contactOpen", "contactClose", "pickContact", "cliBack",
      "cliAgendar", "stampAdd", "stampRedeem", "mEdit", "mSave",
    ],
    submit: ["fContact", "fNotas"],
    change: ["msgAll"],
  },
  "src/actions/prestador-productos.js": {
    click: ["stk", "buyOpen", "buyClose", "prodOpen", "prodClose"],
    submit: ["fBuy", "fProd"],
  },
  "src/actions/prestador-horarios.js": {
    click: ["copyMon", "hhSuggest", "dbQuick", "dbAskNo", "dbConfirm", "dbCancelClose", "dbDel"],
    submit: ["fHorarios", "fDayBlock"],
  },
  "src/actions/prestador-perfil.js": {
    click: [
      "mpDesc", "mpCancel", "mpOk", "mpConnect", "cashToggle", "svcAdd", "svcDel", "svcOpts", "addNew", "addDel", "mediaDel",
      "publicar", "responder",
    ],
    submit: ["fStamps", "fDatos"],
    change: ["useW", "msv", "pf", "upPhoto", "upMedia"],
  },
  "src/actions/admin.js": {
    click: ["admT", "admV", "admG", "admF", "admOpen", "admDni", "admSet", "admNoteDel", "admDel", "admDelNo", "admDelYes"],
    submit: ["fNote", "fCom"],
    input: ["admQ"],
  },
  "src/actions/admin-balance.js": {
    click: ["admY", "admM", "admMn", "admClose", "admReopen", "admExpDel"],
    submit: ["fAdmExp"],
  },
};

// El <style> de prototipo.html, partido por líneas (1 = primera línea dentro de <style>), en el orden de la cascada.
export const CSS = [
  ["src/styles/fuentes.css", 1],
  ["src/styles/tokens.css", 14],
  ["src/styles/base.css", 150],
  ["src/styles/turnero.css", 346],
  ["src/styles/agenda.css", 409],
  ["src/styles/componentes.css", 465],
  ["src/styles/rubros.css", 565],
  ["src/styles/marketplace.css", 607],
];
