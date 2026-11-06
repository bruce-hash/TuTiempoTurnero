// Feriados (7/11 · punto 4, D39): trae la lista oficial del año en curso y del siguiente de una fuente pública y la
// guarda en la base (holidays_sync_save), que filtra los tipos que entran (inamovibles, trasladables y puentes
// turísticos) y no toca un año que el admin ya confirmó (si la fuente cambió, lo marca para que lo revise).
// La llama pg_cron los lunes (public.run_holidays_sync) y el botón "Traer de nuevo" del admin, con CRON_SECRET.
// Fuente: ArgentinaDatos (https://api.argentinadatos.com/v1/feriados/<año>, abierta y sin clave). HOLIDAYS_API_URL
// (opcional, solo pruebas) la cambia. El navegador nunca sale a esta API: todo pasa por el servidor.
import { admin, cronOnly, json } from "../_shared/util.ts";

const API = (Deno.env.get("HOLIDAYS_API_URL") ?? "").replace(/\/+$/, "") || "https://api.argentinadatos.com/v1/feriados";

async function fetchYear(year: number): Promise<{ rows?: unknown[]; error?: string }> {
  try {
    const res = await fetch(`${API}/${year}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `la fuente respondió ${res.status}` };
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data)) return { error: "la fuente no devolvió una lista" };
    return { rows: data.slice(0, 200) };
  } catch (e) {
    return { error: `no se pudo consultar la fuente: ${(e as Error).message}`.slice(0, 300) };
  }
}

Deno.serve(async (req) => {
  const denied = cronOnly(req);
  if (denied) return denied;
  const db = admin();
  // el año de Buenos Aires (en UTC, del 31/12 a las 21 h ya sería el siguiente)
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric" }).format(new Date()));
  const out: unknown[] = [];
  for (const y of [year, year + 1]) {
    const got = await fetchYear(y);
    const { data, error } = await db.rpc("holidays_sync_save", { p_year: y, p_rows: got.rows ?? [], p_error: got.error ?? null });
    if (error) return json({ error: error.message }, 500);
    out.push(data);
  }
  return json({ years: out });
});
