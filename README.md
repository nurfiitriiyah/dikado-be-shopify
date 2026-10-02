# Dikado Shopify App and Customer Account Extensions

This directory contains the Shopify app configuration used by Dikado, two Preact customer-account UI extensions, and administrative scripts for CarrierService and product element metafields. The storefront theme and Supabase backend live in the repository root; start with the [project README](../README.md) for the complete architecture and deployment order.

## Included components

| Path | Purpose |
| --- | --- |
| `shopify.app.toml` | App identity, scopes, API version, and App Proxy configuration |
| `extensions/customer-addresses/` | Direct-linked customer-account address page |
| `extensions/payment-pending-notice/` | Order-status notice and Midtrans payment-resume UI |
| `scripts/register-carrier-service.mjs` | Idempotent CarrierService create/update script |
| `scripts/setup-element-metafields.mjs` | Product compatibility and character-element definition setup |
| `tests/setup-element-metafields.test.mjs` | Regression test for definition setup |

The app is extension-only and non-embedded. Sensitive business logic remains in the Supabase `shopify-app-proxy` Edge Function.

## Requirements

- Node.js and npm (no Node version is pinned in this repository)
- Shopify CLI authenticated to an authorized development store
- Access to the correct Shopify app and store
- A deployed or locally reachable Supabase Edge Function for extension API calls
- Approved Shopify scopes and protected customer-data access where required

Install the locked dependencies:

```sh
npm ci
```

## Development and validation

Start a Shopify development session:

```sh
npm run dev
```

Other repository-defined commands are:

```sh
npm run build
npm run info
npm run generate
npm run deploy
npm run test:element-metafields
```

Validate app configuration directly with Shopify CLI when needed:

```sh
shopify app config validate --json
```

`npm run deploy` changes Shopify app configuration and extensions. Run it only for an explicitly approved target.

## Customer-account extensions

### Dikado addresses

`extensions/customer-addresses` renders a direct-linked customer-account page. It retrieves the RajaOngkir location hierarchy and stores validated customer addresses through direct `/customer-account/*` Edge Function routes. Requests use Shopify customer-account session tokens rather than storefront App Proxy signatures.

The documented first version supports listing and inserting addresses. It does not yet replace Shopify's native address book or claim complete edit/delete synchronization. Setup and verification are in [Customer Account address page](../docs/customer-account-addresses.md).

### Dikado payment status

`extensions/payment-pending-notice` renders on the customer-account order-status page. It shows the current payment state and participates in the Midtrans payment-resume flow backed by the Edge Function. The root regression tests cover customer-account payment status and payment resume behavior.

Both extensions declare network access. Keep all API credentials in Supabase; no server secret belongs in extension source or built assets.

## Shopify App Proxy and scopes

The app configuration exposes the storefront path `/apps/dikado-address`, which forwards signed requests to the Supabase Edge Function. The committed configuration requests customer, product, shipping, order, App Proxy, and metaobject-definition access required by the implemented routes and scripts.

When scopes change:

1. Validate the app configuration.
2. Deploy it to the approved environment.
3. Review and approve the changed permissions on the store.
4. Verify the newly issued Admin API token contains the expected scopes before deploying dependent backend behavior.

Do not place a static Admin access token in this repository. The backend uses the app credentials according to its server-side implementation.

## Environment variables for administrative scripts

Set values in the current shell or an approved secret manager. Do not commit a `.env` file containing real values.

| Variable | Safe example | Used by |
| --- | --- | --- |
| `SHOPIFY_API_KEY` | `<SHOPIFY_API_KEY>` | Shopify authentication |
| `SHOPIFY_API_SECRET` | `<SHOPIFY_API_SECRET>` | Shopify authentication |
| `SHOPIFY_SHOP_DOMAIN` | `<SHOPIFY_STORE_DOMAIN>` | Target-store allowlist |
| `SHOPIFY_API_VERSION` | `<SHOPIFY_API_VERSION>` | Admin API version |
| `SUPABASE_URL` | `<SUPABASE_URL>` | Carrier callback base URL |
| `SHOPIFY_CARRIER_CALLBACK_SECRET` | `<WEBHOOK_SECRET>` | Carrier callback protection |
| `SHOPIFY_CARRIER_SERVICE_NAME` | `<CARRIER_SERVICE_NAME>` | Optional service name override |
| `SHOPIFY_ENV` | `development` | Product-definition safety guard |

The scripts may require only a subset of these variables; each script validates its own required inputs.

## CarrierService registration

Before registration, deploy the Edge Function, approve the app's shipping scopes, confirm the store is eligible for CarrierService, and configure a safe Shopify backup rate.

```sh
SHOPIFY_API_KEY='<SHOPIFY_API_KEY>' \
SHOPIFY_API_SECRET='<SHOPIFY_API_SECRET>' \
SHOPIFY_SHOP_DOMAIN='<SHOPIFY_STORE_DOMAIN>' \
SHOPIFY_API_VERSION='<SHOPIFY_API_VERSION>' \
SUPABASE_URL='<SUPABASE_URL>' \
SHOPIFY_CARRIER_CALLBACK_SECRET='<WEBHOOK_SECRET>' \
npm run register:carrier-service
```

The script queries existing services before creating or updating the named service. Registration does not configure the Shopify shipping profile or backup rate; complete those merchant-side steps separately. See [Dikado pre-checkout and native Shopify shipping](../docs/dikado-precheckout.md).

## Product compatibility and element metafields

Dress-up elements use the existing Shopify metaobject model (`character_item`, `character`, `character_pose`, and `character_item_asset`). The setup script reuses the existing `character_item.category` field and creates missing compatibility fields without modifying entry values.

Preview the operation:

```sh
SHOPIFY_ENV=development npm run setup:element-metafields
```

Apply it to an approved development store:

```sh
SHOPIFY_ENV=development npm run setup:element-metafields -- --apply
```

Run the apply command again to confirm the operation is idempotent: existing definitions should be reported rather than duplicated. The script's production guard requires an explicit override; use it only after separate production approval.

Expected fields on `character_item` are:

- `category`
- `element_compatibility`
- `compatible_character_ids`

Missing legacy category data is treated by storefront code as accessories, while existing pose-specific assets retain precedence. Run `npm run test:element-metafields` after changing the setup script.

## Deployment

Follow the repository-level [deployment sequence](../README.md#deployment-sequence). For this directory specifically:

```sh
npm ci
npm run test:element-metafields
npm run build
shopify app config validate --json
npm run deploy
```

After deployment, approve scope changes, activate the customer-account extensions in Shopify Admin, and verify direct links, order-status rendering, CarrierService, webhooks, and payment resume against the intended environment.

## Security and troubleshooting

- Never expose Shopify secrets, Supabase service-role keys, RajaOngkir keys, Midtrans keys, webhook secrets, or callback secrets in this directory.
- Treat committed app identifiers and extension UIDs as configuration identifiers, not authentication credentials; still avoid copying environment-specific values into documentation examples.
- If App Proxy calls fail, verify the deployed proxy URL, canonical shop domain, signature secret, and store installation.
- If an extension receives `401`, verify session-token audience, app client ID, shop claim, customer subject, protected customer-data approval, and the backend route.
- If CarrierService registration fails, verify plan eligibility, `read_shipping`/`write_shipping`, callback URL construction, and app installation scopes.
- If element setup is rejected, verify the metaobject-definition scopes and that `SHOPIFY_ENV=development` is set for a development store.
- Removing a credential from this README does not remove it from Git history. Revoke and rotate any credential that was ever committed.
