import assert from 'node:assert/strict';
import test from 'node:test';
import { planFields } from '../scripts/setup-element-metafields.mjs';

const characterDefinitionId = 'gid://shopify/MetaobjectDefinition/2';
const category = { key: 'category', name: 'Category', type: { name: 'single_line_text_field' } };

test('reuses existing category and plans two missing fields', () => {
  const plan = planFields([category], characterDefinitionId);
  assert.deepEqual(plan.map(({ action }) => action), ['exists', 'create', 'create']);
  assert.equal(plan[0].definition.key, 'category');
  assert.equal(plan[2].definition.type, 'list.metaobject_reference');
  assert.equal(plan[2].definition.validations[0].value, characterDefinitionId);
});

test('second setup is idempotent', () => {
  const existing = [
    category,
    { key: 'element_compatibility', type: { name: 'single_line_text_field' } },
    { key: 'compatible_character_ids', type: { name: 'list.metaobject_reference' } },
  ];
  assert.deepEqual(planFields(existing, characterDefinitionId).map(({ action }) => action), ['exists', 'exists', 'exists']);
});

test('does not create a parallel category field', () => {
  assert.throws(() => planFields([], characterDefinitionId), /parallel category field/);
});

test('does not overwrite an incompatible existing field', () => {
  const existing = [category, { key: 'element_compatibility', type: { name: 'number_integer' } }];
  assert.throws(() => planFields(existing, characterDefinitionId), /refusing to overwrite/);
});
