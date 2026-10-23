(function () {
  'use strict';

  class ProductTabs extends HTMLElement {
    connectedCallback() {
      if (this.isInitialized) return;

      this.isInitialized = true;
      this.addEventListener('click', this.onClick.bind(this));
      this.initializeCollapsiblePanels();

      this.resizeObserver = new ResizeObserver(() => {
        this.initializeCollapsiblePanels();
      });
      this.resizeObserver.observe(this);
    }

    disconnectedCallback() {
      this.resizeObserver?.disconnect();
    }

    onClick(event) {
      const moreButton = event.target.closest('.dikado-product-tabs__more');

      if (moreButton) {
        this.togglePanelContent(moreButton);
        return;
      }

      const button = event.target.closest(
        '.dikado-product-tabs__button'
      );

      // Klik bukan pada tab button
      if (!button) return;

      const target = button.dataset.tab;

      // Reset semua button
      this.querySelectorAll('.dikado-product-tabs__button')
        .forEach((item) => {
          item.classList.remove('is-active');
          item.setAttribute('aria-selected', 'false');
          item.setAttribute('tabindex', '-1');
        });

      // Hide semua panel
      this.querySelectorAll('.dikado-product-tabs__panel')
        .forEach((panel) => {
          panel.hidden = true;
          panel.classList.remove('is-active');
        });

      // Aktifkan button yang diklik
      button.classList.add('is-active');
      button.setAttribute('aria-selected', 'true');
      button.removeAttribute('tabindex');

      // Cari panel berdasarkan data-tab-content
      const panel = this.querySelector(
        `[data-tab-content="${target}"]`
      );

      if (!panel) {
        console.warn('Panel not found:', target);
        return;
      }

      // Tampilkan panel
      panel.hidden = false;
      panel.classList.add('is-active');
      this.initializeCollapsiblePanels();
    }

    initializeCollapsiblePanels() {
      this.querySelectorAll('.dikado-product-tabs__panel:not([hidden])')
        .forEach((panel) => {
          const content = panel.querySelector('.dikado-product-tabs__panel-content');
          const moreButton = panel.querySelector('.dikado-product-tabs__more');

          if (!content || !moreButton) return;

          const isExpanded = content.classList.contains('is-expanded');
          content.classList.remove('is-collapsible', 'is-expanded');
          const fullHeight = content.scrollHeight;
          content.classList.add('is-collapsible');
          const collapsedHeight = content.clientHeight;
          const isOverflowing = fullHeight > collapsedHeight + 1;

          if (!isOverflowing) {
            content.classList.remove('is-collapsible');
            moreButton.setAttribute('aria-expanded', 'false');
            moreButton.querySelector('.dikado-product-tabs__more-label').textContent = 'See more';
          } else if (isExpanded) {
            content.classList.add('is-expanded');
          }

          moreButton.hidden = !isOverflowing;
        });
    }

    togglePanelContent(button) {
      const panel = button.closest('.dikado-product-tabs__panel');
      const content = panel?.querySelector('.dikado-product-tabs__panel-content');
      const label = button.querySelector('.dikado-product-tabs__more-label');

      if (!content || !label) return;

      const isExpanded = content.classList.toggle('is-expanded');
      button.setAttribute('aria-expanded', String(isExpanded));
      label.textContent = isExpanded ? 'See less' : 'See more';
    }
  }

  if (!customElements.get('dikado-product-tabs')) {
    customElements.define(
      'dikado-product-tabs',
      ProductTabs
    );
  }
})();
