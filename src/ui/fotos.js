import { LIVE, sb } from "../config.js";
import { avatar } from "../lib/prestadores.js";

// en la demo la ruta ya es la URL
export const mediaUrl = (path) => (LIVE ? sb.storage.from("media").getPublicUrl(path).data.publicUrl : path);
export const avatarUrl = (path) => (path && LIVE ? sb.storage.from("avatars").getPublicUrl(path).data.publicUrl : null);
export const photoPicker = (who, inputId) =>
  `<label class="photopick" for="${inputId}" title="Cambiar foto">${avatar(who, "av-lg")}<span class="pp-cam">📷</span></label><input id="${inputId}" type="file" accept="image/jpeg,image/png,image/webp" hidden>`;
