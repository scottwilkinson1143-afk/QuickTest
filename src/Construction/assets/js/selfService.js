// Self Service report builder (Self Service tab): users pick a predefined
// canvas layout, then drag master visualizations from the library onto its
// slots. Each slot renders the dropped master item the same way every
// other object in this mashup is embedded - app.getObject(elementId, qId) -
// master visualizations are ordinary GenericObjects with their own qId, so
// no different API is needed.
//
// Persistence is explicit, not automatic: the working canvas only exists
// in memory until the user clicks "Save layout", names it, and it's added
// to a named list of saved layouts in localStorage (per browser/device),
// browsable from the "My layouts" gallery. A confirmation prompt on leaving
// the page with unsaved changes backstops anyone who forgets to save.
//
// Usage: call initSelfService(app) once, after the app has opened.

const SELF_SERVICE_SAVED_LAYOUTS_KEY = 'mashup.selfService.savedLayouts.v1';

// Each layout is a CSS grid (columns x rows) plus one "cell" per slot.
// A cell can override its default single-track placement with an explicit
// col/row (standard CSS grid-column/grid-row syntax, e.g. "1 / span 2")
// to span multiple tracks - this is what makes the hero/wide-card variants
// possible without a dedicated CSS class per layout.
const SELF_SERVICE_LAYOUTS = [
    { id: 'one-col', label: '1 Column', icon: 'view_agenda', columns: 1, rows: 1,
        cells: [{}] },
    { id: 'two-col', label: '2 Columns', icon: 'view_column', columns: 2, rows: 1,
        cells: [{}, {}] },
    { id: 'three-col', label: '3 Columns', icon: 'view_week', columns: 3, rows: 1,
        cells: [{}, {}, {}] },
    { id: 'four-col', label: '4 Columns', icon: 'view_column', columns: 4, rows: 1,
        cells: [{}, {}, {}, {}] },
    { id: 'five-col', label: '5 Columns', icon: 'view_column', columns: 5, rows: 1,
        cells: [{}, {}, {}, {}, {}] },
    { id: 'two-row', label: '2 Rows', icon: 'table_rows', columns: 1, rows: 2,
        cells: [{}, {}] },
    { id: 'three-row', label: '3 Rows', icon: 'table_rows', columns: 1, rows: 3,
        cells: [{}, {}, {}] },
    { id: 'hero-left', label: '1 Large Left + 2 Small', icon: 'dashboard', columns: 2, rows: 2,
        cells: [{ col: '1', row: '1 / span 2' }, { col: '2', row: '1' }, { col: '2', row: '2' }] },
    { id: 'hero-right', label: '2 Small + 1 Large Right', icon: 'dashboard', columns: 2, rows: 2,
        cells: [{ col: '1', row: '1' }, { col: '1', row: '2' }, { col: '2', row: '1 / span 2' }] },
    { id: 'hero-top', label: '1 Wide Top + 2 Below', icon: 'view_agenda', columns: 2, rows: 2,
        cells: [{ col: '1 / span 2', row: '1' }, { col: '1', row: '2' }, { col: '2', row: '2' }] },
    { id: 'hero-bottom', label: '2 Above + 1 Wide Bottom', icon: 'view_agenda', columns: 2, rows: 2,
        cells: [{ col: '1', row: '1' }, { col: '2', row: '1' }, { col: '1 / span 2', row: '2' }] },
    { id: 'grid-2x2', label: '2x2 Grid', icon: 'grid_view', columns: 2, rows: 2,
        cells: [{}, {}, {}, {}] },
    { id: 'three-plus-one', label: '3 Small + 1 Wide Bottom', icon: 'view_agenda', columns: 3, rows: 2,
        cells: [{ col: '1', row: '1' }, { col: '2', row: '1' }, { col: '3', row: '1' }, { col: '1 / span 3', row: '2' }] },
    { id: 'one-plus-three', label: '1 Wide Top + 3 Below', icon: 'view_agenda', columns: 3, rows: 2,
        cells: [{ col: '1 / span 3', row: '1' }, { col: '1', row: '2' }, { col: '2', row: '2' }, { col: '3', row: '2' }] },
    { id: 'grid-2x3', label: '2x3 Grid', icon: 'grid_view', columns: 3, rows: 2,
        cells: [{}, {}, {}, {}, {}, {}] }
];

// Friendly group labels for the palette, keyed by Qlik's own
// qData.visualization type name - anything not listed falls back to "Other".
const SELF_SERVICE_VIZ_GROUPS = {
    barchart: 'Bar Charts',
    linechart: 'Line Charts',
    combochart: 'Combo Charts',
    piechart: 'Pie Charts',
    kpi: 'KPIs',
    table: 'Tables',
    pivot: 'Pivot Tables',
    scatterplot: 'Scatter Plots',
    map: 'Maps',
    gauge: 'Gauges',
    treemap: 'Tree Maps',
    boxplot: 'Box Plots',
    distributionplot: 'Distribution Plots',
    listbox: 'Filters',
    filterpane: 'Filters'
};

// Qlik visualization types with no meaningful Excel/PNG/PDF export - filter
// objects have no "data" of their own to export, and a text/image object is
// just static content. Everything else gets the full toolbar; these two
// get the expand button only (see fillSelfServiceSlot()).
const SELF_SERVICE_NON_EXPORTABLE_VIZ_TYPES = ['listbox', 'filterpane', 'text-image'];

let selfServiceApp = null;
let selfServiceCurrentLayoutId = SELF_SERVICE_LAYOUTS[0].id;
// Id of the saved-layout entry currently loaded, or null if the working
// canvas hasn't been saved yet (a brand new, unnamed layout).
let selfServiceCurrentSavedId = null;
// True the moment anything on the canvas changes (layout picked, chart
// dropped/removed) and false again right after a successful save - drives
// both the beforeunload warning and the Save button's own state.
let selfServiceHasUnsavedChanges = false;

function initSelfService(app) {
    selfServiceApp = app;

    // app.getList('masterobject', ...) can throw an unrelated internal
    // Qlik error ("Uncaught (in promise) TypeError: Cannot read properties
    // of undefined (reading 'getLayout')", from an internal "canCreate"
    // permission check) on some tenant/API versions - the same category of
    // issue as qlik.getThemeList() elsewhere in this mashup. It's harmless
    // noise as far as this call is concerned, but if it also means our own
    // callback never fires, the palette would otherwise be stuck on
    // "Loading master items..." forever - guard with try/catch plus a
    // safety timeout so it always settles into something actionable.
    let masterItemsSettled = false;
    try {
        app.getList('masterobject', function (reply) {
            masterItemsSettled = true;
            const allItems = (reply && reply.qAppObjectList && reply.qAppObjectList.qItems) || [];
            // Self Service should only offer master items an author has
            // explicitly opted in for, via a "selfservice" tag in the Qlik
            // app - otherwise every master item in the app (including ones
            // meant only for specific sheets) shows up in the palette.
            const items = allItems.filter(function (item) {
                const tags = (item.qMeta && item.qMeta.tags) || [];
                return tags.some(function (tag) {
                    return typeof tag === 'string' && tag.toLowerCase() === 'selfservice';
                });
            });
            renderSelfServicePalette(items);
        });
    } catch (err) {
        console.warn('app.getList("masterobject") threw:', err);
        masterItemsSettled = true;
        renderSelfServicePalette([]);
    }

    setTimeout(function () {
        if (!masterItemsSettled) {
            console.warn('app.getList("masterobject") did not resolve within 6s.');
            renderSelfServicePalette([]);
        }
    }, 6000);

    // Starts blank every visit (no autosave/auto-restore) - explicit
    // "My layouts" gallery is how a previous layout gets back onto the
    // canvas.
    renderSelfServiceLayoutPicker(selfServiceCurrentLayoutId);
    updateSelfServiceLayoutLabel(selfServiceCurrentLayoutId);
    buildSelfServiceCanvas(app, selfServiceCurrentLayoutId, null);
    markSelfServiceSaved();

    renderSidebarMyLayouts();
    const sidebarMyLayoutsList = document.getElementById('sidebarMyLayoutsList');
    if (sidebarMyLayoutsList) {
        sidebarMyLayoutsList.addEventListener('click', function (e) {
            const link = e.target.closest('[data-load-id]');
            if (!link) {
                return;
            }
            e.preventDefault();
            // Switches to the Self Service tab via a real click on its own
            // nav-link, rather than calling the Bootstrap Tab API
            // directly, so setActiveTab()'s side effects (active pill
            // styling on the other top-level nav items) and the global
            // shown.bs.tab -> qlik.resize() listener both still fire
            // exactly as they do for a normal tab click.
            const selfServiceTabLink = document.querySelector('a.nav-link[href="#selfservice"]');
            if (selfServiceTabLink) {
                selfServiceTabLink.click();
            }
            loadSelfServiceSavedLayout(link.dataset.loadId);
        });
    }

    const picker = document.getElementById('selfServiceLayoutPicker');
    if (picker) {
        picker.addEventListener('click', function (e) {
            const card = e.target.closest('.self-service-layout-card');
            if (!card) {
                return;
            }
            const layoutId = card.dataset.layoutId;
            renderSelfServiceLayoutPicker(layoutId);
            updateSelfServiceLayoutLabel(layoutId);
            buildSelfServiceCanvas(app, layoutId, null);
            selfServiceCurrentSavedId = null;
            markSelfServiceUnsaved();

            // Popup layout picker (see feedback: keeping this out of the
            // canvas leaves more room to drag and drop) - close it once a
            // layout has been chosen.
            const modalEl = document.getElementById('selfServiceLayoutModal');
            if (modalEl && window.bootstrap && window.bootstrap.Modal) {
                const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
                modal.hide();
            }
        });
    }

    const clearBtn = document.getElementById('selfServiceClearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function () {
            buildSelfServiceCanvas(app, selfServiceCurrentLayoutId, null);
            selfServiceCurrentSavedId = null;
            markSelfServiceUnsaved();
        });
    }

    const saveBtn = document.getElementById('selfServiceSaveBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', openSelfServiceSaveModal);
    }

    const saveConfirmBtn = document.getElementById('selfServiceSaveConfirmBtn');
    if (saveConfirmBtn) {
        saveConfirmBtn.addEventListener('click', confirmSelfServiceSave);
    }

    const saveNameInput = document.getElementById('selfServiceSaveNameInput');
    if (saveNameInput) {
        saveNameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmSelfServiceSave();
            }
        });
        saveNameInput.addEventListener('input', function () {
            saveNameInput.classList.remove('is-invalid');
        });
    }

    const savedLayoutsModalEl = document.getElementById('selfServiceSavedLayoutsModal');
    if (savedLayoutsModalEl) {
        savedLayoutsModalEl.addEventListener('show.bs.modal', renderSelfServiceSavedLayoutsGallery);
        savedLayoutsModalEl.addEventListener('click', function (e) {
            const loadBtn = e.target.closest('[data-load-id]');
            const deleteBtn = e.target.closest('[data-delete-id]');
            if (loadBtn) {
                loadSelfServiceSavedLayout(loadBtn.dataset.loadId);
                const modal = window.bootstrap.Modal.getOrCreateInstance(savedLayoutsModalEl);
                modal.hide();
            } else if (deleteBtn) {
                deleteSelfServiceSavedLayout(deleteBtn.dataset.deleteId);
            }
        });
    }

    const searchInput = document.getElementById('selfServicePaletteSearch');
    if (searchInput) {
        searchInput.addEventListener('input', function () {
            filterSelfServicePalette(searchInput.value);
        });
    }

    // Backstops anyone who built something and closed/navigated away
    // without saving - native browser confirmation, can't be styled, but
    // this is the only mechanism browsers allow for it.
    window.addEventListener('beforeunload', function (e) {
        if (selfServiceHasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

function markSelfServiceUnsaved() {
    selfServiceHasUnsavedChanges = true;
    const saveBtn = document.getElementById('selfServiceSaveBtn');
    if (saveBtn) {
        saveBtn.classList.add('self-service-save-pending');
    }
}

function markSelfServiceSaved() {
    selfServiceHasUnsavedChanges = false;
    const saveBtn = document.getElementById('selfServiceSaveBtn');
    if (saveBtn) {
        saveBtn.classList.remove('self-service-save-pending');
    }
}

function updateSelfServiceLayoutLabel(layoutId) {
    const labelEl = document.getElementById('selfServiceCurrentLayoutLabel');
    if (!labelEl) {
        return;
    }
    const layout = SELF_SERVICE_LAYOUTS.find(function (l) { return l.id === layoutId; });
    labelEl.textContent = layout ? layout.label : 'Choose layout';
}

function ssEscapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function ssIconForVisualization(vizType) {
    const iconMap = {
        barchart: 'bar_chart',
        linechart: 'show_chart',
        combochart: 'stacked_line_chart',
        piechart: 'pie_chart',
        kpi: 'speed',
        table: 'table_chart',
        pivot: 'grid_on',
        scatterplot: 'scatter_plot',
        map: 'map',
        gauge: 'speed',
        treemap: 'account_tree',
        boxplot: 'candlestick_chart',
        distributionplot: 'ssid_chart',
        listbox: 'filter_alt',
        filterpane: 'filter_alt'
    };
    // "insights" (a little trend-line glyph) read as its own chart type
    // rather than a generic fallback for anything unrecognised - widgets
    // doesn't look like any specific chart.
    return iconMap[vizType] || 'widgets';
}

function ssGroupLabel(vizType) {
    return SELF_SERVICE_VIZ_GROUPS[vizType] || 'Other';
}

// Groups master items by chart type (Bar Charts, KPIs, Tables, ...) so a
// large library is easier to scan than one flat list, and tags each item
// with a lowercase data-search attribute for filterSelfServicePalette().
function renderSelfServicePalette(items) {
    const container = document.getElementById('selfServicePalette');
    if (!container) {
        return;
    }

    if (!items.length) {
        container.innerHTML = '<p class="qlik-filter-empty mb-0">No master visualizations found in this app.</p>';
        return;
    }

    const groups = {};
    items.forEach(function (item) {
        const vizType = (item.qData && item.qData.visualization) || '';
        const label = ssGroupLabel(vizType);
        groups[label] = groups[label] || [];
        groups[label].push(item);
    });

    const groupLabels = Object.keys(groups).sort();

    container.innerHTML = groupLabels.map(function (label) {
        const itemsHtml = groups[label].map(function (item) {
            const qId = item.qInfo && item.qInfo.qId;
            const title = ssEscapeHtml((item.qMeta && item.qMeta.title) || (item.qData && item.qData.title) || 'Untitled');
            const vizType = (item.qData && item.qData.visualization) || '';
            const icon = ssIconForVisualization(vizType);
            return `<div class="self-service-palette-item" draggable="true" data-qid="${ssEscapeHtml(qId)}" data-title="${title}" data-viz-type="${ssEscapeHtml(vizType)}" data-search="${title.toLowerCase()}">
                ${iconSvg(icon)}
                <span>${title}</span>
            </div>`;
        }).join('');

        return `<div class="self-service-palette-group">
            <p class="self-service-palette-group-label">${ssEscapeHtml(label)}</p>
            ${itemsHtml}
        </div>`;
    }).join('');

    container.querySelectorAll('.self-service-palette-item').forEach(function (el) {
        el.addEventListener('dragstart', function (e) {
            e.dataTransfer.setData('application/json', JSON.stringify({
                qId: el.dataset.qid,
                title: el.dataset.title,
                vizType: el.dataset.vizType
            }));
            e.dataTransfer.effectAllowed = 'copy';
        });
    });
}

// Filters palette items by title as the user types, hiding whole groups
// that end up with no visible items.
function filterSelfServicePalette(term) {
    const container = document.getElementById('selfServicePalette');
    if (!container) {
        return;
    }
    const normalized = term.trim().toLowerCase();

    container.querySelectorAll('.self-service-palette-group').forEach(function (group) {
        let visibleCount = 0;
        group.querySelectorAll('.self-service-palette-item').forEach(function (item) {
            const matches = !normalized || (item.dataset.search || '').indexOf(normalized) !== -1;
            item.style.display = matches ? '' : 'none';
            if (matches) {
                visibleCount++;
            }
        });
        group.style.display = visibleCount ? '' : 'none';
    });
}

// Mini CSS-grid previews, built from the same columns/rows/cells data as
// the real canvas (just scaled down), so each layout option is
// recognisable at a glance, similar to Qlik's own "choose a template"
// picker. Optionally takes a slots map so the saved-layouts gallery can
// show which slots actually have a chart in them (filled vs empty) rather
// than a generic template preview.
function ssLayoutPreviewHtml(layoutId, slotsState) {
    const layout = SELF_SERVICE_LAYOUTS.find(function (l) { return l.id === layoutId; });
    if (!layout) {
        return '<div class="self-service-layout-preview"></div>';
    }
    const spans = layout.cells.map(function (cell, i) {
        const filled = slotsState && slotsState[i] && slotsState[i].qId;
        const placement = (cell.col ? `grid-column:${cell.col};` : '') + (cell.row ? `grid-row:${cell.row};` : '');
        return `<span class="${filled ? 'is-filled' : ''}" style="${placement}"></span>`;
    }).join('');
    return `<div class="self-service-layout-preview" style="grid-template-columns:repeat(${layout.columns},1fr);grid-template-rows:repeat(${layout.rows},1fr);">${spans}</div>`;
}

function renderSelfServiceLayoutPicker(activeLayoutId) {
    const container = document.getElementById('selfServiceLayoutPicker');
    if (!container) {
        return;
    }

    container.innerHTML = SELF_SERVICE_LAYOUTS.map(function (layout) {
        const activeClass = layout.id === activeLayoutId ? ' active' : '';
        return `<button type="button" class="self-service-layout-card${activeClass}" data-layout-id="${layout.id}">
            ${ssLayoutPreviewHtml(layout.id)}
            <p class="self-service-layout-card-label">${ssEscapeHtml(layout.label)}</p>
        </button>`;
    }).join('');
}

function buildSelfServiceCanvas(app, layoutId, slotsState) {
    selfServiceCurrentLayoutId = layoutId;
    const layout = SELF_SERVICE_LAYOUTS.find(function (l) { return l.id === layoutId; }) || SELF_SERVICE_LAYOUTS[0];
    const canvas = document.getElementById('selfServiceCanvas');
    if (!canvas) {
        return;
    }

    canvas.className = 'self-service-canvas';
    canvas.style.gridTemplateColumns = 'repeat(' + layout.columns + ', 1fr)';
    canvas.style.gridTemplateRows = 'repeat(' + layout.rows + ', 1fr)';
    canvas.innerHTML = '';

    layout.cells.forEach(function (cell, i) {
        const slot = document.createElement('div');
        slot.className = 'self-service-slot';
        slot.dataset.slotIndex = String(i);
        if (cell.col) {
            slot.style.gridColumn = cell.col;
        }
        if (cell.row) {
            slot.style.gridRow = cell.row;
        }
        slot.innerHTML = `
            <div class="self-service-slot-header">
                <span class="self-service-slot-title">Drop a chart here</span>
                <button type="button" class="self-service-slot-remove" style="display:none;" title="Remove">
                    ${iconSvg('close')}
                </button>
            </div>
            <div class="self-service-slot-body" id="SELF-SERVICE-SLOT-${i}">
                <div class="self-service-slot-placeholder">
                    ${iconSvg('add_chart')}
                    <span>Drag a chart from the library</span>
                </div>
            </div>
        `;
        canvas.appendChild(slot);

        slot.addEventListener('dragover', function (e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            slot.classList.add('self-service-slot-dragover');
        });
        slot.addEventListener('dragleave', function () {
            slot.classList.remove('self-service-slot-dragover');
        });
        slot.addEventListener('drop', function (e) {
            e.preventDefault();
            slot.classList.remove('self-service-slot-dragover');
            let data;
            try {
                data = JSON.parse(e.dataTransfer.getData('application/json'));
            } catch (err) {
                return;
            }
            if (data && data.qId) {
                fillSelfServiceSlot(app, i, data.qId, data.title, data.vizType);
                markSelfServiceUnsaved();
            }
        });

        slot.querySelector('.self-service-slot-remove').addEventListener('click', function () {
            clearSelfServiceSlot(i);
            markSelfServiceUnsaved();
        });

        // Cards are user-resizable (CSS `resize: both`, see custom.css) -
        // Qlik sizes a chart's internal SVG/canvas off its container's
        // dimensions at render time and won't redraw on its own when the
        // user drags the resize handle, so watch for size changes and
        // nudge Qlik to redraw. Debounced since resize fires continuously
        // while dragging.
        if (typeof ResizeObserver === 'function') {
            let resizeTimer = null;
            const observer = new ResizeObserver(function () {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(function () {
                    if (window.qlik && typeof window.qlik.resize === 'function') {
                        window.qlik.resize();
                    }
                }, 150);
            });
            observer.observe(slot);
        }
    });

    // Used when loading a saved layout from the gallery - re-renders each
    // of its filled slots onto the freshly-built canvas.
    if (slotsState) {
        Object.keys(slotsState).forEach(function (key) {
            const entry = slotsState[key];
            if (entry && entry.qId) {
                fillSelfServiceSlot(app, Number(key), entry.qId, entry.title, entry.vizType);
            }
        });
    }
}

function fillSelfServiceSlot(app, slotIndex, qId, title, vizType) {
    const slot = document.querySelector('.self-service-slot[data-slot-index="' + slotIndex + '"]');
    if (!slot) {
        return;
    }
    const body = slot.querySelector('.self-service-slot-body');
    const titleEl = slot.querySelector('.self-service-slot-title');
    const removeBtn = slot.querySelector('.self-service-slot-remove');

    // Clear any previously rendered content/toolbar in this slot before
    // re-rendering - a slot can be refilled with a different chart at any
    // time (drag a new item onto an already-filled slot).
    body.innerHTML = '';
    if (titleEl) {
        titleEl.textContent = title || 'Chart';
    }
    if (removeBtn) {
        removeBtn.style.display = '';
    }

    app.getObject(body.id, qId).then(function () {
        // Same expand/collapse + export (Excel/PNG/PDF) toolbar as the
        // Analysis 2 charts/Dashboard Chart 5/Report table for anything
        // exportable - filters (listbox/filterpane) and text/image objects
        // have no real "data" to export, so those only get the expand
        // button (see SELF_SERVICE_NON_EXPORTABLE_VIZ_TYPES above).
        const exportable = !SELF_SERVICE_NON_EXPORTABLE_VIZ_TYPES.includes(vizType);
        if (typeof attachChartToolbar === 'function') {
            attachChartToolbar(app, { elementId: body.id, objectId: qId, exportable: exportable });
        }
        if (window.qlik && typeof window.qlik.resize === 'function') {
            window.qlik.resize();
        }
    }).catch(function (err) {
        console.warn('Self service: failed to render master item ' + qId, err);
        body.innerHTML = '<div class="self-service-slot-placeholder">' + iconSvg('error_outline') + '<span>Could not load this chart</span></div>';
    });

    slot.dataset.qid = qId;
    slot.dataset.title = title || '';
    slot.dataset.vizType = vizType || '';
}

function clearSelfServiceSlot(slotIndex) {
    const slot = document.querySelector('.self-service-slot[data-slot-index="' + slotIndex + '"]');
    if (!slot) {
        return;
    }
    const body = slot.querySelector('.self-service-slot-body');
    const titleEl = slot.querySelector('.self-service-slot-title');
    const removeBtn = slot.querySelector('.self-service-slot-remove');

    body.innerHTML = '<div class="self-service-slot-placeholder">' + iconSvg('add_chart') + '<span>Drag a chart from the library</span></div>';
    if (titleEl) {
        titleEl.textContent = 'Drop a chart here';
    }
    if (removeBtn) {
        removeBtn.style.display = 'none';
    }

    delete slot.dataset.qid;
    delete slot.dataset.title;
    delete slot.dataset.vizType;
}

// Reads the CURRENT canvas DOM (not localStorage) into the {slotIndex:
// {qId, title}} shape saved layouts are stored in - the source of truth
// for "what's on the canvas right now" is the slot elements themselves,
// since there's no longer a parallel auto-saved copy to fall out of sync
// with.
function captureSelfServiceCanvasState() {
    const slots = {};
    document.querySelectorAll('#selfServiceCanvas .self-service-slot').forEach(function (slot) {
        if (slot.dataset.qid) {
            slots[slot.dataset.slotIndex] = { qId: slot.dataset.qid, title: slot.dataset.title || '', vizType: slot.dataset.vizType || '' };
        }
    });
    return slots;
}

function loadSelfServiceSavedLayouts() {
    try {
        const raw = window.localStorage.getItem(SELF_SERVICE_SAVED_LAYOUTS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (err) {
        return [];
    }
}

function persistSelfServiceSavedLayouts(layouts) {
    try {
        window.localStorage.setItem(SELF_SERVICE_SAVED_LAYOUTS_KEY, JSON.stringify(layouts));
    } catch (err) {
        // Ignore write failures (private browsing, storage full, etc.).
    }
}

function openSelfServiceSaveModal() {
    const modalEl = document.getElementById('selfServiceSaveModal');
    const nameInput = document.getElementById('selfServiceSaveNameInput');
    if (!modalEl || !nameInput) {
        return;
    }

    if (selfServiceCurrentSavedId) {
        const existing = loadSelfServiceSavedLayouts().find(function (l) { return l.id === selfServiceCurrentSavedId; });
        nameInput.value = existing ? existing.name : '';
    } else {
        nameInput.value = '';
    }
    nameInput.classList.remove('is-invalid');

    if (window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
        setTimeout(function () { nameInput.focus(); }, 300);
    }
}

function confirmSelfServiceSave() {
    const nameInput = document.getElementById('selfServiceSaveNameInput');
    const name = nameInput && nameInput.value.trim();
    if (!name) {
        if (nameInput) {
            nameInput.classList.add('is-invalid');
        }
        return;
    }

    const layouts = loadSelfServiceSavedLayouts();
    const slots = captureSelfServiceCanvasState();

    if (selfServiceCurrentSavedId) {
        const existing = layouts.find(function (l) { return l.id === selfServiceCurrentSavedId; });
        if (existing) {
            existing.name = name;
            existing.layoutId = selfServiceCurrentLayoutId;
            existing.slots = slots;
        }
    } else {
        selfServiceCurrentSavedId = 'ss-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        layouts.push({
            id: selfServiceCurrentSavedId,
            name: name,
            layoutId: selfServiceCurrentLayoutId,
            slots: slots
        });
    }

    persistSelfServiceSavedLayouts(layouts);
    markSelfServiceSaved();
    renderSidebarMyLayouts();

    const modalEl = document.getElementById('selfServiceSaveModal');
    if (modalEl && window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }

    const saveBtn = document.getElementById('selfServiceSaveBtn');
    if (saveBtn) {
        showSelfServiceSaveConfirmation(saveBtn);
    }
}

// Quick-access list in the left sidebar (My Layouts dropdown, see
// index.html) - same saved-layouts data as the "My layouts" gallery
// modal, just a faster way to jump straight to one without opening a
// modal first. Kept in sync by calling this after every save/delete.
function renderSidebarMyLayouts() {
    const list = document.getElementById('sidebarMyLayoutsList');
    if (!list) {
        return;
    }

    const layouts = loadSelfServiceSavedLayouts();
    if (!layouts.length) {
        list.innerHTML = `
            <li class="nav-item">
                <a class="nav-link text-white disabled" href="javascript:;">
                    <span class="nav-link-text">No saved layouts yet</span>
                </a>
            </li>
        `;
        return;
    }

    list.innerHTML = layouts.map(function (layout) {
        return `
            <li class="nav-item">
                <a class="nav-link text-white" href="javascript:;" data-load-id="${ssEscapeHtml(layout.id)}">
                    <span class="nav-link-text">${ssEscapeHtml(layout.name)}</span>
                </a>
            </li>
        `;
    }).join('');
}

function renderSelfServiceSavedLayoutsGallery() {
    const container = document.getElementById('selfServiceSavedLayoutsGallery');
    if (!container) {
        return;
    }

    const layouts = loadSelfServiceSavedLayouts();
    if (!layouts.length) {
        container.innerHTML = '<p class="qlik-filter-empty mb-0">No saved layouts yet - build one on the canvas and click "Save layout".</p>';
        return;
    }

    container.innerHTML = layouts.map(function (layout) {
        const slotCount = Object.keys(layout.slots || {}).length;
        return `<div class="self-service-saved-card">
            ${ssLayoutPreviewHtml(layout.layoutId, layout.slots)}
            <p class="self-service-saved-card-name">${ssEscapeHtml(layout.name)}</p>
            <p class="self-service-saved-card-meta">${slotCount} chart${slotCount === 1 ? '' : 's'}</p>
            <div class="self-service-saved-card-actions">
                <button type="button" class="btn btn-sm btn-primary" data-load-id="${ssEscapeHtml(layout.id)}">Load</button>
                <button type="button" class="self-service-saved-card-delete" data-delete-id="${ssEscapeHtml(layout.id)}" title="Delete">
                    ${iconSvg('delete_outline')}
                </button>
            </div>
        </div>`;
    }).join('');
}

function loadSelfServiceSavedLayout(id) {
    const layout = loadSelfServiceSavedLayouts().find(function (l) { return l.id === id; });
    if (!layout || !selfServiceApp) {
        return;
    }

    selfServiceCurrentSavedId = layout.id;
    renderSelfServiceLayoutPicker(layout.layoutId);
    updateSelfServiceLayoutLabel(layout.layoutId);
    buildSelfServiceCanvas(selfServiceApp, layout.layoutId, layout.slots);
    markSelfServiceSaved();
}

function deleteSelfServiceSavedLayout(id) {
    const layouts = loadSelfServiceSavedLayouts().filter(function (l) { return l.id !== id; });
    persistSelfServiceSavedLayouts(layouts);
    if (selfServiceCurrentSavedId === id) {
        selfServiceCurrentSavedId = null;
    }
    renderSelfServiceSavedLayoutsGallery();
    renderSidebarMyLayouts();
}

// Briefly swaps the Save button's label/icon for a checkmark so clicking
// it gives visible, unambiguous confirmation that the layout is saved.
function showSelfServiceSaveConfirmation(btn) {
    const original = btn.innerHTML;
    btn.innerHTML = iconSvg('check', 'align-middle', 'font-size: 1rem;') + '<span>Saved</span>';
    btn.disabled = true;
    setTimeout(function () {
        btn.innerHTML = original;
        btn.disabled = false;
    }, 1500);
}
