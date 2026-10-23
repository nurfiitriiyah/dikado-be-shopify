const DEFAULT_API_BASE = '/apps/dikado-address';
const REQUEST_TIMEOUT_MS = 12_000;

export function normalizeLocationOptions(payload) {
  if (!Array.isArray(payload?.data)) return [];
  return payload.data
    .map((item) => ({
      id: String(item?.id ?? '').trim(),
      name: String(item?.name ?? item?.label ?? '').trim(),
    }))
    .filter((item) => item.id && item.name);
}

export function buildCalculatePayload(values) {
  return {
    destination_district_id: Number(values.destinationDistrictId),
    weight: Number(values.weight),
    courier: String(values.courier).trim().toLowerCase(),
    price: values.price === 'highest' ? 'highest' : 'lowest',
  };
}

export function extractRates(payload) {
  const data = payload?.data;
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  const knownCollections = ['costs', 'rates', 'results', 'pricings'];
  for (const key of knownCollections) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

class RajaOngkirApi {
  constructor(basePath) {
    const url = new URL(basePath || DEFAULT_API_BASE, window.location.origin);
    console.log("basePath", basePath);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/apps/')) {
      throw new Error('Konfigurasi App Proxy tidak valid.');
    }
    this.baseUrl = url.href.replace(/\/$/, '');
  }

  async request(path, options = {}, externalSignal) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort('timeout'), REQUEST_TIMEOUT_MS);
    const abortFromExternal = () => controller.abort('cancelled');
    externalSignal?.addEventListener('abort', abortFromExternal, { once: true });

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
        },
        signal: controller.signal,
      });
      const body = await response.text();
      let payload;
      try {
        payload = body ? JSON.parse(body) : null;
      } catch {
        throw new Error('Server mengembalikan respons yang tidak valid.');
      }
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === 'string' ? payload.error : 'Permintaan ke server gagal.',
        );
      }
      if (!payload || typeof payload !== 'object') {
        throw new Error('Server mengembalikan respons kosong.');
      }
      return payload;
    } catch (error) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === 'cancelled') throw new DOMException('Cancelled', 'AbortError');
        throw new Error('Permintaan terlalu lama. Silakan coba lagi.');
      }
      if (error instanceof TypeError) throw new Error('Tidak dapat terhubung ke server.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromExternal);
    }
  }

  locations(level, parentId, signal) {
    const routes = {
      province: '/rajaongkir/provinces',
      city: `/rajaongkir/cities?province_id=${encodeURIComponent(parentId)}`,
      district: `/rajaongkir/districts?city_id=${encodeURIComponent(parentId)}`,
      subdistrict: `/rajaongkir/subdistricts?district_id=${encodeURIComponent(parentId)}`,
    };
    return this.request(routes[level], {}, signal);
  }

  calculate(payload, signal) {
    return this.request(
      '/rajaongkir/calculate',
      { method: 'POST', body: JSON.stringify(payload) },
      signal,
    );
  }
}

if (typeof HTMLElement !== 'undefined') {
  class RajaOngkirAddressTesting extends HTMLElement {
    connectedCallback() {
      if (this.initialized) return;
      this.initialized = true;
      this.controllers = new Map();
      this.api = new RajaOngkirApi(this.dataset.apiBase);
      this.selects = {
        province: this.querySelector('[data-location="province"]'),
        city: this.querySelector('[data-location="city"]'),
        district: this.querySelector('[data-location="district"]'),
        subdistrict: this.querySelector('[data-location="subdistrict"]'),
      };
      this.destinationInput = this.querySelector('[data-destination-district]');
      this.calculateForm = this.querySelector('[data-calculate-form]');
      this.calculateButton = this.querySelector('[data-calculate-button]');
      this.results = this.querySelector('[data-rate-results]');
      this.rawOutput = this.querySelector('[data-raw-output]');
      this.calculateStatus = this.querySelector('[data-calculate-status]');

      this.selects.province.addEventListener('change', () => this.onProvinceChange());
      this.selects.city.addEventListener('change', () => this.onCityChange());
      this.selects.district.addEventListener('change', () => this.onDistrictChange());
      this.selects.subdistrict.addEventListener('change', () => this.updateCalculateState());
      this.calculateForm.addEventListener('input', () => this.updateCalculateState());
      this.calculateForm.addEventListener('submit', (event) => this.onCalculate(event));

      this.loadLocations('province');
      this.updateCalculateState();
    }

    disconnectedCallback() {
      for (const controller of this.controllers.values()) controller.abort();
    }

    onProvinceChange() {
      this.resetLevels(['city', 'district', 'subdistrict']);
      if (this.selects.province.value) this.loadLocations('city', this.selects.province.value);
      this.updateCalculateState();
    }

    onCityChange() {
      this.resetLevels(['district', 'subdistrict']);
      if (this.selects.city.value) this.loadLocations('district', this.selects.city.value);
      this.updateCalculateState();
    }

    onDistrictChange() {
      this.resetLevels(['subdistrict']);
      this.destinationInput.value = this.selects.district.value;
      if (this.selects.district.value) {
        this.loadLocations('subdistrict', this.selects.district.value);
      }
      this.updateCalculateState();
    }

    resetLevels(levels) {
      for (const level of levels) {
        this.controllers.get(level)?.abort();
        this.controllers.delete(level);
        this.setSelectState(level, 'idle');
      }
      if (levels.includes('district')) this.destinationInput.value = '';
    }

    setSelectState(level, state, options = []) {
      const select = this.selects[level];
      const labels = {
        idle: `Pilih ${this.labelFor(level)}`,
        loading: 'Memuat…',
        empty: 'Data tidak tersedia',
        error: 'Gagal memuat data',
      };
      select.replaceChildren(new Option(labels[state] || labels.idle, ''));
      if (state === 'ready') {
        select.firstElementChild.textContent = `Pilih ${this.labelFor(level)}`;
        for (const item of options) {
          const option = new Option(item.name, item.id);
          option.dataset.name = item.name;
          select.append(option);
        }
      }
      select.disabled = state !== 'ready';
      select.setAttribute('aria-busy', String(state === 'loading'));
      const status = this.querySelector(`[data-location-status="${level}"]`);
      status.textContent = state === 'loading'
        ? 'Sedang memuat data.'
        : state === 'empty'
          ? 'Tidak ada pilihan yang tersedia.'
          : state === 'error'
            ? 'Data gagal dimuat. Ubah pilihan sebelumnya atau muat ulang halaman.'
            : '';
    }

    labelFor(level) {
      return { province: 'provinsi', city: 'kota/kabupaten', district: 'kecamatan', subdistrict: 'kelurahan' }[level];
    }

    async loadLocations(level, parentId) {
      this.controllers.get(level)?.abort();
      const controller = new AbortController();
      this.controllers.set(level, controller);
      this.setSelectState(level, 'loading');
      try {
        const payload = await this.api.locations(level, parentId, controller.signal);
        if (this.controllers.get(level) !== controller) return;
        const options = normalizeLocationOptions(payload);
        this.setSelectState(level, options.length ? 'ready' : 'empty', options);
      } catch (error) {
        if (error?.name !== 'AbortError' && this.controllers.get(level) === controller) {
          this.setSelectState(level, 'error');
        }
      } finally {
        if (this.controllers.get(level) === controller) this.controllers.delete(level);
      }
    }

    updateCalculateState() {
      const formData = new FormData(this.calculateForm);
      const valid = Number(this.destinationInput.value) > 0 &&
        Boolean(this.selects.subdistrict.value) &&
        Number(formData.get('weight')) > 0 &&
        String(formData.get('courier') || '').trim().length >= 2;
      this.calculateButton.disabled = !valid || this.calculateButton.getAttribute('aria-busy') === 'true';
    }

    async onCalculate(event) {
      event.preventDefault();
      if (this.calculateButton.disabled) return;

      const formData = new FormData(this.calculateForm);
      const payload = buildCalculatePayload({
        destinationDistrictId: this.destinationInput.value,
        weight: formData.get('weight'),
        courier: formData.get('courier'),
        price: formData.get('price'),
      });
      if (!Number.isSafeInteger(payload.destination_district_id) || payload.destination_district_id < 1 ||
        !Number.isSafeInteger(payload.weight) || payload.weight < 1) {
        this.showCalculateError('Periksa kembali district ID dan berat paket.');
        return;
      }

      this.controllers.get('calculate')?.abort();
      const controller = new AbortController();
      this.controllers.set('calculate', controller);
      this.setCalculateLoading(true);
      this.results.replaceChildren();
      this.rawOutput.textContent = '';

      try {
        const response = await this.api.calculate(payload, controller.signal);
        if (this.controllers.get('calculate') !== controller) return;
        this.rawOutput.textContent = JSON.stringify(response, null, 2);
        const rates = extractRates(response);
        if (!rates.length) {
          this.calculateStatus.textContent = 'Tidak ada layanan pengiriman yang ditemukan. Periksa respons mentah di bawah.';
          return;
        }
        this.calculateStatus.textContent = `${rates.length} layanan pengiriman ditemukan.`;
        for (const rate of rates) this.results.append(this.createRateCard(rate));
      } catch (error) {
        if (error?.name !== 'AbortError' && this.controllers.get('calculate') === controller) {
          this.showCalculateError(error.message || 'Gagal menghitung ongkir.');
        }
      } finally {
        if (this.controllers.get('calculate') === controller) {
          this.controllers.delete('calculate');
          this.setCalculateLoading(false);
        }
      }
    }

    setCalculateLoading(loading) {
      this.calculateButton.setAttribute('aria-busy', String(loading));
      this.calculateButton.textContent = loading ? 'Menghitung…' : 'Hitung ongkir';
      this.calculateStatus.classList.remove('rajaongkir-test__status--error');
      this.calculateStatus.textContent = loading ? 'Sedang menghitung ongkos kirim.' : '';
      this.updateCalculateState();
    }

    showCalculateError(message) {
      this.calculateStatus.classList.add('rajaongkir-test__status--error');
      this.calculateStatus.textContent = message;
    }

    createRateCard(rate) {
      const card = document.createElement('article');
      card.className = 'rajaongkir-test__rate';
      const courier = rate.name || rate.courier_name || rate.logistic_name || rate.code || 'Kurir';
      const service = rate.service || rate.service_name || rate.rate_name || 'Layanan pengiriman';
      const costDetail = Array.isArray(rate.cost) ? rate.cost[0] : null;
      const cost = costDetail?.value ?? rate.cost ?? rate.price ?? rate.final_price ?? rate.value;
      const etd = costDetail?.etd || rate.etd || rate.estimated_delivery_time || rate.duration || rate.estimation;
      const description = rate.description || rate.desc || costDetail?.note;

      const heading = document.createElement('h3');
      heading.textContent = `${courier} — ${service}`;
      const price = document.createElement('strong');
      price.textContent = Number.isFinite(Number(cost))
        ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(cost))
        : 'Harga tidak tersedia';
      card.append(heading, price);
      if (etd) card.append(this.createText(`Estimasi: ${etd}`));
      if (description) card.append(this.createText(String(description)));
      return card;
    }

    createText(value) {
      const paragraph = document.createElement('p');
      paragraph.textContent = value;
      return paragraph;
    }
  }

  if (!customElements.get('rajaongkir-address-testing')) {
    customElements.define('rajaongkir-address-testing', RajaOngkirAddressTesting);
  }
}
