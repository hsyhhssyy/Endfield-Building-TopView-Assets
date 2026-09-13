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

  const refreshVariants = (variants) => {
    const previous = state.variant.value;
    state.variant.replaceChildren();
    variants.forEach((variant, index) => {
      const option = document.createElement('option');
      option.value = variant.key;
      option.textContent = variant.selector || `变体 ${index + 1}`;
      state.variant.append(option);
    });
    state.variant.hidden = variants.length < 2;
    state.variant.previousElementSibling.hidden = variants.length < 2;
    if (variants.some((variant) => variant.key === previous)) state.variant.value = previous;
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
    refreshVariants(variants);
    if (!variants.length) {
      stop();
      setStatus(`片段 ${clip || '—'} 没有可用声音`);
      return;
    }
    const variant = variants.find((item) => item.key === state.variant.value) || variants[0];
    const key = `${clip}:${entry.eventId}:${variant.key}`;
    if (!restart && key === state.currentKey && state.source) return;

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
      setStatus(`${clip} · 事件 ${entry.eventId}${source.loop ? ' · 独立循环' : ''}`);
    } catch (error) {
      if (token !== state.requestToken) return;
      state.buffers.clear();
      setStatus(`声音载入失败：${error.message}`);
    }
  };

  const createPanel = (controls) => {
    const style = document.createElement('style');
    style.textContent = `
      .building-audio-panel { display:grid; gap:8px; padding:12px; border:1px solid rgba(255,255,255,.14); border-radius:10px; background:rgba(10,18,20,.52); }
      .building-audio-panel h2 { margin:0; font-size:14px; }
      .building-audio-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
      .building-audio-row label { font-size:12px; opacity:.82; }
      .building-audio-panel button, .building-audio-panel select { min-height:32px; }
      .building-audio-panel input[type="range"] { width:110px; }
      .building-audio-status { margin:0; min-height:1.2em; font-size:12px; opacity:.72; }
    `;
    document.head.append(style);

    const panel = document.createElement('section');
    panel.className = 'building-audio-panel';
    panel.innerHTML = `
      <h2>建筑声音</h2>
      <div class="building-audio-row">
        <button type="button" data-audio-enable>启用声音</button>
        <label for="building-audio-variant" hidden>事件变体</label>
        <select id="building-audio-variant" hidden></select>
        <label for="building-audio-volume">音量</label>
        <input id="building-audio-volume" type="range" min="0" max="1" step="0.05" value="0.7">
      </div>
      <p class="building-audio-status">浏览器要求点击后才能播放声音</p>
    `;
    controls.append(panel);
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
