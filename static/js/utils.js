document.addEventListener('DOMContentLoaded', function() {
    const isMobileNavbar = function() {
        return window.matchMedia('(max-width: 1023px)').matches;
    };

    const closeMobileDropdowns = function() {
        document.querySelectorAll('.site-navbar .has-dropdown.is-active').forEach(function(dropdown) {
            dropdown.classList.remove('is-active');

            const trigger = dropdown.querySelector('[data-navbar-dropdown-toggle]');
            if (trigger) {
                trigger.setAttribute('aria-expanded', 'false');
            }
        });
    };

    document.querySelectorAll('.navbar-burger').forEach(function(navbarBurger) {
        navbarBurger.addEventListener('click', function() {
            const targetId = navbarBurger.dataset.target;
            const navbarMenu = targetId ? document.getElementById(targetId) : null;
            if (!navbarMenu) {
                return;
            }

            const isActive = navbarBurger.classList.toggle('is-active');
            navbarMenu.classList.toggle('is-active', isActive);
            navbarBurger.setAttribute('aria-expanded', isActive ? 'true' : 'false');

            if (!isActive) {
                closeMobileDropdowns();
            }
        });
    });

    document.querySelectorAll('[data-navbar-dropdown-toggle]').forEach(function(dropdownToggle) {
        dropdownToggle.addEventListener('click', function(event) {
            event.preventDefault();

            if (!isMobileNavbar()) {
                return;
            }

            const dropdown = dropdownToggle.closest('.has-dropdown');
            if (!dropdown) {
                return;
            }

            const nextState = !dropdown.classList.contains('is-active');
            closeMobileDropdowns();
            dropdown.classList.toggle('is-active', nextState);
            dropdownToggle.setAttribute('aria-expanded', nextState ? 'true' : 'false');
        });
    });

    document.addEventListener('click', function(event) {
        if (!isMobileNavbar()) {
            return;
        }

        if (event.target.closest('.site-navbar .has-dropdown')) {
            return;
        }

        closeMobileDropdowns();
    });

    window.addEventListener('resize', function() {
        if (!isMobileNavbar()) {
            closeMobileDropdowns();
        }
    });

    initSiteSearch({
        closeMobileDropdowns: closeMobileDropdowns,
        isMobileNavbar: isMobileNavbar
    });

    initProfilePreviewTooltips();
    refreshTimeAgo(document);
    startTimeAgoUpdates();

    window.requestAnimationFrame(function() {
        window.requestAnimationFrame(function() {
            releaseInitialPageLoading();
        });
    });
});

function debounce(callback, waitMs) {
    let timerId = null;

    return function() {
        const args = arguments;
        const context = this;
        window.clearTimeout(timerId);
        timerId = window.setTimeout(function() {
            callback.apply(context, args);
        }, Math.max(Number(waitMs) || 0, 0));
    };
}

function formatNumber(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return '0';
    }
    return numericValue.toLocaleString('en-IE');
}

const TOAST_META = {
    success: { icon: 'fa-circle-check', label: 'Success' },
    warning: { icon: 'fa-triangle-exclamation', label: 'Warning' },
    error: { icon: 'fa-circle-xmark', label: 'Error' }
};

let timeAgoIntervalId = null;

const profilePreviewCache = Object.create(null);
let profilePreviewTooltipState = null;
const timeAgoDateFormatter = new Intl.DateTimeFormat('en-IE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
});

function parseTimestampValue(value) {
    if (value === null || value === undefined) {
        return null;
    }

    const rawValue = String(value).trim();
    if (!rawValue) {
        return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(rawValue)) {
        const dateOnly = new Date(rawValue + 'T00:00:00');
        return Number.isNaN(dateOnly.getTime()) ? null : dateOnly;
    }

    const parsedDate = new Date(rawValue);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function formatAbsoluteTimestamp(dateInput) {
    const parsedDate = dateInput instanceof Date ? dateInput : parseTimestampValue(dateInput);
    if (!parsedDate) {
        return 'recently';
    }

    return timeAgoDateFormatter.format(parsedDate);
}

function timeAgo(dateString) {
    const rawValue = dateString === null || dateString === undefined ? '' : String(dateString).trim();
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(rawValue);
    const parsedDate = parseTimestampValue(rawValue);
    if (!parsedDate) {
        return 'recently';
    }

    if (isDateOnly) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const targetDate = new Date(parsedDate.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
        const deltaDays = Math.floor((today.getTime() - targetDate.getTime()) / 86400000);

        if (deltaDays <= 0) {
            return 'just now';
        }
        if (deltaDays === 1) {
            return 'yesterday';
        }
        if (deltaDays < 14) {
            return deltaDays + ' days ago';
        }
        if (deltaDays < 30) {
            const weeks = Math.max(Math.floor(deltaDays / 7), 1);
            return weeks + ' ' + (weeks === 1 ? 'week' : 'weeks') + ' ago';
        }

        return formatAbsoluteTimestamp(parsedDate);
    }

    const deltaMilliseconds = Date.now() - parsedDate.getTime();
    if (deltaMilliseconds <= 0) {
        return 'just now';
    }

    const deltaSeconds = Math.floor(deltaMilliseconds / 1000);
    if (deltaSeconds < 60) {
        return 'just now';
    }
    if (deltaSeconds < 3600) {
        return Math.floor(deltaSeconds / 60) + 'm ago';
    }
    if (deltaSeconds < 86400) {
        return Math.floor(deltaSeconds / 3600) + 'h ago';
    }

    const deltaDays = Math.floor(deltaSeconds / 86400);
    if (deltaDays === 1) {
        return 'yesterday';
    }
    if (deltaDays < 14) {
        return deltaDays + ' days ago';
    }
    if (deltaDays < 30) {
        const weeks = Math.max(Math.floor(deltaDays / 7), 1);
        return weeks + ' ' + (weeks === 1 ? 'week' : 'weeks') + ' ago';
    }

    return formatAbsoluteTimestamp(parsedDate);
}

function initProfilePreviewTooltips() {
    const desktopPreviewMedia = window.matchMedia('(min-width: 769px) and (hover: hover) and (pointer: fine)');
    const tooltip = createProfilePreviewTooltip();
    const state = {
        activeLink: null,
        hoverTimer: null,
        hideTimer: null,
        media: desktopPreviewMedia,
        tooltip: tooltip
    };
    profilePreviewTooltipState = state;

    const hideTooltip = function() {
        window.clearTimeout(state.hideTimer);
        state.hideTimer = null;
        state.activeLink = null;
        state.tooltip.classList.remove('is-visible');
        state.tooltip.hidden = true;
    };

    const cancelPendingHover = function() {
        window.clearTimeout(state.hoverTimer);
        state.hoverTimer = null;
    };

    const handleLinkEnter = function(link) {
        if (!state.media.matches) {
            return;
        }

        window.clearTimeout(state.hideTimer);
        cancelPendingHover();
        state.activeLink = link;
        state.hoverTimer = window.setTimeout(async function() {
            const previewName = getProfilePreviewName(link);
            if (!previewName || state.activeLink !== link) {
                return;
            }

            const preview = await fetchProfilePreview(previewName);
            if (!preview || state.activeLink !== link) {
                return;
            }

            renderProfilePreviewTooltip(state.tooltip, preview);
            positionProfilePreviewTooltip(state.tooltip, link);
            state.tooltip.hidden = false;
            requestAnimationFrame(function() {
                state.tooltip.classList.add('is-visible');
            });
        }, 500);
    };

    const handleLinkLeave = function(link) {
        if (state.activeLink === link) {
            state.activeLink = null;
        }
        cancelPendingHover();
        state.hideTimer = window.setTimeout(hideTooltip, 70);
    };

    document.addEventListener('mouseover', function(event) {
        const link = event.target && typeof event.target.closest === 'function'
            ? event.target.closest('.user-profile-link[data-profile-preview-name]')
            : null;
        if (!link) {
            return;
        }

        if (event.relatedTarget && link.contains(event.relatedTarget)) {
            return;
        }

        handleLinkEnter(link);
    });

    document.addEventListener('mouseout', function(event) {
        const link = event.target && typeof event.target.closest === 'function'
            ? event.target.closest('.user-profile-link[data-profile-preview-name]')
            : null;
        if (!link) {
            return;
        }

        if (event.relatedTarget && link.contains(event.relatedTarget)) {
            return;
        }

        handleLinkLeave(link);
    });

    document.addEventListener('click', function() {
        hideTooltip();
    });

    state.media.addEventListener('change', function() {
        cancelPendingHover();
        hideTooltip();
    });

    document.addEventListener('scroll', hideTooltip, true);
    window.addEventListener('resize', hideTooltip);
}

function initPublicProfileBadges() {
    document.querySelectorAll('[data-public-profile-badges]').forEach(function(section) {
        const toggleButton = section.querySelector('[data-public-profile-badges-toggle]');
        const overflowRow = section.querySelector('[data-public-profile-badges-overflow]');
        if (!toggleButton || !overflowRow) {
            return;
        }

        toggleButton.addEventListener('click', function() {
            const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
            const nextExpanded = !isExpanded;
            const nextLabel = nextExpanded
                ? String(toggleButton.getAttribute('data-expanded-label') || 'Show fewer')
                : String(toggleButton.getAttribute('data-collapsed-label') || '').trim();

            toggleButton.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
            toggleButton.textContent = nextLabel || (nextExpanded ? 'Show fewer' : 'Show more');
            overflowRow.hidden = !nextExpanded;
            overflowRow.classList.toggle('is-hidden', !nextExpanded);
        });
    });
}

function initSiteSearch(options) {
    const searchRoot = document.querySelector('[data-site-search]');
    if (!searchRoot) {
        return;
    }

    const searchForm = searchRoot.querySelector('[data-site-search-form]');
    const searchInput = searchRoot.querySelector('[data-site-search-input]');
    const resultsPanel = searchRoot.querySelector('[data-site-search-results]');
    const openButtons = Array.from(document.querySelectorAll('[data-site-search-open]'));
    const closeButtons = Array.from(searchRoot.querySelectorAll('[data-site-search-close]'));
    if (!searchForm || !searchInput || !resultsPanel || !openButtons.length) {
        return;
    }

    const state = {
        controller: null,
        debounceTimer: null,
        isOpen: false,
        lastPayload: null,
        lastRenderedQuery: ''
    };
    const searchDebounceDelay = 300;

    const shouldUseOverlayMode = function() {
        if (options && typeof options.isMobileNavbar === 'function') {
            return options.isMobileNavbar();
        }
        return window.matchMedia('(max-width: 1023px)').matches;
    };

    const setOpenButtonsExpanded = function(isExpanded) {
        openButtons.forEach(function(button) {
            button.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        });
    };

    const syncBodyLock = function() {
        document.body.classList.toggle('has-site-search-open', state.isOpen && shouldUseOverlayMode());
    };

    const closeExpandedNavbarMenus = function() {
        if (options && typeof options.closeMobileDropdowns === 'function') {
            options.closeMobileDropdowns();
        }

        document.querySelectorAll('.site-navbar .navbar-burger.is-active').forEach(function(burger) {
            burger.classList.remove('is-active');
            burger.setAttribute('aria-expanded', 'false');
        });
        document.querySelectorAll('.site-navbar .navbar-menu.is-active').forEach(function(menu) {
            menu.classList.remove('is-active');
        });
    };

    const clearPendingSearch = function() {
        window.clearTimeout(state.debounceTimer);
        state.debounceTimer = null;

        if (state.controller) {
            state.controller.abort();
            state.controller = null;
        }
    };

    const hideResults = function() {
        resultsPanel.hidden = true;
        resultsPanel.innerHTML = '';
    };

    const openSearch = function(trigger) {
        if (state.isOpen) {
            if (searchInput) {
                searchInput.focus();
                searchInput.select();
            }
            return;
        }

        state.isOpen = true;
        searchRoot.hidden = false;
        searchRoot.classList.add('is-open');
        setOpenButtonsExpanded(true);
        if (shouldUseOverlayMode()) {
            closeExpandedNavbarMenus();
        }
        syncBodyLock();

        window.requestAnimationFrame(function() {
            searchInput.focus();
            if (searchInput.value) {
                searchInput.select();
                if (state.lastPayload && state.lastRenderedQuery === String(searchInput.value || '').trim()) {
                    renderSearchResults(state.lastPayload);
                } else {
                    scheduleSearch(true);
                }
            } else {
                hideResults();
            }
        });

        if (trigger && typeof trigger.blur === 'function') {
            trigger.blur();
        }
    };

    const closeSearch = function() {
        if (!state.isOpen) {
            return;
        }

        clearPendingSearch();
        state.isOpen = false;
        searchRoot.classList.remove('is-open');
        searchRoot.hidden = true;
        setOpenButtonsExpanded(false);
        syncBodyLock();
    };

    const renderViewAllLink = function(url) {
        const safeUrl = String(url || '').trim();
        if (!safeUrl) {
            return '';
        }

        return (
            '<a href="' + escapeHtml(safeUrl) + '" class="site-search__view-all">'
            + '<span>View all results</span>'
            + '<span class="icon" aria-hidden="true"><i class="fas fa-arrow-right"></i></span>'
            + '</a>'
        );
    };

    const renderSearchAvatar = function(result) {
        const avatarUrl = String(result && result.avatar_url || '').trim();
        if (avatarUrl) {
            return '<span class="site-search-result__avatar"><img src="' + escapeHtml(avatarUrl) + '" alt="' + escapeHtml(String(result.display_name || 'User') + ' avatar') + '"></span>';
        }

        return '<span class="site-search-result__avatar" aria-hidden="true"><i class="fas fa-user"></i></span>';
    };

    const renderSearchMarker = function(kind) {
        const iconClass = kind === 'county' ? 'fa-map-pin' : 'fa-mountain';
        const extraClass = kind === 'county' ? ' site-search-result__marker--county' : '';
        return '<span class="site-search-result__marker' + extraClass + '" aria-hidden="true"><i class="fas ' + iconClass + '"></i></span>';
    };

    const renderSearchItem = function(result, kind) {
        const title = kind === 'user' ? String(result.display_name || '') : String(result.name || '');
        const meta = String(result.meta || '').trim();
        const url = String(result.url || '').trim();
        const previewName = kind === 'user' ? String(result.profile_preview_name || '').trim() : '';
        const linkClasses = ['site-search-result'];
        const previewAttribute = previewName ? ' data-profile-preview-name="' + escapeHtml(previewName) + '"' : '';

        if (kind === 'user') {
            linkClasses.push('user-profile-link');
        }

        return (
            '<a href="' + escapeHtml(url) + '" class="' + linkClasses.join(' ') + '"' + previewAttribute + '>'
            + (kind === 'user' ? renderSearchAvatar(result) : renderSearchMarker(kind))
            + '  <span class="site-search-result__copy">'
            + '      <span class="site-search-result__title">' + escapeHtml(title) + '</span>'
            + '      <span class="site-search-result__meta">' + escapeHtml(meta) + '</span>'
            + '  </span>'
            + '  <span class="site-search-result__arrow" aria-hidden="true"><i class="fas fa-arrow-right"></i></span>'
            + '</a>'
        );
    };

    const renderSearchSection = function(section) {
        const items = Array.isArray(section.items) ? section.items : [];
        if (!items.length) {
            return '';
        }

        return (
            '<section class="site-search__section">'
            + '  <div class="site-search__section-header">'
            + '      <span class="site-search__section-title"><i class="fas ' + escapeHtml(section.icon) + '" aria-hidden="true"></i><span>' + escapeHtml(section.label) + '</span></span>'
            + '      <span>' + escapeHtml(String(items.length)) + '</span>'
            + '  </div>'
            + '  <div class="site-search__list">'
            + items.map(function(item) { return renderSearchItem(item, section.key); }).join('')
            + '  </div>'
            + '</section>'
        );
    };

    const renderSearchResults = function(payload) {
        const normalizedQuery = String(payload && payload.query || '').trim();
        if (!normalizedQuery) {
            hideResults();
            return;
        }

        const sections = [
            {
                icon: 'fa-mountain',
                items: Array.isArray(payload && payload.peaks) ? payload.peaks : [],
                key: 'peak',
                label: 'Peaks'
            },
            {
                icon: 'fa-user-group',
                items: Array.isArray(payload && payload.users) ? payload.users : [],
                key: 'user',
                label: 'Users'
            },
            {
                icon: 'fa-map-pin',
                items: Array.isArray(payload && payload.counties) ? payload.counties : [],
                key: 'county',
                label: 'Counties'
            }
        ].filter(function(section) {
            return section.items.length > 0;
        });

        if (!sections.length) {
            resultsPanel.innerHTML = (
                '<div class="site-search__empty">No matches found for "' + escapeHtml(normalizedQuery) + '".</div>'
                + renderViewAllLink(payload && payload.view_all_url)
            );
            resultsPanel.hidden = false;
            state.lastRenderedQuery = normalizedQuery;
            return;
        }

        resultsPanel.innerHTML = sections.map(renderSearchSection).join('') + renderViewAllLink(payload && payload.view_all_url);
        resultsPanel.hidden = false;
        state.lastRenderedQuery = normalizedQuery;
    };

    const renderSearchError = function(query) {
        const safeQuery = String(query || '').trim();
        if (!safeQuery) {
            hideResults();
            return;
        }

        resultsPanel.innerHTML = '<div class="site-search__status">We could not load search results right now.</div>' + renderViewAllLink('/search?q=' + encodeURIComponent(safeQuery));
        resultsPanel.hidden = false;
    };

    const performSearch = async function() {
        const query = String(searchInput.value || '').trim();
        if (!query) {
            clearPendingSearch();
            hideResults();
            return;
        }

        clearPendingSearch();
        resultsPanel.innerHTML = '<div class="site-search__status">Searching...</div>';
        resultsPanel.hidden = false;

        const controller = new AbortController();
        state.controller = controller;

        try {
            const response = await fetch('/api/search?q=' + encodeURIComponent(query), {
                headers: {
                    Accept: 'application/json'
                },
                signal: controller.signal
            });
            const payload = await response.json().catch(function() {
                return {};
            });
            if (controller.signal.aborted || String(searchInput.value || '').trim() !== query) {
                return;
            }

            state.lastPayload = payload || {};
            renderSearchResults(state.lastPayload);
        } catch (error) {
            if (error && error.name === 'AbortError') {
                return;
            }
            if (String(searchInput.value || '').trim() !== query) {
                return;
            }
            renderSearchError(query);
        } finally {
            if (state.controller === controller) {
                state.controller = null;
            }
        }
    };

    const scheduleSearch = function(runImmediately) {
        window.clearTimeout(state.debounceTimer);
        state.debounceTimer = null;

        if (runImmediately) {
            void performSearch();
            return;
        }

        state.debounceTimer = window.setTimeout(function() {
            void performSearch();
        }, searchDebounceDelay);
    };

    openButtons.forEach(function(button) {
        button.addEventListener('click', function(event) {
            event.preventDefault();
            if (state.isOpen) {
                closeSearch();
                return;
            }

            openSearch(button);
        });
    });

    closeButtons.forEach(function(button) {
        button.addEventListener('click', function() {
            closeSearch();
        });
    });

    searchInput.addEventListener('input', function() {
        scheduleSearch(false);
    });

    searchInput.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeSearch();
        }
    });

    searchForm.addEventListener('submit', function(event) {
        const query = String(searchInput.value || '').trim();
        if (!query) {
            event.preventDefault();
            hideResults();
            closeSearch();
        }
    });

    window.addEventListener('resize', function() {
        syncBodyLock();
    });

    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && state.isOpen) {
            closeSearch();
        }
    });
}

function createProfilePreviewTooltip() {
    const tooltip = document.createElement('div');
    tooltip.className = 'profile-preview-tooltip';
    tooltip.hidden = true;
    tooltip.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tooltip);
    return tooltip;
}

function getProfilePreviewName(link) {
    if (!link) {
        return '';
    }

    const datasetName = String(link.getAttribute('data-profile-preview-name') || '').trim();
    if (datasetName) {
        return datasetName;
    }

    return String(link.textContent || '').trim();
}

async function fetchProfilePreview(displayName) {
    const normalizedName = String(displayName || '').trim();
    if (!normalizedName) {
        return null;
    }

    const cacheKey = normalizedName.toLowerCase();
    const cachedEntry = profilePreviewCache[cacheKey];
    if (cachedEntry && Object.prototype.hasOwnProperty.call(cachedEntry, 'data')) {
        return cachedEntry.data;
    }
    if (cachedEntry && cachedEntry.promise) {
        return cachedEntry.promise;
    }

    const requestPromise = fetch('/api/profile/preview/' + encodeURIComponent(normalizedName), {
        headers: {
            Accept: 'application/json'
        }
    }).then(async function(response) {
        const payload = await response.json().catch(function() {
            return {};
        });
        if (!response.ok) {
            profilePreviewCache[cacheKey] = { data: null };
            return null;
        }

        const preview = payload && payload.profile ? payload.profile : payload;
        profilePreviewCache[cacheKey] = { data: preview || null };
        return profilePreviewCache[cacheKey].data;
    }).catch(function() {
        profilePreviewCache[cacheKey] = { data: null };
        return null;
    });

    profilePreviewCache[cacheKey] = { promise: requestPromise };
    const preview = await requestPromise;
    if (!profilePreviewCache[cacheKey] || profilePreviewCache[cacheKey].promise) {
        profilePreviewCache[cacheKey] = { data: preview || null };
    }
    return preview;
}

function renderProfilePreviewTooltip(tooltip, preview) {
    if (!tooltip || !preview) {
        return;
    }

    const displayName = String(preview.display_name || 'Climber').trim() || 'Climber';
    const location = String(preview.location || '').trim();
    const memberSince = String(preview.member_since || 'Recently').trim() || 'Recently';
    const peaksClimbedCount = Number(preview.peaks_climbed_count || 0);
    const locationMarkup = location
        ? '<p class="profile-preview-tooltip__location"><i class="fas fa-location-dot"></i> ' + escapeHtml(location) + '</p>'
        : '<p class="profile-preview-tooltip__location">Exploring from somewhere in Ireland.</p>';

    tooltip.innerHTML = `
        <div class="profile-preview-tooltip__layout">
            <div class="profile-preview-tooltip__header">
                ${renderProfilePreviewAvatar(preview)}
                <div class="profile-preview-tooltip__identity">
                    <p class="profile-preview-tooltip__name">${escapeHtml(displayName)}</p>
                    ${locationMarkup}
                </div>
            </div>
            <div class="profile-preview-tooltip__meta">
                <div class="profile-preview-tooltip__meta-item">
                    <span class="profile-preview-tooltip__meta-label">Peaks Climbed</span>
                    <span class="profile-preview-tooltip__meta-value">${Number.isFinite(peaksClimbedCount) ? peaksClimbedCount : 0}</span>
                </div>
                <div class="profile-preview-tooltip__meta-item">
                    <span class="profile-preview-tooltip__meta-label">Member Since</span>
                    <span class="profile-preview-tooltip__meta-value">${escapeHtml(memberSince)}</span>
                </div>
            </div>
        </div>
    `;
}

function renderProfilePreviewAvatar(preview) {
    const avatarUrl = String(preview && preview.avatar_url ? preview.avatar_url : '').trim();
    const displayName = String(preview && preview.display_name ? preview.display_name : 'Climber').trim() || 'Climber';
    const baseOpen = '<span class="user-avatar" style="--user-avatar-size: 40px;">';
    if (avatarUrl) {
        return (
            baseOpen +
            '<img class="user-avatar__image" src="' + escapeHtml(avatarUrl) + '" alt="' + escapeHtml(displayName) + ' avatar" ' +
            'onerror="this.hidden=true; if (this.nextElementSibling) { this.nextElementSibling.hidden=false; }">' +
            '<span class="icon user-avatar__icon" hidden aria-hidden="true"><i class="fas fa-user-circle"></i></span>' +
            '</span>'
        );
    }

    return baseOpen + '<span class="icon user-avatar__icon" aria-hidden="true"><i class="fas fa-user-circle"></i></span></span>';
}

function positionProfilePreviewTooltip(tooltip, link) {
    if (!tooltip || !link) {
        return;
    }

    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    const linkRect = link.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const gap = 12;

    let left = linkRect.left + (linkRect.width / 2) - (tooltipRect.width / 2);
    left = Math.max(8, Math.min(left, viewportWidth - tooltipRect.width - 8));

    const canPositionAbove = linkRect.top >= (tooltipRect.height + gap + 8);
    let top = canPositionAbove
        ? (linkRect.top - tooltipRect.height - gap)
        : (linkRect.bottom + gap);

    if (!canPositionAbove && (top + tooltipRect.height + 8) > viewportHeight) {
        top = Math.max(8, viewportHeight - tooltipRect.height - 8);
    }

    tooltip.style.left = Math.round(left) + 'px';
    tooltip.style.top = Math.round(top) + 'px';
}

function refreshTimeAgo(scope) {
    const root = scope && typeof scope.querySelectorAll === 'function' ? scope : document;
    const elements = [];

    if (root && typeof root.matches === 'function' && root.matches('[data-timestamp]')) {
        elements.push(root);
    }

    root.querySelectorAll('[data-timestamp]').forEach(function(element) {
        elements.push(element);
    });

    elements.forEach(function(element) {
        const timestamp = element.getAttribute('data-timestamp');
        if (!timestamp) {
            return;
        }

        const label = timeAgo(timestamp);
        element.textContent = label;

        if (!element.getAttribute('title')) {
            element.setAttribute('title', formatAbsoluteTimestamp(timestamp));
        }
    });
}

function startTimeAgoUpdates() {
    if (timeAgoIntervalId !== null) {
        return;
    }

    timeAgoIntervalId = window.setInterval(function() {
        refreshTimeAgo(document);
    }, 60000);
}

window.timeAgo = timeAgo;
window.refreshTimeAgo = refreshTimeAgo;
function ensureFieldErrorMessage(field, messageSelector) {
    if (!field) {
        return null;
    }

    let errorMessage = messageSelector ? field.querySelector(messageSelector) : null;
    if (!errorMessage) {
        errorMessage = field.querySelector('.field-error-message');
    }
    if (!errorMessage) {
        errorMessage = document.createElement('p');
        errorMessage.className = 'field-error-message';
        errorMessage.setAttribute('aria-live', 'polite');
        field.appendChild(errorMessage);
    }

    errorMessage.classList.add('field-error-message');
    return errorMessage;
}

function resolveFieldErrorTarget(control) {
    if (!control) {
        return null;
    }

    if (control.matches('[data-peak-star-rating-input]')) {
        return control.closest('[data-peak-star-rating]') || control;
    }

    return control;
}

function clearFieldError(control, options) {
    if (!control) {
        return;
    }

    const target = resolveFieldErrorTarget(control);
    const field = control.closest('.field') || (target ? target.closest('.field') : null);
    if (target) {
        target.classList.remove('field-error');
        target.classList.remove('is-danger');
        target.removeAttribute('aria-invalid');
    }
    if (control !== target) {
        control.classList.remove('field-error');
        control.classList.remove('is-danger');
        control.removeAttribute('aria-invalid');
    }

    const errorMessage = field
        ? (options && options.messageSelector ? field.querySelector(options.messageSelector) : field.querySelector('.field-error-message'))
        : null;
    if (errorMessage) {
        errorMessage.textContent = '';
    }
}

function setFieldError(control, message, options) {
    if (!control) {
        return;
    }

    const target = resolveFieldErrorTarget(control);
    const field = control.closest('.field') || (target ? target.closest('.field') : null);
    const normalizedMessage = String(message || '').trim();
    if (target) {
        target.classList.add('field-error');
        target.classList.add('is-danger');
        target.setAttribute('aria-invalid', 'true');
    }
    if (control !== target) {
        control.classList.add('field-error');
        control.classList.add('is-danger');
        control.setAttribute('aria-invalid', 'true');
    }

    const errorMessage = ensureFieldErrorMessage(field, options && options.messageSelector);
    if (errorMessage) {
        errorMessage.textContent = normalizedMessage;
    }
}

function clearFormFieldErrors(scope, options) {
    if (!scope) {
        return;
    }

    scope.querySelectorAll('.field .input, .field .textarea, .field .select select, [data-peak-star-rating]').forEach(function(control) {
        clearFieldError(control, options);
    });
}

function applyFieldErrors(scope, fieldErrors, selectorMap, options) {
    const normalizedErrors = fieldErrors && typeof fieldErrors === 'object' ? fieldErrors : {};
    let firstInvalidControl = null;

    Object.keys(normalizedErrors).forEach(function(fieldName) {
        const message = String(normalizedErrors[fieldName] || '').trim();
        if (!message || !scope) {
            return;
        }

        const selector = selectorMap && selectorMap[fieldName];
        const control = selector ? scope.querySelector(selector) : null;
        if (!control) {
            return;
        }

        setFieldError(control, message, options);
        if (!firstInvalidControl) {
            firstInvalidControl = control;
        }
    });

    return firstInvalidControl;
}

function getFirstFieldErrorMessage(fieldErrors) {
    if (!fieldErrors || typeof fieldErrors !== 'object') {
        return '';
    }

    const firstMessage = Object.values(fieldErrors).find(function(message) {
        return String(message || '').trim();
    });
    return String(firstMessage || '').trim();
}

function normalizePeakStatusValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'bucket') {
        return 'bucket_listed';
    }
    if (normalized === 'none') {
        return 'not_attempted';
    }
    if (normalized === 'climbed' || normalized === 'bucket_listed' || normalized === 'not_attempted') {
        return normalized;
    }
    return 'not_attempted';
}

function getPeakStatusMarkupFragment(status) {
    const normalizedStatus = normalizePeakStatusValue(status);
    if (window.peakStatusMarkup && window.peakStatusMarkup[normalizedStatus]) {
        return window.peakStatusMarkup[normalizedStatus];
    }
    return '';
}

function getTodayDateValueLocal() {
    const now = new Date();
    const localTime = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    return localTime.toISOString().slice(0, 10);
}

function findDirectLoadingChild(region, attributeName) {
    if (!region || !attributeName) {
        return null;
    }

    return Array.from(region.children || []).find(function(child) {
        return child && child.hasAttribute(attributeName);
    }) || null;
}

function ensureLoadingOverlay(region, message) {
    if (!region) {
        return null;
    }

    let overlay = findDirectLoadingChild(region, 'data-loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'loading-region__overlay';
        overlay.setAttribute('data-loading-overlay', '');
        overlay.hidden = true;

        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';

        const label = document.createElement('span');
        label.className = 'loading-spinner__label';
        label.setAttribute('data-loading-overlay-message', '');

        spinner.appendChild(label);
        overlay.appendChild(spinner);
        region.appendChild(overlay);
    }

    const messageElement = overlay.querySelector('[data-loading-overlay-message]');
    const normalizedMessage = String(message || '').trim();
    if (messageElement) {
        messageElement.textContent = normalizedMessage || 'Loading...';
    }

    return overlay;
}

function setLoadingRegion(region, isLoading, options) {
    if (!region) {
        return;
    }

    const shouldLoad = Boolean(isLoading);
    const shell = findDirectLoadingChild(region, 'data-loading-shell');
    const content = findDirectLoadingChild(region, 'data-loading-content');
    const hasStructuredShell = Boolean(shell && content);

    region.classList.add('loading-region');
    region.classList.toggle('is-loading', shouldLoad);
    region.setAttribute('aria-busy', shouldLoad ? 'true' : 'false');

    if (hasStructuredShell) {
        shell.setAttribute('aria-hidden', shouldLoad ? 'false' : 'true');
        content.setAttribute('aria-hidden', shouldLoad ? 'true' : 'false');
        return;
    }

    const overlay = ensureLoadingOverlay(region, options && options.message);
    region.classList.toggle('loading-region--overlay', shouldLoad);
    if (!overlay) {
        return;
    }

    overlay.hidden = !shouldLoad;
    overlay.setAttribute('aria-hidden', shouldLoad ? 'false' : 'true');
}

function setButtonLoading(button, isLoading) {
    if (!button) {
        return;
    }

    const shouldLoad = Boolean(isLoading);
    if (shouldLoad) {
        if (!button.hasAttribute('data-loading-disabled-state')) {
            button.setAttribute('data-loading-disabled-state', button.disabled ? 'true' : 'false');
        }
        button.disabled = true;
        button.classList.add('is-loading');
        button.setAttribute('aria-busy', 'true');
        return;
    }

    const wasDisabled = button.getAttribute('data-loading-disabled-state') === 'true';
    button.classList.remove('is-loading');
    button.removeAttribute('aria-busy');
    if (!wasDisabled) {
        button.disabled = false;
    }
    button.removeAttribute('data-loading-disabled-state');
}

function releaseInitialPageLoading() {
    document.documentElement.classList.remove('has-initial-page-loading');
}

async function postJsonRequest(url, payload) {
    return jsonRequest(url, 'POST', payload);
}

async function putJsonRequest(url, payload) {
    return jsonRequest(url, 'PUT', payload);
}

async function deleteJsonRequest(url, payload) {
    return jsonRequest(url, 'DELETE', payload);
}

function extractRequestErrorMessage(result, fallbackMessage) {
    if (result && typeof result.message === 'string' && result.message.trim()) {
        return result.message.trim();
    }

    if (result && typeof result.error === 'string' && result.error.trim()) {
        return result.error.trim();
    }

    const firstFieldMessage = getFirstFieldErrorMessage(result && result.fields);
    if (firstFieldMessage) {
        return firstFieldMessage;
    }

    return String(fallbackMessage || 'Something went wrong.');
}

function buildRequestError(result, fallbackMessage) {
    const requestError = new Error(extractRequestErrorMessage(result, fallbackMessage));
    requestError.fields = result && typeof result.fields === 'object' && result.fields ? result.fields : {};
    requestError.result = result || {};
    return requestError;
}

async function jsonRequest(url, method, payload) {
    const headers = {
        'Accept': 'application/json'
    };
    const options = {
        credentials: 'same-origin',
        headers: headers,
        method: method || 'POST'
    };

    if (payload !== undefined) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(payload);
    }

    const response = await fetch(url, {
        body: options.body,
        credentials: options.credentials,
        headers: options.headers,
        method: options.method
    });

    const result = await response.json().catch(function() {
        return {};
    });

    if (!response.ok) {
        throw buildRequestError(result, 'Something went wrong.');
    }

    return result;
}

async function postFormDataRequest(url, formData) {
    const response = await fetch(url, {
        body: formData,
        credentials: 'same-origin',
        headers: {
            'Accept': 'application/json'
        },
        method: 'POST'
    });

    const result = await response.json().catch(function() {
        return {};
    });

    if (!response.ok) {
        throw buildRequestError(result, 'Something went wrong.');
    }

    return result;
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function(character) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[character] || character;
    });
}

function initPeakCommunitySection(section) {
    if (!section) {
        return;
    }

    const hiddenClimbers = section.querySelector('[data-peak-community-hidden-climbers]');
    const toggleButton = section.querySelector('[data-peak-community-toggle]');
    const commentForm = section.querySelector('[data-peak-comment-form]');
    const commentInput = section.querySelector('[data-peak-comment-input]');

    if (toggleButton && hiddenClimbers) {
        toggleButton.addEventListener('click', function() {
            const isHidden = hiddenClimbers.hasAttribute('hidden');
            if (isHidden) {
                hiddenClimbers.removeAttribute('hidden');
                hiddenClimbers.classList.remove('is-hidden');
            } else {
                hiddenClimbers.setAttribute('hidden', '');
                hiddenClimbers.classList.add('is-hidden');
            }

            const label = isHidden
                ? toggleButton.getAttribute('data-expanded-label')
                : toggleButton.getAttribute('data-collapsed-label');
            toggleButton.textContent = String(label || '').trim();
        });
    }

    syncPeakCommentEmptyState(section);

    if (commentInput) {
        commentInput.addEventListener('input', function() {
            clearFieldError(commentInput);
            setPeakCommentError(section, '');
        });
    }

    if (commentForm) {
        commentForm.addEventListener('submit', async function(event) {
            event.preventDefault();

            const peakId = Number(section.dataset.peakId || 0);
            const submitButton = commentForm.querySelector('[data-peak-comment-submit]');
            const commentText = String(commentInput ? commentInput.value || '' : '').trim();

            if (!peakId) {
                return;
            }

            if (!commentText) {
                clearFieldError(commentInput);
                setFieldError(commentInput, 'Please write a trail note before posting.');
                setPeakCommentError(section, 'Please write a trail note before posting.');
                if (commentInput) {
                    commentInput.focus();
                }
                return;
            }

            clearFieldError(commentInput);
            setPeakCommentError(section, '');
            if (submitButton) {
                setButtonLoading(submitButton, true);
            }
            setLoadingRegion(commentForm, true, { message: 'Posting trail note...' });

            try {
                const result = await postJsonRequest('/api/peak-comment', {
                    peak_id: peakId,
                    comment_text: commentText
                });
                prependPeakComment(section, result.comment || {});
                if (commentInput) {
                    commentInput.value = '';
                    commentInput.focus();
                }
                showToast('Trail note posted.', 'success');
            } catch (error) {
                applyFieldErrors(commentForm, error.fields, { comment_text: '[data-peak-comment-input]' });
                setPeakCommentError(section, error.message || 'We could not post that trail note right now.');
                showToast(error.message || 'We could not post that trail note right now.', 'error');
            } finally {
                setLoadingRegion(commentForm, false);
                if (submitButton) {
                    setButtonLoading(submitButton, false);
                }
            }
        });
    }

    section.addEventListener('click', async function(event) {
        const deleteButton = event.target.closest('[data-comment-delete]');
        if (!deleteButton) {
            return;
        }

        event.preventDefault();

        const commentId = Number(deleteButton.getAttribute('data-comment-id') || 0);
        if (!commentId) {
            return;
        }

        const commentItem = section.querySelector('[data-comment-id="' + commentId + '"]');
        setButtonLoading(deleteButton, true);
        if (commentItem) {
            setLoadingRegion(commentItem, true, { message: 'Deleting trail note...' });
        }

        try {
            await postJsonRequest('/api/peak-comment/' + commentId + '/delete', {});
            if (commentItem && commentItem.parentNode) {
                commentItem.parentNode.removeChild(commentItem);
            }
            syncPeakCommentEmptyState(section);
            showToast('Trail note deleted.', 'success');
        } catch (error) {
            showToast(error.message || 'We could not delete that trail note right now.', 'error');
        } finally {
            if (commentItem && commentItem.isConnected) {
                setLoadingRegion(commentItem, false);
            }
            setButtonLoading(deleteButton, false);
        }
    });
}

function setPeakCommentError(section, message) {
    const errorElement = section ? section.querySelector('[data-peak-comment-error]') : null;
    if (!errorElement) {
        return;
    }

    errorElement.textContent = String(message || '').trim();
}

function syncPeakCommentEmptyState(section) {
    const list = section ? section.querySelector('[data-peak-comments-list]') : null;
    const emptyState = section ? section.querySelector('[data-peak-comments-empty]') : null;
    if (!list || !emptyState) {
        return;
    }

    const hasComments = Boolean(list.querySelector('[data-comment-id]'));
    emptyState.classList.toggle('is-hidden', hasComments);
}

function prependPeakComment(section, comment) {
    const list = section ? section.querySelector('[data-peak-comments-list]') : null;
    if (!list) {
        return;
    }

    const article = document.createElement('article');
    article.className = 'peak-detail-list-item';
    if (comment && comment.id !== undefined && comment.id !== null) {
        article.setAttribute('data-comment-id', String(comment.id));
    }

    const layout = document.createElement('div');
    layout.className = 'peak-detail-list-item__layout';

    const avatar = buildUserAvatarNode(comment, 32);
    if (comment.profile_url) {
        const avatarLink = document.createElement('a');
        avatarLink.className = 'peak-detail-list-item__avatar-link';
        avatarLink.href = String(comment.profile_url);
        avatarLink.setAttribute('aria-label', String(comment.display_name || 'Climber'));
        avatarLink.appendChild(avatar);
        layout.appendChild(avatarLink);
    } else {
        const avatarWrap = document.createElement('span');
        avatarWrap.className = 'peak-detail-list-item__avatar';
        avatarWrap.setAttribute('aria-hidden', 'true');
        avatarWrap.appendChild(avatar);
        layout.appendChild(avatarWrap);
    }

    const body = document.createElement('div');
    body.className = 'peak-detail-list-item__body';

    const header = document.createElement('div');
    header.className = 'peak-detail-list-item__header';

    const heading = document.createElement('div');
    heading.className = 'peak-detail-list-item__heading';

    if (comment.profile_url) {
        const link = document.createElement('a');
        link.className = 'peak-detail-list-item__title-link user-profile-link';
        link.href = String(comment.profile_url);
        link.setAttribute('data-profile-preview-name', String(comment.display_name || 'Climber'));

        const title = document.createElement('p');
        title.className = 'peak-detail-list-item__title';
        title.textContent = String(comment.display_name || 'Climber');
        link.appendChild(title);
        heading.appendChild(link);
    } else {
        const title = document.createElement('p');
        title.className = 'peak-detail-list-item__title';
        title.textContent = String(comment.display_name || 'Climber');
        heading.appendChild(title);
    }

    const meta = document.createElement('time');
    meta.className = 'peak-detail-list-item__meta';
    meta.setAttribute('data-timestamp', String(comment.created_at || new Date().toISOString()));
    meta.textContent = timeAgo(comment.created_at || new Date().toISOString());
    heading.appendChild(meta);
    header.appendChild(heading);

    if (comment.can_delete && comment.id !== undefined && comment.id !== null) {
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'button is-text peak-detail-comment-delete';
        deleteButton.setAttribute('data-comment-delete', '');
        deleteButton.setAttribute('data-comment-id', String(comment.id));
        deleteButton.textContent = 'Delete';
        header.appendChild(deleteButton);
    }

    const copy = document.createElement('p');
    copy.className = 'peak-detail-list-item__copy';
    copy.textContent = String(comment.comment_text || '');

    body.appendChild(header);
    body.appendChild(copy);
    layout.appendChild(body);
    article.appendChild(layout);
    list.insertBefore(article, list.firstChild);
    refreshTimeAgo(article);
    syncPeakCommentEmptyState(section);
}

function buildUserAvatarNode(record, size) {
    const avatar = document.createElement('span');
    avatar.className = 'user-avatar';
    avatar.style.setProperty('--user-avatar-size', String(size || 32) + 'px');

    const avatarUrl = String(record && record.avatar_url ? record.avatar_url : '').trim();
    if (avatarUrl) {
        const image = document.createElement('img');
        image.className = 'user-avatar__image';
        image.src = avatarUrl;
        image.alt = String(record && record.display_name ? record.display_name : 'Climber') + ' avatar';
        image.onerror = function() {
            image.hidden = true;
            if (icon) {
                icon.hidden = false;
            }
        };
        avatar.appendChild(image);

        const icon = document.createElement('span');
        icon.className = 'icon user-avatar__icon';
        icon.hidden = true;
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<i class="fas fa-user-circle"></i>';
        avatar.appendChild(icon);
        return avatar;
    }

    const fallbackIcon = document.createElement('span');
    fallbackIcon.className = 'icon user-avatar__icon';
    fallbackIcon.setAttribute('aria-hidden', 'true');
    fallbackIcon.innerHTML = '<i class="fas fa-user-circle"></i>';
    avatar.appendChild(fallbackIcon);
    return avatar;
}

function openPeakLogForm(panel, form) {
    if (!panel || !form) {
        return;
    }

    panel.classList.add('is-log-form-open');
    setPeakLogFormError(panel, '');
    initializeClimbFormValidation(form);

    const dateInput = form.querySelector('[data-peak-log-date]');
    if (dateInput && !dateInput.value) {
        dateInput.value = getTodayDateValueLocal();
    }

    window.requestAnimationFrame(function() {
        if (dateInput) {
            dateInput.focus();
        }
    });
}

function closePeakLogForm(panel, form, reset) {
    if (!panel || !form) {
        return;
    }

    panel.classList.remove('is-log-form-open');
    setPeakLogFormError(panel, '');

    if (reset) {
        resetPeakLogForm(form);
    }
}

function resetPeakLogForm(form) {
    if (!form) {
        return;
    }

    form.reset();
    clearFormFieldErrors(form);
    const dateInput = form.querySelector('[data-peak-log-date]');
    if (dateInput) {
        dateInput.value = getTodayDateValueLocal();
        dateInput.setAttribute('max', getTodayDateComparable());
    }

    setPeakLogStarRating(form, 0);
    syncPeakLogNotesCounter(form);
    syncPeakLogPhotoSummary(form);
    togglePeakLogFormBusy(form, false);
}

function togglePeakLogFormBusy(form, isBusy) {
    if (!form) {
        return;
    }

    form.querySelectorAll('input, select, textarea, button').forEach(function(control) {
        control.disabled = Boolean(isBusy);
    });
}

function setPeakLogFormError(panel, message) {
    const errorElement = panel ? panel.querySelector('[data-peak-log-form-error]') : null;
    if (!errorElement) {
        return;
    }

    errorElement.textContent = String(message || '').trim();
}

function syncPeakLogNotesCounter(form) {
    if (!form) {
        return;
    }

    const notesInput = form.querySelector('[data-peak-log-notes]');
    const counter = form.querySelector('[data-peak-log-notes-counter]');
    if (!notesInput || !counter) {
        return;
    }

    const currentLength = String(notesInput.value || '').length;
    const maxLength = Number(notesInput.getAttribute('maxlength') || 500);
    counter.textContent = currentLength + ' / ' + maxLength;
    counter.classList.toggle('is-near-limit', currentLength >= 480);
}

function syncPeakLogPhotoSummary(form) {
    if (!form) {
        return;
    }

    const photoInput = form.querySelector('[data-peak-log-photos]');
    const summary = form.querySelector('[data-peak-log-photo-summary]');
    if (!photoInput || !summary) {
        return;
    }

    const photoCount = photoInput.files ? photoInput.files.length : 0;
    summary.textContent = photoCount
        ? photoCount + (photoCount === 1 ? ' photo selected.' : ' photos selected.')
        : 'No photos selected.';
}

function validatePeakLogPhotos(fileList) {
    const files = Array.from(fileList || []);
    const maxFiles = 3;
    const maxSizeBytes = 5 * 1024 * 1024;

    if (files.length > maxFiles) {
        return 'You can upload up to 3 photos.';
    }

    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (!String(file.type || '').toLowerCase().startsWith('image/')) {
            return 'Please upload image files only.';
        }
        if (Number(file.size || 0) > maxSizeBytes) {
            return 'Each photo must be 5MB or smaller.';
        }
    }

    return '';
}

function setPeakLogStarRating(form, value) {
    if (!form) {
        return;
    }

    const normalizedValue = Number.isFinite(value) ? Math.max(0, Math.min(5, value)) : 0;
    const ratingInput = form.querySelector('[data-peak-star-rating-input]');
    const ratingLabel = form.querySelector('[data-peak-log-stars-label]');
    const starButtons = form.querySelectorAll('[data-peak-star-value]');

    if (ratingInput) {
        ratingInput.value = normalizedValue ? String(normalizedValue) : '';
        clearFieldError(ratingInput);
    }

    starButtons.forEach(function(starButton) {
        const starValue = Number(starButton.getAttribute('data-peak-star-value') || 0);
        const isActive = starValue <= normalizedValue && normalizedValue > 0;
        starButton.classList.toggle('is-active', isActive);
        starButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (ratingLabel) {
        ratingLabel.textContent = normalizedValue ? (normalizedValue + ' / 5') : 'Tap to rate';
    }
}

function ensureSiteToastContainer() {
    let container = document.querySelector('[data-toast-container]');
    if (container) {
        return container;
    }

    container = document.createElement('div');
    container.className = 'site-toast-container';
    container.setAttribute('data-toast-container', '');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'false');
    document.body.appendChild(container);
    return container;
}

function showToast(message, type) {
    const normalizedMessage = String(message || '').trim();
    if (!normalizedMessage) {
        return null;
    }

    const normalizedType = TOAST_META[type] ? type : 'success';
    const toastMeta = TOAST_META[normalizedType];
    const container = ensureSiteToastContainer();
    const toast = document.createElement('div');
    const icon = document.createElement('span');
    const body = document.createElement('div');
    const label = document.createElement('span');
    const copy = document.createElement('div');
    const dismissButton = document.createElement('button');

    toast.className = 'site-toast site-toast--' + normalizedType;
    toast.setAttribute('role', normalizedType === 'error' ? 'alert' : 'status');

    icon.className = 'site-toast__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<i class="fas ' + toastMeta.icon + '"></i>';

    body.className = 'site-toast__body';
    label.className = 'site-toast__label';
    label.textContent = toastMeta.label;
    copy.className = 'site-toast__message';
    copy.textContent = normalizedMessage;
    body.appendChild(label);
    body.appendChild(copy);

    dismissButton.type = 'button';
    dismissButton.className = 'site-toast__dismiss';
    dismissButton.setAttribute('aria-label', 'Dismiss notification');
    dismissButton.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i>';

    toast.appendChild(icon);
    toast.appendChild(body);
    toast.appendChild(dismissButton);
    container.appendChild(toast);

    let isClosed = false;
    let removalTimer = 0;
    let dismissTimer = 0;

    const closeToast = function() {
        if (isClosed) {
            return;
        }

        isClosed = true;
        window.clearTimeout(dismissTimer);
        toast.classList.remove('is-visible');
        toast.classList.add('is-leaving');

        removalTimer = window.setTimeout(function() {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 240);
    };

    dismissButton.addEventListener('click', function() {
        window.clearTimeout(removalTimer);
        closeToast();
    });

    window.requestAnimationFrame(function() {
        toast.classList.add('is-visible');
    });

    dismissTimer = window.setTimeout(closeToast, 4000);
    return toast;
}

function showSiteToast(message, type) {
    return showToast(message, type || 'success');
}
window.applyFieldErrors = applyFieldErrors;
window.buildRequestError = buildRequestError;
window.clearFieldError = clearFieldError;
window.clearFormFieldErrors = clearFormFieldErrors;
window.debounce = debounce;
window.deleteJsonRequest = deleteJsonRequest;
window.escapeHtml = escapeHtml;
window.formatNumber = formatNumber;
window.getTodayDateValueLocal = getTodayDateValueLocal;
window.getPeakStatusMarkupFragment = getPeakStatusMarkupFragment;
window.normalizePeakStatusValue = normalizePeakStatusValue;
window.postFormDataRequest = postFormDataRequest;
window.postJsonRequest = postJsonRequest;
window.putJsonRequest = putJsonRequest;
window.refreshTimeAgo = refreshTimeAgo;
window.setButtonLoading = setButtonLoading;
window.setFieldError = setFieldError;
window.setLoadingRegion = setLoadingRegion;
window.showSiteToast = showSiteToast;
window.showToast = showToast;
window.timeAgo = timeAgo;
