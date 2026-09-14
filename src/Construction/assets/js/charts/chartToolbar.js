// Adds a small floating toolbar (expand/collapse, and optionally
// Excel/PNG/PDF export) directly on top of a Qlik chart container that was
// rendered via app.getObject(). Works with any native chart type - the
// toolbar is pure DOM/CSS plus Qlik Capability API calls, so it doesn't
// care what kind of visualization is inside.
//
// Usage (call once, right after the object's app.getObject() promise for
// elementId has resolved):
//   attachChartToolbar(app, {
//     elementId: 'ANALYSIS-2-CHART-1',
//     objectId: 'DEpghBm',
//     exportable: true   // omit/false to only show the expand button
//   });
function attachChartToolbar(app, options) {
    const elementId = options.elementId;
    const objectId = options.objectId;
    const exportable = !!options.exportable;
    const host = document.getElementById(elementId);
    if (!host) {
        return;
    }

    // The container being toggled fullscreen is the same element Qlik
    // rendered into, so toggling its size is exactly what Qlik measures
    // on the next resize() call - no separate wrapper needed.
    if (getComputedStyle(host).position === 'static') {
        host.style.position = 'relative';
    }
    host.classList.add('chart-toolbar-host');

    const toolbar = document.createElement('div');
    toolbar.className = 'chart-toolbar';

    const expandBtn = document.createElement('button');
    expandBtn.type = 'button';
    expandBtn.className = 'chart-toolbar-btn';
    expandBtn.title = 'Expand';
    expandBtn.innerHTML = iconSvg('fullscreen');
    expandBtn.addEventListener('click', function () {
        toggleChartFullscreen(host, expandBtn);
    });
    toolbar.appendChild(expandBtn);

    if (exportable && objectId) {
        toolbar.appendChild(buildExportButton(app, objectId, 'grid_on', 'Export to Excel', function (viz) {
            return viz.exportData({ format: 'OOXML' });
        }));
        toolbar.appendChild(buildExportButton(app, objectId, 'image', 'Export to PNG', function (viz) {
            return viz.exportImg({ width: 1200, height: 800, format: 'png' });
        }));
        toolbar.appendChild(buildExportButton(app, objectId, 'picture_as_pdf', 'Export to PDF', function (viz) {
            return exportVizAsPdf(viz);
        }));
    }

    host.appendChild(toolbar);
}

function toggleChartFullscreen(host, expandBtn) {
    const isFullscreen = host.classList.toggle('chart-toolbar-fullscreen');
    const icon = expandBtn.querySelector('.mu-icon');
    if (icon) {
        setIconName(icon, isFullscreen ? 'fullscreen_exit' : 'fullscreen');
    }
    expandBtn.title = isFullscreen ? 'Collapse' : 'Expand';

    // Qlik sizes a chart's internal SVG/canvas off its container's
    // dimensions at render time and won't redraw on its own just because
    // a CSS class changed that container's size - this nudges it to
    // redraw at the new (fullscreen or restored) size. Deferred slightly
    // so the browser has applied the new layout before Qlik measures it.
    if (window.qlik && typeof window.qlik.resize === 'function') {
        setTimeout(function () {
            window.qlik.resize();
        }, 50);
    }
}

function buildExportButton(app, objectId, iconName, title, exportFn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chart-toolbar-btn';
    btn.title = title;
    btn.innerHTML = iconSvg(iconName);
    btn.addEventListener('click', function () {
        if (!app.visualization || typeof app.visualization.get !== 'function') {
            console.warn('app.visualization.get() is not available on this Capability API version - cannot export this chart.');
            return;
        }
        app.visualization.get(objectId).then(function (viz) {
            return exportFn(viz);
        }).then(function (link) {
            if (link) {
                window.open(link, '_blank');
            }
        }).catch(function (err) {
            console.warn(title + ' failed:', err);
        });
    });
    return btn;
}

// Qlik's Capability API has no direct single-visualization PDF export -
// this builds one client-side from the chart's own exported PNG using
// jsPDF (loaded via CDN, see index.html), sized to exactly fit the image.
function exportVizAsPdf(viz) {
    return viz.exportImg({ width: 1600, height: 1000, format: 'png' }).then(function (imgLink) {
        return new Promise(function (resolve, reject) {
            const img = new Image();
            // exportImg()'s link is a session-authenticated Qlik Cloud URL -
            // crossOrigin: 'anonymous' strips cookies from the request, so
            // the (still cross-origin, from the browser's point of view)
            // fetch came back unauthenticated and the image never loaded at
            // all ("Failed to load exported chart image" from onerror
            // below, not a canvas-taint error at PDF-build time).
            // 'use-credentials' sends the session cookie along with it.
            img.crossOrigin = 'use-credentials';
            img.onload = function () {
                try {
                    const { jsPDF } = window.jspdf;
                    const orientation = img.width >= img.height ? 'landscape' : 'portrait';
                    const pdf = new jsPDF({ orientation: orientation, unit: 'px', format: [img.width, img.height] });
                    pdf.addImage(img, 'PNG', 0, 0, img.width, img.height);
                    pdf.save('chart-export.pdf');
                    resolve(null);
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = function () {
                // Still no good (e.g. the tenant doesn't return
                // Access-Control-Allow-Credentials for this endpoint) -
                // fall back to just opening the exported image directly
                // rather than leaving the user with nothing at all.
                console.warn('Could not load the exported chart image for PDF conversion - opening the image instead.');
                window.open(imgLink, '_blank');
                resolve(null);
            };
            img.src = imgLink;
        });
    });
}
