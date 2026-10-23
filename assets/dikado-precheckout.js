(function () {
  'use strict';

  var INITIAL_LOAD_TIMEOUT_MS = 15000;
  var CHECKOUT_TIMEOUT_MS = 45000;

  var money = function (cents, currency) {
    try { return new Intl.NumberFormat(document.documentElement.lang || 'id-ID', { style: 'currency', currency: currency || 'IDR', maximumFractionDigits: 0 }).format(Number(cents || 0) / 100); }
    catch (_) { return 'Rp' + Math.round(Number(cents || 0) / 100).toLocaleString('id-ID'); }
  };
  var escapeHtml = function (value) { return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]; }); };
  var validId = function (value) { return Number.isSafeInteger(Number(value)) && Number(value) > 0; };
  var stableCarrierServiceCode = function (courier, service) {
    var normalized = (String(courier || '') + '_' + String(service || '')).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized ? ('DIKADO_' + normalized).slice(0, 100) : '';
  };
  var parseStorefrontPayloads = function (raw, contentType) {
    var text = String(raw || '').trim();
    if (!text) return [];
    if (!/multipart\/mixed/i.test(String(contentType || ''))) return [JSON.parse(text)];
    var boundaryMatch = /boundary\s*=\s*"?([^";]+)"?/i.exec(String(contentType || ''));
    if (!boundaryMatch) throw new Error('Respons ongkir Shopify tidak dapat dibaca.');
    return text.split('--' + boundaryMatch[1]).map(function (part) {
      var separator = part.indexOf('\r\n\r\n');
      var separatorLength = 4;
      if (separator < 0) { separator = part.indexOf('\n\n'); separatorLength = 2; }
      if (separator < 0) return null;
      var body = part.slice(separator + separatorLength).trim().replace(/--$/, '').trim();
      if (!body || body.charAt(0) !== '{') return null;
      return JSON.parse(body);
    }).filter(Boolean);
  };

  class DikadoPrecheckout extends HTMLElement {
    connectedCallback() {
      this.apiBase = this.dataset.apiBase;
      this.originDistrictId = Number(this.dataset.originDistrictId);
      this.couriers = this.dataset.couriers || 'jne:sicepat';
      this.addresses = []; this.cart = null; this.selectedAddressId = ''; this.shippingOptions = []; this.selectedShipping = null;
      this.requestSerial = { addresses: 0, cart: 0, shipping: 0, locations: 0 };
      this.controllers = {};
      this.pageLoadSerial = 0;
      this.pageReady = false;
      this.checkoutAttempt = 0;
      this.checkoutController = null;
      this.checkoutTimeout = null;
      this.checkoutTimeoutMs = CHECKOUT_TIMEOUT_MS;
      this.loaderRetryMode = '';
      this.fullScreenLoader = document.getElementById(this.dataset.loaderId);
      this.pageContent = document.getElementById(this.dataset.contentId);
      this.handleFullScreenRetry = this.onFullScreenRetry.bind(this);
      if (this.fullScreenLoader) this.fullScreenLoader.addEventListener('full-screen-loader:retry', this.handleFullScreenRetry);
      this.bind();
      customElements.whenDefined('full-screen-loader').then(this.loadInitialData.bind(this));
    }

    disconnectedCallback() {
      Object.keys(this.controllers).forEach(function (bucket) { this.controllers[bucket].abort(); }, this);
      if (this.checkoutController) this.checkoutController.abort();
      if (this.checkoutTimeout) window.clearTimeout(this.checkoutTimeout);
      if (this.fullScreenLoader) this.fullScreenLoader.removeEventListener('full-screen-loader:retry', this.handleFullScreenRetry);
    }

    async loadInitialData() {
      var serial = ++this.pageLoadSerial;
      var timedOut = false;
      ['initialAddresses', 'initialCart'].forEach(function (bucket) {
        if (this.controllers[bucket]) this.controllers[bucket].abort();
      }, this);
      this.addresses = [];
      this.cart = null;
      this.pageReady = false;
      this.loaderRetryMode = '';
      if (this.pageContent) this.pageContent.hidden = true;
      if (this.fullScreenLoader) this.fullScreenLoader.showLoading('Menyiapkan pengiriman…');
      var timeout = window.setTimeout(function () {
        timedOut = true;
        ['initialAddresses', 'initialCart'].forEach(function (bucket) {
          if (this.controllers[bucket]) this.controllers[bucket].abort();
        }, this);
      }.bind(this), INITIAL_LOAD_TIMEOUT_MS);

      try {
        var results = await Promise.all([
          this.fetchAddresses('initialAddresses'),
          this.fetchCart('initialCart'),
        ]);
        if (serial !== this.pageLoadSerial) return;
        this.addresses = results[0];
        this.cart = results[1];
        this.querySelector('[data-address-status]').hidden = true;
        var preferred = this.addresses.find(function (address) { return address.is_default; }) || this.addresses[0];
        this.selectedAddressId = preferred ? preferred.id : '';
        this.renderAddresses();
        this.invalidateShipping();
        this.updateActions();
        this.pageReady = true;
        if (this.pageContent) this.pageContent.hidden = false;
        if (this.fullScreenLoader) this.fullScreenLoader.hide();
        if (this.selectedAddressId) this.calculateShipping();
      } catch (error) {
        if (serial !== this.pageLoadSerial) return;
        ['initialAddresses', 'initialCart'].forEach(function (bucket) {
          if (this.controllers[bucket]) this.controllers[bucket].abort();
        }, this);
        console.error('[Dikado pre-checkout] Initial page data failed.', error);
        var message = timedOut
          ? 'Waktu memuat data terlalu lama. Periksa koneksi Anda lalu coba lagi.'
          : 'Alamat atau keranjang belum dapat dimuat. Silakan coba lagi.';
        if (this.fullScreenLoader) this.fullScreenLoader.showError(message);
      } finally {
        window.clearTimeout(timeout);
      }
    }

    bind() {
      this.addEventListener('click', this.onClick.bind(this));
      this.addEventListener('change', this.onChange.bind(this));
      this.querySelector('[data-address-form]').addEventListener('submit', this.saveAddress.bind(this));
      document.addEventListener('visibilitychange', function () { if (!document.hidden && this.pageReady) this.loadCart(); }.bind(this));
      window.addEventListener('pageshow', function () {
        if (this.continuing) this.restoreAfterCheckoutNavigation();
        if (this.pageReady) this.loadCart();
      }.bind(this));
    }

    async api(path, options, bucket) {
      options = options || {};
      if (bucket) {
        if (this.controllers[bucket]) this.controllers[bucket].abort();
        this.controllers[bucket] = new AbortController();
        options.signal = this.controllers[bucket].signal;
      }
      var response = await fetch(this.apiBase + path, Object.assign({}, options, { headers: Object.assign({ Accept: 'application/json' }, options.body ? { 'Content-Type': 'application/json' } : {}, options.headers || {}) }));
      var payload = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(payload.error || 'Permintaan gagal. Silakan coba lagi.');
      return payload;
    }

    async fetchAddresses(bucket) {
      var payload = await this.api('/rajaongkir/addresses', {}, bucket);
      if (!Array.isArray(payload.data)) throw new Error('Data alamat tidak valid.');
      return payload.data;
    }

    async loadAddresses() {
      var serial = ++this.requestSerial.addresses;
      var status = this.querySelector('[data-address-status]'); status.hidden = false; status.textContent = 'Memuat alamat…'; status.className = '';
      try {
        var addresses = await this.fetchAddresses('addresses');
        if (serial !== this.requestSerial.addresses) return;
        this.addresses = addresses;
        if (!this.addresses.some(function (address) { return address.id === this.selectedAddressId; }, this)) {
          var preferred = this.addresses.find(function (address) { return address.is_default; }) || this.addresses[0];
          this.selectedAddressId = preferred ? preferred.id : '';
        }
        status.hidden = true; this.renderAddresses(); this.invalidateShipping(); this.updateActions();
        if (this.selectedAddressId) this.calculateShipping();
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('[Dikado pre-checkout] Address refresh failed.', error);
        status.textContent = error.message || 'Alamat tidak dapat dimuat.'; status.className = 'dikado-status-error';
      }
    }

    renderAddresses() {
      var list = this.querySelector('[data-address-list]');
      if (!this.addresses.length) { list.innerHTML = '<div class="dikado-status-empty"><strong>Belum ada alamat tersimpan.</strong><p>Tambahkan alamat untuk menghitung ongkir dan melanjutkan.</p></div>'; return; }
      list.innerHTML = this.addresses.map(function (address) {
        var selected = address.id === this.selectedAddressId;
        return '<label class="dikado-address-card' + (selected ? ' is-selected' : '') + '"><input type="radio" name="dikado-address" value="' + escapeHtml(address.id) + '" ' + (selected ? 'checked' : '') + '><span><span class="dikado-address-card__top"><strong>' + escapeHtml(address.label) + '</strong>' + (address.is_default ? '<span class="dikado-badge">Utama</span>' : '') + '</span><p><strong>' + escapeHtml(address.recipient_name) + '</strong> · ' + escapeHtml(address.phone) + '</p><p>' + escapeHtml(address.address_line) + ', Kel. ' + escapeHtml(address.subdistrict_name) + ', Kec. ' + escapeHtml(address.district_name) + ', ' + escapeHtml(address.city_name) + ', ' + escapeHtml(address.province_name) + (address.postcode ? ' ' + escapeHtml(address.postcode) : '') + '</p><span class="dikado-address-actions"><button type="button" class="dikado-link-button" data-edit-address="' + escapeHtml(address.id) + '">Ubah</button>' + (!address.is_default ? '<button type="button" class="dikado-link-button" data-default-address="' + escapeHtml(address.id) + '">Jadikan alamat utama</button>' : '') + '</span></span></label>';
      }, this).join('');
    }

    async fetchCart(bucket) {
      if (bucket) {
        if (this.controllers[bucket]) this.controllers[bucket].abort();
        this.controllers[bucket] = new AbortController();
      }
      var response = await fetch(((window.Shopify && Shopify.routes && Shopify.routes.root) || '/') + 'cart.js', {
        headers: { Accept: 'application/json' },
        signal: bucket ? this.controllers[bucket].signal : undefined,
      });
      var cart = await response.json().catch(function () { return null; });
      if (!response.ok) throw new Error('Keranjang tidak dapat dimuat.');
      if (!cart || !Array.isArray(cart.items) || !Number.isFinite(Number(cart.total_price))) throw new Error('Respons keranjang tidak valid.');
      return cart;
    }

    async loadCart() {
      var serial = ++this.requestSerial.cart;
      try {
        var cart = await this.fetchCart('cart');
        if (serial !== this.requestSerial.cart) return;
        this.cart = cart; this.invalidateShipping(); this.updateActions();
        if (this.selectedAddressId) this.calculateShipping();
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('[Dikado pre-checkout] Cart refresh failed.', error);
        this.cart = null; this.invalidateShipping(); this.shippingError(error.message || 'Keranjang tidak dapat dimuat.'); this.updateActions();
      }
    }

    invalidateShipping() { ++this.requestSerial.shipping; if (this.controllers.shipping) this.controllers.shipping.abort(); this.calculating = false; this.shippingOptions = []; this.selectedShipping = null; this.querySelector('[data-shipping-list]').innerHTML = ''; this.querySelector('[data-shipping-status]').textContent = ''; this.querySelector('[data-shipping-status]').className = ''; this.updateShippingSummary(); this.updateActions(); }

    async calculateShipping() {
      if (this.calculating) return; var address = this.selectedAddress();
      if (!address || !validId(address.district_id)) return this.shippingError('Pilih alamat dengan Kecamatan yang valid.');
      if (!this.cart || !this.cart.items.length) return this.shippingError('Keranjang Anda kosong.');
      this.calculating = true; var serial = ++this.requestSerial.shipping; this.updateActions(); this.querySelector('[data-shipping-status]').className = ''; this.querySelector('[data-shipping-status]').textContent = 'Sebentar ya kita hitung ongkir dulu ...';
      try {
        var lines = this.cart.items.map(function (item) { return { variant_id: item.variant_id, quantity: item.quantity, properties: item.properties || {} }; });
        var payload = await this.api('/rajaongkir/quotes', { method: 'POST', body: JSON.stringify({ address_id: address.id, lines: lines, courier: this.couriers }) }, 'shipping');
        if (serial !== this.requestSerial.shipping) return;
        this.shippingOptions = Array.isArray(payload.data) ? payload.data : []; this.selectedShipping = this.shippingOptions[0] || null; this.renderShipping();
      } catch (error) { if (error.name !== 'AbortError') this.shippingError(error.message || 'Ongkir tidak dapat dihitung.'); }
      finally { if (serial === this.requestSerial.shipping) { this.calculating = false; this.updateActions(); } }
    }

    renderShipping() {
      var status = this.querySelector('[data-shipping-status]');
      if (!this.shippingOptions.length) { status.textContent = 'Tidak ada layanan pengiriman yang tersedia.'; this.querySelector('[data-shipping-list]').innerHTML = ''; this.updateShippingSummary(); this.updateActions(); return; }
      status.textContent = ''; this.querySelector('[data-shipping-list]').innerHTML = this.shippingOptions.map(function (rate, index) {
        return '<label class="dikado-shipping-card' + (rate === this.selectedShipping ? ' is-selected' : '') + '"><input type="radio" name="dikado-shipping" value="' + index + '" ' + (rate === this.selectedShipping ? 'checked' : '') + '><span><strong>' + escapeHtml(rate.courier) + ' · ' + escapeHtml(rate.service) + '</strong>' + (rate.description ? '<p>' + escapeHtml(rate.description) + '</p>' : '') + (rate.etd ? '<p>Estimasi ' + escapeHtml(rate.etd) + '</p>' : '') + '<span class="dikado-shipping-card__price">' + money(rate.price, this.cart.currency) + '</span></span></label>';
      }, this).join(''); this.updateShippingSummary(); this.updateActions();
    }

    shippingError(message) { this.querySelector('[data-shipping-status]').textContent = message; this.querySelector('[data-shipping-status]').className = 'dikado-status-error'; }
    selectedAddress() { return this.addresses.find(function (address) { return address.id === this.selectedAddressId; }, this); }
    updateShippingSummary() {
      var empty = this.querySelector('[data-selected-shipping-empty]');
      var selection = this.querySelector('[data-selected-shipping]');
      empty.hidden = Boolean(this.selectedShipping);
      selection.hidden = !this.selectedShipping;
      if (!this.selectedShipping) return;
      this.querySelector('[data-selected-shipping-name]').textContent = String(this.selectedShipping.courier || '') + ' · ' + String(this.selectedShipping.service || '');
      var etd = this.querySelector('[data-selected-shipping-etd]');
      etd.textContent = this.selectedShipping.etd ? 'Estimasi ' + String(this.selectedShipping.etd) : '';
      etd.hidden = !this.selectedShipping.etd;
      this.querySelector('[data-shipping-price]').textContent = money(this.selectedShipping.price, this.cart && this.cart.currency);
    }
    updateActions() { var address = this.selectedAddress(); this.querySelector('[data-continue]').disabled = this.continuing || this.calculating || !this.cart || !this.cart.items.length || !address || !validId(address.district_id) || !this.selectedShipping; }

    cartUrl(path) { return ((window.Shopify && Shopify.routes && Shopify.routes.root) || '/') + path; }

    async currentCart() {
      var response = await fetch(this.cartUrl('cart.js'), { headers: { Accept: 'application/json' } });
      var cart = await response.json().catch(function () { return null; });
      if (!response.ok || !cart || !Array.isArray(cart.items)) throw new Error('Keranjang tidak dapat diverifikasi.');
      return cart;
    }

    async storefront(query, variables, multipart) {
      var response = await fetch(this.dataset.storefrontApiUrl || '/api/2026-07/graphql.json', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: multipart ? 'multipart/mixed; deferSpec=20220824, application/json' : 'application/json'
        },
        body: JSON.stringify({ query: query, variables: variables })
      });
      var raw = await response.text();
      var payloads;
      try { payloads = parseStorefrontPayloads(raw, response.headers.get('content-type')); }
      catch (_) { throw new Error('Respons Shopify tidak dapat dibaca. Silakan coba lagi.'); }
      var graphError = '';
      payloads.some(function (payload) {
        if (Array.isArray(payload.errors) && payload.errors[0]) { graphError = payload.errors[0].message || ''; return true; }
        return Array.isArray(payload.incremental) && payload.incremental.some(function (increment) {
          if (!Array.isArray(increment.errors) || !increment.errors[0]) return false;
          graphError = increment.errors[0].message || '';
          return true;
        });
      });
      if (!response.ok || graphError || !payloads.length) throw new Error(graphError || 'Shopify tidak dapat menyiapkan checkout.');
      return payloads;
    }

    async selectCartDeliveryAddress(address) {
      if (!address || typeof address !== 'object') throw new Error('Alamat checkout dari server tidak valid.');
      var cart = await this.currentCart();
      var token = String(cart.token || '').trim();
      if (!token) throw new Error('ID keranjang Shopify tidak tersedia. Muat ulang halaman lalu coba lagi.');
      var cartId = token.indexOf('gid://shopify/Cart/') === 0 ? token : 'gid://shopify/Cart/' + token;
      var query = 'mutation DikadoSelectDeliveryAddress($cartId: ID!, $addresses: [CartSelectableAddressInput!]!) { cartDeliveryAddressesReplace(cartId: $cartId, addresses: $addresses) { cart { id checkoutUrl } userErrors { field message } } }';
      var payloads = await this.storefront(query, {
        cartId: cartId,
        addresses: [{ address: { deliveryAddress: address }, selected: true, oneTimeUse: true, validationStrategy: 'COUNTRY_CODE_ONLY' }]
      });
      var payload = payloads[0];
      var result = payload && payload.data && payload.data.cartDeliveryAddressesReplace;
      var userError = result && Array.isArray(result.userErrors) && result.userErrors[0] && result.userErrors[0].message;
      if (userError || !result || !result.cart || !result.cart.id || !result.cart.checkoutUrl) {
        throw new Error(userError || 'Alamat terpilih tidak dapat dipasang ke checkout Shopify.');
      }
      return { cartId: result.cart.id, checkoutUrl: result.cart.checkoutUrl };
    }

    async shopifyDeliveryGroups(cartId) {
      var query = 'query DikadoCartDeliveryRates($cartId: ID!) { cart(id: $cartId) { id checkoutUrl ...DikadoDeliveryGroups @defer } } fragment DikadoDeliveryGroups on Cart { deliveryGroups(first: 10, withCarrierRates: true) { nodes { id deliveryOptions { handle code title description estimatedCost { amount currencyCode } } selectedDeliveryOption { handle code } } } }';
      var payloads = await this.storefront(query, { cartId: cartId }, true);
      var cart = null;
      var groups = null;
      payloads.forEach(function (payload) {
        if (payload.data && payload.data.cart) {
          cart = Object.assign(cart || {}, payload.data.cart);
          if (payload.data.cart.deliveryGroups) groups = payload.data.cart.deliveryGroups;
        }
        (payload.incremental || []).forEach(function (increment) {
          if (increment.data && increment.data.deliveryGroups) groups = increment.data.deliveryGroups;
          if (increment.data && increment.data.cart && increment.data.cart.deliveryGroups) groups = increment.data.cart.deliveryGroups;
        });
      });
      var nodes = groups && Array.isArray(groups.nodes) ? groups.nodes : [];
      if (!cart || !cart.checkoutUrl || !nodes.length) throw new Error('Shopify belum mengembalikan pilihan pengiriman untuk alamat ini.');
      return { cartId: cart.id || cartId, checkoutUrl: cart.checkoutUrl, groups: nodes };
    }

    deliverySelections(groups, shipping) {
      var expectedCode = stableCarrierServiceCode(shipping.courier_code || shipping.courier, shipping.service_code || shipping.service);
      var expectedPrice = Number(shipping.price);
      var expectedService = String(shipping.service_code || shipping.service || '').trim().toUpperCase();
      var selections = groups.map(function (group) {
        var options = Array.isArray(group.deliveryOptions) ? group.deliveryOptions : [];
        var option = options.find(function (candidate) { return String(candidate.code || '').toUpperCase() === expectedCode; });
        if (!option) option = options.find(function (candidate) {
          var optionPrice = Math.round(Number(candidate.estimatedCost && candidate.estimatedCost.amount) * 100);
          var label = (String(candidate.code || '') + ' ' + String(candidate.title || '')).toUpperCase();
          return Number.isFinite(optionPrice) && optionPrice === expectedPrice && expectedService && label.indexOf(expectedService) >= 0;
        });
        return option && group.id && option.handle ? { deliveryGroupId: group.id, deliveryOptionHandle: option.handle } : null;
      });
      if (!expectedCode || !selections.length || selections.some(function (selection) { return !selection; })) {
        throw new Error('Layanan ' + String(shipping.courier || '') + ' · ' + String(shipping.service || '') + ' belum tersedia di Shopify Checkout. Pastikan Dikado RajaOngkir aktif sebagai rate Carrier or app calculated pada shipping profile zona Indonesia, lalu hitung ongkir lagi.');
      }
      return selections;
    }

    async selectShopifyDeliveryOptions(cartId, selections) {
      var query = 'mutation DikadoSelectDeliveryOptions($cartId: ID!, $selectedDeliveryOptions: [CartSelectedDeliveryOptionInput!]!) { cartSelectedDeliveryOptionsUpdate(cartId: $cartId, selectedDeliveryOptions: $selectedDeliveryOptions) { cart { id checkoutUrl deliveryGroups(first: 10) { nodes { id selectedDeliveryOption { handle code } } } } userErrors { field message } warnings { message } } }';
      var payload = (await this.storefront(query, { cartId: cartId, selectedDeliveryOptions: selections }))[0];
      var result = payload && payload.data && payload.data.cartSelectedDeliveryOptionsUpdate;
      var userError = result && Array.isArray(result.userErrors) && result.userErrors[0] && result.userErrors[0].message;
      if (userError || !result || !result.cart || !result.cart.checkoutUrl) throw new Error(userError || 'Pilihan ongkir tidak dapat dipasang ke Shopify Checkout.');
      var selectedGroups = result.cart.deliveryGroups && Array.isArray(result.cart.deliveryGroups.nodes) ? result.cart.deliveryGroups.nodes : [];
      if (selectedGroups.length !== selections.length || selections.some(function (selection) {
        var group = selectedGroups.find(function (candidate) { return candidate.id === selection.deliveryGroupId; });
        return !group || !group.selectedDeliveryOption || group.selectedDeliveryOption.handle !== selection.deliveryOptionHandle;
      })) {
        throw new Error('Shopify belum menyimpan pilihan ongkir. Silakan coba lagi.');
      }
      return result.cart.checkoutUrl;
    }

    async prepareShopifyCheckout(address, shipping) {
      var addressedCart = await this.selectCartDeliveryAddress(address);
      var ratedCart = await this.shopifyDeliveryGroups(addressedCart.cartId);
      var selections = this.deliverySelections(ratedCart.groups, shipping);
      return this.selectShopifyDeliveryOptions(ratedCart.cartId, selections);
    }

    async changeLineProperties(item, properties) {
      if (!item || typeof item.key !== 'string' || !item.key) throw new Error('Baris produk fisik tidak dapat diperbarui.');
      var response = await fetch(this.cartUrl('cart/change.js'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: item.key, quantity: item.quantity, properties: properties })
      });
      var cart = await response.json().catch(function () { return null; });
      if (!response.ok || !cart || !Array.isArray(cart.items)) throw new Error('Pilihan ongkir tidak dapat ditempelkan ke produk.');
      return cart;
    }

    async attachQuoteToPhysicalLine(quoteId) {
      var propertyName = '_dikado_shipping_quote_id';
      var cart = await this.currentCart();
      var maxChanges = Math.max(4, cart.items.length * 3);
      for (var attempt = 0; attempt < maxChanges; attempt += 1) {
        var target = cart.items.find(function (item) {
          var title = String(item.product_title || item.title || '').trim().toLowerCase();
          return item.requires_shipping === true && title !== 'custom printing fee';
        });
        if (!target) throw new Error('Tidak ada produk fisik yang aman untuk menyimpan pilihan ongkir.');

        var stale = cart.items.find(function (item) {
          return item.key !== target.key && item.properties && item.properties[propertyName];
        });
        var itemToChange = stale || ((target.properties || {})[propertyName] !== quoteId ? target : null);
        if (!itemToChange) {
          var ids = cart.items.map(function (item) { return item.properties && item.properties[propertyName]; }).filter(Boolean);
          if (ids.length !== 1 || ids[0] !== quoteId) throw new Error('Pilihan ongkir pada keranjang tidak konsisten.');
          this.cart = cart;
          return cart;
        }

        var properties = Object.assign({}, itemToChange.properties || {});
        if (itemToChange.key === target.key) properties[propertyName] = quoteId;
        else delete properties[propertyName];
        cart = await this.changeLineProperties(itemToChange, properties);
      }
      throw new Error('Pilihan ongkir tidak dapat disimpan tanpa mengubah isi keranjang.');
    }

    async onClick(event) {
      var add = event.target.closest('[data-add-address]'); if (add) return this.openAddressModal();
      var edit = event.target.closest('[data-edit-address]'); if (edit) { event.preventDefault(); return this.openAddressModal(edit.dataset.editAddress); }
      var makeDefault = event.target.closest('[data-default-address]'); if (makeDefault) { event.preventDefault(); return this.setDefault(makeDefault.dataset.defaultAddress, makeDefault); }
      if (event.target.closest('[data-continue]')) return this.continueCheckout();
      if (event.target.closest('[data-modal-close]')) return this.closeModal();
    }

    onChange(event) {
      if (event.target.name === 'dikado-address') { this.selectedAddressId = event.target.value; this.renderAddresses(); this.invalidateShipping(); this.calculateShipping(); }
      if (event.target.name === 'dikado-shipping') { this.selectedShipping = this.shippingOptions[Number(event.target.value)] || null; this.renderShipping(); }
      if (event.target.name === 'province_id') this.locationChanged('cities', event.target.value);
      if (event.target.name === 'city_id') this.locationChanged('districts', event.target.value);
      if (event.target.name === 'district_id') this.locationChanged('subdistricts', event.target.value);
    }

    async setDefault(id, button) { if (button.disabled) return; button.disabled = true; try { await this.api('/rajaongkir/addresses/' + encodeURIComponent(id) + '/default', { method: 'POST', body: '{}' }); await this.loadAddresses(); } catch (error) { this.shippingError(error.message); } finally { button.disabled = false; } }

    async locations(level, parentId) {
      var params = new URLSearchParams(); if (level === 'cities') params.set('province_id', parentId); if (level === 'districts') params.set('city_id', parentId); if (level === 'subdistricts') params.set('district_id', parentId);
      var payload = await this.api('/rajaongkir/' + level + (params.toString() ? '?' + params : '')); return Array.isArray(payload.data) ? payload.data : [];
    }

    fillSelect(name, values, selected) { var select = this.querySelector('[name="' + name + '"]'); var label = { province_id: 'provinsi', city_id: 'kota/kabupaten', district_id: 'kecamatan', subdistrict_id: 'kelurahan' }[name]; select.innerHTML = '<option value="">Pilih ' + label + '</option>' + values.map(function (value) { return '<option value="' + escapeHtml(value.id) + '" ' + (String(value.id) === String(selected) ? 'selected' : '') + '>' + escapeHtml(value.name) + '</option>'; }).join(''); select.disabled = false; }
    resetBelow(level) { var names = level === 'cities' ? ['city_id', 'district_id', 'subdistrict_id'] : level === 'districts' ? ['district_id', 'subdistrict_id'] : ['subdistrict_id']; names.forEach(function (name) { var select = this.querySelector('[name="' + name + '"]'); select.innerHTML = '<option value="">Pilih…</option>'; select.disabled = true; }, this); }
    async locationChanged(level, parentId) { this.resetBelow(level); if (!parentId) return; try { this.fillSelect({ cities: 'city_id', districts: 'district_id', subdistricts: 'subdistrict_id' }[level], await this.locations(level, parentId), ''); } catch (error) { this.formError(error.message); } }

    async openAddressModal(id) {
      var form = this.querySelector('[data-address-form]'); form.reset(); form.dataset.addressId = id || ''; this.querySelector('[data-modal-title]').textContent = id ? 'Ubah alamat' : 'Tambah alamat'; this.formError('');
      try {
        this.fillSelect('province_id', await this.locations('provinces', ''), '');
        if (id) {
          var address = this.addresses.find(function (item) { return item.id === id; }); if (!address) throw new Error('Alamat tidak ditemukan.');
          ['label', 'recipient_name', 'phone', 'address_line', 'direction'].forEach(function (name) { form.elements[name].value = address[name] || ''; }); form.elements.is_default.checked = address.is_default;
          this.fillSelect('province_id', await this.locations('provinces', ''), address.province_id);
          this.fillSelect('city_id', await this.locations('cities', address.province_id), address.city_id);
          this.fillSelect('district_id', await this.locations('districts', address.city_id), address.district_id);
          this.fillSelect('subdistrict_id', await this.locations('subdistricts', address.district_id), address.subdistrict_id);
        } else this.resetBelow('cities');
        this.querySelector('[data-address-modal]').showModal(); form.elements.label.focus();
      } catch (error) { this.formError(error.message); }
    }
    closeModal() { if (!this.saving) this.querySelector('[data-address-modal]').close(); }
    formError(message) { var error = this.querySelector('[data-form-error]'); error.textContent = message || ''; error.hidden = !message; }

    async saveAddress(event) {
      event.preventDefault(); if (this.saving) return; var form = event.currentTarget; if (!form.reportValidity()) return; this.saving = true; var button = this.querySelector('[data-save-address]'); button.disabled = true; button.textContent = 'Menyimpan…'; this.formError('');
      var fields = new FormData(form); var body = { label: fields.get('label'), recipient_name: fields.get('recipient_name'), phone: fields.get('phone'), address_line: fields.get('address_line'), direction: fields.get('direction'), province_id: Number(fields.get('province_id')), city_id: Number(fields.get('city_id')), district_id: Number(fields.get('district_id')), subdistrict_id: Number(fields.get('subdistrict_id')), is_default: fields.get('is_default') === 'on' };
      try { var id = form.dataset.addressId; await this.api('/rajaongkir/addresses' + (id ? '/' + encodeURIComponent(id) : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }); this.querySelector('[data-address-modal]').close(); await this.loadAddresses(); }
      catch (error) { this.formError(error.message || 'Alamat tidak dapat disimpan.'); }
      finally { this.saving = false; button.disabled = false; button.textContent = 'Simpan alamat'; }
    }

    onFullScreenRetry() {
      if (this.loaderRetryMode === 'checkout') return this.continueCheckout();
      return this.loadInitialData();
    }

    restoreAfterCheckoutNavigation() {
      ++this.checkoutAttempt;
      if (this.checkoutController) this.checkoutController.abort();
      if (this.checkoutTimeout) window.clearTimeout(this.checkoutTimeout);
      this.checkoutController = null;
      this.checkoutTimeout = null;
      this.continuing = false;
      this.loaderRetryMode = '';
      if (this.pageContent) this.pageContent.hidden = false;
      if (this.fullScreenLoader) this.fullScreenLoader.hide();
      var button = this.querySelector('[data-continue]');
      if (button) button.textContent = 'Lanjut ke pembayaran';
      this.updateActions();
    }

    async continueCheckout() {
      if (this.continuing) return; var address = this.selectedAddress(); var error = this.querySelector('[data-checkout-error]'); error.hidden = true;
      if (!this.cart || !this.cart.items.length || !address || !validId(address.district_id) || !this.selectedShipping) { error.textContent = 'Lengkapi alamat dan pilih estimasi pengiriman terlebih dahulu.'; error.hidden = false; return; }
      this.continuing = true; this.loaderRetryMode = 'checkout'; var attempt = ++this.checkoutAttempt; var button = this.querySelector('[data-continue]'); button.textContent = 'Menyiapkan checkout…'; this.updateActions();
      if (this.pageContent) this.pageContent.hidden = true;
      if (this.fullScreenLoader) this.fullScreenLoader.showLoading('Menyiapkan checkout…', 'Bentar ya, kita cek alamat, ongkir, dan pesananmu dulu 🎁');
      var timedOut = false;
      this.checkoutController = new AbortController();
      this.checkoutTimeout = window.setTimeout(function () { timedOut = true; this.checkoutController.abort(); }.bind(this), this.checkoutTimeoutMs || CHECKOUT_TIMEOUT_MS);
      try {
        if (!this.selectedShipping.quote_id) throw new Error('Quote ongkir tidak valid. Silakan hitung ulang.');
        var requestOptions = { method: 'POST', body: '{}', signal: this.checkoutController.signal };
        var results = await Promise.all([
          this.api('/rajaongkir/addresses/' + encodeURIComponent(address.id) + '/sync', requestOptions),
          this.api('/rajaongkir/quotes/' + encodeURIComponent(this.selectedShipping.quote_id) + '/select', requestOptions),
        ]);
        var sync = results[0];
        var checkoutAddress = sync && sync.data && sync.data.checkout_address;
        if (!checkoutAddress) throw new Error('Alamat checkout tidak diterima dari server.');
        var selection = results[1];
        var quoteId = selection && selection.data && selection.data.id;
        if (!quoteId) throw new Error('Quote ongkir tidak dapat dipilih.');
        await this.attachQuoteToPhysicalLine(quoteId);
        var attributes = { _dikado_shipping_quote_id: quoteId, dikado_address_id: address.id, dikado_destination_district_id: String(address.district_id), dikado_shipping_courier: this.selectedShipping.courier_code || this.selectedShipping.courier, dikado_shipping_service: this.selectedShipping.service_code || this.selectedShipping.service };
        var response = await fetch(this.cartUrl('cart/update.js'), { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ attributes: attributes }) });
        if (!response.ok) throw new Error('Pilihan checkout tidak dapat disimpan.');
        var checkoutUrl = await this.prepareShopifyCheckout(checkoutAddress, this.selectedShipping);
        if (attempt !== this.checkoutAttempt) return;
        window.clearTimeout(this.checkoutTimeout); this.checkoutTimeout = null;
        window.location.assign(checkoutUrl || this.dataset.checkoutUrl || '/checkout');
      } catch (exception) {
        if (attempt !== this.checkoutAttempt) return;
        console.error('[Dikado pre-checkout] Checkout preparation failed.', exception);
        window.clearTimeout(this.checkoutTimeout); this.checkoutTimeout = null; this.checkoutController = null;
        var message = timedOut ? 'Menyiapkan checkout terlalu lama. Periksa koneksi Anda lalu coba lagi.' : 'Checkout belum dapat disiapkan. Silakan coba lagi.';
        if (this.fullScreenLoader) this.fullScreenLoader.showError(message);
        else { if (this.pageContent) this.pageContent.hidden = false; error.textContent = message; error.hidden = false; }
        this.continuing = false; button.textContent = 'Lanjut ke pembayaran'; this.updateActions();
      }
    }
  }
  if (!customElements.get('dikado-precheckout')) customElements.define('dikado-precheckout', DikadoPrecheckout);
}());
