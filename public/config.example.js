// =====================================================================
// TuTiempo · configuración
// Completá con los datos de tu proyecto de Supabase (Project Settings → API).
// - supabaseUrl: la "Project URL".
// - supabaseAnonKey: la "anon public" key. Es pública por diseño: la seguridad
//   la ponen las reglas de la base (RLS). NUNCA pongas acá la service_role key.
// - turnstileSiteKey (opcional): la "Site Key" de Cloudflare Turnstile, solo si activaste el CAPTCHA en
//   Supabase (Authentication → Attack Protection). Sin ella la app funciona sin CAPTCHA. Ver docs/02.
// Mientras tenga los valores de ejemplo, la app funciona en MODO DEMO.
// =====================================================================
window.TT_CONFIG = {
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabaseAnonKey: "PEGAR-ACA-LA-ANON-KEY",
  city: "olavarria",
  turnstileSiteKey: ""
};
