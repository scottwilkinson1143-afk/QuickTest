// Renders an interactive bar chart from a Qlik hypercube reply using
// picasso.js (https://github.com/qlik-oss/picasso.js, loaded via CDN in
// index.html) - a general-purpose charting library with no built-in Qlik
// awareness, used here to demo plugging an external charting library into
// the mashup instead of a native Qlik object. Each bar carries a small
// circular photo marker of that salesperson at its end (built from the
// EmployeeImg attribute expression), giving it the same "infographic
// pictogram" look as a Power BI picture bar chart, without the messy
// stretched/cropped look of filling the whole bar with the photo (that
// was tried first and looked worse, not better).
//
// Deliberately horizontal (one row per person, bars extending rightward),
// not vertical - this chart sits directly beside the "Sales by
// Salesperson" table (same sort order, same rows), and a horizontal
// layout lets every row line up with its matching table row and reads
// top-to-bottom like the table instead of needing rotated x-axis labels
// for names this long.
//
// Deliberately fed the SAME reply as the "Sales by Salesperson" table
// next to it (renderHypercubeTable), rather than a separate createCube -
// two independently-sorted cubes for what's meant to be "the same data,
// two views" drifted out of sync in practice (same people, different row
// order), which is exactly what made the table and chart look
// misaligned. Sharing one reply makes that impossible: same rows, same
// order, every time, for both.
//
// Works off any hypercube reply that has a photo-ish dimension (its
// qFallbackTitle/label matching /img|image|photo/i, same detection
// hypercubeTable.js uses) and a "sales"-ish measure - both optional; with
// neither, it just draws plain bars with no photo markers off the first
// dimension/measure it finds. Call it from inside an
// app.createCube(cubeDef, callback) reply:
//
//   app.createCube({
//       qDimensions: [
//           { qDef: { qFieldDefs: ["EmployeeImg"], qFieldLabels: ["Photo"] } },
//           { qDef: { qFieldDefs: ["SalesPerson"] } }
//       ],
//       qMeasures: [{ qDef: { qDef: "Sum(SalesAmount)", qLabel: "Sales" } }],
//       qInitialDataFetch: [{ qHeight: 100, qWidth: 3 }],
//       qStateName: "$"
//   }, function (reply) {
//       renderHypercubeTable("MY-TABLE-CONTAINER-ID", reply, app);
//       renderPicassoBarChart("MY-CHART-CONTAINER-ID", reply, app);
//   });
//
// createCube's callback re-fires on every selection change (same as
// getObject), so this just re-draws with the new qState per bar each time -
// no separate selection listener needed. Clicking a bar selects that
// dimension value via app.field().selectValues(), the same mechanism
// hypercubeTable.js uses for row clicks, so it behaves exactly like a
// native Qlik selection and propagates to every other chart/table/filter
// on the page.

// One entry per container: the live picasso chart instance plus the photo
// list used to position its markers - resizePicassoCharts() needs both.
const picassoChartInstances = {};

// Shortens "Ranjit Varkey Chudukatil" to "Ranjit V." for the x-axis tick
// text only - a separate, purely cosmetic label accessor on the
// "category" SCALE's own data extraction. It's independent of the "bars"
// component's own extraction, which is what the click handler reads from
// (via hit.data.label) to drive the actual Qlik selection - that one
// keeps extracting the full name, so a shortened axis label never breaks
// selecting the right person.
function shortenPersonName(full) {
    const parts = String(full).trim().split(/\s+/);
    return parts.length < 2 ? full : parts[0] + ' ' + parts[parts.length - 1].charAt(0) + '.';
}

// Positions one circular photo marker per bar, straddling the bar's right
// (end) edge, vertically centred on the bar - these bars are horizontal,
// so "the end of the bar" is a right edge, not a top edge. The overlay <div> is a plain
// sibling of whatever picasso renders into `container` - confirmed by
// testing that it (unlike a <defs> block injected *inside* picasso's own
// SVG) survives chart.update() untouched, since picasso only manages the
// children of the root node(s) it created itself. Only the marker
// positions need refreshing on every call, not the overlay element.
//
// Bar rects are found by querying the container for every <rect>, in DOM
// order - which matches the data's row order, since a band scale lays
// out its domain in the order categories were first encountered and
// nothing here re-sorts it. This chart's own component list (grid-line,
// two axes, one box component) draws its gridlines/ticks as <line>
// elements, not <rect>, so every <rect> found this way is one of the
// box component's own bars - deliberately NOT filtered by a minimum
// pixel size, since a person with a much smaller share of sales than
// everyone else renders as a legitimately thin (sub-4px) bar, and a size
// filter would silently drop that one bar from this list - shifting
// every marker after it onto the wrong person's bar. There's no
// dedicated "get me this component's shapes" API used here because
// shapesAt() requires a point to hit-test against, not "give me
// everything" - this container-wide query is simpler and was verified
// against a live chart.
function positionPhotoMarkers(container, photos) {
    let overlay = container.querySelector('.picasso-photo-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'picasso-photo-overlay';
        container.appendChild(overlay);
    }

    const bars = container.querySelectorAll('rect');
    const containerBox = container.getBoundingClientRect();
    overlay.innerHTML = '';

    bars.forEach((bar, i) => {
        const photo = photos[i];
        if (!photo || !photo.url) {
            return;
        }
        const box = bar.getBoundingClientRect();
        const img = document.createElement('img');
        img.className = 'picasso-photo-marker';
        img.src = photo.url;
        img.alt = '';
        img.style.left = (box.right - containerBox.left) + 'px';
        img.style.top = (box.top + box.height / 2 - containerBox.top) + 'px';
        // Same graceful-degradation convention as hypercubeTable.js's
        // avatar images - a broken/missing photo just disappears rather
        // than showing a broken-image icon over the bar.
        img.onerror = function () {
            this.style.visibility = 'hidden';
        };
        overlay.appendChild(img);
    });
}

function renderPicassoBarChart(containerId, reply, app) {
    const hc = (reply && reply.qHyperCube) || (reply && reply.layout && reply.layout.qHyperCube);
    const container = document.getElementById(containerId);

    if (!container) {
        console.warn('renderPicassoBarChart: container #' + containerId + ' not found');
        return;
    }
    if (!hc) {
        console.warn('renderPicassoBarChart: no qHyperCube found on the reply passed for #' + containerId);
        return;
    }
    if (!window.picasso) {
        console.warn('renderPicassoBarChart: picasso.js is not loaded - cannot render #' + containerId);
        return;
    }

    const rows = (hc.qDataPages && hc.qDataPages[0] && hc.qDataPages[0].qMatrix) || [];

    if (!rows.length) {
        if (picassoChartInstances[containerId]) {
            picassoChartInstances[containerId].chart.destroy();
            delete picassoChartInstances[containerId];
        }
        container.innerHTML = '<div class="qlik-table-empty">No data for the current selection</div>';
        return;
    }

    const dimInfo = hc.qDimensionInfo || [];
    const measureInfo = hc.qMeasureInfo || [];
    const dimCount = dimInfo.length;

    // Same photo-column detection hypercubeTable.js uses (qFallbackTitle
    // reflects a qFieldLabels override, e.g. "Photo" for the EmployeeImg
    // field) - whichever OTHER dimension there is becomes the category
    // axis. With only one dimension total, that one is both (no photo).
    const photoDimIndex = dimInfo.findIndex((d) => /img|image|photo/i.test(d.qFallbackTitle || ''));
    const categoryDimIndex = dimCount > 1 ? dimInfo.findIndex((d, i) => i !== photoDimIndex) : 0;
    const categoryDim = dimInfo[categoryDimIndex];

    // qFallbackTitle reflects a custom qFieldLabels override - qGroupFieldDefs[0]
    // is the real underlying field name app.field() needs (same reasoning as
    // hypercubeTable.js).
    const fieldName = (categoryDim.qGroupFieldDefs && categoryDim.qGroupFieldDefs[0]) || categoryDim.qFallbackTitle;

    // First measure whose label/title looks like a sales figure, falling
    // back to whichever measure comes first (e.g. this cube's Margin
    // column is deliberately skipped in favour of Sales).
    const measureIndex = Math.max(0, measureInfo.findIndex((m) => /sales/i.test(m.qFallbackTitle || '')));
    const valueColIndex = dimCount + measureIndex;

    const stateFor = (cell) => cell.qState === 'S' ? 'selected' : (cell.qState === 'X' ? 'excluded' : 'normal');

    const matrix = [['category', 'value', 'state']].concat(
        rows.map((row) => [row[categoryDimIndex].qText, row[valueColIndex].qNum, stateFor(row[categoryDimIndex])])
    );

    // One photo per row, in the same order as the matrix rows above -
    // positionPhotoMarkers() matches these up with rendered bar rects by
    // that shared order.
    const photos = rows.map((row) => ({
        category: row[categoryDimIndex].qText,
        url: photoDimIndex >= 0 ? (row[photoDimIndex].qText || '') : ''
    }));

    // Sized to roughly the table's own row height (avatar + cell padding,
    // see .qlik-table-avatar/.qlik-table tbody td in custom.css) so a row
    // here lines up with the same person's row in the table beside it,
    // and the container never has a lot of dead space below the last bar
    // just because a static CSS height assumed more rows than this
    // selection actually has.
    container.style.height = Math.max(240, rows.length * 54 + 40) + 'px';

    // A "box" component with only start/end set draws a plain rectangle
    // (per picasso.js's own docs), which is how a bar chart is built here -
    // there's no dedicated "bar" component. dock MUST be nested under
    // layout (settings.layout.dock, not a bare settings.dock) - an old
    // picasso.js example that used the bare form was copied here once and
    // it silently rendered nothing, since the axes then claimed no space
    // to lay bars out against.
    const chartDef = {
        element: container,
        data: [{ type: 'matrix', data: matrix }],
        settings: {
            // Named formatter for the value axis - "d3-number"/"~s" gives SI
            // abbreviations (10M, 500k) instead of a raw unformatted sum
            // that would otherwise overflow the axis's reserved width.
            formatters: {
                compact: { type: 'd3-number', format: '~s' }
            },
            scales: {
                value: {
                    data: { field: 'value' },
                    include: [0],
                    // Headroom to the right of the longest bar's tick/photo
                    // marker - without this the marker on the longest bar
                    // sits right at the container's right edge and gets
                    // clipped by its overflow:hidden.
                    expand: 0.15
                },
                color: {
                    data: { field: 'state' },
                    type: 'categorical-color',
                    // explicit (not a plain top-level domain/range) is what
                    // this scale type actually reads for a fixed mapping -
                    // otherwise colours get assigned by whichever state
                    // happens to appear first in the data, not by name.
                    explicit: {
                        domain: ['normal', 'selected', 'excluded'],
                        range: ['#3d6df2', '#e91e63', '#c9ced6'],
                        override: true
                    }
                },
                category: {
                    data: { extract: { field: 'category', label: shortenPersonName } },
                    padding: 0.3
                }
            },
            components: [
                // Subtle vertical gridlines behind the bars (bars are
                // horizontal here, so the gridlines run along the value/x
                // axis) - drawn first so the box component's bars render
                // on top of them.
                {
                    type: 'grid-line',
                    settings: {
                        x: { scale: 'value' },
                        ticks: { stroke: '#eef1f6', strokeWidth: 1 },
                        minorTicks: { show: false }
                    }
                },
                {
                    type: 'axis',
                    layout: { dock: 'bottom' },
                    scale: 'value',
                    formatter: 'compact'
                },
                {
                    type: 'axis',
                    layout: { dock: 'left' },
                    scale: 'category'
                },
                {
                    key: 'bars',
                    type: 'box',
                    data: {
                        extract: {
                            field: 'category',
                            props: {
                                start: 0,
                                end: { field: 'value' },
                                state: { field: 'state' }
                            }
                        }
                    },
                    settings: {
                        major: { scale: 'category' },
                        minor: { scale: 'value' },
                        orientation: 'horizontal',
                        box: {
                            fill: { scale: 'color', ref: 'state' }
                        }
                    }
                }
            ]
        }
    };

    let entry = picassoChartInstances[containerId];
    if (entry) {
        entry.chart.update({ data: chartDef.data, settings: chartDef.settings });
        entry.photos = photos;
        positionPhotoMarkers(container, photos);
        return;
    }

    const chart = picasso.chart(chartDef);
    picassoChartInstances[containerId] = { chart, photos };
    positionPhotoMarkers(container, photos);
    container.style.cursor = 'pointer';

    // A single click listener, bound once - always looks up the current
    // chart instance from picassoChartInstances rather than closing over
    // this render's `chart`, since update() replaces its data/settings but
    // not the object update() was called on.
    container.addEventListener('click', function (e) {
        const activeEntry = picassoChartInstances[containerId];
        if (!activeEntry) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const hits = activeEntry.chart.shapesAt({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            width: 1,
            height: 1
        });
        const hit = hits.length ? hits[0] : null;
        const categoryText = hit && hit.data && hit.data.label;
        if (categoryText && fieldName) {
            app.field(fieldName).selectValues([{ qText: categoryText }], true, false);
        }
    });
}

// Analysis 1's createCube callback (like every createCube/getObject
// callback in this app) fires as soon as the app opens, regardless of
// which tab is actually visible - picasso.chart() then measures its
// container's getBoundingClientRect() as 0x0, since the container sits
// inside a Bootstrap tab-pane that isn't shown yet, and silently lays out
// zero bars. Unlike native Qlik objects (redrawn via qlik.resize() on
// every tab switch, see qliksense.js), a picasso instance needs its own
// re-measure - this re-runs layout against the container's real size once
// it's actually visible, then repositions the photo markers against the
// bars' now-correct positions. Called from qliksense.js's existing
// 'shown.bs.tab' handler, alongside qlik.resize().
function resizePicassoCharts() {
    Object.keys(picassoChartInstances).forEach(function (id) {
        const entry = picassoChartInstances[id];
        if (entry && entry.chart && typeof entry.chart.update === 'function') {
            entry.chart.update();
            const container = document.getElementById(id);
            if (container) {
                positionPhotoMarkers(container, entry.photos);
            }
        }
    });
}
