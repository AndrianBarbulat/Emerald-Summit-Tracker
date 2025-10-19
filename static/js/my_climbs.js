const MY_CLIMB_WEATHER_ICONS = {
    sunny: 'fa-sun',
    cloudy: 'fa-cloud-sun',
    overcast: 'fa-cloud',
    rainy: 'fa-cloud-rain',
    windy: 'fa-wind',
    snowy: 'fa-snowflake',
    foggy: 'fa-smog',
    mixed: 'fa-cloud-sun-rain'
};

document.addEventListener('DOMContentLoaded', function() {
    initMyClimbsTable();
    initMyClimbsMap();
});

function initMyClimbsTable() {
    const table = document.querySelector('[data-my-climbs-table]');
    if (!table) {
        return;
    }

    const tablePanel = document.querySelector('[data-my-climbs-table-panel]');
    const emptyState = document.querySelector('[data-my-climbs-empty-state]');

    table.querySelectorAll('[data-my-climb-edit-form]').forEach(function(form) {
        captureSavedClimbFormState(form);
        restoreSavedClimbFormState(form);
    });

    table.addEventListener('input', function(event) {
        if (event.target.closest('[data-peak-log-notes]')) {
            syncMyClimbNotesCounter(event.target.closest('form'));
        }
    });

    table.addEventListener('click', function(event) {
        const starButton = event.target.closest('[data-peak-star-value]');
        if (starButton) {
            event.preventDefault();
            const form = starButton.closest('form');
            if (form) {
                setMyClimbStarRating(
                    form,
                    Number(starButton.getAttribute('data-peak-star-value') || 0)
                );
            }
            return;
        }

        const toggleButton = event.target.closest('[data-climb-toggle]');
        if (toggleButton) {
            event.preventDefault();
            const climbId = String(toggleButton.getAttribute('data-climb-toggle') || '').trim();
            if (!climbId) {
                return;
            }

            const detailRow = getClimbDetailRow(table, climbId);
            if (!detailRow) {
                return;
            }

            const shouldOpen = detailRow.hasAttribute('hidden');
            if (!shouldOpen) {
                closeAllClimbDetails(table);
                return;
            }

            openClimbDetail(table, climbId, 'view');
            return;
        }

        const actionButton = event.target.closest('[data-my-climb-action]');
        if (!actionButton) {
            return;
        }

        event.preventDefault();

        const detailRow = actionButton.closest('[data-climb-detail]');
        if (!detailRow) {
            return;
        }

        const climbId = String(detailRow.getAttribute('data-climb-detail') || '').trim();
        if (!climbId) {
            return;
        }

        const action = String(actionButton.getAttribute('data-my-climb-action') || '').trim();
        if (action === 'edit') {
            openClimbDetail(table, climbId, 'edit');
            focusMyClimbEditField(detailRow);
            return;
        }

        if (action === 'delete') {
            openClimbDetail(table, climbId, 'delete');
            return;
        }

        if (action === 'cancel-edit') {
            const form = detailRow.querySelector('[data-my-climb-edit-form]');
            if (form) {
                restoreSavedClimbFormState(form);
                setMyClimbFormError(form, '');
            }
            setClimbDetailMode(detailRow, 'view');
            return;
        }

        if (action === 'cancel-delete') {
            setClimbDetailMode(detailRow, 'view');
            return;
        }

        if (action === 'confirm-delete') {
            handleMyClimbDelete(table, detailRow, tablePanel, emptyState);
        }
    });

    table.addEventListener('submit', function(event) {
        const form = event.target.closest('[data-my-climb-edit-form]');
        if (!form) {
            return;
        }

        event.preventDefault();
        handleMyClimbEditSubmit(table, form, tablePanel, emptyState);
    });
}

async function handleMyClimbEditSubmit(table, form, tablePanel, emptyState) {
    const detailRow = form.closest('[data-climb-detail]');
    const summaryRow = detailRow ? getClimbSummaryRow(table, detailRow.getAttribute('data-climb-detail')) : null;
    if (!detailRow || !summaryRow) {
        return;
    }

    const climbId = String(summaryRow.getAttribute('data-climb-id') || '').trim();
    const dateInput = form.querySelector('[data-my-climb-date]');
    const weatherSelect = form.querySelector('[data-my-climb-weather]');
    const notesInput = form.querySelector('[data-peak-log-notes]');
    const difficultyInput = form.querySelector('[data-peak-star-rating-input]');

    const payload = {
        date_climbed: String(dateInput ? dateInput.value : '').trim(),
        notes: String(notesInput ? notesInput.value : '').trim(),
        weather: String(weatherSelect ? weatherSelect.value : '').trim(),
        difficulty_rating: String(difficultyInput ? difficultyInput.value : '').trim()
    };

    if (!payload.date_climbed) {
        setMyClimbFormError(form, 'Please choose the date you climbed this peak.');
        if (dateInput) {
            dateInput.focus();
        }
        return;
    }

    if (payload.notes.length > 500) {
        setMyClimbFormError(form, 'Notes must be 500 characters or fewer.');
        if (notesInput) {
            notesInput.focus();
        }
        return;
    }

    setMyClimbFormError(form, '');
    toggleMyClimbEditBusy(form, true);

    try {
        const result = await putJsonRequest('/api/climb/' + encodeURIComponent(climbId), payload);
        const updatedClimb = buildUpdatedClimbFromResponse(summaryRow, result, payload);
        updateMyClimbRow(summaryRow, detailRow, form, updatedClimb);
        resortMyClimbRows(table);
        updateMyClimbStats(table, tablePanel, emptyState);
        setClimbDetailMode(detailRow, 'view');
        showMyClimbToast('Climb updated.', 'success');
    } catch (error) {
        const message = error && error.message ? error.message : 'We could not save that climb.';
        setMyClimbFormError(form, message);
        showMyClimbToast(message, 'error');
    } finally {
        toggleMyClimbEditBusy(form, false);
    }
}

async function handleMyClimbDelete(table, detailRow, tablePanel, emptyState) {
    const climbId = String(detailRow.getAttribute('data-climb-detail') || '').trim();
    const summaryRow = getClimbSummaryRow(table, climbId);
    const deletePanel = detailRow.querySelector('[data-climb-delete-panel]');
    const confirmButton = deletePanel ? deletePanel.querySelector('[data-my-climb-action="confirm-delete"]') : null;

    if (!climbId || !summaryRow || !deletePanel || !confirmButton) {
        return;
    }

    toggleMyClimbDeleteBusy(deletePanel, true);

    try {
        const result = await deleteJsonRequest('/api/climb/' + encodeURIComponent(climbId));
        const toggleButton = table.querySelector('[data-climb-toggle="' + escapeAttributeValue(climbId) + '"]');
        if (toggleButton) {
            toggleButton.setAttribute('aria-expanded', 'false');
        }

        summaryRow.classList.add('is-removing');
        detailRow.hidden = false;
        detailRow.classList.remove('is-hidden');
        detailRow.classList.add('is-removing');

        window.setTimeout(function() {
            if (summaryRow.parentNode) {
                summaryRow.parentNode.removeChild(summaryRow);
            }
            if (detailRow.parentNode) {
                detailRow.parentNode.removeChild(detailRow);
            }

            updateMyClimbStats(table, tablePanel, emptyState);
        }, 220);

        showMyClimbToast('Climb deleted.', 'success');
        if (result && result.warning) {
            showMyClimbToast(result.warning, 'warning');
        }
    } catch (error) {
        const message = error && error.message ? error.message : 'We could not delete that climb.';
        showMyClimbToast(message, 'error');
    } finally {
        window.setTimeout(function() {
            toggleMyClimbDeleteBusy(deletePanel, false);
        }, 220);
    }
}

function openClimbDetail(table, climbId, mode) {
    const detailRow = getClimbDetailRow(table, climbId);
    const toggleButton = table.querySelector('[data-climb-toggle="' + escapeAttributeValue(climbId) + '"]');
    if (!detailRow) {
        return;
    }

    closeAllClimbDetails(table);

    detailRow.hidden = false;
    detailRow.classList.remove('is-hidden');
    setClimbDetailMode(detailRow, mode || 'view');

    if (toggleButton) {
        toggleButton.setAttribute('aria-expanded', 'true');
    }
}

function closeAllClimbDetails(table) {
    table.querySelectorAll('[data-climb-detail]').forEach(function(detailRow) {
        const form = detailRow.querySelector('[data-my-climb-edit-form]');
        if (form) {
            restoreSavedClimbFormState(form);
            setMyClimbFormError(form, '');
        }
        detailRow.hidden = true;
        detailRow.classList.add('is-hidden');
        setClimbDetailMode(detailRow, 'view');
    });

    table.querySelectorAll('[data-climb-toggle]').forEach(function(toggleButton) {
        toggleButton.setAttribute('aria-expanded', 'false');
    });
}

function setClimbDetailMode(detailRow, mode) {
    const normalizedMode = mode === 'edit' || mode === 'delete' ? mode : 'view';
    const viewPanel = detailRow.querySelector('[data-climb-detail-view]');
    const editPanel = detailRow.querySelector('[data-climb-edit-panel]');
    const deletePanel = detailRow.querySelector('[data-climb-delete-panel]');

    togglePanelVisibility(viewPanel, normalizedMode === 'view');
    togglePanelVisibility(editPanel, normalizedMode === 'edit');
    togglePanelVisibility(deletePanel, normalizedMode === 'delete');
}

function togglePanelVisibility(panel, shouldShow) {
    if (!panel) {
        return;
    }

    panel.hidden = !shouldShow;
    panel.classList.toggle('is-hidden', !shouldShow);
}

function getClimbSummaryRow(table, climbId) {
    return table.querySelector('[data-climb-row="' + escapeAttributeValue(climbId) + '"]');
}

function getClimbDetailRow(table, climbId) {
    return table.querySelector('[data-climb-detail="' + escapeAttributeValue(climbId) + '"]');
}

function captureSavedClimbFormState(form) {
    const dateInput = form.querySelector('[data-my-climb-date]');
    const weatherSelect = form.querySelector('[data-my-climb-weather]');
    const notesInput = form.querySelector('[data-peak-log-notes]');
    const difficultyInput = form.querySelector('[data-peak-star-rating-input]');

    form.dataset.savedDate = String(dateInput ? dateInput.value : '').trim();
    form.dataset.savedWeather = String(weatherSelect ? weatherSelect.value : '').trim();
    form.dataset.savedNotes = String(notesInput ? notesInput.value : '');
    form.dataset.savedDifficulty = String(difficultyInput ? difficultyInput.value : '').trim();
}

function restoreSavedClimbFormState(form) {
    const dateInput = form.querySelector('[data-my-climb-date]');
    const weatherSelect = form.querySelector('[data-my-climb-weather]');
    const notesInput = form.querySelector('[data-peak-log-notes]');

    if (dateInput) {
        dateInput.value = String(form.dataset.savedDate || '').trim();
    }
    if (weatherSelect) {
        weatherSelect.value = String(form.dataset.savedWeather || '').trim();
    }
    if (notesInput) {
        notesInput.value = String(form.dataset.savedNotes || '');
    }

    setMyClimbStarRating(form, normalizeDifficultyValue(form.dataset.savedDifficulty));
    syncMyClimbNotesCounter(form);
}

function focusMyClimbEditField(detailRow) {
    const dateInput = detailRow.querySelector('[data-my-climb-date]');
    if (dateInput) {
        dateInput.focus();
    }
}

function buildUpdatedClimbFromResponse(summaryRow, result, payload) {
    const climb = result && result.climb && typeof result.climb === 'object'
        ? Object.assign({}, result.climb)
        : {};

    climb.id = climb.id || summaryRow.getAttribute('data-climb-id');
    climb.peak_id = climb.peak_id || summaryRow.getAttribute('data-peak-id');
    climb.date_climbed = payload.date_climbed;
    climb.notes = payload.notes;
    climb.weather = payload.weather;
    climb.difficulty_rating = payload.difficulty_rating;

    return climb;
}

function updateMyClimbRow(summaryRow, detailRow, form, climb) {
    const dateValue = String(climb.date_climbed || '').trim();
    const notesValue = String(climb.notes || '');
    const weatherValue = String(climb.weather || '').trim().toLowerCase();
    const difficultyValue = normalizeDifficultyValue(climb.difficulty_rating);
    const dateLabel = formatMyClimbDate(dateValue);
    const notesPreview = buildNotesPreview(notesValue);
    const dateCell = summaryRow.querySelector('[data-climb-cell="date"]');
    const heightCell = summaryRow.querySelector('[data-climb-cell="height"]');
    const difficultyCell = summaryRow.querySelector('[data-climb-cell="difficulty"]');
    const weatherCell = summaryRow.querySelector('[data-climb-cell="weather"]');
    const previewText = summaryRow.querySelector('[data-climb-preview-text]');
    const notesCopy = detailRow.querySelector('[data-climb-detail-notes]');
    const photoBlock = detailRow.querySelector('[data-climb-photo-block]');

    summaryRow.dataset.dateLabel = dateLabel;
    summaryRow.dataset.dateSort = dateValue || '';
    summaryRow.dataset.difficultyValue = difficultyValue ? String(difficultyValue) : '';

    if (dateCell) {
        dateCell.textContent = dateLabel;
    }

    if (heightCell && !String(heightCell.textContent || '').trim()) {
        heightCell.innerHTML = '<span class="has-text-grey">-</span>';
    }

    if (difficultyCell) {
        difficultyCell.innerHTML = renderDifficultyStarsMarkup(difficultyValue);
    }

    if (weatherCell) {
        weatherCell.innerHTML = renderWeatherCellMarkup(weatherValue);
    }

    if (previewText) {
        previewText.textContent = notesPreview;
    }

    if (notesCopy) {
        notesCopy.textContent = notesValue || 'No notes added yet.';
        notesCopy.classList.toggle('has-text-grey', !notesValue);
    }

    if (photoBlock) {
        photoBlock.hidden = false;
    }

    const dateInput = form.querySelector('[data-my-climb-date]');
    const weatherSelect = form.querySelector('[data-my-climb-weather]');
    const notesInput = form.querySelector('[data-peak-log-notes]');
    if (dateInput) {
        dateInput.value = dateValue;
    }
    if (weatherSelect) {
        weatherSelect.value = weatherValue;
    }
    if (notesInput) {
        notesInput.value = notesValue;
    }
    setMyClimbStarRating(form, difficultyValue);
    captureSavedClimbFormState(form);
    syncMyClimbNotesCounter(form);
}

function resortMyClimbRows(table) {
    const rowPairs = Array.from(table.querySelectorAll('[data-climb-row]')).map(function(summaryRow) {
        const climbId = String(summaryRow.getAttribute('data-climb-id') || '').trim();
        return {
            detailRow: getClimbDetailRow(table, climbId),
            summaryRow: summaryRow,
            sortValue: getSortableDateValue(summaryRow.getAttribute('data-date-sort'))
        };
    });

    rowPairs.sort(function(left, right) {
        return right.sortValue - left.sortValue;
    });

    rowPairs.forEach(function(pair) {
        table.appendChild(pair.summaryRow);
        if (pair.detailRow) {
            table.appendChild(pair.detailRow);
        }
    });
}

function updateMyClimbStats(table, tablePanel, emptyState) {
    const climbRows = Array.from(table.querySelectorAll('[data-climb-row]'));
    const totalClimbs = climbRows.length;
    const uniquePeakIds = new Set();
    let totalElevation = 0;
    let difficultyTotal = 0;
    let difficultyCount = 0;

    climbRows.forEach(function(summaryRow) {
        const peakId = String(summaryRow.getAttribute('data-peak-id') || '').trim();
        const heightValue = Number(summaryRow.getAttribute('data-height-m') || 0);
        const rawDifficultyValue = String(summaryRow.getAttribute('data-difficulty-value') || '').trim();

        if (peakId) {
            uniquePeakIds.add(peakId);
        }
        if (Number.isFinite(heightValue)) {
            totalElevation += heightValue;
        }
        if (rawDifficultyValue) {
            const difficultyValue = Number(rawDifficultyValue);
            if (Number.isFinite(difficultyValue) && difficultyValue > 0) {
                difficultyTotal += difficultyValue;
                difficultyCount += 1;
            }
        }
    });

    const avgDifficulty = difficultyCount ? (difficultyTotal / difficultyCount) : null;
    updateMyClimbStatValue('total-climbs', String(totalClimbs));
    updateMyClimbStatValue('unique-peaks', String(uniquePeakIds.size));
    updateMyClimbStatValue('total-elevation', formatInteger(totalElevation) + 'm');
    updateMyClimbDifficultyStat(avgDifficulty);

    const hasRows = totalClimbs > 0;
    if (tablePanel) {
        tablePanel.hidden = !hasRows;
        tablePanel.classList.toggle('is-hidden', !hasRows);
    }
    if (emptyState) {
        emptyState.hidden = hasRows;
        emptyState.classList.toggle('is-hidden', hasRows);
    }
}

function updateMyClimbStatValue(statName, value) {
    const statValue = document.querySelector('[data-my-climbs-stat="' + escapeAttributeValue(statName) + '"]');
    if (!statValue) {
        return;
    }

    statValue.textContent = value;
}

function updateMyClimbDifficultyStat(avgDifficulty) {
    const stat = document.querySelector('[data-my-climbs-stat="avg-difficulty"]');
    if (!stat) {
        return;
    }

    const roundedStars = normalizeDifficultyStars(avgDifficulty);
    const meta = stat.querySelector('.my-climbs-stat__meta');

    stat.querySelectorAll('.my-climbs-stat__star').forEach(function(star, index) {
        star.classList.toggle('is-filled', index < roundedStars);
    });

    stat.setAttribute(
        'aria-label',
        avgDifficulty !== null
            ? ('Average difficulty ' + avgDifficulty.toFixed(1))
            : 'Average difficulty not rated'
    );

    if (meta) {
        meta.textContent = avgDifficulty !== null ? avgDifficulty.toFixed(1) : 'No ratings';
    }
}

function toggleMyClimbEditBusy(form, isBusy) {
    if (typeof togglePeakLogFormBusy === 'function') {
        togglePeakLogFormBusy(form, isBusy);
    } else if (form) {
        form.querySelectorAll('input, select, textarea, button').forEach(function(control) {
            control.disabled = Boolean(isBusy);
        });
    }

    const saveButton = form ? form.querySelector('[data-my-climb-save]') : null;
    if (saveButton) {
        saveButton.classList.toggle('is-loading', Boolean(isBusy));
    }
}

function toggleMyClimbDeleteBusy(panel, isBusy) {
    if (!panel) {
        return;
    }

    panel.querySelectorAll('button').forEach(function(button) {
        button.disabled = Boolean(isBusy);
    });

    const confirmButton = panel.querySelector('[data-my-climb-action="confirm-delete"]');
    if (confirmButton) {
        confirmButton.classList.toggle('is-loading', Boolean(isBusy));
    }
}

function setMyClimbFormError(form, message) {
    const errorElement = form ? form.querySelector('[data-my-climb-error]') : null;
    if (!errorElement) {
        return;
    }

    errorElement.textContent = String(message || '').trim();
}

function syncMyClimbNotesCounter(form) {
    if (typeof syncPeakLogNotesCounter === 'function') {
        syncPeakLogNotesCounter(form);
        return;
    }

    const notesInput = form ? form.querySelector('[data-peak-log-notes]') : null;
    const counter = form ? form.querySelector('[data-peak-log-notes-counter]') : null;
    if (!notesInput || !counter) {
        return;
    }

    counter.textContent = String(notesInput.value || '').length + ' / ' + (notesInput.getAttribute('maxlength') || '500');
}

function setMyClimbStarRating(form, value) {
    const normalizedValue = normalizeDifficultyStars(value);

    if (typeof setPeakLogStarRating === 'function') {
        setPeakLogStarRating(form, normalizedValue);
        return;
    }

    const ratingInput = form ? form.querySelector('[data-peak-star-rating-input]') : null;
    const ratingLabel = form ? form.querySelector('[data-peak-log-stars-label]') : null;
    if (ratingInput) {
        ratingInput.value = normalizedValue ? String(normalizedValue) : '';
    }

    form.querySelectorAll('[data-peak-star-value]').forEach(function(starButton) {
        const starValue = Number(starButton.getAttribute('data-peak-star-value') || 0);
        const isActive = normalizedValue > 0 && starValue <= normalizedValue;
        starButton.classList.toggle('is-active', isActive);
        starButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (ratingLabel) {
        ratingLabel.textContent = normalizedValue ? (normalizedValue + ' / 5') : 'Tap to rate';
    }
}

function normalizeDifficultyValue(value) {
    if (value === null || value === undefined || String(value).trim() === '') {
        return 0;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return 0;
    }

    return Math.max(0, Math.min(5, numericValue));
}

function normalizeDifficultyStars(value) {
    const numericValue = normalizeDifficultyValue(value);
    return numericValue ? Math.max(0, Math.min(5, Math.round(numericValue))) : 0;
}

function renderDifficultyStarsMarkup(value) {
    const filledCount = normalizeDifficultyStars(value);
    let markup = '<div class="my-climbs-table__stars" aria-label="Difficulty ' + (filledCount || 'not rated') + '">';
    for (let starIndex = 1; starIndex <= 5; starIndex += 1) {
        markup += '<span class="my-climbs-table__star' + (starIndex <= filledCount ? ' is-filled' : '') + '"><i class="fas fa-star" aria-hidden="true"></i></span>';
    }
    markup += '</div>';
    return markup;
}

function renderWeatherCellMarkup(weatherValue) {
    const normalizedWeather = String(weatherValue || '').trim().toLowerCase();
    if (!normalizedWeather) {
        return '<span class="has-text-grey">-</span>';
    }

    const iconClass = MY_CLIMB_WEATHER_ICONS[normalizedWeather] || 'fa-cloud';
    const weatherLabel = normalizedWeather.charAt(0).toUpperCase() + normalizedWeather.slice(1);
    return '<span class="my-climbs-table__weather" title="' + escapeHtml(weatherLabel) + '"><i class="fas ' + iconClass + '" aria-hidden="true"></i></span>';
}

function buildNotesPreview(notesValue) {
    const collapsedText = String(notesValue || '').replace(/\s+/g, ' ').trim();
    if (!collapsedText) {
        return 'View details';
    }
    if (collapsedText.length <= 50) {
        return collapsedText;
    }
    return collapsedText.slice(0, 49).replace(/\s+$/, '') + '...';
}

function formatMyClimbDate(value) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
        return 'Unknown date';
    }

    const dateParts = normalizedValue.slice(0, 10).split('-');
    if (dateParts.length === 3) {
        const year = Number(dateParts[0]);
        const month = Number(dateParts[1]);
        const day = Number(dateParts[2]);
        if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
            const dateValue = new Date(year, month - 1, day);
            if (!Number.isNaN(dateValue.getTime())) {
                return new Intl.DateTimeFormat('en-IE', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                }).format(dateValue);
            }
        }
    }

    return normalizedValue;
}

function getSortableDateValue(value) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
        return 0;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
        return Date.parse(normalizedValue + 'T00:00:00Z') || 0;
    }

    return Date.parse(normalizedValue) || 0;
}

function formatInteger(value) {
    const normalizedValue = Number(value || 0);
    return Math.round(normalizedValue).toLocaleString('en-IE');
}

function showMyClimbToast(message, type) {
    if (typeof showToast === 'function') {
        showToast(message, type);
    }
}

function initMyClimbsMap() {
    const mapElement = document.querySelector('[data-my-climbs-map]');
    const markersData = Array.isArray(window.myClimbsMapData) ? window.myClimbsMapData : [];
    if (!mapElement || !window.L || !markersData.length) {
        return;
    }

    const map = L.map(mapElement, {
        scrollWheelZoom: false
    });

    L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'
    }).addTo(map);

    const markerLayer = L.featureGroup().addTo(map);

    markersData.forEach(function(point) {
        const lat = Number(point.latitude);
        const lng = Number(point.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return;
        }

        const climbCount = Number(point.climb_count) || 0;
        const latestClimbLabel = String(point.latest_climb_label || 'Unknown date');
        const climbMeta = climbCount > 1
            ? 'Climbed ' + climbCount + ' times, last on ' + latestClimbLabel
            : 'Last climbed on ' + latestClimbLabel;
        const peakName = escapeHtml(String(point.name || 'Unnamed Peak'));
        const peakUrl = '/peak/' + encodeURIComponent(String(point.peak_id || ''));

        const marker = L.circleMarker([lat, lng], {
            color: '#1B4332',
            fillColor: '#D4A853',
            fillOpacity: 0.96,
            radius: 8,
            weight: 3
        });

        marker.bindPopup(
            '<div class="my-climbs-map-popup">' +
                '<p class="my-climbs-map-popup__title">' + peakName + '</p>' +
                '<p class="my-climbs-map-popup__meta">' + escapeHtml(climbMeta) + '</p>' +
                '<a class="my-climbs-map-popup__link" href="' + peakUrl + '">View Peak</a>' +
            '</div>'
        );
        marker.addTo(markerLayer);
    });

    if (!markerLayer.getLayers().length) {
        return;
    }

    map.fitBounds(markerLayer.getBounds(), {
        maxZoom: 11,
        padding: [40, 40]
    });

    window.setTimeout(function() {
        map.invalidateSize();
    }, 0);
}

function escapeAttributeValue(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(String(value || ''));
    }
    return String(value || '').replace(/"/g, '\\"');
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
