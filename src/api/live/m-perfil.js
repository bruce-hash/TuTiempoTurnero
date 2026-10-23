import { LM } from "./index.js";
import { call, saved } from "../saved.js";
import { sb } from "../../config.js";
import { safeRedirect } from "../../lib/dom.js";
import { S } from "../../state.js";
import { mediaUrl } from "../../ui/fotos.js";

// Escrituras del perfil del prestador: datos, rubros, servicios con sus adicionales, posteos, respuestas a reseñas,
// fotos, DNI y conexión con Mercado Pago.
Object.assign(LM, {
  // prof.svcs: servicios en formato svcMeta [nombre, minutos, precio, rubro, id, meta]; prof.before: cómo estaban.
  // Los servicios y adicionales que se sacan no se borran: quedan inactivos (los turnos viejos los siguen nombrando).
  saveProfile: async (prof, removedSvcIds) => {
    await saved(
      sb
        .from("providers")
        .update({
          name: prof.name,
          bio: prof.bio || null,
          address: prof.addr,
          instagram: prof.ig || null,
        })
        .eq("id", prof.id),
    );
    await saved(
      sb
        .from("provider_private")
        .update({
          phone: prof.tel || null,
        })
        .eq("provider_id", prof.id),
    );
    const currentCats = (
      (await call(sb.from("provider_categories").select("category_id").eq("provider_id", prof.id))) || []
    ).map((row) => row.category_id);
    for (const catId of prof.cats) {
      if (!currentCats.includes(catId)) {
        await saved(
          sb.from("provider_categories").insert({
            provider_id: prof.id,
            category_id: catId,
          }),
        );
      }
    }
    for (const svcId of removedSvcIds || []) {
      await saved(
        sb
          .from("services")
          .update({
            active: false,
          })
          .eq("id", svcId),
      );
    }
    for (const [index, svc] of prof.svcs.entries()) {
      const meta = svc[5] || {
        every: 0,
        note: "",
        add: [],
      };
      const svcRow = {
        provider_id: prof.id,
        category_id: svc[3],
        name: svc[0],
        duration_min: svc[1],
        price: svc[2],
        sort: index,
        active: true,
        repeat_days: meta.every || 0,
        prep_note: meta.note || null,
      };
      if (svc[4]) {
        await saved(sb.from("services").update(svcRow).eq("id", svc[4]));
      } else {
        const inserted = await saved(sb.from("services").insert(svcRow).select("id").single());
        svc[4] = inserted.id;
      }
      const metaBefore = ((prof.before || []).find((old) => old[4] === svc[4]) || [])[5];
      // adicionales que estaban antes y ya no están: se desactivan
      const oldAddonIds = metaBefore ? metaBefore.add.map((addon) => addon[3]).filter(Boolean) : [];
      for (const addonId of oldAddonIds) {
        if (!meta.add.some((addon) => addon[3] === addonId)) {
          await saved(
            sb
              .from("service_addons")
              .update({
                active: false,
              })
              .eq("id", addonId),
          );
        }
      }
      for (const [addonIndex, addon] of meta.add.entries()) {
        const addonRow = {
          service_id: svc[4],
          name: addon[0],
          price: addon[1],
          duration_min: addon[2],
          sort: addonIndex,
          active: true,
        };
        if (addon[3]) {
          await saved(sb.from("service_addons").update(addonRow).eq("id", addon[3]));
        } else {
          const insertedAddon = await saved(sb.from("service_addons").insert(addonRow).select("id").single());
          addon[3] = insertedAddon.id;
        }
      }
    }
    // rubros que se sacaron
    for (const catId of currentCats) {
      if (!prof.cats.includes(catId)) {
        await saved(sb.from("provider_categories").delete().eq("provider_id", prof.id).eq("category_id", catId));
      }
    }
  },
  post: (body) =>
    saved(
      sb.from("posts").insert({
        provider_id: S.me,
        body: body,
      }),
    ),
  reply: (review) =>
    saved(
      sb
        .from("reviews")
        .update({
          reply: review.reply,
        })
        .eq("id", review.id),
    ),
  // sube la foto o el video al bucket media y completa media.id y media.url con lo guardado
  upload: async (file, media) => {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const storagePath = `${S.me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await saved(
      sb.storage.from("media").upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      }),
    );
    const row = await saved(
      sb
        .from("media")
        .insert({
          provider_id: S.me,
          storage_path: storagePath,
          kind: file.type.startsWith("video") ? "video" : "image",
          label: file.name.slice(0, 80),
        })
        .select("id")
        .single(),
    );
    media.id = row.id;
    media.url = mediaUrl(storagePath);
  },
  uploadDni: async (files) => {
    for (const file of files) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      await saved(
        sb.storage.from("dni").upload(`${S.user.id}/${Date.now()}.${ext}`, file, {
          contentType: file.type,
        }),
      );
    }
  },
  deleteProvider: () => saved(sb.rpc("delete_my_provider")),
  mpConnect: async () => {
    const res = await sb.functions.invoke("mp-oauth", {
      body: {},
    });
    if (res.error || !res.data || !res.data.url) {
      throw new Error("No se pudo abrir Mercado Pago");
    }
    safeRedirect(res.data.url);
  },
});
