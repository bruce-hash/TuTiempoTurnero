// config.js (window.TT_CONFIG) lo completa Bruno en Hostinger; no se versiona (ver public/config.example.js)
const CFG = (typeof window != "undefined" && window.TT_CONFIG) || {};
export const CONFIG_OK =
  !!CFG.supabaseUrl &&
  !!CFG.supabaseAnonKey &&
  !/TU-PROYECTO|xxxx|PEGAR/i.test(CFG.supabaseUrl + CFG.supabaseAnonKey) &&
  typeof window != "undefined" &&
  !!window.supabase;
// en producción siempre en vivo; en desarrollo y pruebas, en vivo solo si hay config completo (si no, demo)
export const LIVE = import.meta.env.VITE_DEMO ? CONFIG_OK : true;
export const sb = CONFIG_OK
  ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;
export const CITY = CFG.city || "olavarria";
// Bloque C: la clave pública VAPID de las notificaciones push (npm run vapid; sin ella la app no ofrece avisos) y el freno
// del service worker (serviceWorker: false en config.js lo desinstala). En la demo, nada de esto.
export const VAPID_KEY =
  LIVE && typeof CFG.vapidPublicKey == "string" && /^[A-Za-z0-9_-]{86,88}$/.test(CFG.vapidPublicKey) ? CFG.vapidPublicKey : "";
export const SW_ON = LIVE && CFG.serviceWorker !== false;
// H30: clave del sitio de Cloudflare Turnstile (el CAPTCHA de Supabase Auth). Sin clave, o en la demo, no hay CAPTCHA
export const CAPTCHA_KEY =
  LIVE && typeof CFG.turnstileSiteKey == "string" && /^[\w-]{10,100}$/.test(CFG.turnstileSiteKey) && !/PEGAR/i.test(CFG.turnstileSiteKey)
    ? CFG.turnstileSiteKey
    : "";
export const TZ = "America/Argentina/Buenos_Aires";
export const PAGE = 12;
