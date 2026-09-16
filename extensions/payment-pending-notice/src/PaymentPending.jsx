/** @jsxImportSource preact */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const API_BASE = 'https://bpefhxamltfxunxfvnwc.supabase.co/functions/v1/shopify-app-proxy/customer-account';

export default async () => {
  render(<PaymentPendingNotice />, document.body);
};

function PaymentPendingNotice() {
  const [paymentPending, setPaymentPending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadPaymentStatus(controller.signal)
      .then((result) => setPaymentPending(result.payment_pending === true))
      .catch((error) => {
        if (error?.name !== 'AbortError') console.error('[Dikado payment status]', error);
      });
    return () => controller.abort();
  }, []);

  if (!paymentPending) return null;

  return (
    <s-announcement>
      <s-text>
        Menunggu pembayaran. Pesanan akan diproses setelah pembayaran berhasil.
      </s-text>
    </s-announcement>
  );
}

async function loadPaymentStatus(signal) {
  const token = await shopify.sessionToken.get();
  const orderId = encodeURIComponent(shopify.order.value.id);
  const response = await fetch(`${API_BASE}/orders/${orderId}/payment-status`, {
    signal,
    headers: {Authorization: `Bearer ${token}`},
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to load payment status.');
  return payload.data || {};
}
