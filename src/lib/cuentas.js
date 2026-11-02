import { S } from "../state.js";

// D33 · Cuentas separadas: una cuenta es de cliente o de negocio, nunca las dos. Una cuenta de negocio (con sesión y
// dueña de un prestador) no reserva, no sigue, no deja reseñas ni se anota para que le avisen. La base lo rechaza igual
// (business_account); esto es para avisarlo antes, con la salida: ingresar con la cuenta personal. Las cuentas admin
// siguen como hoy.
export const isBusiness = () => !!S.user && !!S.barberAuth && !S.isAdmin;
