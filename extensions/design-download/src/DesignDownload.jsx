/** @jsxImportSource preact */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const API_BASE = 'https://bpefhxamltfxunxfvnwc.supabase.co/functions/v1/shopify-app-proxy/customer-account';
const designRequests = new Map();

export default async () => {
  render(<DesignDownload />, document.body);
};

function DesignDownload() {
  const line = shopify.target.value;
  const orderId = shopify.order.value?.id || '';
  const variantId = line.merchandise.id;
  const customization = attributeValue(line.attributes, 'Customization').toLowerCase();
  const isCustomProduct = customization.includes('custom design') || Boolean(
    attributeValue(line.attributes, 'Front print areas') ||
    attributeValue(line.attributes, 'Back print areas') ||
    attributeValue(line.attributes, 'Area bordir'),
  );
  const [state, setState] = useState({status: 'loading', design: null, message: ''});

  useEffect(() => {
    if (!isCustomProduct) {
      setState({status: 'hidden', design: null, message: ''});
      return;
    }
    if (!orderId || !variantId) {
      setState({status: 'error', design: null, message: 'Data order belum tersedia.'});
      return;
    }

    let active = true;
    setState({status: 'loading', design: null, message: ''});
    loadDesign(orderId, variantId)
      .then((design) => {
        if (active) setState({status: 'ready', design, message: ''});
      })
      .catch((error) => {
        if (active) {
          setState({
            status: 'error',
            design: null,
            message: error?.message || 'Desain belum dapat diunduh.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [isCustomProduct, orderId, variantId]);

  if (state.status === 'hidden') return null;
  if (state.status === 'loading') {
    return (
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-spinner size="small" accessibilityLabel="Menyiapkan download desain" />
        <s-text color="subdued">Menyiapkan download desain...</s-text>
      </s-stack>
    );
  }
  if (state.status === 'error') {
    return <s-text color="subdued">{state.message}</s-text>;
  }

  const {front_url: frontUrl, back_url: backUrl} = state.design;
  if (!frontUrl) return null;

  return (
    <s-stack direction="block" gap="small">
      <s-text type="strong">Desain custom</s-text>
      <s-button-group>
        <s-button href={frontUrl} variant="secondary">
          {backUrl ? 'Download desain depan' : 'Download desain'}
        </s-button>
        {backUrl ? (
          <s-button href={backUrl} variant="secondary">
            Download desain belakang
          </s-button>
        ) : null}
      </s-button-group>
    </s-stack>
  );
}

function attributeValue(attributes, key) {
  return attributes?.find((attribute) => attribute.key === key)?.value || '';
}

function loadDesign(orderId, variantId) {
  const requestKey = `${orderId}:${variantId}`;
  if (!designRequests.has(requestKey)) {
    designRequests.set(requestKey, requestDesign(orderId, variantId));
  }
  return designRequests.get(requestKey);
}

async function requestDesign(orderId, variantId) {
  const token = await shopify.sessionToken.get();
  const query = new URLSearchParams({
    order_id: orderId,
    variant_id: variantId,
    occurrence: '0',
  });
  const response = await fetch(`${API_BASE}/orders/design-download?${query}`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Desain belum dapat diunduh.');
  return payload.data || {};
}
