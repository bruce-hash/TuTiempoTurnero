export const PWRULE = "Mínimo 8 caracteres, con letras y números.";
export function pwScore(e) {
  e = e || "";
  let a = 0;
  if (e.length >= 8) {
    a++;
  }
  if (e.length >= 12) {
    a++;
  }
  if (/[a-záéíóúñ]/i.test(e) && /\d/.test(e)) {
    a++;
  }
  if (/[^a-z0-9áéíóúñ]/i.test(e) || (/[A-Z]/.test(e) && /[a-z]/.test(e))) {
    a++;
  }
  return a;
}
export function pwOk(e) {
  return typeof e == "string" && e.length >= 8 && e.length <= 72 && /[a-záéíóúñ]/i.test(e) && /\d/.test(e);
}
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
