import { pathToFileURL } from 'node:url';

export const ELEMENT_FIELDS = [{
  key: 'element_compatibility',
  name: 'Element compatibility',
  type: 'single_line_text_field',
  validations: [{ name: 'choices', value: JSON.stringify(['universal', 'character-specific']) }],
}];

export const normalizeShop = (value) => value.trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');

export function planFields(existing, characterDefinitionId) {
  const desired = [...ELEMENT_FIELDS, {
    key: 'compatible_character_ids',
    name: 'Compatible characters',
    type: 'list.metaobject_reference',
    validations: [{ name: 'metaobject_definition_id', value: characterDefinitionId }],
  }];
  const category = existing.find(({ key }) => key === 'category');
  if (!category) throw new Error('Expected existing character_item.category field was not found; refusing to create a parallel category field.');
  if ((category.type?.name || category.type) !== 'single_line_text_field') {
    throw new Error('character_item.category has an unexpected type; refusing to overwrite it.');
  }
  return [
    { action: 'exists', definition: { key: 'category', name: category.name, type: 'single_line_text_field' } },
    ...desired.map((definition) => {
      const found = existing.find(({ key }) => key === definition.key);
      if (!found) return { action: 'create', definition };
      const existingType = found.type?.name || found.type;
      if (existingType !== definition.type) {
        throw new Error(`${definition.key} exists with type ${existingType}, expected ${definition.type}; refusing to overwrite it.`);
      }
      return { action: 'exists', definition };
    }),
  ];
}

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

async function accessToken(shop) {
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
  if (!scopes.has('write_metaobject_definitions')) {
    throw new Error('The installed app has not granted write_metaobject_definitions; redeploy and reinstall/update the app first.');
  }
  return payload.access_token;
}

async function adminGraphql(shop, apiVersion, token, query, variables = {}) {
  const response = await fetch(`https://${shop}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': token },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(`Shopify Admin API failed with HTTP ${response.status}`);
  if (payload.errors?.length) throw new Error(`Shopify GraphQL error: ${payload.errors.map(({ message }) => message).join('; ')}`);
  return payload.data;
}

export async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes('--apply');
  const confirmProduction = argv.includes('--confirm-production');
  const shop = normalizeShop(required('SHOPIFY_SHOP_DOMAIN'));
  const apiVersion = required('SHOPIFY_API_VERSION');
  const environment = String(process.env.SHOPIFY_ENV || '').trim().toLowerCase();
  if (apply && environment !== 'development' && !confirmProduction) {
    throw new Error('Refusing to mutate a shop not marked SHOPIFY_ENV=development. Pass --confirm-production only after explicit approval.');
  }

  const token = await accessToken(shop);
  const data = await adminGraphql(shop, apiVersion, token, `#graphql
    query DikadoElementFieldSetup {
      itemDefinition: metaobjectDefinitionByType(type: "character_item") {
        id type fieldDefinitions { name key type { name } }
      }
      characterDefinition: metaobjectDefinitionByType(type: "character") { id type }
    }
  `);
  if (!data.itemDefinition) throw new Error('Metaobject definition character_item was not found. No parallel resource will be created.');
  if (!data.characterDefinition) throw new Error('Metaobject definition character was not found; compatible characters cannot be referenced safely.');

  const plan = planFields(data.itemDefinition.fieldDefinitions || [], data.characterDefinition.id);
  const missing = plan.filter(({ action }) => action === 'create');
  plan.filter(({ action }) => action === 'exists').forEach(({ definition }) => {
    console.log(`EXISTS character_item.${definition.key} (${definition.type})`);
  });
  if (!missing.length) {
    console.log('Element field setup complete; nothing to create.');
    return;
  }
  if (!apply) {
    missing.forEach(({ definition }) => console.log(`WOULD_CREATE character_item.${definition.key} (${definition.type})`));
    console.log('Dry run complete; no fields were changed. Re-run with --apply to create missing fields.');
    return;
  }

  const result = await adminGraphql(shop, apiVersion, token, `#graphql
    mutation UpdateDikadoCharacterItemDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
      metaobjectDefinitionUpdate(id: $id, definition: $definition) {
        metaobjectDefinition { id type fieldDefinitions { name key type { name } } }
        userErrors { field message code }
      }
    }
  `, {
    id: data.itemDefinition.id,
    definition: { fieldDefinitions: missing.map(({ definition }) => ({ create: definition })) },
  });
  const payload = result.metaobjectDefinitionUpdate;
  if (payload.userErrors?.length) {
    throw new Error(payload.userErrors.map(({ message, code }) => `${code || 'ERROR'} ${message}`).join('; '));
  }
  missing.forEach(({ definition }) => console.log(`CREATED character_item.${definition.key} (${definition.type})`));
  console.log('Element field setup complete.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Element field setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
