import { extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const MODULE_NAME = "st-immersive-reading";
const MODULE_DISPLAY_NAME = "沉浸式阅读";
const VERSION = "1.0.5";

const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,

    userMode: "normal",      // normal | folded | hidden
    toolsMode: "always",     // always | folded

    fontFamily: "system",    // system | custom
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
    layoutMode: "follow",    // follow | clean
});

// 运行时状态
let observer = null;
let observerTarget = null;
let renderQueued = false;
let isRendering = false;
let lastRenderKey = "";

// 面板注入 & observer 挂载重试
let panelBootTimer = null;
let observerBootTimer = null;
const BOOT_INTERVAL_MS = 500;
const BOOT_MAX_ATTEMPTS = 40; // 最多 20s

function settings() {
    extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {};
    const s = extension_settings[MODULE_NAME];

    // 补齐缺失项
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.prototype.hasOwnProperty.call(s, key)) s[key] = value;
    }
    return s;
}

function persist() {
    saveSettingsDebounced();
}

/* -------------------- 设置面板 -------------------- */

function initPanel() {
    if (document.getElementById("stir_settings_panel")) return true;

    const target = document.querySelector("#extensions_settings2") || document.querySelector("#extensions_settings");
    if (!target) return false;

    const html = `
        <div id="stir_settings_panel" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>ST Immersive Reading / ${MODULE_DISPLAY_NAME}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label">
                    <input id="stir_enabled" type="checkbox">
                    <span>启用阅读排版</span>
                </label>

                <div class="stir-note stir-important-note">
                    为 SillyTavern 长文本 RP 提供沉浸式阅读排版。保留原消息、原按钮、编辑/删除/swipe/楼层信息；只生成阅读投影来优化段落、缩进和手机阅读体验。主题、背景与复杂 HTML 始终跟随酒馆。
                </div>

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
                    <div class="stir-inline-help">填写 CSS font-family 值；多个字体用英文逗号分隔；字体名含空格建议加英文引号；不要写 font-family:，末尾不要加句号。</div>
                </div>

                <div class="stir-grid">
                    <label>字号(px) <input id="stir_font_size" type="range" min="14" max="28" step="1"></label>
                    <input id="stir_font_size_num" class="stir-number-input" type="number" min="14" max="28" step="1">

                    <label>行高(倍) <input id="stir_line_height" type="range" min="1.35" max="2.3" step="0.01"></label>
                    <input id="stir_line_height_num" class="stir-number-input" type="number" min="1.35" max="2.3" step="0.01">

                    <label>段距(em) <input id="stir_paragraph_gap" type="range" min="0" max="1.2" step="0.02"></label>
                    <input id="stir_paragraph_gap_num" class="stir-number-input" type="number" min="0" max="1.2" step="0.02">

                    <label>缩进(em) <input id="stir_indent" type="range" min="0" max="4" step="0.1"></label>
                    <input id="stir_indent_num" class="stir-number-input" type="number" min="0" max="4" step="0.1">

                    <label>最大宽度(rem) <input id="stir_content_width" type="range" min="18" max="72" step="1"></label>
                    <input id="stir_content_width_num" class="stir-number-input" type="number" min="18" max="72" step="1">

                    <label>边距(rem) <input id="stir_side_padding" type="range" min="0.2" max="3.2" step="0.05"></label>
                    <input id="stir_side_padding_num" class="stir-number-input" type="number" min="0.2" max="3.2" step="0.05">
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

                <div class="stir-note">
                    “最大宽度”主要影响桌面/平板；手机端更明显的是“边距”。主题、背景、默认字体跟随酒馆；“布局兼容”只修正第三方主题造成的消息外壳挤压，不接管全局主题。
                </div>
            </div>
        </div>`;

    target.insertAdjacentHTML("beforeend", html);
    hydratePanel();
    bindPanelEvents();
    return true;
}

function schedulePanelBoot() {
    if (initPanel()) return;

    let attempts = 0;
    panelBootTimer = setInterval(() => {
        attempts += 1;
        if (initPanel() || attempts >= BOOT_MAX_ATTEMPTS) {
            clearInterval(panelBootTimer);
            panelBootTimer = null;
        }
    }, BOOT_INTERVAL_MS);
}

function hydratePanel() {
    const s = settings();

    $("#stir_enabled").prop("checked", !!s.enabled);
    $("#stir_user_mode").val(s.userMode);
    $("#stir_tools_mode").val(s.toolsMode);
    $("#stir_font_family").val(s.fontFamily);
    $("#stir_custom_font").val(s.customFontFamily || "");
    $("#stir_indent_mode").val(s.indentMode);
    $("#stir_layout_mode").val(s.layoutMode || "follow");
    $("#stir_split_br").prop("checked", !!s.splitBrToParagraph);
    $("#stir_justify_text").prop("checked", !!s.justifyText);

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

    for (const [range, number, value] of pairs) {
        const active = document.activeElement;
        if (active !== document.querySelector(range)) $(range).val(value);
        if (active !== document.querySelector(number)) $(number).val(value);
    }
}

function updateCustomFontVisibility() {
    $("#stir_settings_panel").toggleClass("stir-custom-font-enabled", settings().fontFamily === "custom");
}

function bindPanelEvents() {
    $("#stir_enabled").on("change", event => {
        settings().enabled = Boolean(event.target.checked);
        applyReaderState();
        requestRender("enabled");
        persist();
    });

    $("#stir_user_mode").on("change", event => {
        settings().userMode = event.target.value;
        applyReaderState();
        requestRender("user-mode");
        persist();
    });

    $("#stir_tools_mode").on("change", event => {
        settings().toolsMode = event.target.value;
        applyReaderState();
        persist();
    });

    $("#stir_font_family").on("change", event => {
        settings().fontFamily = event.target.value;
        updateCustomFontVisibility();
        applyReaderState();
        persist();
    });

    $("#stir_custom_font").on("input change", event => {
        settings().customFontFamily = String(event.target.value || "");
        applyReaderState();
        persist();
    });

    $("#stir_indent_mode").on("change", event => {
        settings().indentMode = event.target.value;
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
        $(`${range}, ${number}`).on("input change", event => {
            const value = Number(event.target.value);
            if (!Number.isFinite(value)) return;

            settings()[key] = value;
            updateNumbers();
            applyReaderState();
            persist();
        });
    }

    const booleanBindings = [
        ["#stir_split_br", "splitBrToParagraph", true],
        ["#stir_justify_text", "justifyText", false],
    ];

    for (const [selector, key, rerender] of booleanBindings) {
        $(selector).on("change", event => {
            settings()[key] = Boolean(event.target.checked);
            applyReaderState();
            if (rerender) {
                // 结构性选项：强制让所有消息重新投影
                lastRenderKey = "";
                requestRender(key);
            }
            persist();
        });
    }

    $("#stir_layout_mode").on("change", event => {
        settings().layoutMode = event.target.value;
        applyReaderState();
        persist();
    });
}

/* -------------------- 阅读态应用 -------------------- */

function customFontFamilyValue() {
    const custom = String(settings().customFontFamily || "").trim();
    return custom || "inherit";
}

function applyReaderState() {
    const s = settings();
    const root = document.documentElement;

    root.style.setProperty("--stir-font-size", `${s.fontSize}px`);
    root.style.setProperty("--stir-line-height", String(s.lineHeight));
    root.style.setProperty("--stir-paragraph-gap", `${s.paragraphGap}em`);
    root.style.setProperty("--stir-indent", `${s.indent}em`);
    root.style.setProperty("--stir-content-width", `${s.contentWidth}rem`);
    root.style.setProperty("--stir-side-padding", `${s.sidePadding}rem`);
    root.style.setProperty("--stir-custom-font-family", customFontFamilyValue());

    const remove = [
        "stir-reader-active",
        "stir-font-follow", "stir-font-custom",
        "stir-user-folded", "stir-user-normal", "stir-user-hidden",
        "stir-tools-folded", "stir-tools-always",
        "stir-indent-firstline", "stir-indent-block", "stir-indent-off",
        "stir-layout-follow", "stir-layout-clean",
        "stir-justify-text",
    ];

    document.body.classList.remove(...remove);
    document.body.classList.add(s.fontFamily === "custom" ? "stir-font-custom" : "stir-font-follow");
    document.body.classList.add(`stir-user-${s.userMode || "normal"}`);
    document.body.classList.add(`stir-tools-${s.toolsMode || "always"}`);
    document.body.classList.add(`stir-indent-${s.indentMode || "firstline"}`);
    document.body.classList.add(`stir-layout-${s.layoutMode || "follow"}`);

    if (s.justifyText) document.body.classList.add("stir-justify-text");

    if (s.enabled) {
        document.body.classList.add("stir-reader-active");
        startObserver();
    } else {
        teardown();
    }
}

/* -------------------- Observer（精确监听 #chat） -------------------- */

function startObserver() {
    const chat = document.getElementById("chat");
    if (!chat) {
        scheduleObserverBoot();
        return;
    }
    if (observer && observerTarget === chat) return;

    if (observer) {
        observer.disconnect();
        observer = null;
    }

    observerTarget = chat;
    observer = new MutationObserver(mutations => {
        if (isRendering) return;
        if (!settings().enabled) return;
        if (mutations.every(isInternalMutation)) return;
        requestRender("mutation");
    });
    observer.observe(chat, { childList: true, subtree: true, characterData: true });
}

function scheduleObserverBoot() {
    if (observerBootTimer) return;

    let attempts = 0;
    observerBootTimer = setInterval(() => {
        attempts += 1;
        if (!settings().enabled) {
            clearInterval(observerBootTimer);
            observerBootTimer = null;
            return;
        }
        if (document.getElementById("chat") || attempts >= BOOT_MAX_ATTEMPTS) {
            clearInterval(observerBootTimer);
            observerBootTimer = null;
            startObserver();
        }
    }, BOOT_INTERVAL_MS);
}

function isInternalMutation(mutation) {
    const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
    if (!target) return false;
    return Boolean(target.closest?.(".stir-reader-projection, .stir-message-tools-toggle, .stir-native-content"));
}

/* -------------------- 渲染调度 -------------------- */

function requestRender(reason = "manual") {
    if (!settings().enabled) return;
    if (renderQueued) return;

    renderQueued = true;
    requestAnimationFrame(() => {
        renderQueued = false;
        renderAll(reason);
    });
}

function renderAll(reason = "manual") {
    const chat = document.querySelector("#chat");
    if (!chat || !settings().enabled) return;

    const messages = [...chat.querySelectorAll(":scope > .mes")];
    const s = settings();
    const renderKey = `${reason}|${messages.length}|${s.userMode}|${s.toolsMode}|${s.splitBrToParagraph}|${s.indentMode}`;

    if (renderKey === lastRenderKey && reason !== "mutation") return;
    lastRenderKey = renderKey;

    isRendering = true;
    try {
        for (const mes of messages) renderMessage(mes);
    } finally {
        isRendering = false;
    }
}

function renderMessage(mes) {
    const textEl = mes.querySelector(".mes_text");
    if (!textEl) return;

    mes.classList.add("stir-message");
    mes.classList.toggle("stir-user-message", isUserMessage(mes));
    mes.classList.toggle("stir-ai-message", !isUserMessage(mes));

    const isEditing = Boolean(mes.querySelector("textarea, .edit_textarea, [contenteditable='true']"));
    mes.classList.toggle("stir-editing", isEditing);
    if (isEditing) {
        mes.classList.add("stir-tools-open");
        mes.classList.add("stir-native-content-mode");
    }

    bindHeaderToggle(mes);
    ensureNativeWrapper(textEl);

    const wrapper = textEl.querySelector(":scope > .stir-native-content");
    const projection = textEl.querySelector(":scope > .stir-reader-projection");
    if (!wrapper || !projection) return;

    const hash = messageHash(wrapper);
    const s = settings();
    const renderHash = `${hash}|${s.userMode}|${s.splitBrToParagraph}|${s.indentMode}|${isEditing ? "e" : "v"}`;
    if (projection.dataset.stirRenderHash === renderHash && !isEditing) return;

    projection.dataset.stirRenderHash = renderHash;
    projection.hidden = false;
    projection.replaceChildren();

    if (!mes.classList.contains("stir-editing")) {
        mes.classList.remove("stir-native-content-mode");
    }

    if (mes.classList.contains("stir-editing") || isComplexContent(wrapper)) {
        mes.classList.add("stir-native-content-mode");
        projection.hidden = true;
        return;
    }

    if (isUserMessage(mes)) {
        projection.append(buildUserProjection(wrapper));
        return;
    }

    appendReadableBlocks(wrapper, projection);
}

function ensureNativeWrapper(textEl) {
    // 不替换酒馆消息，只在正文里加一层投影容器。
    if (textEl.querySelector(":scope > .stir-native-content") && textEl.querySelector(":scope > .stir-reader-projection")) return;

    const wrapper = document.createElement("div");
    wrapper.className = "stir-native-content";

    const projection = document.createElement("div");
    projection.className = "stir-reader-projection";

    const nodes = [...textEl.childNodes].filter(node => !node.classList?.contains?.("stir-reader-projection"));
    for (const node of nodes) wrapper.append(node);

    textEl.append(wrapper, projection);
}

function bindHeaderToggle(mes) {
    mes.querySelector(":scope > .stir-message-tools-toggle")?.remove();
    if (mes.dataset.stirHeaderToggleBound === "1") return;

    mes.dataset.stirHeaderToggleBound = "1";
    mes.addEventListener("click", event => {
        if (!settings().enabled || settings().toolsMode !== "folded") return;

        const target = event.target;
        if (!(target instanceof Element)) return;

        const nativeControl = target.closest([
            "button", "a", "input", "textarea", "select", "option", "summary", "details",
            "[contenteditable='true']", ".swipe_left", ".swipe_right",
            ".mes_buttons", ".extraMesButtons", ".extra_mes_buttons", ".mes_edit_buttons",
            ".mes_button", ".mes_edit", ".mes_delete", ".mes_copy", ".mes_more", ".menu_button",
            "[class*='mes_edit']", "[class*='mes_button']", "[class*='extraMes']",
        ].join(","));

        if (nativeControl) {
            mes.classList.add("stir-tools-open");
            return;
        }

        if (target.closest(".stir-reader-projection, .mes_text")) return;

        const header = target.closest(".mesAvatarWrapper, .ch_name, .name_text, .mes_name, .avatar, .mes_timer, .timestamp, .mesIDDisplay, .tokenCounterDisplay, .mes_model, .mes_meta, .mes_header");
        if (!header || !mes.contains(header)) return;

        mes.classList.toggle("stir-tools-open");
    }, true);
}

/* -------------------- 投影构建 -------------------- */

function buildUserProjection(wrapper) {
    const mode = settings().userMode;
    if (mode === "hidden") return buildHiddenUserProjection();
    if (mode === "folded") return buildFoldedUserProjection(wrapper);

    const div = document.createElement("div");
    appendReadableBlocks(wrapper, div);
    return div;
}

function buildFoldedUserProjection(wrapper) {
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
    appendReadableBlocks(wrapper, body);

    details.append(summary, body);
    return details;
}

function buildHiddenUserProjection() {
    const div = document.createElement("div");
    div.className = "stir-user-hidden-marker";
    div.setAttribute("aria-label", "用户消息已隐藏");
    return div;
}

function appendReadableBlocks(source, target) {
    let paragraph = null;

    const ensureParagraph = () => {
        if (!paragraph) {
            paragraph = document.createElement("p");
            paragraph.className = "stir-p";
        }
        return paragraph;
    };

    const flush = () => {
        if (!paragraph) return;
        if (paragraph.textContent.trim() || paragraph.children.length) target.append(paragraph);
        paragraph = null;
    };

    const splitBr = settings().splitBrToParagraph;

    for (const node of [...source.childNodes]) {
        if (node.nodeType === Node.TEXT_NODE) {
            appendTextNode(node, ensureParagraph, flush);
            continue;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = node.tagName.toLowerCase();
        if (tag === "br") {
            if (splitBr) flush();
            else ensureParagraph().append(document.createElement("br"));
            continue;
        }

        if (tag === "p") {
            flush();
            if (splitBr && containsBr(node)) {
                appendReadableBlocks(node, target);
            } else {
                target.append(cloneAsParagraph(node));
            }
            continue;
        }

        if (isSimpleBlock(node)) {
            flush();
            if (splitBr && containsBr(node)) {
                appendReadableBlocks(node, target);
            } else {
                target.append(cloneAsParagraph(node));
            }
            continue;
        }

        ensureParagraph().append(node.cloneNode(true));
    }

    flush();
}

function containsBr(node) {
    return Boolean(node.querySelector && node.querySelector("br"));
}

function appendTextNode(node, ensureParagraph, flush) {
    const text = node.textContent.replace(/\r\n/g, "\n");
    const parts = settings().splitBrToParagraph ? text.split(/\n+/) : [text];

    parts.forEach((part, index) => {
        const normalized = part.replace(/[\t ]+/g, " ");
        if (normalized.trim()) ensureParagraph().append(document.createTextNode(normalized));
        if (settings().splitBrToParagraph && index < parts.length - 1) flush();
    });
}

function cloneAsParagraph(node) {
    const p = document.createElement("p");
    p.className = "stir-p";
    for (const child of [...node.childNodes]) p.append(child.cloneNode(true));
    return p;
}

function isSimpleBlock(node) {
    const tag = node.tagName.toLowerCase();
    if (!["div", "section", "article"].includes(tag)) return false;
    return !node.querySelector("table, pre, ul, ol, img, video, audio, canvas, svg, iframe, form, input, button, select, textarea, details");
}

function isComplexContent(wrapper) {
    // 复杂内容交回酒馆原生渲染，避免破坏表格、代码块和扩展组件。
    return Boolean(wrapper.querySelector([
        "table", "pre", "ul", "ol", "img", "video", "audio", "canvas", "svg", "iframe",
        "form", "input", "button", "select", "textarea", "details", "script", "style",
        ".mes_reasoning", ".stscript", ".world_entry", ".qr--buttons", ".stir-rich-block",
    ].join(",")));
}

function messageHash(wrapper) {
    // 首尾双采样：流式生成时尾部变化剧烈；把采样扩到 128/128 降低碰撞概率。
    const html = wrapper.innerHTML;
    const textLen = wrapper.textContent.length;
    const head = html.length > 128 ? html.slice(0, 128) : html;
    const tail = html.length > 256 ? html.slice(-128) : "";
    return `${textLen}:${html.length}:${head}:${tail}`;
}

function isUserMessage(mes) {
    return mes.getAttribute("is_user") === "true" || mes.classList.contains("user_mes");
}

/* -------------------- 关闭清理 -------------------- */

function teardown() {
    if (observer) {
        observer.disconnect();
        observer = null;
        observerTarget = null;
    }
    if (observerBootTimer) {
        clearInterval(observerBootTimer);
        observerBootTimer = null;
    }

    lastRenderKey = "";

    document.body.classList.remove(
        "stir-reader-active", "stir-justify-text",
        "stir-font-follow", "stir-font-custom",
        "stir-user-folded", "stir-user-normal", "stir-user-hidden",
        "stir-tools-folded", "stir-tools-always",
        "stir-indent-firstline", "stir-indent-block", "stir-indent-off",
        "stir-layout-follow", "stir-layout-clean",
    );

    for (const mes of document.querySelectorAll("#chat > .mes.stir-message")) {
        mes.classList.remove("stir-message", "stir-user-message", "stir-ai-message", "stir-native-content-mode", "stir-tools-open", "stir-editing");
        mes.querySelector(":scope > .stir-message-tools-toggle")?.remove();

        const textEl = mes.querySelector(".mes_text");
        const wrapper = textEl?.querySelector(":scope > .stir-native-content");
        const projection = textEl?.querySelector(":scope > .stir-reader-projection");
        if (!textEl || !wrapper) continue;

        projection?.remove();
        while (wrapper.firstChild) textEl.append(wrapper.firstChild);
        wrapper.remove();
    }
}

/* -------------------- 入口 -------------------- */

jQuery(async () => {
    settings();
    schedulePanelBoot();
    applyReaderState();
    requestRender("boot");
    console.info(`[${MODULE_NAME}] loaded v${VERSION}`);
});
