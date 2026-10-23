// Misma regla que public/.htaccess (Bloque B), para los servidores de prueba (e2e_server.js, comparar.mjs, rutas.mjs):
//  - archivos ocultos (salvo .well-known) y de respaldo (.bak, .sql, .log, .ini, .sh, .md, .zip): 403
//  - un archivo que existe: ese archivo
//  - una carpeta que existe: su index.html si tiene; si no, 403 (Options -Indexes)
//  - una dirección sin extensión que no es archivo ni carpeta: index.html (el enrutador de la app muestra la pantalla)
//  - una dirección con extensión que no existe: 404 (nunca HTML en lugar de un .js o .css)
// Devuelve { status, file }: file es la ruta en disco a servir (status 200) o null.
const fs = require("fs");
const path = require("path");

function resolver(web, pathname) {
  const root = path.resolve(web);
  let clean;
  try {
    clean = decodeURIComponent(pathname);
  } catch (err) {
    return { status: 400, file: null };
  }
  if (/(^|\/)\.(?!well-known\/)/.test(clean) || /\.(bak|sql|log|ini|sh|md|zip)$/i.test(clean)) {
    return { status: 403, file: null };
  }
  const file = path.join(root, path.normalize(clean).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(root)) {
    return { status: 403, file: null };
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    return { status: 200, file };
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    const index = path.join(file, "index.html");
    return fs.existsSync(index) ? { status: 200, file: index } : { status: 403, file: null };
  }
  if (/\.[A-Za-z0-9]{1,8}$/.test(clean)) {
    return { status: 404, file: null };
  }
  return { status: 200, file: path.join(root, "index.html") };
}

module.exports = { resolver };
