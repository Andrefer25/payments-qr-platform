import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, History, QrCode, RefreshCw, XCircle } from "lucide-react";
import {
  cancelPayment,
  confirmPayment,
  createPayment,
  getPayment,
  listPayments,
  type CreatePaymentRequest,
  type Payment,
  type PaymentStatus
} from "../features/payments/payments-api.js";

export function App() {
  const queryClient = useQueryClient();
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);
  const [form, setForm] = useState({
    amount: "25000",
    reference: "ORDER-2026-001",
    description: "Compra en comercio"
  });

  const historyQuery = useQuery({
    queryKey: ["payments"],
    queryFn: listPayments
  });

  const activePaymentQuery = useQuery({
    queryKey: ["payment", activePaymentId],
    queryFn: () => getPayment(activePaymentId!),
    enabled: Boolean(activePaymentId)
  });

  const createMutation = useMutation({
    mutationFn: createPayment,
    onSuccess: async (payment) => {
      setActivePaymentId(payment.paymentId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payments"] }),
        queryClient.invalidateQueries({ queryKey: ["payment", payment.paymentId] })
      ]);
    }
  });

  const confirmMutation = usePaymentAction(confirmPayment, activePaymentId);
  const cancelMutation = usePaymentAction(cancelPayment, activePaymentId);

  const activePayment = activePaymentQuery.data;
  const history = historyQuery.data?.items ?? [];
  const formError = getMutationError(createMutation.error);
  const actionError = getMutationError(confirmMutation.error ?? cancelMutation.error);
  const canSubmit =
    !createMutation.isPending && Number(form.amount) > 0 && form.reference.trim().length > 0;
  const canAct = activePayment?.status === "PENDING";
  const expiresIn = useMemo(
    () => getExpiresIn(activePayment?.expiresAt),
    [activePayment?.expiresAt]
  );

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input: CreatePaymentRequest = {
      amount: Number(form.amount),
      currency: "ARS",
      reference: form.reference.trim(),
      description: form.description.trim() || undefined
    };
    createMutation.mutate(input);
  }

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
        <form className="payment-form" onSubmit={handleSubmit}>
          <div className="section-title">
            <CreditCard size={18} />
            <h2>Crear cobro</h2>
          </div>
          <label>
            Monto
            <input
              inputMode="decimal"
              min="1"
              name="amount"
              type="number"
              value={form.amount}
              onChange={(event) =>
                setForm((current) => ({ ...current, amount: event.target.value }))
              }
            />
          </label>
          <label>
            Referencia
            <input
              name="reference"
              value={form.reference}
              onChange={(event) =>
                setForm((current) => ({ ...current, reference: event.target.value }))
              }
            />
          </label>
          <label>
            Descripcion
            <textarea
              name="description"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>
          {formError ? <p className="error-text">{formError}</p> : null}
          <button type="submit" disabled={!canSubmit}>
            <QrCode size={17} />
            {createMutation.isPending ? "Generando" : "Generar QR"}
          </button>
        </form>

        <section className="payment-panel">
          <div className="section-title">
            <QrCode size={18} />
            <h2>Pago activo</h2>
          </div>
          {activePayment ? (
            <>
              <div className="qr-placeholder">
                <span>QR</span>
                <small>{activePayment.qrPayload}</small>
              </div>
              <div className="payment-summary">
                <StatusBadge status={activePayment.status} />
                <strong>{formatMoney(activePayment.amount)}</strong>
                <span>{activePayment.reference}</span>
                <span>{expiresIn}</span>
              </div>
              {actionError ? <p className="error-text">{actionError}</p> : null}
              <div className="action-row">
                <button
                  className="secondary-button"
                  disabled={!canAct || confirmMutation.isPending}
                  type="button"
                  onClick={() => confirmMutation.mutate(activePayment.paymentId)}
                >
                  <CheckCircle2 size={17} />
                  Confirmar
                </button>
                <button
                  className="danger-button"
                  disabled={!canAct || cancelMutation.isPending}
                  type="button"
                  onClick={() => cancelMutation.mutate(activePayment.paymentId)}
                >
                  <XCircle size={17} />
                  Cancelar
                </button>
              </div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => activePaymentQuery.refetch()}
              >
                <RefreshCw size={17} />
                Refrescar
              </button>
            </>
          ) : (
            <>
              <div className="qr-placeholder empty">QR</div>
              <p className="muted">Genera un cobro para ver el payload QR y operar el estado.</p>
            </>
          )}
        </section>

        <section className="history-panel">
          <div className="section-title">
            <History size={18} />
            <h2>Historial</h2>
          </div>
          {historyQuery.isLoading ? <p className="muted">Cargando operaciones...</p> : null}
          {getQueryError(historyQuery.error) ? (
            <p className="error-text">{getQueryError(historyQuery.error)}</p>
          ) : null}
          <div className="history-list">
            {history.map((payment) => (
              <button
                className="history-item"
                key={payment.paymentId}
                type="button"
                onClick={() => setActivePaymentId(payment.paymentId)}
              >
                <span>
                  <strong>{payment.reference}</strong>
                  <small>{payment.paymentId}</small>
                </span>
                <span>
                  <StatusBadge status={payment.status} />
                  <small>{formatMoney(payment.amount)}</small>
                </span>
              </button>
            ))}
          </div>
          {!historyQuery.isLoading && history.length === 0 ? (
            <p className="muted">Todavia no hay operaciones.</p>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function usePaymentAction(
  action: (paymentId: string) => Promise<Payment>,
  activePaymentId: string | null
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: async (payment) => {
      queryClient.setQueryData(["payment", payment.paymentId], payment);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["payments"] }),
        queryClient.invalidateQueries({ queryKey: ["payment", activePaymentId] })
      ]);
    }
  });
}

function StatusBadge({ status }: { status: PaymentStatus }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}>{status}</span>;
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat("es-AR", {
    currency: "ARS",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(amount);
}

function getExpiresIn(expiresAt?: string) {
  if (!expiresAt) {
    return "";
  }
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) {
    return "Vencido";
  }
  const minutes = Math.floor(diffMs / 60_000);
  const seconds = Math.floor((diffMs % 60_000) / 1000);
  return `Vence en ${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getMutationError(error: unknown) {
  return error instanceof Error ? error.message : null;
}

function getQueryError(error: unknown) {
  return error instanceof Error ? error.message : null;
}
