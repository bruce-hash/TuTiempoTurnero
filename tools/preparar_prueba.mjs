// Despliegue a prueba (docs/10): después de `npm run build`, deja en dist/ lo propio del sitio de prueba.
//  - config.js con los datos del Supabase de prueba (de los secretos del entorno "prueba" de GitHub; nunca la service_role)
//  - robots.txt que no deja indexar nada
//  - version.json con el commit del build: la verificación compara que Hostinger sirva este y no uno viejo
// Uso: PRUEBA_SUPABASE_URL=… PRUEBA_SUPABASE_ANON_KEY=… [PRUEBA_TURNSTILE_SITE_KEY=…] [PRUEBA_VAPID_PUBLIC_KEY=…]
//      COMMIT=<sha> node tools/preparar_prueba.mjs [carpeta, por defecto dist]
import fs from "node:fs";
import path from "node:path";

const dist = path.resolve(process.argv[2] || "dist");
const env = process.env;
const falta = (nombre) => {
  console.error(`Falta ${nombre}`);
  process.exit(1);
};
const url = (env.PRUEBA_SUPABASE_URL || "").trim();
const key = (env.PRUEBA_SUPABASE_ANON_KEY || "").trim();
const commit = (env.COMMIT || "").trim();
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) falta("PRUEBA_SUPABASE_URL (https://<ref>.supabase.co)");
if (!key) falta("PRUEBA_SUPABASE_ANON_KEY");
if (!/^[0-9a-f]{40}$/.test(commit)) falta("COMMIT (el sha del build)");
// la clave pública nunca puede ser la de servicio: las viejas son JWT con role "service_role"; las nuevas empiezan con sb_secret_
const payload = (() => {
  try {
    return JSON.parse(Buffer.from(key.split(".")[1] || "", "base64url").toString());
  } catch {
    return {};
  }
})();
if (/^sb_secret_/.test(key) || payload.role === "service_role") {
  console.error("PRUEBA_SUPABASE_ANON_KEY es una clave de servicio: tiene que ser la anon o la publishable");
  process.exit(1);
}
if (!fs.existsSync(path.join(dist, "index.html"))) falta(`el build en ${dist} (npm run build)`);

const config = {
  supabaseUrl: url,
  supabaseAnonKey: key,
  city: "olavarria",
  turnstileSiteKey: (env.PRUEBA_TURNSTILE_SITE_KEY || "").trim(),
  vapidPublicKey: (env.PRUEBA_VAPID_PUBLIC_KEY || "").trim(),
};
fs.writeFileSync(
  path.join(dist, "config.js"),
  `// TuTiempo · prueba (lo arma el despliegue automático, docs/10; no editar a mano)\nwindow.TT_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
);
fs.writeFileSync(path.join(dist, "robots.txt"), "User-agent: *\nDisallow: /\n");
fs.rmSync(path.join(dist, "sitemap.xml"), { force: true });   // el de producción no va en prueba
fs.writeFileSync(path.join(dist, "version.json"), JSON.stringify({ commit, built_at: new Date().toISOString() }) + "\n");
console.log(`dist listo para prueba: commit ${commit.slice(0, 7)}, ${url}`);
