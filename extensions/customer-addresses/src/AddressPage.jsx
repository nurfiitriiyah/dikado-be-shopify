/** @jsxImportSource preact */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useState} from 'preact/hooks';

const API_BASE = 'https://bpefhxamltfxunxfvnwc.supabase.co/functions/v1/shopify-app-proxy/customer-account';

const emptyForm = {
  label: '',
  recipient_name: '',
  phone: '',
  address_line: '',
  direction: '',
  province_id: '',
  city_id: '',
  district_id: '',
  subdistrict_id: '',
  is_default: false,
};

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const [addresses, setAddresses] = useState([]);
  const [locations, setLocations] = useState({provinces: [], cities: [], districts: [], subdistricts: []});
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    Promise.all([loadAddresses(), loadLocations('provinces')])
      .catch((requestError) => setError(errorMessage(requestError)))
      .finally(() => setLoading(false));
  }, []);

  /**
   * @param {string} path
   * @param {RequestInit} [options]
   */
  async function api(path, options = {}) {
    const token = await shopify.sessionToken.get();
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const payload = /** @type {{data?: unknown[], error?: string}} */ (
      await response.json().catch(() => ({}))
    );
    if (!response.ok) throw new Error(payload.error || 'Permintaan gagal. Silakan coba lagi.');
    return payload;
  }

  async function loadAddresses() {
    const payload = await api('/addresses');
    setAddresses(Array.isArray(payload.data) ? payload.data : []);
  }

  /**
   * @param {'provinces' | 'cities' | 'districts' | 'subdistricts'} level
   * @param {string} [parentId]
   */
  async function loadLocations(level, parentId = '') {
    const query = new URLSearchParams();
    if (level === 'cities') query.set('province_id', parentId);
    if (level === 'districts') query.set('city_id', parentId);
    if (level === 'subdistricts') query.set('district_id', parentId);
    const payload = await api(`/locations/${level}${query.size ? `?${query}` : ''}`);
    const values = Array.isArray(payload.data) ? payload.data : [];
    setLocations((current) => ({...current, [level]: values}));
  }

  function setField(name, value) {
    setForm((current) => ({...current, [name]: value}));
  }

  async function onProvinceChange(event) {
    const value = eventValue(event);
    setForm((current) => ({...current, province_id: value, city_id: '', district_id: '', subdistrict_id: ''}));
    setLocations((current) => ({...current, cities: [], districts: [], subdistricts: []}));
    if (value) await loadLocations('cities', value).catch((requestError) => setError(errorMessage(requestError)));
  }

  async function onCityChange(event) {
    const value = eventValue(event);
    setForm((current) => ({...current, city_id: value, district_id: '', subdistrict_id: ''}));
    setLocations((current) => ({...current, districts: [], subdistricts: []}));
    if (value) await loadLocations('districts', value).catch((requestError) => setError(errorMessage(requestError)));
  }

  async function onDistrictChange(event) {
    const value = eventValue(event);
    setForm((current) => ({...current, district_id: value, subdistrict_id: ''}));
    setLocations((current) => ({...current, subdistricts: []}));
    if (value) await loadLocations('subdistricts', value).catch((requestError) => setError(errorMessage(requestError)));
  }

  async function onSubmit() {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await api('/addresses', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          province_id: Number(form.province_id),
          city_id: Number(form.city_id),
          district_id: Number(form.district_id),
          subdistrict_id: Number(form.subdistrict_id),
        }),
      });
      setSuccess('Alamat berhasil disimpan.');
      setForm(emptyForm);
      setLocations((current) => ({...current, cities: [], districts: [], subdistricts: []}));
      await loadAddresses();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  const complete = form.label && form.recipient_name && form.phone && form.address_line &&
    form.province_id && form.city_id && form.district_id && form.subdistrict_id;

  return (
    <s-page heading="Alamat Pengiriman" subheading="Kelola alamat Indonesia yang tervalidasi">
      <s-stack direction="block" gap="base">
        {error && <s-banner heading="Terjadi kesalahan" tone="critical">{error}</s-banner>}
        {success && <s-banner heading="Berhasil" tone="success">{success}</s-banner>}

        <s-section heading="Alamat tersimpan">
          {loading ? (
            <s-spinner accessibilityLabel="Memuat alamat" />
          ) : addresses.length ? (
            <s-stack direction="block" gap="base">
              {addresses.map((address) => (
                <s-box key={address.id} padding="base" border="base" borderRadius="base">
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-heading>{address.label}</s-heading>
                      {address.is_default && <s-badge tone="neutral">Default</s-badge>}
                    </s-stack>
                    <s-text>{address.recipient_name} · {address.phone}</s-text>
                    <s-paragraph color="subdued">
                      {address.address_line}, Kel. {address.subdistrict_name}, Kec. {address.district_name}, {address.city_name}, {address.province_name}{address.postcode ? ` ${address.postcode}` : ''}
                    </s-paragraph>
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          ) : (
            <s-paragraph color="subdued">Belum ada alamat tersimpan.</s-paragraph>
          )}
        </s-section>

        <s-section heading="Tambah alamat">
          <s-form onSubmit={() => void onSubmit()}>
            <s-stack direction="block" gap="base">
              <s-text-field label="Label alamat" value={form.label} onInput={(event) => setField('label', eventValue(event))} required />
              <s-text-field label="Nama penerima" value={form.recipient_name} onInput={(event) => setField('recipient_name', eventValue(event))} required />
              <s-phone-field label="Nomor telepon" value={form.phone} onInput={(event) => setField('phone', eventValue(event))} required />
              <s-text-area label="Alamat lengkap" value={form.address_line} onInput={(event) => setField('address_line', eventValue(event))} rows={3} required />
              <s-text-field label="Patokan (opsional)" value={form.direction} onInput={(event) => setField('direction', eventValue(event))} />

              <s-select label="Provinsi" value={form.province_id} onChange={onProvinceChange} required>
                <s-option value="">Pilih provinsi</s-option>
                {locations.provinces.map((location) => <s-option key={location.id} value={String(location.id)}>{location.name}</s-option>)}
              </s-select>
              <s-select label="Kota/Kabupaten" value={form.city_id} onChange={onCityChange} disabled={!form.province_id} required>
                <s-option value="">Pilih kota/kabupaten</s-option>
                {locations.cities.map((location) => <s-option key={location.id} value={String(location.id)}>{location.name}</s-option>)}
              </s-select>
              <s-select label="Kecamatan" value={form.district_id} onChange={onDistrictChange} disabled={!form.city_id} required>
                <s-option value="">Pilih kecamatan</s-option>
                {locations.districts.map((location) => <s-option key={location.id} value={String(location.id)}>{location.name}</s-option>)}
              </s-select>
              <s-select label="Kelurahan" value={form.subdistrict_id} onChange={(event) => setField('subdistrict_id', eventValue(event))} disabled={!form.district_id} required>
                <s-option value="">Pilih kelurahan</s-option>
                {locations.subdistricts.map((location) => <s-option key={location.id} value={String(location.id)}>{location.name}</s-option>)}
              </s-select>

              <s-checkbox label="Jadikan alamat utama" checked={form.is_default} onChange={(event) => setField('is_default', eventChecked(event))} />
              <s-button type="submit" variant="primary" loading={saving} disabled={!complete || saving}>Simpan alamat</s-button>
            </s-stack>
          </s-form>
        </s-section>
      </s-stack>
    </s-page>
  );
}

/** @param {Event} event */
function eventValue(event) {
  const field = /** @type {{value: string}} */ (event.currentTarget);
  return field.value;
}

/** @param {Event} event */
function eventChecked(event) {
  const field = /** @type {{checked: boolean}} */ (event.currentTarget);
  return field.checked;
}

/** @param {unknown} error */
function errorMessage(error) {
  return error instanceof Error ? error.message : 'Permintaan gagal. Silakan coba lagi.';
}
