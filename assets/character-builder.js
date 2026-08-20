(function () {
  'use strict';

  window.ShopifyCustomProduct = window.ShopifyCustomProduct || {};

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
    var binary = atob(parts[1]);
    var array = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) array[i] = binary.charCodeAt(i);
    return new Blob([array], { type: mime });
  }

  function normalizeResult(result) {
    if (!result) return null;
    if (result instanceof Blob) return result;
    if (result.blob instanceof Blob) return result.blob;
    if (result.file instanceof Blob) return result.file;
    if (typeof result === 'string' && result.indexOf('data:image/') === 0) return dataUrlToBlob(result);
    if (typeof result.dataUrl === 'string') return dataUrlToBlob(result.dataUrl);
    return null;
  }

  /**
   * Integration adapter for an existing modular character builder.
   *
   * Preferred contract:
   * window.DikadoCharacterBuilder.open({ onFinish, onCancel })
   *   - onFinish accepts Blob, File, data URL, { blob }, { file }, or { dataUrl }.
   *
   * Alternative event contract:
   * listen for `customizer:open-character-builder`, then call detail.finish(result)
   * or detail.cancel().
   *
   * If no builder is connected, this file provides a fallback transparent-PNG upload
   * so the complete custom product workflow can still be tested immediately.
   */
  function CharacterBuilderAdapter(customizerRoot) {
    this.fallbackDialog = null;
    this.customizerRoot = customizerRoot || null;
    this.builderRoot = null;
    if (this.customizerRoot && this.customizerRoot.dataset && this.customizerRoot.dataset.sectionId) {
      this.builderRoot = document.getElementById('bp-builder-embedded-' + this.customizerRoot.dataset.sectionId);
    }
  }

  CharacterBuilderAdapter.prototype.open = function () {
    var self = this;

    // Preferred integration in this combined package: the user's existing BP Sticker Builder.
    // It returns one flattened transparent PNG Blob plus optional metadata.
    if (window.BPCharacterBuilder && typeof window.BPCharacterBuilder.open === 'function') {
      return window.BPCharacterBuilder.open({ root: this.builderRoot || undefined }).then(function (result) {
        var blob = normalizeResult(result);
        if (!blob) throw new Error('BP Character Builder did not return a flattened PNG Blob.');
        return blob;
      });
    }

    if (window.DikadoCharacterBuilder && typeof window.DikadoCharacterBuilder.open === 'function') {
      return new Promise(function (resolve, reject) {
        window.DikadoCharacterBuilder.open({
          onFinish: function (result) {
            var blob = normalizeResult(result);
            if (!blob) return reject(new Error('Character Builder did not return an image Blob or data URL.'));
            resolve(blob);
          },
          onCancel: function () {
            reject(new DOMException('Character creation cancelled', 'AbortError'));
          }
        });
      });
    }

    var eventClaimed = false;
    var eventPromise = new Promise(function (resolve, reject) {
      var event = new CustomEvent('customizer:open-character-builder', {
        cancelable: true,
        detail: {
          claim: function () { eventClaimed = true; },
          finish: function (result) {
            eventClaimed = true;
            var blob = normalizeResult(result);
            if (!blob) return reject(new Error('Character Builder returned an unsupported result.'));
            resolve(blob);
          },
          cancel: function () {
            eventClaimed = true;
            reject(new DOMException('Character creation cancelled', 'AbortError'));
          }
        }
      });
      document.dispatchEvent(event);
    });

    return new Promise(function (resolve, reject) {
      // Give external integrations one microtask to synchronously claim the event.
      Promise.resolve().then(function () {
        if (eventClaimed) {
          eventPromise.then(resolve, reject);
          return;
        }
        self.openFallback().then(resolve, reject);
      });
    });
  };

  CharacterBuilderAdapter.prototype.openFallback = function () {
    this.ensureFallback();
    var dialog = this.fallbackDialog;
    var input = dialog.querySelector('[data-character-file]');
    var finish = dialog.querySelector('[data-character-fallback-finish]');
    input.value = '';
    finish.disabled = true;

    return new Promise(function (resolve, reject) {
      function cleanup() {
        input.removeEventListener('change', onChange);
        finish.removeEventListener('click', onFinish);
        dialog.querySelectorAll('[data-character-fallback-cancel]').forEach(function (button) {
          button.removeEventListener('click', onCancel);
        });
        dialog.removeEventListener('cancel', onDialogCancel);
      }

      function onChange() {
        finish.disabled = !(input.files && input.files[0]);
      }

      function onFinish() {
        if (!(input.files && input.files[0])) return;
        var file = input.files[0];
        cleanup();
        dialog.close();
        resolve(file);
      }

      function onCancel() {
        cleanup();
        dialog.close();
        reject(new DOMException('Character creation cancelled', 'AbortError'));
      }

      function onDialogCancel(event) {
        event.preventDefault();
        onCancel();
      }

      input.addEventListener('change', onChange);
      finish.addEventListener('click', onFinish);
      dialog.querySelectorAll('[data-character-fallback-cancel]').forEach(function (button) {
        button.addEventListener('click', onCancel);
      });
      dialog.addEventListener('cancel', onDialogCancel);
      dialog.showModal();
    });
  };

  CharacterBuilderAdapter.prototype.ensureFallback = function () {
    if (this.fallbackDialog) return;
    var dialog = document.createElement('dialog');
    dialog.className = 'customizer-character-fallback';
    dialog.innerHTML = [
      '<div class="customizer-character-fallback-inner">',
      '  <h3>Character Builder integration</h3>',
      '  <p>Your existing modular Character Builder has not been connected yet. For testing, upload the flattened transparent PNG that the builder would normally return.</p>',
      '  <input type="file" accept="image/png,image/webp" data-character-file>',
      '  <div class="customizer-actions">',
      '    <button type="button" class="button button--secondary" data-character-fallback-cancel>Cancel</button>',
      '    <button type="button" class="button" data-character-fallback-finish disabled>Use Character PNG</button>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(dialog);
    this.fallbackDialog = dialog;
  };

  window.ShopifyCustomProduct.CharacterBuilderAdapter = CharacterBuilderAdapter;
})();
