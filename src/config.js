const CFG = (typeof window != "undefined" && window.TT_CONFIG) || {};
export const CONFIG_OK =
  !!CFG.supabaseUrl &&
  !!CFG.supabaseAnonKey &&
  !/TU-PROYECTO|xxxx|PEGAR/i.test(CFG.supabaseUrl + CFG.supabaseAnonKey) &&
  typeof window != "undefined" &&
  !!window.supabase;
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
export const TZ = "America/Argentina/Buenos_Aires";
export const PAGE = 12;
