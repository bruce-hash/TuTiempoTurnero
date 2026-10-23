// Mercado Pago falso para probar las Edge Functions reales (Bloque 1). Imita lo que usan las funciones:
//  POST /oauth/token                 código de autorización o refresh_token → llave de una cuenta
//  GET  /v1/payments/:id             el pago, solo con la llave de la cuenta que lo cobró (si no, 404)
//  POST /v1/payments/:id/refunds     devolución (idempotente por X-Idempotency-Key); se le pueden programar fallas
//  POST /checkout/preferences        crea el cobro y lo anota
// Cada pago trae datos de tarjeta y del documento, para verificar que no se guardan.
export type Pago = {
  id: string; collector: string; status: string; amount: number; fee: number | null; ref: string;
  refunded?: number; detail?: string; currency?: string;
};

export function mpFalso() {
  const cuentas = new Map<string, string>();          // llave → id de usuario de MP
  const refrescos = new Map<string, string>();        // refresh_token → id de usuario
  const codigos = new Map<string, string>();          // código de OAuth → id de usuario
  const pagos = new Map<string, Pago>();
  const devoluciones: { pago: string; monto: number; llave: string; clave: string; id: string }[] = [];
  const preferencias: { llave: string; body: any }[] = [];
  const fallas: { status: number; message: string }[] = [];   // próximas devoluciones que fallan
  let refrescoRoto = false;
  let n = 0;

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const llave = (req: Request) => (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const nuevaLlave = (user: string) => {
    const access = `tok-${user}-${++n}`, refresh = `ref-${user}-${n}`;
    cuentas.set(access, user); refrescos.set(refresh, user);
    return { access_token: access, refresh_token: refresh, user_id: Number(user) || user, expires_in: 15552000 };
  };

  const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (url.pathname === "/oauth/token") {
      if (body.grant_type === "authorization_code" && codigos.has(body.code)) return json(nuevaLlave(codigos.get(body.code)!));
      if (body.grant_type === "refresh_token" && refrescos.has(body.refresh_token) && !refrescoRoto) return json(nuevaLlave(refrescos.get(body.refresh_token)!));
      return json({ message: "invalid_grant" }, 400);
    }
    if (url.pathname === "/checkout/preferences" && req.method === "POST") {
      if (!cuentas.has(llave(req))) return json({ message: "unauthorized" }, 401);
      preferencias.push({ llave: llave(req), body });
      return json({ id: `pref-${++n}`, init_point: "https://mp.test/checkout" });
    }
    let m = url.pathname.match(/^\/v1\/payments\/([^/]+)$/);
    if (m && req.method === "GET") {
      const p = pagos.get(m[1]);
      if (!p || cuentas.get(llave(req)) !== p.collector) return json({ message: "Payment not found" }, 404);
      return json({
        id: Number(p.id) || p.id, status: p.status, status_detail: p.detail ?? "accredited", collector_id: Number(p.collector) || p.collector,
        currency_id: p.currency ?? "ARS", transaction_amount: p.amount, transaction_amount_refunded: p.refunded ?? 0, external_reference: p.ref,
        fee_details: p.fee == null ? [{ type: "mercadopago_fee", amount: 300, fee_payer: "collector" }]
                                   : [{ type: "mercadopago_fee", amount: 300, fee_payer: "collector" }, { type: "application_fee", amount: p.fee, fee_payer: "collector" }],
        card: { first_six_digits: "450995", last_four_digits: "3704", cardholder: { name: "ANA LOPEZ", identification: { number: "30111222" } } },
        payer: { email: "ana@test.ar", identification: { type: "DNI", number: "30111222" }, first_name: "Ana" },
      });
    }
    m = url.pathname.match(/^\/v1\/payments\/([^/]+)\/refunds$/);
    if (m && req.method === "POST") {
      const p = pagos.get(m[1]);
      if (!p || cuentas.get(llave(req)) !== p.collector) return json({ message: "Payment not found" }, 404);
      const clave = req.headers.get("X-Idempotency-Key") ?? "";
      const previa = devoluciones.find((d) => d.clave === clave && clave);
      if (previa) return json({ id: previa.id, amount: previa.monto }, 201);
      const falla = fallas.shift();
      if (falla) return json({ message: falla.message }, falla.status);
      const id = `RF-${++n}`;
      devoluciones.push({ pago: m[1], monto: body.amount, llave: llave(req), clave, id });
      p.refunded = (p.refunded ?? 0) + Number(body.amount);
      return json({ id, amount: body.amount, status: "approved" }, 201);
    }
    return json({ message: "no imitado: " + url.pathname }, 404);
  });

  return {
    url: `http://localhost:${(server.addr as Deno.NetAddr).port}`,
    cuentas, pagos, devoluciones, preferencias, fallas,
    codigo(code: string, user: string) { codigos.set(code, user); },
    pago(p: Pago) { pagos.set(p.id, p); },
    romperRefresco(v: boolean) { refrescoRoto = v; },
    cerrar: () => server.shutdown(),
  };
}
