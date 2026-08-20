(function () {
  'use strict';

  function initRoot(root) {
    if (!root || root.dataset.bpInitialized === 'true') {
      return root && root.__bpBuilderController ? root.__bpBuilderController : null;
    }
    root.dataset.bpInitialized = 'true';

    const sectionId = root.id || `bp-builder-${Date.now()}`;
    const overlay = root.closest('[data-bp-builder-overlay]');
    let openRequest = null;
    let previousDocumentOverflow = '';
    const parseData = (selector) => {
      try {
        return JSON.parse(root.querySelector(selector)?.textContent || '[]');
      } catch (error) {
        console.error('[BP Builder] Failed parsing', selector, error);
        return [];
      }
    };

    const characters = parseData('[data-bp-characters]');
    const poses = parseData('[data-bp-poses]');
    const items = parseData('[data-bp-items]');
    const assets = parseData('[data-bp-assets]');

    const els = {
      views: [...root.querySelectorAll('[data-bp-view]')],
      characterGrid: root.querySelector('[data-bp-character-grid]'),
      continueCharacter: root.querySelector('[data-bp-continue-character]'),
      backToCharacter: root.querySelector('[data-bp-back-to-character]'),
      poseTitle: root.querySelector('[data-bp-pose-title]'),
      poseGrid: root.querySelector('[data-bp-pose-grid]'),
      startDressing: root.querySelector('[data-bp-start-dressing]'),
      backToPose: root.querySelector('[data-bp-back-to-pose]'),
      builderTitle: root.querySelector('[data-bp-builder-title]'),
      currentPose: root.querySelector('[data-bp-current-pose]'),
      changePose: root.querySelector('[data-bp-change-pose]'),
      categoryList: root.querySelector('[data-bp-category-list]'),
      libraryTitle: root.querySelector('[data-bp-library-title]'),
      itemCount: root.querySelector('[data-bp-item-count]'),
      itemGrid: root.querySelector('[data-bp-item-grid]'),
      emptyState: root.querySelector('[data-bp-empty-state]'),
      emptyCopy: root.querySelector('[data-bp-empty-copy]'),
      canvas: root.querySelector('[data-bp-canvas]'),
      baseCharacter: root.querySelector('[data-bp-base-character]'),
      stickerLayer: root.querySelector('[data-bp-sticker-layer]'),
      bubble: root.querySelector('[data-bp-bubble]'),
      undo: root.querySelector('[data-bp-undo]'),
      redo: root.querySelector('[data-bp-redo]'),
      reset: root.querySelector('[data-bp-reset]'),
      saveButtons: [...root.querySelectorAll('[data-bp-save], [data-bp-mobile-save]')]
    };

    const CATEGORY_ICON_MAP = {
      outfit: '👗',
      outfits: '👗',
      head: '🎩',
      hat: '🎩',
      hats: '🎩',
      neck: '🧣',
      scarf: '🧣',
      accessories: '✨',
      accessory: '✨',
      props: '🎁',
      prop: '🎁',
      extras: '⭐',
      extra: '⭐'
    };

    const state = {
      step: 'character',
      selectedCharacter: null,
      selectedPose: null,
      selectedCategory: null,
      stickers: [],
      activeStickerId: null,
      undoStack: [],
      redoStack: [],
      bubbleTimer: null
    };

    const normalizeCategory = (value) => String(value || 'Extras').trim();
    const keyCategory = (value) => normalizeCategory(value).toLowerCase();

    const getItemByHandle = (handle) => items.find((item) => item.handle === handle);
    const getPoseByHandle = (handle) => poses.find((pose) => pose.handle === handle);

    const escapeHtml = (value) =>
      String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

    function showView(name) {
      state.step = name;
      els.views.forEach((view) => {
        const active = view.dataset.bpView === name;
        view.hidden = !active;
        view.classList.toggle('is-active', active);
      });
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function characterCardMarkup(character) {
      const thumb = character.thumbnail
        ? `<img src="${escapeHtml(character.thumbnail)}" alt="${escapeHtml(character.name)}" loading="lazy">`
        : `<div class="bp-builder-placeholder-art" aria-hidden="true">🧸</div>`;

      return `
        <button
          type="button"
          class="bp-builder-character-card"
          data-bp-character="${escapeHtml(character.handle)}"
          aria-pressed="false"
        >
          <span class="bp-builder-selected-badge" aria-hidden="true">✓</span>
          <span class="bp-builder-character-thumb">${thumb}</span>
          <span class="bp-builder-card-name">${escapeHtml(character.name)}</span>
          <span class="bp-builder-card-meta">Tap to select</span>
        </button>
      `;
    }

    function renderCharacters() {
      if (!characters.length) {
        els.characterGrid.innerHTML = `
          <div class="bp-builder-empty-state" style="grid-column:1/-1">
            <span class="bp-builder-empty-emoji">🧸</span>
            <p>No Character metaobject entries found yet.</p>
          </div>
        `;
        return;
      }

      els.characterGrid.innerHTML = characters.map(characterCardMarkup).join('');

      els.characterGrid.querySelectorAll('[data-bp-character]').forEach((button) => {
        button.addEventListener('click', () => {
          const selected = characters.find((character) => character.handle === button.dataset.bpCharacter);
          if (!selected) return;

          const changedCharacter = state.selectedCharacter?.handle !== selected.handle;
          state.selectedCharacter = selected;

          if (changedCharacter) {
            state.selectedPose = null;
            clearStickers(false);
          }

          els.characterGrid.querySelectorAll('[data-bp-character]').forEach((card) => {
            const isSelected = card.dataset.bpCharacter === selected.handle;
            card.classList.toggle('is-selected', isSelected);
            card.setAttribute('aria-pressed', String(isSelected));
          });

          els.continueCharacter.disabled = false;
          els.continueCharacter.textContent = `Continue with ${selected.name} →`;
        });
      });
    }

    function renderPoses() {
      const character = state.selectedCharacter;
      if (!character) return;

      const available = poses.filter((pose) => pose.characterHandle === character.handle);
      els.poseTitle.textContent = `Customize your ${character.name}`;

      if (!available.length) {
        els.poseGrid.innerHTML = `
          <div class="bp-builder-empty-state" style="grid-column:1/-1">
            <span class="bp-builder-empty-emoji">🪄</span>
            <p>No poses found for ${escapeHtml(character.name)}.</p>
          </div>
        `;
        els.startDressing.disabled = true;
        els.startDressing.textContent = 'No poses available';
        return;
      }

      els.poseGrid.innerHTML = available.map((pose) => {
        const thumb = pose.thumbnail
          ? `<img src="${escapeHtml(pose.thumbnail)}" alt="${escapeHtml(pose.name)}" loading="lazy">`
          : `<div class="bp-builder-placeholder-art" aria-hidden="true">✨</div>`;

        return `
          <button
            type="button"
            class="bp-builder-pose-card ${state.selectedPose?.handle === pose.handle ? 'is-selected' : ''}"
            data-bp-pose="${escapeHtml(pose.handle)}"
            aria-pressed="${state.selectedPose?.handle === pose.handle ? 'true' : 'false'}"
          >
            <span class="bp-builder-selected-badge" aria-hidden="true">✓</span>
            <span class="bp-builder-pose-thumb">${thumb}</span>
            <span class="bp-builder-card-name">${escapeHtml(pose.name)}</span>
            <span class="bp-builder-card-meta">Choose this pose</span>
          </button>
        `;
      }).join('');

      els.poseGrid.querySelectorAll('[data-bp-pose]').forEach((button) => {
        button.addEventListener('click', () => {
          const pose = poses.find((candidate) => candidate.handle === button.dataset.bpPose);
          if (!pose) return;

          const changedPose = state.selectedPose?.handle !== pose.handle;
          state.selectedPose = pose;

          if (changedPose) clearStickers(false);

          els.poseGrid.querySelectorAll('[data-bp-pose]').forEach((card) => {
            const isSelected = card.dataset.bpPose === pose.handle;
            card.classList.toggle('is-selected', isSelected);
            card.setAttribute('aria-pressed', String(isSelected));
          });

          els.startDressing.disabled = false;
          els.startDressing.textContent = 'Start Dressing →';
        });
      });

      if (state.selectedPose && available.some((pose) => pose.handle === state.selectedPose.handle)) {
        els.startDressing.disabled = false;
        els.startDressing.textContent = 'Start Dressing →';
      } else {
        els.startDressing.disabled = true;
        els.startDressing.textContent = 'Choose a Pose first';
      }
    }

    function getAssetsForCurrentPose() {
      if (!state.selectedPose) return [];
      return assets.filter(
        (asset) =>
          asset.poseHandle === state.selectedPose.handle &&
          asset.itemHandle &&
          asset.image &&
          getItemByHandle(asset.itemHandle)
      );
    }

    function getCategoriesForCurrentPose() {
      const seen = new Map();
      getAssetsForCurrentPose().forEach((asset) => {
        const item = getItemByHandle(asset.itemHandle);
        if (!item) return;

        const display = normalizeCategory(item.category);
        const key = keyCategory(display);
        if (!seen.has(key)) seen.set(key, display);
      });
      return [...seen.values()];
    }

    function renderCategories() {
      const categories = getCategoriesForCurrentPose();

      if (!categories.length) {
        state.selectedCategory = null;
        els.categoryList.innerHTML = `<span style="color:var(--bp-muted);font-size:13px;">No categories yet.</span>`;
        renderItems();
        return;
      }

      if (!state.selectedCategory || !categories.some(
        (category) => keyCategory(category) === keyCategory(state.selectedCategory)
      )) {
        state.selectedCategory = categories[0];
      }

      els.categoryList.innerHTML = categories.map((category) => {
        const key = keyCategory(category);
        const icon = CATEGORY_ICON_MAP[key] || '✨';
        const active = key === keyCategory(state.selectedCategory);

        return `
          <button
            type="button"
            class="bp-builder-category ${active ? 'is-active' : ''}"
            data-bp-category="${escapeHtml(category)}"
          >
            <span class="bp-builder-category-icon" aria-hidden="true">${icon}</span>
            <span>${escapeHtml(category)}</span>
          </button>
        `;
      }).join('');

      els.categoryList.querySelectorAll('[data-bp-category]').forEach((button) => {
        button.addEventListener('click', () => {
          state.selectedCategory = button.dataset.bpCategory;
          renderCategories();
          renderItems();
        });
      });
    }

    function renderItems() {
      const currentAssets = getAssetsForCurrentPose();
      const categoryKey = keyCategory(state.selectedCategory);

      const compatible = currentAssets.filter((asset) => {
        const item = getItemByHandle(asset.itemHandle);
        return item && keyCategory(item.category) === categoryKey;
      });

      els.libraryTitle.textContent = state.selectedCategory || 'Stickers';
      els.itemCount.textContent = `${compatible.length} ${compatible.length === 1 ? 'item' : 'items'}`;

      if (!compatible.length) {
        els.itemGrid.innerHTML = '';
        els.emptyState.hidden = false;
        els.emptyCopy.textContent = state.selectedCategory
          ? `No ${state.selectedCategory.toLowerCase()} items for this pose yet ✨`
          : 'No items for this pose yet ✨';
        return;
      }

      els.emptyState.hidden = true;

      els.itemGrid.innerHTML = compatible.map((asset) => {
        const item = getItemByHandle(asset.itemHandle);
        const thumb = item?.thumbnail || asset.image;

        return `
          <button
            type="button"
            class="bp-builder-item-card"
            data-bp-asset="${escapeHtml(asset.handle)}"
            title="Add ${escapeHtml(item?.name || 'sticker')}"
          >
            <span class="bp-builder-item-thumb">
              <img
                src="${escapeHtml(thumb)}"
                alt="${escapeHtml(item?.name || 'Sticker')}"
                loading="lazy"
              >
            </span>
            <span class="bp-builder-item-name">${escapeHtml(item?.name || 'Sticker')}</span>
          </button>
        `;
      }).join('');

      els.itemGrid.querySelectorAll('[data-bp-asset]').forEach((button) => {
        button.addEventListener('click', () => {
          const asset = assets.find((candidate) => candidate.handle === button.dataset.bpAsset);
          if (asset) addSticker(asset);
        });
      });
    }

    function enterBuilder() {
      if (!state.selectedCharacter || !state.selectedPose) return;

      els.builderTitle.textContent = `Customize your ${state.selectedCharacter.name}`;
      els.currentPose.textContent = state.selectedPose.name;
      els.baseCharacter.src = state.selectedPose.baseImage || state.selectedPose.thumbnail || '';
      els.baseCharacter.alt = `${state.selectedCharacter.name} - ${state.selectedPose.name}`;

      state.selectedCategory = null;
      renderCategories();
      renderItems();
      renderStickers();
      showView('builder');
      showBubble();
    }

    function showBubble() {
      if (!els.bubble) return;
      window.clearTimeout(state.bubbleTimer);
      els.bubble.hidden = false;
      state.bubbleTimer = window.setTimeout(() => {
        els.bubble.hidden = true;
      }, 4200);
    }

    function hideBubble() {
      window.clearTimeout(state.bubbleTimer);
      if (els.bubble) els.bubble.hidden = true;
    }

    function cloneStickerState() {
      return state.stickers.map((sticker) => ({ ...sticker }));
    }

    function pushHistory() {
      state.undoStack.push(cloneStickerState());
      if (state.undoStack.length > 40) state.undoStack.shift();
      state.redoStack = [];
      updateHistoryControls();
    }

    function restoreSnapshot(snapshot) {
      state.stickers = snapshot.map((sticker) => ({ ...sticker }));
      state.activeStickerId = null;
      renderStickers();
      updateHistoryControls();
    }

    function updateHistoryControls() {
      els.undo.disabled = state.undoStack.length === 0;
      els.redo.disabled = state.redoStack.length === 0;
    }

    function clearStickers(withHistory = true) {
      if (withHistory && state.stickers.length) pushHistory();
      state.stickers = [];
      state.activeStickerId = null;
      renderStickers();
    }

    function addSticker(asset) {
      const item = getItemByHandle(asset.itemHandle);
      if (!item || !asset.image) return;

      pushHistory();
      hideBubble();

      const offset = (state.stickers.length % 5) * 2.8;
      const sticker = {
        instanceId: `bp-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        assetId: asset.id,
        assetHandle: asset.handle,
        itemId: item.id,
        itemHandle: item.handle,
        image: asset.image,
        name: item.name,
        x: 50 + offset,
        y: 48 + offset,
        scale: 1,
        rotation: 0
      };

      state.stickers.push(sticker);
      state.activeStickerId = sticker.instanceId;
      renderStickers();
    }

    function syncStickerSelectionUI() {
      if (!els.stickerLayer) return;

      els.stickerLayer
        .querySelectorAll('[data-bp-sticker-id]')
        .forEach((stickerNode) => {
          const isSelected =
            stickerNode.dataset.bpStickerId === state.activeStickerId;

          stickerNode.classList.toggle('is-selected', isSelected);
          stickerNode.setAttribute(
            'aria-pressed',
            isSelected ? 'true' : 'false'
          );
        });
    }

    function selectSticker(instanceId) {
      /*
        IMPORTANT:
        Do NOT call renderStickers() here.

        renderStickers() replaces the sticker DOM nodes. If we replace the
        element during pointerdown, the browser loses the element that owns
        pointer capture and drag / resize / rotate immediately stops.
      */
      state.activeStickerId = instanceId;
      syncStickerSelectionUI();
    }

    function renderStickers() {
      if (!els.stickerLayer) return;

      els.stickerLayer.innerHTML = state.stickers.map((sticker, index) => `
        <div
          class="bp-builder-sticker ${state.activeStickerId === sticker.instanceId ? 'is-selected' : ''}"
          data-bp-sticker-id="${escapeHtml(sticker.instanceId)}"
          style="
            left:${Number(sticker.x).toFixed(3)}%;
            top:${Number(sticker.y).toFixed(3)}%;
            transform:translate(-50%,-50%) rotate(${Number(sticker.rotation).toFixed(2)}deg) scale(${Number(sticker.scale).toFixed(4)});
            z-index:${10 + index};
          "
          role="button"
          tabindex="0"
          aria-pressed="${state.activeStickerId === sticker.instanceId ? 'true' : 'false'}"
          aria-label="${escapeHtml(sticker.name || 'Sticker')}"
        >
          <img src="${escapeHtml(sticker.image)}" alt="" draggable="false">

          <span class="bp-builder-sticker-outline" aria-hidden="true"></span>

          <button
            type="button"
            class="bp-builder-sticker-control bp-builder-delete-handle"
            data-bp-delete-sticker
            title="Delete sticker"
            aria-label="Delete sticker"
          >×</button>

          <button
            type="button"
            class="bp-builder-sticker-control bp-builder-rotate-handle"
            data-bp-rotate-sticker
            title="Rotate sticker"
            aria-label="Rotate sticker"
          >↻</button>

          <button
            type="button"
            class="bp-builder-sticker-control bp-builder-resize-handle"
            data-bp-resize-sticker
            title="Resize sticker"
            aria-label="Resize sticker"
          >↘</button>
        </div>
      `).join('');

      els.stickerLayer.querySelectorAll('[data-bp-sticker-id]').forEach(bindStickerEvents);
    }

    function bindStickerEvents(node) {
      const instanceId = node.dataset.bpStickerId;

      node.addEventListener('pointerdown', (event) => {
        if (event.target.closest('[data-bp-delete-sticker], [data-bp-resize-sticker], [data-bp-rotate-sticker]')) {
          return;
        }

        const sticker = state.stickers.find((candidate) => candidate.instanceId === instanceId);
        if (!sticker) return;

        event.preventDefault();
        event.stopPropagation();
        selectSticker(instanceId);
        pushHistory();

        const canvasRect = els.canvas.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const originalX = sticker.x;
        const originalY = sticker.y;

        node.setPointerCapture(event.pointerId);

        const move = (moveEvent) => {
          const dxPct = ((moveEvent.clientX - startX) / canvasRect.width) * 100;
          const dyPct = ((moveEvent.clientY - startY) / canvasRect.height) * 100;

          sticker.x = Math.min(105, Math.max(-5, originalX + dxPct));
          sticker.y = Math.min(105, Math.max(-5, originalY + dyPct));

          node.style.left = `${sticker.x}%`;
          node.style.top = `${sticker.y}%`;
        };

        const up = () => {
          node.removeEventListener('pointermove', move);
          node.removeEventListener('pointerup', up);
          node.removeEventListener('pointercancel', up);
        };

        node.addEventListener('pointermove', move);
        node.addEventListener('pointerup', up);
        node.addEventListener('pointercancel', up);
      });

      node.addEventListener('click', (event) => {
        if (!event.target.closest('button')) selectSticker(instanceId);
      });

      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectSticker(instanceId);
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && state.activeStickerId === instanceId) {
          event.preventDefault();
          deleteSticker(instanceId);
        }
      });

      const deleteButton = node.querySelector('[data-bp-delete-sticker]');
      deleteButton?.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteSticker(instanceId);
      });

      const resizeButton = node.querySelector('[data-bp-resize-sticker]');
      resizeButton?.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const sticker = state.stickers.find((candidate) => candidate.instanceId === instanceId);
        if (!sticker) return;

        selectSticker(instanceId);
        pushHistory();

        const nodeRect = node.getBoundingClientRect();
        const centerX = nodeRect.left + nodeRect.width / 2;
        const centerY = nodeRect.top + nodeRect.height / 2;
        const startDistance = Math.max(
          1,
          Math.hypot(event.clientX - centerX, event.clientY - centerY)
        );
        const startScale = sticker.scale;

        resizeButton.setPointerCapture(event.pointerId);

        const move = (moveEvent) => {
          const distance = Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY);
          sticker.scale = Math.min(4.5, Math.max(0.22, startScale * (distance / startDistance)));
          applyStickerTransform(node, sticker);
        };

        const up = () => {
          resizeButton.removeEventListener('pointermove', move);
          resizeButton.removeEventListener('pointerup', up);
          resizeButton.removeEventListener('pointercancel', up);
        };

        resizeButton.addEventListener('pointermove', move);
        resizeButton.addEventListener('pointerup', up);
        resizeButton.addEventListener('pointercancel', up);
      });

      const rotateButton = node.querySelector('[data-bp-rotate-sticker]');
      rotateButton?.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();

        const sticker = state.stickers.find((candidate) => candidate.instanceId === instanceId);
        if (!sticker) return;

        selectSticker(instanceId);
        pushHistory();

        const nodeRect = node.getBoundingClientRect();
        const centerX = nodeRect.left + nodeRect.width / 2;
        const centerY = nodeRect.top + nodeRect.height / 2;
        const startPointerAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
        const startRotation = sticker.rotation;

        rotateButton.setPointerCapture(event.pointerId);

        const move = (moveEvent) => {
          const currentPointerAngle = Math.atan2(
            moveEvent.clientY - centerY,
            moveEvent.clientX - centerX
          );
          const delta = (currentPointerAngle - startPointerAngle) * 180 / Math.PI;
          sticker.rotation = startRotation + delta;
          applyStickerTransform(node, sticker);
        };

        const up = () => {
          rotateButton.removeEventListener('pointermove', move);
          rotateButton.removeEventListener('pointerup', up);
          rotateButton.removeEventListener('pointercancel', up);
        };

        rotateButton.addEventListener('pointermove', move);
        rotateButton.addEventListener('pointerup', up);
        rotateButton.addEventListener('pointercancel', up);
      });
    }

    function applyStickerTransform(node, sticker) {
      node.style.transform =
        `translate(-50%,-50%) rotate(${sticker.rotation}deg) scale(${sticker.scale})`;
    }

    function deleteSticker(instanceId) {
      const index = state.stickers.findIndex((sticker) => sticker.instanceId === instanceId);
      if (index < 0) return;

      pushHistory();
      state.stickers.splice(index, 1);
      state.activeStickerId = null;
      renderStickers();
    }

    function undo() {
      if (!state.undoStack.length) return;
      state.redoStack.push(cloneStickerState());
      restoreSnapshot(state.undoStack.pop());
    }

    function redo() {
      if (!state.redoStack.length) return;
      state.undoStack.push(cloneStickerState());
      restoreSnapshot(state.redoStack.pop());
    }

    function reset() {
      if (!state.stickers.length) return;
      clearStickers(true);
    }

    function getSavePayload() {
      return {
        version: 1,
        savedAt: new Date().toISOString(),
        character: state.selectedCharacter
          ? {
              id: state.selectedCharacter.id,
              handle: state.selectedCharacter.handle,
              name: state.selectedCharacter.name
            }
          : null,
        pose: state.selectedPose
          ? {
              id: state.selectedPose.id,
              handle: state.selectedPose.handle,
              name: state.selectedPose.name
            }
          : null,
        stickers: state.stickers.map((sticker) => ({
          assetId: sticker.assetId,
          assetHandle: sticker.assetHandle,
          itemId: sticker.itemId,
          itemHandle: sticker.itemHandle,
          image: sticker.image,
          x: Number(sticker.x.toFixed(4)),
          y: Number(sticker.y.toFixed(4)),
          scale: Number(sticker.scale.toFixed(4)),
          rotation: Number(sticker.rotation.toFixed(3))
        }))
      };
    }

    function loadExportImage(src) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load character asset: ${src}`));
        image.src = src;
      });
    }

    function drawContain(ctx, image, x, y, width, height) {
      const ratio = Math.min(width / image.naturalWidth, height / image.naturalHeight);
      const drawWidth = image.naturalWidth * ratio;
      const drawHeight = image.naturalHeight * ratio;
      const drawX = x + (width - drawWidth) / 2;
      const drawY = y + (height - drawHeight) / 2;
      ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    }

    function trimTransparentCanvas(sourceCanvas) {
      const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
      try {
        const pixels = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
        const data = pixels.data;
        let minX = sourceCanvas.width;
        let minY = sourceCanvas.height;
        let maxX = -1;
        let maxY = -1;

        for (let y = 0; y < sourceCanvas.height; y += 1) {
          for (let x = 0; x < sourceCanvas.width; x += 1) {
            const alpha = data[(y * sourceCanvas.width + x) * 4 + 3];
            if (!alpha) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }

        if (maxX < minX || maxY < minY) return sourceCanvas;

        const padding = Math.max(12, Math.round(sourceCanvas.width * 0.015));
        minX = Math.max(0, minX - padding);
        minY = Math.max(0, minY - padding);
        maxX = Math.min(sourceCanvas.width - 1, maxX + padding);
        maxY = Math.min(sourceCanvas.height - 1, maxY + padding);

        const trimmed = document.createElement('canvas');
        trimmed.width = maxX - minX + 1;
        trimmed.height = maxY - minY + 1;
        trimmed.getContext('2d').drawImage(
          sourceCanvas,
          minX, minY, trimmed.width, trimmed.height,
          0, 0, trimmed.width, trimmed.height
        );
        return trimmed;
      } catch (error) {
        console.warn('[BP Builder] Could not trim transparent canvas; using full canvas.', error);
        return sourceCanvas;
      }
    }

    async function exportCharacterBlob() {
      if (!state.selectedPose) {
        throw new Error('Choose a character pose before finishing.');
      }

      const size = Number(root.dataset.bpExportSize || 1400);
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = size;
      exportCanvas.height = size;
      const ctx = exportCanvas.getContext('2d');

      const baseSrc = state.selectedPose.baseImage || state.selectedPose.thumbnail;
      if (!baseSrc) throw new Error('The selected pose has no base image.');

      const baseImage = await loadExportImage(baseSrc);
      const baseInset = size * 0.09;
      drawContain(ctx, baseImage, baseInset, baseInset, size * 0.82, size * 0.82);

      for (const sticker of state.stickers) {
        const stickerImage = await loadExportImage(sticker.image);
        const centerX = size * (Number(sticker.x) / 100);
        const centerY = size * (Number(sticker.y) / 100);
        const boxSize = size * 0.26;

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate((Number(sticker.rotation) || 0) * Math.PI / 180);
        ctx.scale(Number(sticker.scale) || 1, Number(sticker.scale) || 1);
        drawContain(ctx, stickerImage, -boxSize / 2, -boxSize / 2, boxSize, boxSize);
        ctx.restore();
      }

      const trimmed = trimTransparentCanvas(exportCanvas);
      return new Promise((resolve, reject) => {
        trimmed.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Unable to export the character PNG.'));
        }, 'image/png');
      });
    }

    function closeOverlay() {
      if (overlay) overlay.hidden = true;
      document.documentElement.style.overflow = previousDocumentOverflow;
    }

    function resetForOpen() {
      hideBubble();
      state.step = 'character';
      state.selectedCharacter = null;
      state.selectedPose = null;
      state.selectedCategory = null;
      state.stickers = [];
      state.activeStickerId = null;
      state.undoStack = [];
      state.redoStack = [];

      els.continueCharacter.disabled = true;
      els.continueCharacter.textContent = 'Choose a Buddy first';
      els.startDressing.disabled = true;
      els.startDressing.textContent = 'Choose a Pose first';
      els.baseCharacter.removeAttribute('src');
      els.stickerLayer.innerHTML = '';
      renderCharacters();
      updateHistoryControls();
      showView('character');
    }

    function cancelBuilder() {
      const request = openRequest;
      openRequest = null;
      closeOverlay();
      if (request) {
        request.reject(new DOMException('Character creation cancelled', 'AbortError'));
      }
    }

    function openBuilder() {
      if (openRequest) {
        return Promise.reject(new Error('Character Builder is already open.'));
      }

      resetForOpen();
      previousDocumentOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      if (overlay) {
        overlay.hidden = false;
        overlay.scrollTop = 0;
      }

      return new Promise((resolve, reject) => {
        openRequest = { resolve, reject };
      });
    }

    async function saveBuddy(button) {
      if (!state.selectedCharacter || !state.selectedPose) return;

      const original = button.textContent;
      button.textContent = 'Preparing PNG…';
      button.disabled = true;
      root.classList.add('bp-builder-exporting');

      try {
        const payload = getSavePayload();
        const blob = await exportCharacterBlob();

        root.dispatchEvent(
          new CustomEvent('bp-builder:saved', {
            bubbles: true,
            detail: {
              payload,
              blob,
              character: payload.character,
              pose: payload.pose
            }
          })
        );

        const request = openRequest;
        openRequest = null;
        closeOverlay();

        if (request) {
          request.resolve({
            blob,
            payload,
            character: payload.character,
            pose: payload.pose
          });
        }
      } catch (error) {
        console.error('[BP Builder] Export failed', error);
        button.textContent = 'Try Again';
        window.setTimeout(() => {
          button.textContent = original;
        }, 1600);
      } finally {
        root.classList.remove('bp-builder-exporting');
        button.disabled = false;
        if (button.textContent === 'Preparing PNG…') button.textContent = original;
      }
    }

    function wireStaticEvents() {
      els.continueCharacter.addEventListener('click', () => {
        if (!state.selectedCharacter) return;
        renderPoses();
        showView('pose');
      });

      els.backToCharacter.addEventListener('click', () => showView('character'));

      els.startDressing.addEventListener('click', () => {
        if (!state.selectedPose) return;
        enterBuilder();
      });

      els.backToPose.addEventListener('click', () => {
        hideBubble();
        renderPoses();
        showView('pose');
      });

      els.changePose.addEventListener('click', () => {
        hideBubble();
        renderPoses();
        showView('pose');
      });

      els.canvas.addEventListener('pointerdown', (event) => {
        if (!event.target.closest('[data-bp-sticker-id]')) {
          state.activeStickerId = null;
          syncStickerSelectionUI();
        }
      });

      els.undo.addEventListener('click', undo);
      els.redo.addEventListener('click', redo);
      els.reset.addEventListener('click', reset);

      els.saveButtons.forEach((button) => {
        button.addEventListener('click', () => saveBuddy(button));
      });

      document.addEventListener('keydown', (event) => {
        if (!root.contains(document.activeElement) && !root.matches(':hover')) return;

        const target = event.target;
        const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
        if (isTyping) return;

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          event.shiftKey ? redo() : undo();
        }

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
          event.preventDefault();
          redo();
        }

        if (
          state.activeStickerId &&
          (event.key === 'Delete' || event.key === 'Backspace')
        ) {
          event.preventDefault();
          deleteSticker(state.activeStickerId);
        }
      });
    }

    renderCharacters();
    wireStaticEvents();
    updateHistoryControls();

    if (overlay) {
      overlay.querySelectorAll('[data-bp-cancel]').forEach((button) => {
        button.addEventListener('click', cancelBuilder);
      });
    }

    const controller = {
      open: openBuilder,
      cancel: cancelBuilder,
      exportPNG: exportCharacterBlob,
      getPayload: getSavePayload,
      root
    };
    root.__bpBuilderController = controller;

    root.dispatchEvent(
      new CustomEvent('bp-builder:ready', {
        bubbles: true,
        detail: {
          characters: characters.length,
          poses: poses.length,
          items: items.length,
          assets: assets.length
        }
      })
    );

    return controller;
  }

  function initAll() {
    document.querySelectorAll('[data-bp-builder-root]').forEach(function (root) {
      initRoot(root);
    });
  }

  window.BPCharacterBuilder = window.BPCharacterBuilder || {
    open: function (options) {
      options = options || {};
      var root = options.root || document.querySelector('[data-bp-builder-root]');
      if (!root) return Promise.reject(new Error('Embedded BP Character Builder root was not found.'));
      var controller = initRoot(root);
      return controller.open().then(function (result) {
        if (typeof options.onFinish === 'function') options.onFinish(result);
        return result;
      }).catch(function (error) {
        if (error && error.name === 'AbortError' && typeof options.onCancel === 'function') {
          options.onCancel();
        }
        throw error;
      });
    },
    init: initRoot
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll, { once: true });
  } else {
    initAll();
  }
})();
