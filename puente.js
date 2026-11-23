// En la app de iPhone, Capacitor solo inyecta su puente nativo: la función registerPlugin()
// viene del paquete @capacitor/core, que esta web no carga. Sin ella no se pueden usar los plugins
// (compra con Apple, abrir la app desde el correo). Este apaño la define a partir del puente.
(function () {
  if (typeof window === "undefined") return;
  var C = window.Capacitor;
  if (!C || typeof C.registerPlugin === "function") return;
  C.registerPlugin = function (nombre) {
    var P = C.Plugins && C.Plugins[nombre];
    if (P) return P;
    return new Proxy({}, {
      get: function (_, metodo) {
        if (metodo === "then" || typeof metodo !== "string") return undefined;
        if (metodo === "addListener") {
          return function (evento, cb) {
            var id = C.nativeCallback(nombre, "addListener", { eventName: evento }, cb);
            return Promise.resolve({ remove: function () { return C.nativePromise(nombre, "removeListener", { callbackId: id, eventName: evento }); } });
          };
        }
        return function (opciones) { return C.nativePromise(nombre, metodo, opciones || {}); };
      }
    });
  };
})();
