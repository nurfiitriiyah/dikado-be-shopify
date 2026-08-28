import { pathToFileURL } from 'node:url';

export const ELEMENT_DEFINITIONS = [
  {
    namespace: 'custom',
    key: 'element_category',
    name: 'Element category',
    type: 'single_line_text_field',
    validations: [{ name: 'choices', value: JSON.stringify(['accessories', 'nature', 'food', 'objects']) }],
  },
  {
    namespace: 'custom',
    key: 'element_compatibility',
    name: 'Element compatibility',
    type: 'single_line_text_field',
    validations: [{ name: 'choices', value: JSON.stringify(['universal', 'character-specific']) }],
  },
];

export const normalizeShop = (value) => value.trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');

export function definitionAppliesTo(definition, metaobjectDefinitionId) {
  if (!definition.constraints) return true;
  if (definition.constraints.key !== 'metaobject_definition_id') return false;
  return (definition.constraints.values?.nodes || []).some(({ value }) => value === metaobjectDefinitionId);
}

export function planDefinitions(existing, itemDefinitionId, characterDefinitionId) {
  const desired = [
    ...ELEMENT_DEFINITIONS,
    {
      namespace: 'custom',
      key: 'compatible_character_ids',
      name: 'Compatible characters',
      type: 'list.metaobject_reference',
      validations: [{ name: 'metaobject_definition_id', value: characterDefinitionId }],
    },
  ];

  return desired.map((definition) => {
    const matchingKey = existing.filter((candidate) =>
      candidate.namespace === definition.namespace && candidate.key === definition.key
    );
    const found = matchingKey.find((candidate) => definitionAppliesTo(candidate, itemDefinitionId));
    if (!found) return { action: 'create', definition };
    const existingType = found.type?.name || found.type;
    if (existingType !== definition.type) {
      throw new Error(`${definition.namespace}.${definition.key} exists with type ${existingType}, expected ${definition.type}; refusing to overwrite it.`);
    }
    return { action: 'exists', definition, id: found.id };
  });
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
    query DikadoElementMetafieldSetup {
      itemDefinition: metaobjectDefinitionByType(type: "character_item") { id type }
      characterDefinition: metaobjectDefinitionByType(type: "character") { id type }
      metafieldDefinitions(first: 100, ownerType: METAOBJECT, namespace: "custom") {
        nodes {
          id
          namespace
          key
          type { name }
          constraints {
            key
            values(first: 100) { nodes { value } }
          }
        }
      }
    }
  `);

  if (!data.itemDefinition) throw new Error('Metaobject definition character_item was not found. No parallel resource will be created.');
  if (!data.characterDefinition) throw new Error('Metaobject definition character was not found; compatible characters cannot be referenced safely.');

  const plan = planDefinitions(
    data.metafieldDefinitions?.nodes || [],
    data.itemDefinition.id,
    data.characterDefinition.id,
  );

  for (const item of plan) {
    const qualifiedKey = `${item.definition.namespace}.${item.definition.key}`;
    if (item.action === 'exists') {
      console.log(`EXISTS ${qualifiedKey} (${item.id})`);
      continue;
    }
    if (!apply) {
      console.log(`WOULD_CREATE ${qualifiedKey} (${item.definition.type})`);
      continue;
    }

    const result = await adminGraphql(shop, apiVersion, token, `#graphql
      mutation CreateDikadoElementMetafield($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id namespace key type { name } }
          userErrors { field message code }
        }
      }
    `, {
      definition: {
        ...item.definition,
        ownerType: 'METAOBJECT',
        constraints: { key: 'metaobject_definition_id', values: [data.itemDefinition.id] },
      },
    });
    const payload = result.metafieldDefinitionCreate;
    if (payload.userErrors?.length) {
      throw new Error(`${qualifiedKey}: ${payload.userErrors.map(({ message, code }) => `${code || 'ERROR'} ${message}`).join('; ')}`);
    }
    console.log(`CREATED ${qualifiedKey} (${payload.createdDefinition.id}, ${payload.createdDefinition.type.name})`);
  }

  console.log(apply ? 'Element metafield setup complete.' : 'Dry run complete; no definitions were changed. Re-run with --apply to create missing definitions.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Element metafield setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
