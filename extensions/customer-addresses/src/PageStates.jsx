/** @jsxImportSource preact */

export function FullScreenLoader({message = 'Memuat halaman…'}) {
  return (
    <s-page>
      <s-box blockSize="100%" padding="base" accessibilityRole="status">
        <s-stack direction="block" blockSize="100%" justifyContent="center" alignItems="center" gap="base">
          <s-spinner size="large-100" accessibilityLabel={message} />
          <s-text>{message}</s-text>
          <s-paragraph color="subdued">Bentar ya, kita siapin semuanya dulu ✨</s-paragraph>
        </s-stack>
      </s-box>
    </s-page>
  );
}

export function FullScreenError({message, onRetry}) {
  return (
    <s-page>
      <s-box blockSize="100%" padding="base" accessibilityRole="alert">
        <s-stack direction="block" blockSize="100%" justifyContent="center" alignItems="center" gap="base">
          <s-banner heading="Halaman belum dapat dimuat" tone="critical">
            {message}
          </s-banner>
          <s-button variant="primary" onClick={onRetry}>Coba lagi</s-button>
        </s-stack>
      </s-box>
    </s-page>
  );
}
