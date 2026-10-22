import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { ME, pr } from "./prestadores.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

async function shrinkImage(e, a = 640) {
  if (!e || !/^image\/(jpeg|png|webp|heic|heif)$/i.test(e.type)) {
    throw new Error("Elegí una foto JPG, PNG o WEBP.");
  }
  if (e.size > 15e6) {
    throw new Error("La foto es muy pesada (máximo 15 MB).");
  }
  const t = URL.createObjectURL(e);
  try {
    const s = await new Promise((c, d) => {
      const p = new Image();
      p.onload = () => c(p);
      p.onerror = () => d(new Error("No pudimos leer esa foto."));
      p.src = t;
    });
    const n = Math.min(1, a / Math.max(s.width, s.height));
    const o = document.createElement("canvas");
    o.width = Math.round(s.width * n);
    o.height = Math.round(s.height * n);
    const i = o.getContext("2d");
    if (!i) {
      throw new Error("Tu navegador no pudo procesar la foto.");
    }
    i.drawImage(s, 0, 0, o.width, o.height);
    return {
      blob: await new Promise((c) => o.toBlob(c, "image/jpeg", 0.85)),
      data: o.toDataURL("image/jpeg", 0.85),
    };
  } finally {
    URL.revokeObjectURL(t);
  }
}
export async function onPhoto(e, a) {
  const t = e.files && e.files[0];
  e.value = "";
  if (t) {
    try {
      const { blob: s, data: n } = await shrinkImage(t);
      if (a === "me") {
        const o = LIVE ? await api.m.setAvatar(s) : n;
        S.user.photo = o;
        if (!LIVE && store.DEMO_USERS[S.user.email]) {
          store.DEMO_USERS[S.user.email].photo = o;
        }
      } else {
        const o = LIVE ? await api.m.setProviderPhoto(s) : n;
        pr(ME()).photo = o;
      }
      toast("Foto actualizada");
      render();
    } catch (s) {
      if (!s.__shown) {
        toast(s.message || "No pudimos subir la foto.");
      }
    }
  }
}
