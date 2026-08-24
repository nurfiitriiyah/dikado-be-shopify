const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const normalizeShop = (value) => value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
const shop = normalizeShop(required('SHOPIFY_SHOP_DOMAIN'));
const apiVersion = required('SHOPIFY_API_VERSION');
const serviceName = process.env.SHOPIFY_CARRIER_SERVICE_NAME || 'Dikado RajaOngkir';
const supabaseUrl = required('SUPABASE_URL').replace(/\/+$/, '');
const callbackSecret = required('SHOPIFY_CARRIER_CALLBACK_SECRET');
if (callbackSecret.length < 32) throw new Error('SHOPIFY_CARRIER_CALLBACK_SECRET must contain at least 32 characters');
const callbackUrl = `${supabaseUrl}/functions/v1/shopify-app-proxy/carrier-rates?token=${encodeURIComponent(callbackSecret)}`;

if (!/^https:\/\//.test(callbackUrl)) throw new Error('Carrier callback URL must use HTTPS');

async function accessToken() {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: required('SHOPIFY_API_KEY'),
      client_secret: required('SHOPIFY_API_SECRET'),
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) throw new Error('Unable to authenticate with Shopify Admin API');
  const scopes = new Set(String(payload.scope || '').split(',').map((scope) => scope.trim()).filter(Boolean));
  const missing = ['read_shipping', 'write_shipping'].filter((scope) => !scopes.has(scope));
  if (missing.length) throw new Error(`The installed app has not granted ${missing.join(', ')}`);
  return payload.access_token;
}

async function adminGraphql(token, query, variables = {}) {
  const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(`Shopify Admin API failed with HTTP ${response.status}`);
  if (payload.errors?.length) throw new Error(`Shopify GraphQL error: ${payload.errors.map((error) => error.message).join('; ')}`);
  return payload.data;
}

const token = await accessToken();
const list = await adminGraphql(token, `#graphql
  query DikadoCarrierServices {
    carrierServices(first: 50) {
      nodes {
        id
        name
      }
    }
  }
`);

const matches = (list.carrierServices?.nodes || []).filter((service) => service.name === serviceName);
if (matches.length > 1) console.warn(`Found ${matches.length} carrier services named ${serviceName}; only the first one will be updated.`);

let result;
if (matches[0]) {
  result = await adminGraphql(token, `#graphql
    mutation UpdateDikadoCarrierService($input: DeliveryCarrierServiceUpdateInput!) {
      carrierServiceUpdate(input: $input) {
        carrierService {
          id
          name
        }
        userErrors {
          field
          message
        }
      }
    }
  `, { input: { id: matches[0].id, name: serviceName, callbackUrl, active: true } });
  const errors = result.carrierServiceUpdate?.userErrors || [];
  if (errors.length) throw new Error(`CarrierService update failed: ${errors.map((error) => `${error.field?.join('.') || 'input'}: ${error.message}`).join('; ')}`);
  console.log(`Updated active CarrierService ${result.carrierServiceUpdate.carrierService.id} (${serviceName}).`);
} else {
  result = await adminGraphql(token, `#graphql
    mutation CreateDikadoCarrierService($input: DeliveryCarrierServiceCreateInput!) {
      carrierServiceCreate(input: $input) {
        carrierService {
          id
          name
        }
        userErrors {
          field
          message
        }
      }
    }
  `, { input: { name: serviceName, callbackUrl, active: true, supportsServiceDiscovery: false } });
  const errors = result.carrierServiceCreate?.userErrors || [];
  if (errors.length) throw new Error(`CarrierService creation failed: ${errors.map((error) => `${error.field?.join('.') || 'input'}: ${error.message}`).join('; ')}`);
  console.log(`Created active CarrierService ${result.carrierServiceCreate.carrierService.id} (${serviceName}).`);
}
