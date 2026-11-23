import Foundation
import UIKit
import Capacitor
import StoreKit

/// Suscripción Compensa Pro con la compra dentro de la app (StoreKit 2).
/// Desde la web se llama como Capacitor.registerPlugin("CompraApple").
/// El servidor (función «apple» de Supabase) confirma cada compra con Apple antes de activar Pro en la cuenta.
@objc(CompraApplePlugin)
public class CompraApplePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CompraApplePlugin"
    public let jsName = "CompraApple"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "productos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "comprar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restaurar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "gestionar", returnType: CAPPluginReturnPromise)
    ]

    private var escucha: Task<Void, Never>?

    override public func load() {
        // Renovaciones y compras que terminan con la app abierta (por ejemplo, aprobadas por «Pedir permiso»)
        escucha = Task.detached { [weak self] in
            for await resultado in Transaction.updates {
                guard case .verified(let t) = resultado else { continue }
                await t.finish()
                self?.notifyListeners("transaccion", data: ["transactionId": String(t.originalID), "id": t.productID])
            }
        }
    }

    deinit { escucha?.cancel() }

    private func unidad(_ u: Product.SubscriptionPeriod.Unit) -> String {
        switch u {
        case .day: return "dia"
        case .week: return "semana"
        case .month: return "mes"
        case .year: return "año"
        @unknown default: return "otro"
        }
    }

    @objc func productos(_ call: CAPPluginCall) {
        let ids = (call.options["ids"] as? [String]) ?? []
        Task {
            do {
                let lista = try await Product.products(for: ids).map { p -> [String: Any] in
                    var o: [String: Any] = ["id": p.id, "nombre": p.displayName, "precio": p.displayPrice,
                                            "importe": NSDecimalNumber(decimal: p.price).doubleValue]
                    if let s = p.subscription {
                        o["periodo"] = self.unidad(s.subscriptionPeriod.unit)
                        o["periodos"] = s.subscriptionPeriod.value
                        if let intro = s.introductoryOffer, intro.paymentMode == .freeTrial {
                            o["prueba"] = intro.period.value
                            o["pruebaUnidad"] = self.unidad(intro.period.unit)
                        }
                    }
                    return o
                }
                call.resolve(["productos": lista])
            } catch {
                call.reject("No se han podido cargar los precios de App Store: \(error.localizedDescription)")
            }
        }
    }

    @objc func comprar(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let txt = call.getString("cuenta"), let cuenta = UUID(uuidString: txt) else {
            call.reject("Faltan datos para la compra")
            return
        }
        Task {
            do {
                guard let p = try await Product.products(for: [id]).first else {
                    call.reject("Esta suscripción no está disponible en App Store")
                    return
                }
                let r = try await p.purchase(options: [.appAccountToken(cuenta)])
                switch r {
                case .success(let v):
                    switch v {
                    case .verified(let t):
                        await t.finish()
                        call.resolve(["estado": "ok", "transactionId": String(t.originalID), "id": t.productID])
                    case .unverified(_, let error):
                        call.reject("Apple no ha podido verificar la compra: \(error.localizedDescription)")
                    }
                case .userCancelled:
                    call.resolve(["estado": "cancelada"])
                case .pending:
                    call.resolve(["estado": "pendiente"])
                @unknown default:
                    call.resolve(["estado": "desconocido"])
                }
            } catch {
                call.reject("No se ha podido completar la compra: \(error.localizedDescription)")
            }
        }
    }

    @objc func restaurar(_ call: CAPPluginCall) {
        Task {
            try? await AppStore.sync()
            var lista: [[String: Any]] = []
            for await r in Transaction.currentEntitlements {
                if case .verified(let t) = r, t.productType == .autoRenewable {
                    lista.append(["transactionId": String(t.originalID), "id": t.productID,
                                  "cuenta": t.appAccountToken?.uuidString ?? ""])
                }
            }
            call.resolve(["compras": lista])
        }
    }

    @objc func gestionar(_ call: CAPPluginCall) {
        Task { @MainActor in
            if let escena = self.bridge?.viewController?.view.window?.windowScene {
                do {
                    try await AppStore.showManageSubscriptions(in: escena)
                    call.resolve()
                    return
                } catch { /* si falla, se abre la página de suscripciones de Apple */ }
            }
            if let u = URL(string: "https://apps.apple.com/account/subscriptions") {
                _ = await UIApplication.shared.open(u)
            }
            call.resolve()
        }
    }
}
