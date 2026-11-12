export const PWRULE = "Mínimo 8 caracteres, con letras y números.";
// Fuerza de la contraseña de 0 a 4, para el medidor (largo, letras y números, mayúsculas o símbolos).
export function pwScore(pass) {
  pass = pass || "";
  let score = 0;
  if (pass.length >= 8) {
    score++;
  }
  if (pass.length >= 12) {
    score++;
  }
  if (/[a-záéíóúñ]/i.test(pass) && /\d/.test(pass)) {
    score++;
  }
  if (/[^a-z0-9áéíóúñ]/i.test(pass) || (/[A-Z]/.test(pass) && /[a-z]/.test(pass))) {
    score++;
  }
  return score;
}
export function pwOk(pass) {
  return typeof pass == "string" && pass.length >= 8 && pass.length <= 72 && /[a-záéíóúñ]/i.test(pass) && /\d/.test(pass);
}
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
