(function () {
  'use strict';

  if (window.DikadoCartSync) return;

  var config = window.DikadoCartSyncConfig || {};
  var customerId = String(config.customerId || '');
  var endpoint = config.endpoint || '/apps/dikado-address/cart-snapshot';
  var metadataKey = 'dikadoCartSync:' + customerId;
  var checkoutRestoreKey = 'dikadoCheckoutRestore';
  var saveTimer = null;
  var retryTimer = null;
  var retryAttempt = 0;
  var inFlight = null;
  var bootstrapped = false;
  var paused = false;
  var restoring = false;
  var dirtyDuringRestore = false;
  var lastFocusCheck = 0;
  var state = readMetadata();

  function rootPath() {
    return (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';
  }

  function forbiddenPage() {
    var path = window.location.pathname.replace(/\/+$/, '') || '/';
    var precheckoutPath = '/pages/checkout-dikado';
    try { precheckoutPath = new URL(config.precheckoutUrl || precheckoutPath, window.location.origin).pathname.replace(/\/+$/, ''); } catch (_) {}
    return path === precheckoutPath || path === '/pages/checkout-dikado' || path === '/pages/custom-chekout' ||
      path === '/checkout' || path.indexOf('/checkouts/') === 0;
  }

  function readMetadata() {
    if (!customerId) return { version: null, fingerprint: null, dirty: false };
    try {
      var parsed = JSON.parse(sessionStorage.getItem(metadataKey) || '{}');
      return {
        version: Number.isSafeInteger(parsed.version) && parsed.version > 0 ? parsed.version : null,
        fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : null,
        dirty: parsed.dirty === true
      };
    } catch (_) {
      return { version: null, fingerprint: null, dirty: false };
    }
  }

  function writeMetadata() {
    if (!customerId) return;
    try { sessionStorage.setItem(metadataKey, JSON.stringify(state)); } catch (_) {}
  }

  function stableObject(value) {
    if (Array.isArray(value)) return value.map(stableObject);
    if (!value || typeof value !== 'object') return value;
    var result = {};
    Object.keys(value).sort().forEach(function (key) { result[key] = stableObject(value[key]); });
    return result;
  }

  function stableStringify(value) {
    return JSON.stringify(stableObject(value));
  }

  function itemSellingPlan(item) {
    return item.selling_plan || (item.selling_plan_allocation && item.selling_plan_allocation.selling_plan && item.selling_plan_allocation.selling_plan.id) || null;
  }

  function cleanProperties(properties) {
    var result = {};
    Object.keys(properties || {}).sort().forEach(function (key) {
      if (key === '_dikado_shipping_quote_id') return;
      var value = properties[key];
      if (value == null) return;
      result[key] = String(value);
    });
    return result;
  }

  function normalizeCart(cart) {
    var allowedAttributes = new Set(Array.isArray(config.attributeKeys) ? config.attributeKeys : []);
    var attributes = {};
    Object.keys((cart && cart.attributes) || {}).sort().forEach(function (key) {
      if (allowedAttributes.has(key) && key !== '_dikado_shipping_quote_id') attributes[key] = String(cart.attributes[key]);
    });
    var itemsBySignature = new Map();
    ((cart && cart.items) || []).forEach(function (item) {
      var result = {
        variant_id: Number(item.variant_id || item.id),
        quantity: Number(item.quantity),
        properties: cleanProperties(item.properties)
      };
      var sellingPlan = itemSellingPlan(item);
      if (sellingPlan) result.selling_plan = Number(sellingPlan);
      var signature = lineSignature(result);
      var existing = itemsBySignature.get(signature);
      if (existing) existing.quantity += result.quantity;
      else itemsBySignature.set(signature, result);
    });
    var items = Array.from(itemsBySignature.values());
    items.sort(function (left, right) {
      return lineSignature(left).localeCompare(lineSignature(right));
    });
    return {
      schema_version: 1,
      items: items,
      attributes: attributes,
      note: config.syncNotes && cart && typeof cart.note === 'string' ? cart.note : null
    };
  }

  function lineSignature(item) {
    return stableStringify([
      Number(item.variant_id || item.id),
      Number(item.selling_plan || itemSellingPlan(item)) || null,
      cleanProperties(item.properties)
    ]);
  }

  function fingerprint(snapshot) {
    return stableStringify(snapshot);
  }

  async function request(path, options) {
    var controller = new AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, Number(config.timeoutMs) || 4_000);
    try {
      var response = await fetch(endpoint + (path || ''), Object.assign({
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      }, options || {}));
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok && response.status !== 409) throw new Error(payload.error || 'Cart synchronization is temporarily unavailable.');
      return { status: response.status, data: payload.data || null };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function getCart() {
    var response = await fetch(rootPath() + 'cart.js', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    var cart = await response.json().catch(function () { return null; });
    if (!response.ok || !cart || !Array.isArray(cart.items)) throw new Error('Could not read the Shopify cart.');
    return cart;
  }

  function readRemote() {
    return request('', { method: 'GET' }).then(function (result) { return result.data; });
  }

  function postCart(path, body) {
    return fetch(rootPath() + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    }).then(async function (response) {
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok || data.errors) throw new Error(data.description || data.message || 'Shopify rejected part of the restored cart.');
      return data;
    });
  }

  function dispatchCartUpdate(cart) {
    document.dispatchEvent(new CustomEvent('cart:update', {
      bubbles: true,
      detail: { resource: cart, sourceId: 'dikado-cart-sync', data: { source: 'dikado-cart-sync' } }
    }));
  }

  async function restoreSnapshot(remote) {
    if (!remote || !remote.cart_snapshot || paused || forbiddenPage()) return;
    restoring = true;
    try {
      var cart = await getCart();
      var desired = remote.cart_snapshot;
      var desiredBySignature = new Map();
      desired.items.forEach(function (item) {
        var signature = lineSignature(item);
        var existing = desiredBySignature.get(signature);
        if (existing) existing.quantity += item.quantity;
        else desiredBySignature.set(signature, Object.assign({}, item));
      });

      var currentBySignature = new Map();
      cart.items.forEach(function (item) {
        var signature = lineSignature(item);
        currentBySignature.set(signature, [...(currentBySignature.get(signature) || []), item]);
      });

      var additions = Array.from(desiredBySignature.entries()).filter(function (entry) {
        return !currentBySignature.has(entry[0]);
      }).map(function (entry) {
        var item = entry[1];
        var addition = { id: item.variant_id, quantity: item.quantity, properties: item.properties || {} };
        if (item.selling_plan) addition.selling_plan = item.selling_plan;
        return addition;
      });
      if (additions.length) await postCart('cart/add.js', { items: additions });

      // Add first so an unavailable remote variant cannot erase the usable
      // local cart. Only reconcile removals and quantities after every missing
      // line has been accepted by Shopify.
      if (additions.length) cart = await getCart();
      currentBySignature = new Map();
      cart.items.forEach(function (item) {
        var signature = lineSignature(item);
        currentBySignature.set(signature, [...(currentBySignature.get(signature) || []), item]);
      });
      var updates = {};
      currentBySignature.forEach(function (lines, signature) {
        var wanted = desiredBySignature.get(signature);
        lines.forEach(function (line, index) { updates[line.key] = index === 0 && wanted ? wanted.quantity : 0; });
      });
      var attributeUpdates = Object.assign({}, desired.attributes || {});
      var allowedAttributes = new Set(Array.isArray(config.attributeKeys) ? config.attributeKeys : []);
      Object.keys(cart.attributes || {}).forEach(function (key) {
        if (allowedAttributes.has(key) && !Object.prototype.hasOwnProperty.call(attributeUpdates, key)) attributeUpdates[key] = '';
      });
      if (Object.keys(updates).length || config.syncNotes || Object.keys(attributeUpdates).length) {
        var updateBody = { updates: updates, attributes: attributeUpdates };
        if (config.syncNotes) updateBody.note = desired.note || '';
        await postCart('cart/update.js', updateBody);
      }

      var restoredCart = await getCart();
      state.version = Number(remote.snapshot_version);
      state.fingerprint = fingerprint(normalizeCart(restoredCart));
      state.dirty = false;
      writeMetadata();
      resetRetry();
      dispatchCartUpdate(restoredCart);
    } finally {
      restoring = false;
      if (dirtyDuringRestore) {
        dirtyDuringRestore = false;
        markDirty();
      }
    }
  }

  async function saveCart(cart, expectedVersion, retryLocalOnConflict) {
    if (paused || restoring || forbiddenPage()) return;
    var snapshot = normalizeCart(cart);
    var localFingerprint = fingerprint(snapshot);
    if (!state.dirty && state.fingerprint === localFingerprint) return;
    var result = await request('', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ cart_snapshot: snapshot, expected_snapshot_version: expectedVersion })
    });
    if (result.status === 409) {
      if (retryLocalOnConflict && result.data) {
        state.version = Number(result.data.snapshot_version);
        state.dirty = true;
        writeMetadata();
        return saveCart(cart, state.version, false);
      }
      if (result.data) await restoreSnapshot(result.data);
      return;
    }
    state.version = Number(result.data.snapshot_version);
    state.fingerprint = localFingerprint;
    state.dirty = false;
    writeMetadata();
    resetRetry();
  }

  function resetRetry() {
    window.clearTimeout(retryTimer);
    retryTimer = null;
    retryAttempt = 0;
  }

  function scheduleRetry(task) {
    if (retryTimer || retryAttempt >= 4 || paused || forbiddenPage()) return;
    var delay = Math.min(4_000, 500 * Math.pow(2, retryAttempt));
    retryAttempt += 1;
    retryTimer = window.setTimeout(function () {
      retryTimer = null;
      task();
    }, delay);
  }

  function serialize(task) {
    var next = (inFlight || Promise.resolve()).catch(function () {}).then(task);
    var tracked = next.finally(function () { if (inFlight === tracked) inFlight = null; });
    inFlight = tracked;
    return tracked;
  }

  async function bootstrap() {
    if (!customerId || bootstrapped || paused || forbiddenPage()) return;
    try { if (localStorage.getItem(checkoutRestoreKey)) return; } catch (_) {}
    bootstrapped = true;
    return serialize(async function () {
      try {
        var values = await Promise.all([getCart(), readRemote()]);
        var cart = values[0];
        var remote = values[1];
        var localFingerprint = fingerprint(normalizeCart(cart));
        if (!remote) {
          state.version = null;
          state.dirty = true;
          writeMetadata();
          await saveCart(cart, null);
          return;
        }
        var remoteFingerprint = fingerprint(remote.cart_snapshot);
        if (localFingerprint === remoteFingerprint) {
          state.version = Number(remote.snapshot_version);
          state.fingerprint = localFingerprint;
          state.dirty = false;
          writeMetadata();
          resetRetry();
          return;
        }
        if (state.dirty && state.version === Number(remote.snapshot_version)) {
          await saveCart(cart, state.version);
          return;
        }
        await restoreSnapshot(remote);
      } catch (error) {
        bootstrapped = false;
        console.warn('[Cart sync] Synchronization is temporarily unavailable.', error && error.message ? error.message : error);
        scheduleRetry(bootstrap);
      }
    });
  }

  function markDirty() {
    if (restoring) {
      dirtyDuringRestore = true;
      return;
    }
    if (!customerId || paused || forbiddenPage()) return;
    state.dirty = true;
    writeMetadata();
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flush, Number(config.debounceMs) || 500);
  }

  function flush() {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    if (!customerId || paused || restoring || forbiddenPage()) return Promise.resolve();
    return serialize(async function () {
      try { await saveCart(await getCart(), state.version); }
      catch (error) {
        console.warn('[Cart sync] Snapshot save failed.', error && error.message ? error.message : error);
        scheduleRetry(flush);
      }
    });
  }

  function commitCart(cart) {
    if (!customerId || paused || restoring || forbiddenPage()) return Promise.resolve();
    state.dirty = true;
    writeMetadata();
    window.clearTimeout(saveTimer);
    saveTimer = null;
    return serialize(async function () {
      try { await saveCart(cart, state.version, true); }
      catch (error) {
        console.warn('[Cart sync] Immediate snapshot save failed.', error && error.message ? error.message : error);
        scheduleRetry(flush);
      }
    });
  }

  function pauseForCheckout() {
    paused = true;
    window.clearTimeout(saveTimer);
    saveTimer = null;
    resetRetry();
  }

  function resumeAfterCheckout() {
    paused = false;
    bootstrapped = false;
    markDirty();
    bootstrap();
  }

  function refreshFromRemote() {
    if (!bootstrapped) return bootstrap();
    if (paused || restoring || forbiddenPage()) return Promise.resolve();
    if (state.dirty) return flush();
    return serialize(async function () {
      try {
        var values = await Promise.all([getCart(), readRemote()]);
        var remote = values[1];
        if (!remote) return;
        if (Number(remote.snapshot_version) !== state.version || fingerprint(normalizeCart(values[0])) !== fingerprint(remote.cart_snapshot)) {
          await restoreSnapshot(remote);
        }
      } catch (error) {
        console.warn('[Cart sync] Remote refresh failed.', error && error.message ? error.message : error);
      }
    });
  }

  window.DikadoCartSync = {
    bootstrap: bootstrap,
    commitCart: commitCart,
    flush: flush,
    notifyChange: markDirty,
    pauseForCheckout: pauseForCheckout,
    resumeAfterCheckout: resumeAfterCheckout,
    normalizeCart: normalizeCart,
    fingerprint: fingerprint,
    isRestoring: function () { return restoring; }
  };

  if (!customerId || forbiddenPage()) return;
  document.addEventListener('cart:update', function (event) {
    if (event.detail && event.detail.data && event.detail.data.source === 'dikado-cart-sync') return;
    markDirty();
  });
  document.addEventListener('dikado:cart-mutated', markDirty);
  document.addEventListener('dikado:checkout-selection-restored', resumeAfterCheckout);
  window.addEventListener('pageshow', function () { refreshFromRemote(); });
  window.addEventListener('focus', function () {
    if (Date.now() - lastFocusCheck < 2_000) return;
    lastFocusCheck = Date.now();
    refreshFromRemote();
  });
  window.setTimeout(bootstrap, 0);
})();
