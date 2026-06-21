import { CreditCard, History, QrCode } from "lucide-react";

export function App() {
  return (
    <main className="app-shell">
      <section className="toolbar">
        <div>
          <p className="eyebrow">MVP local</p>
          <h1>Cobros QR</h1>
        </div>
        <div className="status-pill">merchant-local</div>
      </section>

      <section className="workspace">
        <form className="payment-form">
          <div className="section-title">
            <CreditCard size={18} />
            <h2>Crear cobro</h2>
          </div>
          <label>
            Monto
            <input inputMode="decimal" placeholder="25000" />
          </label>
          <label>
            Referencia
            <input placeholder="ORDER-2026-001" />
          </label>
          <label>
            Descripcion
            <textarea placeholder="Compra en comercio" />
          </label>
          <button type="button">Generar QR</button>
        </form>

        <section className="payment-panel">
          <div className="section-title">
            <QrCode size={18} />
            <h2>Pago activo</h2>
          </div>
          <div className="qr-placeholder">QR</div>
          <p className="muted">El primer flujo conectara este panel con POST /v1/payments y SSE.</p>
        </section>

        <section className="history-panel">
          <div className="section-title">
            <History size={18} />
            <h2>Historial</h2>
          </div>
          <p className="muted">Listado paginado por cursor, filtros por estado, fecha y referencia.</p>
        </section>
      </section>
    </main>
  );
}
