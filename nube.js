// Compensa · conexión con Supabase (sesión, perfil, decisiones, ayudas e IA). Sin librerías externas.
"use strict";
window.Nube = (() => {
  const C = window.COMPENSA_CONFIG || {};
  const URLB = String(C.supabaseUrl || "").replace(/\/+$/, "");
  const KEY = String(C.supabaseAnonKey || "");
  const SK = "compensa-sesion";
  const configurado = () => /^https:\/\//.test(URLB) && KEY.length > 30;

  const leer = () => { try { return JSON.parse(localStorage.getItem(SK)); } catch (e) { return null; } };
  const escribir = s => { try { s ? localStorage.setItem(SK, JSON.stringify(s)) : localStorage.removeItem(SK); } catch (e) {} };
  const guardar = r => escribir({
    access_token: r.access_token, refresh_token: r.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (Number(r.expires_in) || 3600),
    user: { id: r.user && r.user.id, email: r.user && r.user.email }
  });

  async function pedir(path, opt = {}, ms = 12000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(URLB + path, { ...opt, signal: ctl.signal }); }
    finally { clearTimeout(t); }
  }
  async function json(r) { return r.json().catch(() => ({})); }
  function error(j, r) {
    const m = j.error_description || j.msg || j.message || j.error || ("Error " + r.status);
    return new Error(traducir(String(m)));
  }
  function traducir(m) {
    const t = {
      "Invalid login credentials": "Correo o contraseña incorrectos.",
      "Email not confirmed": "Todavía no has confirmado tu correo. Mira tu bandeja de entrada (y la de spam).",
      "User already registered": "Ya hay una cuenta con ese correo. Entra con tu contraseña.",
      "Password should be at least 6 characters.": "La contraseña tiene que tener al menos 6 caracteres."
    };
    for (const k in t) if (m.indexOf(k) === 0) return t[k];
    if (/rate limit/i.test(m)) return "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
    if (/abort/i.test(m)) return "No hay conexión o el servidor tarda en responder.";
    return m;
  }

  const enApp = () => { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch (e) { return false; } };
  const web = () => (C.webUrl || location.origin).replace(/\/+$/, "");
  const volver = tipo => enApp() ? web() + "/abrir/?r=" + tipo : web() + "/?" + tipo + "=1";

  // ---------- Sesión ----------
  async function token() {
    const s = leer();
    if (!s || !s.access_token) return null;
    if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
    const r = await pedir("/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    });
    if (!r.ok) { if (r.status === 400 || r.status === 401) escribir(null); return null; }
    guardar(await json(r));
    return leer().access_token;
  }
  async function entrar(email, password) {
    const r = await pedir("/auth/v1/token?grant_type=password", {
      method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const j = await json(r);
    if (!r.ok) throw error(j, r);
    guardar(j);
    return j.user;
  }
  // Devuelve {sesion:true} si entra directamente o {confirmar:true} si hay que confirmar el correo
  async function registrar(email, password) {
    const ir = encodeURIComponent(volver("confirmado"));
    const r = await pedir("/auth/v1/signup?redirect_to=" + ir, {
      method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const j = await json(r);
    if (!r.ok) throw error(j, r);
    if (j.access_token) { guardar(j); return { sesion: true }; }
    return { confirmar: true };
  }
  async function recuperar(email) {
    const ir = encodeURIComponent(volver("nueva"));
    const r = await pedir("/auth/v1/recover?redirect_to=" + ir, {
      method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    if (!r.ok) throw error(await json(r), r);
  }
  async function cambiarClave(password) {
    const tk = await token();
    if (!tk) throw new Error("Tu sesión ha caducado. Vuelve a pedir el enlace.");
    const r = await pedir("/auth/v1/user", {
      method: "PUT", headers: { apikey: KEY, Authorization: "Bearer " + tk, "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    if (!r.ok) throw error(await json(r), r);
  }
  // Enlaces del correo (confirmación o nueva contraseña): la sesión llega en el # de la dirección
  function sesionDesdeEnlace(fragmento) {
    const desdeUrl = typeof fragmento === "string";
    const h = new URLSearchParams(String(desdeUrl ? fragmento : location.hash).replace(/^#/, ""));
    if (h.get("error_description")) return { error: h.get("error_description").replace(/\+/g, " ") };
    if (!h.get("access_token")) return null;
    guardar({ access_token: h.get("access_token"), refresh_token: h.get("refresh_token"),
      expires_in: Number(h.get("expires_in")) || 3600, user: {} });
    if (!desdeUrl) history.replaceState(null, "", location.pathname + location.search);
    return { tipo: h.get("type") || "" };
  }
  async function completarUsuario() {
    const tk = await token(); if (!tk) return null;
    const r = await pedir("/auth/v1/user", { headers: { apikey: KEY, Authorization: "Bearer " + tk } });
    if (!r.ok) return null;
    const u = await json(r), s = leer();
    if (s) { s.user = { id: u.id, email: u.email }; escribir(s); }
    return s && s.user;
  }
  async function salir() {
    const tk = await token().catch(() => null);
    escribir(null);
    if (tk) pedir("/auth/v1/logout", { method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + tk } }).catch(() => {});
  }
  const usuario = () => { const s = leer(); return s && s.user && s.user.id ? s.user : null; };

  // ---------- Datos ----------
  async function cab(conSesion = true) {
    const h = { apikey: KEY, "Content-Type": "application/json" };
    if (conSesion) {
      const tk = await token();
      if (!tk) throw new Error("Tienes que entrar en tu cuenta.");
      h.Authorization = "Bearer " + tk;
    }
    return h;
  }
  async function rpc(nombre, cuerpo = {}) {
    const r = await pedir("/rest/v1/rpc/" + nombre, { method: "POST", headers: await cab(), body: JSON.stringify(cuerpo) });
    const j = await json(r);
    if (!r.ok) throw error(j, r);
    return j;
  }
  const perfil = () => rpc("mi_perfil");
  const guardarComunidad = c => rpc("guardar_comunidad", { p: c });
  const marcarAyudasVistas = () => rpc("marcar_ayudas_vistas");
  const borrarCuenta = async () => { await rpc("borrar_mi_cuenta"); escribir(null); };

  async function ayudas() {
    const r = await pedir("/rest/v1/ayudas?select=id,tipo,ambito,nombre,importe,quien,donde,plazo,url,plantilla,revisada,creada&order=orden.asc,id.asc",
      { headers: await cab(false) }, 8000);
    if (!r.ok) throw error(await json(r), r);
    return json(r);
  }
  async function decisiones() {
    const r = await pedir("/rest/v1/decisiones?select=id,nombre,datos,actualizado&order=actualizado.desc", { headers: await cab() });
    if (!r.ok) throw error(await json(r), r);
    return json(r);
  }
  async function guardarDecision(nombre, datos, id) {
    const h = await cab(); h.Prefer = "return=representation";
    const cuerpo = JSON.stringify({ nombre: String(nombre).slice(0, 60), datos, actualizado: new Date().toISOString() });
    const r = id
      ? await pedir("/rest/v1/decisiones?id=eq." + encodeURIComponent(id), { method: "PATCH", headers: h, body: cuerpo })
      : await pedir("/rest/v1/decisiones", { method: "POST", headers: h, body: cuerpo });
    const j = await json(r);
    if (!r.ok) {
      if (r.status === 403 || /row-level security/i.test(JSON.stringify(j))) { const e = new Error("limite"); e.codigo = "limite"; throw e; }
      throw error(j, r);
    }
    return Array.isArray(j) ? j[0] : j;
  }
  async function borrarDecision(id) {
    const r = await pedir("/rest/v1/decisiones?id=eq." + encodeURIComponent(id), { method: "DELETE", headers: await cab() });
    if (!r.ok) throw error(await json(r), r);
  }
  // Funciones del servidor (IA y compras de Apple)
  async function funcion(nombre, cuerpo, ms = 30000) {
    const r = await pedir("/functions/v1/" + nombre, { method: "POST", headers: await cab(), body: JSON.stringify(cuerpo || {}) }, ms);
    const j = await json(r);
    if (!r.ok) { const e = new Error(j.error || ("Error " + r.status)); e.codigo = j.codigo || ""; e.status = r.status; throw e; }
    return j;
  }

  return { configurado, enApp, usuario, entrar, registrar, recuperar, cambiarClave, sesionDesdeEnlace, completarUsuario, salir,
    perfil, guardarComunidad, marcarAyudasVistas, borrarCuenta, ayudas, decisiones, guardarDecision, borrarDecision, funcion };
})();
