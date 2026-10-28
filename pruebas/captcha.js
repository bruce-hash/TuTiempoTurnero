// H30 · CAPTCHA de Supabase Auth con Cloudflare Turnstile, en navegador real contra la base, PostgREST y e2e_server.js.
// Sin clave del sitio: la app no carga nada de Cloudflare. Con clave (e2e_server /__captcha): cada llamada a Auth (crear
// cuenta, ingresar, código, reenviar, recuperar contraseña, ingreso y alta de prestadores) manda un token nuevo, que el
// servidor valida como Supabase (una sola vez); sin token, la app avisa y no llama. La CSP del .htaccess deja cargar el
// script de challenges.cloudflare.com (lo sirve un Turnstile falso: la prueba no sale a internet).
// Uso: node pruebas/entorno_e2e.mjs dist-test -- node pruebas/captcha.js {url} {pg}   (npm run test:captcha)
const { chromium } = require("playwright");
const { Client } = require("pg");
const BASE = process.argv[2] || "http://localhost:8787";
const PG = process.argv[3];
const KEY = "1x00000000000000000000AA"; // clave de prueba de Cloudflare (con el falso no importa cuál)
let F = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) F++;
  console.log((cond ? "OK   " : "FAIL ") + name + (cond || !extra ? "" : "  → " + extra));
};
// Turnstile falso: mismo API que el real (render, reset, remove) y el onload de la URL; cada token sirve una vez
const FAKE = (pass) => `(() => {
  let n = 0; const widgets = {};
  const issue = (id) => ${pass ? 'setTimeout(() => widgets[id] && widgets[id].callback("ok-" + id + "-" + Math.random().toString(36).slice(2)), 20)' : "0"};
  window.turnstile = {
    render(el, opts) { const id = "w" + ++n; widgets[id] = opts; (window.__tt = window.__tt || []).push({ sitekey: opts.sitekey, action: opts.action, appearance: opts.appearance }); issue(id); return id; },
    reset(id) { issue(id); },
    remove(id) { delete widgets[id]; },
    getResponse() {},
  };
  const cb = new URL(document.currentScript.src).searchParams.get("onload");
  if (cb && window[cb]) window[cb]();
})();`;

(async () => {
  const db = new Client({ connectionString: PG });
  await db.connect();
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  await q("insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data) values ('capi@test.ar', 'Capi2026xx', now(), '{\"full_name\":\"Capi Tán\"}')");
  const log = async () => (await (await fetch(BASE + "/__log")).json()).filter((x) => x.captcha);
  const captcha = (key) => fetch(BASE + "/__captcha?key=" + encodeURIComponent(key));
  const browser = await chromium.launch();
  const errors = [], csp = [];
  let cloudflare = 0;
  async function nueva(pass = true) {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
    await ctx.route("https://challenges.cloudflare.com/**", (route) => {
      cloudflare++;
      route.fulfill({ status: 200, contentType: "application/javascript", body: FAKE(pass) });
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|Refused to/.test(m.text())) csp.push(m.text()); });
    return page;
  }
  const open = async (page, route) => { await page.goto(BASE + route); await page.waitForFunction(() => document.querySelector("#app").children.length); await page.waitForTimeout(400); };
  const text = (page) => page.locator("#app").innerText();
  const last = async (path) => (await log()).filter((x) => x.captcha === path).at(-1);

  // ---------- sin clave: nada de Cloudflare ----------
  let page = await nueva();
  for (const route of ["/ingresar", "/crear-cuenta", "/prestadores/ingresar", "/sumate"]) await open(page, route);
  ok("sin clave: la app no carga el script de Cloudflare ni arma recuadros", cloudflare === 0 && (await page.locator(".cf-box").count()) === 0);
  await open(page, "/prestadores/ingresar");
  await page.fill("#be", "sofia@test.ar"); await page.fill("#bp", "prestador123"); await page.click("#fBarb button[type=submit]");
  await page.waitForSelector(".bhead", { timeout: 8000 }).catch(() => {});
  ok("sin clave: el ingreso funciona como siempre (sin token)", (await page.locator(".bhead").count()) === 1 && (await log()).length === 0);
  await page.context().close();

  // ---------- con clave ----------
  await captcha(KEY);
  page = await nueva();
  await open(page, "/ingresar");
  await page.waitForFunction(() => (window.__tt || []).length > 0, null, { timeout: 5000 }).catch(() => {});
  const rendered = await page.evaluate(() => window.__tt || []);
  ok("con clave: carga Turnstile (render explícito) y arma el recuadro del ingreso", cloudflare > 0 && rendered.some((w) => w.sitekey === KEY && w.action === "flogin" && w.appearance === "interaction-only"), JSON.stringify(rendered));
  // contraseña incorrecta dos veces: cada intento con un token nuevo (si repitiera, el servidor lo rechazaría)
  for (let i = 0; i < 2; i++) {
    await page.fill("#ai_e", "capi@test.ar"); await page.fill("#ai_p", "incorrecta1"); await page.click("#fLogin button[type=submit]");
    await page.waitForTimeout(900);
  }
  const tries = (await log()).filter((x) => x.captcha === "/token");
  ok("ingresar: cada intento manda un token distinto y válido", tries.length === 2 && tries.every((x) => x.valid) && tries[0].token !== tries[1].token, JSON.stringify(tries));
  ok("ingresar: con token válido, el error es el de la contraseña", /contraseña|incorrect/i.test(await text(page)));
  await page.fill("#ai_e", "capi@test.ar"); await page.fill("#ai_p", "Capi2026xx"); await page.click("#fLogin button[type=submit]");
  await page.waitForFunction(() => window.S && S.user, null, { timeout: 8000 }).catch(() => {});
  ok("ingresar: entra con el token", await page.evaluate(() => !!(S.user && S.user.email === "capi@test.ar")) && (await last("/token")).valid);
  await page.evaluate(() => sb.auth.signOut()); await page.context().close();

  // crear cuenta, reenviar el email de activación
  page = await nueva();
  await open(page, "/crear-cuenta");
  await page.fill("#au_n", "Nueva Captcha"); await page.fill("#au_e", "nueva.captcha@test.ar"); await page.fill("#au_p", "Nueva2026xx");
  await page.check("#au_ok"); await page.click("#fSignup button[type=submit]"); await page.waitForTimeout(1200);
  ok("crear cuenta: con token, llega a Revisá tu email", (await last("/signup") || {}).valid === true && /Revisá tu email/.test(await text(page)));
  await page.waitForTimeout(300);
  await page.evaluate(() => { S.login.resendAt = 0; render(); }); await page.waitForTimeout(300);
  await page.click("[data-act=resendConfirm]"); await page.waitForTimeout(900);
  ok("reenviar el email de activación: con token", (await last("/resend") || {}).valid === true);
  // ingreso con código y reenviar código
  await open(page, "/ingresar");
  await page.click("[data-act=authMode][data-m=code]"); await page.fill("#le", "capi@test.ar"); await page.click("#fMail button[type=submit]");
  await page.waitForSelector("#lc", { timeout: 8000 }).catch(() => {});
  ok("pedir código: con token", (await last("/otp") || {}).valid === true && (await page.locator("#lc").count()) === 1);
  const otps = (await log()).filter((x) => x.captcha === "/otp").length;
  await page.evaluate(() => { S.login.resendAt = 0; render(); }); await page.waitForTimeout(300);
  await page.click("[data-act=reenviar]"); await page.waitForTimeout(900);
  const otpLog = (await log()).filter((x) => x.captcha === "/otp");
  ok("reenviar código: con un token nuevo", otpLog.length === otps + 1 && otpLog.at(-1).valid);
  // recuperar contraseña
  await open(page, "/ingresar");
  await page.click("[data-act=authMode][data-m=forgot]"); await page.fill("#af_e", "capi@test.ar"); await page.click("#fForgot button[type=submit]");
  await page.waitForTimeout(1000);
  ok("recuperar contraseña: con token", (await last("/recover") || {}).valid === true);
  await page.context().close();

  // prestadores: ingreso, recuperar contraseña y alta
  page = await nueva();
  await open(page, "/prestadores/ingresar");
  await page.fill("#be", "sofia@test.ar"); await page.fill("#bp", "prestador123"); await page.click("#fBarb button[type=submit]");
  await page.waitForSelector(".bhead", { timeout: 8000 }).catch(() => {});
  ok("ingreso de prestadores: con token", (await page.locator(".bhead").count()) === 1 && (await last("/token")).valid);
  await page.evaluate(() => sb.auth.signOut()); await page.context().close();
  page = await nueva();
  await open(page, "/prestadores/ingresar");
  await page.evaluate(() => { S.blogin.step = "recover"; render(); }); await page.waitForTimeout(400);
  const recovers = (await log()).filter((x) => x.captcha === "/recover").length;
  await page.fill("#re", "sofia@test.ar"); await page.click("#fRecover button[type=submit]"); await page.waitForTimeout(1000);
  ok("recuperar contraseña de prestador: con token", (await log()).filter((x) => x.captcha === "/recover").length === recovers + 1 && (await last("/recover")).valid);
  await open(page, "/sumate");
  await page.fill("#pn", "Captcha Uñas"); await page.fill("#pe", "alta.captcha@test.ar"); await page.fill("#pp", "Alta2026xx"); await page.fill("#ptel", "2284 555000");
  await page.evaluate(() => { document.querySelector("#rr-u").checked = true; document.querySelector("#ptc").checked = true; });
  await page.click("#fPrest button[type=submit]"); await page.waitForTimeout(1200);
  ok("alta de prestador: con token", (await last("/signup") || {}).valid === true && /Cuenta creada/.test(await text(page)));
  await page.context().close();

  // el servidor (como Supabase) rechaza sin token: la prueba no es de mentira
  const raw = await fetch(BASE + "/auth/v1/token?grant_type=password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "capi@test.ar", password: "Capi2026xx" }) });
  ok("Auth rechaza un ingreso sin token (captcha_failed)", raw.status === 400 && /captcha/.test(await raw.text()));

  // ---------- Cloudflare no da token: la app avisa y no llama a Auth ----------
  page = await nueva(false);
  await open(page, "/ingresar");
  const before = (await log()).length;
  await page.fill("#ai_e", "capi@test.ar"); await page.fill("#ai_p", "Capi2026xx"); await page.click("#fLogin button[type=submit]");
  await page.waitForTimeout(9500);
  ok("sin token: avisa \"Completá la verificación de seguridad\" y no llama a Auth", /Completá la verificación de seguridad/.test(await text(page)) && (await log()).length === before);
  await page.context().close();

  await captcha("");
  ok("sin errores de JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
  ok("sin bloqueos de la CSP", csp.length === 0, csp.slice(0, 2).join(" | "));
  await browser.close(); await db.end();
  console.log(F ? `${F} FALLAS` : "TODO OK");
  process.exit(F ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
