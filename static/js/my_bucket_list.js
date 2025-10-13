document.addEventListener('DOMContentLoaded', function() {
    initBucketListPage();
});

function initBucketListPage() {
    const page = document.querySelector('[data-bucket-list-page]');
    if (!page) {
        return;
    }

    const state = {
        emptyState: page.querySelector('[data-bucket-empty]'),
        listGrid: page.querySelector('[data-bucket-list-grid]'),
        map: null,
        mapPanel: page.querySelector('[data-bucket-map-panel]'),
        markerLayer: null,
        markersByPeakId: new Map(),
        page: page
    };

    initializeBucketLogDates(page);
    initBucketListMap(state);

    page.addEventListener('click', async function(event) {
        const actionButton = event.target.closest('[data-bucket-action]');
        if (!actionButton) {
            return;
        }

        const item = actionButton.closest('[data-bucket-item]');
        if (!item) {
            return;
        }

        event.preventDefault();

        const actionName = String(actionButton.getAttribute('data-bucket-action') || '').trim();
        if (!actionName) {
            return;
        }

        if (actionName === 'open-log-form') {
            toggleBucketLogForm(state, item);
            return;
        }

        if (actionName === 'cancel-log-form') {
            closeBucketLogForm(item);
            return;
        }

        if (actionName === 'remove') {
            const peakId = Number(item.getAttribute('data-peak-id') || 0);
            if (!peakId) {
                return;
            }

            const confirmed = window.confirm('Remove this peak from your bucket list?');
            if (!confirmed) {
                return;
            }

            clearBucketFeedback(item);
            setBucketItemBusy(item, true);
            actionButton.classList.add('is-loading');

            try {
                await postBucketJson('/api/bucket-list/remove', { peak_id: peakId });
                removeBucketItem(state, item);
                notifyBucketToast('Removed from your bucket list.', 'warning');
            } catch (error) {
                setBucketFeedback(item, error.message || 'We could not update your bucket list.', true);
                notifyBucketToast(error.message || 'We could not update your bucket list.', 'error');
            } finally {
                if (item.isConnected) {
                    setBucketItemBusy(item, false);
                }
                actionButton.classList.remove('is-loading');
            }
        }
    });

    page.addEventListener('submit', async function(event) {
        const form = event.target.closest('[data-bucket-log-form]');
        if (!form) {
            return;
        }

        event.preventDefault();

        const item = form.closest('[data-bucket-item]');
        const submitButton = form.querySelector('[data-bucket-log-submit]');
        const peakId = Number(item ? item.getAttribute('data-peak-id') || 0 : 0);
        const dateInput = form.querySelector('[data-bucket-log-date]');
        const weatherSelect = form.querySelector('select[name="weather"]');
        const difficultySelect = form.querySelector('select[name="difficulty_rating"]');
        const notesInput = form.querySelector('textarea[name="notes"]');

        if (!item || !peakId) {
            return;
        }

        if (!dateInput || !String(dateInput.value || '').trim()) {
            setBucketFeedback(item, 'Please choose a climb date.', true);
            if (dateInput) {
                dateInput.focus();
            }
            return;
        }

        clearBucketFeedback(item);
        setBucketItemBusy(item, true);
        if (submitButton) {
            submitButton.classList.add('is-loading');
        }

        try {
            const result = await postBucketJson('/api/log-climb', {
                peak_id: peakId,
                date_climbed: String(dateInput.value || '').trim(),
                difficulty_rating: difficultySelect ? difficultySelect.value : '',
                notes: notesInput ? notesInput.value : '',
                weather: weatherSelect ? weatherSelect.value : ''
            });

            removeBucketItem(state, item);
            notifyBucketToast(
                result.already_climbed ? 'This summit is already logged.' : 'Summit logged successfully.',
                'success'
            );
            if (result.warning) {
                notifyBucketToast(result.warning, 'warning');
            }
        } catch (error) {
            setBucketFeedback(item, error.message || 'We could not save that climb.', true);
            notifyBucketToast(error.message || 'We could not save that climb.', 'error');
        } finally {
            if (item.isConnected) {
                setBucketItemBusy(item, false);
            }
            if (submitButton) {
                submitButton.classList.remove('is-loading');
            }
        }
    });
}

function initializeBucketLogDates(scope) {
    if (!scope) {
        return;
    }

    const defaultDate = getBucketTodayDate();
    scope.querySelectorAll('[data-bucket-log-date]').forEach(function(input) {
        if (!input.value) {
            input.value = defaultDate;
        }
    });
}

function toggleBucketLogForm(state, item) {
    if (!state || !item) {
        return;
    }

    const form = item.querySelector('[data-bucket-log-form]');
    if (!form) {
        return;
    }

    const shouldOpen = form.hidden;
    state.page.querySelectorAll('[data-bucket-log-form]').forEach(function(otherForm) {
        otherForm.hidden = true;
        otherForm.classList.add('is-hidden');
    });

    if (!shouldOpen) {
        return;
    }

    form.hidden = false;
    form.classList.remove('is-hidden');
    initializeBucketLogDates(form);

    const focusTarget = form.querySelector('[data-bucket-log-date]');
    if (focusTarget) {
        focusTarget.focus();
    }
}

function closeBucketLogForm(item) {
    if (!item) {
        return;
    }

    const form = item.querySelector('[data-bucket-log-form]');
    if (!form) {
        return;
    }

    form.hidden = true;
    form.classList.add('is-hidden');
}

function setBucketFeedback(item, message, isError) {
    const feedback = item ? item.querySelector('[data-bucket-feedback]') : null;
    if (!feedback) {
        return;
    }

    feedback.textContent = String(message || '').trim();
    feedback.classList.toggle('is-error', Boolean(isError));
}

function clearBucketFeedback(item) {
    setBucketFeedback(item, '', false);
}

function setBucketItemBusy(item, isBusy) {
    if (!item) {
        return;
    }

    item.classList.toggle('is-busy', Boolean(isBusy));
    item.querySelectorAll('button, input, select, textarea').forEach(function(control) {
        control.disabled = Boolean(isBusy);
    });
}

function removeBucketItem(state, item) {
    if (!state || !item) {
        return;
    }

    const peakId = String(item.getAttribute('data-peak-id') || '').trim();
    if (item.parentNode) {
        item.parentNode.removeChild(item);
    }

    updateBucketCountCopy(state.page);
    removeBucketMapMarker(state, peakId);

    const remainingItems = state.page.querySelectorAll('[data-bucket-item]').length;
    if (!remainingItems) {
        if (state.listGrid) {
            state.listGrid.hidden = true;
            state.listGrid.classList.add('is-hidden');
        }
        if (state.mapPanel) {
            state.mapPanel.hidden = true;
            state.mapPanel.classList.add('is-hidden');
        }
        if (state.emptyState) {
            state.emptyState.hidden = false;
            state.emptyState.classList.remove('is-hidden');
        }
    }
}

function updateBucketCountCopy(scope) {
    if (!scope) {
        return;
    }

    const count = scope.querySelectorAll('[data-bucket-item]').length;
    const label = count + ' peak' + (count === 1 ? '' : 's') + ' to explore';
    scope.querySelectorAll('[data-bucket-count-copy]').forEach(function(element) {
        element.textContent = label;
    });
}

function initBucketListMap(state) {
    const mapElement = state && state.page ? state.page.querySelector('[data-bucket-list-map]') : null;
    const markersData = Array.isArray(window.bucketListMapData) ? window.bucketListMapData : [];
    if (!mapElement || !window.L || !markersData.length) {
        return;
    }

    state.map = L.map(mapElement, {
        scrollWheelZoom: false
    });

    L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'
    }).addTo(state.map);

    state.markerLayer = L.featureGroup().addTo(state.map);

    markersData.forEach(function(markerData) {
        addBucketMapMarker(state, markerData);
    });

    fitBucketMapToMarkers(state);
    window.setTimeout(function() {
        if (state.map) {
            state.map.invalidateSize();
        }
    }, 0);
}

function addBucketMapMarker(state, markerData) {
    if (!state || !state.markerLayer || !markerData) {
        return;
    }

    const latitude = Number(markerData.latitude);
    const longitude = Number(markerData.longitude);
    const peakId = String(markerData.peak_id || '').trim();
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !peakId) {
        return;
    }

    const marker = L.circleMarker([latitude, longitude], {
        color: '#1B4332',
        fillColor: '#D4A853',
        fillOpacity: 0.96,
        radius: 8,
        weight: 3
    });
    const peakUrl = '/peak/' + encodeURIComponent(peakId);
    const heightText = markerData.height_m ? String(markerData.height_m) + 'm' : 'Height unknown';
    const countyText = markerData.county ? ' · ' + String(markerData.county) : '';
    const dateAddedText = markerData.date_added_label ? 'Saved ' + String(markerData.date_added_label) : 'Recently saved';

    marker.bindPopup(
        '<div class="bucket-list-map-popup">' +
            '<p class="bucket-list-map-popup__title">' + escapeBucketHtml(markerData.name || 'Unnamed Peak') + '</p>' +
            '<p class="bucket-list-map-popup__meta">' + escapeBucketHtml(heightText + countyText) + '</p>' +
            '<p class="bucket-list-map-popup__meta">' + escapeBucketHtml(dateAddedText) + '</p>' +
            '<a class="bucket-list-map-popup__link" href="' + peakUrl + '">View Peak</a>' +
        '</div>'
    );

    marker.addTo(state.markerLayer);
    state.markersByPeakId.set(peakId, marker);
}

function removeBucketMapMarker(state, peakId) {
    if (!state || !state.markerLayer || !peakId) {
        return;
    }

    const marker = state.markersByPeakId.get(String(peakId));
    if (!marker) {
        return;
    }

    state.markerLayer.removeLayer(marker);
    state.markersByPeakId.delete(String(peakId));

    if (state.markerLayer.getLayers().length) {
        fitBucketMapToMarkers(state);
        return;
    }

    if (state.mapPanel) {
        state.mapPanel.hidden = true;
        state.mapPanel.classList.add('is-hidden');
    }
}

function fitBucketMapToMarkers(state) {
    if (!state || !state.map || !state.markerLayer || !state.markerLayer.getLayers().length) {
        return;
    }

    state.map.fitBounds(state.markerLayer.getBounds(), {
        maxZoom: 11,
        padding: [40, 40]
    });
}

async function postBucketJson(url, payload) {
    const response = await fetch(url, {
        body: JSON.stringify(payload || {}),
        credentials: 'same-origin',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        method: 'POST'
    });

    const result = await response.json().catch(function() {
        return {};
    });

    if (!response.ok) {
        throw new Error(result.error || 'Something went wrong.');
    }

    return result;
}

function notifyBucketToast(message, type) {
    if (typeof window.showToast === 'function') {
        window.showToast(message, type);
    }
}

function getBucketTodayDate() {
    if (typeof window.getTodayDateValueLocal === 'function') {
        return window.getTodayDateValueLocal();
    }

    const now = new Date();
    const localTime = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    return localTime.toISOString().slice(0, 10);
}

function escapeBucketHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
