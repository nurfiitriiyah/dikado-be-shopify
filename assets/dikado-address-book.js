const API = '/apps/dikado-address';
async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Permintaan gagal');
  return payload;
}

export async function getDikadoAddresses() { return (await api('/addresses')).data; }
export async function saveDikadoAddress(address, id) { return (await api(id ? `/addresses/${id}` : '/addresses', { method: id ? 'PUT' : 'POST', body: JSON.stringify(address) })).data; }
export async function deleteDikadoAddress(id) { return api(`/addresses/${id}`, { method: 'DELETE' }); }
export async function getDikadoLocations(level, parentId) { const query = new URLSearchParams({ level }); if (parentId) query.set('parent_id', parentId); return (await api(`/locations?${query}`)).data; }
export async function getDikadoQuotes(addressId, rateType) {
  const cart = await fetch('/cart.js').then((r) => r.json());
  const lines = cart.items.map((item) => ({ variant_id: item.variant_id, quantity: item.quantity }));
  return (await api('/quotes', { method: 'POST', body: JSON.stringify({ address_id: addressId, rate_type: rateType || undefined, lines }) })).data;
}
export async function selectDikadoQuote(quoteId) {
  const selected = await api(`/quotes/${quoteId}/select`, { method: 'POST', body: '{}' });
  await fetch('/cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attributes: { [selected.cart_attribute.key]: selected.cart_attribute.value } }) });
  return selected.data;
}

class DikadoAddressBook extends HTMLElement {
  async connectedCallback() { try { await this.render(); } catch (error) { this.textContent = error.message; } }
  async render() {
    const addresses = await getDikadoAddresses();
    this.innerHTML = `<div class="dikado-addresses">${addresses.map((a) => `<article><strong>${escapeHtml(a.label)}</strong><p>${escapeHtml(a.recipient_name)} · ${escapeHtml(a.phone)}<br>${escapeHtml(a.address_line)}, ${escapeHtml(a.area_name)} ${escapeHtml(a.postcode)}</p><button type="button" data-quote="${a.id}">Cek ongkir</button></article>`).join('') || '<p>Belum ada alamat. Gunakan form alamat yang diintegrasikan sesuai panduan setup.</p>'}</div><div data-result aria-live="polite"></div>`;
    this.addEventListener('click', async (event) => { const id = event.target.closest('[data-quote]')?.dataset.quote; if (!id) return; const output = this.querySelector('[data-result]'); output.textContent = 'Memuat ongkir…'; try { const quotes = await getDikadoQuotes(id); output.innerHTML = quotes.map((q) => `<button type="button" data-select="${q.id}">${escapeHtml(q.logistic_name || '')} ${escapeHtml(q.rate_name || '')} — ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: q.currency }).format(q.final_price)}</button>`).join('') || 'Tidak ada layanan tersedia.'; } catch (error) { output.textContent = error.message; } });
    this.addEventListener('click', async (event) => { const id = event.target.closest('[data-select]')?.dataset.select; if (!id) return; await selectDikadoQuote(id); this.querySelector('[data-result]').textContent = 'Ongkir dipilih dan ditautkan ke cart.'; });
  }
}
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[c]);
if (!customElements.get('dikado-address-book')) customElements.define('dikado-address-book', DikadoAddressBook);

