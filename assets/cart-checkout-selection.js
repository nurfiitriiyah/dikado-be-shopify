(function () {
  'use strict';

  var SELECTION_KEY = 'dikadoCheckoutSelection';
  var RESTORE_KEY = 'dikadoCheckoutRestore';
  var selected = null;
  var preparing = false;
  var prepared = false;
  var initialized = false;
  var knownKeys = new Set();

  function rootPath() {
    return (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';
  }

  function goToPrecheckout() {
    window.location.assign(window.DikadoPrecheckoutUrl || rootPath() + 'pages/checkout-dikado');
  }

  function isCheckoutFlowPath() {
    var path = window.location.pathname;
    return path === '/pages/checkout-dikado' || path === '/pages/custom-chekout' || path === '/checkout' || path.indexOf('/checkouts/') === 0;
  }

  async function cartRequest(path, options) {
    var response = await fetch(rootPath() + path, options);
    var data = await response.json();
    if (!response.ok || data.errors) throw new Error(data.description || data.message || 'Cart request failed.');
    return data;
  }

  function post(path, body) {
    return cartRequest(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function readSelection() {
    if (selected) return selected;
    try {
      var stored = sessionStorage.getItem(SELECTION_KEY);
      selected = stored === null ? null : new Set(JSON.parse(stored));
    } catch (_) {
      selected = null;
    }
    return selected;
  }

  function writeSelection() {
    try { sessionStorage.setItem(SELECTION_KEY, JSON.stringify(Array.from(selected || []))); } catch (_) {}
  }

  function visibleKeys() {
    return Array.from(document.querySelectorAll('[data-cart-checkout-line]')).map(function (input) { return input.value; });
  }

  function initializeSelection() {
    var stored = readSelection();
    var keys = visibleKeys();
    if (stored === null) {
      selected = new Set(keys);
      writeSelection();
    } else if (initialized) {
      // A genuinely new cart line defaults to selected. Section rerenders keep
      // the same line keys and therefore preserve the customer's choice.
      keys.forEach(function (key) { if (!knownKeys.has(key)) selected.add(key); });
    }
    keys.forEach(function (key) { knownKeys.add(key); });
    initialized = true;
    syncInputs();
  }

  function syncInputs() {
    var selection = readSelection() || new Set();
    document.querySelectorAll('[data-cart-checkout-line]').forEach(function (input) {
      input.checked = selection.has(input.value);
    });
    var count = document.querySelectorAll('[data-cart-checkout-line]:checked').length;
    document.querySelectorAll('[name="checkout"]').forEach(function (button) {
      button.disabled = count === 0;
      button.setAttribute('data-selected-count', String(count));
    });
  }

  function onChange(event) {
    var input = event.target.closest('[data-cart-checkout-line]');
    if (!input) return;
    if (!selected) selected = new Set();
    if (input.checked) selected.add(input.value);
    else selected.delete(input.value);
    writeSelection();
    syncInputs();
  }

  function isSelected(key) {
    var selection = readSelection();
    return selection === null || selection.has(key);
  }

  function setSelected(keys) {
    selected = new Set(Array.from(keys || []).map(String));
    prepared = false;
    writeSelection();
    syncInputs();
  }

  function serializeItem(item) {
    var result = {
      id: item.variant_id,
      quantity: item.quantity,
      properties: item.properties || {}
    };
    if (item.selling_plan_allocation && item.selling_plan_allocation.selling_plan) {
      result.selling_plan = item.selling_plan_allocation.selling_plan.id;
    }
    return result;
  }

  async function prepare() {
    if (prepared) return cartRequest('cart.js', { headers: { Accept: 'application/json' } });
    if (preparing) throw new Error('Checkout sedang disiapkan.');
    preparing = true;
    try {
      if (window.DikadoCartSync && typeof window.DikadoCartSync.pauseForCheckout === 'function') {
        window.DikadoCartSync.pauseForCheckout();
      }
      if (window.CustomCartBundle && typeof window.CustomCartBundle.ensureIntegrity === 'function') {
        await window.CustomCartBundle.ensureIntegrity();
      }
      var cart = await cartRequest('cart.js', { headers: { Accept: 'application/json' } });
      var selection = readSelection();
      if (selection === null) return cart;

      var mainItems = cart.items.filter(function (item) {
        var props = item.properties || {};
        return props._item_type !== 'print_fee' && props._hamper_role !== 'packaging';
      });
      var selectedMain = mainItems.filter(function (item) { return selection.has(item.key); });
      if (!selectedMain.length) throw new Error('Pilih minimal satu produk untuk checkout.');

      var selectedDesigns = new Set(selectedMain.map(function (item) {
        return (item.properties || {})._design_id;
      }).filter(Boolean));
      var selectedHamperIds = new Set(selectedMain.map(function (item) {
        return (item.properties || {})._hamper_id;
      }).filter(Boolean));
      var keepKeys = new Set(selectedMain.map(function (item) { return item.key; }));

      cart.items.forEach(function (item) {
        var props = item.properties || {};
        if (props._item_type === 'print_fee' && selectedDesigns.has(props._design_id)) keepKeys.add(item.key);
        if (props._hamper_role === 'packaging' && selectedHamperIds.has(props._hamper_id)) keepKeys.add(item.key);
      });

      var removed = cart.items.filter(function (item) { return !keepKeys.has(item.key); });
      if (!removed.length) {
        prepared = true;
        return cart;
      }
      var restore = {
        cartToken: cart.token,
        createdAt: Date.now(),
        items: removed.map(serializeItem)
      };
      localStorage.setItem(RESTORE_KEY, JSON.stringify(restore));

      var updates = {};
      removed.forEach(function (item) { updates[item.key] = 0; });
      var updatedCart = await post('cart/update.js', { updates: updates });
      selected = new Set(updatedCart.items.filter(function (item) {
        var props = item.properties || {};
        return props._item_type !== 'print_fee' && props._hamper_role !== 'packaging';
      }).map(function (item) { return item.key; }));
      writeSelection();
      prepared = true;
      return updatedCart;
    } catch (error) {
      await restorePending().catch(function (restoreError) {
        console.error('[Checkout selection] Automatic restore failed.', restoreError);
      });
      throw error;
    } finally {
      preparing = false;
    }
  }

  function itemSignature(item) {
    var properties = item.properties || {};
    var ordered = {};
    Object.keys(properties).sort().forEach(function (key) { ordered[key] = properties[key]; });
    var sellingPlan = item.selling_plan || (item.selling_plan_allocation && item.selling_plan_allocation.selling_plan && item.selling_plan_allocation.selling_plan.id) || null;
    return JSON.stringify([Number(item.variant_id || item.id), sellingPlan, ordered]);
  }

  async function restorePending() {
    var raw = localStorage.getItem(RESTORE_KEY);
    if (!raw) return;
    var pending;
    try { pending = JSON.parse(raw); } catch (_) { localStorage.removeItem(RESTORE_KEY); return; }
    if (!pending.items || !pending.items.length) { localStorage.removeItem(RESTORE_KEY); return; }

    var cart = await cartRequest('cart.js', { headers: { Accept: 'application/json' } });
    var quantities = {};
    cart.items.forEach(function (item) {
      var signature = itemSignature(item);
      quantities[signature] = (quantities[signature] || 0) + item.quantity;
    });
    var additions = [];
    pending.items.forEach(function (item) {
      var signature = itemSignature(item);
      var existing = quantities[signature] || 0;
      var missing = Math.max(0, item.quantity - existing);
      if (missing) additions.push(Object.assign({}, item, { quantity: missing }));
    });
    if (additions.length) await post('cart/add.js', { items: additions });
    localStorage.removeItem(RESTORE_KEY);
    sessionStorage.removeItem(SELECTION_KEY);
    selected = null;
    prepared = false;
  }

  async function onSubmit(event) {
    var submitter = event.submitter;
    if (!submitter || submitter.name !== 'checkout') return;
    var hamperModal = document.querySelector('hamper-modal');
    if (hamperModal) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (typeof hamperModal.openCheckoutPrompt === 'function') {
        await hamperModal.openCheckoutPrompt(event.target, submitter);
      } else {
        console.error('[Checkout selection] Hamper checkout is not ready.');
        window.alert('Opsi hamper belum siap. Muat ulang halaman lalu coba lagi.');
      }
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await prepare();
      goToPrecheckout();
    } catch (error) {
      console.error('[Checkout selection] Could not prepare checkout.', error);
      window.alert(error.message || 'Produk checkout tidak dapat disiapkan.');
    }
  }

  window.CartCheckoutSelection = {
    isSelected: isSelected,
    setSelected: setSelected,
    prepare: prepare,
    restore: restorePending,
    goToPrecheckout: goToPrecheckout
  };
  document.addEventListener('change', onChange);
  document.addEventListener('submit', onSubmit, true);
  var observer = new MutationObserver(initializeSelection);
  observer.observe(document.body, { childList: true, subtree: true });
  initializeSelection();
  if (!isCheckoutFlowPath()) {
    restorePending().then(initializeSelection).catch(function (error) {
      console.error('[Checkout selection] Could not restore saved cart items.', error);
    });
  }
})();
