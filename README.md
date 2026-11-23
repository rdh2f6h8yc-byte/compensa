# Compensa

Simulador para jóvenes que quieren independizarse: compara irte de casa, compartir piso, vivir en pareja o comprar tu primer piso, y mira cómo queda tu dinero en 1, 5 y 10 años. Incluye las ayudas para jóvenes (Bono Alquiler Joven, Aval ICO…), revisadas cada mes.

- Web: https://compensa-gray.vercel.app (Vercel, se publica sola con cada cambio en `main`)
- App de iPhone: Capacitor 7 + Codemagic → TestFlight (`codemagic.yaml`)
- Base de datos y cuentas: Supabase, proyecto `compensa` (`supabase/schema.sql`)
- Funciones del servidor: `supabase/functions/explicar` (IA) y `supabase/functions/apple` (compras de Apple)

## Archivos
- `index.html`, `estilo.css`, `app.js`: la app
- `config.js`: datos públicos (Supabase, productos de Apple, correo de soporte)
- `nube.js`: sesión, perfil, decisiones, ayudas e IA
- `privacidad/`, `terminos/`, `soporte/`: páginas que pide la App Store

## Pasos pendientes (una sola vez)
1. Base de datos: ya creada (tablas, reglas y funciones `explicar` y `apple` subidas).
2. Supabase → Authentication → URL Configuration: Site URL `https://compensa-gray.vercel.app` y añadir `https://compensa-gray.vercel.app/**` en Redirect URLs.
3. Supabase → Edge Functions → Secrets: `ANTHROPIC_API_KEY`, `APPLE_IAP_KEY`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID` (los mismos valores que en Borna).
4. Apple Developer → Identifiers: `group.almara.compensa`.
5. App Store Connect: crear la app Compensa y el grupo de suscripción «Compensa Pro» con `compensa.mensual` (4,99 €) y `compensa.anual` (29,99 €, 1 semana gratis). En «Información de la app», URL de notificaciones del servidor (V2): `https://isnmzdchriayjopeklom.supabase.co/functions/v1/apple`.
6. Codemagic: añadir el repositorio `compensa` y lanzar «Compensa iOS → TestFlight».

## Ayudas
Se editan en Supabase → Table Editor → `ayudas` (tipo, ámbito, nombre, importe, quién, dónde, plazo, url). La app las lee al abrirse.
