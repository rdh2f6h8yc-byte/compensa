import UIKit
import Capacitor

/// Pantalla principal de la app: la de Capacitor más el plugin propio de compras de Apple.
class CompensaViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(CompraApplePlugin())
    }

    /// Las páginas de privacidad, condiciones y ayuda están en carpetas (/privacidad/, /terminos/, /soporte/).
    /// El enrutador de Capacitor manda cualquier ruta sin extensión al index.html de la raíz,
    /// así que se usa uno que sirve la index.html de cada carpeta.
    override open func router() -> Router {
        return CompensaRouter()
    }
}

/// Sirve la index.html de cada carpeta; si la carpeta no existe, la de la raíz.
struct CompensaRouter: Router {
    var basePath: String = ""

    func route(for path: String) -> String {
        let url = URL(fileURLWithPath: path)
        guard url.pathExtension.isEmpty else { return basePath + path }

        var carpeta = path.isEmpty ? "/" : path
        if !carpeta.hasSuffix("/") { carpeta += "/" }
        let candidata = basePath + carpeta + "index.html"
        if FileManager.default.fileExists(atPath: candidata) { return candidata }
        return basePath + "/index.html"
    }
}
