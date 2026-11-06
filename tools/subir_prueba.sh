#!/usr/bin/env bash
# Despliegue a prueba (docs/10): sube dist/ por FTPS a la carpeta de prueba.tutiempo.com.ar con la cuenta FTP
# restringida a esa carpeta. Antes de borrar nada, mira qué hay en la raíz de la cuenta: si aparece algo de Laravel
# (artisan, .env, vendor, public_html…), la cuenta ve más de lo que debe y no se toca nada.
# Primero los archivos nuevos (assets con hash), después index.html, sw.js, config.js y .htaccess, y recién ahí se
# borra lo viejo: la versión anterior sigue andando mientras sube la nueva.
set -euo pipefail
: "${FTP_HOST:?Falta FTP_HOST}" "${FTP_USER:?Falta FTP_USER}" "${FTP_PASSWORD:?Falta FTP_PASSWORD}"
cd "$(dirname "$0")/.."
[ -f dist/index.html ] && [ -f dist/.htaccess ] && [ -f dist/config.js ] && [ -f dist/version.json ] || { echo "::error::dist/ incompleto (npm run build y tools/preparar_prueba.mjs)"; exit 1; }
grep -q "Disallow: /" dist/robots.txt || { echo "::error::falta robots.txt con Disallow"; exit 1; }
export LFTP_PASSWORD="$FTP_PASSWORD"
conf="set ftp:ssl-force true; set ftp:ssl-protect-data true; set ssl:verify-certificate ${FTP_VERIFICAR_CERT:-yes}; set net:max-retries 3; set net:timeout 30; set net:reconnect-interval-base 5"
raiz=$(lftp -e "$conf; cls -1a /; bye" --env-password -u "$FTP_USER" "$FTP_HOST")
echo "En la raíz de la cuenta FTP hay:"; echo "$raiz" | sed 's/^/  /'
if grep -qiE '^/?(artisan|\.env|composer\.(json|lock)|vendor/?|public_html/?|storage/?|bootstrap/?|routes/?)$' <<<"$raiz"; then
  echo "::error::La cuenta FTP ve la raíz del sitio Laravel. Tiene que estar restringida a la carpeta de prueba (docs/10, paso 5). No se subió nada."
  exit 1
fi
primero="mirror -R --verbose --parallel=4 --exclude-glob index.html --exclude-glob sw.js --exclude-glob config.js --exclude-glob .htaccess --exclude-glob version.json dist/ /"
despues="mirror -R --verbose --delete --exclude-glob .well-known/ --exclude-glob .well-known/* dist/ /"
lftp -e "$conf; $primero; $despues; bye" --env-password -u "$FTP_USER" "$FTP_HOST"
echo "Subido."
