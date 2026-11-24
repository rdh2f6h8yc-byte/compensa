// Compensa · suscripción Pro comprada dentro de la app de iPhone (App Store).
// Función de Supabase llamada "apple". Hace dos cosas:
//   ?accion=verificar  la app la llama justo después de comprar o al «Restaurar compras» (con la sesión del usuario)
//   (sin acción)       Apple la avisa de renovaciones, cancelaciones y reembolsos (App Store Server Notifications V2)
// En los dos casos el estado se pregunta SIEMPRE a Apple (App Store Server API); nunca se fía de lo que llega.
//
// Secretos (Supabase → Edge Functions → Secrets), los mismos valores que en Borna:
//   APPLE_IAP_KEY        contenido del archivo .p8 de la clave de compras dentro de la app
//   APPLE_IAP_KEY_ID     ID de esa clave
//   APPLE_IAP_ISSUER_ID  Issuer ID
//   APPLE_BUNDLE_ID      opcional; por defecto group.almara.compensa
//   APPLE_PRODUCTOS      opcional; por defecto compensa.mensual,compensa.anual
// Se despliega con «Verify JWT» DESACTIVADO (quien avisa es Apple). La sesión del usuario se comprueba aquí.

const DIAS_DE_MARGEN = 2;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const salir = (o: unknown, estado = 200) => new Response(JSON.stringify(o), { status: estado, headers: cors });
const esUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const BUNDLE = () => Deno.env.get("APPLE_BUNDLE_ID") || "group.almara.compensa";
const PRODUCTOS = () => (Deno.env.get("APPLE_PRODUCTOS") || "compensa.mensual,compensa.anual").split(",").map((s) => s.trim()).filter(Boolean);

function b64url(datos: Uint8Array | string) {
  const b = typeof datos === "string" ? new TextEncoder().encode(datos) : datos;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// Lee la parte central de un JWS de Apple (sin comprobar la firma: solo se usa con datos pedidos a Apple
// por HTTPS, o para saber qué transacción hay que preguntarle a Apple)
function carga(jws: unknown): Record<string, unknown> {
  if (typeof jws !== "string") return {};
  const p = jws.split(".")[1] || "";
  try {
    const t = atob(p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(t, (c) => c.charCodeAt(0))));
  } catch (_e) { return {}; }
}

// Token para la App Store Server API (ES256 con la clave .p8)
async function tokenApple() {
  const pem = (Deno.env.get("APPLE_IAP_KEY") || "").replace(/-----[^-]+-----/g, "").replace(/\\n/g, "").replace(/\s/g, "");
  const kid = (Deno.env.get("APPLE_IAP_KEY_ID") || "").trim(), iss = (Deno.env.get("APPLE_IAP_ISSUER_ID") || "").trim();
  if (!pem || !kid || !iss) throw new Error("Faltan los secretos APPLE_IAP_KEY, APPLE_IAP_KEY_ID o APPLE_IAP_ISSUER_ID");
  // Comprobaciones de formato para que un secreto mal copiado dé un mensaje claro (sin mostrar su valor)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(iss)) throw new Error("APPLE_IAP_ISSUER_ID no es un Issuer ID (debe ser un código largo con guiones)");
  if (!/^[A-Z0-9]{10}$/.test(kid)) throw new Error("APPLE_IAP_KEY_ID no parece un Key ID (10 letras y números)");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  let clave: CryptoKey;
  try { clave = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]); }
  catch (_e) { throw new Error("APPLE_IAP_KEY no es una clave .p8 válida (copia el archivo entero)"); }
  const ahora = Math.floor(Date.now() / 1000);
  const datos = b64url(JSON.stringify({ alg: "ES256", kid, typ: "JWT" })) + "." +
    b64url(JSON.stringify({ iss, iat: ahora, exp: ahora + 1200, aud: "appstoreconnect-v1", bid: BUNDLE() }));
  const firma = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, clave, new TextEncoder().encode(datos)));
  return datos + "." + b64url(firma);
}

type Estado = { original: string; producto: string; cuenta: string | null; estado: string; hasta: string | null; entorno: string };

// Pregunta a Apple el estado actual de la suscripción (producción y, si no está allí, pruebas/sandbox)
async function estadoEnApple(transaccion: string): Promise<Estado | null> {
  const tok = await tokenApple();
  for (const [entorno, base] of [["produccion", "https://api.storekit.itunes.apple.com"], ["pruebas", "https://api.storekit-sandbox.itunes.apple.com"]]) {
    const r = await fetch(base + "/inApps/v1/subscriptions/" + encodeURIComponent(transaccion), { headers: { Authorization: "Bearer " + tok } });
    if (r.status === 404) continue;
    // Mientras la app no está publicada, el entorno de producción responde 401 aunque la clave esté bien:
    // en ese caso se pregunta al de pruebas, y solo si allí también falla es un problema de la clave.
    if (r.status === 401 && entorno === "produccion") continue;
    if (r.status === 401) throw new Error("Apple responde 401: no acepta la clave. Revisa que APPLE_IAP_KEY sea el .p8 de la clave de compras, APPLE_IAP_KEY_ID su Key ID y APPLE_IAP_ISSUER_ID el Issuer ID");
    if (!r.ok) throw new Error("Apple responde " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json();
    if (j.bundleId && j.bundleId !== BUNDLE()) throw new Error("La compra es de otra app");
    const ultimas = (j.data || []).flatMap((g: { lastTransactions?: unknown[] }) => g.lastTransactions || []) as
      Array<{ originalTransactionId: string; status: number; signedTransactionInfo: string }>;
    if (!ultimas.length) return null;
    const u = ultimas.find((x) => x.originalTransactionId === transaccion) || ultimas[0];
    const t = carga(u.signedTransactionInfo);
    const producto = String(t.productId || "");
    if (!PRODUCTOS().includes(producto)) throw new Error("Producto desconocido: " + producto);
    const expira = Number(t.expiresDate) || 0;
    let estado = "otro", hasta: string | null = null;
    if (u.status === 1 || u.status === 4) { estado = "active"; hasta = new Date(expira + DIAS_DE_MARGEN * 86400000).toISOString(); }
    else if (u.status === 2) { estado = "expired"; hasta = new Date(expira || Date.now()).toISOString(); }
    else if (u.status === 5) { estado = "revoked"; hasta = new Date(Number(t.revocationDate) || Date.now()).toISOString(); }
    // 3 = Apple sigue intentando cobrar: no se toca la fecha
    return { original: String(t.originalTransactionId || u.originalTransactionId), producto, cuenta: esUuid(t.appAccountToken) ? String(t.appAccountToken).toLowerCase() : null, estado, hasta, entorno };
  }
  return null;
}

function claveSupabase() {
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); if (k && k.default) return k.default; } catch (_e) { /* sin claves nuevas */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
async function registrar(usuario: string | null, e: Estado) {
  const k = claveSupabase();
  const cab: Record<string, string> = { apikey: k, "Content-Type": "application/json" };
  if (!k.startsWith("sb_")) cab.Authorization = "Bearer " + k;
  const r = await fetch((Deno.env.get("SUPABASE_URL") || "") + "/rest/v1/rpc/registrar_apple", {
    method: "POST", headers: cab,
    body: JSON.stringify({ p_usuario: usuario, p_original: e.original, p_producto: e.producto, p_hasta: e.hasta, p_estado: e.estado, p_entorno: e.entorno }),
  });
  if (!r.ok) throw new Error("no se ha podido guardar: " + r.status + " " + (await r.text()).slice(0, 200));
  return await r.json();
}

// ¿Sigue existiendo la cuenta a la que se asoció la compra? Si se borró, la suscripción queda libre
async function cuentaExiste(id: string) {
  if (!esUuid(id)) return true;
  const k = claveSupabase();
  const cab: Record<string, string> = { apikey: k };
  if (!k.startsWith("sb_")) cab.Authorization = "Bearer " + k;
  try {
    const r = await fetch((Deno.env.get("SUPABASE_URL") || "") + "/auth/v1/admin/users/" + id, { headers: cab });
    await r.body?.cancel();
    return r.status !== 404;
  } catch (_e) { return true; }
}

// La app, después de comprar o al restaurar: comprueba la sesión y activa Pro en esa cuenta
async function verificar(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return salir({ error: "Sin sesión" }, 401);
  const supa = Deno.env.get("SUPABASE_URL") || "";
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const ru = await fetch(supa + "/auth/v1/user", { headers: { apikey, Authorization: auth } });
  if (!ru.ok) return salir({ error: "Sesión no válida" }, 401);
  const usuario = await ru.json();
  if (!usuario || !esUuid(usuario.id)) return salir({ error: "Sesión no válida" }, 401);
  const yo = String(usuario.id).toLowerCase();
  let cuerpo: Record<string, unknown> = {};
  try { cuerpo = await req.json(); } catch (_e) { /* vacío */ }
  const ids = (Array.isArray(cuerpo.transacciones) ? cuerpo.transacciones : [cuerpo.transactionId])
    .filter((x) => typeof x === "string" && /^\d{1,30}$/.test(x)).slice(0, 5) as string[];
  if (!ids.length) return salir({ error: "Falta la compra" }, 400);
  let ultimo: Estado | null = null, ajena = false;
  for (const id of ids) {
    const e = await estadoEnApple(id);
    if (!e) continue;
    // Una suscripción de Apple sirve para una sola cuenta: la que se puso al comprar
    if (e.cuenta && e.cuenta !== yo && await cuentaExiste(e.cuenta)) { ajena = true; continue; }
    await registrar(yo, e);
    if (!ultimo || e.estado === "active") ultimo = e;
  }
  if (!ultimo) return salir(ajena ? { error: "Esta suscripción de Apple ya está asociada a otra cuenta de Compensa.", codigo: "ajena" } : { error: "Apple no tiene ninguna suscripción con esa compra", codigo: "sin_compra" }, 404);
  return salir({ ok: true, estado: ultimo.estado, hasta: ultimo.hasta, entorno: ultimo.entorno });
}

// Aviso de Apple (renovación, cancelación, reembolso…)
async function aviso(req: Request) {
  let cuerpo: Record<string, unknown> = {};
  try { cuerpo = await req.json(); } catch (_e) { return salir({ error: "cuerpo no válido" }, 400); }
  const n = carga(cuerpo.signedPayload);
  if (n.notificationType === "TEST") return salir({ ok: true, prueba: true });
  const d = (n.data || {}) as Record<string, unknown>;
  if (d.bundleId && d.bundleId !== BUNDLE()) return salir({ ok: true, ignorado: "otra app" });
  const t = carga(d.signedTransactionInfo);
  const original = String(t.originalTransactionId || "");
  if (!/^\d{1,30}$/.test(original)) return salir({ ok: true, ignorado: "sin transacción" });
  try {
    const e = await estadoEnApple(original);
    if (!e) return salir({ ok: true, ignorado: "Apple no la encuentra" });
    const res = await registrar(e.cuenta, e);
    console.log("apple", n.notificationType, n.subtype || "", e.original, e.estado, e.hasta, res);
    return salir({ ok: true, resultado: res });
  } catch (err) {
    console.log("apple error", String(err));
    return salir({ error: String(err) }, 500); // Apple lo reintentará
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return salir({ error: "solo POST" }, 405);
  try {
    return new URL(req.url).searchParams.get("accion") === "verificar" ? await verificar(req) : await aviso(req);
  } catch (err) {
    return salir({ error: String((err as Error).message || err) }, 500);
  }
});
