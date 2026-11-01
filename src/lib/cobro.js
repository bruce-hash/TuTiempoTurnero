// D30 (V1): lo que paga el cliente al reservar. La misma cuenta que charge_parts en la base, con números enteros:
//   comisión de TuTiempo = seña × % de TuTiempo, al peso más cercano;
//   total = ⌈(seña + comisión) / (1 − % de Mercado Pago)⌉;
//   costo de Mercado Pago = total − seña − comisión.
// Así el prestador recibe la seña completa y TuTiempo su comisión. En el navegador es solo para mostrar: el cobro real
// lo calcula la base al crear la reserva (book_slot). Sin imports: la prueban pruebas/unidad.mjs.

// plazos de acreditación de Mercado Pago (los mismos valores que provider_settings.payout_term)
export const MP_TERMS = [
  ["instant", "Al instante"],
  ["d10", "10 días"],
  ["d18", "18 días"],
  ["d35", "35 días"],
];
export const termName = (term) => (MP_TERMS.find((item) => item[0] === term) || MP_TERMS[0])[1];

// deposit: seña en pesos; commissionPct: % de TuTiempo sobre la seña (7 = 7%); mpPct: % de Mercado Pago del plazo (7,61 = 7.61)
export function chargeFor(deposit, commissionPct, mpPct) {
  const dep = Math.max(0, Math.round(+deposit || 0));
  if (!dep) {
    return { deposit: 0, fee: 0, mp: 0, total: 0 };
  }
  const c100 = Math.round((+commissionPct || 0) * 100);
  const m100 = Math.round((+mpPct || 0) * 100);
  const fee = Math.floor((dep * c100 + 5000) / 10000);
  const div = 10000 - m100;
  const total = Math.floor(((dep + fee) * 10000 + div - 1) / div);
  return { deposit: dep, fee, mp: total - dep - fee, total };
}
