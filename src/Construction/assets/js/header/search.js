function BuildSearchSelections(app){
  //Selections Navigation
  $("[data-control]").click(function() {
    const $element = $(this);
    switch ($element.data("control")) {
      case "clear":
        app.clearAll();
        break;
      case "back":
        app.back();
        break;
      case "forward":
        app.forward();
        break;
    }
  });

  // Bumped on every search request so a response can tell whether it's
  // still the latest in-flight request. app.searchResults() is async, and
  // typing fast enough can make requests resolve out of order - without
  // this check, an older, slower response landing after a newer one could
  // overwrite the menu with stale results.
  let searchRequestId = 0;

  // Single source of truth for triggering searches: jQuery UI's own
  // async `source` function, driven by its built-in (debounced) keystroke
  // handling. Previously there was ALSO a separate manual `.keyup()`
  // handler that re-fetched results and force-reopened the menu - with
  // two independent triggers racing each other, a keystroke's manual
  // re-fetch could rebuild the suggestion <li> elements out from under an
  // in-progress click, so the click sometimes landed on a node that had
  // just been replaced and the "select" event never fired. Doing the
  // Qlik search inside `source` and calling `response()` only when its
  // result is still current removes the second trigger entirely.
  const $searchIcon = $("#barSearch").closest(".navbar-search-pill").find(".navbar-search-icon");

  $("#barSearch").autocomplete({
    minLength: 1,
    // Default is 300ms - on top of the async round-trip to
    // app.searchResults(), the combined delay before anything visibly
    // happens was apparently enough that users assumed nothing had
    // registered and kept typing ("have to type twice"). Shorter delay,
    // plus the spinning search icon below, gives faster/more visible
    // feedback that a search is actually in progress.
    delay: 150,
    source: function(request, response) {
      const requestId = ++searchRequestId;
      $searchIcon.addClass('is-searching');

      app.searchResults(
        [request.term],
        { qOffset: 0, qCount: 15 },
        { qContext: "CurrentSelections" },
        function(reply) {
          if (requestId !== searchRequestId) {
            // A newer keystroke already started another request - this
            // response is stale, discard it.
            return;
          }
          $searchIcon.removeClass('is-searching');

          const arrSearch = [];
          const searchTerm = reply.qResult.qSearchGroupArray;
          // Each group can hold more than one qItem - when a field already
          // has a selection, Qlik's associative search starts returning
          // compound/associative match groups (multiple related fields per
          // group) instead of always exactly one. Only ever reading
          // qItems[0] silently dropped every match beyond the first field
          // in a group, which is why applying a search selection appeared
          // to do nothing once another field already had a selection.
          $.each(searchTerm, function(key, group) {
            $.each(group.qItems, function(itemKey, item) {
              const dim = item.qIdentifier;
              $.each(item.qItemMatches, function(matchKey, match) {
                arrSearch.push({
                  label: match.qText,
                  value: dim
                });
              });
            });
          });

          response(arrSearch);
        }
      );
    },
    select: function(_event, ui) {
      // selectValues() does an exact string match against the field's
      // stored value list, which fails silently for numeric fields when
      // the search API's returned text (e.g. "1000") doesn't exactly match
      // the field's own formatted display text (e.g. "1,000"). selectMatch()
      // uses Qlik's own text-matching engine - the same one that produced
      // this search suggestion in the first place - so it matches reliably
      // regardless of field type/number formatting.
      app.field(ui.item.value).selectMatch(ui.item.label, true);
      return false;
    }
  }).autocomplete("instance")._renderItem = function(ul, item) {
    return $('<li>')
      .append(`<div class="search-label">${item.label}</div><div class="search-value">${item.value}</div>`)
      .appendTo(ul);
  };
}
