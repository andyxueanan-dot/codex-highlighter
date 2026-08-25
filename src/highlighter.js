(() => {
  "use strict";

  const VERSION = "1.0.1";
  const STATE_KEY = "__CODEX_HIGHLIGHTER__";
  const STORAGE_KEY = "codex-highlighter:data:v1";
  const STYLE_ID = "codex-highlighter-style";
  const TOOLBAR_HOST_ID = "codex-highlighter-toolbar-host";
  const HIGHLIGHT_NAME = "codex-study-highlight";
  const MAX_HIGHLIGHTS = 2000;
  const MAX_SELECTION_LENGTH = 5000;

  if (window[STATE_KEY]?.version === VERSION) {
    window[STATE_KEY].ensure();
    return window[STATE_KEY].health();
  }

  try {
    window[STATE_KEY]?.cleanup?.();
  } catch {}

  const supportsHighlights =
    typeof CSS !== "undefined" &&
    CSS.highlights &&
    typeof Highlight === "function";

  let data = {
    version: 1,
    revision: 0,
    updatedAt: 0,
    highlights: [],
  };
  let toolbarHost = null;
  let toolbarButton = null;
  let pendingRange = null;
  let observer = null;
  let routeTimer = 0;
  let applyTimer = 0;
  let lastContextKey = "";
  let disposed = false;
  const resolvedRanges = new Map();

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function fingerprint(text) {
    const value = String(text || "");
    return fnv1a(
      `${value.length}|${value.slice(0, 256)}|${value.slice(-256)}`,
    );
  }

  function contextKey() {
    try {
      const url = new URL(location.href);
      for (const key of ["theme", "appearance", "modal", "panel"]) {
        url.searchParams.delete(key);
      }
      return `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
    } catch {
      return location.href;
    }
  }

  function safeString(value, maxLength) {
    return typeof value === "string" ? value.slice(0, maxLength) : "";
  }

  function sanitizeAnchor(value) {
    if (!value || typeof value !== "object") return null;
    const exact = safeString(value.exact, MAX_SELECTION_LENGTH);
    if (!exact.trim()) return null;
    return {
      id:
        safeString(value.id, 128) ||
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
      contextKey: safeString(value.contextKey, 1000),
      scopeHash: safeString(value.scopeHash, 64),
      scopeTag: safeString(value.scopeTag, 32),
      scopeLead: safeString(value.scopeLead, 128),
      scopeTail: safeString(value.scopeTail, 128),
      exact,
      prefix: safeString(value.prefix, 256),
      suffix: safeString(value.suffix, 256),
      start: Number.isFinite(value.start) ? Math.max(0, value.start) : 0,
      end: Number.isFinite(value.end)
        ? Math.max(0, value.end)
        : exact.length,
      createdAt: Number.isFinite(value.createdAt)
        ? value.createdAt
        : Date.now(),
    };
  }

  function sanitizeData(value) {
    if (!value || typeof value !== "object") return null;
    const source = Array.isArray(value.highlights) ? value.highlights : [];
    const highlights = [];
    const ids = new Set();
    for (const item of source.slice(0, MAX_HIGHLIGHTS)) {
      const anchor = sanitizeAnchor(item);
      if (!anchor || ids.has(anchor.id)) continue;
      ids.add(anchor.id);
      highlights.push(anchor);
    }
    return {
      version: 1,
      revision: Number.isFinite(value.revision)
        ? Math.max(0, value.revision)
        : 0,
      updatedAt: Number.isFinite(value.updatedAt)
        ? Math.max(0, value.updatedAt)
        : 0,
      highlights,
    };
  }

  function loadLocalData() {
    try {
      const parsed = sanitizeData(JSON.parse(localStorage.getItem(STORAGE_KEY)));
      if (parsed) data = parsed;
    } catch {}
  }

  function saveLocalData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
  }

  function markChanged() {
    data.revision += 1;
    data.updatedAt = Date.now();
    saveLocalData();
  }

  function elementForNode(node) {
    if (!node) return null;
    return node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  }

  function selectionAllowed(range) {
    if (!range || range.collapsed) return false;
    const start = elementForNode(range.startContainer);
    const end = elementForNode(range.endContainer);
    if (!start || !end) return false;
    const main = start.closest("main") || document.querySelector("main");
    if (!main || !main.contains(end)) return false;
    const blocked =
      "input,textarea,select,[contenteditable='true'],[contenteditable='']," +
      "button,[role='button'],nav,aside,[role='dialog'],[role='menu']," +
      `#${TOOLBAR_HOST_ID}`;
    if (start.closest(blocked) || end.closest(blocked)) return false;
    const exact = range.toString();
    return exact.trim().length > 0 && exact.length <= MAX_SELECTION_LENGTH;
  }

  function semanticScope(element) {
    return element.closest(
      "[data-message-id],[data-turn-id],[data-testid*='conversation-turn']," +
        "[data-testid*='message'],article,[role='article']",
    );
  }

  function chooseScope(range) {
    const start = elementForNode(range.startContainer);
    const end = elementForNode(range.endContainer);
    if (!start || !end) return null;
    const main = start.closest("main") || document.querySelector("main");
    if (!main || !main.contains(end)) return null;

    const semantic = semanticScope(start);
    if (semantic && semantic.contains(end)) return semantic;

    const common = elementForNode(range.commonAncestorContainer);
    let node = common;
    let fallback = common;
    const blockTags = new Set([
      "P",
      "LI",
      "PRE",
      "BLOCKQUOTE",
      "DIV",
      "SECTION",
      "TD",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
    ]);
    while (node && node !== main.parentElement) {
      if (!node.contains(range.startContainer) || !node.contains(range.endContainer)) {
        node = node.parentElement;
        continue;
      }
      const textLength = (node.textContent || "").length;
      if (textLength >= range.toString().length && textLength <= 30000) {
        fallback = node;
        if (blockTags.has(node.tagName)) {
          const parentLength = (node.parentElement?.textContent || "").length;
          if (
            node.tagName !== "DIV" ||
            parentLength > textLength * 1.25 ||
            node.children.length <= 8
          ) {
            return node;
          }
        }
      }
      if (node === main) break;
      node = node.parentElement;
    }
    return fallback || main;
  }

  function offsetWithin(scope, container, offset) {
    const before = document.createRange();
    before.selectNodeContents(scope);
    try {
      before.setEnd(container, offset);
      return before.toString().length;
    } catch {
      return -1;
    }
  }

  function createAnchor(range) {
    const scope = chooseScope(range);
    if (!scope) return null;
    const scopeText = scope.textContent || "";
    const start = offsetWithin(scope, range.startContainer, range.startOffset);
    const end = offsetWithin(scope, range.endContainer, range.endOffset);
    if (start < 0 || end <= start) return null;
    const exact = range.toString();
    return sanitizeAnchor({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      contextKey: contextKey(),
      scopeHash: fingerprint(scopeText),
      scopeTag: scope.tagName || "",
      scopeLead: scopeText.slice(0, 96),
      scopeTail: scopeText.slice(-96),
      exact,
      prefix: scopeText.slice(Math.max(0, start - 96), start),
      suffix: scopeText.slice(end, end + 96),
      start,
      end,
      createdAt: Date.now(),
    });
  }

  function textNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest(`#${TOOLBAR_HOST_ID},script,style,noscript`)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }
    return nodes;
  }

  function rangeFromOffsets(scope, start, end) {
    if (start < 0 || end <= start) return null;
    const range = document.createRange();
    let position = 0;
    let started = false;
    for (const node of textNodes(scope)) {
      const next = position + node.data.length;
      if (!started && start >= position && start <= next) {
        range.setStart(node, Math.min(node.data.length, start - position));
        started = true;
      }
      if (started && end >= position && end <= next) {
        range.setEnd(node, Math.min(node.data.length, end - position));
        return range.toString() ? range : null;
      }
      position = next;
    }
    return null;
  }

  function candidateScopes() {
    const mains = Array.from(document.querySelectorAll("main"));
    if (mains.length === 0) return [];
    const result = [];
    const seen = new Set();
    const add = (node) => {
      if (!node || seen.has(node) || node === toolbarHost) return;
      const length = (node.textContent || "").length;
      if (!length || length > 50000) return;
      seen.add(node);
      result.push(node);
    };
    for (const main of mains) {
      for (const node of main.querySelectorAll(
        "[data-message-id],[data-turn-id],[data-testid*='conversation-turn']," +
          "[data-testid*='message'],article,[role='article'],p,li,pre," +
          "blockquote,h1,h2,h3,h4,h5,h6",
      )) {
        add(node);
        if (result.length >= 1200) break;
      }
      add(main);
      if (result.length >= 1200) break;
    }
    return result;
  }

  function occurrences(text, exact, limit = 24) {
    const positions = [];
    let from = 0;
    while (positions.length < limit) {
      const index = text.indexOf(exact, from);
      if (index < 0) break;
      positions.push(index);
      from = index + Math.max(1, exact.length);
    }
    return positions;
  }

  function endingMatch(text, expected) {
    if (!expected) return 0;
    const sample = expected.slice(-64);
    return text.endsWith(sample) ? sample.length : 0;
  }

  function startingMatch(text, expected) {
    if (!expected) return 0;
    const sample = expected.slice(0, 64);
    return text.startsWith(sample) ? sample.length : 0;
  }

  function anchorToRange(anchor, scopes) {
    const currentContext = contextKey();
    if (
      anchor.contextKey &&
      currentContext &&
      anchor.contextKey !== currentContext
    ) {
      return null;
    }
    let best = null;
    for (const scope of scopes || candidateScopes()) {
      const text = scope.textContent || "";
      if (text.length < anchor.exact.length) continue;
      const hashMatches = fingerprint(text) === anchor.scopeHash;
      for (const start of occurrences(text, anchor.exact)) {
        const end = start + anchor.exact.length;
        let score = 10;
        if (hashMatches) score += 1000;
        if (anchor.scopeTag && scope.tagName === anchor.scopeTag) score += 8;
        if (anchor.contextKey && anchor.contextKey === currentContext) score += 30;
        score += endingMatch(text.slice(0, start), anchor.prefix) * 3;
        score += startingMatch(text.slice(end), anchor.suffix) * 3;
        if (anchor.scopeLead && text.startsWith(anchor.scopeLead)) score += 70;
        if (anchor.scopeTail && text.endsWith(anchor.scopeTail)) score += 70;
        score += Math.max(0, 50 - Math.min(50, Math.abs(start - anchor.start)));
        if (!best || score > best.score) best = { scope, start, end, score };
      }
    }
    if (!best || best.score < 80) return null;
    const range = rangeFromOffsets(best.scope, best.start, best.end);
    return range && range.toString() === anchor.exact ? range : null;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      ::highlight(${HIGHLIGHT_NAME}) {
        background-color: rgba(255, 235, 59, 0.78);
        color: inherit;
        text-decoration: none;
        text-shadow: none;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function applyHighlights() {
    applyTimer = 0;
    if (disposed || !supportsHighlights) return;
    ensureStyle();
    const group = new Highlight();
    const scopes = candidateScopes();
    resolvedRanges.clear();
    for (const anchor of data.highlights) {
      const range = anchorToRange(anchor, scopes);
      if (!range) continue;
      group.add(range);
      resolvedRanges.set(anchor.id, range);
    }
    CSS.highlights.set(HIGHLIGHT_NAME, group);
  }

  function scheduleApply(delay = 180) {
    if (disposed) return;
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(applyHighlights, delay);
  }

  function rangesOverlap(left, right) {
    try {
      if (left.collapsed || right.collapsed) return false;
      const leftElement = elementForNode(left.startContainer);
      const rightElement = elementForNode(right.startContainer);
      const root = leftElement?.closest("main");
      if (
        !root ||
        root !== rightElement?.closest("main") ||
        !root.contains(left.startContainer) ||
        !root.contains(left.endContainer) ||
        !root.contains(right.startContainer) ||
        !root.contains(right.endContainer)
      ) {
        return false;
      }
      const leftStart = offsetWithin(root, left.startContainer, left.startOffset);
      const leftEnd = offsetWithin(root, left.endContainer, left.endOffset);
      const rightStart = offsetWithin(root, right.startContainer, right.startOffset);
      const rightEnd = offsetWithin(root, right.endContainer, right.endOffset);
      return (
        leftStart >= 0 &&
        rightStart >= 0 &&
        leftStart < rightEnd &&
        rightStart < leftEnd
      );
    } catch {
      return false;
    }
  }

  function overlappingIds(range) {
    const ids = [];
    for (const [id, resolved] of resolvedRanges) {
      if (rangesOverlap(range, resolved)) ids.push(id);
    }
    return ids;
  }

  function matchingAnchorIds(range) {
    const overlapping = overlappingIds(range);
    if (overlapping.length > 0) return overlapping;
    const probe = createAnchor(range);
    if (!probe) return [];
    return data.highlights
      .filter((anchor) => {
        if (anchor.scopeHash !== probe.scopeHash) return false;
        if (
          anchor.contextKey &&
          probe.contextKey &&
          anchor.contextKey !== probe.contextKey
        ) {
          return false;
        }
        const offsetsOverlap =
          anchor.start < probe.end && probe.start < anchor.end;
        const quoteMatches =
          anchor.exact === probe.exact &&
          anchor.prefix.slice(-64) === probe.prefix.slice(-64) &&
          anchor.suffix.slice(0, 64) === probe.suffix.slice(0, 64);
        return offsetsOverlap || quoteMatches;
      })
      .map((anchor) => anchor.id);
  }

  function hideToolbar() {
    if (toolbarHost) toolbarHost.style.display = "none";
    pendingRange = null;
  }

  function updateToolbarMode(range) {
    if (!toolbarButton) return;
    const removing = matchingAnchorIds(range).length > 0;
    toolbarButton.title = removing
      ? "取消高亮 (Ctrl+Shift+H)"
      : "高亮 (Ctrl+Shift+H)";
    toolbarButton.setAttribute("aria-label", toolbarButton.title);
    toolbarButton.dataset.mode = removing ? "remove" : "add";
  }

  function showToolbar(range) {
    ensureToolbar();
    pendingRange = range.cloneRange();
    updateToolbarMode(pendingRange);
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    const rect = rects.at(-1) || range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return hideToolbar();
    toolbarHost.style.display = "block";
    const width = 42;
    const height = 42;
    const left = Math.min(
      innerWidth - width - 8,
      Math.max(8, rect.left + rect.width / 2 - width / 2),
    );
    const above = rect.top - height - 8;
    const top = above >= 8 ? above : Math.min(innerHeight - height - 8, rect.bottom + 8);
    toolbarHost.style.left = `${left}px`;
    toolbarHost.style.top = `${top}px`;
  }

  function togglePendingRange() {
    if (!pendingRange || !selectionAllowed(pendingRange)) return hideToolbar();
    const removing = matchingAnchorIds(pendingRange);
    if (removing.length > 0) {
      const ids = new Set(removing);
      data.highlights = data.highlights.filter((item) => !ids.has(item.id));
      markChanged();
    } else if (data.highlights.length < MAX_HIGHLIGHTS) {
      const anchor = createAnchor(pendingRange);
      if (anchor) {
        data.highlights.push(anchor);
        markChanged();
      }
    }
    hideToolbar();
    try {
      getSelection()?.removeAllRanges();
    } catch {}
    scheduleApply(0);
  }

  function ensureToolbar() {
    if (toolbarHost?.isConnected) return;
    document.getElementById(TOOLBAR_HOST_ID)?.remove();
    toolbarHost = document.createElement("div");
    toolbarHost.id = TOOLBAR_HOST_ID;
    toolbarHost.style.cssText =
      "display:none;position:fixed;z-index:2147483646;width:42px;height:42px;" +
      "pointer-events:auto;isolation:isolate;";
    const shadow = toolbarHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      button {
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(0,0,0,.13);
        border-radius: 14px;
        background: rgba(255,255,255,.97);
        color: #242424;
        box-shadow: 0 8px 26px rgba(0,0,0,.18);
        cursor: pointer;
        padding: 0;
      }
      button:hover { background: #fffde7; transform: translateY(-1px); }
      button:active { transform: translateY(0); }
      button::after {
        content: "";
        position: absolute;
        width: 23px;
        height: 4px;
        border-radius: 3px;
        margin-top: 27px;
        background: #ffeb3b;
      }
      svg { width: 21px; height: 21px; }
    `;
    toolbarButton = document.createElement("button");
    toolbarButton.type = "button";
    toolbarButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 20h5l10.2-10.2a2.35 2.35 0 0 0-3.32-3.32L5.68 16.68 4 20Z"
          stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="m14.8 7.55 3.32 3.32" stroke="currentColor" stroke-width="1.8"/>
      </svg>
    `;
    toolbarButton.addEventListener("pointerdown", (event) => event.preventDefault());
    toolbarButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePendingRange();
    });
    shadow.append(style, toolbarButton);
    (document.body || document.documentElement).appendChild(toolbarHost);
  }

  function captureSelection() {
    if (disposed) return;
    const selection = getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideToolbar();
      return;
    }
    const range = selection.getRangeAt(0);
    if (!selectionAllowed(range)) {
      hideToolbar();
      return;
    }
    if (applyTimer) {
      clearTimeout(applyTimer);
      applyTimer = 0;
    }
    applyHighlights();
    showToolbar(range);
  }

  function onPointerUp(event) {
    if (toolbarHost?.contains(event.target)) return;
    setTimeout(captureSelection, 0);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      hideToolbar();
      return;
    }
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "h") {
      const selection = getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!selectionAllowed(range)) return;
      event.preventDefault();
      pendingRange = range.cloneRange();
      togglePendingRange();
    }
  }

  function importData(serialized) {
    try {
      const incoming = sanitizeData(
        typeof serialized === "string" ? JSON.parse(serialized) : serialized,
      );
      if (!incoming) return false;
      if (
        incoming.updatedAt > data.updatedAt ||
        (incoming.updatedAt === data.updatedAt && incoming.revision > data.revision)
      ) {
        data = incoming;
        saveLocalData();
        scheduleApply(0);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function exportData() {
    return JSON.stringify(data);
  }

  function ensure() {
    if (disposed) return false;
    ensureStyle();
    ensureToolbar();
    scheduleApply(0);
    return true;
  }

  function health() {
    return {
      installed: !disposed,
      version: VERSION,
      supported: supportsHighlights,
      count: data.highlights.length,
      resolved: resolvedRanges.size,
      contextKey: contextKey(),
    };
  }

  function cleanup() {
    if (disposed) return true;
    disposed = true;
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    observer?.disconnect();
    if (routeTimer) clearInterval(routeTimer);
    if (applyTimer) clearTimeout(applyTimer);
    try {
      CSS.highlights?.delete(HIGHLIGHT_NAME);
    } catch {}
    document.getElementById(STYLE_ID)?.remove();
    toolbarHost?.remove();
    delete window[STATE_KEY];
    return true;
  }

  loadLocalData();
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("keydown", onKeyDown, true);
  observer = new MutationObserver((records) => {
    if (records.some((record) => record.type === "childList" || record.type === "characterData")) {
      resolvedRanges.clear();
      scheduleApply();
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  lastContextKey = contextKey();
  routeTimer = setInterval(() => {
    const current = contextKey();
    if (current !== lastContextKey) {
      lastContextKey = current;
      hideToolbar();
      scheduleApply(0);
    }
    if (!document.getElementById(STYLE_ID) || !toolbarHost?.isConnected) ensure();
  }, 1200);

  window[STATE_KEY] = {
    version: VERSION,
    ensure,
    cleanup,
    health,
    importData,
    exportData,
  };
  ensure();
  return health();
})();
