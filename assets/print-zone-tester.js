(function () {
  'use strict';

  var FABRIC_URL = 'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js';
  var LOGICAL_WIDTH = 1000;
  var MIN_ZONE_SIZE = 0.001;
  var DEFAULT_ZONE = {
    id: 'top',
    label: 'Top',
    x: 0.35,
    y: 0.2,
    width: 0.3,
    height: 0.16,
    printWidthMm: 220,
    printHeightMm: 120,
    price: 20000,
    feeVariantId: ''
  };

  function ensureFabric() {
    if (window.fabric && window.fabric.Canvas) return Promise.resolve(window.fabric);
    if (window.__customizerFabricPromise) return window.__customizerFabricPromise;
    if (window.__printZoneFabricPromise) return window.__printZoneFabricPromise;

    window.__printZoneFabricPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = FABRIC_URL;
      script.async = true;
      script.onload = function () {
        if (window.fabric && window.fabric.Canvas) resolve(window.fabric);
        else reject(new Error('Fabric.js loaded, but its Canvas API is unavailable.'));
      };
      script.onerror = function () { reject(new Error('Fabric.js could not be loaded. Check the network connection and try again.')); };
      document.head.appendChild(script);
    });

    return window.__printZoneFabricPromise;
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function finite(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function round4(value) { return Number(finite(value, 0).toFixed(4)); }
  function roundPixel(value) { return Number(finite(value, 0).toFixed(2)); }
  function safeId(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'zone';
  }
  function acceptedImage(file) {
    return file && ['image/png', 'image/jpeg', 'image/webp'].indexOf(file.type) !== -1;
  }
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('The selected image could not be read.')); };
      image.src = url;
    });
  }

  function normalizeZone(source) {
    source = source || {};
    var width = clamp(finite(source.width, DEFAULT_ZONE.width), MIN_ZONE_SIZE, 1);
    var height = clamp(finite(source.height, DEFAULT_ZONE.height), MIN_ZONE_SIZE, 1);
    var x = clamp(finite(source.x, DEFAULT_ZONE.x), 0, 1 - width);
    var y = clamp(finite(source.y, DEFAULT_ZONE.y), 0, 1 - height);
    var normalized = {
      id: String(source.id == null ? DEFAULT_ZONE.id : source.id),
      label: String(source.label == null ? DEFAULT_ZONE.label : source.label),
      x: round4(x),
      y: round4(y),
      width: round4(Math.min(width, 1 - x)),
      height: round4(Math.min(height, 1 - y)),
      printWidthMm: finite(source.printWidthMm, DEFAULT_ZONE.printWidthMm),
      printHeightMm: finite(source.printHeightMm, DEFAULT_ZONE.printHeightMm),
      price: finite(source.price, DEFAULT_ZONE.price),
      feeVariantId: String(source.feeVariantId == null ? '' : source.feeVariantId)
    };
    if (normalized.x + normalized.width > 1) normalized.width = round4(1 - normalized.x);
    if (normalized.y + normalized.height > 1) normalized.height = round4(1 - normalized.y);
    return normalized;
  }

  function publicZone(zone) {
    var normalized = normalizeZone(zone);
    return {
      id: normalized.id,
      label: normalized.label,
      x: normalized.x,
      y: normalized.y,
      width: normalized.width,
      height: normalized.height,
      printWidthMm: normalized.printWidthMm,
      printHeightMm: normalized.printHeightMm,
      price: normalized.price,
      feeVariantId: normalized.feeVariantId
    };
  }

  function PrintZoneTester() {
    return Reflect.construct(HTMLElement, [], PrintZoneTester);
  }
  PrintZoneTester.prototype = Object.create(HTMLElement.prototype);
  PrintZoneTester.prototype.constructor = PrintZoneTester;
  Object.setPrototypeOf(PrintZoneTester, HTMLElement);

  PrintZoneTester.prototype.connectedCallback = function () {
    if (this._connected) return;
    this._connected = true;
    this.canvas = null;
    this.mockup = null;
    this.mockupUrl = null;
    this.artworkUrl = null;
    this.artworkSource = null;
    this.artworkObject = null;
    this.logicalHeight = null;
    this.zoneObjects = {};
    this.labelObjects = {};
    this.guideObjects = [];
    this.resizeObserver = null;
    this.statusTimer = null;
    this.zones = [clone(DEFAULT_ZONE)];
    this.activeZoneId = DEFAULT_ZONE.id;
    this.storageKey = this.dataset.storageKey || 'dikado:print-zone-tester:v1';

    this.cacheElements();
    this.restoreState();
    this.bindEvents();
    this.renderAll();
    this.setStageState('empty', 'Upload a product mockup', 'The canvas keeps the image’s original aspect ratio and never uploads it.');
  };

  PrintZoneTester.prototype.disconnectedCallback = function () {
    this._connected = false;
    this.mockupRequest = (this.mockupRequest || 0) + 1;
    this.artworkRequest = (this.artworkRequest || 0) + 1;
    window.clearTimeout(this.statusTimer);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this._windowResize) window.removeEventListener('resize', this._windowResize);
    if (this.mockupUrl) URL.revokeObjectURL(this.mockupUrl);
    if (this.artworkUrl) URL.revokeObjectURL(this.artworkUrl);
    if (this.canvas) this.canvas.dispose();
    this.canvas = null;
  };

  PrintZoneTester.prototype.cacheElements = function () {
    this.els = {
      mockupInput: this.querySelector('[data-mockup-input]'),
      artworkInput: this.querySelector('[data-artwork-input]'),
      mockupName: this.querySelector('[data-mockup-name]'),
      artworkName: this.querySelector('[data-artwork-name]'),
      fieldsWrap: this.querySelector('[data-zone-fields]'),
      fields: Array.prototype.slice.call(this.querySelectorAll('[data-zone-field]')),
      validation: this.querySelector('[data-validation]'),
      add: this.querySelector('[data-add-zone]'),
      duplicate: this.querySelector('[data-duplicate-zone]'),
      remove: this.querySelector('[data-delete-zone]'),
      reset: this.querySelector('[data-reset]'),
      zoneList: this.querySelector('[data-zone-list]'),
      zoneCount: this.querySelector('[data-zone-count]'),
      stage: this.querySelector('[data-stage]'),
      canvasShell: this.querySelector('[data-canvas-shell]'),
      canvasEl: this.querySelector('[data-canvas]'),
      stageState: this.querySelector('[data-stage-state]'),
      stageStateTitle: this.querySelector('[data-stage-state-title]'),
      stageStateMessage: this.querySelector('[data-stage-state-message]'),
      canvasSize: this.querySelector('[data-canvas-size]'),
      activeJson: this.querySelector('[data-active-json]'),
      copyActive: this.querySelector('[data-copy-active]'),
      copyComplete: this.querySelector('[data-copy-complete]'),
      download: this.querySelector('[data-download]'),
      status: this.querySelector('[data-status]'),
      normalizedValues: Array.prototype.slice.call(this.querySelectorAll('[data-value]')),
      pixelValues: Array.prototype.slice.call(this.querySelectorAll('[data-pixel-value]'))
    };
  };

  PrintZoneTester.prototype.bindEvents = function () {
    var self = this;
    this.els.mockupInput.addEventListener('change', function (event) { self.onMockupSelected(event); });
    this.els.artworkInput.addEventListener('change', function (event) { self.onArtworkSelected(event); });
    this.els.fields.forEach(function (input) {
      input.addEventListener('input', function () { self.onFieldInput(input); });
      input.addEventListener('change', function () { self.onFieldInput(input); });
    });
    this.els.add.addEventListener('click', function () { self.addZone(); });
    this.els.duplicate.addEventListener('click', function () { self.duplicateZone(); });
    this.els.remove.addEventListener('click', function () { self.deleteZone(); });
    this.els.reset.addEventListener('click', function () { self.reset(); });
    this.els.copyActive.addEventListener('click', function () { self.copyActive(); });
    this.els.copyComplete.addEventListener('click', function () { self.copyComplete(); });
    this.els.download.addEventListener('click', function () { self.downloadConfig(); });
    this.els.stage.addEventListener('keydown', function (event) { self.onKeydown(event); });

    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(function () { self.resizeDisplay(); });
      this.resizeObserver.observe(this.els.stage);
    } else {
      this._windowResize = function () { self.resizeDisplay(); };
      window.addEventListener('resize', this._windowResize);
    }
  };

  PrintZoneTester.prototype.restoreState = function () {
    try {
      var saved = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
      if (!saved || !Array.isArray(saved.zones)) return;
      this.zones = saved.zones.map(normalizeZone);
      this.activeZoneId = this.zones.some(function (zone) { return zone.id === saved.activeZoneId; })
        ? saved.activeZoneId
        : (this.zones[0] ? this.zones[0].id : null);
      this.setStatus('Saved zone configuration restored. Re-upload the mockup to continue.', 'success', 6000);
    } catch (error) {
      this.setStatus('Saved tester state was invalid and has been ignored.', 'error', 6000);
    }
  };

  PrintZoneTester.prototype.saveState = function () {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({
        version: 1,
        activeZoneId: this.activeZoneId,
        zones: this.zones.map(publicZone)
      }));
    } catch (error) {
      this.setStatus('The browser could not save tester state locally.', 'error');
    }
  };

  PrintZoneTester.prototype.activeZone = function () {
    var activeId = this.activeZoneId;
    return this.zones.find(function (zone) { return zone.id === activeId; }) || null;
  };

  PrintZoneTester.prototype.uniqueId = function (base, ignoreId) {
    var root = safeId(base);
    var id = root;
    var index = 2;
    var used = this.zones.some(function (zone) { return zone.id === id && zone.id !== ignoreId; });
    while (used) {
      id = root + '-' + index;
      index += 1;
      used = this.zones.some(function (zone) { return zone.id === id && zone.id !== ignoreId; });
    }
    return id;
  };

  PrintZoneTester.prototype.initCanvas = async function () {
    if (this.canvas) return;
    await ensureFabric();
    this.canvas = new window.fabric.Canvas(this.els.canvasEl, {
      preserveObjectStacking: true,
      controlsAboveOverlay: true,
      selection: false,
      centeredScaling: false
    });
    var self = this;
    this.canvas.on('object:moving', function (event) { self.constrainAndSync(event.target, false); });
    this.canvas.on('object:scaling', function (event) { self.constrainAndSync(event.target, false); });
    this.canvas.on('object:modified', function (event) { self.constrainAndSync(event.target, true); });
    this.canvas.on('selection:created', function (event) { self.activateObject(event.selected && event.selected[0]); });
    this.canvas.on('selection:updated', function (event) { self.activateObject(event.selected && event.selected[0]); });
  };

  PrintZoneTester.prototype.onMockupSelected = async function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!acceptedImage(file)) {
      event.target.value = '';
      this.setStageState('error', 'Unsupported mockup format', 'Choose a PNG, JPEG, or WebP image.');
      this.setStatus('Unsupported mockup format.', 'error');
      return;
    }

    var requestId = (this.mockupRequest || 0) + 1;
    this.mockupRequest = requestId;
    var nextUrl = URL.createObjectURL(file);
    this.setStageState('loading', 'Preparing mockup…', 'Loading Fabric.js and reading the local image.');
    this.els.mockupName.textContent = file.name;
    try {
      var results = await Promise.all([ensureFabric(), loadImage(nextUrl)]);
      if (!this._connected || requestId !== this.mockupRequest) {
        URL.revokeObjectURL(nextUrl);
        return;
      }
      await this.initCanvas();
      this.els.canvasShell.hidden = false;
      this.installMockup(results[1]);
      if (this.mockupUrl) URL.revokeObjectURL(this.mockupUrl);
      this.mockupUrl = nextUrl;
      this.els.stageState.hidden = true;
      this.setStatus('Mockup ready. Drag or resize a zone to calibrate it.', 'success', 4500);
    } catch (error) {
      URL.revokeObjectURL(nextUrl);
      if (requestId !== this.mockupRequest) return;
      event.target.value = '';
      this.els.mockupName.textContent = 'No file selected';
      this.setStageState('error', 'Could not prepare the mockup', error.message || 'Choose another image and try again.');
      this.setStatus(error.message || 'Could not prepare the mockup.', 'error');
    }
  };

  PrintZoneTester.prototype.installMockup = function (image) {
    var fabric = window.fabric;
    this.logicalHeight = Math.max(1, Math.round(LOGICAL_WIDTH * image.naturalHeight / image.naturalWidth));
    this.canvas.clear();
    this.zoneObjects = {};
    this.labelObjects = {};
    this.guideObjects = [];
    this.artworkObject = null;
    this.canvas.setDimensions({ width: LOGICAL_WIDTH, height: this.logicalHeight });

    this.mockup = new fabric.Image(image, {
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
      hoverCursor: 'default',
      excludeFromExport: true,
      _pztRole: 'mockup'
    });
    this.mockup.scaleX = LOGICAL_WIDTH / this.mockup.width;
    this.mockup.scaleY = this.logicalHeight / this.mockup.height;
    this.canvas.add(this.mockup);
    this.addGuides();
    this.renderZoneObjects();
    if (this.artworkSource) this.createArtworkObject();
    this.resizeDisplay();
    this.els.canvasSize.textContent = LOGICAL_WIDTH + ' × ' + this.logicalHeight + ' logical px';
    this.renderAll();
  };

  PrintZoneTester.prototype.addGuides = function () {
    var fabric = window.fabric;
    var common = {
      stroke: 'rgba(107, 76, 146, .48)',
      strokeWidth: 1,
      strokeDashArray: [10, 8],
      selectable: false,
      evented: false,
      excludeFromExport: true,
      _pztRole: 'guide'
    };
    this.guideObjects = [
      new fabric.Line([LOGICAL_WIDTH / 2, 0, LOGICAL_WIDTH / 2, this.logicalHeight], common),
      new fabric.Line([0, this.logicalHeight / 2, LOGICAL_WIDTH, this.logicalHeight / 2], common)
    ];
    this.guideObjects.forEach(function (guide) { this.canvas.add(guide); }, this);
  };

  PrintZoneTester.prototype.renderZoneObjects = function () {
    if (!this.canvas || !this.logicalHeight) return;
    var fabric = window.fabric;
    var self = this;
    this.zones.forEach(function (zone) {
      var rect = new fabric.Rect({
        left: zone.x * LOGICAL_WIDTH,
        top: zone.y * self.logicalHeight,
        width: zone.width * LOGICAL_WIDTH,
        height: zone.height * self.logicalHeight,
        originX: 'left',
        originY: 'top',
        fill: 'rgba(142, 88, 232, .18)',
        stroke: '#7242c4',
        strokeWidth: 3,
        strokeUniform: true,
        transparentCorners: false,
        cornerColor: '#ffffff',
        cornerStrokeColor: '#6333b5',
        borderColor: '#6333b5',
        cornerSize: 14,
        padding: 0,
        lockRotation: true,
        lockScalingFlip: true,
        minScaleLimit: .001,
        objectCaching: false,
        _pztRole: 'zone',
        _zoneId: zone.id
      });
      rect.setControlsVisibility({ mtr: false });
      rect.on('mousedown', function () { self.setActiveZone(zone.id, true); });
      var label = new fabric.Text(zone.label || zone.id || 'Zone', {
        left: rect.left + 9,
        top: rect.top + 8,
        fontFamily: 'Arial, sans-serif',
        fontSize: 20,
        fontWeight: '700',
        fill: '#3d2468',
        backgroundColor: 'rgba(255,255,255,.82)',
        selectable: false,
        evented: false,
        excludeFromExport: true,
        _pztRole: 'label',
        _zoneId: zone.id
      });
      self.zoneObjects[zone.id] = rect;
      self.labelObjects[zone.id] = label;
      self.canvas.add(rect);
      self.canvas.add(label);
    });
    this.refreshActiveStyles();
    var active = this.zoneObjects[this.activeZoneId];
    if (active) this.canvas.setActiveObject(active);
    this.canvas.requestRenderAll();
  };

  PrintZoneTester.prototype.rebuildZoneObjects = function () {
    if (!this.canvas) return;
    Object.keys(this.zoneObjects).forEach(function (id) { this.canvas.remove(this.zoneObjects[id]); }, this);
    Object.keys(this.labelObjects).forEach(function (id) { this.canvas.remove(this.labelObjects[id]); }, this);
    this.zoneObjects = {};
    this.labelObjects = {};
    this.renderZoneObjects();
    this.fitArtworkToActiveZone();
  };

  PrintZoneTester.prototype.activateObject = function (object) {
    if (object && object._pztRole === 'zone') this.setActiveZone(object._zoneId, false);
  };

  PrintZoneTester.prototype.setActiveZone = function (id, selectCanvasObject) {
    if (!this.zones.some(function (zone) { return zone.id === id; })) return;
    this.activeZoneId = id;
    if (selectCanvasObject && this.canvas && this.zoneObjects[id]) this.canvas.setActiveObject(this.zoneObjects[id]);
    this.refreshActiveStyles();
    this.fitArtworkToActiveZone();
    this.renderAll();
    this.saveState();
  };

  PrintZoneTester.prototype.refreshActiveStyles = function () {
    var activeId = this.activeZoneId;
    Object.keys(this.zoneObjects).forEach(function (id) {
      var active = id === activeId;
      this.zoneObjects[id].set({
        stroke: active ? '#6333b5' : 'rgba(99, 51, 181, .65)',
        strokeWidth: active ? 4 : 2,
        strokeDashArray: active ? [12, 8] : null,
        fill: active ? 'rgba(142, 88, 232, .2)' : 'rgba(142, 88, 232, .1)'
      });
      this.labelObjects[id].set({ opacity: active ? 1 : .72 });
    }, this);
    if (this.canvas) this.canvas.requestRenderAll();
  };

  PrintZoneTester.prototype.constrainAndSync = function (object, persist) {
    if (!object || object._pztRole !== 'zone' || !this.logicalHeight) return;
    var width = Math.max(1, object.getScaledWidth());
    var height = Math.max(1, object.getScaledHeight());
    if (width > LOGICAL_WIDTH) {
      object.scaleX = LOGICAL_WIDTH / object.width;
      width = LOGICAL_WIDTH;
    }
    if (height > this.logicalHeight) {
      object.scaleY = this.logicalHeight / object.height;
      height = this.logicalHeight;
    }
    object.left = clamp(object.left, 0, LOGICAL_WIDTH - width);
    object.top = clamp(object.top, 0, this.logicalHeight - height);
    object.setCoords();

    var zone = this.zones.find(function (item) { return item.id === object._zoneId; });
    if (!zone) return;
    zone.x = object.left / LOGICAL_WIDTH;
    zone.y = object.top / this.logicalHeight;
    zone.width = width / LOGICAL_WIDTH;
    zone.height = height / this.logicalHeight;
    if (zone.x + zone.width > 1) zone.x = 1 - zone.width;
    if (zone.y + zone.height > 1) zone.y = 1 - zone.height;
    var label = this.labelObjects[zone.id];
    if (label) label.set({ left: object.left + 9, top: object.top + 8, text: zone.label || zone.id || 'Zone' });
    this.activeZoneId = zone.id;
    this.refreshActiveStyles();
    this.fitArtworkToActiveZone();
    this.renderFields();
    this.renderOutput();
    if (persist) this.saveState();
  };

  PrintZoneTester.prototype.onFieldInput = function (input) {
    var zone = this.activeZone();
    if (!zone) return;
    var key = input.dataset.zoneField;
    if (key === 'id') {
      var oldId = zone.id;
      var nextId = safeId(input.value);
      if (nextId !== input.value) input.value = nextId;
      if (this.zones.some(function (item) { return item !== zone && item.id === nextId; })) {
        this.showValidation('Zone IDs must be unique.');
        return;
      }
      this.hideValidation();
      zone.id = nextId;
      this.activeZoneId = nextId;
      if (this.zoneObjects[oldId]) {
        this.zoneObjects[nextId] = this.zoneObjects[oldId];
        delete this.zoneObjects[oldId];
        this.zoneObjects[nextId]._zoneId = nextId;
      }
      if (this.labelObjects[oldId]) {
        this.labelObjects[nextId] = this.labelObjects[oldId];
        delete this.labelObjects[oldId];
        this.labelObjects[nextId]._zoneId = nextId;
      }
    } else if (key === 'label' || key === 'feeVariantId') {
      zone[key] = input.value;
    } else {
      var value = Number(input.value);
      if (!Number.isFinite(value)) {
        this.showValidation('Enter a valid number for ' + key + '.');
        return;
      }
      this.hideValidation();
      if (key === 'x') zone.x = round4(clamp(value, 0, 1 - zone.width));
      else if (key === 'y') zone.y = round4(clamp(value, 0, 1 - zone.height));
      else if (key === 'width') zone.width = round4(clamp(value, MIN_ZONE_SIZE, 1 - zone.x));
      else if (key === 'height') zone.height = round4(clamp(value, MIN_ZONE_SIZE, 1 - zone.y));
      else if (key === 'printWidthMm' || key === 'printHeightMm' || key === 'price') zone[key] = Math.max(0, value);
    }
    this.applyZoneToObject(zone);
    this.renderAll();
    this.saveState();
  };

  PrintZoneTester.prototype.applyZoneToObject = function (zone) {
    if (!this.canvas || !this.logicalHeight) return;
    var object = this.zoneObjects[zone.id];
    if (!object) return;
    object.set({
      left: zone.x * LOGICAL_WIDTH,
      top: zone.y * this.logicalHeight,
      width: zone.width * LOGICAL_WIDTH,
      height: zone.height * this.logicalHeight,
      scaleX: 1,
      scaleY: 1
    });
    object.setCoords();
    var label = this.labelObjects[zone.id];
    if (label) label.set({ left: object.left + 9, top: object.top + 8, text: zone.label || zone.id || 'Zone' });
    this.fitArtworkToActiveZone();
    this.canvas.requestRenderAll();
  };

  PrintZoneTester.prototype.onKeydown = function (event) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(event.key) === -1) return;
    var zone = this.activeZone();
    if (!zone || !this.logicalHeight) return;
    event.preventDefault();
    var step = event.shiftKey ? 10 : 1;
    var dx = event.key === 'ArrowLeft' ? -step : (event.key === 'ArrowRight' ? step : 0);
    var dy = event.key === 'ArrowUp' ? -step : (event.key === 'ArrowDown' ? step : 0);
    var object = this.zoneObjects[zone.id];
    if (!object) return;
    object.left += dx;
    object.top += dy;
    this.constrainAndSync(object, true);
  };

  PrintZoneTester.prototype.onArtworkSelected = async function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!acceptedImage(file)) {
      event.target.value = '';
      this.setStatus('Unsupported artwork format. Choose PNG, JPEG, or WebP.', 'error');
      return;
    }
    var requestId = (this.artworkRequest || 0) + 1;
    this.artworkRequest = requestId;
    var nextUrl = URL.createObjectURL(file);
    this.els.artworkName.textContent = 'Loading ' + file.name + '…';
    try {
      var image = await loadImage(nextUrl);
      if (!this._connected || requestId !== this.artworkRequest) {
        URL.revokeObjectURL(nextUrl);
        return;
      }
      if (this.artworkUrl) URL.revokeObjectURL(this.artworkUrl);
      this.artworkUrl = nextUrl;
      this.artworkSource = image;
      this.els.artworkName.textContent = file.name;
      this.createArtworkObject();
      this.setStatus('Sample artwork added as a preview only.', 'success', 4000);
    } catch (error) {
      URL.revokeObjectURL(nextUrl);
      if (requestId !== this.artworkRequest) return;
      event.target.value = '';
      this.els.artworkName.textContent = 'No file selected';
      this.setStatus(error.message || 'Could not read the artwork.', 'error');
    }
  };

  PrintZoneTester.prototype.createArtworkObject = function () {
    if (!this.canvas || !this.artworkSource) return;
    if (this.artworkObject) this.canvas.remove(this.artworkObject);
    this.artworkObject = new window.fabric.Image(this.artworkSource, {
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
      opacity: .86,
      excludeFromExport: true,
      _pztRole: 'artwork'
    });
    this.canvas.add(this.artworkObject);
    this.canvas.moveTo(this.artworkObject, 1);
    this.fitArtworkToActiveZone();
  };

  PrintZoneTester.prototype.fitArtworkToActiveZone = function () {
    if (!this.artworkObject || !this.logicalHeight) return;
    var zone = this.activeZone();
    if (!zone) {
      this.artworkObject.visible = false;
      return;
    }
    var targetWidth = zone.width * LOGICAL_WIDTH;
    var targetHeight = zone.height * this.logicalHeight;
    var scale = Math.min(targetWidth / this.artworkObject.width, targetHeight / this.artworkObject.height);
    var width = this.artworkObject.width * scale;
    var height = this.artworkObject.height * scale;
    this.artworkObject.set({
      visible: true,
      left: zone.x * LOGICAL_WIDTH + (targetWidth - width) / 2,
      top: zone.y * this.logicalHeight + (targetHeight - height) / 2,
      scaleX: scale,
      scaleY: scale
    });
    this.artworkObject.setCoords();
    this.canvas.moveTo(this.artworkObject, 1);
    this.canvas.requestRenderAll();
  };

  PrintZoneTester.prototype.addZone = function () {
    var id = this.uniqueId('zone-' + (this.zones.length + 1));
    var zone = normalizeZone(Object.assign({}, DEFAULT_ZONE, { id: id, label: 'Zone ' + (this.zones.length + 1) }));
    this.zones.push(zone);
    this.activeZoneId = id;
    this.rebuildZoneObjects();
    this.renderAll();
    this.saveState();
  };

  PrintZoneTester.prototype.duplicateZone = function () {
    var source = this.activeZone();
    if (!source) return;
    var zone = clone(source);
    zone.id = this.uniqueId(source.id + '-copy');
    zone.label = source.label + ' copy';
    zone.x = round4(clamp(source.x + .02, 0, 1 - source.width));
    zone.y = round4(clamp(source.y + .02, 0, 1 - source.height));
    this.zones.push(zone);
    this.activeZoneId = zone.id;
    this.rebuildZoneObjects();
    this.renderAll();
    this.saveState();
  };

  PrintZoneTester.prototype.deleteZone = function () {
    var index = this.zones.findIndex(function (zone) { return zone.id === this.activeZoneId; }, this);
    if (index < 0) return;
    this.zones.splice(index, 1);
    this.activeZoneId = this.zones[Math.min(index, this.zones.length - 1)] ? this.zones[Math.min(index, this.zones.length - 1)].id : null;
    this.rebuildZoneObjects();
    this.renderAll();
    this.saveState();
  };

  PrintZoneTester.prototype.reset = function () {
    if (!window.confirm('Reset all zones and remove the local mockup and artwork previews?')) return;
    if (this.mockupUrl) URL.revokeObjectURL(this.mockupUrl);
    if (this.artworkUrl) URL.revokeObjectURL(this.artworkUrl);
    this.mockupUrl = null;
    this.artworkUrl = null;
    this.artworkSource = null;
    this.artworkObject = null;
    this.mockup = null;
    this.logicalHeight = null;
    this.zones = [clone(DEFAULT_ZONE)];
    this.activeZoneId = DEFAULT_ZONE.id;
    if (this.canvas) {
      this.canvas.clear();
      this.canvas.setDimensions({ width: LOGICAL_WIDTH, height: 1 });
    }
    this.zoneObjects = {};
    this.labelObjects = {};
    this.els.mockupInput.value = '';
    this.els.artworkInput.value = '';
    this.els.mockupName.textContent = 'No file selected';
    this.els.artworkName.textContent = 'No file selected';
    this.els.canvasShell.hidden = true;
    this.els.canvasSize.textContent = 'Waiting for mockup';
    localStorage.removeItem(this.storageKey);
    this.setStageState('empty', 'Upload a product mockup', 'The canvas keeps the image’s original aspect ratio and never uploads it.');
    this.renderAll();
    this.saveState();
    this.setStatus('Tester reset.', 'success', 3000);
  };

  PrintZoneTester.prototype.resizeDisplay = function () {
    if (!this.canvas || !this.logicalHeight || this.els.canvasShell.hidden) return;
    var available = Math.max(120, this.els.stage.clientWidth - 32);
    var displayWidth = Math.min(LOGICAL_WIDTH, available);
    var displayHeight = displayWidth * this.logicalHeight / LOGICAL_WIDTH;
    this.canvas.setDimensions({ width: displayWidth + 'px', height: displayHeight + 'px' }, { cssOnly: true });
    this.els.canvasShell.style.width = displayWidth + 'px';
    this.els.canvasShell.style.height = displayHeight + 'px';
    this.canvas.calcOffset();
    this.canvas.requestRenderAll();
  };

  PrintZoneTester.prototype.renderAll = function () {
    this.renderFields();
    this.renderZoneList();
    this.renderOutput();
    var disabled = !this.activeZone();
    this.els.duplicate.disabled = disabled;
    this.els.remove.disabled = disabled;
    this.els.copyActive.disabled = disabled;
    this.els.fieldsWrap.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  };

  PrintZoneTester.prototype.renderFields = function () {
    var zone = this.activeZone();
    this.els.fields.forEach(function (input) {
      var key = input.dataset.zoneField;
      input.disabled = !zone;
      input.value = zone ? (['x', 'y', 'width', 'height'].indexOf(key) !== -1 ? round4(zone[key]) : zone[key]) : '';
    });
  };

  PrintZoneTester.prototype.renderZoneList = function () {
    var self = this;
    this.els.zoneList.innerHTML = '';
    this.zones.forEach(function (zone) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'pzt__zone-chip' + (zone.id === self.activeZoneId ? ' is-active' : '');
      button.dataset.id = zone.id;
      button.textContent = zone.label || zone.id || 'Unnamed zone';
      button.setAttribute('aria-pressed', zone.id === self.activeZoneId ? 'true' : 'false');
      button.addEventListener('click', function () { self.setActiveZone(zone.id, true); });
      self.els.zoneList.appendChild(button);
    });
    if (!this.zones.length) {
      var empty = document.createElement('p');
      empty.className = 'pzt__status';
      empty.textContent = 'No zones yet.';
      this.els.zoneList.appendChild(empty);
    }
    this.els.zoneCount.textContent = this.zones.length + (this.zones.length === 1 ? ' zone' : ' zones');
  };

  PrintZoneTester.prototype.renderOutput = function () {
    var zone = this.activeZone();
    this.els.normalizedValues.forEach(function (node) {
      node.textContent = zone ? String(round4(zone[node.dataset.value])) : '—';
    });
    this.els.pixelValues.forEach(function (node) {
      if (!zone || !this.logicalHeight) {
        node.textContent = '—';
        return;
      }
      var key = node.dataset.pixelValue;
      var value = key === 'left' ? zone.x * LOGICAL_WIDTH
        : key === 'top' ? zone.y * this.logicalHeight
          : key === 'width' ? zone.width * LOGICAL_WIDTH
            : zone.height * this.logicalHeight;
      node.textContent = String(roundPixel(value));
    }, this);
    this.els.activeJson.textContent = zone ? JSON.stringify(publicZone(zone), null, 2) : 'No active zone.';
  };

  PrintZoneTester.prototype.completeConfig = function () {
    return {
      version: 1,
      productType: 'custom',
      surfaceMode: 'front_back',
      front: { zones: this.zones.map(publicZone) },
      back: { enabled: false, zones: [] }
    };
  };

  PrintZoneTester.prototype.copyText = async function (value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    var textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    var copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Copy was blocked by the browser.');
  };

  PrintZoneTester.prototype.copyActive = async function () {
    var zone = this.activeZone();
    if (!zone) return;
    try {
      await this.copyText(JSON.stringify(publicZone(zone), null, 2));
      this.setStatus('Active zone JSON copied.', 'success', 3000);
    } catch (error) {
      this.setStatus(error.message || 'Could not copy JSON.', 'error');
    }
  };

  PrintZoneTester.prototype.copyComplete = async function () {
    try {
      await this.copyText(JSON.stringify(this.completeConfig(), null, 2));
      this.setStatus('Complete configuration copied.', 'success', 3000);
    } catch (error) {
      this.setStatus(error.message || 'Could not copy JSON.', 'error');
    }
  };

  PrintZoneTester.prototype.downloadConfig = function () {
    try {
      var blob = new Blob([JSON.stringify(this.completeConfig(), null, 2) + '\n'], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'print-zone-config.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      this.setStatus('Configuration downloaded.', 'success', 3000);
    } catch (error) {
      this.setStatus('Could not download the configuration.', 'error');
    }
  };

  PrintZoneTester.prototype.setStageState = function (state, title, message) {
    this.els.stageState.hidden = false;
    this.els.stageState.dataset.state = state;
    this.els.stageStateTitle.textContent = title;
    this.els.stageStateMessage.textContent = message;
    if (state !== 'loading' && !this.mockup) this.els.canvasShell.hidden = true;
  };

  PrintZoneTester.prototype.setStatus = function (message, state, duration) {
    if (!this.els || !this.els.status) return;
    window.clearTimeout(this.statusTimer);
    this.els.status.textContent = message || '';
    this.els.status.dataset.state = state || '';
    if (duration) {
      var self = this;
      this.statusTimer = window.setTimeout(function () {
        self.els.status.textContent = '';
        self.els.status.dataset.state = '';
      }, duration);
    }
  };

  PrintZoneTester.prototype.showValidation = function (message) {
    this.els.validation.hidden = false;
    this.els.validation.textContent = message;
  };
  PrintZoneTester.prototype.hideValidation = function () {
    this.els.validation.hidden = true;
    this.els.validation.textContent = '';
  };

  if (!customElements.get('print-zone-tester')) customElements.define('print-zone-tester', PrintZoneTester);
}());
