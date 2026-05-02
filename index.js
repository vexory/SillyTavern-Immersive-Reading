import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const MODULE_NAME = "st-immersive-reading";
const MODULE_DISPLAY_NAME = "沉浸式阅读";
const AUTHOR = "vexory";
const VERSION = "2.1.0";

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    userMode: "normal",
    toolsMode: "always",
    fontFamily: "system",
    customFontFamily: "",
    fontSize: 18,
    lineHeight: 1.82,
    paragraphGap: 0.34,
    indent: 2,
    contentWidth: 42,
    sidePadding: 1.05,
    indentMode: "firstline",
    splitBrToParagraph: true,
    justifyText: true,
    layoutMode: "follow",
});

const NUMERIC_LIMITS = Object.freeze({
    fontSize: [14, 28],
    lineHeight: [1.35, 2.3],
    paragraphGap: [0, 1.2],
    indent: [0, 4],
    contentWidth: [18, 72],
    sidePadding: [0.2, 3.2],
});

const ENUMS = Object.freeze({
    userMode: new Set(["normal", "folded", "hidden"]),
    toolsMode: new Set(["always", "folded"]),
    fontFamily: new Set(["system", "custom"]),
    indentMode: new Set(["firstline", "block", "off"]),
    layoutMode: new Set(["follow", "clean"]),
});

const READER_CLASSES = [
    "stir-reader-active",
    "stir-font-follow", "stir-font-custom",
    "stir-user-folded", "stir-user-normal", "stir-user-hidden",
    "stir-tools-folded", "stir-tools-always",
    "stir-indent-firstline", "stir-indent-block", "stir-indent-off",
    "stir-layout-follow", "stir-layout-clean",
    "stir-justify-text",
];

const NATIVE_CONTROL_SELECTOR = [
    "button", "a", "input", "textarea", "select", "option", "summary", "details",
    "[contenteditable='true']", ".swipe_left", ".swipe_right",
    ".mes_buttons", ".extraMesButtons", ".extra_mes_buttons", ".mes_edit_buttons",
    ".mes_button", ".mes_edit", ".mes_delete", ".mes_copy", ".mes_more", ".menu_button",
    "[class*='mes_edit']", "[class*='mes_button']", "[class*='extraMes']",
].join(",");

const HEADER_SELECTOR = [
    ".mesAvatarWrapper", ".ch_name", ".name_text", ".mes_name", ".avatar",
    ".mes_timer", ".timestamp", ".mesIDDisplay", ".tokenCounterDisplay",
    ".mes_model", ".mes_meta", ".mes_header",
].join(",");

const NATIVE_ONLY_SELECTOR = [
    "script", "style", "link[rel='stylesheet']", "form", "input", "button", "select", "textarea", "canvas", "iframe",
    "[contenteditable='true']", "[onclick]", "[onchange]", "[oninput]", "[onmousedown]", "[onmouseup]", "[ontouchstart]",
    ".mes_reasoning", ".stscript", ".world_entry", ".qr--buttons",
    ".user-avatar", ".user_avatar", ".char-avatar", ".char_avatar",
    "[data-stir-native]", "[data-stir-frontend]", "[data-tavern-helper]", "[data-js-slash-runner]",
].join(",");

const FRONTEND_CODE_SELECTOR = "pre, code";
const FRONTEND_CODE_RE = /<(?:!doctype\s+html|html\b|body\b|script\b|iframe\b|canvas\b|button\b|form\b)/i;
const FRONTEND_CODE_BODY_RE = /<body\b[\s\S]*<\/body>/i;

const PRESERVE_TAGS = new Set([
    "TABLE", "PRE", "UL", "OL", "DL", "MENU",
    "IMG", "VIDEO", "AUDIO", "SVG", "PICTURE", "FIGURE",
    "DETAILS", "BLOCKQUOTE", "HR",
    "H1", "H2", "H3", "H4", "H5", "H6",
]);

const VISUAL_ISLAND_STYLE_RE = /(?:^|;)\s*(?:display\s*:\s*(?:flex|grid|inline-flex|inline-grid)|position\s*:\s*(?:absolute|fixed|sticky)|writing-mode\s*:|background(?:-color|-image)?\s*:|border(?:-[^:]+)?\s*:|box-shadow\s*:|width\s*:|height\s*:|min-width\s*:|min-height\s*:|max-width\s*:|max-height\s*:|transform\s*:|container-type\s*:)/i;
const VISUAL_ISLAND_CLASS_RE = /(?:^|[-_\s])(?:card|panel|frontend|status|stats?|mvu|dashboard|inventory|profile|meter|bar|widget|ui)(?:$|[-_\s])/i;

const FLOW_CONTAINER_TAGS = new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "ASIDE", "HEADER", "FOOTER"]);

const MIXED_PROJECTION_CLASS = "stir-mixed-reader-projection";
const MIXED_SOURCE_CLASS = "stir-mixed-source-hidden";
const MIXED_SOURCE_RUN_ATTR = "data-stir-mixed-source-run";
const PARAGRAPH_TAGS = new Set(["P"]);

const LEADING_INDENT_RE = /^[\u0020\u00A0\u3000\uFEFF\u200B\t]+/;
const VIEWPORT_MARGIN = "800px 0px";
const BIG_BATCH_THRESHOLD = 24;
const STREAMING_THROTTLE_MS = 110;
const STREAMING_GRACE_MS = 380;
const BOOT_TIMEOUT_MS = 20_000;

let mutationObserver = null;
let intersectionObserver = null;
let observerTarget = null;
let panelBootAbortController = null;
let chatBootAbortController = null;
let panelEventAbortController = null;

let renderScheduled = false;
let renderTimerId = null;
let isRendering = false;
let streamingDeadline = 0;
let hotSettings = null;

const messageState = new WeakMap();
const dirtyMessages = new Set();

/* -------------------- Settings -------------------- */

function settings() {
    let s = extension_settings[MODULE_NAME];
    if (!s || typeof s !== "object") s = extension_settings[MODULE_NAME] = {};

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!(key in s)) s[key] = value;
    }
    normalizeSettings(s);
    return s;
}

function normalizeSettings(s) {
    for (const [key, set] of Object.entries(ENUMS)) {
        if (!set.has(s[key])) s[key] = DEFAULT_SETTINGS[key];
    }
    for (const [key, [min, max]] of Object.entries(NUMERIC_LIMITS)) {
        const value = Number(s[key]);
        s[key] = Number.isFinite(value) ? clamp(value, min, max) : DEFAULT_SETTINGS[key];
    }
    s.enabled = Boolean(s.enabled);
    s.splitBrToParagraph = Boolean(s.splitBrToParagraph);
    s.justifyText = Boolean(s.justifyText);
    s.customFontFamily = String(s.customFontFamily || "");
}

function activeSettings() {
    return hotSettings || settings();
}

function persist() {
    saveSettingsDebounced();
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getState(mes) {
    let st = messageState.get(mes);
    if (!st) {
        st = {
            revision: 0,
            renderKey: "",
            visible: null,
            everRendered: false,
            pendingRender: false,
            observed: false,
            headerAbort: null,
        };
        messageState.set(mes, st);
    }
    return st;
}

function projectionSettingsKey(s, userMes, isEditing) {
    return [
        s.userMode,
        s.splitBrToParagraph ? "br1" : "br0",
        s.indentMode,
        userMes ? "user" : "ai",
        isEditing ? "edit" : "view",
    ].join("|");
}

/* -------------------- Settings panel -------------------- */

function initPanel() {
    if (document.getElementById("stir_settings_panel")) return true;

    const target = document.querySelector("#extensions_settings2") || document.querySelector("#extensions_settings");
    if (!target) return false;

    target.insertAdjacentHTML("beforeend", `
        <div id="stir_settings_panel" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${MODULE_DISPLAY_NAME}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input id="stir_enabled" type="checkbox">
                    <span>启用阅读排版</span>
                </label>

                <div class="stir-section-title">消息显示</div>
                <div class="stir-row stir-row-compact">
                    <label for="stir_user_mode">用户消息</label>
                    <select id="stir_user_mode">
                        <option value="normal">原样显示</option>
                        <option value="folded">折叠为分隔线</option>
                        <option value="hidden">隐藏正文</option>
                    </select>

                    <label for="stir_tools_mode">原生工具</label>
                    <select id="stir_tools_mode">
                        <option value="always">原样显示</option>
                        <option value="folded">折叠</option>
                    </select>
                </div>

                <div class="stir-section-title">正文排版</div>
                <div class="stir-row stir-row-compact">
                    <label for="stir_font_family">字体</label>
                    <select id="stir_font_family">
                        <option value="system">跟随酒馆</option>
                        <option value="custom">自定义</option>
                    </select>
                </div>

                <div class="stir-row stir-custom-font-row">
                    <label for="stir_custom_font">自定义字体</label>
                    <input id="stir_custom_font" type="text" placeholder="例如：LXGW WenKai, 'Noto Serif SC', serif">
                    <div class="stir-inline-help">填写 CSS font-family 值；多个字体用英文逗号分隔；字体名含空格建议加英文引号；不要写 font-family:。</div>
                </div>

                <div class="stir-grid">
                    ${numericControlHtml("字号(px)", "font_size", 14, 28, 1)}
                    ${numericControlHtml("行高(倍)", "line_height", 1.35, 2.3, 0.01)}
                    ${numericControlHtml("段距(em)", "paragraph_gap", 0, 1.2, 0.02)}
                    ${numericControlHtml("缩进(em)", "indent", 0, 4, 0.1)}
                    ${numericControlHtml("最大宽度(rem)", "content_width", 18, 72, 1)}
                    ${numericControlHtml("边距(rem)", "side_padding", 0.2, 3.2, 0.05)}
                </div>

                <div class="stir-row stir-row-compact">
                    <label for="stir_indent_mode">缩进方式</label>
                    <select id="stir_indent_mode">
                        <option value="firstline">首行缩进</option>
                        <option value="block">整段缩进</option>
                        <option value="off">不缩进</option>
                    </select>
                </div>

                <div class="stir-row stir-flags">
                    <label class="checkbox_label"><input id="stir_split_br" type="checkbox"> 单换行变段落</label>
                    <label class="checkbox_label"><input id="stir_justify_text" type="checkbox"> 两端对齐</label>
                </div>

                <div class="stir-section-title">兼容性</div>
                <div class="stir-row stir-row-compact">
                    <label for="stir_layout_mode">布局兼容</label>
                    <select id="stir_layout_mode">
                        <option value="follow">跟随酒馆布局</option>
                        <option value="clean">清理消息外壳</option>
                    </select>
                </div>

                <div class="stir-note">“清理消息外壳”只修正第三方主题挤压问题，不接管主题颜色。</div>

                <div class="stir-footer-wrap">
                    <button type="button" class="stir-footer-trigger" aria-label="关于" aria-expanded="false">
                        <span class="stir-footer-icon" aria-hidden="true">ⓘ</span>
                        <span class="stir-footer-version">v${VERSION}</span>
                    </button>
                    <div class="stir-about-popover" hidden role="dialog" aria-label="关于">
                        <div class="stir-about-title">${MODULE_DISPLAY_NAME}</div>
                        <div class="stir-about-row"><span>Version</span><b>${VERSION}</b></div>
                        <div class="stir-about-row"><span>Author</span><b>${AUTHOR}</b></div>
                    </div>
                </div>
            </div>
        </div>`);

    hydratePanel();
    bindPanelEvents();
    return true;
}

function numericControlHtml(label, idPart, min, max, step) {
    return `
        <label>${label} <input id="stir_${idPart}" type="range" min="${min}" max="${max}" step="${step}"></label>
        <input id="stir_${idPart}_num" class="stir-number-input" type="number" min="${min}" max="${max}" step="${step}">`;
}

function bootPanelWhenReady() {
    if (initPanel()) return;

    panelBootAbortController?.abort();
    const controller = new AbortController();
    panelBootAbortController = controller;

    let timerId = 0;
    const observer = new MutationObserver(() => {
        if (initPanel()) cleanupPanelBoot(controller, observer, timerId);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    timerId = window.setTimeout(() => {
        cleanupPanelBoot(controller, observer, timerId);
        initPanel();
    }, BOOT_TIMEOUT_MS);

    controller.signal.addEventListener("abort", () => cleanupPanelBoot(controller, observer, timerId), { once: true });
}

function cleanupPanelBoot(controller, observer, timerId) {
    observer.disconnect();
    if (timerId) window.clearTimeout(timerId);
    if (panelBootAbortController === controller) panelBootAbortController = null;
}

function hydratePanel() {
    const s = settings();
    $("#stir_enabled").prop("checked", s.enabled);
    $("#stir_user_mode").val(s.userMode);
    $("#stir_tools_mode").val(s.toolsMode);
    $("#stir_font_family").val(s.fontFamily);
    $("#stir_custom_font").val(s.customFontFamily);
    $("#stir_indent_mode").val(s.indentMode);
    $("#stir_layout_mode").val(s.layoutMode);
    $("#stir_split_br").prop("checked", s.splitBrToParagraph);
    $("#stir_justify_text").prop("checked", s.justifyText);
    updateNumbers();
    updateCustomFontVisibility();
}

function updateNumbers() {
    const s = settings();
    const pairs = [
        ["#stir_font_size", "#stir_font_size_num", s.fontSize],
        ["#stir_line_height", "#stir_line_height_num", s.lineHeight],
        ["#stir_paragraph_gap", "#stir_paragraph_gap_num", s.paragraphGap],
        ["#stir_indent", "#stir_indent_num", s.indent],
        ["#stir_content_width", "#stir_content_width_num", s.contentWidth],
        ["#stir_side_padding", "#stir_side_padding_num", s.sidePadding],
    ];
    const active = document.activeElement;
    for (const [range, number, value] of pairs) {
        if (active !== document.querySelector(range)) $(range).val(value);
        if (active !== document.querySelector(number)) $(number).val(value);
    }
}

function updateCustomFontVisibility() {
    $("#stir_settings_panel").toggleClass("stir-custom-font-enabled", settings().fontFamily === "custom");
}

function bindPanelEvents() {
    bindSetting("#stir_enabled", "change", event => {
        settings().enabled = Boolean(event.target.checked);
        applyReaderState();
        persist();
    });

    bindSetting("#stir_user_mode", "change", event => {
        settings().userMode = event.target.value;
        applyReaderState();
        markAllDirty();
        persist();
    });

    bindSetting("#stir_tools_mode", "change", event => {
        settings().toolsMode = event.target.value;
        applyReaderState();
        persist();
    });

    bindSetting("#stir_font_family", "change", event => {
        settings().fontFamily = event.target.value;
        updateCustomFontVisibility();
        applyReaderState();
        persist();
    });

    bindSetting("#stir_custom_font", "input change", event => {
        settings().customFontFamily = String(event.target.value || "");
        applyReaderState();
        persist();
    });

    bindSetting("#stir_indent_mode", "change", event => {
        settings().indentMode = event.target.value;
        applyReaderState();
        markAllDirty();
        persist();
    });

    bindSetting("#stir_split_br", "change", event => {
        settings().splitBrToParagraph = Boolean(event.target.checked);
        markAllDirty();
        persist();
    });

    bindSetting("#stir_justify_text", "change", event => {
        settings().justifyText = Boolean(event.target.checked);
        applyReaderState();
        persist();
    });

    bindSetting("#stir_layout_mode", "change", event => {
        settings().layoutMode = event.target.value;
        applyReaderState();
        persist();
    });

    const numericBindings = [
        ["#stir_font_size", "#stir_font_size_num", "fontSize"],
        ["#stir_line_height", "#stir_line_height_num", "lineHeight"],
        ["#stir_paragraph_gap", "#stir_paragraph_gap_num", "paragraphGap"],
        ["#stir_indent", "#stir_indent_num", "indent"],
        ["#stir_content_width", "#stir_content_width_num", "contentWidth"],
        ["#stir_side_padding", "#stir_side_padding_num", "sidePadding"],
    ];

    for (const [range, number, key] of numericBindings) {
        bindSetting(`${range}, ${number}`, "input change", event => {
            const [min, max] = NUMERIC_LIMITS[key];
            const value = Number(event.target.value);
            if (!Number.isFinite(value)) return;
            settings()[key] = clamp(value, min, max);
            updateNumbers();
            applyReaderState();
            persist();
        });
    }

    bindAboutPopover();
}

function namespacedEvents(events) {
    return String(events)
        .split(/\s+/)
        .filter(Boolean)
        .map(event => `${event}.stir`)
        .join(" ");
}

function bindSetting(selector, events, handler) {
    const ev = namespacedEvents(events);
    $(selector).off(ev).on(ev, handler);
}

function bindAboutPopover() {
    const panel = document.getElementById("stir_settings_panel");
    const btn = panel?.querySelector(".stir-footer-trigger");
    const pop = panel?.querySelector(".stir-about-popover");
    if (!panel || !btn || !pop) return;

    panelEventAbortController?.abort();
    panelEventAbortController = new AbortController();
    const { signal } = panelEventAbortController;

    btn.addEventListener("click", event => {
        event.stopPropagation();
        const open = pop.hidden;
        pop.hidden = !open;
        btn.setAttribute("aria-expanded", open ? "true" : "false");
    }, { signal });

    document.addEventListener("click", event => {
        if (pop.hidden) return;
        if (event.target instanceof Element && event.target.closest(".stir-footer-wrap")) return;
        pop.hidden = true;
        btn.setAttribute("aria-expanded", "false");
    }, { signal });

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape" || pop.hidden) return;
        pop.hidden = true;
        btn.setAttribute("aria-expanded", "false");
    }, { signal });
}

/* -------------------- Reader state -------------------- */

function customFontFamilyValue() {
    const custom = String(settings().customFontFamily || "").trim();
    return custom || "inherit";
}

function applyReaderState() {
    const s = settings();
    const root = document.documentElement;
    const body = document.body;

    root.style.setProperty("--stir-font-size", `${s.fontSize}px`);
    root.style.setProperty("--stir-line-height", String(s.lineHeight));
    root.style.setProperty("--stir-paragraph-gap", `${s.paragraphGap}em`);
    root.style.setProperty("--stir-indent", `${s.indent}em`);
    root.style.setProperty("--stir-content-width", `${s.contentWidth}rem`);
    root.style.setProperty("--stir-side-padding", `${s.sidePadding}rem`);
    root.style.setProperty("--stir-custom-font-family", customFontFamilyValue());

    const wanted = new Set();
    if (s.enabled) wanted.add("stir-reader-active");
    wanted.add(s.fontFamily === "custom" ? "stir-font-custom" : "stir-font-follow");
    wanted.add(`stir-user-${s.userMode}`);
    wanted.add(`stir-tools-${s.toolsMode}`);
    wanted.add(`stir-indent-${s.indentMode}`);
    wanted.add(`stir-layout-${s.layoutMode}`);
    if (s.justifyText) wanted.add("stir-justify-text");

    for (const cls of READER_CLASSES) {
        body.classList.toggle(cls, wanted.has(cls));
    }

    if (s.enabled) startObserver();
    else teardown();
}

/* -------------------- Observers -------------------- */

function startObserver() {
    const chat = document.getElementById("chat");
    if (!chat) {
        waitForChatThenStart();
        return;
    }

    if (mutationObserver && observerTarget === chat) {
        observeAllMessages(chat);
        return;
    }

    teardownObservers();
    observerTarget = chat;

    mutationObserver = new MutationObserver(handleMutations);
    mutationObserver.observe(chat, { childList: true, subtree: true, characterData: true });

    if (typeof IntersectionObserver !== "undefined") {
        intersectionObserver = new IntersectionObserver(handleIntersect, {
            root: null,
            rootMargin: VIEWPORT_MARGIN,
            threshold: 0,
        });
    }

    observeAllMessages(chat);
    markAllDirty();
}

function waitForChatThenStart() {
    if (chatBootAbortController) return;

    const controller = new AbortController();
    chatBootAbortController = controller;

    let timerId = 0;
    const observer = new MutationObserver(() => {
        if (!settings().enabled) {
            cleanupChatBoot(controller, observer, timerId);
            return;
        }
        if (document.getElementById("chat")) {
            cleanupChatBoot(controller, observer, timerId);
            startObserver();
        }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    timerId = window.setTimeout(() => cleanupChatBoot(controller, observer, timerId), BOOT_TIMEOUT_MS);

    controller.signal.addEventListener("abort", () => cleanupChatBoot(controller, observer, timerId), { once: true });
}

function cleanupChatBoot(controller, observer, timerId) {
    observer.disconnect();
    if (timerId) window.clearTimeout(timerId);
    if (chatBootAbortController === controller) chatBootAbortController = null;
}

function observeAllMessages(chat) {
    for (const mes of chat.querySelectorAll(":scope > .mes")) {
        const st = getState(mes);
        if (intersectionObserver && !st.observed) {
            intersectionObserver.observe(mes);
            st.observed = true;
        }
    }
}

function handleMutations(mutations) {
    if (isRendering || !settings().enabled) return;

    let addedTopLevelMessage = false;

    for (const mutation of mutations) {
        if (isInternalMutation(mutation)) continue;

        if (mutation.type === "childList" && mutation.target === observerTarget) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("mes")) {
                    if (intersectionObserver) {
                        intersectionObserver.observe(node);
                        getState(node).observed = true;
                    }
                    queueMessage(node);
                    addedTopLevelMessage = true;
                }
            }
            for (const node of mutation.removedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                intersectionObserver?.unobserve(node);
                dirtyMessages.delete(node);
                messageState.get(node)?.headerAbort?.abort();
            }
            continue;
        }

        const target = mutation.target.nodeType === Node.ELEMENT_NODE
            ? mutation.target
            : mutation.target.parentElement;
        const mes = target?.closest?.(".mes");
        if (!mes || !observerTarget?.contains(mes)) continue;

            if (target.closest?.(".mes_text")) queueMessage(mes);
    }

    if (dirtyMessages.size) scheduleRender(addedTopLevelMessage);
}

function handleIntersect(entries) {
    let needRender = false;
    for (const entry of entries) {
        const mes = entry.target;
        const st = getState(mes);
        st.visible = entry.isIntersecting;
        if (entry.isIntersecting && (st.pendingRender || !st.everRendered)) {
            dirtyMessages.add(mes);
            needRender = true;
        }
    }
    if (needRender) scheduleRender(false);
}

function isInternalMutation(mutation) {
    const target = mutation.target.nodeType === Node.ELEMENT_NODE
        ? mutation.target
        : mutation.target.parentElement;
    return Boolean(target?.closest?.(".stir-reader-projection, .stir-mixed-reader-projection"));
}

function teardownObservers() {
    mutationObserver?.disconnect();
    intersectionObserver?.disconnect();
    chatBootAbortController?.abort();
    mutationObserver = null;
    intersectionObserver = null;
    chatBootAbortController = null;
    observerTarget = null;
}

/* -------------------- Render scheduler -------------------- */

function queueMessage(mes) {
    if (!mes?.isConnected) return;
    const st = getState(mes);
    st.revision += 1;
    dirtyMessages.add(mes);
}

function scheduleRender(forceImmediate = false) {
    if (renderScheduled) return;
    renderScheduled = true;

    const now = performance.now();
    const likelyStreaming = !forceImmediate && now < streamingDeadline;
    streamingDeadline = now + STREAMING_GRACE_MS;

    if (likelyStreaming) {
        renderTimerId = window.setTimeout(() => {
            renderTimerId = null;
            renderScheduled = false;
            flushDirty();
        }, STREAMING_THROTTLE_MS);
    } else {
        requestAnimationFrame(() => {
            renderScheduled = false;
            flushDirty();
        });
    }
}

function markAllDirty() {
    if (!observerTarget) return;
    for (const mes of observerTarget.querySelectorAll(":scope > .mes")) queueMessage(mes);
    scheduleRender(true);
}

function flushDirty() {
    if (!settings().enabled) {
        dirtyMessages.clear();
        return;
    }
    if (!dirtyMessages.size) return;

    isRendering = true;
    hotSettings = settings();

    try {
        const items = Array.from(dirtyMessages);
        dirtyMessages.clear();

        if (items.length >= BIG_BATCH_THRESHOLD) {
            renderBigBatch(items);
            return;
        }

        for (const mes of items) {
            if (!mes.isConnected) continue;
            const st = getState(mes);
            if (st.visible === false && st.everRendered) {
                st.pendingRender = true;
                continue;
            }
            renderMessage(mes);
        }
    } finally {
        isRendering = false;
        hotSettings = null;
    }
}

function renderBigBatch(items) {
    for (const mes of items) {
        if (!mes.isConnected) continue;
        const st = getState(mes);
        if (st.visible === false && st.everRendered) {
            st.pendingRender = true;
            continue;
        }
        renderMessage(mes);
    }
}

/* -------------------- Message rendering -------------------- */

function renderMessage(mes) {
    const textEl = mes.querySelector(".mes_text");
    if (!textEl) return;

    const s = activeSettings();
    const userMes = isUserMessage(mes);
    const isEditing = Boolean(mes.querySelector("textarea, .edit_textarea, [contenteditable='true']"));
    const st = getState(mes);

    mes.classList.add("stir-message");
    mes.classList.toggle("stir-user-message", userMes);
    mes.classList.toggle("stir-ai-message", !userMes);
    mes.classList.toggle("stir-editing", isEditing);
    if (isEditing) mes.classList.add("stir-tools-open");

    bindHeaderToggle(mes);

    const sourceRoot = textEl.querySelector(":scope > .stir-native-content") || textEl;
    const frontendProtected = !isEditing && isFrontendProtected(sourceRoot);
    mes.classList.toggle("stir-frontend-message", frontendProtected);

    if (frontendProtected) {
        const renderKey = `${st.revision}|mixed-segments|${projectionSettingsKey(s, userMes, isEditing)}`;
        if (st.renderKey !== renderKey) {
            restoreNativeHost(textEl);
            cleanupMixedSegments(textEl);
            if (!isEditing) renderMixedSegments(textEl, s);
            st.renderKey = renderKey;
        }
        st.everRendered = true;
        st.pendingRender = false;
        mes.classList.remove("stir-native-content-mode");
        mes.classList.add("stir-mixed-segments-mode");
        return;
    }

    cleanupMixedSegments(textEl);
    mes.classList.remove("stir-mixed-segments-mode");

    const { nativeContent, projection } = ensureProjectionHost(textEl);
    if (!nativeContent || !projection) return;

    const renderKey = `${st.revision}|${projectionSettingsKey(s, userMes, isEditing)}`;
    if (st.renderKey === renderKey && !isEditing) {
        st.everRendered = true;
        st.pendingRender = false;
        return;
    }

    st.renderKey = renderKey;
    st.everRendered = true;
    st.pendingRender = false;

    projection.replaceChildren();

    if (isEditing) {
        projection.hidden = true;
        mes.classList.add("stir-native-content-mode");
        return;
    }

    projection.hidden = false;
    mes.classList.remove("stir-native-content-mode");

    if (userMes) projection.append(buildUserProjection(nativeContent, s));
    else renderFlow(nativeContent, projection, s);
}

function restoreNativeHost(textEl) {
    textEl.querySelector(":scope > .stir-reader-projection")?.remove();

    const nativeContent = textEl.querySelector(":scope > .stir-native-content");
    if (!nativeContent) return;

    const fragment = document.createDocumentFragment();
    while (nativeContent.firstChild) fragment.append(nativeContent.firstChild);
    textEl.insertBefore(fragment, nativeContent);
    nativeContent.remove();
}

function ensureProjectionHost(textEl) {
    let nativeContent = textEl.querySelector(":scope > .stir-native-content");
    let projection = textEl.querySelector(":scope > .stir-reader-projection");

    if (!nativeContent) {
        nativeContent = document.createElement("div");
        nativeContent.className = "stir-native-content";
    }
    if (!projection) {
        projection = document.createElement("div");
        projection.className = "stir-reader-projection";
    }

    const nodes = Array.from(textEl.childNodes);
    for (const node of nodes) {
        if (node === nativeContent || node === projection) continue;
        if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("stir-reader-projection")) {
            node.remove();
        } else if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("stir-native-content")) {
            while (node.firstChild) nativeContent.append(node.firstChild);
            node.remove();
        } else {
            nativeContent.append(node);
        }
    }

    if (nativeContent.parentNode !== textEl) textEl.append(nativeContent);
    if (projection.parentNode !== textEl) textEl.append(projection);
    if (projection.previousElementSibling !== nativeContent) textEl.append(projection);

    return { nativeContent, projection };
}

function bindHeaderToggle(mes) {
    const st = getState(mes);
    if (st.headerAbort) return;

    const abort = new AbortController();
    st.headerAbort = abort;

    mes.addEventListener("click", event => {
        const s = settings();
        if (!s.enabled || s.toolsMode !== "folded") return;
        if (!(event.target instanceof Element)) return;

        if (event.target.closest(NATIVE_CONTROL_SELECTOR)) {
            mes.classList.add("stir-tools-open");
            return;
        }
        if (event.target.closest(".stir-reader-projection, .mes_text")) return;

        const header = event.target.closest(HEADER_SELECTOR);
        if (!header || !mes.contains(header)) return;
        mes.classList.toggle("stir-tools-open");
    }, { capture: true, signal: abort.signal });
}

function isFrontendProtected(root) {
    if (root.matches?.(NATIVE_ONLY_SELECTOR) || root.querySelector(NATIVE_ONLY_SELECTOR)) return true;
    return containsFrontendCode(root);
}

function containsFrontendCode(root) {
    const nodes = root.matches?.(FRONTEND_CODE_SELECTOR)
        ? [root, ...root.querySelectorAll(FRONTEND_CODE_SELECTOR)]
        : root.querySelectorAll(FRONTEND_CODE_SELECTOR);

    for (const el of nodes) {
        const text = el.textContent || "";
        if (FRONTEND_CODE_BODY_RE.test(text) || FRONTEND_CODE_RE.test(text)) return true;
    }
    return false;
}


function renderMixedSegments(root, s) {
    const nodes = Array.from(root.childNodes);
    let inlineRun = [];

    const flushInlineRun = () => {
        if (!inlineRun.length) return;
        const run = inlineRun;
        inlineRun = [];
        appendMixedInlineRun(root, run, s);
    };

    for (const node of nodes) {
        if (!node.isConnected || isMixedProjection(node) || isMixedSourceRun(node)) continue;

        if (node.nodeType === Node.TEXT_NODE) {
            if (node.nodeValue && node.nodeValue.trim()) inlineRun.push(node);
            continue;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        if (isMixedUnsafeRoot(node)) {
            flushInlineRun();
            continue;
        }

        if (hasMixedUnsafeDescendant(node)) {
            flushInlineRun();
            continue;
        }

        if (isBlockLike(node) || shouldPreserveBlock(node)) {
            flushInlineRun();
            appendMixedElementProjection(node, s);
            continue;
        }

        inlineRun.push(node);
    }

    flushInlineRun();
}

function appendMixedElementProjection(source, s) {
    if (!source.parentNode || source.classList.contains(MIXED_SOURCE_CLASS)) return;

    const projection = document.createElement("div");
    projection.className = MIXED_PROJECTION_CLASS;

    if (PARAGRAPH_TAGS.has(source.tagName)) appendSplitTextBlock(source, projection, s);
    else renderFlow(source, projection, s);

    if (!projection.childNodes.length) return;
    source.classList.add(MIXED_SOURCE_CLASS);
    source.after(projection);
}

function appendMixedInlineRun(container, nodes, s) {
    const liveNodes = nodes.filter(node => node.parentNode === container);
    if (!liveNodes.length) return;

    const source = document.createElement("span");
    source.className = MIXED_SOURCE_CLASS;
    source.setAttribute(MIXED_SOURCE_RUN_ATTR, "1");
    source.setAttribute("aria-hidden", "true");

    container.insertBefore(source, liveNodes[0]);
    for (const node of liveNodes) {
        if (node.parentNode === container) source.append(node);
    }

    const box = document.createElement("div");
    for (const child of source.childNodes) box.append(child.cloneNode(true));

    const projection = document.createElement("div");
    projection.className = MIXED_PROJECTION_CLASS;
    appendSplitTextBlock(box, projection, s);

    if (projection.childNodes.length) source.after(projection);
    else unwrapMixedSourceRun(source);
}

function cleanupMixedSegments(root) {
    for (const projection of Array.from(root.querySelectorAll?.(`.${MIXED_PROJECTION_CLASS}`) || [])) {
        projection.remove();
    }

    for (const source of Array.from(root.querySelectorAll?.(`[${MIXED_SOURCE_RUN_ATTR}]`) || [])) {
        unwrapMixedSourceRun(source);
    }

    for (const source of Array.from(root.querySelectorAll?.(`.${MIXED_SOURCE_CLASS}`) || [])) {
        source.classList.remove(MIXED_SOURCE_CLASS);
        source.removeAttribute("aria-hidden");
    }
}

function unwrapMixedSourceRun(source) {
    const parent = source.parentNode;
    if (!parent) return;
    while (source.firstChild) parent.insertBefore(source.firstChild, source);
    source.remove();
}

function isMixedProjection(node) {
    return node.nodeType === Node.ELEMENT_NODE && node.classList.contains(MIXED_PROJECTION_CLASS);
}

function isMixedSourceRun(node) {
    return node.nodeType === Node.ELEMENT_NODE && node.hasAttribute(MIXED_SOURCE_RUN_ATTR);
}

function isMixedUnsafeRoot(el) {
    if (!(el instanceof Element)) return false;
    if (el.matches?.(NATIVE_ONLY_SELECTOR)) return true;
    if (isFrontendCodeElement(el)) return true;
    return false;
}

function hasMixedUnsafeDescendant(el) {
    if (!(el instanceof Element)) return false;
    if (el.querySelector?.(NATIVE_ONLY_SELECTOR)) return true;
    return containsFrontendCode(el);
}

function isFrontendCodeElement(el) {
    if (!(el instanceof Element)) return false;
    const block = el.tagName === "PRE"
        ? el
        : el.tagName === "CODE"
            ? (el.closest("pre") || el)
            : null;
    if (!block || block !== el) return false;
    const text = block.textContent || "";
    return FRONTEND_CODE_BODY_RE.test(text) || FRONTEND_CODE_RE.test(text);
}

/* -------------------- Projection building -------------------- */

function buildUserProjection(nativeContent, s) {
    if (s.userMode === "hidden") return buildHiddenUserProjection();
    if (s.userMode === "folded") return buildFoldedUserProjection(nativeContent, s);

    const div = document.createElement("div");
    renderFlow(nativeContent, div, s);
    return div;
}

function buildFoldedUserProjection(nativeContent, s) {
    const details = document.createElement("details");
    details.className = "stir-user-fold";

    const summary = document.createElement("summary");
    summary.title = "展开用户消息";
    summary.setAttribute("aria-label", "展开用户消息");

    const line = document.createElement("span");
    line.className = "stir-user-fold-line";
    summary.append(line);

    const body = document.createElement("div");
    body.className = "stir-user-full";
    renderFlow(nativeContent, body, s);

    details.append(summary, body);
    return details;
}

function buildHiddenUserProjection() {
    const div = document.createElement("div");
    div.className = "stir-user-hidden-marker";
    div.setAttribute("aria-label", "用户消息已隐藏");
    return div;
}

function renderFlow(source, target, s) {
    const inlineRun = [];

    const flushInlineRun = () => {
        if (!inlineRun.length) return;
        const box = document.createElement("div");
        for (const node of inlineRun) box.append(node.cloneNode(true));
        inlineRun.length = 0;
        appendSplitTextBlock(box, target, s);
    };

    for (const node of Array.from(source.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
            if (!node.nodeValue) continue;
            if (!node.nodeValue.trim()) {
                if (inlineRun.length && hasInlineFollower(node)) inlineRun.push(document.createTextNode(" "));
                continue;
            }
            inlineRun.push(node);
            continue;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        if (isBlockLike(node)) {
            flushInlineRun();
            renderBlock(node, target, s);
        } else {
            inlineRun.push(node);
        }
    }

    flushInlineRun();
}

function renderBlock(el, target, s) {
    if (shouldPreserveBlock(el)) {
        target.append(clonePreservedBlock(el));
        return;
    }

    if (PARAGRAPH_TAGS.has(el.tagName)) {
        appendSplitTextBlock(el, target, s);
        return;
    }

    if (isPlainFlowContainer(el)) {
        renderFlow(el, target, s);
        return;
    }

    target.append(clonePreservedBlock(el));
}

function isBlockLike(el) {
    if (PARAGRAPH_TAGS.has(el.tagName)) return true;
    if (PRESERVE_TAGS.has(el.tagName)) return true;
    if (FLOW_CONTAINER_TAGS.has(el.tagName)) return true;
    return false;
}

function hasInlineFollower(node) {
    for (let cur = node.nextSibling; cur; cur = cur.nextSibling) {
        if (cur.nodeType === Node.TEXT_NODE) {
            if ((cur.nodeValue || "").trim()) return true;
            continue;
        }
        if (cur.nodeType === Node.ELEMENT_NODE) return !isBlockLike(cur);
    }
    return false;
}

function isPlainFlowContainer(el) {
    return FLOW_CONTAINER_TAGS.has(el.tagName) && !shouldPreserveBlock(el);
}

function shouldPreserveBlock(el) {
    if (PRESERVE_TAGS.has(el.tagName)) return true;
    if (el.tagName === "BR") return false;
    if (hasExplicitPreserveMarker(el)) return true;
    if (isVisualIsland(el)) return true;
    return false;
}

function hasExplicitPreserveMarker(el) {
    return el.hasAttribute("data-stir-preserve") || el.classList.contains("stir-rich-block");
}

function isVisualIsland(el) {
    const style = el.getAttribute("style") || "";
    if (VISUAL_ISLAND_STYLE_RE.test(style)) return true;
    const cls = el.getAttribute("class") || "";
    return VISUAL_ISLAND_CLASS_RE.test(cls);
}

function clonePreservedBlock(el) {
    const clone = el.cloneNode(true);
    if (clone.nodeType === Node.ELEMENT_NODE) clone.classList.add("stir-preserve-block");
    return clone;
}

/* -------------------- Range-based paragraph segmentation -------------------- */

function appendSplitTextBlock(block, target, s) {
    if (!s.splitBrToParagraph) {
        const fragment = cloneWholeContent(block);
        appendParagraphIfMeaningful(fragment, target, s);
        return;
    }

    const breakpoints = collectBreakpoints(block);
    if (!breakpoints.length) {
        appendParagraphIfMeaningful(cloneWholeContent(block), target, s);
        return;
    }

    let cursor = boundaryAtStart(block);
    let previousBreakpoint = null;

    for (const breakpoint of breakpoints) {
        const fragment = cloneBetween(cursor, breakpoint.before);
        if (fragmentHasMeaningfulContent(fragment)) {
            appendParagraph(fragment, target, s);
        } else if (previousBreakpoint) {
            appendBlankParagraph(target);
        }
        cursor = breakpoint.after;
        previousBreakpoint = breakpoint;
    }

    const tail = cloneBetween(cursor, boundaryAtEnd(block));
    if (fragmentHasMeaningfulContent(tail)) appendParagraph(tail, target, s);
}

function collectBreakpoints(root) {
    const breakpoints = [];
    const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                if (node === root) return NodeFilter.FILTER_SKIP;
                if (node.nodeType === Node.ELEMENT_NODE) {
                    if (node.tagName === "BR") return NodeFilter.FILTER_ACCEPT;
                    if (shouldPreserveBlock(node)) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_SKIP;
                }
                if (node.nodeType === Node.TEXT_NODE && /[\r\n]/.test(node.nodeValue || "")) {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_SKIP;
            },
        },
    );

    let node;
    while ((node = walker.nextNode())) {
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "BR") {
            breakpoints.push({
                kind: "br",
                before: boundaryBeforeNode(node),
                after: boundaryAfterNode(node),
            });
        } else if (node.nodeType === Node.TEXT_NODE) {
            for (const item of semanticNewlineOffsets(node.nodeValue || "")) {
                breakpoints.push({
                    kind: "text",
                    before: { container: node, offset: item.start },
                    after: { container: node, offset: item.end },
                });
            }
        }
    }

    return breakpoints;
}

function semanticNewlineOffsets(text) {
    const result = [];
    if (!/[\r\n]/.test(text)) return result;

    const firstContent = firstNonWhitespaceIndex(text);
    if (firstContent < 0) return result;

    const lastContent = lastNonWhitespaceIndex(text);
    const re = /\r\n|\n|\r/g;
    let match;

    while ((match = re.exec(text))) {
        const start = match.index;
        const end = start + match[0].length;
        if (firstContent < start && lastContent >= end) result.push({ start, end });
    }
    return result;
}

function firstNonWhitespaceIndex(text) {
    for (let i = 0; i < text.length; i++) {
        if (!isWhitespaceChar(text.charCodeAt(i))) return i;
    }
    return -1;
}

function lastNonWhitespaceIndex(text) {
    for (let i = text.length - 1; i >= 0; i--) {
        if (!isWhitespaceChar(text.charCodeAt(i))) return i;
    }
    return -1;
}

function isWhitespaceChar(code) {
    return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32 || code === 160 || code === 12288 || code === 65279 || code === 8203;
}

function cloneWholeContent(el) {
    const fragment = document.createDocumentFragment();
    for (const child of Array.from(el.childNodes)) fragment.append(child.cloneNode(true));
    return fragment;
}

function cloneBetween(start, end) {
    const range = document.createRange();
    setRangeBoundary(range, "start", start);
    setRangeBoundary(range, "end", end);
    const fragment = range.cloneContents();
    range.detach?.();
    return fragment;
}

function setRangeBoundary(range, side, boundary) {
    const prefix = side === "start" ? "setStart" : "setEnd";
    if (boundary.beforeNode) {
        range[`${prefix}Before`](boundary.beforeNode);
    } else if (boundary.afterNode) {
        range[`${prefix}After`](boundary.afterNode);
    } else {
        range[prefix](boundary.container, boundary.offset);
    }
}

function boundaryAtStart(el) {
    return { container: el, offset: 0 };
}

function boundaryAtEnd(el) {
    return { container: el, offset: el.childNodes.length };
}

function boundaryBeforeNode(node) {
    return { beforeNode: node };
}

function boundaryAfterNode(node) {
    return { afterNode: node };
}

function appendParagraphIfMeaningful(fragment, target, s) {
    if (fragmentHasMeaningfulContent(fragment)) appendParagraph(fragment, target, s);
}

function appendParagraph(fragment, target, s) {
    const p = document.createElement("p");
    p.className = "stir-p";
    p.append(fragment);
    trimLeadingIndent(p, s);
    target.append(p);
}

function appendBlankParagraph(target) {
    const p = document.createElement("p");
    p.className = "stir-p stir-blank-line";
    p.append(document.createElement("br"));
    target.append(p);
}

function fragmentHasMeaningfulContent(fragment) {
    const text = (fragment.textContent || "").replace(/[\u200B\uFEFF]/g, "").trim();
    if (text) return true;
    return Boolean(fragment.querySelector?.("img,svg,video,audio,canvas,iframe,table,pre,code,details,hr"));
}

function trimLeadingIndent(p, s) {
    if (s.indentMode === "off") return;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const firstText = walker.nextNode();
    if (firstText) firstText.textContent = firstText.textContent.replace(LEADING_INDENT_RE, "");
}

function isUserMessage(mes) {
    return mes.getAttribute("is_user") === "true" || mes.classList.contains("user_mes");
}

/* -------------------- Teardown -------------------- */

function teardown() {
    teardownObservers();

    dirtyMessages.clear();
    if (renderTimerId) {
        clearTimeout(renderTimerId);
        renderTimerId = null;
    }
    renderScheduled = false;
    streamingDeadline = 0;

    document.body.classList.remove(...READER_CLASSES);

    const chat = document.getElementById("chat");
    if (!chat) return;

    for (const mes of chat.querySelectorAll(":scope > .mes.stir-message")) {
        const st = getState(mes);
        st.headerAbort?.abort();

        mes.classList.remove(
            "stir-message", "stir-user-message", "stir-ai-message",
            "stir-native-content-mode", "stir-frontend-message", "stir-mixed-segments-mode", "stir-tools-open", "stir-editing",
        );

        const textEl = mes.querySelector(".mes_text");
        if (!textEl) continue;

        cleanupMixedSegments(textEl);

        const nativeContent = textEl.querySelector(":scope > .stir-native-content");
        const projection = textEl.querySelector(":scope > .stir-reader-projection");
        projection?.remove();

        if (nativeContent) {
            const fragment = document.createDocumentFragment();
            while (nativeContent.firstChild) fragment.append(nativeContent.firstChild);
            textEl.append(fragment);
            nativeContent.remove();
        }

        messageState.delete(mes);
    }
}

/* -------------------- Entry -------------------- */

jQuery(async () => {
    settings();
    bootPanelWhenReady();
    applyReaderState();
    console.info(`[${MODULE_NAME}] ${VERSION} · by ${AUTHOR}`);
});
