(function () {
  'use strict';

  function rootPath() {
    return (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';
  }

  function getCart() {
    return fetch(rootPath() + 'cart.js', { headers: { 'Accept': 'application/json' } }).then(function (response) {
      if (!response.ok) throw new Error('Could not read cart.');
      return response.json();
    });
  }

  function parseArray(value) {
    if (!value) return [];
    try {
      var parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function expectedFees(properties) {
    var zoneIds = parseArray(properties._front_zones).map(String);
    var zoneLabels = parseArray(properties._front_zone_labels);
    var feeVariantIds = parseArray(properties._front_fee_variant_ids);
    var bundleVersion = Number(properties._bundle_version || 1);
    var isMultiVersion = bundleVersion >= 2 && zoneIds.length > 0;

    if (!isMultiVersion) {
      zoneIds = [String(properties._front_zone || 'front')];
      zoneLabels = [properties._front_zone || 'Front'];
      feeVariantIds = [properties._fee_variant_id];
    }

    var fees = zoneIds.map(function (zoneId, index) {
      return {
        side: 'front',
        zone: zoneId,
        label: zoneLabels[index] || zoneId,
        variantId: Number(feeVariantIds[index] || (index === 0 ? properties._fee_variant_id : 0))
      };
    });

    if (properties._has_back === 'true') {
      var backZoneIds = bundleVersion >= 3 ? parseArray(properties._back_zones).map(String) : [];
      var backZoneLabels = parseArray(properties._back_zone_labels);
      var backFeeVariantIds = parseArray(properties._back_fee_variant_ids);
      if (!backZoneIds.length) {
        backZoneIds = [String(properties._back_zone || 'back')];
        backZoneLabels = ['Back'];
        backFeeVariantIds = [properties._back_fee_variant_id || (!isMultiVersion ? properties._fee_variant_id : 0)];
      }
      backZoneIds.forEach(function (zoneId, index) {
        fees.push({
          side: 'back',
          zone: zoneId,
          label: backZoneLabels[index] || zoneId,
          variantId: Number(backFeeVariantIds[index] || (index === 0 ? properties._back_fee_variant_id : 0))
        });
      });
    }

    var declared = Number(properties._expected_fee_lines || fees.length);
    if (Number.isFinite(declared) && declared !== fees.length) {
      throw new Error('A customized item has inconsistent fee metadata. Remove it and customize the product again.');
    }
    return fees;
  }

  async function ensureBundleIntegrity() {
    var cart = await getCart();
    var feeLinesByDesign = {};
    var productLines = [];
    var updates = {};
    var additions = [];

    cart.items.forEach(function (item) {
      var properties = item.properties || {};
      var designId = properties._design_id;
      if (!designId) return;
      if (properties._item_type === 'print_fee') {
        if (!feeLinesByDesign[designId]) feeLinesByDesign[designId] = [];
        feeLinesByDesign[designId].push(item);
      } else if (properties._item_type === 'product') {
        productLines.push(item);
      }
    });

    if (productLines.length) {
      if (!window.CustomDesignStorage) throw new Error('Design validation is unavailable. Checkout has been blocked.');
      await window.CustomDesignStorage.validate(Array.from(new Set(productLines.map(function (item) {
        return item.properties._design_id;
      }))));
    }

    productLines.forEach(function (productItem) {
      var properties = productItem.properties || {};
      var designId = properties._design_id;
      var feeLines = feeLinesByDesign[designId] || [];
      var expected = expectedFees(properties);
      var usedKeys = new Set();

      expected.forEach(function (expectedFee) {
        var existing = feeLines.find(function (fee) {
          var feeProperties = fee.properties || {};
          return !usedKeys.has(fee.key) && feeProperties._side === expectedFee.side &&
            String(feeProperties._zone || '') === expectedFee.zone;
        });
        if (existing && Number(existing.variant_id) !== expectedFee.variantId) {
          updates[existing.key] = 0;
          existing = null;
        }
        if (existing) {
          usedKeys.add(existing.key);
          if (existing.quantity !== productItem.quantity) updates[existing.key] = productItem.quantity;
          return;
        }
        if (!expectedFee.variantId) {
          throw new Error('A customization fee is missing and this cart item cannot be repaired. Remove it and customize the product again.');
        }
        additions.push({
          id: expectedFee.variantId,
          quantity: productItem.quantity,
          properties: {
            '_design_id': designId,
            '_custom_group_id': designId,
            '_item_type': 'print_fee',
            '_side': expectedFee.side,
            '_zone': expectedFee.zone,
            'Print side': expectedFee.side === 'back' ? 'Back' : 'Front',
            'Print area': expectedFee.label
          }
        });
      });

      feeLines.forEach(function (fee) {
        if (!usedKeys.has(fee.key)) updates[fee.key] = 0;
      });
      delete feeLinesByDesign[designId];
    });

    Object.keys(feeLinesByDesign).forEach(function (designId) {
      feeLinesByDesign[designId].forEach(function (fee) { updates[fee.key] = 0; });
    });

    if (Object.keys(updates).length) {
      var updateResponse = await fetch(rootPath() + 'cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ updates: updates })
      });
      if (!updateResponse.ok) throw new Error('Could not synchronize customization fees.');
    }

    if (additions.length) {
      var addResponse = await fetch(rootPath() + 'cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ items: additions })
      });
      if (!addResponse.ok) throw new Error('Could not restore missing customization fees.');
    }

    return { changed: additions.length > 0 || Object.keys(updates).length > 0 };
  }

  async function removeDesign(designId, button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      var cartResponse = await fetch(rootPath() + 'cart.js', { headers: { 'Accept': 'application/json' } });
      if (!cartResponse.ok) throw new Error('Could not read cart.');
      var cart = await cartResponse.json();
      var updates = {};
      cart.items.forEach(function (item) {
        if (item.properties && item.properties._design_id === designId) updates[item.key] = 0;
      });
      if (!Object.keys(updates).length) return;
      var updateResponse = await fetch(rootPath() + 'cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ updates: updates })
      });
      if (!updateResponse.ok) throw new Error('Could not remove the custom item.');
      window.location.reload();
    } catch (error) {
      console.error(error);
      button.disabled = false;
      button.removeAttribute('aria-busy');
      window.alert(error.message || 'Could not remove custom item.');
    }
  }


  async function updateDesignQuantity(designId, quantity, input) {
    quantity = parseInt(quantity, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      input.value = input.dataset.previousValue || '1';
      return;
    }
    input.disabled = true;
    try {
      var cartResponse = await fetch(rootPath() + 'cart.js', { headers: { 'Accept': 'application/json' } });
      if (!cartResponse.ok) throw new Error('Could not read cart.');
      var cart = await cartResponse.json();
      var updates = {};
      cart.items.forEach(function (item) {
        if (item.properties && item.properties._design_id === designId) updates[item.key] = quantity;
      });
      var response = await fetch(rootPath() + 'cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ updates: updates })
      });
      if (!response.ok) throw new Error('Could not update custom bundle quantity.');
      window.location.reload();
    } catch (error) {
      console.error(error);
      input.disabled = false;
      input.value = input.dataset.previousValue || input.value;
      window.alert(error.message || 'Could not update custom bundle quantity.');
    }
  }

  document.addEventListener('change', function (event) {
    var input = event.target.closest('[data-custom-design-quantity]');
    if (!input) return;
    input.dataset.previousValue = input.defaultValue || input.value;
    updateDesignQuantity(input.dataset.customDesignQuantity, input.value, input);
  });

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-remove-custom-design]');
    if (!button) return;
    event.preventDefault();
    removeDesign(button.dataset.removeCustomDesign, button);
  });

  document.addEventListener('submit', async function (event) {
    var form = event.target;
    if (!form || form.id !== 'cart-form' || form.dataset.bundleIntegrityChecked === 'true') return;
    var submitter = event.submitter;
    if (!submitter || submitter.name !== 'checkout') return;
    // Checkout selection (and the hamper flow that delegates to it) calls the
    // same integrity check from its serialized prepare step. Let it own the
    // submit event so both async handlers cannot mutate the cart concurrently.
    if (window.CartCheckoutSelection) return;
    event.preventDefault();
    submitter.disabled = true;
    submitter.setAttribute('aria-busy', 'true');
    try {
      var result = await ensureBundleIntegrity();
      if (result.changed) {
        window.location.reload();
        return;
      }
      form.dataset.bundleIntegrityChecked = 'true';
      form.requestSubmit(submitter);
    } catch (error) {
      console.error(error);
      submitter.disabled = false;
      submitter.removeAttribute('aria-busy');
      window.alert(error.message || 'Please check the custom items before checkout.');
    }
  }, true);

  window.CustomCartBundle = {
    ensureIntegrity: ensureBundleIntegrity
  };
})();
