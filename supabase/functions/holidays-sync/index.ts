// Feriados (D39): trae la lista oficial del año en curso y del siguiente y la guarda en la base (holidays_sync_save), que
// filtra los tipos que entran (inamovibles, trasladables, puentes turísticos y, de Google, 'nacional') y no toca un año que
// el admin ya confirmó (si la fuente cambió, lo marca para que lo revise).
// Fuentes (7/11, punto 6):
//  1. ArgentinaDatos (https://api.argentinadatos.com/v1/feriados/<año>, abierta y sin clave): trae el tipo de cada feriado
//     y ya con los traslados por decreto. Es la principal.
//  2. Si falla o no trae ese año, el calendario público de feriados de Argentina de Google (.ics): muy estable, pero no dice
//     el tipo y mezcla feriados con observancias (Día de la Madre, etc.). Se toman los eventos que no son observancias; los
//     puentes turísticos (por el nombre) entran como 'puente' y el resto como 'nacional'. El admin los revisa al confirmar.
// La llama pg_cron los lunes (public.run_holidays_sync) y el botón "Traer de nuevo" del admin, con CRON_SECRET.
// HOLIDAYS_API_URL y HOLIDAYS_ICS_URL (opcionales, solo pruebas) cambian las fuentes. El navegador nunca sale a ellas.
import { admin, cronOnly, json } from "../_shared/util.ts";

const API = (Deno.env.get("HOLIDAYS_API_URL") ?? "").replace(/\/+$/, "") || "https://api.argentinadatos.com/v1/feriados";
const ICS = Deno.env.get("HOLIDAYS_ICS_URL") ||
  "https://calendar.google.com/calendar/ical/es.ar%23holiday%40group.v.calendar.google.com/public/basic.ics";

type Row = { fecha: string; tipo: string; nombre: string };
type Got = { rows?: Row[]; error?: string };

async function fromArgentinaDatos(year: number): Promise<Got> {
  try {
    const res = await fetch(`${API}/${year}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { error: `ArgentinaDatos respondió ${res.status}` };
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data)) return { error: "ArgentinaDatos no devolvió una lista" };
    const rows = data.slice(0, 200) as Row[];
    if (!rows.some((r) => String(r?.fecha ?? "").startsWith(`${year}-`))) return { error: "ArgentinaDatos no trajo feriados de ese año" };
    return { rows };
  } catch (e) {
    return { error: `no se pudo consultar ArgentinaDatos: ${(e as Error).message}`.slice(0, 140) };
  }
}

// lee un .ics (RFC 5545): líneas plegadas, un bloque por evento; solo la fecha (DTSTART), el título y la descripción
export function parseIcs(text: string): { date: string; summary: string; description: string }[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const out: { date: string; summary: string; description: string }[] = [];
  let ev: Record<string, string> | null = null;
  const unescape = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") ev = {};
    else if (line === "END:VEVENT" && ev) {
      const m = /^(\d{4})(\d{2})(\d{2})/.exec(ev.DTSTART ?? "");
      if (m) out.push({ date: `${m[1]}-${m[2]}-${m[3]}`, summary: unescape(ev.SUMMARY ?? "").trim(), description: unescape(ev.DESCRIPTION ?? "") });
      ev = null;
    } else if (ev) {
      const i = line.indexOf(":");
      if (i > 0) ev[line.slice(0, i).split(";")[0].toUpperCase()] = line.slice(i + 1);
    }
  }
  return out;
}

// del calendario de Google: sin observancias ni días que no son feriado; los puentes turísticos por el nombre; el resto,
// 'nacional' (Google no dice si es inamovible o trasladable)
export function rowsFromIcs(text: string, year: number): Row[] {
  return parseIcs(text)
    .filter((e) => e.date.startsWith(`${year}-`) && e.summary && !/observanc|observance/i.test(e.description))
    .filter((e) => !/jueves santo|d[ií]a de la madre|d[ií]a del padre|d[ií]a del ni[nñ]o|d[ií]a de la primavera/i.test(e.summary))
    .map((e) => ({
      fecha: e.date,
      tipo: /puente|fines tur[ií]sticos|no laborable/i.test(e.summary) ? "puente" : "nacional",
      nombre: e.summary.replace(/\s*\(trasladado\)\s*$/i, "").slice(0, 80),
    }))
    .slice(0, 200);
}

// el .ics trae varios años: se pide una sola vez por corrida
let icsCache: Promise<string | { error: string }> | null = null;
function icsText(): Promise<string | { error: string }> {
  icsCache ??= (async () => {
    try {
      const res = await fetch(ICS, { headers: { Accept: "text/calendar" }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) return { error: `el calendario de Google respondió ${res.status}` };
      const text = await res.text();
      return text.includes("BEGIN:VCALENDAR") ? text.slice(0, 2_000_000) : { error: "el calendario de Google no devolvió un .ics" };
    } catch (e) {
      return { error: `no se pudo consultar el calendario de Google: ${(e as Error).message}`.slice(0, 140) };
    }
  })();
  return icsCache;
}
async function fromGoogle(year: number): Promise<Got> {
  const text = await icsText();
  if (typeof text !== "string") return text;
  const rows = rowsFromIcs(text, year);
  return rows.length ? { rows } : { error: "el calendario de Google no trajo feriados de ese año" };
}

Deno.serve(async (req) => {
  const denied = cronOnly(req);
  if (denied) return denied;
  icsCache = null;
  const db = admin();
  // el año de Buenos Aires (en UTC, del 31/12 a las 21 h ya sería el siguiente)
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric" }).format(new Date()));
  const out: unknown[] = [];
  for (const y of [year, year + 1]) {
    const first = await fromArgentinaDatos(y);
    const got: Got & { source: string } = first.rows ? { ...first, source: "argentinadatos" } : { ...(await fromGoogle(y)), source: "google" };
    const error = got.rows ? null : `${first.error}; ${got.error}`.slice(0, 300);
    const { data, error: dbErr } = await db.rpc("holidays_sync_save", { p_year: y, p_rows: got.rows ?? [], p_error: error, p_source: got.source });
    if (dbErr) return json({ error: dbErr.message }, 500);
    out.push(data);
  }
  return json({ years: out });
});
