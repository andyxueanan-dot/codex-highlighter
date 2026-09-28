(() => {
  "use strict";

  const VERSION = "1.2.13";
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
  const RETENTION_BATCH_SIZE = 1000;
  const RETENTION_BACKUP_KEY = "codex-highlighter:pending-retention-backup:v1";
  const MAX_SELECTION_LENGTH = 5000;
  const EDITABLE_SELECTOR =
    "input,textarea,select,[contenteditable='true'],[contenteditable='']," +
    "[role='textbox'],[data-lexical-editor='true']";
  const LITERAL_TEXT_SELECTOR = "pre,code,samp,kbd,tt";
  const TABLE_CELL_SELECTOR =
    "td,th,[role='cell'],[role='gridcell'],[role='columnheader'],[role='rowheader']";
  const TABLE_ROW_SELECTOR = "tr,[role='row']";
  const TABLE_CONTAINER_SELECTOR = "table,[role='table'],[role='grid']";
  const FORMULA_SCOPE_SELECTOR = ".katex-display,.katex,mjx-container";
  const RESPONSE_ANNOTATION_SELECTOR =
    "[data-response-annotation-conversation][data-response-annotation-target]";
  const NATIVE_SELECTION_ACTION_LABELS =
    /添加到对话|在侧边聊天中提问|更多|Add to conversation|Ask in side chat|More/i;

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
  let hoverMoveTimer = 0;
  let hoverPointerX = 0;
  let hoverPointerY = 0;
  let pendingRange = null;
  let toolbarRequestToken = 0;
  const surfaceObservers = new Map();
  let routeTimer = 0;
  let applyTimer = 0;
  let applyIdleHandle = 0;
  let applyGeneration = 0;
  let applyContinuation = null;
  const applyChannel = new MessageChannel();
  applyChannel.port1.onmessage = () => {
    const continuation = applyContinuation;
    applyContinuation = null;
    if (continuation) continuation();
  };
  const scopeCache = new Map();
  const dirtyRoots = new Set();
  let hoverRects = null;
  let hoverRectsAt = 0;
  let selectionActive = false;
  let lastContextKey = "";
  let initialFullScan = true;
  let disposed = false;
  const resolvedRanges = new Map();
  let noticeTimer = 0;
  let pendingRetention = null;
  let exportBuffer = null;
  let importBuffer = null;
  const TRANSFER_CHARS = 32768;
  const MAX_DOCUMENT_CHARS = 5 * 1024 * 1024;

  function retentionNotice(message) {
    let notice = document.getElementById("codex-highlighter-notice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "codex-highlighter-notice";
      notice.setAttribute("role", "status");
      notice.style.cssText = "position:fixed;right:20px;bottom:24px;z-index:2147483646;" +
        "background:#262b32;color:white;padding:12px 16px;border-radius:12px;" +
        "font:14px/1.5 sans-serif;max-width:360px;pointer-events:none;";
      document.body.appendChild(notice);
    }
    notice.textContent = message;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => notice.remove(), 6000);
  }

  function exportRetentionBackup() {
    if (pendingRetention) return pendingRetention.serialized;
    return localStorage.getItem(RETENTION_BACKUP_KEY) || "";
  }

  function pendingRetentionBackupId() {
    try { return JSON.parse(exportRetentionBackup())?.id || ""; }
    catch { return ""; }
  }

  function acknowledgeRetentionBackup(id) {
    if (!id || pendingRetentionBackupId() !== id) return false;
    if (pendingRetention) {
      const pending = pendingRetention;
      const saved = sanitizeData(JSON.parse(localStorage.getItem(STORAGE_KEY)));
      if (saved && (saved.updatedAt > data.updatedAt ||
          (saved.updatedAt === data.updatedAt && saved.revision > data.revision))) data = saved;
      // A different window or edit superseded this selection while disk I/O was pending.
      if (data.revision !== pending.revision || data.updatedAt !== pending.updatedAt) {
        pendingRetention = null;
        retentionNotice("备份已保存；记录期间发生变化，请重新划选以安全清理。");
        return false;
      }
      const removed = new Set(pending.backup.highlights.map((item) => item.id));
      const next = {
        ...data, revision: data.revision + 1,
        updatedAt: Math.max(Date.now(), data.updatedAt + 1),
        highlights: [...data.highlights.filter((item) => !removed.has(item.id)),
          ...(pending.anchor ? [pending.anchor] : [])],
      };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
      catch (error) {
        retentionNotice(`硬盘备份已保存，但写入当前高亮失败（${error.name}），原记录保留。`);
        return false;
      }
      data = next;
      pendingRetention = null;
      scheduleApply(0);
      retentionNotice("已清理最早的 1,000 条高亮，硬盘备份已保存。");
      return true;
    }
    // Drain an unacknowledged backup left by v1.2.9 without pruning again.
    localStorage.removeItem(RETENTION_BACKUP_KEY);
    return true;
  }

  function beginExport(kind) {
    const serialized = kind === "retention" ? exportRetentionBackup() : exportData();
    if (serialized.length > MAX_DOCUMENT_CHARS) throw new Error("Document too large");
    const id = `${Date.now()}-${Math.random()}`;
    exportBuffer = { id, serialized };
    return { id, length: serialized.length };
  }

  function readExportChunk(id, offset) {
    if (!exportBuffer || exportBuffer.id !== id || !Number.isInteger(offset) || offset < 0)
      throw new Error("Invalid export transfer");
    const source = exportBuffer.serialized;
    let end = Math.min(source.length, offset + TRANSFER_CHARS);
    const last = source.charCodeAt(end - 1);
    if (end < source.length && last >= 0xd800 && last <= 0xdbff) end--;
    return source.slice(offset, end);
  }

  function endExport(id) { if (exportBuffer?.id === id) exportBuffer = null; }

  function beginImport() {
    const id = `${Date.now()}-${Math.random()}`;
    importBuffer = { id, chunks: [], length: 0 };
    return id;
  }

  function appendImportChunk(id, offset, chunk) {
    if (!importBuffer || importBuffer.id !== id || offset !== importBuffer.length ||
        typeof chunk !== "string" || chunk.length > TRANSFER_CHARS ||
        offset + chunk.length > MAX_DOCUMENT_CHARS) throw new Error("Invalid import transfer");
    importBuffer.chunks.push(chunk);
    importBuffer.length += chunk.length;
  }

  function finishImport(id) {
    if (importBuffer?.id !== id) throw new Error("Invalid import transfer");
    const serialized = importBuffer.chunks.join("");
    importBuffer = null;
    return importData(serialized);
  }

  function abortImport(id) { if (importBuffer?.id === id) importBuffer = null; }

  function addWithRetention(anchor) {
    // Another Codex window may already have rolled over this shared store.
    try {
      const saved = sanitizeData(JSON.parse(localStorage.getItem(STORAGE_KEY)));
      if (saved && (saved.updatedAt > data.updatedAt ||
          (saved.updatedAt === data.updatedAt && saved.revision > data.revision))) {
        data = saved;
      }
    } catch {}
    if (!anchor && data.highlights.length < MAX_HIGHLIGHTS - 1) return false;
    if (anchor && data.highlights.length + 1 < MAX_HIGHLIGHTS) {
      data.highlights.push(anchor);
      markChanged();
      return true;
    }
    try {
      // Keep the request in memory. No deletion until the native host confirms disk backup.
      if (exportRetentionBackup()) {
        retentionNotice("上一批高亮备份尚未写入本地，请稍后再试或启动高亮器。");
        return false;
      }
      const oldest = data.highlights.map((item, index) => ({ item, index }))
        .sort((a, b) => a.item.createdAt - b.item.createdAt || a.index - b.index)
        .slice(0, RETENTION_BATCH_SIZE).map(({ item }) => item);
      const now = Date.now();
      const backup = {
        version: 1,
        id: `auto-prune-${now}-${Math.random().toString(36).slice(2, 10)}`,
        revision: data.revision,
        updatedAt: now,
        highlights: oldest,
      };
      pendingRetention = { backup, serialized: JSON.stringify(backup), anchor,
        revision: data.revision, updatedAt: data.updatedAt };
      retentionNotice("正在保存硬盘备份，完成后自动清理并添加本次高亮，请稍候。");
      return true;
    } catch (error) {
      retentionNotice(`无法创建清理请求（${error.name}），原高亮已保留。`);
      return false;
    }
  }
  const performanceStats = {
    applyCount: 0,
    lastApplyMs: 0,
    maxApplyMs: 0,
    lastCandidateScopes: 0,
    lastFallbackAnchors: 0,
    mutationBatches: 0,
    lastToolbarMs: 0,
    maxToolbarMs: 0,
    lastApplyWallMs: 0,
    lastMaxSliceMs: 0,
    lastCacheHits: 0,
    lastRebuiltScopes: 0,
    hoverGeometryReads: 0,
    applyStarts: 0,
  };

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
      scopeIdentity: safeString(value.scopeIdentity, 256),
      scopeTag: safeString(value.scopeTag, 32),
      textModel: value.textModel === "visible-math-v1" ? "visible-math-v1" : "",
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
    const hardBlocked =
      `${EDITABLE_SELECTOR},nav,[role='dialog'],[role='menu'],` +
      `#${TOOLBAR_HOST_ID},#${HOVER_HOST_ID}`;
    if (start.closest(hardBlocked) || end.closest(hardBlocked)) return false;
    const literalStart = start.closest(LITERAL_TEXT_SELECTOR);
    const literalEnd = end.closest(LITERAL_TEXT_SELECTOR);
    const tableStart = start.closest(TABLE_CONTAINER_SELECTOR);
    const tableEnd = end.closest(TABLE_CONTAINER_SELECTOR);
    const formulaStart = formulaScope(start);
    const formulaEnd = formulaScope(end);
    const structuredSelection =
      (literalStart && literalEnd) ||
      (tableStart && tableStart === tableEnd) ||
      (formulaStart && formulaStart === formulaEnd);
    if (start.closest("button") || end.closest("button")) return false;
    const interactiveStart = start.closest("[role='button']");
    const interactiveEnd = end.closest("[role='button']");
    const startTarget = formulaStart || tableStart || literalStart;
    const endTarget = formulaEnd || tableEnd || literalEnd;
    const wrappedStart =
      !interactiveStart ||
      (structuredSelection && startTarget && interactiveStart.contains(startTarget));
    const wrappedEnd =
      !interactiveEnd ||
      (structuredSelection && endTarget && interactiveEnd.contains(endTarget));
    if (!wrappedStart || !wrappedEnd) return false;
    const exact = range.toString();
    return exact.trim().length > 0 && exact.length <= MAX_SELECTION_LENGTH;
  }

  function semanticScope(element) {
    return element.closest(
      "[data-message-id],[data-turn-id],[data-testid*='conversation-turn']," +
        `[data-testid*='message'],${RESPONSE_ANNOTATION_SELECTOR},` +
        "article,[role='article']",
    );
  }

  function formulaScope(element) {
    if (!element?.closest) return null;
    const display = element.closest(".katex-display");
    if (display) return display;
    return element.closest(".katex,mjx-container");
  }

  function formulaVisibleRoot(scope) {
    if (!scope?.matches?.(FORMULA_SCOPE_SELECTOR)) return scope;
    return scope.querySelector(".katex-html") || scope;
  }

  function scopeIdentity(element) {
    const semantic = element?.closest?.(
      "[data-message-id],[data-turn-id],[data-testid*='conversation-turn']," +
        `[data-testid*='message'],${RESPONSE_ANNOTATION_SELECTOR},` +
        "article,[role='article']",
    );
    let base = "";
    if (semantic) {
      const conversation = semantic.getAttribute("data-response-annotation-conversation");
      const target = semantic.getAttribute("data-response-annotation-target");
      if (conversation && target) {
        base = `response:${conversation}:${target}`;
      }
      for (const name of ["data-message-id", "data-turn-id", "data-testid", "id"]) {
        if (base) break;
        const value = semantic.getAttribute(name);
        if (value) {
          base = name + ":" + value;
          break;
        }
      }
    }

    const formula = formulaScope(element);
    if (formula) {
      const owner = semantic || selectionSurface(element) || pageRoot();
      const formulas = Array.from(owner.querySelectorAll(FORMULA_SCOPE_SELECTOR)).filter(
        (candidate) => formulaScope(candidate) === candidate,
      );
      const formulaIndex = Math.max(0, formulas.indexOf(formula));
      const tex =
        formula.querySelector('annotation[encoding="application/x-tex"]')
          ?.textContent || "";
      const suffix = `formula:${formulaIndex}:${fingerprint(tex || scopedText(formula))}`;
      return base ? base + "|" + suffix : suffix;
    }

    const table = element?.closest?.(TABLE_CONTAINER_SELECTOR);
    if (table) {
      const owner = semantic || selectionSurface(element) || pageRoot();
      const tables = Array.from(owner.querySelectorAll(TABLE_CONTAINER_SELECTOR)).filter(
        (candidate) =>
          candidate.closest(TABLE_CONTAINER_SELECTOR) === candidate,
      );
      const tableIndex = Math.max(0, tables.indexOf(table));
      const row = element.matches?.(TABLE_ROW_SELECTOR)
        ? element
        : element.closest(TABLE_ROW_SELECTOR);
      const cell = element.matches?.(TABLE_CELL_SELECTOR)
        ? element
        : element.closest(TABLE_CELL_SELECTOR);
      let suffix = "table:" + tableIndex;
      if (row) {
        const rows = Array.from(table.querySelectorAll(TABLE_ROW_SELECTOR)).filter(
          (candidate) =>
            candidate.closest(TABLE_CONTAINER_SELECTOR) === table,
        );
        const rowIndex = Math.max(0, rows.indexOf(row));
        suffix += ":row:" + rowIndex;
        if (cell) {
          const cells = Array.from(row.querySelectorAll(TABLE_CELL_SELECTOR)).filter(
            (candidate) =>
              candidate.closest(TABLE_ROW_SELECTOR) === row,
          );
          const cellIndex = Math.max(0, cells.indexOf(cell));
          suffix += ":cell:" + cellIndex;
        }
      }
      return base ? base + "|" + suffix : suffix;
    }

    if (base) return base;
    if (!semantic) return "";
    for (const name of ["data-message-id", "data-turn-id", "data-testid", "id"]) {
      const value = semantic.getAttribute(name);
      if (value) return `${name}:${value}`;
    }
    return "";
  }

  function chooseScope(range) {
    const start = elementForNode(range.startContainer);
    const end = elementForNode(range.endContainer);
    if (!start || !end) return null;
    const surface = selectionSurface(start);
    if (!surface || surface !== selectionSurface(end) || !surface.contains(end)) {
      return null;
    }

    const startFormula = formulaScope(start);
    const endFormula = formulaScope(end);
    if (startFormula && startFormula === endFormula) return startFormula;

    const literal = start.closest(LITERAL_TEXT_SELECTOR);
    if (literal && literal.contains(range.endContainer)) {
      const pre = literal.closest("pre");
      return pre && pre.contains(range.endContainer) ? pre : literal;
    }

    const startCell = start.closest(TABLE_CELL_SELECTOR);
    const endCell = end.closest(TABLE_CELL_SELECTOR);
    if (startCell && endCell) {
      if (startCell === endCell) return startCell;
      const startRow = startCell.closest(TABLE_ROW_SELECTOR);
      const endRow = endCell.closest(TABLE_ROW_SELECTOR);
      if (startRow && startRow === endRow) return startRow;
      const startTable = startCell.closest(TABLE_CONTAINER_SELECTOR);
      const endTable = endCell.closest(TABLE_CONTAINER_SELECTOR);
      if (startTable && startTable === endTable) return startTable;
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
      "CODE",
      "SAMP",
      "KBD",
      "TT",
      "TABLE",
      "THEAD",
      "TBODY",
      "TFOOT",
      "TR",
      "TH",
      "TD",
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

  function offsetWithin(scope, container, offset, visibleMath = false) {
    if (!container || !scope.contains(container)) return -1;
    let point = null;
    if (container.nodeType !== Node.TEXT_NODE) {
      point = document.createRange();
      try { point.setStart(container, offset); point.collapse(true); }
      catch { return -1; }
    }
    let position = 0;
    for (const node of textNodes(scope, visibleMath)) {
      if (node === container) {
        return position + Math.min(Math.max(0, offset), node.data.length);
      }
      if (point && point.comparePoint(node, 0) >= 0) return position;
      position += node.data.length;
    }
    return point ? position : -1;
  }

  function createAnchor(range, color = "yellow") {
    const anchorRange = normalizeFormulaRange(range);
    const scope = chooseScope(anchorRange);
    if (!scope) return null;
    const visibleMath = Boolean(formulaScope(scope) || scope.querySelector(".katex"));
    const scopeText = scopedText(scope, visibleMath);
    const start = offsetWithin(
      scope,
      anchorRange.startContainer,
      anchorRange.startOffset,
      visibleMath,
    );
    const end = offsetWithin(scope, anchorRange.endContainer, anchorRange.endOffset, visibleMath);
    if (start < 0 || end <= start) return null;
    const exact = scopeText.slice(start, end);
    return sanitizeAnchor({
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      contextKey: contextKey(),
      scopeHash: fingerprint(scopeText),
      scopeIdentity: scopeIdentity(scope),
      scopeTag: scope.tagName || "",
      textModel: visibleMath ? "visible-math-v1" : "",
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

  function normalizeFormulaRange(range) {
    if (!range) return range;
    const normalized = range.cloneRange();
    // Handle each endpoint independently, including prose -> MathML selections.
    for (const side of ["end", "start"]) {
      const element = elementForNode(range[`${side}Container`]);
      const formula = formulaScope(element);
      if (!formula || !element.closest(".katex-mathml")) continue;
      const visible = formulaVisibleRoot(formula);
      if (visible === formula) continue;
      const nodes = textNodes(visible, true);
      if (!nodes.length) continue;
      if (side === "start") normalized.setStart(nodes[0], 0);
      else normalized.setEnd(nodes.at(-1), nodes.at(-1).data.length);
    }
    return normalized;
  }

  function isHiddenMathText(node) {
    return Boolean(node.parentElement?.closest(".katex-mathml"));
  }

  function textNodes(root, visibleMath = false) {
    const nodes = [];
    const traversalRoot = formulaVisibleRoot(root);
    const walker = document.createTreeWalker(traversalRoot, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (visibleMath && isHiddenMathText(node)) return NodeFilter.FILTER_REJECT;
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

  function scopedText(root, visibleMath = false) {
    return textNodes(root, visibleMath)
      .map((node) => node.data)
      .join("");
  }

  function rangeFromOffsets(scope, start, end, visibleMath = false) {
    if (start < 0 || end <= start) return null;
    const range = document.createRange();
    let position = 0;
    let started = false;
    for (const node of textNodes(scope, visibleMath)) {
      const next = position + node.data.length;
      if (!started && start >= position && start < next) {
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
    const surfaces = transcriptSurfaces();
    if (surfaces.length === 0) return [];
    const result = [];
    const seen = new Set();
    const add = (node) => {
      if (!node || seen.has(node) || node === toolbarHost) return;
      if (
        node.matches?.(FORMULA_SCOPE_SELECTOR) &&
        formulaScope(node) !== node
      ) {
        return;
      }
      if (node.matches?.(EDITABLE_SELECTOR) || node.closest?.(EDITABLE_SELECTOR)) {
        return;
      }
      const length = (node.textContent || "").length;
      if (!length || length > 50000) return;
      seen.add(node);
      result.push(node);
    };
    for (const surface of surfaces) {
      for (const node of surface.querySelectorAll(
        "[data-message-id],[data-turn-id],[data-testid*='conversation-turn']," +
          `[data-testid*='message'],${RESPONSE_ANNOTATION_SELECTOR},` +
          "article,[role='article'],p,li,pre,code,samp,kbd,tt," +
          `${FORMULA_SCOPE_SELECTOR},` +
          "table,thead,tbody,tfoot,tr,th,td,[role='table'],[role='grid']," +
          "[role='row'],[role='cell'],[role='gridcell'],[role='columnheader'],[role='rowheader']," +
          "blockquote,h1,h2,h3,h4,h5,h6",
      )) {
        add(node);
        if (result.length >= 2000) break;
      }
      add(surface);
      if (result.length >= 2000) break;
    }
    return result;
  }

  function* buildScopeIndex(stats) {
    const records = [];
    const byHash = new Map();
    const byIdentity = new Map();
    const hiddenMath = new WeakMap();
    const dirty = Array.from(dirtyRoots);
    for (const scope of candidateScopes()) {
      let record = scopeCache.get(scope);
      if (record && !dirty.some(root => root.contains(scope) || scope.contains(root))) {
        stats.hits += 1;
      } else {
        const nodes = textNodes(scope);
        const text = nodes.map((node) => node.data).join("");
        if (!text) { scopeCache.delete(scope); yield; continue; }
        const visibleText = nodes.filter((node) => {
          if (!hiddenMath.has(node)) hiddenMath.set(node, isHiddenMathText(node));
          return !hiddenMath.get(node);
        }).map((node) => node.data).join("");
        record = {
          scope,
          text,
          visibleText,
          visibleHash: fingerprint(visibleText),
          hash: fingerprint(text),
          identity: scopeIdentity(scope),
        };
        scopeCache.set(scope, record);
        stats.rebuilt += 1;
      }
      records.push(record);
      if (!byHash.has(record.hash)) byHash.set(record.hash, []);
      byHash.get(record.hash).push(record);
      if (record.visibleHash !== record.hash) {
        if (!byHash.has(record.visibleHash)) byHash.set(record.visibleHash, []);
        byHash.get(record.visibleHash).push(record);
      }
      if (record.identity) {
        if (!byIdentity.has(record.identity)) byIdentity.set(record.identity, []);
        byIdentity.get(record.identity).push(record);
      }
      yield;
    }
    return { records, byHash, byIdentity };
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

  function anchorToRange(anchor, index, allowFallback) {
    const visibleMath = anchor.textModel === "visible-math-v1";
    const currentContext = contextKey();
    if (
      anchor.contextKey &&
      currentContext &&
      anchor.contextKey !== currentContext
    ) {
      return null;
    }
    let best = null;
    const candidates = [];
    const seen = new Set();
    const addRecords = (records) => {
      for (const record of records || []) {
        if (seen.has(record.scope)) continue;
        seen.add(record.scope);
        candidates.push(record);
      }
    };
    if (anchor.scopeIdentity) addRecords(index.byIdentity.get(anchor.scopeIdentity));
    addRecords(index.byHash.get(anchor.scopeHash));
    if (allowFallback) {
      addRecords(
        index.records.filter(
          (record) =>
            !anchor.scopeTag || record.scope.tagName === anchor.scopeTag,
        ),
      );
    }

    for (const record of candidates) {
      const scope = record.scope;
      if (visibleMath && anchor.scopeIdentity && record.identity !== anchor.scopeIdentity) continue;
      const text = visibleMath ? record.visibleText : record.text;
      if (text.length < anchor.exact.length) continue;
      const hashMatches = (visibleMath ? record.visibleHash : record.hash) === anchor.scopeHash;
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
    const range = rangeFromOffsets(best.scope, best.start, best.end, visibleMath);
    // A DOM Range spanning prose and math also crosses the clipped accessibility
    // copy. Offsets above were verified against visible text, not that raw copy.
    return range && (visibleMath || range.toString() === anchor.exact) ? range : null;
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
    applyIdleHandle = 0;
    if (disposed || !supportsHighlights) return;
    performanceStats.applyStarts += 1;
    const started = performance.now();
    const generation = applyGeneration;
    const stats = { hits: 0, rebuilt: 0, cpu: 0, maxSlice: 0 };
    const job = rebuildHighlights(stats);
    function step() {
      if (disposed || generation !== applyGeneration) return;
      const sliceStart = performance.now();
      let result;
      do {
        result = job.next();
      } while (!result.done && performance.now() - sliceStart < 6);
      const elapsed = performance.now() - sliceStart;
      stats.cpu += elapsed;
      stats.maxSlice = Math.max(stats.maxSlice, elapsed);
      if (!result.done) {
        // Timer clamping in hidden Codex windows can turn every zero-delay slice
        // into a one-second wait. Posted tasks yield without that timer backlog.
        applyContinuation = step;
        applyChannel.port2.postMessage(null);
        return;
      }
      performanceStats.applyCount += 1;
      performanceStats.lastApplyMs = Math.round(stats.cpu * 10) / 10;
      performanceStats.maxApplyMs = Math.max(performanceStats.maxApplyMs, performanceStats.lastApplyMs);
      performanceStats.lastApplyWallMs = Math.round((performance.now() - started) * 10) / 10;
      performanceStats.lastMaxSliceMs = Math.round(stats.maxSlice * 10) / 10;
      performanceStats.lastCacheHits = stats.hits;
      performanceStats.lastRebuiltScopes = stats.rebuilt;
    }
    step();
  }

  function* rebuildHighlights(stats) {
    ensureStyle();
    const groups = new Map(
      Object.keys(COLORS).map((name) => [name, new Highlight()]),
    );
    const index = yield* buildScopeIndex(stats);
    const previouslyResolved = new Set(resolvedRanges.keys());
    const nextRanges = new Map();
    let fallbackAnchors = 0;
    for (const anchor of data.highlights) {
      const allowFallback = initialFullScan || previouslyResolved.has(anchor.id);
      if (allowFallback) fallbackAnchors += 1;
      const range = anchorToRange(anchor, index, allowFallback);
      if (range) {
        groups.get(anchor.color || "yellow").add(range);
        nextRanges.set(anchor.id, range);
      }
      yield;
    }
    // Commit only a complete, current generation; canceled jobs never replace
    // the visible highlights or discard invalidations from a streaming update.
    resolvedRanges.clear();
    for (const [id, range] of nextRanges) resolvedRanges.set(id, range);
    const liveScopes = new Set(index.records.map(record => record.scope));
    for (const scope of scopeCache.keys()) if (!liveScopes.has(scope)) scopeCache.delete(scope);
    dirtyRoots.clear();
    invalidateHoverGeometry();
    CSS.highlights.delete(HIGHLIGHT_PREFIX);
    for (const [name, group] of groups) {
      CSS.highlights.set(`${HIGHLIGHT_PREFIX}-${name}`, group);
    }
    initialFullScan = false;
    performanceStats.lastCandidateScopes = index.records.length;
    performanceStats.lastFallbackAnchors = fallbackAnchors;
  }

  function scheduleApply(delay = 1000) {
    if (disposed) return;
    // Coalesce continuous clock/stream updates without indefinitely moving the
    // deadline. Explicit edits still preempt the background job immediately.
    if (delay > 0 && (applyTimer || applyIdleHandle)) return;
    if (initialFullScan) delay = Math.min(delay, 20);
    applyGeneration += 1;
    applyContinuation = null;
    if (applyTimer) clearTimeout(applyTimer);
    if (applyIdleHandle && "cancelIdleCallback" in window) {
      cancelIdleCallback(applyIdleHandle);
      applyIdleHandle = 0;
    }
    applyTimer = setTimeout(() => {
      applyTimer = 0;
      if (delay === 0 || initialFullScan || !("requestIdleCallback" in window)) {
        applyHighlights();
        return;
      }
      applyIdleHandle = requestIdleCallback(applyHighlights, { timeout: 2000 });
    }, delay);
  }

  function matchingAnchorIds(range) {
    const selected = normalizeFormulaRange(range);
    if (!selected) return [];
    const matching = [];
    for (const [id, resolved] of resolvedRanges) {
      if (
        !resolved?.startContainer?.isConnected ||
        !resolved?.endContainer?.isConnected
      ) {
        continue;
      }
      try {
        if (
          resolved.startContainer.getRootNode() !==
          selected.startContainer.getRootNode()
        ) {
          continue;
        }
        const endsAfterSelectionStarts =
          resolved.compareBoundaryPoints(Range.END_TO_START, selected) < 0;
        const startsBeforeSelectionEnds =
          resolved.compareBoundaryPoints(Range.START_TO_END, selected) > 0;
        if (endsAfterSelectionStarts && startsBeforeSelectionEnds) {
          matching.push(id);
        }
      } catch {
      }
    }
    return matching;
  }

  function hideToolbar() {
    toolbarRequestToken += 1;
    if (toolbarHost) toolbarHost.style.display = "none";
    pendingRange = null;
  }

  function resetToolbarMode() {
    if (!toolbarHost || !deleteButton) return;
    deleteButton.style.display = "none";
    for (const button of colorButtons.values()) {
      button.dataset.active = "false";
    }
    toolbarHost.style.width = "150px";
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
    const rects = [];
    for (const node of document.querySelectorAll("button,[role='button']")) {
      if (!NATIVE_SELECTION_ACTION_LABELS.test((node.textContent || "").trim())) continue;
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const nearX = rect.right >= selectionRect.left - 280 && rect.left <= selectionRect.right + 280;
      const nearY = rect.bottom >= selectionRect.top - 160 && rect.top <= selectionRect.bottom + 160;
      if (nearX && nearY) rects.push(rect);
    }
    return rects;
  }

  function placeFloatingHost(
    host,
    anchorRect,
    width,
    height,
    preferBelow = true,
    avoidNativeMenus = true,
  ) {
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
    const obstacles = avoidNativeMenus
      ? nearbyNativeMenuRects(anchorRect)
      : [];
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

  function showToolbar(range, startedAt = performance.now()) {
    ensureToolbar();
    pendingRange = range.cloneRange();
    const rects = Array.from(range.getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    const rect = rects.at(-1) || range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return hideToolbar();
    const requestToken = ++toolbarRequestToken;
    resetToolbarMode();
    toolbarHost.style.display = "block";
    const height = 34;
    placeFloatingHost(toolbarHost, rect, 150, height, true, false);
    const elapsed = performance.now() - startedAt;
    performanceStats.lastToolbarMs = Math.round(elapsed * 10) / 10;
    performanceStats.maxToolbarMs = Math.max(
      performanceStats.maxToolbarMs,
      performanceStats.lastToolbarMs,
    );
    requestAnimationFrame(() => {
      if (
        requestToken !== toolbarRequestToken ||
        toolbarHost?.style.display !== "block" ||
        !pendingRange
      ) {
        return;
      }
      const width = updateToolbarMode(pendingRange);
      placeFloatingHost(toolbarHost, rect, width, height, true, true);
    });
    setTimeout(() => {
      if (
        requestToken === toolbarRequestToken &&
        toolbarHost?.style.display === "block"
      ) {
        const width = Number.parseInt(toolbarHost.style.width, 10) || 150;
        placeFloatingHost(toolbarHost, rect, width, height, true, true);
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
    } else {
      const anchor = createAnchor(pendingRange, color);
      if (anchor) {
        addWithRetention(anchor);
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
    if (!hoverRects || performance.now() - hoverRectsAt > 250) {
      hoverRects = [];
      for (const [id, range] of resolvedRanges) {
        if (!range.startContainer.isConnected || !range.endContainer.isConnected) continue;
        performanceStats.hoverGeometryReads += 1;
        for (const rect of range.getClientRects()) hoverRects.push({ id, rect });
      }
      hoverRectsAt = performance.now();
    }
    for (const { id, rect } of hoverRects) {
        if (
          x >= rect.left - 1 &&
          x <= rect.right + 1 &&
          y >= rect.top - 2 &&
          y <= rect.bottom + 2
        ) {
          return { id, rect };
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

  function captureSelection(startedAt = performance.now()) {
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
    hideHoverToolbar();
    showToolbar(range, startedAt);
  }

  function onPointerUp(event) {
    if (toolbarHost?.contains(event.target) || hoverHost?.contains(event.target)) return;
    if (closestNativeSelectionAction(event.target)) return;
    const startedAt = performance.now();
    setTimeout(() => captureSelection(startedAt), 0);
  }

  function closestNativeSelectionAction(target) {
    const element = elementForNode(target);
    const action = element?.closest?.("button,[role='button']");
    if (!action) return null;
    return NATIVE_SELECTION_ACTION_LABELS.test((action.textContent || "").trim())
      ? action
      : null;
  }

  function onPointerDown(event) {
    if (!closestNativeSelectionAction(event.target)) return;
    hideToolbar();
    hideHoverToolbar();
  }

  function onPointerMove(event) {
    // No selection/layout queries in the high-frequency pointer callback.
    if (event.buttons || selectionActive || !resolvedRanges.size) return;
    if (
      toolbarHost?.contains(event.target) ||
      hoverHost?.contains(event.target)
    ) {
      if (hoverHideTimer) clearTimeout(hoverHideTimer);
      return;
    }
    const x = event.clientX;
    const y = event.clientY;
    hoverPointerX = x;
    hoverPointerY = y;
    if (hoverMoveTimer) return;
    hoverMoveTimer = setTimeout(() => {
      hoverMoveTimer = 0;
      if (selectionActive || disposed) return;
      const hit = anchorAtPoint(hoverPointerX, hoverPointerY);
      if (hit) showHoverToolbar(hit.id, hit.rect);
      else scheduleHideHoverToolbar();
    }, 80);
  }

  function invalidateHoverGeometry() {
    hoverRects = null;
  }

  function onSelectionChange() {
    const selection = getSelection();
    selectionActive = Boolean(selection && !selection.isCollapsed);
    if (selectionActive) hideHoverToolbar();
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
    refreshSurfaceObservers();
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

  function syncState() {
    return {
      version: VERSION,
      revision: data.revision,
      updatedAt: data.updatedAt,
      count: data.highlights.length,
      retentionBackupId: pendingRetentionBackupId(),
    };
  }

  function diagnostics() {
    return {
      ...health(),
      ...performanceStats,
      observedSurfaces: surfaceObservers.size,
    };
  }

  function transcriptSurfaces() {
    const root = pageRoot();
    if (!root) return [];
    const candidates = Array.from(
      root.querySelectorAll(
        "main,aside,[data-side-chat],[data-testid*='side-chat']," +
          "[data-testid*='sidecar']",
      ),
    ).filter(
      (node) =>
        !node.matches(EDITABLE_SELECTOR) &&
        !node.closest(`#${TOOLBAR_HOST_ID},#${HOVER_HOST_ID}`),
    );
    return candidates.filter(
      (node) =>
        !candidates.some(
          (other) => other !== node && other.contains(node),
        ),
    );
  }

  function mutationIsRelevant(record) {
    const element = elementForNode(record.target);
    if (!element) return false;
    if (record.type === "attributes" && record.attributeName === "class" &&
        !element.closest(FORMULA_SCOPE_SELECTOR) &&
        !/katex|mjx-|MathJax/.test(record.oldValue || "")) return false;
    if (
      element.closest(
        `${EDITABLE_SELECTOR},#${TOOLBAR_HOST_ID},#${HOVER_HOST_ID}`,
      )
    ) {
      return false;
    }
    return record.type === "childList" || record.type === "characterData" || record.type === "attributes";
  }

  function onTranscriptMutations(records) {
    let relevant = false;
    for (const record of records) {
      if (!mutationIsRelevant(record)) continue;
      relevant = true;
      const element = elementForNode(record.target);
      // Structural edits can change formula/table ordinals in their owner.
      const root = record.type === "characterData" ? element :
        element.closest(`${RESPONSE_ANNOTATION_SELECTOR},[data-message-id],[data-turn-id],article,[role='article']`) || element.parentElement || element;
      if (!Array.from(dirtyRoots).some(existing => existing.contains(root))) {
        for (const existing of dirtyRoots) if (root.contains(existing)) dirtyRoots.delete(existing);
        dirtyRoots.add(root);
      }
    }
    if (!relevant) return;
    invalidateHoverGeometry();
    performanceStats.mutationBatches += 1;
    scheduleApply();
  }

  function refreshSurfaceObservers() {
    const surfaces = new Set(transcriptSurfaces());
    let changed = false;
    for (const [surface, surfaceObserver] of surfaceObservers) {
      if (surfaces.has(surface) && surface.isConnected) continue;
      surfaceObserver.disconnect();
      surfaceObservers.delete(surface);
      changed = true;
    }
    for (const surface of surfaces) {
      if (surfaceObservers.has(surface)) continue;
      changed = true;
      const surfaceObserver = new MutationObserver(onTranscriptMutations);
      surfaceObserver.observe(surface, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["data-message-id", "data-turn-id", "data-testid", "id",
          "data-response-annotation-conversation", "data-response-annotation-target", "class", "role", "contenteditable"],
      });
      surfaceObservers.set(surface, surfaceObserver);
    }
    if (changed) {
      scopeCache.clear();
      scheduleApply();
    }
  }

  function cleanup() {
    if (disposed) return true;
    disposed = true;
    clearTimeout(noticeTimer);
    document.getElementById("codex-highlighter-notice")?.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("selectionchange", onSelectionChange);
    document.removeEventListener("scroll", invalidateHoverGeometry, true);
    window.removeEventListener("resize", invalidateHoverGeometry);
    for (const surfaceObserver of surfaceObservers.values()) {
      surfaceObserver.disconnect();
    }
    surfaceObservers.clear();
    if (routeTimer) clearInterval(routeTimer);
    if (applyTimer) clearTimeout(applyTimer);
    applyGeneration += 1;
    applyContinuation = null;
    applyChannel.port1.close();
    applyChannel.port2.close();
    scopeCache.clear();
    dirtyRoots.clear();
    if (applyIdleHandle && "cancelIdleCallback" in window) {
      cancelIdleCallback(applyIdleHandle);
    }
    if (hoverHideTimer) clearTimeout(hoverHideTimer);
    if (hoverMoveTimer) clearTimeout(hoverMoveTimer);
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
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("scroll", invalidateHoverGeometry, true);
  window.addEventListener("resize", invalidateHoverGeometry);
  onSelectionChange();
  refreshSurfaceObservers();
  lastContextKey = contextKey();
  routeTimer = setInterval(() => {
    const current = contextKey();
    if (current !== lastContextKey) {
      lastContextKey = current;
      initialFullScan = true;
      scopeCache.clear();
      hideToolbar();
      hideHoverToolbar();
      scheduleApply(0);
    }
    refreshSurfaceObservers();
    if (
      !document.getElementById(STYLE_ID) ||
      !toolbarHost?.isConnected ||
      !hoverHost?.isConnected
    ) {
      ensure();
    }
  }, 2500);

  window[STATE_KEY] = {
    version: VERSION,
    ensure,
    cleanup,
    health,
    syncState,
    diagnostics,
    importData,
    exportData,
    beginExport, readExportChunk, endExport,
    beginImport, appendImportChunk, finishImport, abortImport,
    exportRetentionBackup,
    acknowledgeRetentionBackup,
    requestRetention: () => addWithRetention(null),
  };
  ensure();
  return health();
})();
