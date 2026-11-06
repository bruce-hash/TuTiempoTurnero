#!/usr/bin/env bash
# Despliegue a prueba (docs/10): qué Edge Functions hay que desplegar. Compara con el último despliegue (la etiqueta
# prueba-desplegada): las carpetas de supabase/functions/ que cambiaron; si cambió _shared/ (o no hay etiqueta), todas.
# Imprime un nombre por línea.
set -euo pipefail
cd "$(dirname "$0")/.."
todas=$(find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name '_*' -printf '%f\n' | sort)
if ! git rev-parse -q --verify "refs/tags/prueba-desplegada^{commit}" >/dev/null; then
  echo "$todas"
  exit 0
fi
cambios=$(git diff --name-only prueba-desplegada HEAD -- supabase/functions)
if grep -q '^supabase/functions/_shared/' <<<"$cambios"; then
  echo "$todas"
  exit 0
fi
for f in $todas; do
  if grep -q "^supabase/functions/$f/" <<<"$cambios"; then echo "$f"; fi
done
