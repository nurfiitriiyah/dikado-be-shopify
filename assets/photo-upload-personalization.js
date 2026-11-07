(function () {
  'use strict';

  var MAX_BYTES = 20 * 1024 * 1024;
  var TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  var SNAPSHOT_TYPE = 'image/jpeg';
  var SNAPSHOT_QUALITY = 0.92;
  var MAX_SNAPSHOT_SIDE = 2400;
  var MAX_ZOOM = 3;

  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (character) {
      var random = Math.random() * 16 | 0;
      return (character === 'x' ? random : (random & 3 | 8)).toString(16);
    });
  }
  function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
  function api(path, options) {
    return fetch('/apps/dikado-address/photo-uploads' + path, Object.assign({ credentials: 'same-origin', headers: { Accept: 'application/json' } }, options || {})).then(async function (response) {
      var result = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(result.error || 'Photo upload service is temporarily unavailable.');
      return result.data;
    });
  }
  function readJson(id) { var node = document.getElementById(id); try { return JSON.parse(node ? node.textContent : 'null'); } catch (_) { return null; } }
  function decode(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file); var image = new Image();
      image.onload = function () {
        var value = { width: image.naturalWidth, height: image.naturalHeight, url: url, image: image };
        if (!value.width || !value.height) { URL.revokeObjectURL(url); reject(new Error('The image has no valid dimensions.')); } else resolve(value);
      };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('This image is damaged or cannot be decoded.')); };
      image.src = url;
    });
  }
  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) { if (blob) resolve(blob); else reject(new Error('Could not prepare the cropped photo.')); }, SNAPSHOT_TYPE, SNAPSHOT_QUALITY);
    });
  }
  function selectedVariant(product) { var input = document.querySelector('form[action*="/cart/add"] [name="id"]'); var id = input && input.value; return product.variants[String(id)] || null; }

  function Controller(dialog) {
    this.dialog = dialog; this.config = readJson(dialog.dataset.configScript) || {}; this.product = readJson(dialog.dataset.productScript) || {};
    this.file = null; this.decoded = null; this.objectUrl = null; this.busy = false; this.renderedVariantId = null;
    this.crop = { zoom: 1, panX: 0, panY: 0 }; this.pointers = new Map(); this.gesture = null; this.bind();
  }
  Controller.prototype.template = function (variantId) { return (this.config.variants && (this.config.variants[String(variantId)] || this.config.variants['gid://shopify/ProductVariant/' + variantId])) || this.config; };
  Controller.prototype.variant = function () { return selectedVariant(this.product); };
  Controller.prototype.status = function (message, error) { var node = this.dialog.querySelector('[data-photo-upload-status]'); node.textContent = message || ''; node.classList.toggle('is-error', Boolean(error)); };
  Controller.prototype.resetCrop = function () {
    this.crop = { zoom: 1, panX: 0, panY: 0 }; var slider = this.dialog.querySelector('[data-photo-upload-zoom-input]'); if (slider) slider.value = '1'; this.applyCrop();
  };
  Controller.prototype.cropMetrics = function () {
    if (!this.decoded) return null; var frame = this.dialog.querySelector('[data-photo-upload-frame]'); var rect = frame.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    var baseScale = Math.max(rect.width / this.decoded.width, rect.height / this.decoded.height);
    return { maxOffsetX: Math.max(0, (this.decoded.width * baseScale * this.crop.zoom - rect.width) / 2), maxOffsetY: Math.max(0, (this.decoded.height * baseScale * this.crop.zoom - rect.height) / 2) };
  };
  Controller.prototype.applyCrop = function () {
    var image = this.dialog.querySelector('[data-photo-upload-image]'); var metrics = this.cropMetrics(); if (!metrics || !image) return;
    this.crop.panX = clamp(this.crop.panX, -1, 1); this.crop.panY = clamp(this.crop.panY, -1, 1);
    image.style.transform = 'translate3d(' + (this.crop.panX * metrics.maxOffsetX) + 'px,' + (this.crop.panY * metrics.maxOffsetY) + 'px,0) scale(' + this.crop.zoom + ')';
  };
  Controller.prototype.renderTemplate = function () {
    var variant = this.variant(); if (!variant) { this.status('Select an available variant first.', true); return; }
    var config = this.template(variant.id); var frame = config && config.frame; if (!config || !config.template_id || !frame) { this.status('This variant does not have a photo template.', true); return; }
    this.dialog.querySelector('[data-photo-upload-variant]').textContent = this.product.title + ' · ' + variant.title;
    var frameNode = this.dialog.querySelector('[data-photo-upload-frame]');
    ['x', 'y', 'width', 'height'].forEach(function (key) { if (!Number.isFinite(Number(frame[key])) || Number(frame[key]) < 0 || Number(frame[key]) > 1) throw new Error('Photo frame configuration is invalid.'); });
    frameNode.style.left = (frame.x * 100) + '%'; frameNode.style.top = (frame.y * 100) + '%'; frameNode.style.width = (frame.width * 100) + '%'; frameNode.style.height = (frame.height * 100) + '%'; frameNode.style.borderRadius = ((frame.border_radius || 0) * 100) + '%';
    var base = this.dialog.querySelector('[data-photo-upload-template]'); var overlay = this.dialog.querySelector('[data-photo-upload-overlay]');
    base.hidden = !config.template_image_url; if (config.template_image_url) base.src = config.template_image_url; overlay.hidden = !config.overlay_image_url; if (config.overlay_image_url) overlay.src = config.overlay_image_url;
    if (this.renderedVariantId !== String(variant.id)) { this.renderedVariantId = String(variant.id); this.resetCrop(); }
    this.status('');
  };
  Controller.prototype.choose = async function (file) {
    if (!file) return; if (TYPES.indexOf(file.type) < 0) throw new Error('Choose a JPEG, PNG, or WebP image.'); if (!file.size || file.size > MAX_BYTES) throw new Error('Photo must be no larger than 20 MB.');
    var decoded = await decode(file); if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); this.file = file; this.decoded = decoded; this.objectUrl = decoded.url;
    var image = this.dialog.querySelector('[data-photo-upload-image]'); image.src = decoded.url; image.hidden = false;
    this.dialog.querySelector('[data-photo-upload-dropzone]').hidden = true; this.dialog.querySelector('[data-photo-upload-change]').hidden = false; this.dialog.querySelector('[data-photo-upload-remove]').hidden = false; this.dialog.querySelector('[data-photo-upload-zoom]').hidden = false; this.dialog.querySelector('[data-photo-upload-submit]').disabled = false;
    this.resetCrop(); var config = this.template(this.variant().id); var minWidth = Number(config.min_width || 0), minHeight = Number(config.min_height || 0);
    this.status(decoded.width < minWidth || decoded.height < minHeight ? 'Warning: this photo may look blurry when printed.' : 'Drag to reposition and use the slider or pinch to zoom.');
  };
  Controller.prototype.remove = function () {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; this.file = null; this.decoded = null; this.pointers.clear(); this.gesture = null;
    var image = this.dialog.querySelector('[data-photo-upload-image]'); image.hidden = true; image.removeAttribute('src'); image.style.removeProperty('transform');
    this.dialog.querySelector('[data-photo-upload-dropzone]').hidden = false; this.dialog.querySelector('[data-photo-upload-change]').hidden = true; this.dialog.querySelector('[data-photo-upload-remove]').hidden = true; this.dialog.querySelector('[data-photo-upload-zoom]').hidden = true; this.dialog.querySelector('[data-photo-upload-submit]').disabled = true; this.dialog.querySelector('[data-photo-upload-input]').value = '';
    this.resetCrop(); this.status('');
  };
  Controller.prototype.snapshot = async function () {
    if (!this.decoded) throw new Error('Choose a photo first.');
    var frame = this.template(this.variant().id).frame; var frameAspect = Number(frame.width) / Number(frame.height); var sourceWidth = this.decoded.width; var sourceHeight = this.decoded.height;
    var baseScale = Math.max(1 / sourceWidth, (1 / frameAspect) / sourceHeight); var cropWidth = 1 / (baseScale * this.crop.zoom); var cropHeight = (1 / frameAspect) / (baseScale * this.crop.zoom);
    var cropX = clamp((sourceWidth - cropWidth) / 2 - this.crop.panX * (sourceWidth - cropWidth) / 2, 0, sourceWidth - cropWidth); var cropY = clamp((sourceHeight - cropHeight) / 2 - this.crop.panY * (sourceHeight - cropHeight) / 2, 0, sourceHeight - cropHeight);
    var outputWidth = Math.max(1, Math.min(MAX_SNAPSHOT_SIDE, Math.round(cropWidth))); var outputHeight = Math.max(1, Math.round(outputWidth / frameAspect));
    if (outputHeight > MAX_SNAPSHOT_SIDE || outputHeight > Math.round(cropHeight)) { outputHeight = Math.max(1, Math.min(MAX_SNAPSHOT_SIDE, Math.round(cropHeight))); outputWidth = Math.max(1, Math.round(outputHeight * frameAspect)); }
    var canvas = document.createElement('canvas'); canvas.width = outputWidth; canvas.height = outputHeight; var context = canvas.getContext('2d'); if (!context) throw new Error('Could not prepare the cropped photo.');
    context.fillStyle = '#fff'; context.fillRect(0, 0, outputWidth, outputHeight); context.drawImage(this.decoded.image, cropX, cropY, cropWidth, cropHeight, 0, 0, outputWidth, outputHeight);
    var blob = await canvasToBlob(canvas);
    return { blob: blob, data: { version: 1, zoom: Number(this.crop.zoom.toFixed(4)), pan_x: Number(this.crop.panX.toFixed(6)), pan_y: Number(this.crop.panY.toFixed(6)), source: { width: sourceWidth, height: sourceHeight }, crop: { x: Number(cropX.toFixed(3)), y: Number(cropY.toFixed(3)), width: Number(cropWidth.toFixed(3)), height: Number(cropHeight.toFixed(3)) }, output: { width: outputWidth, height: outputHeight } } };
  };
  Controller.prototype.submit = async function () {
    if (this.busy || !this.file) return; var variant = this.variant(); if (!variant || !variant.available) throw new Error('Select an available variant.');
    this.busy = true; var submit = this.dialog.querySelector('[data-photo-upload-submit]'); submit.disabled = true; this.status('Preparing your cropped photo…');
    try {
      var snapshot = await this.snapshot(); var cart = await fetch('/cart.js', { credentials: 'same-origin' }).then(function (response) { return response.json(); }); var cartToken = String(cart.token || ''); var id = uuid();
      await api('/authorize', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ photo_upload_id: id, cart_token: cartToken, product_id: this.product.productId, variant_id: variant.id, mime_type: snapshot.blob.type, file_size: snapshot.blob.size, original_filename: this.file.name }) });
      this.status('Uploading your cropped photo…');
      var upload = await fetch('/apps/dikado-address/photo-uploads/' + encodeURIComponent(id) + '/upload', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': snapshot.blob.type, 'X-Dikado-Cart-Token': cartToken }, body: snapshot.blob });
      if (!upload.ok) throw new Error('Photo upload failed. Nothing was added to cart.');
      var committed = await api('/' + id + '/commit', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ cart_token: cartToken, variant_id: variant.id, crop_data: snapshot.data }) });
      this.status('Adding personalized product to cart…');
      var added = await fetch('/cart/add.js', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items: [{ id: Number(variant.id), quantity: 1, properties: { _dikado_photo_upload_id: committed.photo_upload_id, _dikado_photo_template_id: committed.template_id, Personalization: 'Photo uploaded' } }] }) });
      if (!added.ok) { await api('/' + id + '/failed', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ cart_token: cartToken }) }).catch(function () {}); throw new Error((await added.json().catch(function () { return {}; })).description || 'Could not add the product to cart.'); }
      this.dialog.close(); document.dispatchEvent(new CustomEvent('cart:update', { bubbles: true, detail: { source: 'photo-upload' } })); window.location.assign('/cart');
    } finally { this.busy = false; submit.disabled = !this.file; }
  };
  Controller.prototype.pointerDown = function (event) {
    if (!this.file || this.busy) return; var frame = this.dialog.querySelector('[data-photo-upload-frame]'); frame.setPointerCapture(event.pointerId); this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); frame.classList.add('is-dragging');
    if (this.pointers.size === 2) { var points = Array.from(this.pointers.values()); this.gesture = { distance: Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y), zoom: this.crop.zoom }; }
  };
  Controller.prototype.pointerMove = function (event) {
    if (!this.pointers.has(event.pointerId)) return; event.preventDefault(); var previous = this.pointers.get(event.pointerId); this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY }); var metrics = this.cropMetrics(); if (!metrics) return;
    if (this.pointers.size >= 2) { var points = Array.from(this.pointers.values()).slice(0, 2); var distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y); if (!this.gesture) this.gesture = { distance: distance, zoom: this.crop.zoom }; this.crop.zoom = clamp(this.gesture.zoom * distance / Math.max(1, this.gesture.distance), 1, MAX_ZOOM); this.dialog.querySelector('[data-photo-upload-zoom-input]').value = String(this.crop.zoom); }
    else { var offsetX = this.crop.panX * metrics.maxOffsetX + event.clientX - previous.x; var offsetY = this.crop.panY * metrics.maxOffsetY + event.clientY - previous.y; this.crop.panX = metrics.maxOffsetX ? clamp(offsetX / metrics.maxOffsetX, -1, 1) : 0; this.crop.panY = metrics.maxOffsetY ? clamp(offsetY / metrics.maxOffsetY, -1, 1) : 0; }
    this.applyCrop();
  };
  Controller.prototype.pointerUp = function (event) { this.pointers.delete(event.pointerId); if (this.pointers.size < 2) this.gesture = null; if (!this.pointers.size) this.dialog.querySelector('[data-photo-upload-frame]').classList.remove('is-dragging'); };
  Controller.prototype.bind = function () {
    var self = this; var frame = this.dialog.querySelector('[data-photo-upload-frame]');
    this.dialog.querySelector('[data-photo-upload-close]').addEventListener('click', function () { self.dialog.close(); });
    this.dialog.querySelector('[data-photo-upload-input]').addEventListener('change', function (event) { self.choose(event.target.files[0]).catch(function (error) { self.remove(); self.status(error.message, true); }); });
    this.dialog.querySelector('[data-photo-upload-change]').addEventListener('click', function () { self.dialog.querySelector('[data-photo-upload-input]').click(); }); this.dialog.querySelector('[data-photo-upload-remove]').addEventListener('click', function () { self.remove(); });
    this.dialog.querySelector('[data-photo-upload-zoom-input]').addEventListener('input', function (event) { self.crop.zoom = clamp(Number(event.target.value) || 1, 1, MAX_ZOOM); self.applyCrop(); });
    frame.addEventListener('pointerdown', function (event) { self.pointerDown(event); }); frame.addEventListener('pointermove', function (event) { self.pointerMove(event); }); frame.addEventListener('pointerup', function (event) { self.pointerUp(event); }); frame.addEventListener('pointercancel', function (event) { self.pointerUp(event); });
    this.dialog.querySelector('[data-photo-upload-form]').addEventListener('submit', function (event) { event.preventDefault(); self.submit().catch(function (error) { self.status(error.message, true); }); });
    document.addEventListener('change', function (event) { if (event.target && event.target.matches('[name="id"]')) { try { self.renderTemplate(); } catch (error) { self.status(error.message, true); } } }); window.addEventListener('resize', function () { self.applyCrop(); });
  };
  var controllers = new Map(); function controller(dialog) { if (!controllers.has(dialog)) controllers.set(dialog, new Controller(dialog)); return controllers.get(dialog); }
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-photo-upload-open]'); if (!button) return; var dialog = document.querySelector('[data-photo-upload-dialog]'); if (!dialog) return; event.preventDefault(); var current = controller(dialog);
    try { current.renderTemplate(); dialog.showModal(); requestAnimationFrame(function () { current.applyCrop(); }); } catch (error) { current.status(error.message, true); dialog.showModal(); }
  });
})();
