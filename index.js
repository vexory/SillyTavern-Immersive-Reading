import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const MODULE_NAME = "st-immersive-reading";
const MODULE_DISPLAY_NAME = "沉浸式阅读";
const AUTHOR = "vexory";
const VERSION = "3.0.0";

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,
    userMode: "normal", // normal | hidden | folded
    toolsMode: "always", // always | folded
    fontFamily: "system", // system | custom
    customFontFamily: "",
    fontSize: 18,
    lineHeight: 1.82,
    paragraphGap: 0.34,
    indent: 2,
    contentWidth: 42,
    sidePadding: 1.05,
    indentMode: "firstline", // firstline | block | off
    splitBrToParagraph: true,
    justifyText: true,
});

// Slider ranges are the comfortable reading range.
// Number inputs allow a wider safe range for advanced users.
const SLIDER_LIMITS = Object.freeze({
    fontSize: [14, 28],
    lineHeight: [1.35, 2.3],
    paragraphGap: [0, 1.2],
    indent: [0, 4],
    contentWidth: [18, 72],
    sidePadding: [0.2, 3.2],
});

const NUMERIC_LIMITS = Object.freeze({
    fontSize: [8, 96],
    lineHeight: [0.8, 4],
    paragraphGap: [0, 10],
    indent: [0, 12],
    contentWidth: [12, 220],
    sidePadding: [0, 30],
});

const RANGE_UNITS = Object.freeze({
    fontSize: "px",
    lineHeight: "倍",
    paragraphGap: "em",
    indent: "em",
    contentWidth: "ch",
    sidePadding: "rem",
});

const ENUMS = Object.freeze({
    userMode: new Set(["normal", "hidden", "folded"]),
    toolsMode: new Set(["always", "folded"]),
    fontFamily: new Set(["system", "custom"]),
    indentMode: new Set(["firstline", "block", "off"]),
});

const BODY_CLASSES = [
    "stir-reader-active",
    "stir-font-follow",
    "stir-font-custom",
    "stir-user-mode-normal",
    "stir-user-mode-hidden",
    "stir-user-mode-folded",
    "stir-tools-always",
    "stir-tools-folded",
    "stir-indent-firstline",
    "stir-indent-block",
    "stir-indent-off",
    "stir-justify-text",
];

const MESSAGE_CLASSES = [
    "stir-message",
    "stir-user-message",
    "stir-ai-message",
    "stir-user-hidden",
    "stir-user-folded",
    "stir-user-fold-open",
    "stir-tools-open",
];

const READER_MARK_CLASSES = [
    "stir-readable-block",
    "stir-readable-inline",
    "stir-readable-split-block",
    "stir-owned-line-paragraph",
];

const SAFE_INLINE_TAGS = new Set(["SPAN", "EM", "STRONG", "I", "B", "U", "S", "Q", "A"]);
const SAFE_BLOCK_TAGS = new Set(["P"]);
const UNSAFE_TAGS = new Set([
    "SCRIPT", "STYLE", "LINK", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA", "OPTION",
    "CANVAS", "IFRAME", "SVG", "IMG", "VIDEO", "AUDIO", "PICTURE", "FIGURE",
    "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "PRE", "CODE", "DETAILS", "SUMMARY",
    "UL", "OL", "LI", "DL", "DT", "DD", "MENU", "HR",
    "DIV", "SECTION", "ARTICLE", "MAIN", "ASIDE", "HEADER", "FOOTER",
]);

const HEADER_SELECTOR = [
    ".ch_name",
    ".name_text",
    ".mes_name",
    ".mes_header",
    ".mesAvatarWrapper",
    ".avatar",
].join(",");

const MANAGED_TOOLBAR_SELECTORS = [
    ".mes_buttons",
    ".extraMesButtons",
    ".extra_mes_buttons",
    ".mes_edit_buttons",
    ".mes_controls",
    ".mes_button",
    ".extraMesButton",
    ".extra_mes_button",
].join(",");

const WAIT_FOR_PANEL_MS = 15000;
const WAIT_FOR_CHAT_MS = 15000;
const MUTATION_APPLY_DELAY_MS = 520;
const INITIAL_APPLY_DELAY_MS = 80;

let chatObserver = null;
let panelObserver = null;
let panelTimerId = null;
let chatBootTimerId = null;
let renderTimerId = null;
let isApplying = false;
let started = false;

const dirtyMessages = new Set();
const boundMessages = new Map();
const userFoldOpenState = new WeakMap();
const toolOpenState = new WeakMap();

/* -------------------- Settings -------------------- */

function settings() {
    let s = extension_settings[MODULE_NAME];
    if (!s || typeof s !== "object") {
        s = extension_settings[MODULE_NAME] = {};
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!(key in s)) s[key] = value;
    }
    normalizeSettings(s);
    return s;
}

function normalizeSettings(s) {
    s.enabled = Boolean(s.enabled);
    s.splitBrToParagraph = Boolean(s.splitBrToParagraph);
    s.justifyText = Boolean(s.justifyText);

    for (const [key, allowed] of Object.entries(ENUMS)) {
        if (!allowed.has(s[key])) s[key] = DEFAULT_SETTINGS[key];
    }

    for (const [key, [min, max]] of Object.entries(NUMERIC_LIMITS)) {
        s[key] = clamp(Number(s[key]), min, max, DEFAULT_SETTINGS[key]);
    }

    s.customFontFamily = String(s.customFontFamily || "").trim();

}

function clamp(value, min, max, fallback = min) {
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

function persist() {
    normalizeSettings(settings());
    saveSettingsDebounced();
}

function wantsAnyChatIntervention(s = settings()) {
    return Boolean(s.enabled) || s.userMode !== "normal" || s.toolsMode !== "always";
}

/* -------------------- Settings UI -------------------- */

function initPanel() {
    if (document.getElementById("stir_settings_panel")) return true;

    const target = document.querySelector("#extensions_settings2") || document.querySelector("#extensions_settings");
    if (!target) return false;

    target.insertAdjacentHTML("beforeend", `
        <div id="stir_settings_panel" class="inline-drawer stir-settings-panel">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${MODULE_DISPLAY_NAME}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="stir-setting-row stir-setting-row-main">
                    <label class="checkbox_label" for="stir_enabled">
                        <input id="stir_enabled" type="checkbox" />
                        <span>阅读排版</span>
                    </label>
                </div>

                <div class="stir-setting-grid">
                    <label for="stir_user_mode">
                        <span>用户消息</span>
                        <select id="stir_user_mode">
                            <option value="normal">保持原样</option>
                            <option value="folded">折叠</option>
                            <option value="hidden">隐藏</option>
                        </select>
                    </label>

                    <label for="stir_tools_mode">
                        <span>工具栏</span>
                        <select id="stir_tools_mode">
                            <option value="always">保持原样</option>
                            <option value="folded">点击显示/隐藏</option>
                        </select>
                    </label>

                    <label for="stir_font_family">
                        <span>字体</span>
                        <select id="stir_font_family">
                            <option value="system">跟随系统/主题</option>
                            <option value="custom">自定义字体</option>
                        </select>
                    </label>

                    <label for="stir_indent_mode">
                        <span>缩进</span>
                        <select id="stir_indent_mode">
                            <option value="firstline">首行缩进</option>
                            <option value="block">整段缩进</option>
                            <option value="off">关闭缩进</option>
                        </select>
                    </label>
                </div>

                <label id="stir_custom_font_row" class="stir-custom-font-row" for="stir_custom_font_family">
                    <span>字体族</span>
                    <input id="stir_custom_font_family" type="text" placeholder="例如：LXGW WenKai, serif" />
                    <small>填写 CSS 字体族，多个字体用英文逗号分隔。</small>
                </label>

                <div class="stir-range-list">
                    ${numericControlHtml("字号", "fontSize", 1)}
                    ${numericControlHtml("行高", "lineHeight", 0.01)}
                    ${numericControlHtml("段距", "paragraphGap", 0.01)}
                    ${numericControlHtml("缩进", "indent", 0.1)}
                    ${numericControlHtml("宽度", "contentWidth", 1)}
                    ${numericControlHtml("边距", "sidePadding", 0.05)}
                </div>

                <div class="stir-setting-row stir-setting-row-checks">
                    <label class="checkbox_label" for="stir_split_br">
                        <input id="stir_split_br" type="checkbox" />
                        <span>把换行整理为段落</span>
                    </label>
                    <label class="checkbox_label" for="stir_justify_text">
                        <input id="stir_justify_text" type="checkbox" />
                        <span>正文两端对齐</span>
                    </label>
                </div>

                <div class="stir-footer">
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
        </div>
    `);

    bindPanelEvents();
    hydratePanel();
    return true;
}

function numericControlHtml(label, key, step) {
    const unit = RANGE_UNITS[key] || "";
    const title = unit ? `${label}(${unit})` : label;
    const [rangeMin, rangeMax] = SLIDER_LIMITS[key];
    const [inputMin, inputMax] = NUMERIC_LIMITS[key];
    return `
        <label class="stir-range-row" for="stir_${key}">
            <span>${title}</span>
            <input id="stir_${key}" data-stir-number-range="${key}" type="range" min="${rangeMin}" max="${rangeMax}" step="${step}" />
            <input id="stir_${key}_input" class="stir-number-input" data-stir-number-input="${key}" type="number" min="${inputMin}" max="${inputMax}" step="${step}" inputmode="decimal" aria-label="${title}" />
        </label>
    `;
}

function bootPanelWhenReady() {
    if (initPanel()) return;

    const startedAt = Date.now();
    panelObserver = new MutationObserver(() => {
        if (initPanel()) cleanupPanelBoot();
        if (Date.now() - startedAt > WAIT_FOR_PANEL_MS) cleanupPanelBoot();
    });
    panelObserver.observe(document.body, { childList: true, subtree: true });
    panelTimerId = window.setTimeout(() => cleanupPanelBoot(), WAIT_FOR_PANEL_MS + 1000);
}

function cleanupPanelBoot() {
    panelObserver?.disconnect();
    panelObserver = null;
    if (panelTimerId) {
        clearTimeout(panelTimerId);
        panelTimerId = null;
    }
}

function hydratePanel() {
    const s = settings();
    $("#stir_enabled").prop("checked", s.enabled);
    $("#stir_user_mode").val(s.userMode);
    $("#stir_tools_mode").val(s.toolsMode);
    $("#stir_font_family").val(s.fontFamily);
    $("#stir_indent_mode").val(s.indentMode);
    $("#stir_custom_font_family").val(s.customFontFamily);
    $("#stir_split_br").prop("checked", s.splitBrToParagraph);
    $("#stir_justify_text").prop("checked", s.justifyText);

    for (const key of Object.keys(NUMERIC_LIMITS)) {
        syncNumberControl(key, s[key]);
    }
    updateCustomFontVisibility();
}

function formatNumberValue(key, value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(DEFAULT_SETTINGS[key]);
    if (Number.isInteger(number)) return String(number);
    return number.toFixed(key === "lineHeight" ? 2 : 2).replace(/0+$/, "").replace(/\.$/, "");
}

function syncNumberControl(key, value) {
    const display = formatNumberValue(key, value);
    const [rangeMin, rangeMax] = SLIDER_LIMITS[key] || NUMERIC_LIMITS[key];
    const rangeValue = clamp(Number(value), rangeMin, rangeMax, DEFAULT_SETTINGS[key]);
    $(`#stir_${key}`).val(formatNumberValue(key, rangeValue));
    $(`#stir_${key}_input`).val(display);
}

function updateAllNumberControls() {
    const s = settings();
    for (const key of Object.keys(NUMERIC_LIMITS)) {
        syncNumberControl(key, s[key]);
    }
}

function updateCustomFontVisibility() {
    const custom = settings().fontFamily === "custom";
    $("#stir_settings_panel").toggleClass("stir-custom-font-enabled", custom);
}

function bindPanelEvents() {
    const ns = ".stir";
    $("#stir_enabled").off(ns).on(`change${ns}`, event => {
        settings().enabled = Boolean(event.target.checked);
        persist();
        reapplyAll();
    });

    $("#stir_user_mode").off(ns).on(`change${ns}`, event => {
        settings().userMode = String(event.target.value || "normal");
        persist();
        reapplyAll();
    });

    $("#stir_tools_mode").off(ns).on(`change${ns}`, event => {
        settings().toolsMode = String(event.target.value || "always");
        persist();
        reapplyAll();
    });

    $("#stir_font_family").off(ns).on(`change${ns}`, event => {
        settings().fontFamily = String(event.target.value || "system");
        persist();
        updateCustomFontVisibility();
        reapplyAll();
    });

    $("#stir_indent_mode").off(ns).on(`change${ns}`, event => {
        settings().indentMode = String(event.target.value || "firstline");
        persist();
        reapplyAll();
    });

    $("#stir_custom_font_family").off(ns).on(`input${ns} change${ns}`, event => {
        settings().customFontFamily = String(event.target.value || "");
        persist();
        applyBodyState();
    });

    $("#stir_split_br").off(ns).on(`change${ns}`, event => {
        settings().splitBrToParagraph = Boolean(event.target.checked);
        persist();
        reapplyAll();
    });

    $("#stir_justify_text").off(ns).on(`change${ns}`, event => {
        settings().justifyText = Boolean(event.target.checked);
        persist();
        reapplyAll();
    });

    $('[data-stir-number-range], [data-stir-number-input]').off(ns).on(`input${ns} change${ns}`, event => {
        const target = event.target;
        const key = target.dataset.stirNumberRange || target.dataset.stirNumberInput;
        if (!(key in NUMERIC_LIMITS)) return;
        const [min, max] = NUMERIC_LIMITS[key];
        const value = clamp(Number(target.value), min, max, DEFAULT_SETTINGS[key]);
        settings()[key] = value;
        syncNumberControl(key, value);
        persist();
        applyBodyState();
    });

    $('.stir-footer-trigger').off(ns).on(`click${ns}`, event => {
        event.preventDefault();
        event.stopPropagation();
        toggleAboutPopover();
    });

    $(document).off(`click${ns}.about`).on(`click${ns}.about`, event => {
        if ($(event.target).closest('#stir_settings_panel .stir-footer').length) return;
        closeAboutPopover();
    });
}

function toggleAboutPopover() {
    const trigger = document.querySelector('#stir_settings_panel .stir-footer-trigger');
    const popover = document.querySelector('#stir_settings_panel .stir-about-popover');
    if (!trigger || !popover) return;
    const open = popover.hasAttribute('hidden');
    popover.toggleAttribute('hidden', !open);
    trigger.setAttribute('aria-expanded', String(open));
}

function closeAboutPopover() {
    const trigger = document.querySelector('#stir_settings_panel .stir-footer-trigger');
    const popover = document.querySelector('#stir_settings_panel .stir-about-popover');
    if (!trigger || !popover) return;
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
}

/* -------------------- Lifecycle -------------------- */

function start() {
    if (started) return;
    started = true;
    // Apply base CSS state as early as possible so new/streaming messages
    // inherit reader font, line-height, width and padding before per-message
    // reader enhancement runs.
    applyBodyState();
    bootPanelWhenReady();
    waitForChatThenStart();
}

function waitForChatThenStart() {
    const chat = document.getElementById("chat");
    if (chat) {
        observeChat(chat);
        window.setTimeout(() => reapplyAll(), INITIAL_APPLY_DELAY_MS);
        return;
    }

    const startedAt = Date.now();
    const observer = new MutationObserver(() => {
        const found = document.getElementById("chat");
        if (found) {
            observer.disconnect();
            if (chatBootTimerId) clearTimeout(chatBootTimerId);
            observeChat(found);
            window.setTimeout(() => reapplyAll(), INITIAL_APPLY_DELAY_MS);
        } else if (Date.now() - startedAt > WAIT_FOR_CHAT_MS) {
            observer.disconnect();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    chatBootTimerId = window.setTimeout(() => observer.disconnect(), WAIT_FOR_CHAT_MS + 1000);
}

function observeChat(chat) {
    chatObserver?.disconnect();
    chatObserver = new MutationObserver(handleMutations);
    chatObserver.observe(chat, { childList: true, subtree: true, characterData: true });
}

function handleMutations(mutations) {
    if (isApplying) return;

    const s = settings();
    if (!wantsAnyChatIntervention(s)) {
        scheduleRestoreIfNeeded();
        return;
    }

    for (const mutation of mutations) {
        if (isInternalMutation(mutation)) continue;

        const mes = findMessageFromMutation(mutation);
        if (mes) dirtyMessages.add(mes);

        for (const node of mutation.addedNodes || []) {
            collectMessagesFromNode(node, dirtyMessages);
        }
    }

    if (dirtyMessages.size) scheduleDirtyApply();
}

function isInternalMutation(mutation) {
    // Character data may be changed by SillyTavern streaming inside a paragraph we own.
    // Do not suppress those updates; they should be normalized after the stream settles.
    if (mutation.type === "characterData") return false;

    const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
    if (!target) return false;
    return Boolean(target.closest?.("[data-stir-owned], [data-stir-enhanced], [data-stir-managed-toolbar]"));
}

function findMessageFromMutation(mutation) {
    const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
    return target?.closest?.("#chat > .mes") || null;
}

function collectMessagesFromNode(node, out) {
    if (!(node instanceof Element)) return;
    if (node.matches?.("#chat > .mes")) out.add(node);
    for (const mes of node.querySelectorAll?.("#chat > .mes") || []) out.add(mes);
}

function scheduleDirtyApply() {
    if (renderTimerId) clearTimeout(renderTimerId);
    renderTimerId = window.setTimeout(() => {
        renderTimerId = null;
        flushDirtyMessages();
    }, MUTATION_APPLY_DELAY_MS);
}

function scheduleRestoreIfNeeded() {
    if (renderTimerId) clearTimeout(renderTimerId);
    renderTimerId = window.setTimeout(() => {
        renderTimerId = null;
        if (!wantsAnyChatIntervention(settings())) restoreAll();
    }, MUTATION_APPLY_DELAY_MS);
}

function flushDirtyMessages() {
    const items = Array.from(dirtyMessages).filter(mes => mes?.isConnected);
    dirtyMessages.clear();
    if (!items.length) return;

    isApplying = true;
    try {
        applyBodyState();
        for (const mes of items) applyMessage(mes);
    } finally {
        isApplying = false;
    }
}

function reapplyAll() {
    isApplying = true;
    try {
        restoreAll({ keepObservers: true });

        const s = settings();
        if (!wantsAnyChatIntervention(s)) return;

        applyBodyState(s);
        const chat = document.getElementById("chat");
        if (!chat) return;
        for (const mes of chat.querySelectorAll(":scope > .mes")) applyMessage(mes, s);
    } finally {
        isApplying = false;
    }
}

/* -------------------- Body state -------------------- */

function applyBodyState(s = settings()) {
    document.body.classList.remove(...BODY_CLASSES);

    if (!wantsAnyChatIntervention(s)) {
        clearCssVars();
        return;
    }

    if (s.enabled) document.body.classList.add("stir-reader-active");
    document.body.classList.add(`stir-font-${s.fontFamily === "custom" ? "custom" : "follow"}`);
    document.body.classList.add(`stir-user-mode-${s.userMode}`);
    document.body.classList.add(`stir-tools-${s.toolsMode}`);
    document.body.classList.add(`stir-indent-${s.indentMode}`);
    if (s.justifyText) document.body.classList.add("stir-justify-text");

    const root = document.documentElement;
    root.style.setProperty("--stir-font-size", `${s.fontSize}px`);
    root.style.setProperty("--stir-line-height", String(s.lineHeight));
    root.style.setProperty("--stir-paragraph-gap", `${s.paragraphGap}em`);
    root.style.setProperty("--stir-text-indent", `${s.indent}em`);
    root.style.setProperty("--stir-content-width", `${s.contentWidth}ch`);
    root.style.setProperty("--stir-side-padding", `${s.sidePadding}rem`);
    root.style.setProperty("--stir-custom-font-family", sanitizeFontFamily(s.customFontFamily));
}

function sanitizeFontFamily(value) {
    const text = String(value || "").trim();
    if (!text) return "inherit";
    return text.replace(/[;{}<>]/g, "");
}

function clearCssVars() {
    for (const name of [
        "--stir-font-size",
        "--stir-line-height",
        "--stir-paragraph-gap",
        "--stir-text-indent",
        "--stir-content-width",
        "--stir-side-padding",
        "--stir-custom-font-family",
    ]) {
        document.documentElement.style.removeProperty(name);
    }
}

/* -------------------- Message application -------------------- */

function applyMessage(mes, s = settings()) {
    if (!(mes instanceof Element)) return;

    restoreMessage(mes, { keepBaseMessageClass: false });

    if (!wantsAnyChatIntervention(s)) return;

    mes.classList.add("stir-message");
    const user = isUserMessage(mes);
    mes.classList.add(user ? "stir-user-message" : "stir-ai-message");

    if (user) {
        applyUserMessageMode(mes, s);
    }

    if (s.enabled && !(user && s.userMode === "hidden")) {
        applySafeReader(mes, s);
    }

    if (s.toolsMode === "folded") {
        markManagedToolbars(mes);
        if (toolOpenState.get(mes)) mes.classList.add("stir-tools-open");
        bindMessageToolbarToggle(mes);
    }
}

function isUserMessage(mes) {
    return mes.getAttribute("is_user") === "true" || mes.classList.contains("user_mes");
}

/* -------------------- Safe reader -------------------- */

function applySafeReader(mes, s) {
    const textEl = mes.querySelector(":scope > .mes_block > .mes_text") || mes.querySelector(":scope .mes_text");
    if (!textEl) return;

    const directNodes = Array.from(textEl.childNodes);
    let run = [];

    for (const node of directNodes) {
        if (isOwnedNode(node)) continue;

        if (isSafeInlineNode(node)) {
            run.push(node);
            continue;
        }

        flushTextRun(run, s);
        run = [];

        if (isSafeReadableBlock(node)) {
            enhanceReadableBlock(node, s);
        }
    }

    flushTextRun(run, s);
}

function isOwnedNode(node) {
    return node instanceof Element && node.hasAttribute("data-stir-owned");
}

function isSafeInlineNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
        return Boolean(node.nodeValue && node.nodeValue.replace(/[\u200B\uFEFF]/g, "").trim());
    }

    if (!(node instanceof Element)) return false;
    if (node.tagName === "BR") return true;
    if (!SAFE_INLINE_TAGS.has(node.tagName)) return false;
    return isSafeElementTree(node, { allowBlock: false });
}

function isSafeReadableBlock(node) {
    if (!(node instanceof Element)) return false;
    if (!SAFE_BLOCK_TAGS.has(node.tagName)) return false;
    return isSafeElementTree(node, { allowBlock: true });
}

function isSafeElementTree(el, { allowBlock }) {
    if (!(el instanceof Element)) return false;
    if (UNSAFE_TAGS.has(el.tagName)) return false;

    if (allowBlock) {
        if (!SAFE_BLOCK_TAGS.has(el.tagName) && !SAFE_INLINE_TAGS.has(el.tagName) && el.tagName !== "BR") return false;
    } else {
        if (!SAFE_INLINE_TAGS.has(el.tagName) && el.tagName !== "BR") return false;
    }

    if (el.id) return false;
    if (el.hasAttribute("role")) return false;
    if (el.hasAttribute("tabindex")) return false;
    if (el.hasAttribute("style")) return false;
    if (el.hasAttribute("contenteditable")) return false;

    for (const attr of el.getAttributeNames()) {
        const name = attr.toLowerCase();
        if (name.startsWith("data-") && !name.startsWith("data-stir-")) return false;
        if (name.startsWith("on")) return false;
    }

    // Direct Markdown paragraphs may receive theme/ST classes. Allow classes on block <p>
    // because we are not replacing the node; we only add our own reversible mark.
    if (typeof el.className === "string" && el.className.trim() && !(allowBlock && el.tagName === "P")) {
        const classes = Array.from(el.classList);
        const allowed = new Set(["stir-readable-block", "stir-readable-inline"]);
        if (classes.some(cls => !allowed.has(cls))) return false;
    }

    for (const child of el.children) {
        if (!isSafeElementTree(child, { allowBlock: false })) return false;
    }

    return true;
}

function enhanceReadableBlock(el, s) {
    if (!(el instanceof Element)) return;
    el.classList.add("stir-readable-block");
    el.setAttribute("data-stir-enhanced", "1");

    if (s?.splitBrToParagraph) {
        splitReadableBlockByBreaks(el);
    }
}

function splitReadableBlockByBreaks(el) {
    if (!(el instanceof Element)) return;
    if (!Array.from(el.childNodes).some(node => node instanceof HTMLBRElement)) return;

    el.classList.add("stir-readable-split-block");
    const nodes = Array.from(el.childNodes);
    let group = [];

    const flushGroup = () => {
        if (!group.length) return;
        if (!hasMeaningfulText(group)) {
            group = [];
            return;
        }

        const first = group.find(node => node.isConnected);
        if (!first || !first.parentNode) {
            group = [];
            return;
        }

        const line = document.createElement("span");
        line.className = "stir-owned-line-paragraph";
        line.setAttribute("data-stir-owned", "line");

        first.parentNode.insertBefore(line, first);
        for (const node of group) {
            if (node.isConnected) line.appendChild(node);
        }

        group = [];
    };

    for (const node of nodes) {
        if (node instanceof HTMLBRElement) {
            flushGroup();
            node.setAttribute("data-stir-source-break", "1");
            continue;
        }

        group.push(node);
    }

    flushGroup();
}

function flushTextRun(run, s) {
    if (!run.length) return;

    if (!s.splitBrToParagraph) {
        wrapRunAsParagraph(run);
        return;
    }

    const groups = splitRunByParagraphBreaks(run);
    for (const group of groups) {
        if (!group.length) continue;
        if (!hasMeaningfulText(group)) {
            // Preserve whitespace/break-only groups in-place by not moving them.
            continue;
        }
        wrapRunAsParagraph(group);
    }
}

function splitRunByParagraphBreaks(run) {
    const groups = [];
    let current = [];

    const pushCurrent = () => {
        if (current.length) groups.push(current);
        current = [];
    };

    for (const node of run) {
        if (node instanceof HTMLBRElement) {
            node.setAttribute("data-stir-source-break", "1");
            pushCurrent();
            continue;
        }

        current.push(node);
    }

    pushCurrent();
    return groups;
}

function wrapRunAsParagraph(nodes) {
    const first = nodes.find(node => node.isConnected);
    if (!first || !first.parentNode) return;

    const paragraph = document.createElement("p");
    paragraph.className = "stir-owned-paragraph";
    paragraph.setAttribute("data-stir-owned", "paragraph");

    first.parentNode.insertBefore(paragraph, first);
    for (const node of nodes) {
        if (node.isConnected) paragraph.appendChild(node);
    }
}

function hasMeaningfulText(nodes) {
    return nodes.some(node => {
        if (node.nodeType === Node.TEXT_NODE) return Boolean(node.nodeValue?.replace(/[\u200B\uFEFF]/g, "").trim());
        if (node instanceof HTMLBRElement) return false;
        if (node instanceof Element) return Boolean(node.textContent?.replace(/[\u200B\uFEFF]/g, "").trim());
        return false;
    });
}

/* -------------------- User messages -------------------- */

function applyUserMessageMode(mes, s) {
    if (s.userMode === "hidden") {
        mes.classList.add("stir-user-hidden");
        return;
    }

    if (s.userMode !== "folded") return;

    mes.classList.add("stir-user-folded");
    if (userFoldOpenState.get(mes)) mes.classList.add("stir-user-fold-open");
    ensureUserFoldPlaceholder(mes);
    updateUserFoldPlaceholderState(mes);
    bindUserFoldToggle(mes);
}

function ensureUserFoldPlaceholder(mes) {
    const block = mes.querySelector(":scope > .mes_block") || mes;
    if (block.querySelector(':scope > [data-stir-owned="user-fold"]')) return;

    const textEl = block.querySelector(":scope > .mes_text") || block.querySelector(".mes_text");
    const placeholder = document.createElement("button");
    placeholder.type = "button";
    placeholder.className = "stir-user-fold-placeholder";
    placeholder.setAttribute("data-stir-owned", "user-fold");
    placeholder.setAttribute("aria-expanded", "false");
    placeholder.title = "用户消息已折叠，点击展开或收起";
    placeholder.setAttribute("aria-label", "用户消息已折叠，点击展开或收起");
    placeholder.innerHTML = `<span class="stir-user-fold-line" aria-hidden="true"></span>`;

    if (textEl?.parentNode === block) {
        block.insertBefore(placeholder, textEl);
    } else {
        block.appendChild(placeholder);
    }
}

function updateUserFoldPlaceholderState(mes) {
    const placeholder = mes.querySelector('[data-stir-owned="user-fold"]');
    if (!placeholder) return;
    const expanded = mes.classList.contains("stir-user-fold-open");
    placeholder.setAttribute("aria-expanded", String(expanded));
}

function bindUserFoldToggle(mes) {
    const current = boundMessages.get(mes);
    if (current?.userFold) return;

    const controller = current?.controller || new AbortController();
    const next = current || { controller };
    next.userFold = true;
    boundMessages.set(mes, next);

    mes.addEventListener("click", event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const placeholder = target.closest('[data-stir-owned="user-fold"]');
        if (!placeholder || !mes.contains(placeholder)) return;

        event.preventDefault();
        event.stopPropagation();
        const expanded = !mes.classList.contains("stir-user-fold-open");
        mes.classList.toggle("stir-user-fold-open", expanded);
        userFoldOpenState.set(mes, expanded);
        updateUserFoldPlaceholderState(mes);
    }, { signal: controller.signal });
}

/* -------------------- Toolbar folding -------------------- */

function markManagedToolbars(mes) {
    const block = mes.querySelector(":scope > .mes_block") || mes;
    const candidates = new Set();

    if (block.matches?.(MANAGED_TOOLBAR_SELECTORS)) candidates.add(block);
    for (const el of block.querySelectorAll?.(MANAGED_TOOLBAR_SELECTORS) || []) {
        candidates.add(el);
    }

    for (const el of candidates) {
        if (!(el instanceof Element)) continue;
        if (el.closest(".mes_text")) continue;
        if (!mes.contains(el)) continue;
        el.setAttribute("data-stir-managed-toolbar", "1");
    }
}

function bindMessageToolbarToggle(mes) {
    const current = boundMessages.get(mes);
    if (current?.toolbar) return;

    const controller = current?.controller || new AbortController();
    const next = current || { controller };
    next.toolbar = true;
    boundMessages.set(mes, next);

    mes.addEventListener("click", event => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;

        if (target.closest(".mes_text")) return;
        if (target.closest('[data-stir-owned="user-fold"]')) return;

        if (isToolbarInteractionTarget(target, mes)) {
            mes.classList.add("stir-tools-open");
            toolOpenState.set(mes, true);
            return;
        }

        const header = target.closest(HEADER_SELECTOR);
        const blockChrome = target.closest(".mes_block");
        if (!header && !blockChrome && target !== mes) return;

        const expanded = !mes.classList.contains("stir-tools-open");
        mes.classList.toggle("stir-tools-open", expanded);
        toolOpenState.set(mes, expanded);
    }, { capture: true, signal: controller.signal });
}

function isToolbarInteractionTarget(target, mes) {
    if (!(target instanceof Element) || !(mes instanceof Element)) return false;

    const marked = target.closest('[data-stir-managed-toolbar="1"]');
    if (marked && mes.contains(marked) && !marked.closest(".mes_text")) return true;

    const nativeToolbar = target.closest(MANAGED_TOOLBAR_SELECTORS);
    if (nativeToolbar && mes.contains(nativeToolbar) && !nativeToolbar.closest(".mes_text")) return true;

    return false;
}

/* -------------------- Restore -------------------- */

function restoreAll({ keepObservers = true } = {}) {
    if (!keepObservers) {
        chatObserver?.disconnect();
        chatObserver = null;
    }

    if (renderTimerId) {
        clearTimeout(renderTimerId);
        renderTimerId = null;
    }
    dirtyMessages.clear();

    for (const [, entry] of boundMessages) {
        entry.controller?.abort();
    }
    boundMessages.clear();

    const chat = document.getElementById("chat") || document;
    unwrapOwnedParagraphs(chat);
    cleanupEnhancedMarks(chat);
    cleanupOwnedPlaceholders(chat);
    cleanupToolbarMarks(chat);

    for (const mes of chat.querySelectorAll?.(".stir-message, .stir-user-message, .stir-ai-message, .stir-user-hidden, .stir-user-folded, .stir-user-fold-open, .stir-tools-open") || []) {
        mes.classList.remove(...MESSAGE_CLASSES);
    }

    document.body.classList.remove(...BODY_CLASSES);
    clearCssVars();
}

function restoreMessage(mes) {
    const entry = boundMessages.get(mes);
    if (entry) {
        entry.controller?.abort();
        boundMessages.delete(mes);
    }

    unwrapOwnedParagraphs(mes);
    cleanupEnhancedMarks(mes);
    cleanupOwnedPlaceholders(mes);
    cleanupToolbarMarks(mes);
    mes.classList.remove(...MESSAGE_CLASSES);
}

function unwrapOwnedParagraphs(root) {
    const owned = Array.from(root.querySelectorAll?.('[data-stir-owned="line"], [data-stir-owned="paragraph"]') || []);
    for (const node of owned) {
        const parent = node.parentNode;
        if (!parent) continue;
        for (const br of node.querySelectorAll('br[data-stir-source-break="1"]')) {
            br.removeAttribute("data-stir-source-break");
        }
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        node.remove();
    }
}

function cleanupEnhancedMarks(root) {
    for (const el of root.querySelectorAll?.('[data-stir-enhanced="1"]') || []) {
        el.classList.remove(...READER_MARK_CLASSES);
        el.removeAttribute("data-stir-enhanced");
    }
    for (const br of root.querySelectorAll?.('br[data-stir-source-break="1"]') || []) {
        br.removeAttribute("data-stir-source-break");
    }
}

function cleanupOwnedPlaceholders(root) {
    for (const el of root.querySelectorAll?.('[data-stir-owned="user-fold"]') || []) {
        el.remove();
    }
}

function cleanupToolbarMarks(root) {
    for (const el of root.querySelectorAll?.('[data-stir-managed-toolbar="1"]') || []) {
        el.removeAttribute("data-stir-managed-toolbar");
    }
}

/* -------------------- Public hooks -------------------- */

export function onEnable() {
    start();
    reapplyAll();
}

export function onDisable() {
    restoreAll({ keepObservers: true });
}

export function onDelete() {
    restoreAll({ keepObservers: false });
}

jQuery(async () => {
    settings();
    applyBodyState();
    start();
    console.info(`[${MODULE_NAME}] ${VERSION} · by ${AUTHOR}`);
});
