import { LIVE, sb } from "../config.js";
import { avatar } from "../lib/prestadores.js";

export const mediaUrl = (e) => (LIVE ? sb.storage.from("media").getPublicUrl(e).data.publicUrl : e);
export const avatarUrl = (e) => (e && LIVE ? sb.storage.from("avatars").getPublicUrl(e).data.publicUrl : null);
export const photoPicker = (e, a) =>
  `<label class="photopick" for="${a}" title="Cambiar foto">${avatar(e, "av-lg")}<span class="pp-cam">📷</span></label><input id="${a}" type="file" accept="image/jpeg,image/png,image/webp" hidden>`;
