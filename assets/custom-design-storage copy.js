(function () {
  'use strict';
  if (window.CustomDesignStorage) return;

  var API = '/apps/dikado-address/designs';
  var MAX_BYTES = 10 * 1024 * 1024;
  var ALLOWED_TYPES = ['image/png', 'image/webp'];

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
          var url = image.dataset.designSide === 'back' ? design.back_url : design.front_url;
          if (!url) { image.closest('[data-design-figure]')?.remove(); return; }
          image.src = url;
          var link = image.closest('a'); if (link) link.href = url;
        });
        node.removeAttribute('data-design-error');
      } catch (_) {
        node.setAttribute('data-design-error', 'true');
        var fallback = node.querySelector('[data-design-fallback]'); if (fallback) fallback.hidden = false;
      }
    }));
  }

  window.CustomDesignStorage = { save: save, get: get, list: list, validate: validate, renderPreviews: renderPreviews };
  document.addEventListener('DOMContentLoaded', function () { renderPreviews(document); });
  new MutationObserver(function (records) { records.forEach(function (record) { record.addedNodes.forEach(function (node) { if (node.nodeType === 1) renderPreviews(node); }); }); }).observe(document.documentElement, { childList: true, subtree: true });
})();
