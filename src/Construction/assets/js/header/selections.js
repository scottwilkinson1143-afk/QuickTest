// Qlik field names are raw model names (ProductCategory, CountryRegionCode,
// %Dimensions) - not something to show verbatim in a user-facing popup.
// Splits camelCase/PascalCase into words and strips a leading "%" so
// "ProductCategory" reads as "Product Category" without needing a manual
// per-field label map.
function humanizeFieldName(field) {
    return field
        .replace(/^%/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim();
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function BuildCurrentSelections(app){
    //Grab Current Selections
    app.getList("SelectionObject", function(reply) {
      const $selections = $("#currSelections");
      $selections.html("");

      //Setting Starting variable
      const selectionsObject = reply.qSelectionObject.qSelections;

      //Total Selections Badge
      // The reducer MUST return acc on every path - a hidden field used to
      // fall through without a return, making the callback implicitly
      // return undefined. reduce() then carries that undefined forward as
      // acc for every following field, turning the running total into NaN
      // for the rest of the array. NaN == 0 and NaN > 0 are both false, so
      // neither branch below ever fired and the badge just kept whatever
      // state it was already in - which is exactly why it looked like it
      // "sometimes" showed and "sometimes" didn't, depending on whether a
      // hidden field happened to be in the current selection set.
      const initialValue = 0;
      const totalSelections = selectionsObject.reduce(function(acc, cur) {
        return cur.qIsHidden != true ? acc + cur.qSelectedCount : acc;
      }, initialValue);

      if (totalSelections == 0) {
        $(".notification .badge").hide();
      }
      else if(totalSelections > 0) {
        $(".notification .badge").show().html(totalSelections);
      }

      //Loop through selections and append to popup
      let visibleCount = 0;
      $.each(selectionsObject, function(key, value) {
        //Setting Starting variables
        const field = value.qField;
        const fieldHidden = value.qIsHidden;
        const numSelected = value.qSelectedCount;
        const total = value.qTotal;
        const threshold = 3;
        const selectedStr = value.qSelected;

        if(fieldHidden != true){
          visibleCount++;
          const summary = numSelected <= threshold ? selectedStr : `${numSelected} of ${total}`;
          $selections.append(`
            <div class='selected-field-container' id='${field}'>
              <div class='selected-field-text'>
                <span class='selected-field'>${escapeHtml(humanizeFieldName(field))}</span>
                <span class='selected-value' title='${escapeHtml(summary)}'>${escapeHtml(summary)}</span>
              </div>
              <span class='clear-field' title='Clear'>${iconSvg('close')}</span>
            </div>
          `);
        }


      });

      if (visibleCount === 0) {
        $selections.html("<p class='qlik-filter-empty mb-0'>No selections made</p>");
      }

      //Clear selection
      $(".clear-field").click(function() {
        const field = $(this).parent().attr("id");
        app.field(field).clear();
      });
    });
}
  