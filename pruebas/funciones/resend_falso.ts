// Resend falso para probar email-send (Bloque 3). Imita POST /emails: pide la llave (Bearer), anota cada email y es
// idempotente por Idempotency-Key (la misma clave devuelve el mismo id sin mandar otro). Se le pueden programar fallas.
export function resendFalso(llave: string) {
  const enviados: { clave: string; id: string; body: any }[] = [];
  const pedidos: string[] = [];                                  // cada Idempotency-Key recibida, en orden
  const fallas: { status: number; message: string }[] = [];     // los próximos envíos que fallan
  let n = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    if (req.method !== "POST" || url.pathname !== "/emails") return json({ message: "not found" }, 404);
    if (req.headers.get("Authorization") !== `Bearer ${llave}`) return json({ name: "validation_error", message: "API key is invalid" }, 403);
    const clave = req.headers.get("Idempotency-Key") ?? "";
    pedidos.push(clave);
    const body = await req.json().catch(() => ({}));
    const falla = fallas.shift();
    if (falla) return json({ name: "error", message: falla.message }, falla.status);
    const ya = enviados.find((e) => clave && e.clave === clave);
    if (ya) return json({ id: ya.id });
    const id = `re_${++n}`;
    enviados.push({ clave, id, body });
    return json({ id });
  });
  return {
    url: `http://localhost:${(server.addr as Deno.NetAddr).port}`,
    enviados, pedidos, fallas,
    cerrar: () => server.shutdown(),
  };
}
