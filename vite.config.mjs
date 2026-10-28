// TuTiempo · Vite
//   npm run dev         → servidor local con recarga; la demo y los ganchos de prueba están disponibles
//   npm run build       → dist/ para Hostinger: solo en vivo (liveApi), sin demo ni ganchos de prueba
//   npm run build:test  → dist-test/: lo mismo que producción, más la demo y los ganchos (lo usan las pruebas)
// config.js no se genera: en dist/ se copia config.example.js solo si config.js no existe, para no pisar las claves reales.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, normalizePath } from "vite";

// Rutas del sistema con fileURLToPath (en Windows, new URL(...).pathname da "/C:/…" y termina en "C:\C:\…"). Los ids
// de los módulos de Vite usan siempre "/", también en Windows: se comparan con normalizePath.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ROOT_ID = normalizePath(ROOT);

export default defineConfig(({ command, mode }) => {
  const conDemo = command === "serve" || mode === "test";
  const outDir = mode === "test" ? "dist-test" : "dist";
  let out; // carpeta de salida real (puede venir cambiada desde la línea de comandos o desde una prueba)
  return {
    define: {
      "import.meta.env.VITE_DEMO": JSON.stringify(conDemo),
      "import.meta.env.VITE_TEST_HOOKS": JSON.stringify(conDemo),
    },
    build: {
      outDir,
      // no se vacía la carpeta entera: ahí puede estar el config.js real (lo viejo se borra en limpiarSalida)
      emptyOutDir: false,
      rolldownOptions: {
        // el código viene del app.cjs minificado del cliente, con comentarios /* @__PURE__ */ en lugares que Rolldown ignora
        checks: { invalidAnnotation: false },
      },
    },
    plugins: [
      {
        // Bloque C: /sw.js (el service worker) desde src/pwa/sw.js, con la versión y los archivos de este build: los JS y
        // CSS con hash, la pantalla sin conexión, el manifest y los íconos. La versión sale del contenido: el mismo build da
        // el mismo sw.js (no hay actualización), uno distinto da otro (el navegador instala el nuevo y borra la caché vieja).
        name: "tutiempo:pwa",
        apply: "build",
        generateBundle(_, bundle) {
          const pub = path.join(ROOT, "public");
          const assets = Object.values(bundle).map((f) => f.fileName).filter((n) => /^assets\/.+\.(js|css)$/.test(n)).sort();
          const icons = fs.readdirSync(path.join(pub, "icons")).filter((f) => f.endsWith(".png")).sort().map((f) => "icons/" + f);
          const files = [...assets, "offline.html", "offline.js", "manifest.webmanifest", ...icons].map((f) => "/" + f);
          const template = fs.readFileSync(path.join(ROOT, "src", "pwa", "sw.js"), "utf8");
          const hash = crypto.createHash("sha256").update(template).update(files.join("\n"));
          for (const f of ["offline.html", "offline.js", "manifest.webmanifest", ...icons]) hash.update(fs.readFileSync(path.join(pub, f)));
          const source = template.replace("__VERSION__", hash.digest("hex").slice(0, 16)).replace("__PRECACHE__", JSON.stringify(files));
          this.emitFile({ type: "asset", fileName: "sw.js", source });
        },
      },
      {
        // Producción: src/demo/index.js (barra, datos de ejemplo y reinicio de la demo) se reemplaza por un módulo vacío.
        name: "tutiempo:sin-demo",
        enforce: "pre",
        async resolveId(source, importer, options) {
          if (conDemo || !source.endsWith("/demo/index.js")) return null;
          const r = await this.resolve(source, importer, { ...options, skipSelf: true });
          return r && normalizePath(r.id) === ROOT_ID + "/src/demo/index.js" ? "\0tutiempo-demo-vacia" : null;
        },
        load(id) {
          return id === "\0tutiempo-demo-vacia" ? "export {};" : null;
        },
      },
      {
        name: "tutiempo:salida",
        apply: "build",
        configResolved(c) {
          out = path.resolve(c.root, c.build.outDir);
        },
        buildStart() {
          // lo que generaba el build anterior (y el de tools/build.mjs): todo menos config.js
          for (const f of ["assets", "index.html", "app.js", "app.css", "fonts", "vendor", ".htaccess", "robots.txt", "sw.js", "manifest.webmanifest", "offline.html", "offline.js", "icons"]) {
            fs.rmSync(path.join(out, f), { recursive: true, force: true });
          }
        },
        generateBundle(_, bundle) {
          // qué módulos de src/ entran al build (lo revisa pruebas/sin_demo.mjs)
          const modulos = {};
          for (const chunk of Object.values(bundle)) {
            if (chunk.type !== "chunk") continue;
            for (const [id, info] of Object.entries(chunk.modules)) {
              const mid = normalizePath(id);
              if (mid.startsWith(ROOT_ID + "/")) modulos[mid.slice(ROOT_ID.length + 1)] = { bytes: info.renderedLength, codigo: info.code };
            }
          }
          fs.mkdirSync(path.join(ROOT, ".build"), { recursive: true });
          fs.writeFileSync(path.join(ROOT, ".build", `modulos-${path.basename(out)}.json`), JSON.stringify(modulos, null, 2) + "\n");
        },
        closeBundle() {
          fs.mkdirSync(out, { recursive: true });
          fs.rmSync(path.join(out, "config.example.js"), { force: true });
          if (!fs.existsSync(path.join(out, "config.js"))) fs.copyFileSync(path.join(ROOT, "public", "config.example.js"), path.join(out, "config.js"));
        },
      },
    ],
  };
});
