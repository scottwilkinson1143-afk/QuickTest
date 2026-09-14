// Tiny helpers for this app's self-hosted SVG icon sprite (inline near the
// top of <body> in index.html). Loaded first, before any other script
// (plain, non-deferred <script> tag - runs synchronously as the parser
// reaches it), so every other script that builds icon markup at runtime
// (chartToolbar.js, selfService.js, main.js, header/*.js) can rely on
// these existing regardless of script-execution order - a deferred script
// (like main.js) actually runs AFTER these earlier synchronous ones, not
// before, so defining this there wouldn't have been visible to them in
// time.

// "mu-icon", not the more obvious "icon" - Material Dashboard's own vendor
// markup already uses a bare .icon class (e.g. the KPI badge wrapper divs,
// class="icon icon-lg icon-shape ..."), which has no CSS rule of its own
// in theme.css but would still collide with this class's sizing rule in
// custom.css if we reused the same name - that collision is exactly what
// broke the KPI badges' look the first time this was tried.

// Builds the same markup index.html hand-writes for static icons, for JS
// that builds icon markup at runtime instead.
function iconSvg(name, extraClass, style) {
    const styleAttr = style ? ' style="' + style + '"' : '';
    return '<svg class="mu-icon' + (extraClass ? ' ' + extraClass : '') + '" aria-hidden="true"' + styleAttr + '><use href="#icon-' + name + '"></use></svg>';
}

// Swaps which sprite symbol an already-rendered icon points at (e.g.
// toggling expand_more <-> expand_less) - `container` is either the
// <svg class="mu-icon"> itself or an ancestor of it.
function setIconName(container, name) {
    if (!container) {
        return;
    }
    const use = container.tagName && container.tagName.toLowerCase() === 'use' ? container : container.querySelector('use');
    if (use) {
        use.setAttribute('href', '#icon-' + name);
    }
}
