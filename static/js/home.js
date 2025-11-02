document.addEventListener('DOMContentLoaded', function() {
    initDashboardClimbModal();
});

function initDashboardClimbModal() {
    const modal = document.querySelector('[data-dashboard-climb-modal]');
    const activityFeed = document.querySelector('[data-dashboard-activity-feed]');
    syncDashboardActivitySpacing(activityFeed);
    if (!modal) {
        return;
    }

    const state = {
        modal: modal,
        peaks: Array.isArray(window.dashboardPeakSearchData) ? window.dashboardPeakSearchData.slice() : [],
        selectedPeak: null,
        searchTimer: null
    };

    const searchInput = modal.querySelector('[data-dashboard-peak-search]');
    const results = modal.querySelector('[data-dashboard-search-results]');
    const feedback = modal.querySelector('[data-dashboard-search-feedback]');
    const selectedPeakPanel = modal.querySelector('[data-dashboard-selected-peak]');
    const selectedName = modal.querySelector('[data-dashboard-selected-name]');
    const selectedMeta = modal.querySelector('[data-dashboard-selected-meta]');
    const form = modal.querySelector('[data-dashboard-climb-form]');
    const selectedPeakInput = modal.querySelector('[data-dashboard-selected-peak-id]');
    const errorElement = modal.querySelector('[data-dashboard-climb-error]');
    const notesInput = modal.querySelector('[data-peak-log-notes]');
    const photoInput = modal.querySelector('[data-peak-log-photos]');

    if (form && typeof window.initializeClimbFormValidation === 'function') {
        window.initializeClimbFormValidation(form);
    }

    document.querySelectorAll('[data-dashboard-open-climb-modal]').forEach(function(button) {
        button.addEventListener('click', function() {
            openDashboardClimbModal(state);
        });
    });

    modal.querySelectorAll('[data-dashboard-close-climb-modal]').forEach(function(button) {
        button.addEventListener('click', function() {
            closeDashboardClimbModal(state);
        });
    });

    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && modal.classList.contains('is-active')) {
            closeDashboardClimbModal(state);
        }
    });

    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const query = String(searchInput.value || '').trim();

            if (state.selectedPeak && query.toLowerCase() !== String(state.selectedPeak.name || '').toLowerCase()) {
                clearSelectedDashboardPeak(state);
            }

            if (state.searchTimer) {
                window.clearTimeout(state.searchTimer);
            }

            state.searchTimer = window.setTimeout(function() {
                renderDashboardPeakResults(state, query);
            }, 180);
        });

        searchInput.addEventListener('keydown', function(event) {
            if (event.key !== 'Enter') {
                return;
            }

            const firstResultButton = results ? results.querySelector('[data-dashboard-result-peak-id]') : null;
            if (!firstResultButton) {
                return;
            }

            event.preventDefault();
            const peakId = Number(firstResultButton.getAttribute('data-dashboard-result-peak-id') || 0);
            const peak = findDashboardPeakById(state, peakId);
            if (peak) {
                selectDashboardPeak(state, peak);
            }
        });
    }

    if (results) {
        results.addEventListener('click', function(event) {
            const resultButton = event.target.closest('[data-dashboard-result-peak-id]');
            if (!resultButton) {
                return;
            }

            const peakId = Number(resultButton.getAttribute('data-dashboard-result-peak-id') || 0);
            const peak = findDashboardPeakById(state, peakId);
            if (peak) {
                selectDashboardPeak(state, peak);
            }
        });
    }

    const clearSelectedButton = modal.querySelector('[data-dashboard-clear-selected-peak]');
    if (clearSelectedButton) {
        clearSelectedButton.addEventListener('click', function() {
            clearSelectedDashboardPeak(state, true);
            if (searchInput) {
                searchInput.focus();
            }
        });
    }

    if (notesInput) {
        notesInput.addEventListener('input', function() {
            syncDashboardNotesCounter(form);
            clearDashboardFieldError(notesInput);
            setDashboardClimbError(errorElement, '');
        });
    }

    if (photoInput) {
        photoInput.addEventListener('change', function() {
            const validationMessage = validateDashboardPhotos(photoInput.files);
            clearDashboardFieldError(photoInput);
            if (validationMessage) {
                photoInput.value = '';
                syncDashboardPhotoSummary(form);
                setDashboardFieldError(photoInput, validationMessage);
                setDashboardClimbError(errorElement, validationMessage);
                return;
            }

            setDashboardClimbError(errorElement, '');
            syncDashboardPhotoSummary(form);
        });
    }

    modal.addEventListener('click', function(event) {
        const starButton = event.target.closest('[data-peak-star-value]');
        if (!starButton || !form) {
            return;
        }

        event.preventDefault();
        setDashboardStarRating(form, Number(starButton.getAttribute('data-peak-star-value') || 0));
    });

    if (form) {
        form.addEventListener('submit', async function(event) {
            event.preventDefault();

            if (!state.selectedPeak || !selectedPeakInput || !selectedPeakInput.value) {
                setDashboardClimbError(errorElement, 'Please choose a peak before logging your climb.');
                if (searchInput) {
                    searchInput.focus();
                }
                return;
            }

            const dateInput = modal.querySelector('[data-dashboard-climb-date]');
            const submitButton = modal.querySelector('[data-dashboard-climb-submit]');
            const validation = validateDashboardClimbForm(form);
            if (!validation.isValid) {
                setDashboardClimbError(errorElement, getDashboardFirstFieldMessage(validation.fieldErrors));
                return;
            }

            setDashboardClimbError(errorElement, '');
            if (submitButton) {
                if (typeof window.setButtonLoading === 'function') {
                    window.setButtonLoading(submitButton, true);
                } else {
                    submitButton.classList.add('is-loading');
                }
            }
            toggleDashboardFormBusy(form, true);
            if (typeof window.setLoadingRegion === 'function') {
                window.setLoadingRegion(form, true, { message: 'Logging your summit...' });
            }

            try {
                const formData = new FormData(form);
                formData.set('peak_id', String(state.selectedPeak.id));

                const result = await postDashboardFormData('/api/log-climb', formData);
                const selectedPeak = state.selectedPeak;

                if (result && result.user_status === 'climbed') {
                    removeDashboardPeakFromSearch(state, selectedPeak.id);
                }

                if (result && result.removed_from_bucket_list) {
                    removeDashboardBucketPreviewItem(selectedPeak.id);
                }

                if (!result.already_climbed) {
                    prependDashboardActivity({
                        label: 'Climbed',
                        message: 'You reached the summit!',
                        peakName: selectedPeak.name,
                        tagClass: 'is-success',
                        timestamp: result && result.climb
                            ? (result.climb.date_climbed || result.climb.climbed_at || result.climb.created_at || new Date().toISOString())
                            : new Date().toISOString()
                    });
                    showDashboardToast('Summit logged successfully.', 'success');
                } else {
                    showDashboardToast('This summit is already logged.', 'warning');
                }

                if (result.warning) {
                    window.setTimeout(function() {
                        showDashboardToast(result.warning, 'warning');
                    }, 320);
                }

                closeDashboardClimbModal(state);
            } catch (error) {
                applyDashboardFieldErrors(form, error && error.fields ? error.fields : {});
                setDashboardClimbError(errorElement, error.message || 'We could not save that climb right now.');
                showDashboardToast(error.message || 'We could not save that climb right now.', 'error');
            } finally {
                toggleDashboardFormBusy(form, false);
                if (typeof window.setLoadingRegion === 'function') {
                    window.setLoadingRegion(form, false);
                }
                if (submitButton) {
                    if (typeof window.setButtonLoading === 'function') {
                        window.setButtonLoading(submitButton, false);
                    } else {
                        submitButton.classList.remove('is-loading');
                    }
                }
            }
        });
    }

    updateDashboardSelectedPeak(state, {
        feedback: feedback,
        form: form,
        results: results,
        searchInput: searchInput,
        selectedMeta: selectedMeta,
        selectedName: selectedName,
        selectedPeakInput: selectedPeakInput,
        selectedPeakPanel: selectedPeakPanel
    });
    syncDashboardNotesCounter(form);
    syncDashboardPhotoSummary(form);
    setDashboardStarRating(form, 0);
}

function openDashboardClimbModal(state) {
    if (!state || !state.modal) {
        return;
    }

    resetDashboardClimbModal(state);
    state.modal.classList.add('is-active');
    state.modal.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('is-clipped');
    document.body.classList.add('is-clipped');

    const searchInput = state.modal.querySelector('[data-dashboard-peak-search]');
    if (searchInput) {
        searchInput.focus();
    }
}

function closeDashboardClimbModal(state) {
    if (!state || !state.modal) {
        return;
    }

    state.modal.classList.remove('is-active');
    state.modal.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('is-clipped');
    document.body.classList.remove('is-clipped');
    resetDashboardClimbModal(state);
}

function resetDashboardClimbModal(state) {
    if (!state || !state.modal) {
        return;
    }

    if (state.searchTimer) {
        window.clearTimeout(state.searchTimer);
        state.searchTimer = null;
    }

    state.selectedPeak = null;

    const searchInput = state.modal.querySelector('[data-dashboard-peak-search]');
    const results = state.modal.querySelector('[data-dashboard-search-results]');
    const feedback = state.modal.querySelector('[data-dashboard-search-feedback]');
    const selectedPeakPanel = state.modal.querySelector('[data-dashboard-selected-peak]');
    const form = state.modal.querySelector('[data-dashboard-climb-form]');
    const selectedPeakInput = state.modal.querySelector('[data-dashboard-selected-peak-id]');
    const errorElement = state.modal.querySelector('[data-dashboard-climb-error]');

    if (searchInput) {
        searchInput.value = '';
    }
    if (results) {
        results.innerHTML = '';
        results.hidden = true;
        results.classList.add('is-hidden');
    }
    if (feedback) {
        feedback.hidden = true;
        feedback.classList.add('is-hidden');
    }
    if (selectedPeakPanel) {
        selectedPeakPanel.hidden = true;
        selectedPeakPanel.classList.add('is-hidden');
    }
    if (selectedPeakInput) {
        selectedPeakInput.value = '';
    }
    if (form) {
        form.reset();
        if (typeof window.clearFormFieldErrors === 'function') {
            window.clearFormFieldErrors(form);
        }
        form.hidden = true;
        form.classList.add('is-hidden');
        toggleDashboardFormBusy(form, false);
        setDashboardStarRating(form, 0);
        syncDashboardNotesCounter(form);
        syncDashboardPhotoSummary(form);
        const dateInput = form.querySelector('[data-dashboard-climb-date]');
        if (dateInput) {
            dateInput.value = getDashboardTodayDate();
        }
    }
    setDashboardClimbError(errorElement, '');
}

function renderDashboardPeakResults(state, query) {
    const modal = state ? state.modal : null;
    const results = modal ? modal.querySelector('[data-dashboard-search-results]') : null;
    const feedback = modal ? modal.querySelector('[data-dashboard-search-feedback]') : null;
    if (!results || !feedback) {
        return;
    }

    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) {
        results.innerHTML = '';
        results.hidden = true;
        results.classList.add('is-hidden');
        feedback.hidden = true;
        feedback.classList.add('is-hidden');
        return;
    }

    const matchingPeaks = state.peaks
        .filter(function(peak) {
            return String(peak.name || '').toLowerCase().includes(normalizedQuery);
        })
        .sort(function(left, right) {
            const leftName = String(left.name || '').toLowerCase();
            const rightName = String(right.name || '').toLowerCase();
            const leftStarts = leftName.startsWith(normalizedQuery) ? 0 : 1;
            const rightStarts = rightName.startsWith(normalizedQuery) ? 0 : 1;
            if (leftStarts !== rightStarts) {
                return leftStarts - rightStarts;
            }
            return leftName.localeCompare(rightName);
        })
        .slice(0, 8);

    if (!matchingPeaks.length) {
        results.innerHTML = '';
        results.hidden = true;
        results.classList.add('is-hidden');
        feedback.hidden = false;
        feedback.classList.remove('is-hidden');
        return;
    }

    feedback.hidden = true;
    feedback.classList.add('is-hidden');
    results.innerHTML = matchingPeaks.map(function(peak) {
        const heightLabel = peak.height_m ? peak.height_m + 'm' : 'Height unknown';
        const countyLabel = peak.county ? ' · ' + peak.county : '';
        return (
            '<button type="button" class="dashboard-add-climb-modal__result" data-dashboard-result-peak-id="' + escapeDashboardHtml(peak.id) + '">' +
                '<div>' +
                    '<p class="dashboard-add-climb-modal__result-name">' + escapeDashboardHtml(peak.name || 'Unnamed Peak') + '</p>' +
                    '<p class="dashboard-add-climb-modal__result-meta">' + escapeDashboardHtml(heightLabel + countyLabel) + '</p>' +
                '</div>' +
                '<span class="icon has-text-success" aria-hidden="true"><i class="fas fa-arrow-right"></i></span>' +
            '</button>'
        );
    }).join('');
    results.hidden = false;
    results.classList.remove('is-hidden');
}

function selectDashboardPeak(state, peak) {
    if (!state || !peak) {
        return;
    }

    state.selectedPeak = peak;
    updateDashboardSelectedPeak(state, {
        feedback: state.modal.querySelector('[data-dashboard-search-feedback]'),
        form: state.modal.querySelector('[data-dashboard-climb-form]'),
        results: state.modal.querySelector('[data-dashboard-search-results]'),
        searchInput: state.modal.querySelector('[data-dashboard-peak-search]'),
        selectedMeta: state.modal.querySelector('[data-dashboard-selected-meta]'),
        selectedName: state.modal.querySelector('[data-dashboard-selected-name]'),
        selectedPeakInput: state.modal.querySelector('[data-dashboard-selected-peak-id]'),
        selectedPeakPanel: state.modal.querySelector('[data-dashboard-selected-peak]')
    });

    const dateInput = state.modal.querySelector('[data-dashboard-climb-date]');
    if (dateInput && !dateInput.value) {
        dateInput.value = getDashboardTodayDate();
    }

    if (dateInput) {
        dateInput.focus();
    }
}

function clearSelectedDashboardPeak(state, shouldClearSearch) {
    if (!state || !state.modal) {
        return;
    }

    state.selectedPeak = null;
    const searchInput = state.modal.querySelector('[data-dashboard-peak-search]');
    const form = state.modal.querySelector('[data-dashboard-climb-form]');
    const errorElement = state.modal.querySelector('[data-dashboard-climb-error]');
    if (shouldClearSearch && searchInput) {
        searchInput.value = '';
    }

    if (form) {
        form.reset();
        if (typeof window.clearFormFieldErrors === 'function') {
            window.clearFormFieldErrors(form);
        }
        setDashboardStarRating(form, 0);
        syncDashboardNotesCounter(form);
        syncDashboardPhotoSummary(form);
        const dateInput = form.querySelector('[data-dashboard-climb-date]');
        if (dateInput) {
            dateInput.value = getDashboardTodayDate();
        }
    }
    setDashboardClimbError(errorElement, '');

    updateDashboardSelectedPeak(state, {
        feedback: state.modal.querySelector('[data-dashboard-search-feedback]'),
        form: form,
        results: state.modal.querySelector('[data-dashboard-search-results]'),
        searchInput: searchInput,
        selectedMeta: state.modal.querySelector('[data-dashboard-selected-meta]'),
        selectedName: state.modal.querySelector('[data-dashboard-selected-name]'),
        selectedPeakInput: state.modal.querySelector('[data-dashboard-selected-peak-id]'),
        selectedPeakPanel: state.modal.querySelector('[data-dashboard-selected-peak]')
    });
}

function updateDashboardSelectedPeak(state, elements) {
    const selectedPeak = state ? state.selectedPeak : null;
    const selectedPeakPanel = elements ? elements.selectedPeakPanel : null;
    const selectedName = elements ? elements.selectedName : null;
    const selectedMeta = elements ? elements.selectedMeta : null;
    const selectedPeakInput = elements ? elements.selectedPeakInput : null;
    const form = elements ? elements.form : null;
    const searchInput = elements ? elements.searchInput : null;
    const results = elements ? elements.results : null;
    const feedback = elements ? elements.feedback : null;

    if (selectedPeak) {
        if (selectedName) {
            selectedName.textContent = String(selectedPeak.name || 'Unnamed Peak');
        }
        if (selectedMeta) {
            selectedMeta.textContent = buildDashboardPeakMeta(selectedPeak);
        }
        if (selectedPeakInput) {
            selectedPeakInput.value = String(selectedPeak.id || '');
        }
        if (selectedPeakPanel) {
            selectedPeakPanel.hidden = false;
            selectedPeakPanel.classList.remove('is-hidden');
        }
        if (form) {
            form.hidden = false;
            form.classList.remove('is-hidden');
        }
        if (searchInput) {
            searchInput.value = String(selectedPeak.name || '');
        }
        if (results) {
            results.hidden = true;
            results.classList.add('is-hidden');
            results.innerHTML = '';
        }
        if (feedback) {
            feedback.hidden = true;
            feedback.classList.add('is-hidden');
        }
        return;
    }

    if (selectedName) {
        selectedName.textContent = '';
    }
    if (selectedMeta) {
        selectedMeta.textContent = '';
    }
    if (selectedPeakInput) {
        selectedPeakInput.value = '';
    }
    if (selectedPeakPanel) {
        selectedPeakPanel.hidden = true;
        selectedPeakPanel.classList.add('is-hidden');
    }
    if (form) {
        form.hidden = true;
        form.classList.add('is-hidden');
    }
}

function prependDashboardActivity(activity) {
    const feed = document.querySelector('[data-dashboard-activity-feed]');
    if (!feed || !activity) {
        return;
    }

    const emptyState = feed.querySelector('[data-dashboard-activity-empty]');
    if (emptyState) {
        emptyState.hidden = true;
        emptyState.classList.add('is-hidden');
    }

    feed.insertAdjacentHTML('afterbegin', buildDashboardActivityMarkup(activity));
    if (typeof window.refreshTimeAgo === 'function') {
        const firstItem = feed.querySelector('[data-dashboard-activity-item]');
        if (firstItem) {
            window.refreshTimeAgo(firstItem);
        }
    }
    const items = Array.from(feed.querySelectorAll('[data-dashboard-activity-item]'));
    const limit = Number(feed.getAttribute('data-dashboard-activity-limit') || 4);
    items.slice(limit).forEach(function(item) {
        if (item.parentNode) {
            item.parentNode.removeChild(item);
        }
    });
    syncDashboardActivitySpacing(feed);
}

function buildDashboardActivityMarkup(activity) {
    const timestamp = activity && activity.timestamp ? String(activity.timestamp) : '';
    const relativeLabel = typeof window.timeAgo === 'function'
        ? window.timeAgo(timestamp || new Date().toISOString())
        : 'just now';

    return (
        '<div class="columns is-mobile dashboard-timeline__item" data-dashboard-activity-item>' +
            '<div class="column is-narrow dashboard-timeline__marker">' +
                '<span class="tag ' + escapeDashboardHtml(activity.tagClass || 'is-success') + ' dashboard-timeline__tag">' +
                    escapeDashboardHtml(activity.label || 'Climbed') +
                '</span>' +
            '</div>' +
            '<div class="column dashboard-timeline__content">' +
                '<span class="has-text-weight-bold">' + escapeDashboardHtml(activity.peakName || 'Peak') + '</span> - ' +
                escapeDashboardHtml(activity.message || 'You reached the summit!') +
                '<time class="has-text-grey is-size-7 ml-2 dashboard-timeline__time" data-timestamp="' + escapeDashboardHtml(timestamp || new Date().toISOString()) + '">' +
                    escapeDashboardHtml(relativeLabel) +
                '</time>' +
            '</div>' +
        '</div>'
    );
}

function syncDashboardActivitySpacing(feed) {
    if (!feed) {
        return;
    }

    const items = Array.from(feed.querySelectorAll('[data-dashboard-activity-item]'));
    items.forEach(function(item, index) {
        item.classList.toggle('mb-3', index < items.length - 1);
    });
}

function removeDashboardPeakFromSearch(state, peakId) {
    if (!state) {
        return;
    }

    const normalizedPeakId = String(peakId || '').trim();
    state.peaks = state.peaks.filter(function(peak) {
        return String(peak.id || '').trim() !== normalizedPeakId;
    });
}

function removeDashboardBucketPreviewItem(peakId) {
    const normalizedPeakId = String(peakId || '').trim();
    if (!normalizedPeakId) {
        return;
    }

    const bucketItem = document.querySelector('[data-dashboard-bucket-item][data-peak-id="' + normalizedPeakId + '"]');
    if (bucketItem && bucketItem.parentNode) {
        bucketItem.parentNode.removeChild(bucketItem);
    }

    const remainingItems = document.querySelectorAll('[data-dashboard-bucket-item]').length;
    syncDashboardBucketSpacing();
    const emptyState = document.querySelector('[data-dashboard-bucket-empty]');
    if (!emptyState) {
        return;
    }

    if (!remainingItems) {
        emptyState.hidden = false;
        emptyState.classList.remove('is-hidden');
    }
}

function syncDashboardBucketSpacing() {
    const items = Array.from(document.querySelectorAll('[data-dashboard-bucket-item]'));
    items.forEach(function(item, index) {
        item.classList.toggle('mb-3', index < items.length - 1);
    });
}

function setDashboardClimbError(errorElement, message) {
    if (!errorElement) {
        return;
    }

    errorElement.textContent = String(message || '').trim();
}

function toggleDashboardFormBusy(form, isBusy) {
    if (typeof window.togglePeakLogFormBusy === 'function') {
        window.togglePeakLogFormBusy(form, isBusy);
        return;
    }

    if (!form) {
        return;
    }

    form.querySelectorAll('input, select, textarea, button').forEach(function(control) {
        control.disabled = Boolean(isBusy);
    });
}

function syncDashboardNotesCounter(form) {
    if (typeof window.syncPeakLogNotesCounter === 'function') {
        window.syncPeakLogNotesCounter(form);
    }
}

function syncDashboardPhotoSummary(form) {
    if (typeof window.syncPeakLogPhotoSummary === 'function') {
        window.syncPeakLogPhotoSummary(form);
    }
}

function validateDashboardPhotos(fileList) {
    if (typeof window.validatePeakLogPhotos === 'function') {
        return window.validatePeakLogPhotos(fileList);
    }
    return '';
}

function validateDashboardClimbForm(form) {
    if (typeof window.validateClimbFormClient === 'function') {
        return window.validateClimbFormClient(form);
    }
    return { fieldErrors: {}, isValid: true };
}

function setDashboardStarRating(form, value) {
    if (typeof window.setPeakLogStarRating === 'function') {
        window.setPeakLogStarRating(form, value);
    }
}

function applyDashboardFieldErrors(form, fieldErrors) {
    if (typeof window.applyFieldErrors === 'function') {
        window.applyFieldErrors(form, fieldErrors, {
            date_climbed: '[data-dashboard-climb-date]',
            notes: '[data-peak-log-notes]',
            difficulty_rating: '[data-peak-star-rating-input]',
            photos: '[data-peak-log-photos]'
        });
    }
}

function clearDashboardFieldError(control) {
    if (typeof window.clearFieldError === 'function') {
        window.clearFieldError(control);
    }
}

function setDashboardFieldError(control, message) {
    if (typeof window.setFieldError === 'function') {
        window.setFieldError(control, message);
    }
}

function getDashboardFirstFieldMessage(fieldErrors) {
    if (!fieldErrors || typeof fieldErrors !== 'object') {
        return '';
    }

    const firstMessage = Object.values(fieldErrors).find(function(message) {
        return String(message || '').trim();
    });
    return String(firstMessage || '').trim();
}

async function postDashboardFormData(url, formData) {
    if (typeof window.postFormDataRequest === 'function') {
        return window.postFormDataRequest(url, formData);
    }

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
        if (typeof window.buildRequestError === 'function') {
            throw window.buildRequestError(result, 'Something went wrong.');
        }
        throw new Error(result.message || result.error || 'Something went wrong.');
    }

    return result;
}

function getDashboardTodayDate() {
    if (typeof window.getTodayDateValueLocal === 'function') {
        return window.getTodayDateValueLocal();
    }

    const now = new Date();
    const localTime = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    return localTime.toISOString().slice(0, 10);
}

function showDashboardToast(message, type) {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    }
}

function buildDashboardPeakMeta(peak) {
    const parts = [];
    if (peak && peak.height_m) {
        parts.push(String(peak.height_m) + 'm');
    }
    if (peak && peak.county) {
        parts.push(String(peak.county));
    }
    if (peak && peak.province) {
        parts.push(String(peak.province));
    }
    return parts.join(' · ');
}

function findDashboardPeakById(state, peakId) {
    const normalizedPeakId = String(peakId || '').trim();
    return state.peaks.find(function(peak) {
        return String(peak.id || '').trim() === normalizedPeakId;
    }) || null;
}

function escapeDashboardHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
