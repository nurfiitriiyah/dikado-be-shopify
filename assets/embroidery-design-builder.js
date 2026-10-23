(function () {
  'use strict';

  window.ShopifyCustomProduct = window.ShopifyCustomProduct || {};
  var NS = window.ShopifyCustomProduct;

  var EMBROIDERY_TEXT_MAX_LENGTH = 12;
  var ARTWORK_WIDTH = 2400;
  var ARTWORK_HEIGHT = 600;
  var MIN_ARTBOARD_SIZE = 600;
  var MAX_ARTBOARD_SIZE = 4000;
  var SUPPORTED_LAYOUTS = ['text_only', 'sulur', 'leaf', 'circle', 'rectangle'];
  var SAFE_FONT_WEIGHTS = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
  var DECORATION_CACHE = new Map();

  // Exact text-only catalog used before Metaobject templates. It is selected
  // only when the product-specific payload has no valid entry.
  var EMBROIDERY_TEMPLATES = [
    {
      id: 'classic-bold', label: 'Classic Bold', layout: 'text_only',
      fontFamily: 'Arial, Helvetica, sans-serif', fontWeight: '800', fontStyle: 'normal',
      previewStyle: 'uppercase', decorationScale: 0.42, colorMode: 'thread',
      artboardWidth: ARTWORK_WIDTH, artboardHeight: ARTWORK_HEIGHT
    },
    {
      id: 'heritage-serif', label: 'Heritage Serif', layout: 'text_only',
      fontFamily: 'Georgia, Times New Roman, serif', fontWeight: '700', fontStyle: 'normal',
      previewStyle: 'serif', decorationScale: 0.42, colorMode: 'thread',
      artboardWidth: ARTWORK_WIDTH, artboardHeight: ARTWORK_HEIGHT
    },
    {
      id: 'signature', label: 'Signature', layout: 'text_only',
      fontFamily: 'Trebuchet MS, Arial, sans-serif', fontWeight: '700', fontStyle: 'italic',
      previewStyle: 'italic', decorationScale: 0.42, colorMode: 'thread',
      artboardWidth: ARTWORK_WIDTH, artboardHeight: ARTWORK_HEIGHT
    }
  ];

  var EMBROIDERY_THREAD_COLORS = [
    { id: 'black', label: 'Hitam', value: '#191716' },
    { id: 'ivory', label: 'Ivory', value: '#f3ead7' },
    { id: 'navy', label: 'Navy', value: '#172b4d' },
    { id: 'red', label: 'Merah', value: '#a8262d' },
    { id: 'gold', label: 'Emas', value: '#b88427' },
    { id: 'forest', label: 'Hijau', value: '#225c45' }
  ];

  function truncateEmbroideryText(value) {
    var singleLine = String(value == null ? '' : value).replace(/[\r\n]+/g, ' ');
    return Array.from(singleLine).slice(0, EMBROIDERY_TEXT_MAX_LENGTH).join('');
  }

  function characterCount(value) {
    return Array.from(String(value == null ? '' : value)).length;
  }

  function clamp(value, minimum, maximum, fallback) {
    var number = Number(value);
    if (!Number.isFinite(number)) number = fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function cleanText(value, maximumLength) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, maximumLength);
  }

  function normalizeFontFamily(value) {
    var fontFamily = cleanText(value, 160);
    if (!fontFamily || !/^[a-z0-9\s,'"_-]+$/i.test(fontFamily)) {
      return 'Arial, Helvetica, sans-serif';
    }
    return fontFamily;
  }

  function normalizeAssetUrl(value) {
    var url = cleanText(value, 2048);
    if (!/^(https?:)?\/\/[^\s"'<>]+$/i.test(url)) return '';
    return url;
  }

  function normalizeEmbroideryTemplate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var id = cleanText(raw.id == null ? raw.template_id : raw.id, 120);
    var label = cleanText(raw.label == null ? raw.name : raw.label, 160);
    var layout = cleanText(raw.layout, 30).toLowerCase();
    if (!id || !label || SUPPORTED_LAYOUTS.indexOf(layout) === -1) return null;

    var decorationUrl = normalizeAssetUrl(raw.decorationUrl == null ? raw.decoration_url : raw.decorationUrl);
    if (layout !== 'text_only' && !decorationUrl) return null;

    var fontWeight = cleanText(raw.fontWeight == null ? raw.font_weight : raw.fontWeight, 10).toLowerCase();
    if (SAFE_FONT_WEIGHTS.indexOf(fontWeight) === -1) fontWeight = '700';
    var fontStyle = cleanText(raw.fontStyle == null ? raw.font_style : raw.fontStyle, 10).toLowerCase();
    if (fontStyle !== 'italic') fontStyle = 'normal';
    var colorMode = cleanText(raw.colorMode == null ? raw.color_mode : raw.colorMode, 20).toLowerCase();
    if (colorMode !== 'original') colorMode = 'thread';

    var defaultHeight = layout === 'text_only' ? ARTWORK_HEIGHT : 1200;
    return {
      id: id,
      label: label,
      decorationUrl: decorationUrl,
      previewImageUrl: normalizeAssetUrl(raw.previewImageUrl == null ? raw.preview_image_url : raw.previewImageUrl),
      layout: layout,
      fontFamily: normalizeFontFamily(raw.fontFamily == null ? raw.font_family : raw.fontFamily),
      fontWeight: fontWeight,
      fontStyle: fontStyle,
      previewStyle: cleanText(raw.previewStyle, 30),
      decorationScale: clamp(raw.decorationScale == null ? raw.decoration_scale : raw.decorationScale, 0.1, 1, 0.42),
      colorMode: colorMode,
      artboardWidth: Math.round(clamp(
        raw.artboardWidth == null ? raw.artboard_width : raw.artboardWidth,
        MIN_ARTBOARD_SIZE, MAX_ARTBOARD_SIZE, ARTWORK_WIDTH
      )),
      artboardHeight: Math.round(clamp(
        raw.artboardHeight == null ? raw.artboard_height : raw.artboardHeight,
        MIN_ARTBOARD_SIZE, MAX_ARTBOARD_SIZE, defaultHeight
      )),
      sortOrder: Math.round(clamp(raw.sortOrder == null ? raw.sort_order : raw.sortOrder, -100000, 100000, 0))
    };
  }

  function normalizeEmbroideryTemplates(rawTemplates) {
    if (!Array.isArray(rawTemplates)) return [];
    var ids = new Set();
    return rawTemplates.reduce(function (templates, rawTemplate) {
      var template = normalizeEmbroideryTemplate(rawTemplate);
      if (!template || ids.has(template.id)) return templates;
      ids.add(template.id);
      templates.push(template);
      return templates;
    }, []);
  }

  function findById(items, id) {
    return items.find(function (item) { return item.id === id; }) || items[0];
  }

  function findExactById(items, id) {
    return items.find(function (item) { return item.id === id; }) || null;
  }

  function findThreadColor(value) {
    var normalized = String(value || '').toLowerCase();
    return EMBROIDERY_THREAD_COLORS.find(function (color) {
      return color.id === value || color.value.toLowerCase() === normalized;
    }) || EMBROIDERY_THREAD_COLORS[0];
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Desain Bordir tidak dapat diekspor. Silakan coba lagi.'));
      }, 'image/png');
    });
  }

  function loadDecorationImage(url) {
    if (DECORATION_CACHE.has(url)) return DECORATION_CACHE.get(url);
    var promise = new Promise(function (resolve, reject) {
      var image = new Image();
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.onload = function () {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error('File ornamen tidak memiliki ukuran gambar yang valid.'));
          return;
        }
        resolve(image);
      };
      image.onerror = function () {
        reject(new Error('File ornamen tidak dapat dimuat. Periksa file dan akses CDN Shopify.'));
      };
      image.src = url;
    });
    DECORATION_CACHE.set(url, promise);
    promise.catch(function () { DECORATION_CACHE.delete(url); });
    return promise;
  }

  function fitImage(image, maximumWidth, maximumHeight) {
    var width = image.naturalWidth || image.width || 1;
    var height = image.naturalHeight || image.height || 1;
    var scale = Math.min(maximumWidth / width, maximumHeight / height);
    return { width: Math.max(1, width * scale), height: Math.max(1, height * scale) };
  }

  function drawDecoration(context, image, bounds, template, color, mirrored) {
    var width = Math.max(1, Math.round(bounds.width));
    var height = Math.max(1, Math.round(bounds.height));
    var source = image;

    if (template.colorMode === 'thread') {
      var mask = document.createElement('canvas');
      mask.width = width;
      mask.height = height;
      var maskContext = mask.getContext('2d');
      maskContext.imageSmoothingEnabled = true;
      maskContext.imageSmoothingQuality = 'high';
      maskContext.drawImage(image, 0, 0, width, height);
      maskContext.globalCompositeOperation = 'source-in';
      maskContext.fillStyle = color;
      maskContext.fillRect(0, 0, width, height);
      maskContext.globalCompositeOperation = 'source-over';
      source = mask;
    }

    context.save();
    if (mirrored) {
      context.translate(bounds.x + bounds.width, bounds.y);
      context.scale(-1, 1);
      context.drawImage(source, 0, 0, bounds.width, bounds.height);
    } else {
      context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height);
    }
    context.restore();
  }

  function drawTextInBox(context, text, template, color, box) {
    if (!text) return;
    var fontSize = Math.max(18, Math.min(box.height * 0.72, box.width * 0.32));
    var minimumFontSize = Math.max(12, box.height * 0.2);
    var font = '';
    function applyFont() {
      font = template.fontStyle + ' ' + template.fontWeight + ' ' + Math.round(fontSize) + 'px ' + template.fontFamily;
      context.font = font;
    }
    applyFont();
    while (fontSize > minimumFontSize && context.measureText(text).width > box.width) {
      fontSize -= Math.max(1, fontSize * 0.025);
      applyFont();
    }

    context.save();
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.fillStyle = color;
    context.strokeStyle = color;
    context.lineWidth = Math.max(1, Math.min(box.width, box.height) / 160);
    context.strokeText(text, box.x + box.width / 2, box.y + box.height / 2);
    context.fillText(text, box.x + box.width / 2, box.y + box.height / 2);
    context.restore();
  }

  function drawTextOnly(context, text, template, color, width, height) {
    if (!text) return;
    var renderScale = Math.min(width / ARTWORK_WIDTH, height / ARTWORK_HEIGHT);
    var fontSize = 390 * renderScale;
    var minimumFontSize = 140 * renderScale;
    var font = template.fontStyle + ' ' + template.fontWeight + ' ' + Math.round(fontSize) + 'px ' + template.fontFamily;
    context.font = font;
    while (fontSize > minimumFontSize && context.measureText(text).width > width * 0.88) {
      fontSize -= 8 * renderScale;
      font = template.fontStyle + ' ' + template.fontWeight + ' ' + Math.round(fontSize) + 'px ' + template.fontFamily;
      context.font = font;
    }
    context.save();
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.fillStyle = color;
    context.strokeStyle = color;
    context.lineWidth = Math.max(1, 3 * renderScale);
    context.strokeText(text, width / 2, height / 2);
    context.fillText(text, width / 2, height / 2);
    context.restore();
  }

  function renderEmbroideryArtwork(canvas, text, template, color, decorationImage) {
    var context = canvas.getContext('2d');
    var width = canvas.width;
    var height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (template.layout !== 'text_only' && !decorationImage) return false;

    if (template.layout === 'text_only') {
      drawTextOnly(context, text, template, color, width, height);
      return true;
    }

    if (template.layout === 'sulur') {
      var sulurMaximumWidth = width * Math.min(0.3, Math.max(0.12, template.decorationScale * 0.5));
      var sulurSize = fitImage(decorationImage, sulurMaximumWidth, height * 0.72);
      var sulurY = (height - sulurSize.height) / 2;
      var sulurPadding = width * 0.045;
      var leftSulur = { x: sulurPadding, y: sulurY, width: sulurSize.width, height: sulurSize.height };
      var rightSulur = {
        x: width - sulurPadding - sulurSize.width, y: sulurY,
        width: sulurSize.width, height: sulurSize.height
      };
      drawDecoration(context, decorationImage, leftSulur, template, color, false);
      drawDecoration(context, decorationImage, rightSulur, template, color, true);
      var sulurTextStart = leftSulur.x + leftSulur.width + width * 0.035;
      var sulurTextEnd = rightSulur.x - width * 0.035;
      drawTextInBox(context, text, template, color, {
        x: sulurTextStart, y: height * 0.14,
        width: Math.max(width * 0.2, sulurTextEnd - sulurTextStart), height: height * 0.72
      });
      return true;
    }

    if (template.layout === 'leaf') {
      var leafMaximumWidth = width * Math.min(0.42, Math.max(0.12, template.decorationScale));
      var leafSize = fitImage(decorationImage, leafMaximumWidth, height * 0.76);
      var leafBounds = {
        x: width * 0.055, y: (height - leafSize.height) / 2,
        width: leafSize.width, height: leafSize.height
      };
      drawDecoration(context, decorationImage, leafBounds, template, color, false);
      var leafTextStart = leafBounds.x + leafBounds.width + width * 0.04;
      drawTextInBox(context, text, template, color, {
        x: leafTextStart, y: height * 0.12,
        width: Math.max(width * 0.25, width * 0.945 - leafTextStart), height: height * 0.76
      });
      return true;
    }

    var frameFactor = clamp(template.decorationScale * 2, 0.55, 1, 0.84);
    var frameSize = fitImage(decorationImage, width * 0.92 * frameFactor, height * 0.9 * frameFactor);
    var frameBounds = {
      x: (width - frameSize.width) / 2, y: (height - frameSize.height) / 2,
      width: frameSize.width, height: frameSize.height
    };
    drawDecoration(context, decorationImage, frameBounds, template, color, false);
    var innerWidthFactor = template.layout === 'circle' ? 0.58 : 0.76;
    var innerHeightFactor = template.layout === 'circle' ? 0.58 : 0.54;
    drawTextInBox(context, text, template, color, {
      x: frameBounds.x + frameBounds.width * (1 - innerWidthFactor) / 2,
      y: frameBounds.y + frameBounds.height * (1 - innerHeightFactor) / 2,
      width: frameBounds.width * innerWidthFactor,
      height: frameBounds.height * innerHeightFactor
    });
    return true;
  }

  function EmbroideryDesignBuilder(root, options) {
    if (!root) throw new Error('Embroidery builder markup is unavailable.');
    this.root = root;
    this.options = options || {};
    this.templates = normalizeEmbroideryTemplates(this.options.templates);
    if (!this.templates.length) this.templates = normalizeEmbroideryTemplates(EMBROIDERY_TEMPLATES);
    this.textInput = root.querySelector('[data-embroidery-text]');
    this.counter = root.querySelector('[data-embroidery-counter]');
    this.templatesRoot = root.querySelector('[data-embroidery-templates]');
    this.colorsRoot = root.querySelector('[data-embroidery-colors]');
    this.previewCanvas = root.querySelector('[data-embroidery-preview-canvas]');
    this.previewArtworkCanvas = document.createElement('canvas');
    this.mockupImage = root.querySelector('[data-embroidery-mockup-image]');
    this.mockupRoot = root.querySelector('[data-embroidery-mockup]');
    this.status = root.querySelector('[data-embroidery-status]');
    this.confirmButton = root.querySelector('[data-embroidery-confirm]');
    this.loadedDecorations = Object.create(null);
    this.assetLoading = false;
    this.assetError = '';
    this.assetRequest = 0;
    this.side = 'front';
    this.state = this.defaultState();
    this.renderChoices();
    this.bind();
  }

  EmbroideryDesignBuilder.prototype.defaultState = function () {
    return { text: '', templateId: this.templates[0].id, color: EMBROIDERY_THREAD_COLORS[0].value };
  };

  EmbroideryDesignBuilder.prototype.getTemplate = function () {
    return findById(this.templates, this.state.templateId);
  };

  EmbroideryDesignBuilder.prototype.bind = function () {
    var self = this;
    this.textInput.maxLength = EMBROIDERY_TEXT_MAX_LENGTH;
    this.textInput.addEventListener('input', function () {
      var limited = truncateEmbroideryText(self.textInput.value);
      if (self.textInput.value !== limited) {
        self.textInput.value = limited;
        self.setStatus('Teks Bordir maksimal 12 karakter, termasuk spasi.', true);
      } else {
        self.showAssetStatus();
      }
      self.state.text = limited;
      self.renderPreview();
    });
    this.templatesRoot.addEventListener('click', function (event) {
      var button = event.target.closest('[data-embroidery-template-id]');
      if (button) self.selectTemplate(button.dataset.embroideryTemplateId);
    });
    this.colorsRoot.addEventListener('click', function (event) {
      var button = event.target.closest('[data-embroidery-color]');
      if (!button) return;
      self.state.color = button.dataset.embroideryColor;
      self.syncChoiceState();
      self.renderPreview();
    });
    this.confirmButton.addEventListener('click', function () { self.confirm(); });
  };

  EmbroideryDesignBuilder.prototype.renderChoices = function () {
    this.templatesRoot.innerHTML = '';
    this.templates.forEach(function (template) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'embroidery-template-card';
      button.dataset.embroideryTemplateId = template.id;
      button.dataset.previewStyle = template.previewStyle;
      button.style.fontFamily = template.fontFamily;
      button.style.fontWeight = template.fontWeight;
      button.style.fontStyle = template.fontStyle;
      if (template.previewImageUrl) {
        button.classList.add('has-preview');
        var preview = document.createElement('img');
        preview.alt = '';
        preview.loading = 'lazy';
        preview.hidden = true;
        preview.onload = function () { preview.hidden = false; };
        preview.onerror = function () { preview.remove(); };
        preview.src = template.previewImageUrl;
        button.appendChild(preview);
      }
      var label = document.createElement('span');
      label.textContent = template.label;
      button.appendChild(label);
      this.templatesRoot.appendChild(button);
    }, this);

    this.colorsRoot.innerHTML = '';
    EMBROIDERY_THREAD_COLORS.forEach(function (color) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'embroidery-color-swatch';
      button.dataset.embroideryColor = color.value;
      button.setAttribute('aria-label', color.label);
      button.title = color.label;
      var swatch = document.createElement('span');
      swatch.style.backgroundColor = color.value;
      var label = document.createElement('small');
      label.textContent = color.label;
      button.appendChild(swatch);
      button.appendChild(label);
      this.colorsRoot.appendChild(button);
    }, this);
  };

  EmbroideryDesignBuilder.prototype.open = function (options) {
    options = options || {};
    this.side = options.side === 'back' ? 'back' : 'front';
    var saved = options.state || {};
    this.state = {
      text: truncateEmbroideryText(saved.text || ''),
      templateId: findById(this.templates, saved.templateId).id,
      color: findThreadColor(saved.colorId || saved.color).value
    };
    this.textInput.value = this.state.text;
    this.setMockup(options.mockupUrl || '');
    this.setStatus('');
    this.syncChoiceState();
    this.renderPreview();
    this.prepareSelectedTemplate();
    var self = this;
    window.requestAnimationFrame(function () { self.textInput.focus(); });
  };

  EmbroideryDesignBuilder.prototype.setMockup = function (url) {
    var self = this;
    this.mockupImage.onload = function () {
      if (self.mockupImage.naturalWidth && self.mockupImage.naturalHeight) {
        self.mockupRoot.style.aspectRatio = self.mockupImage.naturalWidth + ' / ' + self.mockupImage.naturalHeight;
        var previewWidth = Math.min(1600, self.mockupImage.naturalWidth);
        self.previewCanvas.width = previewWidth;
        self.previewCanvas.height = Math.max(1, Math.round(
          previewWidth * self.mockupImage.naturalHeight / self.mockupImage.naturalWidth
        ));
        self.renderPreview();
      }
    };
    if (url) this.mockupImage.src = url;
    else this.mockupImage.removeAttribute('src');
  };

  EmbroideryDesignBuilder.prototype.selectTemplate = function (templateId) {
    var template = findExactById(this.templates, templateId);
    if (!template) return;
    this.state.templateId = template.id;
    this.assetError = '';
    this.syncChoiceState();
    this.renderPreview();
    this.prepareSelectedTemplate();
  };

  EmbroideryDesignBuilder.prototype.prepareSelectedTemplate = function () {
    var self = this;
    var template = this.getTemplate();
    var request = ++this.assetRequest;
    if (template.layout === 'text_only') {
      this.assetLoading = false;
      this.assetError = '';
      this.updateConfirmState();
      this.showAssetStatus();
      this.renderPreview();
      return Promise.resolve(null);
    }
    if (this.loadedDecorations[template.decorationUrl]) {
      this.assetLoading = false;
      this.assetError = '';
      this.updateConfirmState();
      this.showAssetStatus();
      this.renderPreview();
      return Promise.resolve(this.loadedDecorations[template.decorationUrl]);
    }

    this.assetLoading = true;
    this.assetError = '';
    this.updateConfirmState();
    this.showAssetStatus();
    this.renderPreview();
    return loadDecorationImage(template.decorationUrl).then(function (image) {
      self.loadedDecorations[template.decorationUrl] = image;
      if (request !== self.assetRequest || self.state.templateId !== template.id) return image;
      self.assetLoading = false;
      self.assetError = '';
      self.updateConfirmState();
      self.showAssetStatus();
      self.renderPreview();
      return image;
    }).catch(function (error) {
      if (request !== self.assetRequest || self.state.templateId !== template.id) return null;
      self.assetLoading = false;
      self.assetError = error.message || 'Ornamen template tidak dapat dimuat.';
      self.updateConfirmState();
      self.showAssetStatus();
      self.renderPreview();
      return null;
    });
  };

  EmbroideryDesignBuilder.prototype.updateConfirmState = function () {
    this.confirmButton.disabled = this.assetLoading || Boolean(this.assetError);
    this.root.classList.toggle('is-loading-decoration', this.assetLoading);
    this.root.setAttribute('aria-busy', this.assetLoading ? 'true' : 'false');
  };

  EmbroideryDesignBuilder.prototype.showAssetStatus = function () {
    if (this.assetLoading) {
      this.setStatus('Memuat ornamen ' + this.getTemplate().label + '…');
    } else if (this.assetError) {
      this.setStatus(this.assetError + ' Pilih template lain atau coba pilih template ini kembali.', true);
    } else {
      this.setStatus('');
    }
  };

  EmbroideryDesignBuilder.prototype.syncChoiceState = function () {
    this.templatesRoot.querySelectorAll('[data-embroidery-template-id]').forEach(function (button) {
      button.setAttribute('aria-pressed', button.dataset.embroideryTemplateId === this.state.templateId ? 'true' : 'false');
    }, this);
    this.colorsRoot.querySelectorAll('[data-embroidery-color]').forEach(function (button) {
      var active = button.dataset.embroideryColor.toLowerCase() === this.state.color.toLowerCase();
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }, this);
  };

  EmbroideryDesignBuilder.prototype.renderPreview = function () {
    this.state.text = truncateEmbroideryText(this.state.text);
    this.counter.textContent = characterCount(this.state.text) + '/' + EMBROIDERY_TEXT_MAX_LENGTH;
    var context = this.previewCanvas.getContext('2d');
    context.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    var template = this.getTemplate();
    var decoration = template.decorationUrl ? this.loadedDecorations[template.decorationUrl] : null;
    if (template.layout !== 'text_only' && !decoration) return;

    var previewScale = Math.min(1, 1000 / template.artboardWidth, 650 / template.artboardHeight);
    this.previewArtworkCanvas.width = Math.max(1, Math.round(template.artboardWidth * previewScale));
    this.previewArtworkCanvas.height = Math.max(1, Math.round(template.artboardHeight * previewScale));
    renderEmbroideryArtwork(
      this.previewArtworkCanvas, this.state.text || 'Preview', template, this.state.color, decoration
    );

    var maximumWidth = this.previewCanvas.width * 0.62;
    var maximumHeight = this.previewCanvas.height * 0.36;
    var placementScale = Math.min(
      maximumWidth / this.previewArtworkCanvas.width,
      maximumHeight / this.previewArtworkCanvas.height
    );
    var placementWidth = this.previewArtworkCanvas.width * placementScale;
    var placementHeight = this.previewArtworkCanvas.height * placementScale;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      this.previewArtworkCanvas,
      (this.previewCanvas.width - placementWidth) / 2,
      this.previewCanvas.height * 0.43 - placementHeight / 2,
      placementWidth,
      placementHeight
    );
  };

  EmbroideryDesignBuilder.prototype.validate = function () {
    var limited = truncateEmbroideryText(this.textInput.value);
    this.textInput.value = limited;
    this.state.text = limited;
    this.renderPreview();
    if (!limited.trim()) return 'Masukkan teks Bordir sebelum melanjutkan.';
    if (characterCount(limited) > EMBROIDERY_TEXT_MAX_LENGTH) {
      return 'Teks Bordir maksimal 12 karakter, termasuk spasi.';
    }
    var template = findExactById(this.templates, this.state.templateId);
    if (!template) return 'Pilih template Bordir.';
    if (!findThreadColor(this.state.color)) return 'Pilih warna benang.';
    if (this.assetLoading) return 'Tunggu hingga ornamen selesai dimuat.';
    if (this.assetError) return this.assetError;
    if (template.layout !== 'text_only' && !this.loadedDecorations[template.decorationUrl]) {
      return 'Ornamen template belum siap. Pilih template kembali untuk mencoba lagi.';
    }
    return '';
  };

  EmbroideryDesignBuilder.prototype.buildArtworkBlob = async function () {
    var canvas = document.createElement('canvas');
    var template = this.getTemplate();
    var decoration = template.decorationUrl ? this.loadedDecorations[template.decorationUrl] : null;
    if (template.layout !== 'text_only' && !decoration) {
      throw new Error('Ornamen template belum selesai dimuat. PNG Bordir tidak dibuat.');
    }
    canvas.width = template.artboardWidth;
    canvas.height = template.artboardHeight;
    if (!renderEmbroideryArtwork(canvas, this.state.text, template, this.state.color, decoration)) {
      throw new Error('Desain Bordir tidak dapat dirender dengan lengkap.');
    }
    return canvasToBlob(canvas);
  };

  EmbroideryDesignBuilder.prototype.confirm = async function () {
    var error = this.validate();
    if (error) {
      this.setStatus(error, true);
      this.textInput.focus();
      return;
    }
    this.confirmButton.disabled = true;
    this.setStatus('Menyiapkan PNG Bordir transparan…');
    try {
      var template = this.getTemplate();
      var color = findThreadColor(this.state.color);
      var result = {
        side: this.side,
        text: this.state.text,
        templateId: template.id,
        templateLabel: template.label,
        color: color.value,
        colorId: color.id,
        colorLabel: color.label,
        blob: await this.buildArtworkBlob()
      };
      if (typeof this.options.onConfirm === 'function') await this.options.onConfirm(result);
      this.setStatus('');
    } catch (buildError) {
      this.setStatus(buildError.message || 'Desain Bordir tidak dapat disiapkan.', true);
    } finally {
      this.updateConfirmState();
    }
  };

  EmbroideryDesignBuilder.prototype.setStatus = function (message, isError) {
    this.status.textContent = message || '';
    this.status.classList.toggle('is-error', Boolean(isError));
  };

  NS.EMBROIDERY_TEXT_MAX_LENGTH = EMBROIDERY_TEXT_MAX_LENGTH;
  NS.EMBROIDERY_TEMPLATES = EMBROIDERY_TEMPLATES;
  NS.EMBROIDERY_THREAD_COLORS = EMBROIDERY_THREAD_COLORS;
  NS.normalizeEmbroideryTemplates = normalizeEmbroideryTemplates;
  NS.renderEmbroideryArtwork = renderEmbroideryArtwork;
  NS.loadEmbroideryDecoration = loadDecorationImage;
  NS.truncateEmbroideryText = truncateEmbroideryText;
  NS.EmbroideryDesignBuilder = EmbroideryDesignBuilder;
})();
