/*
  Reusable responsive table renderer for Qlik hypercube data.

  Call it from inside any app.createCube(cubeDef, callback) reply -
  dimensions render as left-aligned text columns, measures as
  right-aligned numeric columns, in the same order as the cube definition.
  A dimension whose title contains "img", "image" or "photo" (case
  insensitive - e.g. "EmployeeImg") renders as a circular avatar image
  instead of raw text/URL. Measures are reformatted from qNum with
  thousands separators (a "money-ish" title - sales/cost/margin/revenue/
  price/amount - adds a £ prefix); negative values render in red. This
  overrides whatever raw qText the expression produced, so it looks
  consistent even when the underlying measure has no number format set
  in the Qlik app itself.

    app.createCube({
        qDimensions: [{ qDef: { qFieldDefs: ["ProductCategoryName"] } }],
        qMeasures: [{ qDef: { qDef: "Sum(Sales)" } }],
        qInitialDataFetch: [{ qHeight: 100, qWidth: 2 }]
    }, function (reply) {
        renderHypercubeTable("MY-TABLE-CONTAINER-ID", reply, app);
    });

  Works with either a raw getObject reply (reply.qHyperCube) or a layout
  object (reply.layout.qHyperCube) - whichever shape is passed in.

  Pass `app` (optional, 3rd argument) to make whole rows clickable -
  clicking one selects that row's value in EVERY dimension column at once
  (matching how a native Qlik straight table row-click behaves), via
  app.field(fieldName).selectValues([{qText}], true, false) - the same
  selection method already used successfully elsewhere in this mashup
  (selections.js), rather than the lower-level
  app.selectHyperCubeValues()/qElemNumber API, which isn't a function on
  this tenant's Capability API version. The real field name for each
  dimension comes from qDimensionInfo[i].qGroupFieldDefs[0] rather than
  qFallbackTitle, since the latter reflects a custom qFieldLabels override
  (e.g. "Photo" for the EmployeeImg field) rather than the actual field
  name app.field() needs. A row counts as selected only once every one of
  its dimension cells is qState 'S' (partial matches don't light up), and
  excluded if any cell is 'X'.
*/
function renderHypercubeTable(containerId, reply, app) {
    const hc = (reply && reply.qHyperCube) || (reply && reply.layout && reply.layout.qHyperCube);
    const $container = $('#' + containerId);

    if (!$container.length) {
        console.warn('renderHypercubeTable: container #' + containerId + ' not found');
        return;
    }

    if (!hc) {
        console.warn('renderHypercubeTable: no qHyperCube found on the reply passed for #' + containerId);
        return;
    }

    const dimInfo = hc.qDimensionInfo || [];
    const measureInfo = hc.qMeasureInfo || [];
    const dimCount = dimInfo.length;
    const rows = (hc.qDataPages && hc.qDataPages[0] && hc.qDataPages[0].qMatrix) || [];
    const columns = dimInfo.concat(measureInfo);
    const imageColumns = columns.map(col => /img|image|photo/i.test(col.qFallbackTitle || ''));
    const currencyColumns = columns.map(col => /sales|cost|margin|revenue|price|amount/i.test(col.qFallbackTitle || ''));

    const escapeHtml = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const numberFormatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
    const decimalFormatter = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const formatMeasure = (cell, isCurrency) => {
        const num = typeof cell.qNum === 'number' && isFinite(cell.qNum) ? cell.qNum : parseFloat(cell.qText);
        if (isNaN(num)) {
            return escapeHtml(cell.qText);
        }
        const formatted = (Math.abs(num) < 1000 ? decimalFormatter : numberFormatter).format(Math.abs(num));
        const prefix = isCurrency ? '£' : '';
        const text = `${num < 0 ? '-' : ''}${prefix}${formatted}`;
        return num < 0 ? `<span class="qlik-table-negative">${text}</span>` : text;
    };

    const headerCells = columns.map((col, i) =>
        `<th class="${i >= dimCount ? 'text-end' : ''}">${escapeHtml(col.qFallbackTitle)}</th>`
    ).join('');

    const renderCell = (cell, i) => {
        if (imageColumns[i]) {
            return cell.qText
                ? `<img class="qlik-table-avatar" src="${escapeHtml(cell.qText)}" alt="" onerror="this.style.visibility='hidden'">`
                : '';
        }
        if (i >= dimCount) {
            return formatMeasure(cell, currencyColumns[i]);
        }
        return escapeHtml(cell.qText);
    };

    const isSelectable = typeof app === 'object' && app && typeof app.field === 'function' && dimCount > 0;
    if (app && !isSelectable) {
        console.warn('renderHypercubeTable: app.field is not a function (or there are no dimensions) - table for #' + containerId + ' will render read-only.');
    }

    // qFallbackTitle reflects a custom qFieldLabels override (e.g. "Photo"
    // for the EmployeeImg field) - qGroupFieldDefs[0] is the real
    // underlying field name app.field() needs.
    const dimFieldNames = dimInfo.map(col => (col.qGroupFieldDefs && col.qGroupFieldDefs[0]) || col.qFallbackTitle);

    const cellClass = (i) => {
        const classes = [];
        if (i >= dimCount) {
            classes.push('text-end');
        }
        if (imageColumns[i]) {
            classes.push('qlik-table-avatar-cell');
        }
        return classes.join(' ');
    };

    const rowClass = (row) => {
        if (!isSelectable) {
            return '';
        }
        const dimCells = row.slice(0, dimCount);
        if (dimCells.some(cell => cell.qState === 'X')) {
            return 'qlik-table-row-selectable is-excluded';
        }
        if (dimCells.every(cell => cell.qState === 'S')) {
            return 'qlik-table-row-selectable is-selected';
        }
        return 'qlik-table-row-selectable';
    };

    const bodyRows = rows.length
        ? rows.map((row, rowIndex) =>
            `<tr class="${rowClass(row)}"${isSelectable ? ` data-row-index="${rowIndex}"` : ''}>${row.map((cell, i) =>
                `<td class="${cellClass(i)}">${renderCell(cell, i)}</td>`
            ).join('')}</tr>`
        ).join('')
        : `<tr><td class="qlik-table-empty" colspan="${columns.length}">No data for the current selection</td></tr>`;

    $container.html(`
        <div class="qlik-table-wrapper">
            <table class="qlik-table">
                <thead><tr>${headerCells}</tr></thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </div>
    `);

    if (isSelectable) {
        $container.find('.qlik-table-row-selectable').on('click', function () {
            const rowIndex = Number(this.getAttribute('data-row-index'));
            const row = rows[rowIndex];
            for (let i = 0; i < dimCount; i++) {
                const fieldName = dimFieldNames[i];
                const cellText = row[i].qText;
                if (fieldName && cellText) {
                    app.field(fieldName).selectValues([{ qText: cellText }], true, false);
                }
            }
        });
    }
}
