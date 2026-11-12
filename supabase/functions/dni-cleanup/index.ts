// Borra las fotos del DNI que ya no hacen falta (D24): de un prestador verificado, 30 días después de verificarlo; de
// un alta sin aprobar, 90 días después de la última foto; de un prestador dado de baja, en el momento. Qué borrar lo
// decide la base (dni_photos_due); el borrado va por la API de Storage, que saca el archivo y su fila en
// storage.objects (un DELETE directo en la tabla deja el archivo huérfano), y después se avisa a la base
// (dni_photos_deleted), que deja dni_paths vacío y la fecha del borrado.
// La llama pg_cron una vez por día (public.run_dni_cleanup) y la baja del prestador en el momento, con CRON_SECRET.
import { admin, cronOnly, json } from "../_shared/util.ts";

Deno.serve(async (req) => {
  const denied = cronOnly(req);
  if (denied) return denied;
  const db = admin();
  const { data: rows, error } = await db.rpc("dni_photos_due", { p_limit: 100 });
  if (error) return json({ error: error.message }, 500);
  let files = 0, failed = 0;
  for (const row of (rows as { folder: string; reason: string; paths: string[] }[]) ?? []) {
    const { error: e1 } = await db.storage.from("dni").remove(row.paths);
    if (e1) { failed++; console.error("dni-cleanup: no se pudo borrar", row.folder, row.reason, e1.message); continue; }
    const { data: left, error: e2 } = await db.rpc("dni_photos_deleted", { p_folder: row.folder, p_paths: row.paths });
    if (e2 || left) { failed++; console.error("dni-cleanup: quedaron fotos", row.folder, row.reason, e2?.message ?? left); continue; }
    files += row.paths.length;
  }
  return json({ files, failed });
});
