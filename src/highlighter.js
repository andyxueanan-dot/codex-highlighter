(() => {
  "use strict";

  const VERSION = "1.1.2";
  const STATE_KEY = "__CODEX_HIGHLIGHTER__";
  const STORAGE_KEY = "codex-highlighter:data:v1";
  const STYLE_ID = "codex-highlighter-style";
  const TOOLBAR_HOST_ID = "codex-highlighter-toolbar-host";
  const HOVER_HOST_ID = "codex-highlighter-hover-host";
  const HIGHLIGHT_PREFIX = "codex-study-highlight";
  const COLORS = {
    yellow: { label: "黄色", value: "rgba(255, 235, 59, 0.78)" },
    green: { label: "绿色", value: "rgba(139, 232, 90, 0.72)" },
    cyan: { label: "青色", value: "rgba(92, 225, 230, 0.72)" },
    pink: { label: "粉色", value: "rgba(239, 108, 214, 0.68)" },
    purple: { label: "紫色", value: "rgba(155, 93, 229, 0.64)" },
  };
  const MAX_HIGHLIGHTS = 2000;
  const MAX_SELECTION_LENGTH = 5000;
  const EDITABLE_SELECTOR =
    "input,textarea,select,[contenteditable='true'],[contenteditable='']," +
    "[role='textbox'],[data-lexical-editor='true']";

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
  let toolbarBar = null;
  let deleteButton = null;
  const colorButtons = new Map();
  let hoverHost = null;
  let hoverDeleteButton = null;
  let hoverAnchorId = null;
  let hoverHideTimer = 0;
  let hoverMoveFrame = 0;
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
      color: Object.hasOwn(COLORS, value.color) ? value.color : "yellow",
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

  function pageRoot() {
    return document.querySelector("#root") || document.body || document.documentElement;
  }

  function selectionSurface(element) {
    return (
      element?.closest(
        "main,aside,[data-side-chat],[data-testid*='side-chat']," +
          "[data-testid*='sidecar'],[data-testid*='conversation']",
      ) || pageRoot()
    );
  }

  function selectionAllowed(range) {
    if (!range || range.collapsed) return false;
    const start = elementForNode(range.startContainer);
    const end = elementForNode(range.endContainer);
    if (!start || !end) return false;
    const surface = selectionSurface(start);
    if (!surface || surface !== selectionSurface(end) || !surface.contains(end)) {
      return false;
    }
    const blocked =
      `${EDITABLE_SELECTOR},button,[role='button'],nav,[role='dialog'],[role='menu'],` +
      `#${TOOLBAR_HOST_ID},#${HOVER_HOST_ID}`;
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
    const surface = selectionSurface(start);
    if (!surface || surface !== selectionSurface(end) || !surface.contains(end)) {
      return null;
    }

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
    while (node && node !== surface.parentElement) {
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
      if (node === surface) break;
      node = node.parentElement;
    }
    return fallback || surface;
  }

  function offsetWithin(scope, container, offset) {
    if (container?.nodeType !== Node.TEXT_NODE) return -1;
    let position = 0;
    for (const node of textNodes(scope)) {
      if (node === container) {
        return position + Math.min(Math.max(0, offset), node.data.length);
      }
      position += node.data.length;
    }
    return -1;
  }

  function createAnchor(range, color = "yellow") {
    const scope = chooseScope(range);
    if (!scope) return null;
    const scopeText = scopedText(scope);
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
      color,
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
        if (
          parent.closest(
            `#${TOOLBAR_HOST_ID},#${HOVER_HOST_ID},${EDITABLE_SELECTOR},script,style,noscript`,
          )
        ) {
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

  function scopedText(root) {
    return textNodes(root)
      .map((node) => node.data)
      .join("");
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
    const root = pageRoot();
    if (!root) return [];
    const result = [];
    const seen = new Set();
    const add = (node) => {
      if (!node || seen.has(node) || node === toolbarHost) return;
      if (node.matches?.(EDITABLE_SELECTOR) || node.closest?.(EDITABLE_SELECTOR)) {
        return;
      }
      const length = scopedText(node).length;
      if (!length || length > 50000) return;
      seen.add(node);
      result.push(node);
    };
    for (const node of root.querySelectorAll(
      "[data-message-id],[data-turn-id],[data-testid*='conversation-turn']," +
        "[data-testid*='message'],[data-side-chat],[data-testid*='side-chat']," +
        "[data-testid*='sidecar'],article,[role='article'],p,li,pre," +
        "blockquote,h1,h2,h3,h4,h5,h6",
    )) {
      add(node);
      if (result.length >= 2000) break;
    }
    for (const surface of root.querySelectorAll("main,aside")) add(surface);
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

  function normalizeContext(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function endingMatch(text, expected) {
    if (!expected) return 0;
    const normalizedText = normalizeContext(text);
    const sample = normalizeContext(expected).slice(-64);
    return sample && normalizedText.endsWith(sample) ? sample.length : 0;
  }

  function startingMatch(text, expected) {
    if (!expected) return 0;
    const normalizedText = normalizeContext(text);
    const sample = normalizeContext(expected).slice(0, 64);
    return sample && normalizedText.startsWith(sample) ? sample.length : 0;
  }

  function hasReliableContext(anchor, text, start, end, hashMatches) {
    if (hashMatches) return true;

    const normalizedText = normalizeContext(text);
    const normalizedLead = normalizeContext(anchor.scopeLead);
    const normalizedTail = normalizeContext(anchor.scopeTail);
    const leadMatches =
      normalizedLead.length >= 8 && normalizedText.startsWith(normalizedLead);
    const tailMatches =
      normalizedTail.length >= 8 && normalizedText.endsWith(normalizedTail);
    if (leadMatches || tailMatches) return true;

    const prefixMatch = endingMatch(text.slice(0, start), anchor.prefix);
    const suffixMatch = startingMatch(text.slice(end), anchor.suffix);
    const prefixAvailable = normalizeContext(anchor.prefix).length;
    const suffixAvailable = normalizeContext(anchor.suffix).length;
    const available = prefixAvailable + suffixAvailable;
    const matched = prefixMatch + suffixMatch;

    if (anchor.exact.length <= 4) {
      const hasPrefix = prefixAvailable > 0;
      const hasSuffix = suffixAvailable > 0;
      if (hasPrefix && hasSuffix) {
        return (
          prefixMatch >= Math.min(4, prefixAvailable) &&
          suffixMatch >= Math.min(4, suffixAvailable) &&
          matched >= Math.min(8, available)
        );
      }
      const singleSideMatch = hasPrefix ? prefixMatch : suffixMatch;
      const singleSideAvailable = hasPrefix
        ? prefixAvailable
        : suffixAvailable;
      return (
        singleSideAvailable > 0 &&
        singleSideMatch >= Math.min(12, singleSideAvailable)
      );
    }

    const prefixEnough =
      prefixAvailable === 0 ||
      prefixMatch >= Math.min(6, prefixAvailable);
    const suffixEnough =
      suffixAvailable === 0 ||
      suffixMatch >= Math.min(6, suffixAvailable);
    return (
      prefixEnough &&
      suffixEnough &&
      matched >= Math.min(16, available)
    );
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
      const text = scopedText(scope);
      if (text.length < anchor.exact.length) continue;
      const hashMatches = fingerprint(text) === anchor.scopeHash;
      for (const start of occurrences(text, anchor.exact)) {
        const end = start + anchor.exact.length;
        if (!hasReliableContext(anchor, text, start, end, hashMatches)) {
          continue;
        }
        const prefixMatch = endingMatch(text.slice(0, start), anchor.prefix);
        const suffixMatch = startingMatch(text.slice(end), anchor.suffix);
        let score = 10;
        if (hashMatches) score += 1000;
        if (anchor.scopeTag && scope.tagName === anchor.scopeTag) score += 8;
        if (anchor.contextKey && anchor.contextKey === currentContext) score += 30;
        score += prefixMatch * 3;
        score += suffixMatch * 3;
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
    style.textContent = Object.entries(COLORS)
      .map(
        ([name, color]) => `
          ::highlight(${HIGHLIGHT_PREFIX}-${name}) {
            background-color: ${color.value};
            color: inherit;
            text-decoration: none;
            text-shadow: none;
          }
        `,
      )
      .join("\n");
    (document.head || document.documentElement).appendChild(style);
  }

  function applyHighlights() {
    applyTimer = 0;
    if (disposed || !supportsHighlights) return;
    ensureStyle();
    const groups = new Map(
      Object.keys(COLORS).map((name) => [name, new Highlight()]),
    );
    const scopes = candidateScopes();
    resolvedRanges.clear();
    for (const anchor of data.highlights) {
      const range = anchorToRange(anchor, scopes);
      if (!range) continue;
      groups.get(anchor.color || "yellow").add(range);
      resolvedRanges.set(anchor.id, range);
    }
    CSS.highlights.delete(HIGHLIGHT_PREFIX);
    for (const [name, group] of groups) {
      CSS.highlights.set(`${HIGHLIGHT_PREFIX}-${name}`, group);
    }
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
      const root = selectionSurface(leftElement);
      if (
        !root ||
        root !== selectionSurface(rightElement) ||
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
    if (!toolbarBar || !deleteButton) return 150;
    const matching = new Set(matchingAnchorIds(range));
    const colors = new Set(
      data.highlights
        .filter((anchor) => matching.has(anchor.id))
        .map((anchor) => anchor.color || "yellow"),
    );
    deleteButton.style.display = matching.size > 0 ? "grid" : "none";
    for (const [name, button] of colorButtons) {
      button.dataset.active = colors.size === 1 && colors.has(name) ? "true" : "false";
    }
    const width = matching.size > 0 ? 178 : 150;
    toolbarHost.style.width = `${width}px`;
    return width;
  }

  function rectsIntersect(left, right, padding = 3) {
    return !(
      left.right + padding <= right.left ||
      left.left >= right.right + padding ||
      left.bottom + padding <= right.top ||
      left.top >= right.bottom + padding
    );
  }

  function nearbyNativeMenuRects(selectionRect) {
    const labels = /添加到对话|在侧边聊天中提问|更多|Add to conversation|Ask in side chat|More/i;
    const rects = [];
    for (const node of document.querySelectorAll("button,[role='button']")) {
      if (!labels.test((node.textContent || "").trim())) continue;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const nearX = rect.right >= selectionRect.left - 280 && rect.left <= selectionRect.right + 280;
      const nearY = rect.bottom >= selectionRect.top - 160 && rect.top <= selectionRect.bottom + 160;
      if (nearX && nearY) rects.push(rect);
    }
    return rects;
  }

  function placeFloatingHost(host, anchorRect, width, height, preferBelow = true) {
    const gap = 10;
    const margin = 8;
    const centeredLeft = anchorRect.left + anchorRect.width / 2 - width / 2;
    const candidates = preferBelow
      ? [
          { left: centeredLeft, top: anchorRect.bottom + gap },
          { left: centeredLeft, top: anchorRect.top - height - gap },
          { left: anchorRect.right + gap, top: anchorRect.top + anchorRect.height / 2 - height / 2 },
          { left: anchorRect.left - width - gap, top: anchorRect.top + anchorRect.height / 2 - height / 2 },
        ]
      : [
          { left: centeredLeft, top: anchorRect.top - height - gap },
          { left: centeredLeft, top: anchorRect.bottom + gap },
          { left: anchorRect.right + gap, top: anchorRect.top + anchorRect.height / 2 - height / 2 },
        ];
    const obstacles = nearbyNativeMenuRects(anchorRect);
    let chosen = candidates[0];
    for (const candidate of candidates) {
      const bounded = {
        left: Math.min(innerWidth - width - margin, Math.max(margin, candidate.left)),
        top: Math.min(innerHeight - height - margin, Math.max(margin, candidate.top)),
      };
      const rect = {
        ...bounded,
        right: bounded.left + width,
        bottom: bounded.top + height,
      };
      if (!obstacles.some((obstacle) => rectsIntersect(rect, obstacle))) {
        chosen = bounded;
        break;
      }
    }
    host.style.left = `${Math.round(chosen.left)}px`;
    host.style.top = `${Math.round(chosen.top)}px`;
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
    const width = updateToolbarMode(pendingRange);
    const height = 34;
    placeFloatingHost(toolbarHost, rect, width, height, true);
    setTimeout(() => {
      if (toolbarHost?.style.display === "block") {
        placeFloatingHost(toolbarHost, rect, width, height, true);
      }
    }, 80);
  }

  function finishSelectionAction() {
    hideToolbar();
    try {
      getSelection()?.removeAllRanges();
    } catch {}
    scheduleApply(0);
  }

  function applyPendingColor(color) {
    if (!pendingRange || !selectionAllowed(pendingRange)) return hideToolbar();
    if (!Object.hasOwn(COLORS, color)) return;
    const matching = new Set(matchingAnchorIds(pendingRange));
    if (matching.size > 0) {
      for (const anchor of data.highlights) {
        if (matching.has(anchor.id)) anchor.color = color;
      }
      markChanged();
    } else if (data.highlights.length < MAX_HIGHLIGHTS) {
      const anchor = createAnchor(pendingRange, color);
      if (anchor) {
        data.highlights.push(anchor);
        markChanged();
      }
    }
    finishSelectionAction();
  }

  function removePendingHighlights() {
    if (!pendingRange) return hideToolbar();
    const matching = new Set(matchingAnchorIds(pendingRange));
    if (matching.size > 0) {
      data.highlights = data.highlights.filter((anchor) => !matching.has(anchor.id));
      markChanged();
    }
    finishSelectionAction();
  }

  function togglePendingRange() {
    if (!pendingRange || !selectionAllowed(pendingRange)) return hideToolbar();
    if (matchingAnchorIds(pendingRange).length > 0) removePendingHighlights();
    else applyPendingColor("yellow");
  }

  function ensureToolbar() {
    if (toolbarHost?.isConnected) return;
    document.getElementById(TOOLBAR_HOST_ID)?.remove();
    toolbarHost = document.createElement("div");
    toolbarHost.id = TOOLBAR_HOST_ID;
    toolbarHost.style.cssText =
      "display:none;position:fixed;z-index:2147483646;width:150px;height:34px;" +
      "pointer-events:auto;isolation:isolate;";
    const shadow = toolbarHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      .bar {
        height: 34px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 3px;
        border: 1px solid rgba(0,0,0,.13);
        border-radius: 14px;
        background: rgba(255,255,255,.97);
        box-shadow: 0 8px 26px rgba(0,0,0,.18);
        padding: 4px 6px;
      }
      button {
        width: 24px;
        height: 24px;
        display: grid;
        place-items: center;
        border: 1px solid transparent;
        border-radius: 8px;
        background: transparent;
        color: #242424;
        cursor: pointer;
        padding: 0;
      }
      button:hover { background: rgba(0,0,0,.06); transform: translateY(-1px); }
      button:active { transform: translateY(0); }
      button[data-active="true"] {
        border-color: rgba(0,0,0,.38);
        background: rgba(0,0,0,.06);
      }
      .swatch {
        width: 17px;
        height: 17px;
        border-radius: 50%;
        border: 1px solid rgba(0,0,0,.2);
        box-sizing: border-box;
      }
      .divider { width: 1px; height: 18px; background: rgba(0,0,0,.12); }
      .delete { color: #d93025; }
      svg { width: 16px; height: 16px; }
    `;
    toolbarBar = document.createElement("div");
    toolbarBar.className = "bar";
    colorButtons.clear();
    for (const [name, color] of Object.entries(COLORS)) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.color = name;
      button.title = `高亮为${color.label}`;
      button.setAttribute("aria-label", button.title);
      const swatch = document.createElement("span");
      swatch.className = "swatch";
      swatch.style.background = color.value;
      button.appendChild(swatch);
      button.addEventListener("pointerdown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        applyPendingColor(name);
      });
      colorButtons.set(name, button);
      toolbarBar.appendChild(button);
    }
    const divider = document.createElement("span");
    divider.className = "divider";
    toolbarBar.appendChild(divider);
    deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete";
    deleteButton.title = "删除高亮";
    deleteButton.setAttribute("aria-label", deleteButton.title);
    deleteButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    deleteButton.addEventListener("pointerdown", (event) => event.preventDefault());
    deleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removePendingHighlights();
    });
    toolbarBar.appendChild(deleteButton);
    shadow.append(style, toolbarBar);
    (document.body || document.documentElement).appendChild(toolbarHost);
  }

  function anchorAtPoint(x, y) {
    for (const [id, range] of resolvedRanges) {
      for (const rect of range.getClientRects()) {
        if (
          x >= rect.left - 1 &&
          x <= rect.right + 1 &&
          y >= rect.top - 2 &&
          y <= rect.bottom + 2
        ) {
          return { id, rect };
        }
      }
    }
    return null;
  }

  function hideHoverToolbar() {
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    hoverHideTimer = 0;
    if (hoverHost) hoverHost.style.display = "none";
    hoverAnchorId = null;
  }

  function scheduleHideHoverToolbar() {
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    hoverHideTimer = setTimeout(hideHoverToolbar, 180);
  }

  function showHoverToolbar(id, rect) {
    ensureHoverToolbar();
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    hoverHideTimer = 0;
    hoverAnchorId = id;
    hoverHost.style.display = "block";
    placeFloatingHost(hoverHost, rect, 32, 32, false);
  }

  function removeHoveredHighlight() {
    if (!hoverAnchorId) return;
    const before = data.highlights.length;
    data.highlights = data.highlights.filter((anchor) => anchor.id !== hoverAnchorId);
    if (data.highlights.length !== before) markChanged();
    hideHoverToolbar();
    scheduleApply(0);
  }

  function ensureHoverToolbar() {
    if (hoverHost?.isConnected) return;
    document.getElementById(HOVER_HOST_ID)?.remove();
    hoverHost = document.createElement("div");
    hoverHost.id = HOVER_HOST_ID;
    hoverHost.style.cssText =
      "display:none;position:fixed;z-index:2147483645;width:32px;height:32px;" +
      "pointer-events:auto;isolation:isolate;";
    const shadow = hoverHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      button {
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(0,0,0,.13);
        border-radius: 10px;
        background: rgba(255,255,255,.98);
        color: #d93025;
        box-shadow: 0 7px 22px rgba(0,0,0,.18);
        cursor: pointer;
        padding: 0;
      }
      button:hover { background: #fff1f0; transform: translateY(-1px); }
      svg { width: 16px; height: 16px; }
    `;
    hoverDeleteButton = document.createElement("button");
    hoverDeleteButton.type = "button";
    hoverDeleteButton.title = "删除高亮";
    hoverDeleteButton.setAttribute("aria-label", hoverDeleteButton.title);
    hoverDeleteButton.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    hoverDeleteButton.addEventListener("pointerdown", (event) => event.preventDefault());
    hoverDeleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeHoveredHighlight();
    });
    hoverHost.addEventListener("pointerenter", () => {
      if (hoverHideTimer) clearTimeout(hoverHideTimer);
    });
    hoverHost.addEventListener("pointerleave", scheduleHideHoverToolbar);
    shadow.append(style, hoverDeleteButton);
    (document.body || document.documentElement).appendChild(hoverHost);
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
    hideHoverToolbar();
    showToolbar(range);
  }

  function onPointerUp(event) {
    if (toolbarHost?.contains(event.target) || hoverHost?.contains(event.target)) return;
    setTimeout(captureSelection, 0);
  }

  function onPointerMove(event) {
    if (
      toolbarHost?.contains(event.target) ||
      hoverHost?.contains(event.target)
    ) {
      if (hoverHideTimer) clearTimeout(hoverHideTimer);
      return;
    }
    const selection = getSelection();
    if (selection && !selection.isCollapsed) {
      scheduleHideHoverToolbar();
      return;
    }
    const x = event.clientX;
    const y = event.clientY;
    if (hoverMoveFrame) cancelAnimationFrame(hoverMoveFrame);
    hoverMoveFrame = requestAnimationFrame(() => {
      hoverMoveFrame = 0;
      const hit = anchorAtPoint(x, y);
      if (hit) showHoverToolbar(hit.id, hit.rect);
      else scheduleHideHoverToolbar();
    });
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      hideToolbar();
      hideHoverToolbar();
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
    ensureHoverToolbar();
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
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("keydown", onKeyDown, true);
    observer?.disconnect();
    if (routeTimer) clearInterval(routeTimer);
    if (applyTimer) clearTimeout(applyTimer);
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    if (hoverMoveFrame) cancelAnimationFrame(hoverMoveFrame);
    try {
      CSS.highlights?.delete(HIGHLIGHT_PREFIX);
      for (const name of Object.keys(COLORS)) {
        CSS.highlights?.delete(`${HIGHLIGHT_PREFIX}-${name}`);
      }
    } catch {}
    document.getElementById(STYLE_ID)?.remove();
    toolbarHost?.remove();
    hoverHost?.remove();
    delete window[STATE_KEY];
    return true;
  }

  loadLocalData();
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointermove", onPointerMove, true);
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
      hideHoverToolbar();
      scheduleApply(0);
    }
    if (
      !document.getElementById(STYLE_ID) ||
      !toolbarHost?.isConnected ||
      !hoverHost?.isConnected
    ) {
      ensure();
    }
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
