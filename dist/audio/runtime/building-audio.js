const metadataLink = document.querySelector('link[rel="building-audio"]');

if (metadataLink && !globalThis.__endfieldBuildingAudio) {
  globalThis.__endfieldBuildingAudio = true;

  const metadataUrl = new URL(metadataLink.href, document.baseURI);
  const state = {
    metadata: null,
    context: null,
    gain: null,
    source: null,
    enabled: false,
    currentKey: '',
    requestToken: 0,
    buffers: new Map(),
    variantCursors: new Map(),
    suppressRestartEvent: false,
    panel: null,
    status: null,
    variant: null,
  };

  const setStatus = (message) => {
    if (state.status) state.status.textContent = message;
  };

  const stop = () => {
    state.requestToken += 1;
    if (state.source) {
      try { state.source.stop(); } catch (_) { /* already stopped */ }
      state.source.disconnect();
      state.source = null;
    }
    state.currentKey = '';
  };

  const resolveState = (clip) => {
    const candidates = state.metadata?.clipStateMap?.[clip] || [clip];
    return candidates.map((name) => state.metadata.states?.[name]).find((entry) => entry?.available) || null;
  };

  const availableVariants = (entry) => (entry?.variants || []).filter((variant) => variant.available && variant.file);

  const automaticSelection = (entry) => entry?.variantSelection?.mode === 'round-robin-on-state-entry';

  const refreshVariants = (entry, variants) => {
    const previous = state.variant.value;
    const previousEvent = state.variant.dataset.eventId;
    state.variant.replaceChildren();
    if (automaticSelection(entry)) {
      const option = document.createElement('option');
      option.value = '__auto__';
      option.textContent = '自动轮换（选择条件未确认）';
      state.variant.append(option);
    }
    variants.forEach((variant, index) => {
      const option = document.createElement('option');
      option.value = variant.key;
      option.textContent = variant.selector || `变体 ${index + 1}`;
      state.variant.append(option);
    });
    state.variant.closest('[data-audio-variant-row]').hidden = variants.length < 2;
    if (previousEvent === String(entry.eventId)
        && (previous === '__auto__' || variants.some((variant) => variant.key === previous))) {
      state.variant.value = previous;
    } else if (automaticSelection(entry)) {
      state.variant.value = '__auto__';
    }
    state.variant.dataset.eventId = String(entry.eventId);
  };

  const selectVariant = (entry, variants) => {
    if (state.variant.value !== '__auto__') {
      return variants.find((item) => item.key === state.variant.value) || variants[0];
    }
    const cursor = state.variantCursors.get(entry.eventId) || 0;
    const variant = variants[cursor % variants.length];
    state.variantCursors.set(entry.eventId, (cursor + 1) % variants.length);
    return variant;
  };

  const loadBuffer = async (variant) => {
    const url = new URL(variant.file, metadataUrl).href;
    const cached = state.buffers.has(url);
    if (!cached) {
      state.buffers.set(url, (async () => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return state.context.decodeAudioData(await response.arrayBuffer());
      })());
    }
    return [url, await state.buffers.get(url), cached];
  };

  const isPreviewPlaying = () => document.querySelector('#play-toggle')?.getAttribute('aria-pressed') !== 'false';

  const sync = async (restart = false) => {
    if (!state.enabled || !state.metadata || !state.context) return;
    if (!isPreviewPlaying()) {
      await state.context.suspend();
      setStatus('已随动画暂停');
      return;
    }
    await state.context.resume();
    const clip = document.querySelector('#clip-select')?.value || '';
    const entry = resolveState(clip);
    const variants = availableVariants(entry);
    if (entry) refreshVariants(entry, variants);
    if (!variants.length) {
      stop();
      setStatus(`片段 ${clip || '—'} 没有可用声音`);
      return;
    }
    const stateKey = `${clip}:${entry.eventId}:`;
    if (!restart && state.source && state.currentKey.startsWith(stateKey)) return;
    const variant = selectVariant(entry, variants);
    const key = `${clip}:${entry.eventId}:${variant.key}`;

    stop();
    const token = state.requestToken;
    setStatus('正在载入声音…');
    try {
      const [, buffer, cached] = await loadBuffer(variant);
      if (token !== state.requestToken || !state.enabled) return;
      if (!cached) {
        const restart = document.querySelector('#restart');
        if (restart) {
          state.suppressRestartEvent = true;
          restart.click();
        }
      }
      const source = state.context.createBufferSource();
      source.buffer = buffer;
      source.loop = Boolean(variant.loop);
      if (source.loop) {
        source.loopStart = Math.max(0, Number(variant.loopStartMs || 0) / 1000);
        source.loopEnd = Math.min(buffer.duration, Number(variant.loopEndMs || variant.durationMs || 0) / 1000 || buffer.duration);
      }
      source.connect(state.gain);
      source.start(state.context.currentTime + 0.02);
      state.source = source;
      state.currentKey = key;
      source.onended = () => {
        if (state.source === source && !source.loop) {
          state.source = null;
          state.currentKey = '';
          setStatus('声音播放完成');
        }
      };
      const uncertain = entry.variantSelection?.certainty === 'unconfirmed'
        ? ' · 变体条件未确认，自动轮换'
        : '';
      setStatus(`${clip} · 事件 ${entry.eventId}${source.loop ? ' · 独立循环' : ''}${uncertain}`);
    } catch (error) {
      if (token !== state.requestToken) return;
      state.buffers.clear();
      setStatus(`声音载入失败：${error.message}`);
    }
  };

  const createPanel = (controls) => {
    const style = document.createElement('style');
    style.textContent = `
      .building-audio-panel input[type="range"] { width:110px; }
      .building-audio-status { min-height:1.2em; }
    `;
    document.head.append(style);

    const panel = document.createElement('section');
    panel.id = 'building-audio-panel';
    panel.className = 'panel building-audio-panel';
    panel.innerHTML = `
      <h2>建筑声音</h2>
      <div class="button-row">
        <button type="button" data-audio-enable>启用声音</button>
      </div>
      <div class="control-row" data-audio-variant-row hidden>
        <label for="building-audio-variant">事件变体</label>
        <select id="building-audio-variant"></select>
      </div>
      <div class="control-row">
        <label for="building-audio-volume">音量</label>
        <input id="building-audio-volume" type="range" min="0" max="1" step="0.05" value="0.7">
      </div>
      <p class="subtle building-audio-status">浏览器要求点击后才能播放声音</p>
    `;
    const portsPanel = controls.querySelector('#effects-panel');
    const metadataPanel = controls.querySelector('#metadata-links')?.closest('.panel');
    if (portsPanel) portsPanel.insertAdjacentElement('afterend', panel);
    else if (metadataPanel) controls.insertBefore(panel, metadataPanel);
    else controls.append(panel);
    state.panel = panel;
    state.status = panel.querySelector('.building-audio-status');
    state.variant = panel.querySelector('#building-audio-variant');

    panel.querySelector('[data-audio-enable]').addEventListener('click', async (event) => {
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) {
        setStatus('此浏览器不支持 Web Audio');
        return;
      }
      if (!state.context) {
        state.context = new AudioContextClass();
        state.gain = state.context.createGain();
        state.gain.gain.value = Number(panel.querySelector('#building-audio-volume').value);
        state.gain.connect(state.context.destination);
      }
      state.enabled = !state.enabled;
      event.currentTarget.textContent = state.enabled ? '关闭声音' : '启用声音';
      if (state.enabled) await sync(true);
      else {
        stop();
        await state.context.suspend();
        setStatus('声音已关闭');
      }
    });
    state.variant.addEventListener('change', () => sync(true));
    panel.querySelector('#building-audio-volume').addEventListener('input', (event) => {
      if (state.gain && state.context) {
        state.gain.gain.setValueAtTime(Number(event.currentTarget.value), state.context.currentTime);
      }
    });
  };

  const initialize = async () => {
    try {
      const response = await fetch(metadataUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.metadata = await response.json();
    } catch (error) {
      console.warn('Building audio metadata could not be loaded.', error);
      return;
    }

    const controls = document.querySelector('.controls');
    if (!controls) return;
    createPanel(controls);
    document.addEventListener('change', (event) => {
      if (event.target?.id === 'clip-select') setTimeout(() => sync(true), 0);
    });
    document.addEventListener('click', (event) => {
      if (event.target?.id === 'play-toggle') setTimeout(() => sync(false), 0);
      if (event.target?.id === 'restart') {
        if (state.suppressRestartEvent) state.suppressRestartEvent = false;
        else setTimeout(() => sync(true), 0);
      }
    });
  };

  initialize();
}
