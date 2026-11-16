/**
 * Records requests this document can see.
 * Resource timing supplies transferSize and decodedBodySize.
 * Cache Storage hits never become requests, so they are not invented here.
 */

export function formatBytes(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return 'n/a';
  const sign = bytes < 0 ? '-' : '';
  const n = Math.abs(bytes);
  if (n < 1000) return `${sign}${Math.round(n)} B`;
  if (n < 1e6) return `${sign}${(n / 1e3).toFixed(1)} KB`;
  return `${sign}${(n / 1e6).toFixed(1)} MB`;
}

export function requestMatchesFile(url, file) {
  if (!url || !file) return false;
  try {
    const path = decodeURIComponent(new URL(url, 'https://example.invalid').pathname);
    return path.endsWith(`/${file}`) || path.endsWith(file);
  } catch {
    return String(url).includes(file);
  }
}

function absoluteURL(url) {
  try {
    const base = globalThis.location?.href || 'https://example.invalid/';
    const parsed = new URL(url, base);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return String(url || '');
  }
}

function headerLength(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function resourceFromEntry(entry) {
  const cached =
    entry.deliveryType === 'cache' ||
    (entry.transferSize === 0 && entry.decodedBodySize > 0);
  const exposed = entry.transferSize > 0 || entry.decodedBodySize > 0 || cached;
  return {
    via: entry.entryType === 'navigation' ? 'navigation' : 'resource',
    state: 'end',
    method: 'GET',
    url: entry.name,
    started: Math.round(performance.timeOrigin + entry.startTime),
    ended: Math.round(performance.timeOrigin + (entry.responseEnd || entry.startTime)),
    transferBytes: exposed ? entry.transferSize : null,
    decodedBytes: exposed ? entry.decodedBodySize : null,
    cached: exposed ? cached : null,
    status: entry.responseStatus || null,
    phaseRank: 1,
  };
}

export function createLedger() {
  const rows = [];
  const marks = [{ phase: 'page', at: 0 }];
  let notify = () => {};
  let scheduled = false;

  function phaseAt(epoch) {
    let phase = 'page';
    for (const mark of marks) {
      if (epoch >= mark.at) phase = mark.phase;
    }
    return phase;
  }

  function setPhase(phase) {
    marks.push({ phase, at: Date.now() });
  }

  function overlaps(row, event) {
    const left = [row.url, row.responseURL].filter(Boolean).map(absoluteURL);
    const right = [event.url, event.responseURL].filter(Boolean).map(absoluteURL);
    return right.some((url) => left.includes(url));
  }

  function findMatch(event) {
    const started = event.started || Date.now();
    for (const row of rows) {
      if (!overlaps(row, event)) continue;
      const sameVia = row.via.includes(event.via);
      if (event.state === 'start' && sameVia && row.state === 'in-flight') continue;
      if (
        event.state === 'start' &&
        sameVia &&
        row.endedAt &&
        started > row.endedAt + 40
      ) {
        continue;
      }
      if (row.state === 'in-flight') return row;
      if (Math.abs(row.startedAt - started) < 20000) return row;
    }
    return null;
  }

  function apply(row, event) {
    if (!row.via.includes(event.via)) row.via.push(event.via);
    if (event.method) row.method = event.method;
    if (event.responseURL) row.responseURL = absoluteURL(event.responseURL);
    if (event.status != null) row.status = event.status;
    if (event.contentType) row.contentType = event.contentType;
    if (event.declaredBytes != null) row.declaredBytes = event.declaredBytes;
    if (event.transferBytes != null) row.transferBytes = event.transferBytes;
    if (event.decodedBytes != null) row.decodedBytes = event.decodedBytes;
    if (event.cached != null) row.cached = event.cached;
    if (event.error) row.error = event.error;
    if ((event.phaseRank || 0) >= (row.phaseRank || 0) && event.phase) {
      row.phase = event.phase;
      row.phaseRank = event.phaseRank;
    }
    if (event.state === 'end' || event.state === 'error' || event.state === 'info') {
      row.state = event.state === 'error' ? 'error' : 'done';
      row.endedAt = event.ended || Date.now();
    }
  }

  function create(event) {
    const started = event.started || Date.now();
    const url = absoluteURL(event.url);
    return {
      url,
      responseURL: event.responseURL ? absoluteURL(event.responseURL) : '',
      method: event.method || 'GET',
      via: [event.via],
      phase: event.phase || phaseAt(started),
      phaseRank: event.phaseRank || 1,
      state: event.state === 'start' ? 'in-flight' : event.state === 'error' ? 'error' : 'done',
      startedAt: started,
      endedAt: event.ended || (event.state === 'start' ? null : started),
      status: event.status ?? null,
      contentType: event.contentType || '',
      declaredBytes: event.declaredBytes ?? null,
      transferBytes: event.transferBytes ?? null,
      decodedBytes: event.decodedBytes ?? null,
      cached: event.cached ?? null,
      error: event.error || '',
    };
  }

  function fold() {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (!overlaps(rows[i], rows[j])) continue;
        if (Math.abs(rows[i].startedAt - rows[j].startedAt) >= 20000) continue;
        const sameSingleVia =
          rows[i].via.length === 1 &&
          rows[j].via.length === 1 &&
          rows[i].via[0] === rows[j].via[0] &&
          rows[i].via[0] !== 'resource';
        if (sameSingleVia && Math.abs(rows[i].startedAt - rows[j].startedAt) > 250) continue;
        apply(rows[i], {
          via: rows[j].via[0],
          method: rows[j].method,
          url: rows[j].url,
          responseURL: rows[j].responseURL,
          status: rows[j].status,
          contentType: rows[j].contentType,
          declaredBytes: rows[j].declaredBytes,
          transferBytes: rows[j].transferBytes,
          decodedBytes: rows[j].decodedBytes,
          cached: rows[j].cached,
          error: rows[j].error,
          phase: rows[j].phase,
          phaseRank: rows[j].phaseRank,
          state: rows[j].state === 'in-flight' ? 'start' : 'end',
          started: rows[j].startedAt,
          ended: rows[j].endedAt,
        });
        for (const via of rows[j].via) {
          if (!rows[i].via.includes(via)) rows[i].via.push(via);
        }
        rows[i].startedAt = Math.min(rows[i].startedAt, rows[j].startedAt);
        rows.splice(j, 1);
        j--;
      }
    }
  }

  function absorb(event) {
    if (!event || !event.url) return;
    const match = findMatch(event);
    if (match) apply(match, event);
    else rows.push(create(event));
    fold();
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        notify();
      });
    }
  }

  return {
    rows,
    absorb,
    setPhase,
    phaseAt,
    onChange(fn) {
      notify = fn;
    },
  };
}

export function installNetworkHooks(onEvent, getPhase) {
  const root = globalThis;
  if (root.__exoNetHooks) return;
  root.__exoNetHooks = true;
  const phaseOf = () => {
    try {
      return getPhase ? getPhase() : undefined;
    } catch {
      return undefined;
    }
  };

  if (typeof root.fetch === 'function') {
    const origFetch = root.fetch.bind(root);
    root.fetch = async function (input, init) {
      const method = (
        init?.method ||
        (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      const raw =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input?.url || String(input);
      const started = Date.now();
      const phase = phaseOf();
      onEvent({
        via: 'fetch',
        state: 'start',
        method,
        url: raw,
        started,
        phase,
        phaseRank: phase ? 3 : undefined,
      });
      try {
        const response = await origFetch(input, init);
        onEvent({
          via: 'fetch',
          state: 'end',
          method,
          url: raw,
          responseURL: response.url,
          status: response.status,
          contentType: response.headers.get('content-type') || '',
          declaredBytes: headerLength(response.headers.get('content-length')),
          started,
          ended: Date.now(),
          phase,
          phaseRank: phase ? 3 : undefined,
        });
        return response;
      } catch (error) {
        onEvent({
          via: 'fetch',
          state: 'error',
          method,
          url: raw,
          started,
          ended: Date.now(),
          error: error instanceof Error ? error.message : String(error),
          phase,
          phaseRank: phase ? 3 : undefined,
        });
        throw error;
      }
    };
  }

  if (typeof root.XMLHttpRequest === 'function') {
    const proto = root.XMLHttpRequest.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;
    proto.open = function (method, url) {
      this.__exo = { method: String(method || 'GET').toUpperCase(), url: String(url) };
      return origOpen.apply(this, arguments);
    };
    proto.send = function () {
      const meta = this.__exo || { method: 'GET', url: '' };
      const started = Date.now();
      const phase = phaseOf();
      onEvent({
        via: 'xhr',
        state: 'start',
        method: meta.method,
        url: meta.url,
        started,
        phase,
        phaseRank: phase ? 3 : undefined,
      });
      this.addEventListener(
        'loadend',
        () => {
          let contentType = '';
          let declared = null;
          try {
            contentType = this.getResponseHeader('content-type') || '';
            declared = headerLength(this.getResponseHeader('content-length'));
          } catch {
            /* headers unavailable */
          }
          onEvent({
            via: 'xhr',
            state: this.status === 0 ? 'error' : 'end',
            method: meta.method,
            url: meta.url,
            responseURL: this.responseURL,
            status: this.status,
            contentType,
            declaredBytes: declared,
            started,
            ended: Date.now(),
            phase,
            phaseRank: phase ? 3 : undefined,
          });
        },
        { once: true },
      );
      return origSend.apply(this, arguments);
    };
  }

  if (typeof root.WebSocket === 'function') {
    const OrigWS = root.WebSocket;
    root.WebSocket = new Proxy(OrigWS, {
      construct(target, args) {
        const started = Date.now();
        const phase = phaseOf();
        const raw = String(args[0]);
        onEvent({
          via: 'websocket',
          state: 'start',
          method: 'GET',
          url: raw,
          started,
          phase,
          phaseRank: phase ? 3 : undefined,
        });
        const ws = new target(...args);
        ws.addEventListener('open', () => {
          onEvent({
            via: 'websocket',
            state: 'end',
            method: 'GET',
            url: raw,
            status: 101,
            started,
            ended: Date.now(),
            phase,
            phaseRank: phase ? 3 : undefined,
          });
        });
        ws.addEventListener('error', () => {
          onEvent({
            via: 'websocket',
            state: 'error',
            method: 'GET',
            url: raw,
            error: 'WebSocket error',
            started,
            ended: Date.now(),
            phase,
            phaseRank: phase ? 3 : undefined,
          });
        });
        return ws;
      },
    });
  }

  const beacon = root.navigator?.sendBeacon?.bind(root.navigator);
  if (beacon && root.navigator) {
    root.navigator.sendBeacon = function (url, data) {
      const started = Date.now();
      const phase = phaseOf();
      const declared =
        data && typeof data.size === 'number'
          ? data.size
          : data && typeof data.byteLength === 'number'
            ? data.byteLength
            : data && typeof data.length === 'number'
              ? data.length
              : null;
      onEvent({
        via: 'beacon',
        state: 'start',
        method: 'POST',
        url: String(url),
        started,
        declaredBytes: declared,
        phase,
        phaseRank: phase ? 3 : undefined,
      });
      const ok = beacon(url, data);
      onEvent({
        via: 'beacon',
        state: ok ? 'end' : 'error',
        method: 'POST',
        url: String(url),
        status: ok ? 204 : 0,
        started,
        ended: Date.now(),
        phase,
        phaseRank: phase ? 3 : undefined,
      });
      return ok;
    };
  }
}

export function watchResources(onEvent) {
  if (typeof PerformanceObserver === 'undefined') return;
  const emit = (entry) => onEvent(resourceFromEntry(entry));
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) emit(entry);
  });
  observer.observe({ type: 'resource', buffered: true });
}
