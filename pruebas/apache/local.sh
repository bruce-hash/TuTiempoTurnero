#!/usr/bin/env bash
# Prueba del .htaccess con el apache2 local (Ubuntu: apt install apache2). En el CI se usa el contenedor httpd:2.4.
# Uso: npm run test:htaccess   (compila dist/, levanta Apache en 8080/8443, corre pruebas/htaccess.mjs y lo apaga)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="${APACHE_BIN:-/usr/sbin/apache2}"
RUN="$(mktemp -d)"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=localhost" -keyout "$RUN/tt.key" -out "$RUN/tt.crt" 2>/dev/null
chmod 755 "$RUN"
"$BIN" -C "Define MODDIR ${APACHE_MODDIR:-/usr/lib/apache2/modules}" -C "Define DOCROOT $ROOT/dist" -C "Define CERTS $RUN" \
  -C "Define RUNDIR $RUN" -C "Define RUNUSER ${APACHE_USER:-www-data}" -C "Define RUNGROUP ${APACHE_GROUP:-www-data}" \
  -f "$ROOT/pruebas/apache/httpd.conf" -k start
trap '"$BIN" -C "Define MODDIR ${APACHE_MODDIR:-/usr/lib/apache2/modules}" -C "Define DOCROOT $ROOT/dist" -C "Define CERTS $RUN" -C "Define RUNDIR $RUN" -C "Define RUNUSER ${APACHE_USER:-www-data}" -C "Define RUNGROUP ${APACHE_GROUP:-www-data}" -f "$ROOT/pruebas/apache/httpd.conf" -k stop; sleep 1; cat "$RUN/error.log" 2>/dev/null | grep -v "AH00558" || true; rm -rf "$RUN"' EXIT
node "$ROOT/pruebas/htaccess.mjs" "$ROOT/dist"
