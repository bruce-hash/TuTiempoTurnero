// Servidor de pruebas end-to-end: imita Supabase en local.
//  /rest/v1/*      → PostgREST real (con la base y las políticas RLS reales)
//  /auth/v1/*      → Auth simulado (emite JWT firmados con el mismo secreto que PostgREST)
//  /functions/v1/* → Edge Functions simuladas (Mercado Pago "aprueba" al instante)
//  /storage/v1/*   → Storage simulado (aplica la misma regla de carpeta)
//  resto           → archivos del paquete para Hostinger, con la CSP y el fallback de direcciones del .htaccess
//                    (misma regla que Apache: pruebas/fallback.cjs)
// Uso: node e2e_server.js <carpeta web> <puerto> <jwt_secret> <pg_conn> <postgrest_url>
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const { Client } = require("pg");
const { resolver } = require("./fallback.cjs");
const [WEB, PORT, SECRET, PGCONN, PGRST] = process.argv.slice(2);
const db = new Client({ connectionString: PGCONN }); db.connect();

const b64u = (b) => Buffer.from(b).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
function sign(payload) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" })), p = b64u(JSON.stringify(payload));
  const s = b64u(crypto.createHmac("sha256", SECRET).update(h + "." + p).digest());
  return `${h}.${p}.${s}`;
}
function verify(tok) {
  try { const [h, p, s] = tok.split("."); const ok = b64u(crypto.createHmac("sha256", SECRET).update(h + "." + p).digest()) === s;
    const c = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64")); return ok && c.exp > Date.now() / 1000 ? c : null } catch { return null }
}
const ANON = sign({ role: "anon", iss: "supabase", exp: Math.floor(Date.now() / 1000) + 86400 * 30 });
const OTP = {}; // email → código
const HASH = {}, MAIL = {}; // links de email simulados: token_hash → {email, type}; último link por email
const mail = (email, type) => { const h = crypto.randomBytes(16).toString("hex"); HASH[h] = { email, type }; MAIL[email] = Object.assign(MAIL[email] || {}, { [type]: h }); return h };

async function userRow(where, val) { const r = await db.query(`select id, email, encrypted_password, raw_user_meta_data from auth.users where ${where} = $1`, [val]); return r.rows[0] }
function userObj(u) { return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: new Date().toISOString(), user_metadata: u.raw_user_meta_data || {}, app_metadata: { provider: "email" }, created_at: new Date().toISOString() } }
function session(u) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: sign({ sub: u.id, role: "authenticated", aud: "authenticated", email: u.email, exp }), token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r-" + u.id, user: userObj(u) };
}
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(obj === undefined ? "" : JSON.stringify(obj)) };
const body = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))) });
const LOG = [];
const CONFIRM = true; // igual que Supabase con "Confirm email" activado

async function auth(req, res, url) {
  const p = url.pathname.replace("/auth/v1", ""); const raw = await body(req); const j = raw.length ? JSON.parse(raw.toString() || "{}") : {};
  if (p === "/otp") { OTP[j.email] = "123456"; if (!(await userRow("email", j.email))) await db.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2)", [j.email, JSON.stringify({ full_name: j.email.split("@")[0] })]); return send(res, 200, {}) }
  if (p === "/verify" && j.token_hash) { const t = HASH[j.token_hash]; if (!t || (t.type !== j.type && !(t.type === "signup" && j.type === "email"))) return send(res, 403, { error_code: "otp_expired", msg: "Email link is invalid or has expired", message: "Email link is invalid or has expired" });
    delete HASH[j.token_hash]; if (t.type === "signup") await db.query("update auth.users set email_confirmed_at = now() where email = $1", [t.email]).catch(() => {}); return send(res, 200, session(await userRow("email", t.email))) }
  if (p === "/verify") { if (OTP[j.email] !== j.token) return send(res, 403, { error: "invalid", msg: "Token has expired or is invalid", message: "Token has expired or is invalid" }); return send(res, 200, session(await userRow("email", j.email))) }
  if (p === "/signup") { if (await userRow("email", j.email)) return send(res, 422, { msg: "User already registered", message: "User already registered" });
    await db.query("insert into auth.users (email, encrypted_password, raw_user_meta_data) values ($1,$2,$3)", [j.email, j.password, JSON.stringify(j.data || {})]);
    if (CONFIRM) { mail(j.email, "signup"); return send(res, 200, userObj(await userRow("email", j.email))) }  // como Supabase con "Confirm email": sin sesión hasta tocar el link
    return send(res, 200, session(await userRow("email", j.email))) }
  if (p === "/token") {
    const gt = url.searchParams.get("grant_type");
    if (gt === "password") { const u = await userRow("email", j.email); if (!u || u.encrypted_password !== j.password) return send(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials", message: "Invalid login credentials" }); return send(res, 200, session(u)) }
    if (gt === "refresh_token") { const u = await userRow("id", (j.refresh_token || "").slice(2)); return u ? send(res, 200, session(u)) : send(res, 400, { error: "invalid_grant" }) }
  }
  const claims = verify((req.headers.authorization || "").slice(7));
  if (p === "/user" && req.method === "GET") { if (!claims || !claims.sub) return send(res, 401, { msg: "no session" }); return send(res, 200, userObj(await userRow("id", claims.sub))) }
  if (p === "/user" && req.method === "PUT") { if (!claims || !claims.sub) return send(res, 401, {}); const u = await userRow("id", claims.sub); const md = Object.assign({}, u.raw_user_meta_data, j.data || {});
    if (j.password) { if (String(j.password).length < 8) return send(res, 422, { msg: "Password should be at least 8 characters", message: "Password should be at least 8 characters" }); await db.query("update auth.users set encrypted_password=$1 where id=$2", [j.password, claims.sub]) }
    await db.query("update auth.users set raw_user_meta_data=$1 where id=$2", [JSON.stringify(md), claims.sub]); return send(res, 200, userObj(await userRow("id", claims.sub))) }
  if (p === "/logout") return send(res, 204);
  if (p === "/recover") { if (await userRow("email", j.email)) mail(j.email, "recovery"); return send(res, 200, {}) }
  send(res, 404, { msg: "not mocked " + p });
}

async function functions(req, res, url) {
  const name = url.pathname.split("/").pop(); const claims = verify((req.headers.authorization || "").slice(7)); const j = JSON.parse((await body(req)).toString() || "{}");
  LOG.push({ fn: name, body: j });
  if (!claims || !claims.sub) return send(res, 401, { error: "login_required" });
  if (name === "mp-create-preference") {
    const r = await db.query("select coalesce(sum(deposit + client_fee - paid_wallet),0)::int as amount, coalesce(sum(client_fee),0)::int as fee, min(provider_id) as pid from public.bookings where id = any($1::bigint[]) and client_id = $2 and status = 'hold'", [j.booking_ids, claims.sub]);
    // como la función real: solo cobra la cuenta activa del prestador
    if (!(await db.query("select public.provider_can_charge($1) as ok", [r.rows[0].pid])).rows[0].ok) return send(res, 409, { error: "provider_mp_not_connected" });
    // simula que Mercado Pago aprobó el pago y llamó al webhook (con la comisión que informa MP)
    await db.query("select public.confirm_payment($1::bigint[], $2, $3, p_provider => $4, p_fee_mp => $5)", [j.booking_ids, "mp-test-" + Date.now(), r.rows[0].amount, r.rows[0].pid, r.rows[0].fee]);
    return send(res, 200, { init_point: `${req.headers.origin || "http://localhost:" + PORT}/?mp=success&b=${j.booking_ids[0]}` });
  }
  if (name === "mp-oauth") { await db.query("select public.mp_connect(id, 'mp-test-' || id, 'TEST-token', null, 15552000) from public.providers where owner_id=$1 and status<>'deleted'", [claims.sub]); return send(res, 200, { url: `/?mp_connected=1` }) }
  send(res, 404, {});
}

async function storage(req, res, url) {
  const claims = verify((req.headers.authorization || "").slice(7)); await body(req);
  const m = url.pathname.match(/^\/storage\/v1\/object\/(media|dni|avatars)\/(.+)$/);
  if (req.method === "POST" && m) {
    if (!claims || !claims.sub) return send(res, 403, { message: "unauthorized" });
    const folder = m[2].split("/")[0];
    const r = m[1] === "media" ? await db.query("select id::text from public.providers where owner_id=$1 and status<>'deleted'", [claims.sub]) : { rows: [{ id: claims.sub }] };
    if (!r.rows[0] || r.rows[0].id !== folder) return send(res, 403, { message: "new row violates row-level security policy" });
    LOG.push({ upload: m[1] + "/" + m[2] }); return send(res, 200, { Key: m[1] + "/" + m[2] });
  }
  if (req.method === "GET") { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(Buffer.from("89504e470d0a1a0a", "hex")) }
  send(res, 404, {});
}

function proxy(req, res, url) {
  const target = new URL(PGRST + url.pathname.replace("/rest/v1", "") + url.search);
  const headers = { ...req.headers }; delete headers.host;
  const auth = (headers.authorization || "").slice(7); if (!verify(auth)) headers.authorization = "Bearer " + ANON;
  const pr = http.request(target, { method: req.method, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) });
  pr.on("error", (e) => send(res, 502, { message: e.message })); req.pipe(pr);
}

const HT = fs.readFileSync(path.join(WEB, ".htaccess"), "utf8");
const CSP = HT.match(/Content-Security-Policy "([^"]+)"/)[1].replace(/https:\/\/\*\.supabase\.co/g, "").replace(/wss:\/\/\*\.supabase\.co/g, "").replace("upgrade-insecure-requests", "");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".cjs": "application/javascript", ".css": "text/css", ".woff2": "font/woff2", ".txt": "text/plain" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/__log") return send(res, 200, LOG);
    if (url.pathname === "/__mail") return send(res, 200, MAIL[url.searchParams.get("email")] || {});
    if (url.pathname.startsWith("/rest/v1")) return proxy(req, res, url);
    if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url);
    if (url.pathname.startsWith("/functions/v1")) return await functions(req, res, url);
    if (url.pathname.startsWith("/storage/v1")) return await storage(req, res, url);
    const f = url.pathname;
    if (f === "/config.js" || f === "/config.cjs") { res.writeHead(200, { "Content-Type": "application/javascript" }); return res.end(`window.TT_CONFIG={supabaseUrl:"http://localhost:${PORT}",supabaseAnonKey:"${ANON}",city:"olavarria"};`) }
    const { status, file: fp } = resolver(WEB, f);
    if (!fp) { res.writeHead(status, { "Content-Security-Policy": CSP }); return res.end("no") }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(fp)] || "application/octet-stream", "Content-Security-Policy": CSP });
    fs.createReadStream(fp).pipe(res);
  } catch (e) { console.error(e); send(res, 500, { message: e.message }) }
}).listen(+PORT, () => console.log("e2e server on " + PORT + " anon=" + ANON.slice(0, 20)));
