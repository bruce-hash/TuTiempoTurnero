import { LM } from "./index.js";
import { call, saved } from "../saved.js";
import { sb } from "../../config.js";
import { safeRedirect } from "../../lib/dom.js";
import { S } from "../../state.js";
import { mediaUrl } from "../../ui/fotos.js";

Object.assign(LM, {
  saveProfile: async (e, a) => {
    await saved(
      sb
        .from("providers")
        .update({
          name: e.name,
          bio: e.bio || null,
          address: e.addr,
          instagram: e.ig || null,
        })
        .eq("id", e.id),
    );
    await saved(
      sb
        .from("provider_private")
        .update({
          phone: e.tel || null,
        })
        .eq("provider_id", e.id),
    );
    const s = (
      (await call(sb.from("provider_categories").select("category_id").eq("provider_id", e.id))) || []
    ).map((n) => n.category_id);
    for (const n of e.cats) {
      if (!s.includes(n)) {
        await saved(
          sb.from("provider_categories").insert({
            provider_id: e.id,
            category_id: n,
          }),
        );
      }
    }
    for (const n of a || []) {
      await saved(
        sb
          .from("services")
          .update({
            active: false,
          })
          .eq("id", n),
      );
    }
    for (const [n, o] of e.svcs.entries()) {
      const i = o[5] || {
        every: 0,
        note: "",
        add: [],
      };
      const l = {
        provider_id: e.id,
        category_id: o[3],
        name: o[0],
        duration_min: o[1],
        price: o[2],
        sort: n,
        active: true,
        repeat_days: i.every || 0,
        prep_note: i.note || null,
      };
      if (o[4]) {
        await saved(sb.from("services").update(l).eq("id", o[4]));
      } else {
        const p = await saved(sb.from("services").insert(l).select("id").single());
        o[4] = p.id;
      }
      const c = ((e.before || []).find((p) => p[4] === o[4]) || [])[5];
      const d = c ? c.add.map((p) => p[3]).filter(Boolean) : [];
      for (const p of d) {
        if (!i.add.some((w) => w[3] === p)) {
          await saved(
            sb
              .from("service_addons")
              .update({
                active: false,
              })
              .eq("id", p),
          );
        }
      }
      for (const [p, w] of i.add.entries()) {
        const y = {
          service_id: o[4],
          name: w[0],
          price: w[1],
          duration_min: w[2],
          sort: p,
          active: true,
        };
        if (w[3]) {
          await saved(sb.from("service_addons").update(y).eq("id", w[3]));
        } else {
          const k = await saved(sb.from("service_addons").insert(y).select("id").single());
          w[3] = k.id;
        }
      }
    }
    for (const n of s) {
      if (!e.cats.includes(n)) {
        await saved(sb.from("provider_categories").delete().eq("provider_id", e.id).eq("category_id", n));
      }
    }
  },
  post: (e) =>
    saved(
      sb.from("posts").insert({
        provider_id: S.me,
        body: e,
      }),
    ),
  reply: (e) =>
    saved(
      sb
        .from("reviews")
        .update({
          reply: e.reply,
        })
        .eq("id", e.id),
    ),
  upload: async (e, a) => {
    const t = (e.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const s = `${S.me}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${t}`;
    await saved(
      sb.storage.from("media").upload(s, e, {
        contentType: e.type,
        upsert: false,
      }),
    );
    const n = await saved(
      sb
        .from("media")
        .insert({
          provider_id: S.me,
          storage_path: s,
          kind: e.type.startsWith("video") ? "video" : "image",
          label: e.name.slice(0, 80),
        })
        .select("id")
        .single(),
    );
    a.id = n.id;
    a.url = mediaUrl(s);
  },
  uploadDni: async (e) => {
    for (const a of e) {
      const t = (a.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      await saved(
        sb.storage.from("dni").upload(`${S.user.id}/${Date.now()}.${t}`, a, {
          contentType: a.type,
        }),
      );
    }
  },
  deleteProvider: () => saved(sb.rpc("delete_my_provider")),
  mpConnect: async () => {
    const e = await sb.functions.invoke("mp-oauth", {
      body: {},
    });
    if (e.error || !e.data || !e.data.url) {
      throw new Error("No se pudo abrir Mercado Pago");
    }
    safeRedirect(e.data.url);
  },
});
