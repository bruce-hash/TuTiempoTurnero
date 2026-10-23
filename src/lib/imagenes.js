import { api } from "../api/index.js";
import { LIVE } from "../config.js";
import { ME, pr } from "./prestadores.js";
import { S } from "../state.js";
import { store } from "../store.js";
import { render } from "../ui/render.js";
import { toast } from "../ui/toast.js";

// Achica la foto a maxSide px de lado mayor y la vuelve JPEG: pesa poco y no lleva la ubicación del celular.
async function shrinkImage(file, maxSide = 640) {
  if (!file || !/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) {
    throw new Error("Elegí una foto JPG, PNG o WEBP.");
  }
  if (file.size > 15e6) {
    throw new Error("La foto es muy pesada (máximo 15 MB).");
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("No pudimos leer esa foto."));
      image.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Tu navegador no pudo procesar la foto.");
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return {
      blob: await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85)),
      data: canvas.toDataURL("image/jpeg", 0.85),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
// Foto de perfil del usuario (target "me") o del prestador: en vivo se sube; en la demo queda como data URL.
export async function onPhoto(input, target) {
  const file = input.files && input.files[0];
  input.value = "";
  if (file) {
    try {
      const { blob: blob, data: dataUrl } = await shrinkImage(file);
      if (target === "me") {
        const photo = LIVE ? await api.m.setAvatar(blob) : dataUrl;
        S.user.photo = photo;
        if (!LIVE && store.DEMO_USERS[S.user.email]) {
          store.DEMO_USERS[S.user.email].photo = photo;
        }
      } else {
        const photo = LIVE ? await api.m.setProviderPhoto(blob) : dataUrl;
        pr(ME()).photo = photo;
      }
      toast("Foto actualizada");
      render();
    } catch (err) {
      if (!err.__shown) {
        toast(err.message || "No pudimos subir la foto.");
      }
    }
  }
}
