// Compensa · configuración pública.
// La publishable key de Supabase es pública por diseño: la seguridad la ponen las reglas (RLS) de la base de datos.
window.COMPENSA_CONFIG = {
  producto: "Compensa",
  // Correo de soporte que sale en la app y en la ficha de la App Store
  soporte: "contacto@almara.group",
  // Dirección pública de la web (la usan los enlaces y la confirmación del correo)
  webUrl: "https://compensa-gray.vercel.app",
  supabaseUrl: "https://isnmzdchriayjopeklom.supabase.co",
  supabaseAnonKey: "sb_publishable_hZAmIfDnBBkG3UxGGRyY6Q_KbRpE_hp",
  // Suscripciones dentro de la app de iPhone (App Store Connect → Suscripciones). El precio se pone allí.
  appleMensual: "compensa.mensual",
  appleAnual: "compensa.anual",
  // Precios orientativos que se enseñan en la web (en la app salen los de App Store)
  precioMensual: "4,99 € al mes",
  precioAnual: "29,99 € al año"
};
