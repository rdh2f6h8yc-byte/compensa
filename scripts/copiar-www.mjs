// Copia la web (lo que publica Vercel) a www/ para empaquetarla con Capacitor.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destino = path.join(raiz, "www");
const saltar = new Set(["node_modules", "www", ".git", "android", "ios", "scripts", "supabase", "resources", "appstore", "codemagic.yaml", "vercel.json", "README.md"]);

function copiar(desde, hacia) {
  for (const nombre of fs.readdirSync(desde)) {
    if (saltar.has(nombre) || nombre.startsWith(".")) continue;
    if (nombre === "package.json" || nombre === "package-lock.json" || nombre === "capacitor.config.json") continue;
    const a = path.join(desde, nombre);
    const b = path.join(hacia, nombre);
    if (fs.statSync(a).isDirectory()) {
      fs.mkdirSync(b, { recursive: true });
      copiar(a, b);
    } else fs.copyFileSync(a, b);
  }
}

fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });
copiar(raiz, destino);
console.log("www listo");
