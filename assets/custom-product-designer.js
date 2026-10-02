(function () {
  'use strict';

  window.ShopifyCustomProduct = window.ShopifyCustomProduct || {};
  var NS = window.ShopifyCustomProduct;

  var FABRIC_URL = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js';
  var LOGICAL_CANVAS_WIDTH = 1000;
  var PREVIEW_MAX_WIDTH = 1600;
  var PRINT_DPI = 300;
  var MAX_EXPORT_DIMENSION = 5000;
  var SCREEN_PRINT_TEXT_MAX_LENGTH = 120;
  var EMBROIDERY_TEXT_MAX_LENGTH = NS.EMBROIDERY_TEXT_MAX_LENGTH || 12;

  function truncateText(value, maxLength) {
    return String(value == null ? '' : value).slice(0, maxLength);
  }

  function ensureFabric() {
    if (window.fabric && window.fabric.Canvas) return Promise.resolve(window.fabric);
    if (window.__customizerFabricPromise) return window.__customizerFabricPromise;

    window.__customizerFabricPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = FABRIC_URL;
      script.async = true;
      script.onload = function () {
        if (window.fabric && window.fabric.Canvas) resolve(window.fabric);
        else reject(new Error('Fabric.js loaded but window.fabric is unavailable.'));
      };
      script.onerror = function () { reject(new Error('Unable to load Fabric.js.')); };
      document.head.appendChild(script);
    });

    return window.__customizerFabricPromise;
  }

  function parseJsonScript(id) {
    var node = document.getElementById(id);
    if (!node) throw new Error('Missing JSON script: ' + id);
    return JSON.parse(node.textContent || '{}');
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    throw new Error('This browser cannot securely create a design ID. Please update your browser.');
  }

  function safeFilePart(value) {
    return String(value == null ? 'area' : value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'area';
  }

  function toFile(blob, filename) {
    return new File([blob], filename, { type: blob.type || 'image/png' });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
    var binary = atob(parts[1]);
    var array = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) array[i] = binary.charCodeAt(i);
    return new Blob([array], { type: mime });
  }

  function blobUrl(blob) {
    return URL.createObjectURL(blob);
  }

  function showClientWatermark(image) {
    if (window.CustomDesignStorage && typeof window.CustomDesignStorage.applyWatermark === 'function') {
      window.CustomDesignStorage.applyWatermark(image);
    }
  }

  function loadNativeImage(src) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      var timeout = window.setTimeout(function () {
        image.onload = null;
        image.onerror = null;
        image.src = '';
        reject(new Error('The product mockup took too long to load. Please try again.'));
      }, 20000);
      image.crossOrigin = 'anonymous';
      image.onload = function () {
        window.clearTimeout(timeout);
        resolve(image);
      };
      image.onerror = function () {
        window.clearTimeout(timeout);
        reject(new Error('Unable to load the product mockup. Please try again.'));
      };
      image.src = src;
    });
  }

  function formatCurrency(value, currency) {
    var locale = document.documentElement.lang || 'id-ID';
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency || 'IDR',
        maximumFractionDigits: ['IDR', 'JPY', 'KRW'].indexOf(currency) >= 0 ? 0 : 2
      }).format(Number(value || 0));
    } catch (error) {
      return String(value || 0);
    }
  }

  function normalizeConfig(config) {
    config = config || {};
    if (config.surfaceMode === 'wrap' && (!config.front || !Array.isArray(config.front.zones))) {
      var wrap = config.wrap || {};
      config.front = {
        zones: [{
          id: 'wrap',
          label: 'Wrap',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          printWidthMm: wrap.printWidthMm,
          printHeightMm: wrap.printHeightMm,
          price: wrap.price || 0,
          feeVariantId: wrap.feeVariantId
        }]
      };
      config.back = { enabled: false };
    }
    if (!config.front) config.front = { zones: [] };
    if (!Array.isArray(config.front.zones)) config.front.zones = [];
    if (!config.back) config.back = { enabled: false };
    return config;
  }

  function getProductForm(button) {
    var explicitId = button && button.dataset.productFormId;
    if (explicitId) {
      var byId = document.getElementById(explicitId);
      if (byId) return byId;
    }
    var productSection = button ? button.closest('.shopify-section, product-info, section') : null;
    if (productSection) {
      var localForm = productSection.querySelector('form[action*="/cart/add"]');
      if (localForm) return localForm;
    }
    return document.querySelector('form[action*="/cart/add"]');
  }

  function readSelectedVariantId(button) {
    var form = getProductForm(button);
    if (form) {
      var input = form.querySelector('[name="id"]');
      if (input && input.value) return String(input.value);
    }
    var fromUrl = new URL(window.location.href).searchParams.get('variant');
    return fromUrl ? String(fromUrl) : null;
  }

  function readQuantity(button) {
    var form = getProductForm(button);
    if (!form) return 1;
    var input = form.querySelector('[name="quantity"]');
    var qty = input ? parseInt(input.value, 10) : 1;
    return Number.isFinite(qty) && qty > 0 ? qty : 1;
  }

  function ProductConfigLoader(root) {
    this.root = root;
    this.config = normalizeConfig(parseJsonScript(root.dataset.configScript));
    this.product = parseJsonScript(root.dataset.productScript);
  }

  ProductConfigLoader.prototype.getVariant = function (variantId) {
    return this.product.variants[String(variantId)] || null;
  };

  function VariantMockupManager(loader) {
    this.loader = loader;
  }

  VariantMockupManager.prototype.get = function (variantId, side) {
    var variant = this.loader.getVariant(variantId);
    if (!variant) return null;
    if (side === 'back') return variant.back || null;
    if (side === 'wrap') return variant.wrap || variant.front || this.loader.product.featuredImage || null;
    return variant.front || this.loader.product.featuredImage || null;
  };

  function PriceCalculator(loader) {
    this.loader = loader;
  }

  PriceCalculator.prototype.summary = function (variantId, zones, backZones, hasBack) {
    var variant = this.loader.getVariant(variantId);
    var base = variant ? Number(variant.priceMajor || 0) : 0;
    var front = (zones || []).reduce(function (total, zone) {
      return total + Number(zone.price || 0);
    }, 0);
    var back = hasBack ? (backZones || []).reduce(function (total, zone) {
      return total + Number(zone.price || 0);
    }, 0) : 0;
    return { base: base, front: front, back: back, total: base + front + back };
  };

  function PrintZoneManager() {}

  PrintZoneManager.prototype.toRect = function (zone, canvasWidth, canvasHeight) {
    return {
      left: Number(zone.x || 0) * canvasWidth,
      top: Number(zone.y || 0) * canvasHeight,
      width: Number(zone.width || 0) * canvasWidth,
      height: Number(zone.height || 0) * canvasHeight
    };
  };

  function CanvasEditor(canvasEl, frameCropper, textMaxLength) {
    this.canvasEl = canvasEl;
    this.frameCropper = frameCropper;
    this.canvas = null;
    this.mockup = null;
    this.zones = [];
    this.zoneRects = {};
    this.zoneBoundaries = {};
    this.zoneLabels = {};
    this.activeZoneId = null;
    this.side = 'front';
    this.mockupUrl = null;
    this.textChangeHandler = null;
    this.textMaxLength = Number(textMaxLength) || SCREEN_PRINT_TEXT_MAX_LENGTH;
    this.zoneManager = new PrintZoneManager();
    this.onZoneChange = null;
    this.onArtworkChange = null;
  }

  CanvasEditor.prototype.init = async function () {
    await ensureFabric();
    if (this.canvas) return;
    this.canvas = new fabric.Canvas(this.canvasEl, {
      preserveObjectStacking: true,
      controlsAboveOverlay: true,
      selection: false,
      selectionKey: null
    });
    this.bindConstraints();
  };

  CanvasEditor.prototype.dispose = function () {
    if (this.canvas) {
      this.canvas.dispose();
      this.canvas = null;
    }
  };

  CanvasEditor.prototype.bindConstraints = function () {
    var self = this;
    function enforce(event) {
      if (!event || !event.target) return;
      if (event.target._customizerRole) return;
      self.applyZoneClip(event.target);
    }

    this.canvas.on('object:moving', enforce);
    this.canvas.on('object:scaling', enforce);
    this.canvas.on('object:rotating', enforce);
    this.canvas.on('object:modified', enforce);
    this.canvas.on('text:changed', function (event) {
      var text = event && event.target;
      if (!text) return;
      var limitedValue = truncateText(text.text, self.textMaxLength);
      if (text.text !== limitedValue) text.set({ text: limitedValue });
      enforce(event);
    });
    this.canvas.on('selection:created', function (event) { self.activateObjectZone(event.selected && event.selected[0]); });
    this.canvas.on('selection:updated', function (event) { self.activateObjectZone(event.selected && event.selected[0]); });
    this.canvas.on('mouse:down', function (event) {
      if (event.target && !event.target._customizerRole) {
        self.activateObjectZone(event.target);
        return;
      }
      var pointer = self.canvas.getPointer(event.e);
      var matching = self.zones.filter(function (zone) {
        var rect = self.zoneRects[String(zone.id)];
        return rect && pointer.x >= rect.left && pointer.x <= rect.left + rect.width &&
          pointer.y >= rect.top && pointer.y <= rect.top + rect.height;
      });
      if (matching.length) self.setActiveZone(matching[matching.length - 1].id);
    });
  };

  CanvasEditor.prototype.keepInsideZone = function (object) {
    if (!object) return;
    var zone = this.zoneRects[String(object._zoneId || this.activeZoneId)];
    if (!zone) return;
    this.applyZoneClip(object);
    if (this.canvas) this.canvas.requestRenderAll();
  };

  CanvasEditor.prototype.applyZoneClip = function (object) {
    if (!object || object._customizerRole) return;
    var zone = this.zoneRects[String(object._zoneId || this.activeZoneId)];
    if (!zone) return;
    object.clipPath = new fabric.Rect({
      left: zone.left,
      top: zone.top,
      width: zone.width,
      height: zone.height,
      originX: 'left',
      originY: 'top',
      absolutePositioned: true
    });
    object.dirty = true;
    object.setCoords();
  };

  CanvasEditor.prototype.loadSurface = async function (options) {
    options = options || {};
    await this.init();
    this.side = options.side || 'front';
    var zones = options.zones || (options.zone ? [options.zone] : []);
    this.mockupUrl = options.mockupUrl;

    if (!zones.length) throw new Error('No print zone is configured for this surface.');
    if (!this.mockupUrl) throw new Error('No Shopify mockup image is configured for this surface/variant.');

    this.canvas.clear();
    this.mockup = null;
    this.zones = [];
    this.zoneRects = {};
    this.zoneBoundaries = {};
    this.zoneLabels = {};
    this.activeZoneId = null;

    var nativeImage = await loadNativeImage(this.mockupUrl);
    var logicalWidth = LOGICAL_CANVAS_WIDTH;
    var logicalHeight = Math.max(400, Math.round(logicalWidth * nativeImage.naturalHeight / nativeImage.naturalWidth));
    this.canvas.setWidth(logicalWidth);
    this.canvas.setHeight(logicalHeight);

    // Fabric gives its wrapper a fixed logical height. When the wrapper width
    // shrinks to fit the editor column, keep that height in the same ratio so
    // the full canvas participates in the modal's scroll area instead of being
    // clipped at the old viewport-height cap.
    var canvasWrap = this.canvasEl.closest('.customizer-canvas-wrap');
    if (canvasWrap) {
      canvasWrap.style.setProperty('--customizer-canvas-aspect-ratio', logicalWidth + ' / ' + logicalHeight);
    }

    var self = this;
    var mockup = await new Promise(function (resolve, reject) {
      var timeout = window.setTimeout(function () {
        reject(new Error('The mockup editor took too long to prepare. Please try again.'));
      }, 20000);
      fabric.Image.fromURL(self.mockupUrl, function (img) {
        window.clearTimeout(timeout);
        if (!img) return reject(new Error('The mockup editor could not prepare this image. Please try again.'));
        resolve(img);
      }, { crossOrigin: 'anonymous' });
    });

    mockup.set({
      left: 0,
      top: 0,
      selectable: false,
      evented: false,
      hoverCursor: 'default',
      _customizerRole: 'mockup'
    });
    mockup.scaleX = logicalWidth / mockup.width;
    mockup.scaleY = logicalHeight / mockup.height;

    this.mockup = mockup;
    this.canvas.add(mockup);
    this.canvas.sendToBack(mockup);

    this.setZones(zones);
  };

  CanvasEditor.prototype.setZones = function (zones) {
    if (!this.canvas) return;
    zones = (zones || []).slice();
    var allowed = new Set(zones.map(function (zone) { return String(zone.id); }));
    var previousActive = this.activeZoneId;

    Object.keys(this.zoneBoundaries).forEach(function (id) {
      this.canvas.remove(this.zoneBoundaries[id]);
    }, this);
    Object.keys(this.zoneLabels).forEach(function (id) {
      this.canvas.remove(this.zoneLabels[id]);
    }, this);

    this.canvas.getObjects().slice().forEach(function (object) {
      if (!object._customizerRole && object._zoneId != null && !allowed.has(String(object._zoneId))) {
        this.canvas.remove(object);
      }
    }, this);

    this.zones = zones;
    this.zoneRects = {};
    this.zoneBoundaries = {};
    this.zoneLabels = {};

    zones.forEach(function (zone) {
      var id = String(zone.id);
      var rect = this.zoneManager.toRect(zone, this.canvas.getWidth(), this.canvas.getHeight());
      var boundary = new fabric.Rect({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        fill: 'rgba(255,255,255,0.035)',
        stroke: '#a55c7c',
        strokeWidth: 2,
        strokeDashArray: [10, 8],
        selectable: false,
        evented: false,
        excludeFromExport: true,
        _customizerRole: 'zone-boundary',
        _zoneId: id
      });
      var label = new fabric.Text(zone.label || id, {
        left: rect.left + 8,
        top: Math.max(2, rect.top + 6),
        fontFamily: 'Arial, sans-serif',
        fontSize: 16,
        fontWeight: '700',
        fill: '#693b50',
        backgroundColor: 'rgba(255,255,255,0.9)',
        selectable: false,
        evented: false,
        excludeFromExport: true,
        _customizerRole: 'zone-label',
        _zoneId: id
      });
      this.zoneRects[id] = rect;
      this.zoneBoundaries[id] = boundary;
      this.zoneLabels[id] = label;
      this.canvas.add(boundary);
      this.canvas.add(label);
    }, this);

    this.activeZoneId = allowed.has(String(previousActive)) ? String(previousActive) : (zones[0] ? String(zones[0].id) : null);
    this.canvas.getObjects().forEach(function (object) {
      if (!object._customizerRole) this.applyZoneClip(object);
    }, this);
    this.refreshBoundaryStyles();
    this.bringGuidesToFront();
    this.notifyArtworkChange();
  };

  CanvasEditor.prototype.bringGuidesToFront = function () {
    Object.keys(this.zoneBoundaries).forEach(function (id) { this.canvas.bringToFront(this.zoneBoundaries[id]); }, this);
    Object.keys(this.zoneLabels).forEach(function (id) { this.canvas.bringToFront(this.zoneLabels[id]); }, this);
  };

  CanvasEditor.prototype.refreshBoundaryStyles = function () {
    Object.keys(this.zoneBoundaries).forEach(function (id) {
      var active = id === String(this.activeZoneId);
      this.zoneBoundaries[id].set({
        fill: active ? 'rgba(165,92,124,0.10)' : 'rgba(255,255,255,0.035)',
        stroke: active ? '#6d3550' : '#a55c7c',
        strokeWidth: active ? 4 : 2
      });
      this.zoneLabels[id].set({
        fill: active ? '#4f2137' : '#8a5970',
        backgroundColor: active ? 'rgba(242,231,236,0.96)' : 'rgba(255,255,255,0.9)'
      });
    }, this);
    if (this.canvas) this.canvas.requestRenderAll();
  };

  CanvasEditor.prototype.setActiveZone = function (zoneId) {
    zoneId = String(zoneId);
    if (!this.zoneRects[zoneId]) return false;
    this.activeZoneId = zoneId;
    this.refreshBoundaryStyles();
    if (typeof this.onZoneChange === 'function') this.onZoneChange(zoneId);
    return true;
  };

  CanvasEditor.prototype.activateObjectZone = function (object) {
    if (object && object._zoneId != null) this.setActiveZone(object._zoneId);
  };

  CanvasEditor.prototype.getActiveZone = function () {
    var activeId = String(this.activeZoneId);
    return this.zones.find(function (zone) { return String(zone.id) === activeId; }) || null;
  };

  CanvasEditor.prototype.notifyArtworkChange = function () {
    if (typeof this.onArtworkChange === 'function') this.onArtworkChange();
  };

  CanvasEditor.prototype.centerObjectInZone = function (object, desiredScale) {
    var zone = this.zoneRects[String(this.activeZoneId)];
    if (!zone) return;
    if (desiredScale) object.scale(desiredScale);

    object.setCoords();
    var bounds = object.getBoundingRect(true, true);
    var fitScale = Math.min((zone.width * 0.72) / bounds.width, (zone.height * 0.72) / bounds.height, 1);
    if (Number.isFinite(fitScale) && fitScale < 1) {
      object.scaleX *= fitScale;
      object.scaleY *= fitScale;
    }
    object.setCoords();
    bounds = object.getBoundingRect(true, true);
    object.set({
      left: zone.left + (zone.width - bounds.width) / 2 - (bounds.left - object.left),
      top: zone.top + (zone.height - bounds.height) / 2 - (bounds.top - object.top)
    });
    object.setCoords();
  };

  CanvasEditor.prototype.addBlobImage = async function (blob, role, customMeta) {
  if (!this.activeZoneId) throw new Error('Choose a print area before adding artwork.');
  var url = blobUrl(blob);
  var image;

  try {
    image = await new Promise(function (resolve, reject) {
      fabric.Image.fromURL(
        url,
        function (img) {
          if (!img) {
            reject(
              new Error('Unable to add image to the design.')
            );
            return;
          }

          resolve(img);
        },
        {
          crossOrigin: 'anonymous'
        }
      );
    });

  } finally {
    URL.revokeObjectURL(url);
  }

  image.set({
    transparentCorners: false,
    cornerStyle: 'circle',

    borderColor: '#6d3550',
    cornerColor: '#fff',
    cornerStrokeColor: '#6d3550',

    _customizerObjectType: role || 'image',
    _zoneId: String(this.activeZoneId)
  });

  if (customMeta && role === 'frame') image._frameMeta = customMeta;
  if (customMeta && role === 'embroidery') image._embroideryMeta = customMeta;

  this.centerObjectInZone(image);
  this.applyZoneClip(image);

  this.canvas.add(image);

  this.bringGuidesToFront();

  this.canvas.setActiveObject(image);
  this.canvas.requestRenderAll();
  this.notifyArtworkChange();

  return image;
};

  CanvasEditor.prototype.addUploadedFile = async function (file) {
    return this.addBlobImage(file, 'upload');
  };

  CanvasEditor.prototype.addSticker = async function (url) {
    var response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to load this sticker.');
    return this.addBlobImage(await response.blob(), 'sticker');
  };

  CanvasEditor.prototype.addCharacter = async function (blob) {
    return this.addBlobImage(blob, 'character');
  };

  CanvasEditor.prototype.getEmbroideryObject = function () {
    if (!this.canvas) return null;
    return this.canvas.getObjects().find(function (object) {
      return object._customizerObjectType === 'embroidery';
    }) || null;
  };

  CanvasEditor.prototype.captureEmbroideryTransform = function () {
    var object = this.getEmbroideryObject();
    if (!object) return null;
    var center = object.getCenterPoint();
    return {
      zoneId: String(object._zoneId),
      left: object.left,
      top: object.top,
      centerX: center.x,
      centerY: center.y,
      angle: object.angle || 0,
      scaleX: object.scaleX,
      scaleY: object.scaleY,
      displayedWidth: object.getScaledWidth(),
      displayedHeight: object.getScaledHeight()
    };
  };

  CanvasEditor.prototype.replaceEmbroidery = async function (blob, meta, transform) {
    if (!this.canvas) throw new Error('Editor Bordir belum siap.');
    this.canvas.getObjects().slice().forEach(function (object) {
      if (object._customizerObjectType === 'embroidery') this.canvas.remove(object);
    }, this);

    if (transform && transform.zoneId && this.zoneRects[String(transform.zoneId)]) {
      this.setActiveZone(transform.zoneId);
    }
    var image = await this.addBlobImage(blob, 'embroidery', meta);
    if (transform && String(transform.zoneId) === String(image._zoneId)) {
      var proportionalScale = Math.min(
        Number(transform.displayedWidth) / image.width,
        Number(transform.displayedHeight) / image.height
      );
      var preserveProportions = Number.isFinite(proportionalScale) && proportionalScale > 0;
      image.set({
        left: Number.isFinite(transform.centerX) ? transform.centerX : transform.left,
        top: Number.isFinite(transform.centerY) ? transform.centerY : transform.top,
        originX: Number.isFinite(transform.centerX) ? 'center' : image.originX,
        originY: Number.isFinite(transform.centerY) ? 'center' : image.originY,
        angle: transform.angle,
        scaleX: preserveProportions ? proportionalScale : transform.scaleX,
        scaleY: preserveProportions ? proportionalScale : transform.scaleY
      });
      image.setCoords();
      this.keepInsideZone(image);
      this.bringGuidesToFront();
      this.canvas.setActiveObject(image);
      this.canvas.requestRenderAll();
      this.notifyArtworkChange();
    }
    return image;
  };

  CanvasEditor.prototype.addZoneArtwork = async function (blob, zoneId, role) {
    if (!this.setActiveZone(zoneId)) throw new Error('The matching print area is unavailable.');
    var image = await this.addBlobImage(blob, role || 'flattened-zone');
    var zone = this.zoneRects[String(zoneId)];
    image.set({
      left: zone.left,
      top: zone.top,
      originX: 'left',
      originY: 'top',
      angle: 0,
      scaleX: zone.width / image.width,
      scaleY: zone.height / image.height
    });
    image.setCoords();
    this.keepInsideZone(image);
    this.bringGuidesToFront();
    this.canvas.requestRenderAll();
    this.notifyArtworkChange();
    return image;
  };

  CanvasEditor.prototype.addText = function (text) {
  var zone = this.zoneRects[String(this.activeZoneId)];
  if (!zone) throw new Error('Choose a print area before adding text.');

  var object = new fabric.IText(truncateText(text || 'Your text', this.textMaxLength), {
    left: zone.left + zone.width / 2,
    top: zone.top + zone.height / 2,

    originX: 'center',
    originY: 'center',

    fontFamily: 'Arial',
    fontSize: Math.max(
      24,
      Math.min(54, zone.width / 6)
    ),

    fill: '#3b2a23',
    textAlign: 'center',

    editable: false,

    transparentCorners: false,
    cornerStyle: 'circle',

    borderColor: '#6d3550',
    cornerColor: '#fff',
    cornerStrokeColor: '#6d3550',

    _customizerObjectType: 'text',
    _zoneId: String(this.activeZoneId)
  });

  this.canvas.add(object);

  this.canvas.setActiveObject(object);

  this.bringGuidesToFront();

  object.setCoords();

  this.canvas.requestRenderAll();
  this.notifyArtworkChange();

  return object;
};

  CanvasEditor.prototype.addFrame = async function (shape, file) {
    var result = await this.frameCropper.open({ shape: shape, file: file });
    return this.addBlobImage(result.blob, 'frame', result.meta);
  };

  CanvasEditor.prototype.editActiveFrame = async function () {
    var active = this.canvas.getActiveObject();
    if (!active || active._customizerObjectType !== 'frame' || !active._frameMeta) {
      throw new Error('Select a frame first.');
    }

    var result = await this.frameCropper.open({
      shape: active._frameMeta.shape,
      meta: active._frameMeta
    });

    var displayedWidth = active.getScaledWidth();
    var displayedHeight = active.getScaledHeight();
    var originalLeft = active.left;
    var originalTop = active.top;
    var originalAngle = active.angle;
    var url = blobUrl(result.blob);
    var replacementElement = await loadNativeImage(url);
    URL.revokeObjectURL(url);
    active.setElement(replacementElement);
    active.set({
      left: originalLeft,
      top: originalTop,
      angle: originalAngle,
      scaleX: displayedWidth / replacementElement.naturalWidth,
      scaleY: displayedHeight / replacementElement.naturalHeight
    });
    active._frameMeta = result.meta;
    active.dirty = true;
    active.setCoords();
    this.keepInsideZone(active);
    this.canvas.requestRenderAll();
    this.notifyArtworkChange();
  };

  CanvasEditor.prototype.getFlippableActiveObject = function () {
    if (!this.canvas) return null;
    var active = this.canvas.getActiveObject();
    if (!active) return null;
    return ['character', 'upload', 'sticker'].indexOf(active._customizerObjectType) >= 0 ? active : null;
  };

  CanvasEditor.prototype.flipActiveHorizontal = function () {
    var active = this.getFlippableActiveObject();
    if (!active) return false;

    active.set({ flipX: !active.flipX });
    active.setCoords();
    this.keepInsideZone(active);
    this.canvas.requestRenderAll();
    this.notifyArtworkChange();
    return true;
  };

  CanvasEditor.prototype.deleteActive = function () {
    var active = this.canvas.getActiveObjects();
    if (!active.length) return;
    var self = this;
    active.forEach(function (object) { self.canvas.remove(object); });
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    this.notifyArtworkChange();
  };

  CanvasEditor.prototype.getActiveText = function () {
    var active = this.canvas.getActiveObject();
    return active && (active.type === 'i-text' || active.type === 'text') ? active : null;
  };

  CanvasEditor.prototype.getDesignObjects = function () {
    if (!this.canvas) return [];
    return this.canvas.getObjects().filter(function (object) { return !object._customizerRole; });
  };

  CanvasEditor.prototype.hasArtwork = function (zoneId) {
    return this.canvas && this.canvas.getObjects().some(function (object) {
      if (object._customizerRole) return false;
      return zoneId == null || String(object._zoneId) === String(zoneId);
    });
  };

  CanvasEditor.prototype.getEmptyZones = function () {
    return this.zones.filter(function (zone) { return !this.hasArtwork(zone.id); }, this);
  };

  CanvasEditor.prototype.exportArtwork = function (zoneId, filename) {
    var id = String(zoneId);
    var zone = this.zoneRects[id];
    var zoneConfig = this.zones.find(function (candidate) { return String(candidate.id) === id; });
    if (!zone || !zoneConfig) throw new Error('No selected print zone.');
    var visibility = this.canvas.getObjects().map(function (object) {
      var visible = object.visible;
      if (object._customizerRole || String(object._zoneId) !== id) object.visible = false;
      return { object: object, visible: visible };
    });
    var dataUrl;
    try {
      this.canvas.discardActiveObject();
      this.canvas.requestRenderAll();

      var targetWidth = zone.width;
      var targetHeight = zone.height;
      if (Number(zoneConfig.printWidthMm) > 0) targetWidth = Number(zoneConfig.printWidthMm) / 25.4 * PRINT_DPI;
      if (Number(zoneConfig.printHeightMm) > 0) targetHeight = Number(zoneConfig.printHeightMm) / 25.4 * PRINT_DPI;

      var multiplier = Math.max(1, Math.min(targetWidth / zone.width, targetHeight / zone.height));
      var maxByWidth = MAX_EXPORT_DIMENSION / zone.width;
      var maxByHeight = MAX_EXPORT_DIMENSION / zone.height;
      multiplier = Math.min(multiplier, maxByWidth, maxByHeight);

      dataUrl = this.canvas.toDataURL({
        format: 'png',
        left: zone.left,
        top: zone.top,
        width: zone.width,
        height: zone.height,
        multiplier: multiplier,
        enableRetinaScaling: false
      });
    } finally {
      visibility.forEach(function (entry) { entry.object.visible = entry.visible; });
      this.canvas.requestRenderAll();
    }
    return toFile(dataUrlToBlob(dataUrl), filename || 'design.png');
  };

  CanvasEditor.prototype.exportCompositeArtwork = function (filename) {
    if (!this.zones.length) throw new Error('No selected print zones.');
    var rects = this.zones.map(function (zone) { return this.zoneRects[String(zone.id)]; }, this);
    var left = Math.min.apply(Math, rects.map(function (rect) { return rect.left; }));
    var top = Math.min.apply(Math, rects.map(function (rect) { return rect.top; }));
    var right = Math.max.apply(Math, rects.map(function (rect) { return rect.left + rect.width; }));
    var bottom = Math.max.apply(Math, rects.map(function (rect) { return rect.top + rect.height; }));
    var visibility = this.canvas.getObjects().map(function (object) {
      var visible = object.visible;
      if (object._customizerRole) object.visible = false;
      return { object: object, visible: visible };
    });
    var dataUrl;
    try {
      this.canvas.discardActiveObject();
      this.canvas.requestRenderAll();
      var multiplier = Math.max(1, Math.min(2, MAX_EXPORT_DIMENSION / Math.max(right - left, bottom - top)));
      dataUrl = this.canvas.toDataURL({
        format: 'png', left: left, top: top, width: right - left, height: bottom - top,
        multiplier: multiplier, enableRetinaScaling: false
      });
    } finally {
      visibility.forEach(function (entry) { entry.object.visible = entry.visible; });
      this.canvas.requestRenderAll();
    }
    return toFile(dataUrlToBlob(dataUrl), filename || 'front-composite.png');
  };

  CanvasEditor.prototype.exportPreview = function (filename) {
    var guideVisibility = this.canvas.getObjects().filter(function (object) {
      return object._customizerRole === 'zone-boundary' || object._customizerRole === 'zone-label';
    }).map(function (object) {
      var visible = object.visible;
      object.visible = false;
      return { object: object, visible: visible };
    });
    var dataUrl;
    try {
      this.canvas.discardActiveObject();
      this.canvas.requestRenderAll();

      var multiplier = Math.max(1, Math.min(2, PREVIEW_MAX_WIDTH / this.canvas.getWidth()));
      dataUrl = this.canvas.toDataURL({
        format: 'png',
        multiplier: multiplier,
        enableRetinaScaling: false
      });
    } finally {
      guideVisibility.forEach(function (entry) { entry.object.visible = entry.visible; });
      this.canvas.requestRenderAll();
    }
    return toFile(dataUrlToBlob(dataUrl), filename || 'preview.png');
  };

  function ShopifyCartService() {}

  ShopifyCartService.prototype.root = function () {
    return (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';
  };

  ShopifyCartService.prototype.addDesignBundle = async function (payload) {
    var frontZones = payload.frontZones || [];
    var backZones = payload.backZones || [];
    if (!frontZones.length) throw new Error('Select at least one front print area.');
    var invalidFrontZone = frontZones.find(function (zone) {
      return !zone.feeVariantId || !payload.frontArtworks || !payload.frontArtworks[String(zone.id)];
    });
    if (invalidFrontZone) throw new Error('Every selected front print area needs artwork and a fee variant.');
    var invalidBackZone = backZones.find(function (zone) {
      return !zone.feeVariantId || !payload.backArtworks || !payload.backArtworks[String(zone.id)];
    });
    if (payload.hasBack && (!backZones.length || invalidBackZone)) {
      throw new Error('Every selected back print area needs artwork and a fee variant.');
    }
    var zoneIds = frontZones.map(function (zone) { return String(zone.id); });
    var zoneLabels = frontZones.map(function (zone) { return zone.label || String(zone.id); });
    var frontFeeVariantIds = frontZones.map(function (zone) { return String(zone.feeVariantId || ''); });
    var backZoneIds = backZones.map(function (zone) { return String(zone.id); });
    var backZoneLabels = backZones.map(function (zone) { return (zone.label || String(zone.id)).replace(/^Back\s*·\s*/, ''); });
    var backFeeVariantIds = backZones.map(function (zone) { return String(zone.feeVariantId || ''); });
    var expectedFeeLines = frontZones.length + (payload.hasBack ? backZones.length : 0);
    var baseForm = new FormData();
    baseForm.append('id', String(payload.variantId));
    baseForm.append('quantity', String(payload.quantity || 1));
    baseForm.append('properties[_design_id]', payload.designId);
    baseForm.append('properties[_custom_group_id]', payload.designId);
    baseForm.append('properties[_item_type]', 'product');
    baseForm.append('properties[_customized]', 'true');
    baseForm.append('properties[_customization_type]', payload.customizationType || 'screen_print');
    if (payload.customizationType === 'embroidery') {
      baseForm.append('properties[_embroidery_text]', payload.embroideryText || '');
      baseForm.append('properties[_embroidery_template]', payload.embroideryTemplate || '');
      baseForm.append('properties[_embroidery_color]', payload.embroideryColor || '');
    }
    // Keep the first-zone fields for older cart/theme code while version 3
    // stores ordered multi-zone metadata in JSON arrays.
    baseForm.append('properties[_front_zone]', zoneIds[0]);
    baseForm.append('properties[_front_zones]', JSON.stringify(zoneIds));
    baseForm.append('properties[_front_zone_labels]', JSON.stringify(zoneLabels));
    baseForm.append('properties[_front_fee_variant_ids]', JSON.stringify(frontFeeVariantIds));
    baseForm.append('properties[_front_artwork_zones]', JSON.stringify(zoneIds));
    baseForm.append('properties[_has_back]', payload.hasBack ? 'true' : 'false');
    baseForm.append('properties[_back_mode]', payload.hasBack ? String(payload.backMode || 'different') : 'none');
    baseForm.append('properties[_bundle_version]', '3');
    baseForm.append('properties[_fee_variant_id]', frontFeeVariantIds[0]);
    baseForm.append('properties[_expected_fee_lines]', String(expectedFeeLines));
    if (payload.hasBack && backZones.length) {
      baseForm.append('properties[_back_zone]', backZoneIds[0]);
      baseForm.append('properties[_back_zones]', JSON.stringify(backZoneIds));
      baseForm.append('properties[_back_zone_labels]', JSON.stringify(backZoneLabels));
      baseForm.append('properties[_back_fee_variant_ids]', JSON.stringify(backFeeVariantIds));
      baseForm.append('properties[_back_artwork_zones]', JSON.stringify(backZoneIds));
      baseForm.append('properties[_back_fee_variant_id]', backFeeVariantIds[0]);
    }
    baseForm.append('properties[Customization]', payload.customizationType === 'embroidery'
      ? 'Bordir'
      : (payload.hasBack ? 'Custom design · Front + Back' : 'Custom design · Front'));
    if (payload.customizationType === 'embroidery') {
      baseForm.append('properties[Embroidery text]', payload.embroideryText || '');
      baseForm.append('properties[Embroidery template]', payload.embroideryTemplateLabel || payload.embroideryTemplate || '');
      baseForm.append('properties[Embroidery color]', payload.embroideryColorLabel || payload.embroideryColor || '');
      baseForm.append('properties[Area bordir]', zoneLabels.join(', '));
      if (payload.hasBack) baseForm.append('properties[Area bordir belakang]', backZoneLabels.join(', '));
    } else {
      baseForm.append('properties[Front print areas]', zoneLabels.join(', '));
      if (payload.hasBack) baseForm.append('properties[Back print areas]', backZoneLabels.join(', '));
    }

    var baseResponse = await fetch(this.root() + 'cart/add.js', {
      method: 'POST',
      body: baseForm,
      headers: { 'Accept': 'application/json' }
    });

    if (!baseResponse.ok) {
      var baseError = await baseResponse.json().catch(function () { return {}; });
      throw new Error(baseError.description || baseError.message || 'Unable to add the customized product.');
    }

    var feeItems = [];
    frontZones.forEach(function (zone) {
      if (!zone.feeVariantId) return;
      feeItems.push({
        id: Number(zone.feeVariantId),
        quantity: payload.quantity || 1,
        properties: {
          '_design_id': payload.designId,
          '_custom_group_id': payload.designId,
          '_item_type': 'print_fee',
          '_customization_type': payload.customizationType || 'screen_print',
          '_side': 'front',
          '_zone': String(zone.id),
          'Print side': 'Front',
          'Print area': zone.label || zone.id
        }
      });
    });

    if (payload.hasBack) backZones.forEach(function (zone) {
      feeItems.push({
        id: Number(zone.feeVariantId),
        quantity: payload.quantity || 1,
        properties: {
          '_design_id': payload.designId,
          '_custom_group_id': payload.designId,
          '_item_type': 'print_fee',
          '_customization_type': payload.customizationType || 'screen_print',
          '_side': 'back',
          '_zone': String(zone.id),
          'Print side': 'Back',
          'Print area': (zone.label || zone.id).replace(/^Back\s*·\s*/, '')
        }
      });
    });

    if (feeItems.length) {
      var feeResponse = await fetch(this.root() + 'cart/add.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ items: feeItems })
      });

      if (!feeResponse.ok) {
        await this.removeDesign(payload.designId).catch(function () {});
        var feeError = await feeResponse.json().catch(function () { return {}; });
        throw new Error(feeError.description || feeError.message || 'Printing fee could not be added. The custom product was rolled back.');
      }
    }

    var cart = await this.getCart();
    if (window.DikadoCartSync && typeof window.DikadoCartSync.commitCart === 'function') {
      await window.DikadoCartSync.commitCart(cart);
    }
    return cart;
  };

  ShopifyCartService.prototype.getCart = async function () {
    var response = await fetch(this.root() + 'cart.js', { headers: { 'Accept': 'application/json' } });
    if (!response.ok) throw new Error('Unable to read cart.');
    return response.json();
  };

  ShopifyCartService.prototype.removeDesign = async function (designId) {
    var cart = await this.getCart();
    var updates = {};
    cart.items.forEach(function (item) {
      if (item.properties && item.properties._design_id === designId) {
        updates[item.key] = 0;
      }
    });
    if (!Object.keys(updates).length) return cart;
    var response = await fetch(this.root() + 'cart/update.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ updates: updates })
    });
    if (!response.ok) throw new Error('Unable to roll back custom cart lines.');
    return response.json();
  };

  function CustomizerController(root) {
    this.root = root;
    this.dialog = root;
    this.loader = new ProductConfigLoader(root);
    this.isEmbroidery = this.loader.product.isEmbroidery === true;
    this.customizationType = this.isEmbroidery ? 'embroidery' : 'screen_print';
    this.textMaxLength = this.isEmbroidery ? EMBROIDERY_TEXT_MAX_LENGTH : SCREEN_PRINT_TEXT_MAX_LENGTH;
    this.mockups = new VariantMockupManager(this.loader);
    this.price = new PriceCalculator(this.loader);
    this.frameCropper = new NS.FrameCropper();
    this.characterBuilder = new NS.CharacterBuilderAdapter(root);
    this.cart = new ShopifyCartService();
    this.canvasEditor = new CanvasEditor(
      root.querySelector('[data-customizer-canvas]'),
      this.frameCropper,
      this.textMaxLength
    );
    try {
      this.stickers = JSON.parse(root.parentElement.querySelector('[data-customizer-stickers]')?.textContent || '[]');
    } catch (error) {
      console.error('[Customizer] Unable to parse universal stickers.', error);
      this.stickers = [];
    }

    this.state = {
      designId: null,
      variantId: null,
      quantity: 1,
      characterBlob: null,
      embroideryText: '',
      embroideryTemplateId: null,
      embroideryTemplateLabel: null,
      embroideryColor: null,
      embroideryColorLabel: null,
      embroideryArtworkBlob: null,
      backEmbroideryText: '',
      backEmbroideryTemplateId: null,
      backEmbroideryTemplateLabel: null,
      backEmbroideryColor: null,
      backEmbroideryColorLabel: null,
      backEmbroideryArtworkBlob: null,
      frontZones: [],
      frontArtworks: {},
      frontCompositeArtwork: null,
      frontPreview: null,
      frontDesignSummary: null,
      backZones: [],
      backArtworks: {},
      backCompositeArtwork: null,
      backPreview: null,
      backDesignSummary: null,
      hasBack: false,
      editingSide: 'front',
      backMode: null
    };

    this.embroideryBuilder = null;
    this.pendingEmbroideryTransform = null;
    this.editingEmbroideryPlacement = false;
    if (this.isEmbroidery) {
      if (!NS.EmbroideryDesignBuilder) throw new Error('EmbroideryDesignBuilder is unavailable.');
      var embroideryTemplates = [];
      var embroideryTemplatesScript = document.getElementById(root.dataset.embroideryTemplatesScript || '');
      try {
        embroideryTemplates = JSON.parse(embroideryTemplatesScript ? embroideryTemplatesScript.textContent : '[]');
      } catch (error) {
        console.error('[Customizer] Unable to parse embroidery templates. Using the text-only fallback.', error);
      }
      var controller = this;
      this.embroideryBuilder = new NS.EmbroideryDesignBuilder(
        root.querySelector('[data-embroidery-builder]'),
        {
          templates: embroideryTemplates,
          onConfirm: function (result) { return controller.confirmEmbroideryDesign(result); }
        }
      );
    }

    this.objectUrls = [];
    this.isProcessing = false;
    var self = this;
    this.canvasEditor.onZoneChange = function () {
      self.renderEditorZones();
      self.updateEditorLabels(self.state.editingSide, self.canvasEditor.getActiveZone());
    };
    this.canvasEditor.onArtworkChange = function () { self.renderEditorZones(); };
    this.applyCustomizationMode();
    this.bind();
  }

  CustomizerController.prototype.applyCustomizationMode = function () {
    this.root.dataset.customizationMode = this.customizationType;
    var textInput = this.root.querySelector('[data-text-value]');
    if (textInput) textInput.maxLength = this.textMaxLength;
    if (!this.isEmbroidery) return;
    this.root.querySelectorAll('[data-embroidery-unavailable]').forEach(function (element) {
      element.hidden = true;
      if ('disabled' in element) element.disabled = true;
    });
  };

  CustomizerController.prototype.bind = function () {
    var self = this;

    this.root.querySelector('[data-customizer-close]').addEventListener('click', function () { self.close(); });
    this.root.addEventListener('cancel', function (event) {
      event.preventDefault();
      self.close();
    });

    this.root.querySelector('[data-character-create]').addEventListener('click', function () { self.createCharacter(); });
    this.root.querySelector('[data-character-skip]').addEventListener('click', function () { self.goToZones(); });
    this.root.querySelector('[data-back-to-character]').addEventListener('click', function () { self.showStep('character'); });
    this.root.querySelector('[data-zone-continue]').addEventListener('click', function () { self.openFrontEditor(); });
    this.root.querySelector('[data-editor-zones]').addEventListener('click', function (event) {
      var button = event.target.closest('[data-editor-zone-id]');
      if (button) self.canvasEditor.setActiveZone(button.dataset.editorZoneId);
    });

    this.root.querySelector('[data-tool-character]').addEventListener('click', function () { self.addCharacterToEditor(); });
    this.root.querySelector('[data-tool-stickers]').addEventListener('click', function () { self.openStickerPicker(); });
    this.root.querySelector('[data-sticker-close]').addEventListener('click', function () { self.closeStickerPicker(); });
    this.root.querySelector('[data-sticker-dialog]').addEventListener('click', function (event) {
      if (event.target === event.currentTarget) self.closeStickerPicker();
    });
    this.root.addEventListener('keydown', function (event) {
      var picker = self.root.querySelector('[data-sticker-dialog]');
      if (event.key === 'Escape' && !picker.hidden) {
        event.preventDefault();
        event.stopPropagation();
        self.closeStickerPicker();
      }
    });
    this.root.querySelector('[data-sticker-grid]').addEventListener('click', function (event) {
      var button = event.target.closest('[data-sticker-index]');
      if (button) self.addStickerToEditor(Number(button.dataset.stickerIndex));
    });
    this.root.querySelector('[data-tool-text]').addEventListener('click', function () { self.addText(); });
    this.root.querySelector('[data-tool-edit-embroidery]').addEventListener('click', function () { self.editEmbroideryDesign(); });
    this.root.querySelector('[data-tool-upload]').addEventListener('click', function () {
      self.root.querySelector('[data-image-upload]').click();
    });
    this.root.querySelector('[data-image-upload]').addEventListener('change', function (event) { self.addUploadedImage(event); });
    this.root.querySelector('[data-tool-frame]').addEventListener('click', function () { self.promptFrame(); });
    this.root.querySelector('[data-tool-flip]').addEventListener('click', function () {
      if (self.isEmbroidery) return;
      self.canvasEditor.flipActiveHorizontal();
      self.syncEditorTools();
    });
    this.root.querySelector('[data-tool-delete]').addEventListener('click', function () { self.canvasEditor.deleteActive(); });

    this.root.querySelectorAll('[data-editor-back]').forEach(function (button) {
      button.addEventListener('click', function () { self.editorBack(); });
    });
    this.root.querySelectorAll('[data-editor-finish]').forEach(function (button) {
      button.addEventListener('click', function () { self.finishCurrentEditor(); });
    });

    this.root.querySelector('[data-front-only]').addEventListener('click', function () { self.chooseFrontOnly(); });
    this.root.querySelector('[data-add-back]').addEventListener('click', function () { self.chooseAddBack(); });
    this.root.querySelector('[data-back-same]').addEventListener('click', function () { self.startBackSame(); });
    this.root.querySelector('[data-back-different]').addEventListener('click', function () { self.startBackDifferent(); });
    this.root.querySelector('[data-back-mode-back]').addEventListener('click', function () { self.showStep('back-choice'); });
    this.root.querySelector('[data-back-zone-mode]').addEventListener('click', function () { self.showStep('back-mode'); });
    this.root.querySelector('[data-back-zone-continue]').addEventListener('click', function () { self.openBackEditor(); });
    this.root.querySelector('[data-add-to-cart]').addEventListener('click', function () { self.addToCart(); });
    this.root.querySelector('[data-review-back-edit]').addEventListener('click', function () { self.reviewBack(); });

    this.bindTextControls();

    document.addEventListener('dblclick', function () {
      if (self.isEmbroidery || !self.dialog.open || !self.canvasEditor.canvas) return;
      var active = self.canvasEditor.canvas.getActiveObject();
      if (active && active._customizerObjectType === 'frame') {
        self.canvasEditor.editActiveFrame().catch(function (error) {
          if (error && error.name !== 'AbortError') self.setStatus(error.message, true);
        });
      }
    });
  };

  CustomizerController.prototype.bindTextControls = function () {
    var self = this;
    var wrap = this.root.querySelector('[data-text-controls]');
    var value = this.root.querySelector('[data-text-value]');
    var font = this.root.querySelector('[data-text-font]');
    var size = this.root.querySelector('[data-text-size]');
    var color = this.root.querySelector('[data-text-color]');

    value.maxLength = this.textMaxLength;

    function sync() {
      var text = self.canvasEditor.getActiveText();
      if (!text) return;

      var limitedValue = truncateText(value.value, self.textMaxLength);
      if (value.value !== limitedValue) {
        value.value = limitedValue;
        self.setStatus(
          self.isEmbroidery
            ? 'Teks Bordir maksimal 12 karakter, termasuk spasi.'
            : 'Text is limited to 120 characters.',
          true
        );
      }

      text.set({
        text: limitedValue,
        fontFamily: font.value,
        fontSize: Number(size.value),
        fill: color.value
      });

      text.setCoords();
      self.canvasEditor.keepInsideZone(text);
      self.canvasEditor.canvas.requestRenderAll();
    }

    [value, font, size, color].forEach(function (input) { input.addEventListener('input', sync); });

    var observer = function () {
      var text = self.canvasEditor.getActiveText();
      wrap.hidden = !text;
      if (!text) return;
      var limitedValue = truncateText(text.text || '', self.textMaxLength);
      if (text.text !== limitedValue) {
        text.set({ text: limitedValue });
        text.setCoords();
        self.canvasEditor.keepInsideZone(text);
      }
      value.value = limitedValue;
      font.value = text.fontFamily || 'Arial';
      size.value = Math.round(text.fontSize || 48);
      color.value = typeof text.fill === 'string' && text.fill.charAt(0) === '#' ? text.fill : '#3b2a23';
    };

    this._syncTextControls = observer;
  };

  CustomizerController.prototype.attachCanvasSelectionEvents = function () {
    if (!this.canvasEditor.canvas || this._selectionBound) return;
    this._selectionBound = true;
    var self = this;
    ['selection:created', 'selection:updated', 'selection:cleared'].forEach(function (name) {
      self.canvasEditor.canvas.on(name, function () {
        if (self._syncTextControls) self._syncTextControls();
        self.syncEditorTools();
      });
    });
    this.syncEditorTools();
  };

  CustomizerController.prototype.syncEditorTools = function () {
    var flipButton = this.root.querySelector('[data-tool-flip]');
    if (!flipButton) return;
    flipButton.disabled = this.isEmbroidery || !this.canvasEditor.getFlippableActiveObject();
  };

  CustomizerController.prototype.open = function (variantId, quantity) {
    var variant = this.loader.getVariant(variantId);
    if (!variant) throw new Error('Selected Shopify variant is not available in the customizer configuration.');
    if (!variant.available) throw new Error('Selected variant is unavailable.');

    this.reset();
    this.state.designId = uid();
    this.state.variantId = String(variantId);
    this.state.quantity = quantity || 1;
    if (this.isEmbroidery) this.openEmbroideryBuilder('front');
    else this.showStep('character');
    this.dialog.showModal();
  };

  CustomizerController.prototype.close = function () {
    if (this.isProcessing) return;
    this.closeStickerPicker();
    if (this.dialog.open) this.dialog.close();
    this.canvasEditor.dispose();
    this._selectionBound = false;
    this.revokeObjectUrls();
  };

  CustomizerController.prototype.reset = function () {
    this.canvasEditor.dispose();
    this._selectionBound = false;
    this.revokeObjectUrls();
    this.state = {
      designId: null,
      variantId: null,
      quantity: 1,
      characterBlob: null,
      embroideryText: '',
      embroideryTemplateId: null,
      embroideryTemplateLabel: null,
      embroideryColor: null,
      embroideryColorLabel: null,
      embroideryArtworkBlob: null,
      backEmbroideryText: '',
      backEmbroideryTemplateId: null,
      backEmbroideryTemplateLabel: null,
      backEmbroideryColor: null,
      backEmbroideryColorLabel: null,
      backEmbroideryArtworkBlob: null,
      frontZones: [],
      frontArtworks: {},
      frontCompositeArtwork: null,
      frontPreview: null,
      frontDesignSummary: null,
      backZones: [],
      backArtworks: {},
      backCompositeArtwork: null,
      backPreview: null,
      backDesignSummary: null,
      hasBack: false,
      editingSide: 'front',
      backMode: null
    };
    this.pendingEmbroideryTransform = null;
    this.editingEmbroideryPlacement = false;
    this.root.querySelector('[data-character-result]').hidden = true;
    this.root.querySelector('[data-character-preview]').removeAttribute('src');
    this.setStatus('');
  };

  CustomizerController.prototype.showStep = function (name) {
    if (this.isEmbroidery && name === 'character') {
      this.openEmbroideryBuilder('front');
      return;
    }
    this.root.querySelectorAll('[data-step]').forEach(function (step) {
      step.classList.toggle('is-active', step.dataset.step === name);
    });
    var labels = this.isEmbroidery ? {
      embroidery: this.state.editingSide === 'back' ? 'Design Bordir belakang' : 'Design Bordir',
      zone: 'Pilih area Bordir depan',
      editor: this.state.editingSide === 'back' ? 'Desain Bordir belakang' : 'Desain Bordir depan',
      'back-choice': 'Pilihan Bordir belakang',
      'back-mode': 'Pilih mode Bordir belakang',
      'back-zone': 'Pilih area Bordir belakang',
      review: 'Review dan tambahkan Bordir ke keranjang'
    } : {
      character: 'Create character',
      zone: 'Choose front print positions',
      editor: this.state.editingSide === 'back' ? 'Design back' : 'Design front',
      'back-choice': 'Optional back print',
      'back-mode': 'Choose back design mode',
      'back-zone': 'Choose back print positions',
      review: 'Review and add to cart'
    };
    this.root.querySelector('[data-customizer-step-label]').textContent = labels[name] || '';
    var body = this.root.querySelector('.customizer-body');
    if (body) body.scrollTop = 0;
  };

  CustomizerController.prototype.createCharacter = async function () {
    if (this.isEmbroidery) return;
    try {
      var blob = await this.characterBuilder.open();
      this.state.characterBlob = blob;
      var url = this.trackUrl(blobUrl(blob));
      this.root.querySelector('[data-character-preview]').src = url;
      this.root.querySelector('[data-character-result]').hidden = false;
      this.goToZones();
    } catch (error) {
      if (error && error.name !== 'AbortError') this.setStatus(error.message, true);
    }
  };

  CustomizerController.prototype.getEmbroideryState = function (side) {
    if (side === 'back' && this.state.backMode !== 'same') {
      return {
        text: this.state.backEmbroideryText,
        templateId: this.state.backEmbroideryTemplateId,
        templateLabel: this.state.backEmbroideryTemplateLabel,
        color: this.state.backEmbroideryColor,
        colorLabel: this.state.backEmbroideryColorLabel,
        blob: this.state.backEmbroideryArtworkBlob
      };
    }
    return {
      text: this.state.embroideryText,
      templateId: this.state.embroideryTemplateId,
      templateLabel: this.state.embroideryTemplateLabel,
      color: this.state.embroideryColor,
      colorLabel: this.state.embroideryColorLabel,
      blob: this.state.embroideryArtworkBlob
    };
  };

  CustomizerController.prototype.setEmbroideryState = function (side, result) {
    if (side === 'back') {
      this.state.backEmbroideryText = result.text;
      this.state.backEmbroideryTemplateId = result.templateId;
      this.state.backEmbroideryTemplateLabel = result.templateLabel;
      this.state.backEmbroideryColor = result.color;
      this.state.backEmbroideryColorLabel = result.colorLabel;
      this.state.backEmbroideryArtworkBlob = result.blob;
      return;
    }
    this.state.embroideryText = result.text;
    this.state.embroideryTemplateId = result.templateId;
    this.state.embroideryTemplateLabel = result.templateLabel;
    this.state.embroideryColor = result.color;
    this.state.embroideryColorLabel = result.colorLabel;
    this.state.embroideryArtworkBlob = result.blob;
  };

  CustomizerController.prototype.validateEmbroideryState = function (side) {
    if (!this.isEmbroidery) return '';
    var design = this.getEmbroideryState(side);
    var text = String(design.text || '');
    if (!text.trim()) return 'Masukkan teks Bordir sebelum melanjutkan.';
    if (Array.from(text).length > EMBROIDERY_TEXT_MAX_LENGTH) {
      return 'Teks Bordir maksimal 12 karakter, termasuk spasi.';
    }
    if (!design.templateId) return 'Pilih template Bordir sebelum melanjutkan.';
    if (!design.color) return 'Pilih warna benang sebelum melanjutkan.';
    if (!design.blob) return 'Konfirmasi ulang desain Bordir sebelum melanjutkan.';
    return '';
  };

  CustomizerController.prototype.embroideryObjectMeta = function (side) {
    var design = this.getEmbroideryState(side);
    return {
      text: design.text,
      templateId: design.templateId,
      color: design.color
    };
  };

  CustomizerController.prototype.openEmbroideryBuilder = function (side) {
    if (!this.isEmbroidery || !this.embroideryBuilder) return;
    side = side === 'back' ? 'back' : 'front';
    this.state.editingSide = side;
    var mockupSide = this.loader.config.surfaceMode === 'wrap' ? 'wrap' : side;
    this.showStep('embroidery');
    this.embroideryBuilder.open({
      side: side,
      state: this.getEmbroideryState(side),
      mockupUrl: this.mockups.get(this.state.variantId, mockupSide)
    });
  };

  CustomizerController.prototype.editEmbroideryDesign = function () {
    if (!this.isEmbroidery) return;
    this.pendingEmbroideryTransform = this.canvasEditor.captureEmbroideryTransform();
    this.editingEmbroideryPlacement = true;
    this.openEmbroideryBuilder(this.state.editingSide);
  };

  CustomizerController.prototype.confirmEmbroideryDesign = async function (result) {
    if (!this.isEmbroidery) return;
    var side = result.side === 'back' ? 'back' : 'front';
    this.setEmbroideryState(side, result);

    if (this.editingEmbroideryPlacement && this.canvasEditor.canvas && this.canvasEditor.side === side) {
      var transform = this.pendingEmbroideryTransform;
      this.pendingEmbroideryTransform = null;
      this.editingEmbroideryPlacement = false;
      this.showStep('editor');
      await this.canvasEditor.replaceEmbroidery(result.blob, this.embroideryObjectMeta(side), transform);
      this.renderEditorZones();
      this.updateEditorLabels(side, this.canvasEditor.getActiveZone());
      this.setStatus(transform
        ? 'Desain Bordir diperbarui. Posisi, ukuran, dan rotasi dipertahankan.'
        : 'Desain Bordir ditambahkan kembali ke area yang dipilih.');
      return;
    }

    this.pendingEmbroideryTransform = null;
    this.editingEmbroideryPlacement = false;
    if (side === 'back') this.renderBackZonePicker();
    else this.goToZones();
  };

  CustomizerController.prototype.getFrontZones = function () {
    return this.loader.config.front.zones || [];
  };

  CustomizerController.prototype.goToZones = function () {
    var zones = this.getFrontZones();
    var embroideryError = this.validateEmbroideryState('front');
    if (embroideryError) {
      this.setStatus(embroideryError, true);
      if (this.isEmbroidery) this.openEmbroideryBuilder('front');
      return;
    }
    if (!zones.length) {
      this.setStatus(this.isEmbroidery
        ? 'Belum ada area Bordir depan di customizer.config.'
        : 'No front print zone is configured in customizer.config.', true);
      return;
    }
    var seenZoneIds = new Set();
    var invalidZone = zones.find(function (zone) {
      var id = zone && zone.id != null ? String(zone.id) : '';
      if (!id || seenZoneIds.has(id)) return true;
      seenZoneIds.add(id);
      return false;
    });
    if (invalidZone) {
      this.setStatus(this.isEmbroidery
        ? 'Setiap area Bordir depan harus memiliki id unik di customizer.config.'
        : 'Every front print zone must have a unique id in customizer.config.', true);
      return;
    }

    if (zones.length === 1) {
      this.state.frontZones = [zones[0]];
      this.openFrontEditor();
      return;
    }

    var container = this.root.querySelector('[data-zone-options]');
    container.innerHTML = '';
    var self = this;
    var selectedIds = new Set(this.state.frontZones.map(function (zone) { return String(zone.id); }));
    zones.forEach(function (zone) {
      var label = document.createElement('label');
      label.className = 'customizer-zone-option';
      var input = document.createElement('input');
      var copy = document.createElement('span');
      var title = document.createElement('strong');
      var physical = document.createElement('small');
      var price = document.createElement('span');
      input.type = self.isEmbroidery ? 'radio' : 'checkbox';
      input.name = 'customizer-zones-' + self.root.dataset.sectionId;
      input.value = String(zone.id);
      input.checked = selectedIds.has(String(zone.id));
      title.textContent = zone.label || zone.id;
      physical.textContent = self.zonePhysicalLabel(zone);
      price.className = 'customizer-zone-price';
      price.textContent = formatCurrency(zone.price || 0, self.loader.product.currency);
      copy.appendChild(title);
      copy.appendChild(physical);
      label.appendChild(input);
      label.appendChild(copy);
      label.appendChild(price);
      input.addEventListener('change', function () {
        if (input.checked && !self.isEmbroidery) {
          var conflict = self.state.frontZones.find(function (selected) {
            return self.zonesOverlap(zone, selected);
          });
          if (conflict) {
            input.checked = false;
            self.updateZoneSelectionSummary(
              (zone.label || zone.id) + ' overlaps ' + (conflict.label || conflict.id) + ' and cannot be selected together.',
              true
            );
            return;
          }
        } else if (
          self.canvasEditor.canvas && self.canvasEditor.side === 'front' &&
          self.canvasEditor.hasArtwork(zone.id) &&
          !window.confirm('Remove ' + (zone.label || zone.id) + ' and its artwork from this design?')
        ) {
          input.checked = true;
          return;
        }

        var checked = new Set(Array.from(container.querySelectorAll('input:checked')).map(function (node) { return node.value; }));
        self.state.frontZones = zones.filter(function (candidate) { return checked.has(String(candidate.id)); });
        self.state.frontArtworks = {};
        self.state.frontCompositeArtwork = null;
        self.state.frontPreview = null;
        self.state.frontDesignSummary = null;
        self.updateZoneSelectionSummary();
      });
      container.appendChild(label);
    });
    this.updateZoneSelectionSummary();
    this.showStep('zone');
  };

  CustomizerController.prototype.zonesOverlap = function (a, b) {
    var left = Math.max(Number(a.x || 0), Number(b.x || 0));
    var top = Math.max(Number(a.y || 0), Number(b.y || 0));
    var right = Math.min(Number(a.x || 0) + Number(a.width || 0), Number(b.x || 0) + Number(b.width || 0));
    var bottom = Math.min(Number(a.y || 0) + Number(a.height || 0), Number(b.y || 0) + Number(b.height || 0));
    return right - left > 0.0001 && bottom - top > 0.0001;
  };

  CustomizerController.prototype.updateZoneSelectionSummary = function (message, isError) {
    var summary = this.root.querySelector('[data-zone-selection-summary]');
    var zones = this.state.frontZones;
    var fee = zones.reduce(function (total, zone) { return total + Number(zone.price || 0); }, 0);
    summary.textContent = message || (zones.length
      ? (this.isEmbroidery ? '1 area Bordir dipilih · ' : zones.length + (zones.length === 1 ? ' area' : ' areas') + ' selected · ') + formatCurrency(fee, this.loader.product.currency)
      : (this.isEmbroidery ? 'Pilih setidaknya satu area Bordir.' : 'Select at least one print area.'));
    summary.classList.toggle('is-error', Boolean(isError));
    this.root.querySelector('[data-zone-continue]').disabled = zones.length === 0;
  };

  CustomizerController.prototype.zonePhysicalLabel = function (zone) {
    if (zone.printWidthMm && zone.printHeightMm) return zone.printWidthMm + ' × ' + zone.printHeightMm + ' mm';
    return this.isEmbroidery ? 'Area Bordir' : 'Custom print area';
  };

  CustomizerController.prototype.openFrontEditor = async function () {
    if (!this.state.frontZones.length) return;
    this.state.editingSide = 'front';
    this.state.hasBack = false;
    this.showStep('editor');
    if (this.canvasEditor.canvas && this.canvasEditor.side === 'front' && this.canvasEditor.mockup) {
      this.canvasEditor.setZones(this.state.frontZones);
      if (this.isEmbroidery && !this.canvasEditor.getEmbroideryObject()) {
        await this.canvasEditor.replaceEmbroidery(
          this.state.embroideryArtworkBlob,
          this.embroideryObjectMeta('front'),
          null
        );
      }
      this.updateEditorLabels('front', this.canvasEditor.getActiveZone());
      this.updatePrices();
      this.renderEditorZones();
      return;
    }
    await this.loadEditorSurface('front', this.state.frontZones, false);
  };

  CustomizerController.prototype.getAvailableBackZones = function () {
    var back = this.loader.config.back;
    if (back && back.enabled === false) return [];
    if (back && Array.isArray(back.zones) && back.zones.length) {
      return back.zones.map(function (zone, index) {
        return Object.assign({ id: 'back-' + (index + 1), label: 'Area ' + (index + 1), _explicitBackZone: true }, zone);
      });
    }
    if (back && back.zone) return [Object.assign({ id: 'back', label: 'Main', _explicitBackZone: true }, back.zone)];

    // Accept the back print area either as back.zone or directly on back.
    // Both shapes have existed in product metafield configurations.
    if (
      back && back.x != null && back.y != null &&
      back.width != null && back.height != null
    ) return [Object.assign({ id: 'back', label: 'Main', _explicitBackZone: true }, back)];

    // Different Back Design can choose from every configured print position,
    // regardless of which positions were selected for the Front. Product
    // configurations with no Back-specific zones inherit the Front geometry,
    // dimensions, price, and fee variant deterministically.
    var frontZones = this.getFrontZones();
    if (frontZones.length) {
      return frontZones.map(function (frontZone) {
        return Object.assign({}, frontZone, {
          id: 'back-' + (frontZone.id || 'main'),
          label: frontZone.label || 'Main',
          _derivedFromFrontZone: String(frontZone.id || 'main')
        });
      });
    }

    return [];
  };

  CustomizerController.prototype.getSameBackZones = function () {
    var available = this.getAvailableBackZones();

    function canonical(value) {
      return String(value == null ? '' : value).toLowerCase().replace(/^back[-_.:\s·]*/, '').replace(/[^a-z0-9]+/g, '');
    }

    return this.state.frontZones.map(function (frontZone) {
      var frontId = String(frontZone.id || 'main');
      var matching = available.find(function (backZone) {
        var configuredFrontId = backZone.frontZoneId || backZone.sourceFrontZoneId || backZone.matchesFrontZone;
        if (configuredFrontId != null && String(configuredFrontId) === frontId) return true;
        if (backZone._derivedFromFrontZone && String(backZone._derivedFromFrontZone) === frontId) return true;
        return canonical(backZone.id) === canonical(frontId) || canonical(backZone.label) === canonical(frontZone.label || frontId);
      });
      var zone = Object.assign({}, matching || frontZone);

      // Same mode is priced exactly like Front and reuses the corresponding
      // Front production artwork. A matched Back zone may provide Back-specific
      // mockup geometry, but never changes the copied area's fee or identity.
      zone.id = 'back-' + frontId;
      zone.label = frontZone.label || zone.label || 'Main';
      zone.price = Number(frontZone.price || 0);
      zone.feeVariantId = frontZone.feeVariantId;
      zone.printWidthMm = frontZone.printWidthMm;
      zone.printHeightMm = frontZone.printHeightMm;
      zone._derivedFromFrontZone = frontId;
      zone._sameAsFront = true;
      return zone;
    });
  };

  CustomizerController.prototype.getBackZones = function () {
    return this.state.backZones || [];
  };

  CustomizerController.prototype.isBackPrintAvailable = function () {
    var configuredMode =
      this.loader.config.surfaceMode ||
      this.loader.config.surface_mode ||
      this.loader.config.mode ||
      '';
    var mode = String(configuredMode).toLowerCase().replace(/[-\s]/g, '_');

    // Single/wrap products skip Back. Standard products use explicit Back
    // zones when configured and otherwise inherit all configured Front zones.
    if (mode === 'single' || mode === 'wrap') return false;
    return this.getAvailableBackZones().length > 0;
  };

  CustomizerController.prototype.isBackPrintDisabled = function () {
    var back = this.loader.config.back;
    return Boolean(back && back.enabled === false);
  };

  CustomizerController.prototype.updateBackChoice = function (backAvailable) {
    var addBackButton = this.root.querySelector('[data-add-back]');
    var frontOnlyButton = this.root.querySelector('[data-front-only]');
    var frontOnlyLabel = this.root.querySelector('[data-front-only-label]');
    var choiceGrid = frontOnlyButton && frontOnlyButton.parentElement;

    if (addBackButton) addBackButton.hidden = !backAvailable;
    if (frontOnlyLabel) frontOnlyLabel.textContent = backAvailable ? 'Continue Front Only' : 'Done';
    if (choiceGrid) choiceGrid.classList.toggle('is-single-choice', !backAvailable);
  };

  CustomizerController.prototype.loadEditorSurface =
  async function (side, zones, insertFrontArtwork) {

    zones = Array.isArray(zones) ? zones : (zones ? [zones] : []);

    var loading =
      this.root.querySelector(
        '[data-canvas-loading]'
      );

    loading.hidden = false;
    var canvasWrap = this.root.querySelector('[data-canvas-wrap]');
    canvasWrap.setAttribute('aria-busy', 'true');

    // Pricing only depends on the selected Shopify variant and print zone.
    // Populate it immediately so a slow or failed canvas/mockup load cannot
    // leave the summary blank, which is especially noticeable on mobile.
    this.updateEditorLabels(side, zones[0]);
    this.updatePrices();

    var loaded = false;

    try {

      // Give the browser one frame to paint the loading state before image
      // decoding and Fabric canvas preparation begin.
      await new Promise(function (resolve) {
        window.requestAnimationFrame(function () { resolve(); });
      });

      var mockupSide =
        this.loader.config.surfaceMode === 'wrap'
          ? 'wrap'
          : side;

      var mockupUrl =
        this.mockups.get(
          this.state.variantId,
          mockupSide
        );

      await this.canvasEditor.loadSurface({
        side: side,
        zones: zones,
        mockupUrl: mockupUrl
      });

      this.attachCanvasSelectionEvents();

      if (insertFrontArtwork) {
        var mirroredZones = zones.filter(function (zone) { return zone._derivedFromFrontZone; });
        if (mirroredZones.length === zones.length) {
          for (var zoneIndex = 0; zoneIndex < mirroredZones.length; zoneIndex += 1) {
            var mirroredZone = mirroredZones[zoneIndex];
            var matchingArtwork = this.state.frontArtworks[String(mirroredZone._derivedFromFrontZone)];
            if (!matchingArtwork) throw new Error('The matching front artwork is missing for ' + (mirroredZone.label || mirroredZone.id) + '.');
            var copiedArtwork = await this.canvasEditor.addZoneArtwork(matchingArtwork, mirroredZone.id, 'flattened-front-zone');
            copiedArtwork.set({
              selectable: false,
              evented: false,
              hasControls: false,
              hasBorders: false,
              hoverCursor: 'default'
            });
          }
        } else if (this.state.frontCompositeArtwork) {
          await this.canvasEditor.addBlobImage(this.state.frontCompositeArtwork, 'flattened-front');
        }
      } else if (this.isEmbroidery) {
        var embroideryDesign = this.getEmbroideryState(side);
        var embroideryError = this.validateEmbroideryState(side);
        if (embroideryError) throw new Error(embroideryError);
        await this.canvasEditor.replaceEmbroidery(
          embroideryDesign.blob,
          this.embroideryObjectMeta(side),
          null
        );
      }

      this.renderEditorZones();

      if (this._syncTextControls) {
        this._syncTextControls();
      }

      loaded = true;

    } catch (error) {

      console.error(
        '[Customizer] loadEditorSurface:',
        error
      );

      this.setStatus(
        error.message,
        true
      );

    } finally {

      loading.hidden = true;
      canvasWrap.removeAttribute('aria-busy');

    }

    return loaded;
  };

  CustomizerController.prototype.updateEditorLabels = function (side, zone) {
    this.root.querySelector('[data-editor-side-label]').textContent = this.isEmbroidery
      ? (side === 'back' ? 'Bordir Belakang' : 'Bordir Depan')
      : (side === 'back' ? 'Back' : 'Front');
    this.root.querySelector('[data-editor-zone-label]').textContent = zone ? '· ' + (zone.label || zone.id || 'Main') : '';
    var fee = side === 'back'
      ? this.state.backZones.reduce(function (total, backZone) { return total + Number(backZone.price || 0); }, 0)
      : this.state.frontZones.reduce(function (total, frontZone) { return total + Number(frontZone.price || 0); }, 0);
    this.root.querySelector('[data-editor-price]').textContent = formatCurrency(fee, this.loader.product.currency) +
      (this.isEmbroidery ? ' biaya Bordir' : ' print fee');
    this.root.querySelectorAll('[data-editor-finish]').forEach(function (button) {
      button.textContent = this.isEmbroidery
        ? (side === 'back' ? 'Selesai Bordir Belakang' : 'Selesai Bordir Depan')
        : (side === 'back' ? 'Finish Back' : 'Finish Front');
    }, this);
    this.root.querySelector('[data-tool-character]').disabled = this.isEmbroidery || !this.state.characterBlob;
  };

  CustomizerController.prototype.renderEditorZones = function () {
    var container = this.root.querySelector('[data-editor-zones]');
    if (!container) return;
    container.innerHTML = '';
    var activeId = String(this.canvasEditor.activeZoneId);
    this.canvasEditor.zones.forEach(function (zone) {
      var button = document.createElement('button');
      var designed = this.canvasEditor.hasArtwork(zone.id);
      button.type = 'button';
      button.className = 'customizer-editor-zone';
      button.dataset.editorZoneId = String(zone.id);
      button.dataset.designed = designed ? 'true' : 'false';
      button.setAttribute('aria-pressed', String(zone.id) === activeId ? 'true' : 'false');
      button.textContent = (zone.label || zone.id) + ' · ' + (designed ? 'Designed' : 'Empty');
      container.appendChild(button);
    }, this);
  };

  CustomizerController.prototype.updatePrices = function () {
    if (!this.state.frontZones.length) return;
    var backZones = this.state.backZones;
    var summary = this.price.summary(this.state.variantId, this.state.frontZones, backZones, this.state.hasBack);
    var currency = this.loader.product.currency;
    var label = this.state.frontZones.map(function (zone) { return zone.label || zone.id; }).join(', ');
    var backLabel = backZones.map(function (zone) { return (zone.label || zone.id).replace(/^Back\s*·\s*/, ''); }).join(', ');

    this.root.querySelector('[data-price-product]').textContent = formatCurrency(summary.base, currency);
    this.root.querySelector('[data-price-front-label]').textContent = (this.isEmbroidery ? 'Bordir depan · ' : 'Front · ') + label;
    this.root.querySelector('[data-price-front]').textContent = formatCurrency(summary.front, currency);
    this.root.querySelector('[data-price-back-row]').hidden = !this.state.hasBack;
    this.root.querySelector('[data-price-back-label]').textContent = backLabel
      ? (this.isEmbroidery ? 'Bordir belakang · ' : 'Back · ') + backLabel
      : (this.isEmbroidery ? 'Bordir belakang' : 'Back print');
    this.root.querySelector('[data-price-back]').textContent = formatCurrency(summary.back, currency);
    this.root.querySelector('[data-price-total]').textContent = formatCurrency(summary.total, currency);

    this.root.querySelector('[data-review-product-price]').textContent = formatCurrency(summary.base, currency);
    this.root.querySelector('[data-review-front-label]').textContent = (this.isEmbroidery ? 'Bordir depan · ' : 'Front · ') + label;
    this.root.querySelector('[data-review-front-price]').textContent = formatCurrency(summary.front, currency);
    this.root.querySelector('[data-review-back-price-row]').hidden = !this.state.hasBack;
    this.root.querySelector('[data-review-back-label]').textContent = backLabel
      ? (this.isEmbroidery ? 'Bordir belakang · ' : 'Back · ') + backLabel
      : (this.isEmbroidery ? 'Bordir belakang' : 'Back print');
    this.root.querySelector('[data-review-back-price]').textContent = formatCurrency(summary.back, currency);
    this.root.querySelector('[data-review-total]').textContent = formatCurrency(summary.total, currency);
  };

  CustomizerController.prototype.addCharacterToEditor = async function () {
    if (this.isEmbroidery) return;
    if (!this.state.characterBlob) return;
    try { await this.canvasEditor.addCharacter(this.state.characterBlob); }
    catch (error) { this.setStatus(error.message, true); }
  };

  CustomizerController.prototype.openStickerPicker = function () {
    if (this.isEmbroidery) return;
    var grid = this.root.querySelector('[data-sticker-grid]');
    var empty = this.root.querySelector('[data-sticker-empty]');
    grid.innerHTML = '';
    this.stickers.forEach(function (sticker, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'customizer-sticker-card';
      button.dataset.stickerIndex = String(index);
      var image = document.createElement('img');
      image.src = sticker.image;
      image.alt = '';
      var label = document.createElement('span');
      label.textContent = sticker.name || 'Sticker';
      button.appendChild(image);
      button.appendChild(label);
      grid.appendChild(button);
    });
    empty.hidden = this.stickers.length > 0;
    this.root.querySelector('[data-sticker-dialog]').hidden = false;
  };

  CustomizerController.prototype.closeStickerPicker = function () {
    this.root.querySelector('[data-sticker-dialog]').hidden = true;
  };

  CustomizerController.prototype.addStickerToEditor = async function (index) {
    if (this.isEmbroidery) return;
    var sticker = this.stickers[index];
    if (!sticker) return;
    this.closeStickerPicker();
    try {
      await this.canvasEditor.addSticker(sticker.image);
    } catch (error) {
      this.setStatus(error.message, true);
    }
  };

  CustomizerController.prototype.addText = function () {
  if (this.isEmbroidery) return null;
  var text = this.canvasEditor.addText(truncateText('Your text', this.textMaxLength));

  if (this._syncTextControls) {
    this._syncTextControls();
  }

  var input = this.root.querySelector(
    '[data-text-value]'
  );

  if (input) {
    requestAnimationFrame(function () {
      input.focus();
      input.select();
    });
  }

  return text;
};

  CustomizerController.prototype.captureCurrentDesignSummary = function () {
    var objects = this.canvasEditor.getDesignObjects();
    return {
      objectTypes: objects.map(function (object) {
        if (object._customizerObjectType) return object._customizerObjectType;
        return object.type === 'i-text' || object.type === 'text' ? 'text' : (object.type || 'unknown');
      }),
      textValues: objects.filter(function (object) {
        return object.type === 'i-text' || object.type === 'text' || object._customizerObjectType === 'text';
      }).map(function (object) { return String(object.text || ''); })
    };
  };

  CustomizerController.prototype.validateDesignSummary = function (summary, sideLabel) {
    if (!summary) return (sideLabel || 'Design') + ' must be finished again before it can be added to cart.';

    if (this.isEmbroidery) {
      var unsupportedType = summary.objectTypes.find(function (type) { return type !== 'embroidery'; });
      if (unsupportedType) return 'Mode Bordir hanya mengizinkan satu artwork dari Design Bordir.';
      if (summary.objectTypes.length > 1) return 'Hanya satu artwork Bordir yang dapat aktif pada setiap sisi.';
    }

    var tooLong = summary.textValues.find(function (value) {
      return String(value).length > this.textMaxLength;
    }, this);
    if (tooLong != null) {
      return this.isEmbroidery
        ? 'Setiap teks Bordir maksimal 12 karakter, termasuk spasi.'
        : 'Each text object is limited to 120 characters.';
    }
    return '';
  };

  CustomizerController.prototype.validateFinishedDesigns = function () {
    var embroideryError = this.validateEmbroideryState('front');
    if (embroideryError) return embroideryError;
    var frontError = this.validateDesignSummary(this.state.frontDesignSummary, 'Front design');
    if (frontError) return frontError;
    if (this.state.hasBack) {
      embroideryError = this.validateEmbroideryState('back');
      if (embroideryError) return embroideryError;
      return this.validateDesignSummary(this.state.backDesignSummary, 'Back design');
    }
    return '';
  };

  CustomizerController.prototype.addUploadedImage = async function (event) {
    if (this.isEmbroidery) {
      event.target.value = '';
      return;
    }
    var file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try { await this.canvasEditor.addUploadedFile(file); }
    catch (error) { this.setStatus(error.message, true); }
  };

  CustomizerController.prototype.chooseFrameShape = function () {
    var self = this;
    if (!this._frameShapeDialog) {
      var dialog = document.createElement('dialog');
      dialog.className = 'customizer-frame-cropper customizer-frame-shape-dialog';
      dialog.innerHTML = [
        '<div class="customizer-frame-cropper-inner">',
        '  <div class="customizer-frame-cropper-header">',
        '    <div><h3>Choose a frame</h3><small>Frames are intentionally basic in the MVP.</small></div>',
        '    <button type="button" class="customizer-icon-button" data-frame-shape-cancel aria-label="Close">×</button>',
        '  </div>',
        '  <div class="customizer-choice-grid">',
        '    <button type="button" class="customizer-choice-card" data-frame-shape="square"><strong>□ Square</strong><span>Crop the image to a square.</span></button>',
        '    <button type="button" class="customizer-choice-card" data-frame-shape="circle"><strong>○ Circle</strong><span>Crop the image to a circle.</span></button>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.appendChild(dialog);
      this._frameShapeDialog = dialog;
    }

    return new Promise(function (resolve, reject) {
      var dialog = self._frameShapeDialog;
      function cleanup() {
        dialog.querySelectorAll('[data-frame-shape]').forEach(function (button) { button.removeEventListener('click', onPick); });
        dialog.querySelector('[data-frame-shape-cancel]').removeEventListener('click', onCancel);
        dialog.removeEventListener('cancel', onDialogCancel);
      }
      function onPick(event) {
        cleanup();
        dialog.close();
        resolve(event.currentTarget.dataset.frameShape);
      }
      function onCancel() {
        cleanup();
        dialog.close();
        reject(new DOMException('Frame selection cancelled', 'AbortError'));
      }
      function onDialogCancel(event) {
        event.preventDefault();
        onCancel();
      }
      dialog.querySelectorAll('[data-frame-shape]').forEach(function (button) { button.addEventListener('click', onPick); });
      dialog.querySelector('[data-frame-shape-cancel]').addEventListener('click', onCancel);
      dialog.addEventListener('cancel', onDialogCancel);
      dialog.showModal();
    });
  };

  CustomizerController.prototype.promptFrame = async function () {
    if (this.isEmbroidery) return;
    var self = this;
    try {
      var shape = await this.chooseFrameShape();
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        self.canvasEditor.addFrame(shape, file).catch(function (error) {
          if (error && error.name !== 'AbortError') self.setStatus(error.message, true);
        });
      }, { once: true });
      input.click();
    } catch (error) {
      if (error && error.name !== 'AbortError') this.setStatus(error.message, true);
    }
  };

  CustomizerController.prototype.editorBack = function () {
    if (this.state.editingSide === 'back') {
      if (this.isEmbroidery && this.state.backMode === 'different') this.editEmbroideryDesign();
      else if (this.state.backMode === 'different') this.renderBackZonePicker();
      else this.showStep('back-mode');
    } else {
      // A single-zone product skips the zone screen on the way forward.
      // Going back must not immediately auto-forward into the editor again.
      if (this.isEmbroidery && this.getFrontZones().length === 1) this.editEmbroideryDesign();
      else if (this.getFrontZones().length > 1) this.goToZones();
      else this.showStep('character');
    }
  };

  CustomizerController.prototype.finishCurrentEditor = function () {
    if (this.state.editingSide === 'back') this.finishBack();
    else this.finishFront();
  };

  CustomizerController.prototype.finishFront = function () {
    var embroideryError = this.validateEmbroideryState('front');
    if (embroideryError) {
      this.setStatus(embroideryError, true);
      return;
    }
    var designSummary = this.captureCurrentDesignSummary();
    var validationError = this.validateDesignSummary(designSummary, 'Front design');
    if (validationError) {
      this.setStatus(validationError, true);
      return;
    }
    var emptyZones = this.canvasEditor.getEmptyZones();
    if (emptyZones.length) {
      this.canvasEditor.setActiveZone(emptyZones[0].id);
      this.setStatus(
        this.isEmbroidery
          ? 'Tambahkan kembali desain Bordir ke ' + emptyZones.map(function (zone) { return zone.label || zone.id; }).join(', ') +
            ' atau kembali dan hapus area yang kosong.'
          : 'Add artwork to ' + emptyZones.map(function (zone) { return zone.label || zone.id; }).join(', ') +
            ' or go back and remove the empty print area.',
        true
      );
      return;
    }
    try {
      this.setStatus('');
      var id = this.state.designId;
      this.state.frontArtworks = {};
      this.state.frontZones.forEach(function (zone) {
        this.state.frontArtworks[String(zone.id)] = this.canvasEditor.exportArtwork(
          zone.id,
          'print-front-' + safeFilePart(zone.id) + '-' + id + '.png'
        );
      }, this);
      this.state.frontCompositeArtwork = this.canvasEditor.exportCompositeArtwork('front-composite-' + id + '.png');
      this.state.frontPreview = this.canvasEditor.exportPreview('preview-front-' + id + '.png');
      this.state.frontDesignSummary = designSummary;
      var finishedPreview = this.root.querySelector('[data-front-finished-preview]');
      finishedPreview.src = this.trackUrl(blobUrl(this.state.frontPreview));
      showClientWatermark(finishedPreview);

      var backAvailable = this.isBackPrintAvailable();
      this.updateBackChoice(backAvailable);
      if (backAvailable) {
        var sameBackZones = this.getSameBackZones();
        var sameBackFee = sameBackZones.reduce(function (total, zone) { return total + Number(zone.price || 0); }, 0);
        this.root.querySelector('[data-back-price-message]').textContent = this.isEmbroidery
          ? 'Salin Bordir depan ke belakang dengan biaya +' + formatCurrency(sameBackFee, this.loader.product.currency) +
            ', atau pilih posisi dan desain Bordir belakang yang berbeda.'
          : 'Copy the Front design to the Back for +' + formatCurrency(sameBackFee, this.loader.product.currency) +
            ', or choose different Back positions and pricing.';
        var backDescription = this.root.querySelector('[data-back-choice-description]');
        if (backDescription) backDescription.textContent = this.isEmbroidery
          ? 'Pilih salinan Bordir yang identik atau desain posisi belakang secara terpisah.'
          : 'Choose an identical locked copy or design selected Back positions separately.';
        this.showStep('back-choice');
      } else if (this.isBackPrintDisabled()) {
        this.root.querySelector('[data-back-price-message]').textContent = '';
        this.showStep('back-choice');
      } else {
        this.state.hasBack = false;
        this.goReview();
      }
    } catch (error) {
      this.setStatus(error.message, true);
    }
  };

  CustomizerController.prototype.chooseFrontOnly = function () {
    this.state.hasBack = false;
    this.state.backMode = null;
    this.state.backZones = [];
    this.state.backArtworks = {};
    this.state.backCompositeArtwork = null;
    this.state.backPreview = null;
    this.state.backDesignSummary = null;
    this.goReview();
  };

  CustomizerController.prototype.chooseAddBack = function () {
    if (!this.isBackPrintAvailable()) return;
    var backZones = this.getAvailableBackZones();
    var backMockup = this.mockups.get(this.state.variantId, 'back');
    if (!backZones.length) {
      this.setStatus(this.isEmbroidery
        ? 'Pilih area Bordir sebelum mendesain sisi belakang.'
        : 'A print zone must be selected before designing the back.', true);
      return;
    }
    if (!backMockup) {
      this.setStatus('Back printing is enabled but this variant has no custom.customizer_back_mockup image.', true);
      return;
    }
    this.state.hasBack = false;
    this.showStep('back-mode');
  };

  CustomizerController.prototype.startBackSame = async function () {
    if (this.isProcessing) return;
    var backZones = this.getSameBackZones();
    var missingFrontArtwork = backZones.find(function (zone) {
      return !this.state.frontArtworks[String(zone._derivedFromFrontZone)];
    }, this);
    var missingFee = backZones.find(function (zone) { return !zone.feeVariantId; });
    if (!backZones.length || missingFrontArtwork || missingFee) {
      this.setStatus('Every copied Back position needs its matching Front artwork and printing-fee variant.', true);
      return;
    }

    this.state.backMode = 'same';
    this.state.backZones = backZones;
    this.state.backArtworks = {};
    this.state.backCompositeArtwork = null;
    this.state.backPreview = null;
    this.state.backDesignSummary = null;
    this.state.hasBack = true;
    this.state.editingSide = 'back';
    this.setStatus('');
    this.setProcessing(true, 'Preparing identical Back design…', 'Copying all Front print areas to their matching Back positions.');

    try {
      backZones.forEach(function (zone) {
        var frontArtwork = this.state.frontArtworks[String(zone._derivedFromFrontZone)];
        this.state.backArtworks[String(zone.id)] = toFile(
          frontArtwork,
          'print-back-' + safeFilePart(zone._derivedFromFrontZone) + '-' + this.state.designId + '.png'
        );
      }, this);
      this.state.backDesignSummary = this.state.frontDesignSummary
        ? {
            objectTypes: this.state.frontDesignSummary.objectTypes.slice(),
            textValues: this.state.frontDesignSummary.textValues.slice()
          }
        : null;
      var loaded = await this.loadEditorSurface('back', backZones, true);
      if (!loaded) throw new Error('The identical Back preview could not be prepared. Please try again.');
      this.state.backCompositeArtwork = this.canvasEditor.exportCompositeArtwork('back-composite-' + this.state.designId + '.png');
      this.state.backPreview = this.canvasEditor.exportPreview('preview-back-' + this.state.designId + '.png');
      this.goReview();
    } catch (error) {
      this.state.hasBack = false;
      this.state.backArtworks = {};
      this.state.backCompositeArtwork = null;
      this.state.backPreview = null;
      this.state.backDesignSummary = null;
      this.showStep('back-mode');
      this.setStatus(error.message, true);
    } finally {
      this.setProcessing(false);
    }
  };

  CustomizerController.prototype.startBackDifferent = function () {
    var switchingMode = this.state.backMode !== 'different';
    this.setStatus('');
    this.state.backMode = 'different';
    this.state.hasBack = true;
    if (switchingMode) {
      this.state.backZones = [];
      this.state.backArtworks = {};
      this.state.backCompositeArtwork = null;
      this.state.backPreview = null;
      this.state.backDesignSummary = null;
      this.state.backEmbroideryText = '';
      this.state.backEmbroideryTemplateId = null;
      this.state.backEmbroideryTemplateLabel = null;
      this.state.backEmbroideryColor = null;
      this.state.backEmbroideryColorLabel = null;
      this.state.backEmbroideryArtworkBlob = null;
      this.canvasEditor.dispose();
      this._selectionBound = false;
    }
    if (this.isEmbroidery) this.openEmbroideryBuilder('back');
    else this.renderBackZonePicker();
  };

  CustomizerController.prototype.renderBackZonePicker = function () {
    var zones = this.getAvailableBackZones();
    var embroideryError = this.validateEmbroideryState('back');
    if (embroideryError) {
      this.setStatus(embroideryError, true);
      if (this.isEmbroidery) this.openEmbroideryBuilder('back');
      return;
    }
    if (this.isEmbroidery && zones.length === 1) {
      this.state.backZones = [zones[0]];
      this.openBackEditor();
      return;
    }
    var container = this.root.querySelector('[data-back-zone-options]');
    var selectedIds = new Set(this.state.backZones.map(function (zone) { return String(zone.id); }));
    var self = this;
    container.innerHTML = '';

    zones.forEach(function (zone) {
      var label = document.createElement('label');
      label.className = 'customizer-zone-option';
      var input = document.createElement('input');
      var copy = document.createElement('span');
      var title = document.createElement('strong');
      var physical = document.createElement('small');
      var price = document.createElement('span');
      input.type = self.isEmbroidery ? 'radio' : 'checkbox';
      input.name = 'customizer-back-zones-' + self.root.dataset.sectionId;
      input.value = String(zone.id);
      input.checked = selectedIds.has(String(zone.id));
      title.textContent = zone.label || zone.id;
      physical.textContent = self.zonePhysicalLabel(zone);
      price.className = 'customizer-zone-price';
      price.textContent = formatCurrency(zone.price || 0, self.loader.product.currency);
      copy.appendChild(title);
      copy.appendChild(physical);
      label.appendChild(input);
      label.appendChild(copy);
      label.appendChild(price);

      input.addEventListener('change', function () {
        if (input.checked && !self.isEmbroidery) {
          var conflict = self.state.backZones.find(function (selected) { return self.zonesOverlap(zone, selected); });
          if (conflict) {
            input.checked = false;
            self.updateBackZoneSelectionSummary(
              (zone.label || zone.id) + ' overlaps ' + (conflict.label || conflict.id) + ' and cannot be selected together.',
              true
            );
            return;
          }
        } else if (
          self.canvasEditor.canvas && self.canvasEditor.side === 'back' &&
          self.canvasEditor.hasArtwork(zone.id) &&
          !window.confirm('Remove ' + (zone.label || zone.id) + ' and its artwork from this Back design?')
        ) {
          input.checked = true;
          return;
        }

        var checked = new Set(Array.from(container.querySelectorAll('input:checked')).map(function (node) { return node.value; }));
        self.state.backZones = zones.filter(function (candidate) { return checked.has(String(candidate.id)); });
        self.state.backArtworks = {};
        self.state.backCompositeArtwork = null;
        self.state.backPreview = null;
        self.state.backDesignSummary = null;
        if (self.canvasEditor.canvas && self.canvasEditor.side === 'back') self.canvasEditor.setZones(self.state.backZones);
        self.updateBackZoneSelectionSummary();
      });
      container.appendChild(label);
    });

    this.updateBackZoneSelectionSummary();
    this.showStep('back-zone');
  };

  CustomizerController.prototype.updateBackZoneSelectionSummary = function (message, isError) {
    var summary = this.root.querySelector('[data-back-zone-selection-summary]');
    var fee = this.state.backZones.reduce(function (total, zone) { return total + Number(zone.price || 0); }, 0);
    summary.textContent = message || (this.state.backZones.length
      ? (this.isEmbroidery ? '1 area Bordir dipilih · ' : this.state.backZones.length + (this.state.backZones.length === 1 ? ' area' : ' areas') + ' selected · ') +
        formatCurrency(fee, this.loader.product.currency)
      : (this.isEmbroidery ? 'Pilih setidaknya satu area Bordir belakang.' : 'Select at least one Back print area.'));
    summary.classList.toggle('is-error', Boolean(isError));
    this.root.querySelector('[data-back-zone-continue]').disabled = this.state.backZones.length === 0;
  };

  CustomizerController.prototype.openBackEditor = async function () {
    if (!this.state.backZones.length || this.state.backMode !== 'different') return;
    this.state.hasBack = true;
    this.state.editingSide = 'back';
    this.showStep('editor');
    if (this.canvasEditor.canvas && this.canvasEditor.side === 'back' && this.canvasEditor.mockup) {
      this.canvasEditor.setZones(this.state.backZones);
      if (this.isEmbroidery && !this.canvasEditor.getEmbroideryObject()) {
        var embroidery = this.getEmbroideryState('back');
        await this.canvasEditor.replaceEmbroidery(
          embroidery.blob,
          this.embroideryObjectMeta('back'),
          null
        );
      }
      this.updateEditorLabels('back', this.canvasEditor.getActiveZone());
      this.updatePrices();
      this.renderEditorZones();
      return;
    }
    await this.loadEditorSurface('back', this.state.backZones, false);
  };

  CustomizerController.prototype.finishBack = function () {
    var embroideryError = this.validateEmbroideryState('back');
    if (embroideryError) {
      this.setStatus(embroideryError, true);
      return;
    }
    var designSummary = this.captureCurrentDesignSummary();
    var validationError = this.validateDesignSummary(designSummary, 'Back design');
    if (validationError) {
      this.setStatus(validationError, true);
      return;
    }
    var emptyZones = this.canvasEditor.getEmptyZones();
    if (emptyZones.length) {
      this.canvasEditor.setActiveZone(emptyZones[0].id);
      this.setStatus(this.isEmbroidery
        ? 'Tambahkan kembali desain ke area Bordir belakang sebelum selesai: ' + emptyZones.map(function (zone) {
            return (zone.label || zone.id).replace(/^Back\s*·\s*/, '');
          }).join(', ') + '.'
        : 'Add artwork to every back print area before finishing: ' + emptyZones.map(function (zone) {
            return (zone.label || zone.id).replace(/^Back\s*·\s*/, '');
          }).join(', ') + '.', true);
      return;
    }
    try {
      var id = this.state.designId;
      var backZones = this.state.backZones;
      this.state.backArtworks = {};
      backZones.forEach(function (zone) {
        var filePart = zone._derivedFromFrontZone || zone.id;
        this.state.backArtworks[String(zone.id)] = this.canvasEditor.exportArtwork(
          zone.id,
          'print-back-' + safeFilePart(filePart) + '-' + id + '.png'
        );
      }, this);
      this.state.backCompositeArtwork = this.canvasEditor.exportCompositeArtwork('back-composite-' + id + '.png');
      this.state.backPreview = this.canvasEditor.exportPreview('preview-back-' + id + '.png');
      this.state.backDesignSummary = designSummary;
      this.goReview();
    } catch (error) {
      this.setStatus(error.message, true);
    }
  };

  CustomizerController.prototype.goReview = function () {
    var embroideryError = this.validateEmbroideryState('front');
    if (!embroideryError && this.state.hasBack) embroideryError = this.validateEmbroideryState('back');
    if (embroideryError) {
      this.setStatus(embroideryError, true);
      return;
    }
    if (Object.keys(this.state.frontArtworks).length !== this.state.frontZones.length || !this.state.frontPreview) return;
    if (this.state.hasBack && (
      !this.state.backZones.length ||
      Object.keys(this.state.backArtworks).length !== this.state.backZones.length ||
      !this.state.backPreview
    )) return;
    this.showStep('review');
    var reviewFront = this.root.querySelector('[data-review-front]');
    reviewFront.src = this.trackUrl(blobUrl(this.state.frontPreview));
    showClientWatermark(reviewFront);
    var backWrap = this.root.querySelector('[data-review-back-wrap]');
    if (this.state.hasBack && this.state.backPreview) {
      backWrap.hidden = false;
      var reviewBack = this.root.querySelector('[data-review-back]');
      reviewBack.src = this.trackUrl(blobUrl(this.state.backPreview));
      showClientWatermark(reviewBack);
    } else {
      backWrap.hidden = true;
      this.root.querySelector('[data-review-back]').removeAttribute('src');
    }
    if (this.isEmbroidery) {
      var embroidery = this.getEmbroideryState('front');
      this.root.querySelector('[data-review-embroidery-text]').textContent = embroidery.text || '—';
      this.root.querySelector('[data-review-embroidery-template]').textContent = embroidery.templateLabel || embroidery.templateId || '—';
      this.root.querySelector('[data-review-embroidery-color]').textContent = embroidery.colorLabel || embroidery.color || '—';
    }
    this.updatePrices();
    this.setStatus('');
  };

  CustomizerController.prototype.reviewBack = function () {
    if (this.state.hasBack && this.state.backMode === 'same') this.showStep('back-mode');
    else if (this.state.hasBack && this.state.backMode === 'different') this.openBackEditor();
    else if (this.isBackPrintAvailable()) this.showStep('back-choice');
    else {
      this.state.editingSide = 'front';
      this.showStep('editor');
      this.renderEditorZones();
      this.updateEditorLabels('front', this.canvasEditor.getActiveZone());
    }
  };

  CustomizerController.prototype.addToCart = async function () {
    var button = this.root.querySelector('[data-add-to-cart]');
    if (this.isProcessing) return;
    if (!this.state.frontZones.length || !this.state.frontPreview || !this.state.frontCompositeArtwork) return;
    var validationError = this.validateFinishedDesigns();
    if (validationError) {
      this.setStatus(validationError, true);
      return;
    }
    var missingArtwork = this.state.frontZones.find(function (zone) {
      return !this.state.frontArtworks[String(zone.id)];
    }, this);
    if (missingArtwork) {
      this.setStatus('The ' + (missingArtwork.label || missingArtwork.id) + ' artwork is missing. Return to the editor and finish every selected area.', true);
      return;
    }
    var missingFeeZone = this.state.frontZones.find(function (zone) { return !zone.feeVariantId; });
    if (missingFeeZone) {
      this.setStatus('The ' + (missingFeeZone.label || missingFeeZone.id) + ' print zone has no feeVariantId. Add its hidden Shopify printing-fee variant ID to customizer.config.', true);
      return;
    }
    var backZones = this.state.hasBack ? this.state.backZones : [];
    var missingBackFeeZone = backZones.find(function (zone) { return !zone.feeVariantId; });
    if (this.state.hasBack && (!backZones.length || missingBackFeeZone)) {
      this.setStatus('Every back print area needs a Shopify printing-fee variant.', true);
      return;
    }
    var missingBackArtwork = backZones.find(function (zone) {
      return !this.state.backArtworks[String(zone.id)];
    }, this);
    if (this.state.hasBack && (missingBackArtwork || !this.state.backPreview || !this.state.backCompositeArtwork)) {
      this.setStatus('Back printing is enabled but the back design has not been finished.', true);
      return;
    }

    this.setProcessing(
      true,
      this.isEmbroidery ? 'Menambahkan produk Bordir…' : 'Adding your custom product…',
      this.isEmbroidery ? 'Mohon tunggu. Jangan tutup jendela ini.' : 'Please wait. Don’t close this window.'
    );
    this.setStatus(this.isEmbroidery
      ? 'Mengunggah desain Bordir dan menambahkan bundle ke keranjang Shopify…'
      : 'Uploading design files and adding the custom bundle to Shopify cart…');

    try {
      if (!window.CustomDesignStorage) throw new Error('Design storage is unavailable. Nothing was added to the cart.');
      await window.CustomDesignStorage.save(this.state.designId, {
        mockupFront: this.state.frontPreview,
        designFront: this.state.frontCompositeArtwork,
        mockupBack: this.state.hasBack ? this.state.backPreview : null,
        designBack: this.state.hasBack ? this.state.backCompositeArtwork : null
      });
      await this.cart.addDesignBundle({
        designId: this.state.designId,
        variantId: this.state.variantId,
        quantity: this.state.quantity,
        frontZones: this.state.frontZones,
        backZones: backZones,
        hasBack: this.state.hasBack,
        backMode: this.state.backMode,
        customizationType: this.customizationType,
        embroideryText: this.state.embroideryText,
        embroideryTemplate: this.state.embroideryTemplateId,
        embroideryTemplateLabel: this.state.embroideryTemplateLabel,
        embroideryColor: this.state.embroideryColor,
        embroideryColorLabel: this.state.embroideryColorLabel,
        previewFront: this.state.frontPreview,
        frontArtworks: this.state.frontArtworks,
        previewBack: this.state.backPreview,
        backArtworks: this.state.backArtworks
      });
      this.setStatus(
        this.isEmbroidery
          ? 'Produk Bordir ditambahkan ke keranjang. Desain final tersimpan dengan aman.'
          : 'Custom product added to cart. Your finalized design is stored securely.',
        false,
        true
      );
      document.dispatchEvent(new CustomEvent('customizer:cart-updated', { detail: { designId: this.state.designId } }));
      setTimeout(function () {
        window.location.href = ((window.Shopify && Shopify.routes && Shopify.routes.root) || '/') + 'cart';
      }, 700);
    } catch (error) {
      this.setStatus(error.message, true);
      this.setProcessing(false);
    }
  };

  CustomizerController.prototype.setProcessing = function (processing, title, message) {
    this.isProcessing = processing;
    this.root.setAttribute('aria-busy', processing ? 'true' : 'false');
    this.root.querySelector('[data-customizer-processing]').hidden = !processing;
    if (processing) {
      this.root.querySelector('[data-processing-title]').textContent = title || 'Processing your custom design…';
      this.root.querySelector('[data-processing-message]').textContent = message || 'Please wait. Don’t close this window.';
    }
    this.root.querySelector('.customizer-shell').inert = processing;
    this.root.querySelector('[data-add-to-cart]').disabled = processing;
  };

  CustomizerController.prototype.setStatus = function (message, isError, isSuccess) {
    var className = 'customizer-status' + (isError ? ' is-error' : '') + (isSuccess ? ' is-success' : '');
    this.root.querySelectorAll('[data-customizer-status], [data-editor-status]').forEach(function (node) {
      node.textContent = message || '';
      node.className = className + (node.hasAttribute('data-editor-status') ? ' customizer-editor-status' : '');
    });
  };

  CustomizerController.prototype.trackUrl = function (url) {
    this.objectUrls.push(url);
    return url;
  };

  CustomizerController.prototype.revokeObjectUrls = function () {
    this.objectUrls.forEach(function (url) {
      try { URL.revokeObjectURL(url); } catch (error) {}
    });
    this.objectUrls = [];
  };

  function initDesigner(root) {
    if (root.__customizerController) return root.__customizerController;
    try {
      root.__customizerController = new CustomizerController(root);
      return root.__customizerController;
    } catch (error) {
      console.error('[Custom Product Designer]', error);
      return null;
    }
  }

  function findController() {
    var root = document.querySelector('[data-custom-product-designer]');
    return root ? initDesigner(root) : null;
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-customizer-open]');
    if (!button) return;
    event.preventDefault();
    var controller = findController();
    if (!controller) {
      window.alert('Custom product designer section is not installed on this product template.');
      return;
    }
    try {
      var variantId = readSelectedVariantId(button);
      if (!variantId) throw new Error('Select a product variant before customizing.');
      controller.open(variantId, readQuantity(button));
    } catch (error) {
      window.alert(error.message);
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-custom-product-designer]').forEach(initDesigner);

    var params = new URL(window.location.href).searchParams;
    if (params.get('customize') !== 'true') return;

    var button = document.querySelector('[data-customizer-open]');
    if (!button) return;

    var controller = findController();
    if (!controller) return;

    try {
      var variantId = readSelectedVariantId(button);
      if (!variantId) throw new Error('Select a product variant before customizing.');
      controller.open(variantId, readQuantity(button));
    } catch (error) {
      window.alert(error.message);
    }
  });

  // Shopify theme editor can dynamically load sections.
  document.addEventListener('shopify:section:load', function (event) {
    var root = event.target.querySelector && event.target.querySelector('[data-custom-product-designer]');
    if (root) initDesigner(root);
  });

  NS.ProductConfigLoader = ProductConfigLoader;
  NS.VariantMockupManager = VariantMockupManager;
  NS.PrintZoneManager = PrintZoneManager;
  NS.CanvasEditor = CanvasEditor;
  NS.PriceCalculator = PriceCalculator;
  NS.ShopifyCartService = ShopifyCartService;
  NS.CustomizerController = CustomizerController;
})();
