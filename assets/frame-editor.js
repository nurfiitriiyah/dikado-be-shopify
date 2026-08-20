(function () {
  'use strict';

  window.ShopifyCustomProduct = window.ShopifyCustomProduct || {};

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = reject;
      image.src = src;
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Unable to create frame image.'));
      }, type || 'image/png', quality || 1);
    });
  }

  /**
   * MVP frame cropper.
   *
   * The image is edited in a small HTML crop dialog (drag + zoom only), then
   * flattened into one transparent PNG and inserted into Fabric as a normal image.
   * This keeps the main canvas generic across T-shirts, totes, mugs, etc.
   */
  function FrameCropper() {
    this.dialog = null;
    this.viewport = null;
    this.imageEl = null;
    this.zoomInput = null;
    this.state = null;
    this.resolve = null;
    this.reject = null;
    this.pointer = null;
    this.ensureDialog();
  }

  FrameCropper.prototype.ensureDialog = function () {
    if (this.dialog) return;

    var dialog = document.createElement('dialog');
    dialog.className = 'customizer-frame-cropper';
    dialog.innerHTML = [
      '<div class="customizer-frame-cropper-inner">',
      '  <div class="customizer-frame-cropper-header">',
      '    <div><h3>Edit image inside frame</h3><small>Drag the image and adjust zoom.</small></div>',
      '    <button type="button" class="customizer-icon-button" data-frame-cancel aria-label="Close">×</button>',
      '  </div>',
      '  <div class="customizer-frame-viewport is-square" data-frame-viewport>',
      '    <img data-frame-image alt="Image being cropped" draggable="false">',
      '    <div class="customizer-frame-guide"></div>',
      '  </div>',
      '  <div class="customizer-frame-controls">',
      '    <label>Zoom <input data-frame-zoom type="range" min="1" max="4" value="1" step="0.01"></label>',
      '  </div>',
      '  <div class="customizer-frame-actions">',
      '    <button type="button" class="button button--secondary" data-frame-cancel>Cancel</button>',
      '    <button type="button" class="button" data-frame-done>Done</button>',
      '  </div>',
      '</div>'
    ].join('');

    document.body.appendChild(dialog);
    this.dialog = dialog;
    this.viewport = dialog.querySelector('[data-frame-viewport]');
    this.imageEl = dialog.querySelector('[data-frame-image]');
    this.zoomInput = dialog.querySelector('[data-frame-zoom]');

    var self = this;

    dialog.querySelectorAll('[data-frame-cancel]').forEach(function (button) {
      button.addEventListener('click', function () { self.cancel(); });
    });

    dialog.querySelector('[data-frame-done]').addEventListener('click', function () {
      self.finish().catch(function (error) {
        console.error(error);
        self.cancel(error);
      });
    });

    this.zoomInput.addEventListener('input', function () {
      if (!self.state) return;
      self.state.zoom = Number(self.zoomInput.value);
      self.renderTransform();
    });

    this.viewport.addEventListener('pointerdown', function (event) {
      if (!self.state) return;
      self.pointer = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: self.state.offsetX,
        offsetY: self.state.offsetY
      };
      self.viewport.setPointerCapture(event.pointerId);
    });

    this.viewport.addEventListener('pointermove', function (event) {
      if (!self.pointer || self.pointer.id !== event.pointerId || !self.state) return;
      self.state.offsetX = self.pointer.offsetX + (event.clientX - self.pointer.startX);
      self.state.offsetY = self.pointer.offsetY + (event.clientY - self.pointer.startY);
      self.renderTransform();
    });

    function endPointer(event) {
      if (!self.pointer || self.pointer.id !== event.pointerId) return;
      self.pointer = null;
    }

    this.viewport.addEventListener('pointerup', endPointer);
    this.viewport.addEventListener('pointercancel', endPointer);

    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      self.cancel();
    });
  };

  FrameCropper.prototype.open = async function (options) {
    options = options || {};
    var shape = options.shape === 'circle' ? 'circle' : 'square';
    var sourceDataUrl = options.meta && options.meta.sourceDataUrl
      ? options.meta.sourceDataUrl
      : await fileToDataUrl(options.file);

    var image = await loadImage(sourceDataUrl);

    this.state = {
      shape: shape,
      sourceDataUrl: sourceDataUrl,
      naturalWidth: image.naturalWidth || image.width,
      naturalHeight: image.naturalHeight || image.height,
      offsetX: options.meta ? Number(options.meta.offsetX || 0) : 0,
      offsetY: options.meta ? Number(options.meta.offsetY || 0) : 0,
      zoom: options.meta ? Number(options.meta.zoom || 1) : 1
    };

    this.viewport.classList.toggle('is-circle', shape === 'circle');
    this.viewport.classList.toggle('is-square', shape !== 'circle');
    this.imageEl.src = sourceDataUrl;
    this.zoomInput.value = String(this.state.zoom);

    await new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
    this.renderTransform();

    var self = this;
    this.dialog.showModal();

    return new Promise(function (resolve, reject) {
      self.resolve = resolve;
      self.reject = reject;
    });
  };

  FrameCropper.prototype.renderTransform = function () {
    if (!this.state || !this.viewport) return;
    var viewportSize = this.viewport.clientWidth || 320;
    var coverScale = Math.max(
      viewportSize / this.state.naturalWidth,
      viewportSize / this.state.naturalHeight
    );
    var scale = coverScale * this.state.zoom;
    this.imageEl.style.width = this.state.naturalWidth + 'px';
    this.imageEl.style.height = this.state.naturalHeight + 'px';
    this.imageEl.style.transform = [
      'translate(-50%, -50%)',
      'translate(' + this.state.offsetX + 'px,' + this.state.offsetY + 'px)',
      'scale(' + scale + ')'
    ].join(' ');
  };

  FrameCropper.prototype.finish = async function () {
    if (!this.state) return;

    var outputSize = 1000;
    var canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    var ctx = canvas.getContext('2d');
    var image = await loadImage(this.state.sourceDataUrl);
    var viewportSize = this.viewport.clientWidth || 320;

    var coverScaleViewport = Math.max(
      viewportSize / this.state.naturalWidth,
      viewportSize / this.state.naturalHeight
    );
    var drawScale = coverScaleViewport * this.state.zoom * (outputSize / viewportSize);
    var drawWidth = this.state.naturalWidth * drawScale;
    var drawHeight = this.state.naturalHeight * drawScale;
    var drawX = (outputSize - drawWidth) / 2 + this.state.offsetX * (outputSize / viewportSize);
    var drawY = (outputSize - drawHeight) / 2 + this.state.offsetY * (outputSize / viewportSize);

    ctx.clearRect(0, 0, outputSize, outputSize);
    ctx.save();
    ctx.beginPath();
    if (this.state.shape === 'circle') {
      ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
    } else {
      ctx.rect(0, 0, outputSize, outputSize);
    }
    ctx.clip();
    ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();

    var blob = await canvasToBlob(canvas, 'image/png', 1);
    var result = {
      blob: blob,
      meta: {
        shape: this.state.shape,
        sourceDataUrl: this.state.sourceDataUrl,
        offsetX: this.state.offsetX,
        offsetY: this.state.offsetY,
        zoom: this.state.zoom
      }
    };

    if (this.dialog.open) this.dialog.close();
    this.state = null;
    var resolve = this.resolve;
    this.resolve = null;
    this.reject = null;
    if (resolve) resolve(result);
  };

  FrameCropper.prototype.cancel = function (error) {
    if (this.dialog && this.dialog.open) this.dialog.close();
    this.state = null;
    var reject = this.reject;
    this.resolve = null;
    this.reject = null;
    if (reject) reject(error || new DOMException('Frame editing cancelled', 'AbortError'));
  };

  window.ShopifyCustomProduct.FrameCropper = FrameCropper;
})();
