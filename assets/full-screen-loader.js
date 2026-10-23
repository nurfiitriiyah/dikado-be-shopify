(function () {
  'use strict';

  class FullScreenLoader extends HTMLElement {
    connectedCallback() {
      if (this.initialized) return;
      this.initialized = true;
      this.spinner = this.querySelector('[data-full-screen-spinner]');
      this.heading = this.querySelector('[data-full-screen-heading]');
      this.message = this.querySelector('[data-full-screen-message]');
      this.retryButton = this.querySelector('[data-full-screen-retry]');
      this.retryButton?.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('full-screen-loader:retry', { bubbles: true }));
      });
    }

    showLoading(message, description) {
      this.hidden = false;
      this.setAttribute('role', 'status');
      this.setAttribute('aria-live', 'polite');
      this.setAttribute('aria-busy', 'true');
      if (this.spinner) this.spinner.hidden = false;
      if (this.heading) this.heading.textContent = message || this.dataset.loadingText || 'Memuat halaman…';
      if (this.message) {
        this.message.textContent = description || this.dataset.loadingDescription || 'Sebentar ya, kita siapin semuanya dulu ✨';
        this.message.hidden = false;
      }
      if (this.retryButton) this.retryButton.hidden = true;
    }

    showError(message) {
      this.hidden = false;
      this.setAttribute('role', 'alert');
      this.setAttribute('aria-live', 'assertive');
      this.setAttribute('aria-busy', 'false');
      if (this.spinner) this.spinner.hidden = true;
      if (this.heading) this.heading.textContent = 'Halaman belum dapat dimuat';
      if (this.message) {
        this.message.textContent = message || 'Terjadi kendala saat mengambil data. Silakan coba lagi.';
        this.message.hidden = false;
      }
      if (this.retryButton) {
        this.retryButton.hidden = false;
        this.retryButton.focus();
      }
    }

    hide() {
      this.hidden = true;
      this.setAttribute('aria-busy', 'false');
    }
  }

  window.FullScreenLoader = FullScreenLoader;
  if (!customElements.get('full-screen-loader')) customElements.define('full-screen-loader', FullScreenLoader);
}());
