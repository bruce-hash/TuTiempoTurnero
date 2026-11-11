// 11/11 (división del código): los datos de la comunidad de un profesional (seguidores, reseñas, trabajos), aparte de
// la pestaña Trabajos (src/views/prestador/comunidad.js): los usan también las pantallas del cliente.
import { LIVE } from "../config.js";
import { seedComm } from "../demo/comunidad.js";
import { store } from "../store.js";

export const comm = (pid) => (store.COMMBY[pid] ||= LIVE ? { followers: 0, reviews: [], media: [] } : seedComm(pid));
