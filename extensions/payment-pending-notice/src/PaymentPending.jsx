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
  const [paymentUrl, setPaymentUrl] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    loadPaymentStatus(controller.signal)
      .then(async (result) => {
        const pending = result.payment_pending === true;
        setPaymentPending(pending);
        if (!pending) return;
        if (result.payment_url) return setPaymentUrl(result.payment_url);
        const prepared = await preparePayment(controller.signal);
        if (prepared.payment_url) setPaymentUrl(prepared.payment_url);
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.error('[Dikado payment status]', error?.message || 'Payment status unavailable');
      });
    return () => controller.abort();
  }, []);

  if (!paymentPending) return null;

  return (
    <s-announcement>
      <s-text>
        Menunggu pembayaran. Pesanan akan diproses setelah pembayaran berhasil.
        {paymentUrl ? (
          <>
            {' '}
            <s-link href={paymentUrl} target="_blank">
              Lanjutkan pembayaran
            </s-link>
          </>
        ) : null}
      </s-text>
    </s-announcement>
  );
}

async function loadPaymentStatus(signal) {
  const token = await shopify.sessionToken.get();
  const query = new URLSearchParams({order_id: shopify.order.value.id});
  const response = await fetch(`${API_BASE}/orders/payment-status?${query}`, {
    signal,
    headers: {Authorization: `Bearer ${token}`},
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Unable to load payment status.');
  return payload.data || {};
}

async function preparePayment(signal) {
  const token = await shopify.sessionToken.get();
  const response = await fetch(`${API_BASE}/orders/payment-resume`, {
    method: 'POST',
    signal,
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({order_id: shopify.order.value.id}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return {};
  return payload.data || {};
}
