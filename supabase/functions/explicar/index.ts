// Compensa · «Explícamelo» con IA.
// Recibe solo las cifras de la simulación (nada personal) y devuelve una explicación corta en español.
// Límites (los decide la base de datos con usar_ia): 3 gratis por cuenta; con Pro, hasta IA_MAX_DIA al día.
//
// Secretos (Supabase → Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   clave de la API de Claude (console.anthropic.com)
//   ANTHROPIC_MODEL     opcional; por defecto claude-sonnet-5-5
//   IA_MAX_DIA          opcional; explicaciones al día con Pro (por defecto 30)
// Se despliega con «Verify JWT» ACTIVADO: solo la llaman usuarios con sesión.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const salir = (o: unknown, estado = 200) => new Response(JSON.stringify(o), { status: estado, headers: cors });

const SISTEMA = `Eres el asistente de Compensa, una app española que ayuda a jóvenes a decidir si independizarse (seguir en casa de sus padres, alquilar solo, compartir piso, vivir en pareja o comprar su primer piso).
Te llegan las cifras de una simulación con dos opciones (A y B). Explica en español de España, de tú, claro y cercano, qué opción le compensa más y por qué.

Formato (texto plano, sin títulos ni tablas, máximo 170 palabras):
- 3 a 5 líneas que empiecen por "- ", cada una con una idea concreta y una cifra.
- Una última línea que empiece por "Conclusión:" con una recomendación prudente.
Puedes poner **negrita** en alguna cifra clave.

Reglas:
- Usa SOLO las cifras que te dan. No inventes precios, ayudas ni datos nuevos.
- Si la vivienda pasa del 30 % del sueldo, dilo: es la referencia habitual para no ir ahogado.
- Si una opción se queda sin ahorros en algún mes, avísalo claramente.
- Si usa el Bono Alquiler Joven, recuerda que dura 2 años y después se paga el alquiler entero.
- Si hay hipoteca, menciona que parte de la cuota es ahorro (el piso queda en propiedad) pero que hay gastos e imprevistos.
- No des consejos de inversión ni de productos financieros concretos. Es orientativo.`;

function limpiar(v: unknown, prof = 0): unknown {
  // Solo números, booleanos y textos cortos; nada de objetos enormes
  if (prof > 3) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (typeof v === "boolean" || v === null) return v;
  if (typeof v === "string") return v.slice(0, 40);
  if (Array.isArray(v)) return v.slice(0, 10).map((x) => limpiar(x, prof + 1));
  if (typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 30)) o[k.slice(0, 40)] = limpiar(x, prof + 1);
    return o;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return salir({ error: "solo POST" }, 405);

  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return salir({ error: "Sin sesión", codigo: "sin_sesion" }, 401);
  const supa = Deno.env.get("SUPABASE_URL") || "";
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const clave = Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (!clave) return salir({ error: "Falta configurar la IA en el servidor (ANTHROPIC_API_KEY).", codigo: "sin_clave" }, 500);

  let cuerpo: Record<string, unknown>;
  try { cuerpo = await req.json(); } catch (_e) { return salir({ error: "Petición no válida" }, 400); }
  const datos = limpiar(cuerpo.datos);
  if (!datos || typeof datos !== "object") return salir({ error: "Faltan los datos de la simulación" }, 400);

  const cab = { apikey, Authorization: auth, "Content-Type": "application/json" };
  const max = Math.max(1, Math.min(200, Number(Deno.env.get("IA_MAX_DIA")) || 30));
  const ru = await fetch(supa + "/rest/v1/rpc/usar_ia", { method: "POST", headers: cab, body: JSON.stringify({ p_max: max }) });
  if (!ru.ok) return salir({ error: "No se ha podido comprobar la cuenta (" + ru.status + ")" }, 500);
  const permiso = await ru.json();
  if (permiso === "gratis_agotado") return salir({ error: "Ya has usado tus explicaciones gratis.", codigo: "gratis_agotado" }, 402);
  if (permiso === "limite") return salir({ error: `Has llegado al máximo de ${max} explicaciones de hoy.`, codigo: "limite" }, 429);
  if (permiso !== "ok") return salir({ error: "Sesión no válida", codigo: "sin_sesion" }, 401);

  const ra = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": clave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
      max_tokens: 700,
      system: SISTEMA,
      messages: [{ role: "user", content: "Cifras de la simulación (euros al mes salvo que se indique; «anos» es el horizonte en años):\n" + JSON.stringify(datos, null, 1) }],
    }),
  });
  if (!ra.ok) {
    console.log("anthropic", ra.status, (await ra.text()).slice(0, 300));
    return salir({ error: "La IA no ha respondido. Inténtalo en un momento.", codigo: "ia" }, 502);
  }
  const j = await ra.json();
  const texto = (j.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("\n").trim();

  let gratis: number | null = null;
  try {
    const rp = await fetch(supa + "/rest/v1/rpc/mi_perfil", { method: "POST", headers: cab, body: "{}" });
    if (rp.ok) { const p = await rp.json(); gratis = p && !p.pro ? Number(p.ia_gratis) : null; }
  } catch (_e) { /* no importa */ }

  return salir({ texto: texto.slice(0, 3000), gratis });
});
