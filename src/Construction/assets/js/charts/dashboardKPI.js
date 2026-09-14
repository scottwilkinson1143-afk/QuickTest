function BuildDashboardKPI(app){
    app.createCube({
        "qInitialDataFetch": [
            {
                "qHeight": 10,
                "qWidth": 8
            }
        ],
        "qDimensions": [
                
        ],
        "qMeasures": [
            {
                "qDef": {
                    "qDef": "=$(vFormatSize({<[Year]={$(=Max([Year])-2)}>} [Sales]))",
                    "qLabel": "Sales TY"
                },
            },
            {
                "qDef": {
                    "qDef": "=num((1-({<[Year]={$(=Max([Year])-2)}>} [Sales]/ {<[Year]={$(=Max([Year])-3)}>} [Sales]))*100,'#,##0')",
                    "qLabel": "%"
                },
            },
            {
                "qDef": {
                    "qDef": "=$(vFormatSize({<[Year]={$(=Max([Year])-2)}>} [# of Orders]))",
                    "qLabel": "# Orders TY"
                },
            },
            {
                "qDef": {
                    "qDef": "=num((1-({<[Year]={$(=Max([Year])-2)}>} [# of Orders]/ {<[Year]={$(=Max([Year])-3)}>} [# of Orders]))*100, '#,##0')",
                    "qLabel": "%"
                },
            },
            {
                "qDef": {
                    "qDef": "=$(vFormatSize({<[Year]={$(=Max([Year])-2)}>} [Margin]))",
                    "qLabel": "Margin TY"
                },
            },
            {
                "qDef": {
                    "qDef": "=num((1-({<[Year]={$(=Max([Year])-2)}>} [Margin]/ {<[Year]={$(=Max([Year])-3)}>} [Margin]))*100, '#,##0')",
                    "qLabel": "%"
                },
            }
        ],
        "qSuppressZero": false,
        "qSuppressMissing": false,
        "qMode": "S",
        "qInterColumnSortOrder": [], //sort order of columns in hypercube
        "qStateName": "$"
        }, 
            function(reply){
                //console.log(reply);
                const matrix = reply.qHyperCube.qDataPages[0].qMatrix[0];
                const measureInfo = reply.qHyperCube.qMeasureInfo;

                // Renders one KPI card (value/label/YoY comparison) from a pair of
                // hypercube columns - collapses what were 4 near-identical blocks below.
                const renderKpi = (id, valueCol, labelMeasureIdx, compareCol, prefix = '') => {
                    const value = matrix[valueCol].qText;
                    const label = measureInfo[labelMeasureIdx].qFallbackTitle;
                    const compareValue = matrix[compareCol].qText;

                    $(`#DASHBOARD-KPI-${id}-VALUE`).html(prefix + value);
                    $(`#DASHBOARD-KPI-${id}-LABEL`).html(label);

                    const trendClass = compareValue >= 0 ? 'text-success' : 'text-danger';
                    const sign = compareValue >= 0 ? '+' : '';
                    $(`#DASHBOARD-KPI-${id}-COMPARISON`).empty().append(
                        `<span class='${trendClass} text-sm font-weight-bolder'>${sign}${compareValue}%</span> than last year`
                    );
                };

                // Measure columns (after Cost/KPI-2 was removed): 0/1 = Sales,
                // 2/3 = # of Orders, 4/5 = Margin. KPI-2 (green cart icon) and
                // KPI-3 (blue person icon) were pointed at the wrong columns -
                // Margin was rendering into the Orders slot and vice versa,
                // and Orders (a count, not currency) was getting a stray '£'
                // prefix meant for Margin. Order now matches the chart cards
                // below (Sales/Orders/Margin, dark/green/blue).
                renderKpi(1, 0, 0, 1, '£');
                renderKpi(2, 2, 2, 3);
                renderKpi(3, 4, 4, 5, '£');
            }
    );
}