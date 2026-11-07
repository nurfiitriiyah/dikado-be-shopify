(function () {
  'use strict';

  var config = window.DikadoLogoutCartConfig || {};
  var marker = 'dikadoAuthenticatedCartSession';

  if (config.authenticated) {
    try { sessionStorage.setItem(marker, '1'); } catch (_) {}
    return;
  }

  try {
    if (sessionStorage.getItem(marker) !== '1') return;
  } catch (_) {
    return;
  }

  var root = (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';
  fetch(root + 'cart/clear.js', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' }
  }).then(function (response) {
    if (!response.ok) throw new Error('Shopify cart clear failed');
    try { sessionStorage.removeItem(marker); } catch (_) {}
    window.location.reload();
  }).catch(function (error) {
    console.warn('[Logout cart] Cart will be cleared on the next page load.', error && error.message ? error.message : error);
  });
})();
