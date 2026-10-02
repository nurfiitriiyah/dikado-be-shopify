(function () {
  'use strict';

  var VALID_TYPES = ['mixable', 'food_only', 'solo'];
  var CLEANUP_RELOAD_KEY = 'dikadoHamperCleanupReloaded';

  function rootPath() {
    return (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';
  }

  function request(url, options) {
    return fetch(rootPath() + url, options).then(async function (response) {
      var data = await response.json();
      if (!response.ok || data.errors) throw new Error(data.description || data.message || 'Cart request failed.');
      return data;
    });
  }

  function post(url, body) {
    return request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function escapeHtml(value) {
    var node = document.createElement('div');
    node.textContent = value == null ? '' : String(value);
    return node.innerHTML;
  }

  class HamperModal extends HTMLElement {
    connectedCallback() {
      if (this.ready) return;
      this.ready = true;
      this.dialog = this.querySelector('dialog');
      this.config = JSON.parse(this.querySelector('[data-hamper-config]').textContent);
      this.selected = new Set();
      this.ribbon = null;
      this.originalSubmitter = null;
      this.isProcessing = false;
      this.promptOpening = false;
      this.fullScreenLoader = this.querySelector('full-screen-loader');

      document.addEventListener('submit', this.onSubmit.bind(this), true);
      this.addEventListener('click', this.onClick.bind(this));
      this.addEventListener('change', this.onChange.bind(this));
      this.querySelector('[data-hamper-message]').addEventListener('input', this.onMessage.bind(this));
      this.dialog.addEventListener('cancel', this.close.bind(this));
      window.addEventListener('pageshow', function () {
        if (this.fullScreenLoader) this.fullScreenLoader.hide();
      }.bind(this));

      // Packaging is temporary. If the customer refreshes or returns to the
      // cart from checkout, remove it and restore the normal cart state.
      if (/\/cart\/?$/.test(window.location.pathname)) {
        // A cleanup-triggered reload must never start another cleanup cycle.
        // Clear the marker now so a later, user-initiated visit can still
        // recover any temporary hamper state that may be created afterwards.
        try {
          if (sessionStorage.getItem(CLEANUP_RELOAD_KEY) === 'true') {
            sessionStorage.removeItem(CLEANUP_RELOAD_KEY);
            return;
          }
        } catch (_) {}
        window.addEventListener('pageshow', this.cleanupTemporaryPackaging.bind(this));
        this.cleanupTemporaryPackaging();
      }
    }

    async cleanupTemporaryPackaging() {
      if (this.cleaningPackaging) return;
      this.cleaningPackaging = true;
      try {
        var cart = await request('cart.js', { headers: { Accept: 'application/json' } });
        var packagingLines = cart.items.filter(function (item) {
          return item.properties && item.properties._hamper_role === 'packaging';
        });
        var hamperItems = cart.items.filter(function (item) {
          return item.properties && item.properties._hamper_role === 'item';
        });
        if (!packagingLines.length && !hamperItems.length) return;

        for (var packageLine of packagingLines) {
          await post('cart/change.js', { id: packageLine.key, quantity: 0 });
        }
        cart = await request('cart.js', { headers: { Accept: 'application/json' } });
        hamperItems = cart.items.filter(function (item) {
          return item.properties && item.properties._hamper_role === 'item';
        });
        for (var item of hamperItems) {
          var properties = Object.assign({}, item.properties);
          delete properties._hamper_id;
          delete properties._hamper_role;
          await post('cart/change.js', { id: item.key, quantity: item.quantity, properties: properties });
        }

        // Confirm Shopify persisted every mutation before refreshing the page.
        // If stale metadata remains, keep the current page usable and report
        // the problem instead of entering an endless reload loop.
        cart = await request('cart.js', { headers: { Accept: 'application/json' } });
        var hasTemporaryHamperState = cart.items.some(function (cartItem) {
          var properties = cartItem.properties || {};
          return properties._hamper_role === 'packaging' || properties._hamper_role === 'item';
        });
        if (hasTemporaryHamperState) {
          throw new Error('Temporary hamper state could not be cleared.');
        }

        try { sessionStorage.removeItem('dikadoCheckoutSelection'); } catch (_) {}
        try { sessionStorage.setItem(CLEANUP_RELOAD_KEY, 'true'); } catch (_) {}
        window.location.reload();
      } catch (error) {
        console.error('[Hamper] Could not remove temporary packaging.', error);
      } finally {
        this.cleaningPackaging = false;
      }
    }

    async onSubmit(event) {
      var submitter = event.submitter;
      if (!submitter || submitter.name !== 'checkout') return;
      if (!event.target.matches('form[action*="/cart"], #cart-form')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      await this.openCheckoutPrompt(event.target, submitter);
    }

    async openCheckoutPrompt(form, submitter) {
      this.originalSubmitter = submitter;
      this.originalForm = form;
      if (this.promptOpening) return;
      this.promptOpening = true;
      this.setPromptError('');
      try {
        await this.loadCart();
        this.showPrompt();
      } catch (error) {
        console.error('[Hamper] Could not open checkout prompt.', error);
        this.lines = [];
        this.showPrompt();
        this.setPromptError('Opsi hamper belum dapat dimuat. Tutup dialog lalu coba lagi, atau lanjutkan checkout normal.');
      } finally {
        this.promptOpening = false;
      }
    }

    eligibilityMap() {
      var result = {};
      document.querySelectorAll('[data-hamper-cart-products]').forEach(function (script) {
        try { Object.assign(result, JSON.parse(script.textContent)); } catch (error) { console.warn('[Hamper] Invalid eligibility data.', error); }
      });
      return result;
    }

    async loadCart() {
      this.cart = await request('cart.js', { headers: { Accept: 'application/json' } });
      var types = this.eligibilityMap();
      this.lines = this.cart.items.filter(function (item) {
        return !item.properties || item.properties._item_type !== 'print_fee';
      }).filter(function (item) {
        return !item.properties || item.properties._hamper_role !== 'packaging';
      }).filter(function (item) {
        return !window.CartCheckoutSelection || window.CartCheckoutSelection.isSelected(item.key);
      }).map(function (item) {
        var type = String(types[item.product_id] || '').trim().toLowerCase();
        if (VALID_TYPES.indexOf(type) < 0 && item.properties && item.properties._design_id) type = 'mixable';
        item.hamperType = VALID_TYPES.indexOf(type) >= 0 ? type : null;
        return item;
      });

      var packaging = this.cart.items.find(function (item) { return item.properties && item.properties._hamper_role === 'packaging'; });
      var hamperId = packaging && packaging.properties._hamper_id;
      this.selected = new Set(this.lines.filter(function (item) {
        return hamperId && item.properties && item.properties._hamper_id === hamperId && item.properties._hamper_role === 'item';
      }).map(function (item) { return item.key; }));
      this.ribbon = packaging && packaging.properties['Ribbon Color'];
      this.querySelector('[data-hamper-message]').value = (packaging && packaging.properties['Gift Message']) || '';
      this.onMessage();
    }

    showPrompt() {
      this.querySelector('[data-hamper-prompt]').hidden = false;
      this.querySelector('[data-hamper-configurator]').hidden = true;
      if (!this.dialog.open) this.dialog.showModal();
      this.querySelector('[data-hamper-normal]').focus();
    }

    setPromptError(message) {
      var error = this.querySelector('[data-hamper-prompt-error]');
      var configure = this.querySelector('[data-hamper-configure]');
      if (!error || !configure) return;
      error.textContent = message || '';
      error.hidden = !message;
      configure.disabled = Boolean(message);
    }

    close(event, preservePackaging) {
      if (event) event.preventDefault();
      if (this.isProcessing) return;
      this.dialog.close();
      if (this.originalSubmitter) this.originalSubmitter.focus();
      if (!preservePackaging) this.cleanupTemporaryPackaging();
    }

    async continueCheckout() {
      this.close(null, true);
      var form = this.originalForm;
      var submitter = this.originalSubmitter;
      if (!form || !submitter) return;
      if (this.fullScreenLoader) {
        this.fullScreenLoader.showLoading(
          'Bentar, kita siapin kadomu… 🎁',
          'Sebentar lagi lanjut ke checkout!'
        );
      }
      try {
        if (window.CartCheckoutSelection) {
          await window.CartCheckoutSelection.prepare();
          window.CartCheckoutSelection.goToPrecheckout();
        } else {
          window.location.assign(window.DikadoPrecheckoutUrl || rootPath() + 'pages/checkout-dikado');
        }
      } catch (error) {
        console.error('[Hamper] Could not prepare selected checkout.', error);
        if (this.fullScreenLoader) this.fullScreenLoader.hide();
        this.showPrompt();
        this.showError(error.message || 'Produk checkout tidak dapat disiapkan. Silakan coba lagi.');
      }
    }

    onClick(event) {
      var target = event.target.closest('button');
      if (!target) return;
      if (target.matches('[data-hamper-close]')) this.close();
      if (target.matches('[data-hamper-normal]')) this.continueCheckout();
      if (target.matches('[data-hamper-configure]')) this.showConfigurator();
      if (target.matches('[data-ribbon]')) {
        this.ribbon = target.dataset.ribbon;
        this.render();
      }
      if (target.matches('[data-hamper-save]')) this.save();
    }

    onChange(event) {
      if (!event.target.matches('[data-hamper-line]')) return;
      if (event.target.checked) this.selected.add(event.target.value);
      else this.selected.delete(event.target.value);
      this.render();
    }

    onMessage() {
      var message = this.querySelector('[data-hamper-message]');
      this.querySelector('[data-hamper-count]').textContent = message.value.length + ' / 250';
    }

    showConfigurator() {
      this.querySelector('[data-hamper-prompt]').hidden = true;
      this.querySelector('[data-hamper-configurator]').hidden = false;
      var available = Object.keys(this.config.ribbons).filter(function (name) { return this.config.ribbons[name]; }, this);
      if (!this.ribbon || available.indexOf(this.ribbon) < 0) this.ribbon = available[0] || null;
      this.render();
      this.querySelector('[data-hamper-configurator] button, [data-hamper-configurator] input')?.focus();
    }

    activeType() {
      var chosen = this.lines.find(function (item) { return this.selected.has(item.key); }, this);
      return chosen && chosen.hamperType;
    }

    disabledReason(item, activeType) {
      if (!item.hamperType) return 'Not available for hamper';
      if (!activeType || this.selected.has(item.key)) return '';
      if (activeType === 'solo') return 'This item must be packed separately.';
      if (item.hamperType === 'solo') return 'This item is packed separately.';
      if (activeType !== item.hamperType) return activeType === 'food_only'
        ? 'Only food items can be combined with this hamper.'
        : 'Food items cannot be combined with this hamper.';
      return '';
    }

    visibleProperties(item) {
      return Object.entries(item.properties || {}).filter(function (property) {
        return property[0].charAt(0) !== '_' && property[1] !== null && String(property[1]).trim() !== '';
      });
    }

    printingFees(item) {
      var designId = (item.properties || {})._design_id;
      if (!designId || !this.cart) return [];
      return this.cart.items.filter(function (line) {
        var properties = line.properties || {};
        return properties._item_type === 'print_fee' && properties._design_id === designId;
      });
    }

    render() {
      var activeType = this.activeType();
      var products = this.querySelector('[data-hamper-products]');
      products.innerHTML = this.lines.map(function (item) {
        var reason = this.disabledReason(item, activeType);
        var designId = (item.properties || {})._design_id;
        var image = item.image ? '<img src="' + escapeHtml(item.image) + '" ' + (designId ? 'data-design-side="front" ' : '') + 'alt="" width="64" height="64">' : '<span class="hamper-modal__image-placeholder" aria-hidden="true"></span>';
        var variant = item.variant_title && item.variant_title !== 'Default Title' ? '<span>' + escapeHtml(item.variant_title) + '</span>' : '';
        var properties = this.visibleProperties(item).map(function (property) {
          var value = String(property[1]);
          if (value.indexOf('/uploads/') >= 0 || /^https?:\/\//i.test(value)) return '';
          return '<span class="hamper-modal__property"><strong>' + escapeHtml(property[0]) + ':</strong> ' + escapeHtml(value) + '</span>';
        }).join('');
        var fees = this.printingFees(item).map(function (fee) {
          var feeProperties = fee.properties || {};
          var details = ['Print side', 'Print area'].filter(function (key) { return feeProperties[key]; }).map(function (key) {
            return '<span>' + escapeHtml(key) + ': ' + escapeHtml(feeProperties[key]) + '</span>';
          }).join('');
          return '<span class="hamper-modal__fee"><span><strong>↳ ' + escapeHtml(fee.product_title) + '</strong><strong>' + escapeHtml(this.formatMoney(fee.final_line_price)) + '</strong></span>' + details + '</span>';
        }, this).join('');
        return '<label class="hamper-modal__product' + (reason ? ' is-disabled' : '') + '">' +
          '<input type="checkbox" data-hamper-line value="' + escapeHtml(item.key) + '" ' +
          (this.selected.has(item.key) ? 'checked ' : '') + (reason ? 'disabled ' : '') + '>' + image +
          '<span><strong>' + escapeHtml(item.product_title) + '</strong>' + variant +
          properties + '<span>Qty ' + item.quantity + ' · ' + escapeHtml(item.final_line_price == null ? '' : this.formatMoney(item.final_line_price)) + '</span>' + fees +
          (reason ? '<small>' + escapeHtml(reason) + '</small>' : '') + '</span></label>';
      }, this).join('') || '<p>Your cart has no selectable products.</p>';

      var availableRibbons = Object.keys(this.config.ribbons).filter(function (name) { return this.config.ribbons[name]; }, this);
      this.querySelector('[data-hamper-ribbons]').innerHTML = availableRibbons.map(function (name) {
        return '<button type="button" class="hamper-modal__ribbon' + (name === this.ribbon ? ' is-selected' : '') +
          '" data-ribbon="' + name + '" aria-pressed="' + (name === this.ribbon) + '"><span style="--ribbon-color:' +
          ({ Pink: '#e9a5b5', Purple: '#8762a6', Red: '#a9333a', Navy: '#253451', Cream: '#e8dcc2' }[name]) + '"></span>' + name + '</button>';
      }, this).join('') || '<p>No ribbon images have been configured.</p>';

      var visual = this.querySelector('[data-hamper-visual]');
      visual.innerHTML = this.config.box
        ? '<img class="hamper-modal__box" src="' + escapeHtml(this.config.box) + '" alt="Hamper box">' +
          (this.ribbon ? '<img class="hamper-modal__ribbon-image" src="' + escapeHtml(this.config.ribbons[this.ribbon]) + '" alt="' + escapeHtml(this.ribbon) + ' ribbon">' : '')
        : '<p>Hamper preview has not been configured.</p>';

      var packaging = this.config.packaging;
      this.querySelector('[data-hamper-packaging]').innerHTML = packaging && packaging.available
        ? '<span><strong>' + escapeHtml(packaging.title) + '</strong><span>' + escapeHtml(packaging.price) + '</span></span>'
        : '<p>Hamper packaging has not been configured or has no available variant.</p>';
      this.querySelector('[data-hamper-save]').disabled = !packaging || !packaging.available;
    }

    formatMoney(cents) {
      if (window.Shopify && Shopify.currency && Shopify.currency.active) {
        try { return new Intl.NumberFormat(document.documentElement.lang, { style: 'currency', currency: Shopify.currency.active }).format(cents / 100); } catch (_) {}
      }
      return (cents / 100).toFixed(2);
    }

    hamperId() {
      var existing = this.cart.items.find(function (item) { return item.properties && item.properties._hamper_role === 'packaging'; });
      if (existing) return existing.properties._hamper_id;
      return 'HMP-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.random().toString(16).slice(2, 8).toUpperCase();
    }

    async save() {
      var error = this.querySelector('[data-hamper-error]');
      var button = this.querySelector('[data-hamper-save]');
      if (this.isProcessing) return;
      error.hidden = true;
      if (!this.selected.size) return this.showError('Select at least one product for your hamper.');
      if (!this.ribbon) return this.showError('Select an available ribbon color.');
      if (!this.config.packaging || !this.config.packaging.available) return this.showError('Hamper packaging has not been configured.');
      this.setProcessing(true);
      button.querySelector('.button-text').textContent = 'Preparing your hamper...';

      try {
        if (window.CartCheckoutSelection) {
          window.CartCheckoutSelection.setSelected(this.selected);
          await window.CartCheckoutSelection.prepare();
        }
        var cart = await request('cart.js', { headers: { Accept: 'application/json' } });
        var currentKeys = new Set(cart.items.map(function (item) { return item.key; }));
        for (var selectedKey of this.selected) if (!currentKeys.has(selectedKey)) throw new Error('Your cart changed. Please reopen the hamper configurator.');
        var id = this.hamperId();
        var changes = [];
        cart.items.forEach(function (item) {
          var props = Object.assign({}, item.properties || {});
          var isPackaging = props._hamper_role === 'packaging';
          var shouldSelect = this.selected.has(item.key);
          if (isPackaging) return;
          if (shouldSelect) {
            props._hamper_id = id;
            props._hamper_role = 'item';
          } else if (props._hamper_role === 'item') {
            delete props._hamper_id;
            delete props._hamper_role;
          } else return;
          changes.push({ id: item.key, quantity: item.quantity, properties: props });
        }, this);
        for (var change of changes) await post('cart/change.js', change);

        cart = await request('cart.js', { headers: { Accept: 'application/json' } });
        var packagingLines = cart.items.filter(function (item) { return item.properties && item.properties._hamper_role === 'packaging'; });
        var packagingProps = { _hamper_id: id, _hamper_role: 'packaging', 'Ribbon Color': this.ribbon };
        var message = this.querySelector('[data-hamper-message]').value.trim();
        if (message) packagingProps['Gift Message'] = message;
        if (packagingLines[0] && Number(packagingLines[0].variant_id) === Number(this.config.packaging.variantId)) {
          await post('cart/change.js', { id: packagingLines[0].key, quantity: 1, properties: packagingProps });
          for (var i = 1; i < packagingLines.length; i++) await post('cart/change.js', { id: packagingLines[i].key, quantity: 0 });
        } else {
          for (var j = 0; j < packagingLines.length; j++) await post('cart/change.js', { id: packagingLines[j].key, quantity: 0 });
          await post('cart/add.js', { items: [{ id: this.config.packaging.variantId, quantity: 1, properties: packagingProps }] });
        }
        this.setProcessing(false);
        await this.continueCheckout();
      } catch (exception) {
        console.error('[Hamper] Save failed.', exception);
        if (window.CartCheckoutSelection) {
          await window.CartCheckoutSelection.restore().catch(function (restoreError) {
            console.error('[Hamper] Could not restore non-checkout cart items.', restoreError);
          });
        }
        this.showError(exception.message || "We couldn't prepare your hamper. Please try again.");
      } finally {
        this.setProcessing(false);
        button.disabled = !this.config.packaging || !this.config.packaging.available;
        button.querySelector('.button-text').textContent = 'Make My Hamper';
      }
    }

    setProcessing(processing) {
      this.isProcessing = processing;
      this.dialog.setAttribute('aria-busy', processing ? 'true' : 'false');
      this.querySelector('[data-hamper-processing]').hidden = !processing;
      this.querySelector('[data-hamper-close]').inert = processing;
      this.querySelector('[data-hamper-prompt]').inert = processing;
      this.querySelector('[data-hamper-configurator]').inert = processing;
      this.querySelector('[data-hamper-save]').disabled = processing || !this.config.packaging || !this.config.packaging.available;
    }

    showError(message) {
      var error = this.querySelector('[data-hamper-error]');
      error.textContent = message;
      error.hidden = false;
    }
  }

  if (!customElements.get('hamper-modal')) customElements.define('hamper-modal', HamperModal);
})();
