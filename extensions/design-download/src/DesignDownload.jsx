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
  const itemType = attributeValue(line.attributes, '_item_type', 'Item Type');
  const designId = attributeValue(line.attributes, '_design_id', 'Design ID');
  const photoUploadId = attributeValue(line.attributes, '_photo_upload_id', 'Photo Upload ID') ||
    attributeValue(line.attributes, '_dikado_photo_upload_id', 'Dikado Photo Upload ID');
  const fileKind = itemType === 'print_fee' ? '' : designId ? 'design' : photoUploadId ? 'photo' : '';
  const [state, setState] = useState({status: 'loading', data: null});

  useEffect(() => {
    if (!fileKind) {
      setState({status: 'hidden', data: null});
      return;
    }
    const fileId = designId || photoUploadId;
    if (!orderId || !fileId) {
      setState({status: 'error', data: null});
      return;
    }

    let active = true;
    setState({status: 'loading', data: null});
    loadFiles(orderId, fileKind, fileId)
      .then((data) => {
        if (active) setState({status: 'ready', data});
      })
      .catch(() => {
        if (active) {
          setState({status: 'error', data: null});
        }
      });
    return () => {
      active = false;
    };
  }, [fileKind, orderId, designId, photoUploadId]);

  if (state.status === 'hidden') return null;
  if (state.status === 'loading') {
    return (
      <s-stack direction="inline" gap="small" alignItems="center">
        <s-spinner size="small" accessibilityLabel="Menyiapkan file download" />
        <s-text color="subdued">Menyiapkan file download...</s-text>
      </s-stack>
    );
  }
  if (state.status === 'error') {
    return <MissingMessage kind={fileKind} side="front" />;
  }

  if (state.data.kind === 'photo') {
    const original = state.data.files.original;
    return original?.url ? (
      <s-link href={original.url}>Download foto asli</s-link>
    ) : <MissingMessage kind="photo" />;
  }
  if (state.data.kind !== 'design') {
    return <MissingMessage kind={fileKind} side="front" />;
  }

  const {front, back} = state.data.files;

  return (
    <s-stack direction="block" gap="small">
      <s-stack direction="inline" gap="base">
        {front?.url ? <s-link href={front.url}>Download desain depan</s-link> : null}
        {back?.url ? (
          <s-link href={back.url}>
            Download desain belakang
          </s-link>
        ) : null}
      </s-stack>
      {!front?.url ? <MissingMessage kind="design" side="front" /> : null}
      {back && !back.url ? <MissingMessage kind="design" side="back" /> : null}
    </s-stack>
  );
}

function MissingMessage({kind, side}) {
  const message = kind === 'photo'
    ? 'File tidak ditemukan, silakan '
    : `File desain ${side === 'back' ? 'belakang' : 'depan'} tidak ditemukan, silakan `;
  return <s-text color="subdued">{message}<s-link href="/pages/contact">hubungi admin</s-link>.</s-text>;
}

function attributeValue(attributes, ...keys) {
  return attributes?.find((attribute) => keys.includes(attribute.key))?.value || '';
}

function loadFiles(orderId, fileType, fileId) {
  const requestKey = `${orderId}:${fileType}:${fileId}`;
  if (!designRequests.has(requestKey)) {
    designRequests.set(requestKey, requestFiles(orderId, fileType, fileId));
  }
  return designRequests.get(requestKey);
}

async function requestFiles(orderId, fileType, fileId) {
  const token = await shopify.sessionToken.get();
  const query = new URLSearchParams({
    order_id: orderId,
    file_type: fileType,
    file_id: fileId,
  });
  const response = await fetch(`${API_BASE}/orders/design-download?${query}`, {
    headers: {Authorization: `Bearer ${token}`},
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Desain belum dapat diunduh.');
  return payload.data || {};
}
