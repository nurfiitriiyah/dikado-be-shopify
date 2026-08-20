(function () {
  'use strict';
  if (window.CustomDesignStorage) return;

  var API = '/apps/dikado-address/designs';
  var MAX_BYTES = 10 * 1024 * 1024;
  var ALLOWED_TYPES = ['image/png', 'image/webp'];
  var WATERMARK_TEXT = 'CUSTOM PREVIEW · dikado.in';
  var downloadUrls = new WeakMap();

  function installWatermarkStyles() {
    if (document.getElementById('custom-design-watermark-styles')) return;
    var style = document.createElement('style');
    style.id = 'custom-design-watermark-styles';
    style.textContent = [
      '.custom-design-watermark-wrap{position:relative;display:block;max-width:100%;overflow:hidden;line-height:0}',
      '.custom-design-watermark-wrap>img{display:block}',
      '.custom-design-watermark-layer{position:absolute;inset:0;z-index:2;pointer-events:none;background-repeat:repeat;background-size:260px 150px;background-image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'260\' height=\'150\' viewBox=\'0 0 260 150\'%3E%3Ctext x=\'-22\' y=\'98\' transform=\'rotate(-28 130 75)\' fill=\'white\' fill-opacity=\'.58\' stroke=\'black\' stroke-opacity=\'.16\' stroke-width=\'1\' font-family=\'Arial,sans-serif\' font-size=\'22\' font-weight=\'700\'%3ECUSTOM PREVIEW %C2%B7 dikado.in%3C/text%3E%3C/svg%3E")}'
    ].join('');
    document.head.appendChild(style);
  }

  function applyWatermark(image) {
    if (!image || image.dataset.clientWatermarked === 'true') return;
    installWatermarkStyles();
    var wrapper = document.createElement('span');
    wrapper.className = 'custom-design-watermark-wrap';
    var layer = document.createElement('span');
    layer.className = 'custom-design-watermark-layer';
    layer.setAttribute('aria-hidden', 'true');
    image.parentNode.insertBefore(wrapper, image);
    wrapper.appendChild(image);
    wrapper.appendChild(layer);
    image.dataset.clientWatermarked = 'true';
  }

  async function request(path, options) {
    var response = await fetch(API + (path || ''), options || { headers: { Accept: 'application/json' } });
    var result = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(result.error || 'Design service is temporarily unavailable.');
    return result.data;
  }

  function validateImage(file, side) {
    if (!(file instanceof Blob) || ALLOWED_TYPES.indexOf(file.type) < 0) throw new Error(side + ' design must be a PNG or WebP image.');
    if (!file.size || file.size > MAX_BYTES) throw new Error(side + ' design must be no larger than 10 MB.');
  }

  async function save(designId, files) {
    files = files || {};
    validateImage(files.mockupFront, 'Front mockup');
    validateImage(files.designFront, 'Front print design');
    if (files.mockupBack) validateImage(files.mockupBack, 'Back mockup');
    if (files.designBack) validateImage(files.designBack, 'Back print design');
    if (Boolean(files.mockupBack) !== Boolean(files.designBack)) throw new Error('Back mockup and print design must both be present.');
    var byRole = {
      mockup_front: files.mockupFront,
      design_front: files.designFront,
      mockup_back: files.mockupBack,
      design_back: files.designBack
    };
    var authorization = await request('/upload-authorization', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ design_id: designId, has_back: Boolean(files.designBack) })
    });
    for (var i = 0; i < authorization.uploads.length; i += 1) {
      var upload = authorization.uploads[i];
      var file = byRole[upload.role];
      if (!file) throw new Error('The authorized ' + upload.role + ' file is missing.');
      var response = await fetch(upload.signed_url, { method: 'PUT', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file });
      if (!response.ok) throw new Error('Unable to upload ' + upload.role + '. Nothing was added to the cart.');
    }
    return request('', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ design_id: designId, has_back: Boolean(files.designBack) })
    });
  }

  function get(designId) { return request('/' + encodeURIComponent(designId)); }
  function list() { return request(''); }
  function validate(designIds) {
    if (!designIds.length) return Promise.resolve({ valid: true });
    return request('/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ design_ids: designIds })
    });
  }

  async function renderPreviews(root) {
    root = root || document;
    var nodes = Array.from(root.querySelectorAll('[data-custom-design-preview]'));
    if (root.matches && root.matches('[data-custom-design-preview]')) nodes.unshift(root);
    await Promise.all(nodes.map(async function (node) {
      try {
        var design = await get(node.dataset.customDesignPreview);
        node.querySelectorAll('[data-design-side]').forEach(function (image) {
          var side = image.dataset.designSide === 'back' ? 'back' : 'front';
          var url = side === 'back' ? design.back_url : design.front_url;
          if (!url) { image.closest('[data-design-figure]')?.remove(); return; }
          image.src = url;
          applyWatermark(image);
          var link = image.closest('a');
          if (link && link.getAttribute('href') === '#') {
            link.dataset.designDownload = side;
            downloadUrls.set(link, url);
          }
        });
        node.querySelectorAll('[data-design-download]').forEach(function (link) {
          var side = link.dataset.designDownload;
          var url = side === 'back' ? design.back_url : design.front_url;
          if (!url) {
            link.hidden = true;
            var separator = link.previousElementSibling;
            if (separator && separator.getAttribute('aria-hidden') === 'true') separator.hidden = true;
            return;
          }
          link.href = '#';
          downloadUrls.set(link, url);
        });
        node.removeAttribute('data-design-error');
      } catch (_) {
        node.setAttribute('data-design-error', 'true');
        var fallback = node.querySelector('[data-design-fallback]'); if (fallback) fallback.hidden = false;
      }
    }));
  }

  function loadBlobImage(blob) {
    return new Promise(function (resolve, reject) {
      var objectUrl = URL.createObjectURL(blob);
      var image = new Image();
      image.onload = function () { resolve({ image: image, objectUrl: objectUrl }); };
      image.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Unable to prepare the design preview.'));
      };
      image.src = objectUrl;
    });
  }

  async function addWatermarkToBlob(blob) {
    var loaded = await loadBlobImage(blob);
    try {
      var canvas = document.createElement('canvas');
      canvas.width = loaded.image.naturalWidth;
      canvas.height = loaded.image.naturalHeight;
      var context = canvas.getContext('2d');
      if (!context || !canvas.width || !canvas.height) throw new Error('Unable to prepare the design preview.');
      context.drawImage(loaded.image, 0, 0);

      var fontSize = Math.max(22, Math.round(canvas.width / 30));
      var spacingX = Math.max(260, Math.round(canvas.width * 0.3));
      var spacingY = Math.max(150, Math.round(fontSize * 4.4));
      context.font = '700 ' + fontSize + 'px Arial, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.lineWidth = Math.max(1, canvas.width / 1600);
      for (var y = -spacingY; y < canvas.height + spacingY; y += spacingY) {
        for (var x = -spacingX; x < canvas.width + spacingX; x += spacingX) {
          context.save();
          context.translate(x, y);
          context.rotate(-28 * Math.PI / 180);
          context.strokeStyle = 'rgba(0, 0, 0, 0.16)';
          context.fillStyle = 'rgba(255, 255, 255, 0.58)';
          context.strokeText(WATERMARK_TEXT, 0, 0);
          context.fillText(WATERMARK_TEXT, 0, 0);
          context.restore();
        }
      }
      return await new Promise(function (resolve, reject) {
        canvas.toBlob(function (result) {
          if (result) resolve(result);
          else reject(new Error('Unable to create the watermarked design preview.'));
        }, 'image/png');
      });
    } finally {
      URL.revokeObjectURL(loaded.objectUrl);
    }
  }

  async function downloadMockup(link) {
    var url = downloadUrls.get(link);
    if (!url) throw new Error('Design download is not ready. Please try again.');
    link.setAttribute('aria-busy', 'true');
    try {
      var response = await fetch(url);
      if (!response.ok) throw new Error('Unable to download the design preview.');
      var blob = await addWatermarkToBlob(await response.blob());
      var objectUrl = URL.createObjectURL(blob);
      var download = document.createElement('a');
      download.href = objectUrl;
      download.download = 'dikado-' + link.dataset.designDownload + '-design.png';
      document.body.appendChild(download);
      download.click();
      download.remove();
      window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
    } finally {
      link.removeAttribute('aria-busy');
    }
  }

  window.CustomDesignStorage = { save: save, get: get, list: list, validate: validate, renderPreviews: renderPreviews, applyWatermark: applyWatermark };
  document.addEventListener('click', function (event) {
    var link = event.target.closest('[data-design-download]');
    if (!link) return;
    event.preventDefault();
    downloadMockup(link).catch(function (error) {
      console.error('[Custom design] Download failed.', error);
      window.alert(error.message || 'Unable to download the design preview.');
    });
  });
  document.addEventListener('DOMContentLoaded', function () { renderPreviews(document); });
  new MutationObserver(function (records) { records.forEach(function (record) { record.addedNodes.forEach(function (node) { if (node.nodeType === 1) renderPreviews(node); }); }); }).observe(document.documentElement, { childList: true, subtree: true });
})();
