// Bookmarks dropdown (top navbar) - lists the app's saved bookmarks,
// applies one on click, and lets the user create a new one (from the
// current selections) or delete an existing one.
let bookmarksApp = null;

function BuildBookmarksList(app) {
    bookmarksApp = app;
    refreshBookmarksList(app);

    const createBtn = document.getElementById('createBookmarkConfirmBtn');
    if (createBtn) {
        createBtn.addEventListener('click', confirmCreateBookmark);
    }

    const createModalEl = document.getElementById('createBookmarkModal');
    if (createModalEl) {
        createModalEl.addEventListener('show.bs.modal', function () {
            document.getElementById('createBookmarkNameInput').value = '';
            document.getElementById('createBookmarkDescInput').value = '';
            document.getElementById('createBookmarkNameInput').classList.remove('is-invalid');
        });
    }

    const nameInput = document.getElementById('createBookmarkNameInput');
    if (nameInput) {
        nameInput.addEventListener('input', function () {
            nameInput.classList.remove('is-invalid');
        });
        nameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmCreateBookmark();
            }
        });
    }
}

function refreshBookmarksList(app) {
    app.getList('BookmarkList', function (reply) {
        // Logged for diagnosis - the exact reply shape (which wrapper
        // property actually holds the items) seems to vary by Capability
        // API/tenant version, so this makes it visible in DevTools rather
        // than guessing blind again.
        //console.log('app.getList("BookmarkList") reply:', reply);

        const items = (reply && reply.qBookmarkList && reply.qBookmarkList.qItems)
            || (reply && reply.qAppObjectList && reply.qAppObjectList.qItems)
            || (Array.isArray(reply) ? reply : null)
            || [];
        const $list = $('#bookmarksList');
        $list.html('');

        if (!items.length) {
            $list.html("<p class='qlik-filter-empty mb-0'>No bookmarks saved in this app.</p>");
            return;
        }

        $.each(items, function (i, item) {
            const id = item.qInfo && item.qInfo.qId;
            const title = (item.qMeta && item.qMeta.title) || (item.qData && item.qData.title) || 'Untitled';
            const description = (item.qMeta && item.qMeta.description) || (item.qData && item.qData.description) || '';
            $list.append(`
                <div class="bookmark-item" data-search="${escapeHtml(title).toLowerCase()}">
                    <a href="javascript:;" class="bookmark-item-label" data-bookmark-id="${escapeHtml(id)}" title="${escapeHtml(description)}">
                        ${iconSvg('bookmark_border')}
                        <span>${escapeHtml(title)}</span>
                    </a>
                    <button type="button" class="bookmark-item-delete" data-bookmark-id="${escapeHtml(id)}" title="Delete">
                        ${iconSvg('delete_outline')}
                    </button>
                </div>
            `);
        });

        $list.find('.bookmark-item-label').on('click', function () {
            const id = $(this).data('bookmark-id');
            if (app.bookmark && typeof app.bookmark.apply === 'function') {
                app.bookmark.apply(id);
            } else {
                console.warn('app.bookmark.apply is not available on this Capability API version - cannot apply bookmark ' + id);
            }
        });

        $list.find('.bookmark-item-delete').on('click', function () {
            const id = $(this).data('bookmark-id');
            if (app.bookmark && typeof app.bookmark.remove === 'function') {
                app.bookmark.remove(id, function () {
                    refreshBookmarksList(app);
                });
            } else {
                console.warn('app.bookmark.remove is not available on this Capability API version - cannot delete bookmark ' + id);
            }
        });
    });
}

function confirmCreateBookmark() {
    const nameInput = document.getElementById('createBookmarkNameInput');
    const descInput = document.getElementById('createBookmarkDescInput');
    const name = nameInput && nameInput.value.trim();

    if (!name) {
        if (nameInput) {
            nameInput.classList.add('is-invalid');
        }
        return;
    }

    if (!bookmarksApp || !bookmarksApp.bookmark || typeof bookmarksApp.bookmark.create !== 'function') {
        console.warn('app.bookmark.create is not available on this Capability API version - cannot create a bookmark.');
        return;
    }

    bookmarksApp.bookmark.create(name, descInput ? descInput.value.trim() : '', function () {
        refreshBookmarksList(bookmarksApp);
        const modalEl = document.getElementById('createBookmarkModal');
        if (modalEl && window.bootstrap && window.bootstrap.Modal) {
            window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        }
    });
}

// Filters the bookmark dropdown's items by title as the user types. Bound
// once (not inside refreshBookmarksList()) since the search input itself
// never gets rebuilt, only the list contents do.
$(document).on('input', '#bookmarksSearch', function () {
    const normalized = $(this).val().trim().toLowerCase();
    $('#bookmarksList .bookmark-item').each(function () {
        const matches = !normalized || ($(this).data('search') || '').indexOf(normalized) !== -1;
        $(this).toggle(matches);
    });
});
