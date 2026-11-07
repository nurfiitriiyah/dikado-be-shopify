(function () {
  'use strict';

  var viewer;

  function createComposite(container, photoUrl, config) {
    var frame = config.frame || {};
    container.textContent = '';
    container.style.position = 'relative';
    container.style.aspectRatio = '1';
    container.style.overflow = 'hidden';

    if (config.template_image_url) {
      var base = document.createElement('img');
      base.src = config.template_image_url;
      base.alt = '';
      base.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1';
      container.appendChild(base);
    }

    var wrap = document.createElement('span');
    wrap.style.cssText = 'position:absolute;overflow:hidden;z-index:2;left:' + (Number(frame.x || 0) * 100) + '%;top:' + (Number(frame.y || 0) * 100) + '%;width:' + (Number(frame.width || 1) * 100) + '%;height:' + (Number(frame.height || 1) * 100) + '%';
    var photo = document.createElement('img');
    photo.src = photoUrl;
    photo.alt = '';
    photo.draggable = false;
    photo.style.cssText = 'width:100%;height:100%;object-fit:cover;object-position:center;user-select:none';
    wrap.appendChild(photo);
    container.appendChild(wrap);

    if (config.overlay_image_url) {
      var overlay = document.createElement('img');
      overlay.src = config.overlay_image_url;
      overlay.alt = '';
      overlay.draggable = false;
      overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:3;pointer-events:none;user-select:none';
      container.appendChild(overlay);
    }
  }

  function ensureViewer() {
    if (viewer) return viewer;
    var dialog = document.createElement('dialog');
    dialog.className = 'photo-cart-viewer';
    dialog.innerHTML = '<div class="photo-cart-viewer__header"><h2></h2><button class="photo-cart-viewer__close" type="button"><span aria-hidden="true">&times;</span></button></div><div class="photo-cart-viewer__viewport"><div class="photo-cart-viewer__stage"></div></div><p class="photo-cart-viewer__hint"></p>';
    document.body.appendChild(dialog);

    var title = dialog.querySelector('h2');
    var close = dialog.querySelector('.photo-cart-viewer__close');
    var viewport = dialog.querySelector('.photo-cart-viewer__viewport');
    var stage = dialog.querySelector('.photo-cart-viewer__stage');
    var hint = dialog.querySelector('.photo-cart-viewer__hint');
    var pointers = new Map();
    var state = { zoom: 1, x: 0, y: 0, dragX: 0, dragY: 0, pinchDistance: 0, pinchZoom: 1 };

    function transform() {
      var limit = Math.max(0, viewport.clientWidth * (state.zoom - 1) / 2);
      state.x = Math.max(-limit, Math.min(limit, state.x));
      state.y = Math.max(-limit, Math.min(limit, state.y));
      stage.style.transform = 'translate(' + state.x + 'px,' + state.y + 'px) scale(' + state.zoom + ')';
    }
    function reset() {
      pointers.clear();
      state.zoom = 1; state.x = 0; state.y = 0; state.pinchDistance = 0;
      transform();
    }
    function distance() {
      var points = Array.from(pointers.values());
      return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    }

    close.addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', reset);
    viewport.addEventListener('wheel', function (event) {
      event.preventDefault();
      state.zoom = Math.max(1, Math.min(4, state.zoom * (event.deltaY < 0 ? 1.12 : 0.89)));
      if (state.zoom === 1) { state.x = 0; state.y = 0; }
      transform();
    }, { passive: false });
    viewport.addEventListener('pointerdown', function (event) {
      viewport.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      viewport.classList.add('is-dragging');
      if (pointers.size === 1) { state.dragX = event.clientX - state.x; state.dragY = event.clientY - state.y; }
      if (pointers.size === 2) { state.pinchDistance = distance(); state.pinchZoom = state.zoom; }
    });
    viewport.addEventListener('pointermove', function (event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        state.zoom = Math.max(1, Math.min(4, state.pinchZoom * distance() / Math.max(1, state.pinchDistance)));
      } else if (pointers.size === 1 && state.zoom > 1) {
        state.x = event.clientX - state.dragX;
        state.y = event.clientY - state.dragY;
      }
      transform();
    });
    function release(event) {
      pointers.delete(event.pointerId);
      if (!pointers.size) viewport.classList.remove('is-dragging');
      if (pointers.size === 1) {
        var point = Array.from(pointers.values())[0];
        state.dragX = point.x - state.x; state.dragY = point.y - state.y;
      }
    }
    viewport.addEventListener('pointerup', release);
    viewport.addEventListener('pointercancel', release);

    viewer = {
      open: function (photoUrl, config, labels) {
        title.textContent = labels.title;
        hint.textContent = labels.hint;
        close.setAttribute('aria-label', labels.close);
        createComposite(stage, photoUrl, config);
        reset();
        dialog.showModal();
      }
    };
    return viewer;
  }

  async function loadNode(node, cartToken) {
    if (node.dataset.photoPreviewLoaded === 'true') return;
    node.dataset.photoPreviewLoaded = 'true';
    var id = encodeURIComponent(node.dataset.photoUploadPreviewId);
    var endpoint = '/apps/dikado-address/photo-uploads/' + id;
    var request = { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cart_token: cartToken }) };
    try {
      var responses = await Promise.all([
        fetch(endpoint + '/preview', Object.assign({}, request, { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } })),
        fetch(endpoint + '/content', Object.assign({}, request, { headers: { 'Content-Type': 'application/json', Accept: 'image/jpeg,image/png,image/webp' } }))
      ]);
      var metadata = await responses[0].json();
      if (!responses[0].ok) throw new Error(metadata.error || 'Preview metadata unavailable');
      if (!responses[1].ok) throw new Error('Preview image unavailable');
      var blob = await responses[1].blob();
      if (!/^image\/(jpeg|png|webp)$/.test(blob.type)) throw new Error('Invalid preview image');

      if (node._photoObjectUrl) URL.revokeObjectURL(node._photoObjectUrl);
      node._photoObjectUrl = URL.createObjectURL(blob);
      var config = metadata.data.template || {};
      var canvas = node.querySelector('[data-photo-cart-canvas]');
      createComposite(canvas, node._photoObjectUrl, config);
      canvas.hidden = false;
      node.querySelector('[data-photo-cart-fallback]').hidden = true;

      var row = node.closest('[data-key]');
      var button = row && row.querySelector('[data-photo-cart-view]');
      if (!button) throw new Error('Preview action unavailable');
      button.disabled = false;
      button.addEventListener('click', function () {
        ensureViewer().open(node._photoObjectUrl, config, {
          title: node.dataset.photoPreviewLabel,
          hint: node.dataset.photoPreviewHint,
          close: node.dataset.photoPreviewClose
        });
      });
    } catch (_) {
      node.dataset.photoPreviewLoaded = 'false';
      node.querySelector('[data-photo-cart-fallback]').hidden = false;
      node.querySelector('[data-photo-cart-canvas]').hidden = true;
      var row = node.closest('[data-key]');
      var button = row && row.querySelector('[data-photo-cart-view]');
      if (button) button.disabled = true;
    }
  }

  async function render(root) {
    var scope = root || document;
    var nodes = Array.from(scope.querySelectorAll ? scope.querySelectorAll('[data-photo-upload-preview-id]') : []);
    if (scope.matches && scope.matches('[data-photo-upload-preview-id]')) nodes.unshift(scope);
    nodes = nodes.filter(function (node) { return node.dataset.photoPreviewLoaded !== 'true'; });
    if (!nodes.length) return;
    try {
      var response = await fetch('/cart.js', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Cart unavailable');
      var cart = await response.json();
      await Promise.all(nodes.map(function (node) { return loadNode(node, cart.token); }));
    } catch (_) {
      nodes.forEach(function (node) {
        node.querySelector('[data-photo-cart-fallback]').hidden = false;
        node.querySelector('[data-photo-cart-canvas]').hidden = true;
      });
    }
  }

  document.addEventListener('DOMContentLoaded', function () { render(document); });
  new MutationObserver(function (records) {
    records.forEach(function (record) {
      record.addedNodes.forEach(function (node) { if (node.nodeType === 1) render(node); });
      record.removedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        var previews = [];
        if (node.matches && node.matches('[data-photo-upload-preview-id]')) previews.push(node);
        if (node.querySelectorAll) previews = previews.concat(Array.from(node.querySelectorAll('[data-photo-upload-preview-id]')));
        previews.forEach(function (preview) { if (preview._photoObjectUrl) URL.revokeObjectURL(preview._photoObjectUrl); });
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
