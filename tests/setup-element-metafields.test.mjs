import assert from 'node:assert/strict';
import test from 'node:test';
import { planDefinitions } from '../scripts/setup-element-metafields.mjs';

const itemDefinitionId = 'gid://shopify/MetaobjectDefinition/1';
const characterDefinitionId = 'gid://shopify/MetaobjectDefinition/2';
const constraint = {
  key: 'metaobject_definition_id',
  values: { nodes: [{ value: itemDefinitionId }] },
};

test('plans all three definitions when none exist', () => {
  const plan = planDefinitions([], itemDefinitionId, characterDefinitionId);
  assert.deepEqual(plan.map(({ action }) => action), ['create', 'create', 'create']);
  assert.equal(plan[2].definition.type, 'list.metaobject_reference');
  assert.equal(plan[2].definition.validations[0].value, characterDefinitionId);
});

test('second setup is idempotent', () => {
  const existing = [
    ['element_category', 'single_line_text_field'],
    ['element_compatibility', 'single_line_text_field'],
    ['compatible_character_ids', 'list.metaobject_reference'],
  ].map(([key, name], index) => ({
    id: `gid://shopify/MetafieldDefinition/${index + 1}`,
    namespace: 'custom', key, type: { name }, constraints: constraint,
  }));
  assert.deepEqual(
    planDefinitions(existing, itemDefinitionId, characterDefinitionId).map(({ action }) => action),
    ['exists', 'exists', 'exists'],
  );
});

test('does not overwrite an incompatible existing definition', () => {
  const existing = [{
    id: 'gid://shopify/MetafieldDefinition/1', namespace: 'custom', key: 'element_category',
    type: { name: 'number_integer' }, constraints: constraint,
  }];
  assert.throws(
    () => planDefinitions(existing, itemDefinitionId, characterDefinitionId),
    /refusing to overwrite/,
  );
});
