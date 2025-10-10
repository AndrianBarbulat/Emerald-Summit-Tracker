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

    document.querySelectorAll('form[data-auth-form]').forEach(function(authForm) {
        authForm.addEventListener('submit', function(event) {
            if (!validateAuthForm(authForm)) {
                event.preventDefault();
            }
        });

        authForm.querySelectorAll('.input').forEach(function(input) {
            input.addEventListener('input', function() {
                clearAuthFieldError(input);

                if (input.name === 'password') {
                    const confirmInput = authForm.querySelector('[data-auth-confirm]');
                    if (confirmInput && confirmInput.value.trim() && confirmInput.value === input.value) {
                        clearAuthFieldError(confirmInput);
                    }
                }
            });
        });
    });

    const mapElement = document.getElementById('peak-map');
    if (mapElement && window.L) {
        const map = L.map('peak-map').setView([53.15, -7.95], 7.5);
        const provinceColors = {
            munster: '#74C69D',
            leinster: '#5B8FB9',
            ulster: '#E67E22',
            connacht: '#8E6BB5'
        };
        const statusTrackingEnabled = Boolean(window.statusTrackingEnabled);

        L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'
        }).addTo(map);

        const peakList = Array.isArray(window.peaksData) ? window.peaksData : [];
        peakList.forEach(function(peak) {
            const lat = Number(peak.latitude);
            const lon = Number(peak.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                return;
            }

            const popupCounty = peak.county ? `<br>${peak.county}` : '';
            const popupProvince = peak.province ? `<br>${peak.province}` : '';
            const popupHeight = peak.height_m ? `<br>${peak.height_m}m` : '';
            const provinceKey = String(peak.province || '').trim().toLowerCase();
            const markerColor = provinceColors[provinceKey] || '#74C69D';
            const peakStatus = normalizePeakStatusValue(peak.user_status);
            const popupStatus = statusTrackingEnabled
                ? `<div class="landing-map-popup-status">${getPeakStatusMarkupFragment(peakStatus)}</div>`
                : '';

            L.circleMarker([lat, lon], buildMapMarkerOptions(markerColor, peakStatus, statusTrackingEnabled))
                .bindPopup(`<b>${peak.name || 'Unnamed Peak'}</b>${popupCounty}${popupProvince}${popupHeight}${popupStatus}`)
                .addTo(map);
        });
    }

    const peakDetailMapElement = document.getElementById('peak-detail-map');
    const rawPeakLat = window.peakLat;
    const rawPeakLng = window.peakLng;
    const peakLat = rawPeakLat === null || rawPeakLat === undefined ? NaN : Number(rawPeakLat);
    const peakLng = rawPeakLng === null || rawPeakLng === undefined ? NaN : Number(rawPeakLng);
    if (peakDetailMapElement && window.L && Number.isFinite(peakLat) && Number.isFinite(peakLng)) {
        const peakDetailMap = L.map('peak-detail-map').setView([peakLat, peakLng], 13);

        L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'
        }).addTo(peakDetailMap);

        L.circleMarker([peakLat, peakLng], {
            color: '#FFFFFF',
            fillColor: '#D4A853',
            fillOpacity: 1,
            radius: 9,
            weight: 3
        }).addTo(peakDetailMap);
    }

    document.querySelectorAll('[data-peak-tracking]').forEach(function(panel) {
        initPeakTrackingPanel(panel);
    });

    document.querySelectorAll('[data-user-climb-log-section]').forEach(function(section) {
        initUserClimbLogSection(section);
    });

    document.querySelectorAll('[data-peak-community]').forEach(function(section) {
        initPeakCommunitySection(section);
    });
});

const CLIMB_WEATHER_META = {
    sunny: { icon: 'fa-sun', label: 'Sunny' },
    cloudy: { icon: 'fa-cloud-sun', label: 'Cloudy' },
    overcast: { icon: 'fa-cloud', label: 'Overcast' },
    rainy: { icon: 'fa-cloud-rain', label: 'Rainy' },
    windy: { icon: 'fa-wind', label: 'Windy' },
    snowy: { icon: 'fa-snowflake', label: 'Snowy' },
    foggy: { icon: 'fa-smog', label: 'Foggy' },
    mixed: { icon: 'fa-cloud-sun-rain', label: 'Mixed' }
};

const TOAST_META = {
    success: { icon: 'fa-circle-check', label: 'Success' },
    warning: { icon: 'fa-triangle-exclamation', label: 'Warning' },
    error: { icon: 'fa-circle-xmark', label: 'Error' }
};

const AUTH_MODAL_COPY = {
    login: {
        title: 'Welcome Back',
        subtitle: 'Log in to keep tracking every summit.'
    },
    signup: {
        title: 'Join the Adventure',
        subtitle: 'Create your account and start logging peaks across Ireland.'
    }
};

function authModalElements() {
    const modal = document.getElementById('auth-modal');
    if (!modal) {
        return {};
    }

    return {
        modal: modal,
        loginForm: document.getElementById('login-form'),
        signupForm: document.getElementById('signup-form'),
        modalTitle: document.getElementById('modal-title'),
        modalSubtitle: document.getElementById('modal-subtitle')
    };
}

function clearAuthFieldError(input) {
    if (!input) {
        return;
    }

    input.classList.remove('is-danger');
    input.removeAttribute('aria-invalid');

    const field = input.closest('.field');
    const errorMessage = field ? field.querySelector('.auth-modal__error') : null;
    if (errorMessage) {
        errorMessage.textContent = '';
    }
}

function setAuthFieldError(input, message) {
    if (!input) {
        return;
    }

    input.classList.add('is-danger');
    input.setAttribute('aria-invalid', 'true');

    const field = input.closest('.field');
    const errorMessage = field ? field.querySelector('.auth-modal__error') : null;
    if (errorMessage) {
        errorMessage.textContent = message;
    }
}

function clearAuthValidation(scope) {
    const root = scope || document.getElementById('auth-modal');
    if (!root) {
        return;
    }

    root.querySelectorAll('.input').forEach(function(input) {
        clearAuthFieldError(input);
    });
}

function validateAuthForm(form) {
    if (!form) {
        return true;
    }

    clearAuthValidation(form);

    let isValid = true;
    let firstInvalidInput = null;
    form.querySelectorAll('[data-auth-required]').forEach(function(input) {
        const label = input.dataset.fieldLabel || 'This field';
        if (!input.value.trim()) {
            setAuthFieldError(input, label + ' is required.');
            if (!firstInvalidInput) {
                firstInvalidInput = input;
            }
            isValid = false;
        }
    });

    const passwordInput = form.querySelector('input[name="password"]');
    const confirmInput = form.querySelector('[data-auth-confirm]');
    if (
        isValid &&
        passwordInput &&
        confirmInput &&
        confirmInput.value.trim() &&
        passwordInput.value !== confirmInput.value
    ) {
        setAuthFieldError(confirmInput, 'Passwords must match.');
        if (!firstInvalidInput) {
            firstInvalidInput = confirmInput;
        }
        isValid = false;
    }

    if (firstInvalidInput) {
        firstInvalidInput.focus();
    }

    return isValid;
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

function buildMapMarkerOptions(markerColor, status, trackingEnabled) {
    const baseOptions = {
        color: '#FFFFFF',
        fillColor: markerColor,
        fillOpacity: 0.95,
        radius: 6,
        weight: 2
    };

    if (!trackingEnabled) {
        return baseOptions;
    }

    if (status === 'climbed') {
        return Object.assign({}, baseOptions, {
            color: '#1B4332',
            radius: 8,
            weight: 3
        });
    }

    if (status === 'bucket_listed') {
        return Object.assign({}, baseOptions, {
            color: '#D4A853',
            dashArray: '3 2',
            radius: 7,
            weight: 3
        });
    }

    return baseOptions;
}

function getTodayDateValueLocal() {
    const now = new Date();
    const localTime = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
    return localTime.toISOString().slice(0, 10);
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
        throw new Error(result.error || 'Something went wrong.');
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
        throw new Error(result.error || 'Something went wrong.');
    }

    return result;
}

function setPeakTrackingMessage(panel, message, isError) {
    const messageElement = panel ? panel.querySelector('[data-peak-tracking-message]') : null;
    if (!messageElement) {
        return;
    }

    messageElement.textContent = String(message || '').trim();
    messageElement.classList.toggle('is-error', Boolean(isError));
}

function updatePeakTrackingPanel(panel, status) {
    if (!panel) {
        return;
    }

    const normalizedStatus = normalizePeakStatusValue(status);
    const statusChip = panel.querySelector('[data-peak-status-chip]');
    const form = panel.querySelector('[data-peak-log-form]');
    const logButton = panel.querySelector('[data-peak-track-action="log-climb"]');
    const bucketButton = panel.querySelector('[data-peak-track-action="toggle-bucket"]');
    const copyElement = panel.querySelector('.peak-detail-actions__copy');

    panel.dataset.currentStatus = normalizedStatus;

    if (statusChip && getPeakStatusMarkupFragment(normalizedStatus)) {
        statusChip.innerHTML = getPeakStatusMarkupFragment(normalizedStatus);
    }

    if (logButton) {
        const logLabel = logButton.querySelector('span:last-child');
        logButton.disabled = normalizedStatus === 'climbed';
        if (logLabel) {
            logLabel.textContent = normalizedStatus === 'climbed' ? 'Climbed \u2713' : 'Mark as Climbed';
        }
    }

    if (bucketButton) {
        const isBucketListed = normalizedStatus === 'bucket_listed';
        const bucketLabel = bucketButton.querySelector('span:last-child');
        bucketButton.dataset.bucketActive = isBucketListed ? 'true' : 'false';
        bucketButton.classList.toggle('is-active', isBucketListed);
        bucketButton.disabled = normalizedStatus === 'climbed';
        if (bucketLabel) {
            bucketLabel.textContent = isBucketListed ? 'In Bucket List \u2713' : 'Add to Bucket List';
        }
    }

    if (normalizedStatus === 'climbed') {
        closePeakLogForm(panel, form, true);
    }

    if (copyElement) {
        if (normalizedStatus === 'climbed') {
            copyElement.textContent = 'You have already logged this peak.';
        } else if (normalizedStatus === 'bucket_listed') {
            copyElement.textContent = 'This peak is saved to your bucket list.';
        } else {
            copyElement.textContent = 'Keep this peak on your radar or log a climb in one click.';
        }
    }
}

function initPeakTrackingPanel(panel) {
    if (!panel) {
        return;
    }

    const form = panel.querySelector('[data-peak-log-form]');
    const notesInput = panel.querySelector('[data-peak-log-notes]');
    const photoInput = panel.querySelector('[data-peak-log-photos]');

    updatePeakTrackingPanel(panel, panel.dataset.initialStatus);
    if (form) {
        resetPeakLogForm(form);
    }

    panel.addEventListener('click', async function(event) {
        const starButton = event.target.closest('[data-peak-star-value]');
        if (starButton && form) {
            event.preventDefault();
            setPeakLogStarRating(form, Number(starButton.getAttribute('data-peak-star-value') || 0));
            return;
        }

        const button = event.target.closest('[data-peak-track-action]');
        if (!button) {
            return;
        }

        event.preventDefault();
        const peakId = Number(panel.dataset.peakId || 0);
        const actionName = button.getAttribute('data-peak-track-action');
        const currentStatus = normalizePeakStatusValue(panel.dataset.currentStatus);
        if (!peakId || !actionName) {
            return;
        }

        setPeakTrackingMessage(panel, '', false);
        if (actionName === 'log-climb') {
            if (currentStatus === 'climbed' || !form) {
                return;
            }
            openPeakLogForm(panel, form);
            return;
        }

        if (actionName === 'cancel-log-form') {
            closePeakLogForm(panel, form, true);
            return;
        }

        button.classList.add('is-loading');

        try {
            let result = null;
            if (actionName === 'toggle-bucket' && currentStatus !== 'climbed') {
                const endpoint = currentStatus === 'bucket_listed'
                    ? '/api/bucket-list/remove'
                    : '/api/bucket-list/add';
                result = await postJsonRequest(endpoint, { peak_id: peakId });
                updatePeakTrackingPanel(panel, result.user_status);
                setPeakTrackingMessage(
                    panel,
                    currentStatus === 'bucket_listed'
                        ? 'Removed from your bucket list.'
                        : 'Added to your bucket list.',
                    false
                );
                showToast(
                    currentStatus === 'bucket_listed'
                        ? 'Removed from your bucket list.'
                        : 'Added to your bucket list.',
                    'warning'
                );
            }
        } catch (error) {
            setPeakTrackingMessage(panel, error.message || 'We could not update this peak right now.', true);
            showToast(error.message || 'We could not update this peak right now.', 'error');
        } finally {
            button.classList.remove('is-loading');
        }
    });

    if (notesInput) {
        notesInput.addEventListener('input', function() {
            syncPeakLogNotesCounter(form);
        });
        syncPeakLogNotesCounter(form);
    }

    if (photoInput) {
        photoInput.addEventListener('change', function() {
            const validationMessage = validatePeakLogPhotos(photoInput.files);
            if (validationMessage) {
                photoInput.value = '';
                syncPeakLogPhotoSummary(form);
                setPeakLogFormError(panel, validationMessage);
                return;
            }
            setPeakLogFormError(panel, '');
            syncPeakLogPhotoSummary(form);
        });
        syncPeakLogPhotoSummary(form);
    }

    if (form) {
        form.addEventListener('submit', async function(event) {
            event.preventDefault();

            const peakId = Number(panel.dataset.peakId || 0);
            if (!peakId) {
                return;
            }

            const dateInput = form.querySelector('[data-peak-log-date]');
            const submitButton = form.querySelector('[data-peak-log-submit]');
            const formData = new FormData(form);
            const photoFiles = photoInput ? photoInput.files : [];
            const validationMessage = validatePeakLogPhotos(photoFiles);

            if (!dateInput || !String(dateInput.value || '').trim()) {
                setPeakLogFormError(panel, 'Please choose a climb date.');
                if (dateInput) {
                    dateInput.focus();
                }
                return;
            }

            if (validationMessage) {
                setPeakLogFormError(panel, validationMessage);
                return;
            }

            setPeakLogFormError(panel, '');
            setPeakTrackingMessage(panel, '', false);
            togglePeakLogFormBusy(form, true);
            if (submitButton) {
                submitButton.classList.add('is-loading');
            }

            try {
                formData.set('peak_id', String(peakId));
                const result = await postFormDataRequest('/api/log-climb', formData);
                updatePeakTrackingPanel(panel, result.user_status);
                const userClimbSection = findUserClimbLogSection(peakId);
                if (userClimbSection && result.climb) {
                    upsertUserClimbItem(userClimbSection, result.climb);
                }
                closePeakLogForm(panel, form, true);
                showToast(result.already_climbed ? 'This summit is already logged.' : 'Summit logged successfully.', 'success');
                if (result.warning) {
                    window.setTimeout(function() {
                        showToast(result.warning, 'warning');
                    }, 320);
                }
            } catch (error) {
                setPeakLogFormError(panel, error.message || 'We could not save this summit right now.');
                showToast(error.message || 'We could not save this summit right now.', 'error');
            } finally {
                togglePeakLogFormBusy(form, false);
                if (submitButton) {
                    submitButton.classList.remove('is-loading');
                }
            }
        });
    }
}

function initUserClimbLogSection(section) {
    if (!section) {
        return;
    }

    initializeUserClimbEditForms(section);
    syncUserClimbSectionVisibility(section);

    section.addEventListener('input', function(event) {
        const form = event.target.closest('[data-user-climb-edit-form]');
        if (!form) {
            return;
        }

        if (event.target.matches('[data-peak-log-notes]')) {
            syncPeakLogNotesCounter(form);
            setUserClimbFormError(form.closest('[data-user-climb-item]'), '');
        }
    });

    section.addEventListener('click', async function(event) {
        const starButton = event.target.closest('[data-peak-star-value]');
        const starForm = starButton ? starButton.closest('[data-user-climb-edit-form]') : null;
        if (starButton && starForm) {
            event.preventDefault();
            setPeakLogStarRating(starForm, Number(starButton.getAttribute('data-peak-star-value') || 0));
            return;
        }

        const actionButton = event.target.closest('[data-user-climb-action]');
        if (!actionButton) {
            return;
        }

        event.preventDefault();
        const item = actionButton.closest('[data-user-climb-item]');
        if (!item) {
            return;
        }

        const actionName = actionButton.getAttribute('data-user-climb-action');
        if (actionName === 'edit') {
            openUserClimbEdit(section, item);
            return;
        }

        if (actionName === 'cancel-edit') {
            closeUserClimbEdit(item, true);
            return;
        }

        if (actionName === 'delete') {
            const climbId = Number(item.getAttribute('data-climb-id') || 0);
            if (!climbId) {
                return;
            }

            const confirmed = window.confirm('Delete this climb log? This cannot be undone.');
            if (!confirmed) {
                return;
            }

            actionButton.classList.add('is-loading');
            actionButton.disabled = true;

            try {
                const result = await deleteJsonRequest('/api/climb/' + climbId);
                if (item.parentNode) {
                    item.parentNode.removeChild(item);
                }
                syncUserClimbSectionVisibility(section);
                const panel = findPeakTrackingPanel(result.peak_id || section.dataset.peakId);
                if (panel && result.user_status) {
                    updatePeakTrackingPanel(panel, result.user_status);
                }
                showToast('Climb log deleted.', 'success');
            } catch (error) {
                actionButton.disabled = false;
                showToast(error.message || 'We could not delete that climb log right now.', 'error');
            } finally {
                actionButton.classList.remove('is-loading');
            }
        }
    });

    section.addEventListener('submit', async function(event) {
        const form = event.target.closest('[data-user-climb-edit-form]');
        if (!form) {
            return;
        }

        event.preventDefault();

        const item = form.closest('[data-user-climb-item]');
        const climbId = Number(item ? item.getAttribute('data-climb-id') || 0 : 0);
        const dateInput = form.querySelector('[data-user-climb-date]');
        const submitButton = form.querySelector('[data-user-climb-submit]');
        const notesInput = form.querySelector('[data-peak-log-notes]');
        const weatherSelect = form.querySelector('[data-user-climb-weather]');
        const difficultyInput = form.querySelector('[data-peak-star-rating-input]');

        if (!item || !climbId) {
            return;
        }

        if (!dateInput || !String(dateInput.value || '').trim()) {
            setUserClimbFormError(item, 'Please choose a climb date.');
            if (dateInput) {
                dateInput.focus();
            }
            return;
        }

        setUserClimbFormError(item, '');
        togglePeakLogFormBusy(form, true);
        if (submitButton) {
            submitButton.classList.add('is-loading');
        }

        try {
            const result = await putJsonRequest('/api/climb/' + climbId, {
                date_climbed: String(dateInput.value || '').trim(),
                notes: notesInput ? notesInput.value : '',
                weather: weatherSelect ? weatherSelect.value : '',
                difficulty_rating: difficultyInput ? difficultyInput.value : ''
            });
            replaceUserClimbItem(section, item, result.climb || {});
            const panel = findPeakTrackingPanel(result.peak_id || section.dataset.peakId);
            if (panel && result.user_status) {
                updatePeakTrackingPanel(panel, result.user_status);
            }
            showToast('Climb log updated.', 'success');
        } catch (error) {
            setUserClimbFormError(item, error.message || 'We could not save that climb log right now.');
            showToast(error.message || 'We could not save that climb log right now.', 'error');
        } finally {
            togglePeakLogFormBusy(form, false);
            if (submitButton) {
                submitButton.classList.remove('is-loading');
            }
        }
    });
}

function initializeUserClimbEditForms(scope) {
    if (!scope) {
        return;
    }

    const forms = scope.matches && scope.matches('[data-user-climb-edit-form]')
        ? [scope]
        : Array.from(scope.querySelectorAll('[data-user-climb-edit-form]'));

    forms.forEach(function(form) {
        syncPeakLogNotesCounter(form);
        const difficultyInput = form.querySelector('[data-peak-star-rating-input]');
        setPeakLogStarRating(form, Number(difficultyInput ? difficultyInput.value || 0 : 0));
    });
}

function openUserClimbEdit(section, item) {
    if (!section || !item) {
        return;
    }

    section.querySelectorAll('[data-user-climb-item]').forEach(function(otherItem) {
        if (otherItem !== item) {
            closeUserClimbEdit(otherItem, true);
        }
    });

    const display = item.querySelector('[data-user-climb-display]');
    const edit = item.querySelector('[data-user-climb-edit]');
    const form = item.querySelector('[data-user-climb-edit-form]');
    if (display) {
        display.hidden = true;
        display.classList.add('is-hidden');
    }
    if (edit) {
        edit.hidden = false;
        edit.classList.remove('is-hidden');
    }
    item.classList.add('is-editing');
    setUserClimbFormError(item, '');
    if (form) {
        initializeUserClimbEditForms(form);
    }

    const focusTarget = item.querySelector('[data-user-climb-date]');
    if (focusTarget) {
        focusTarget.focus();
    }
}

function closeUserClimbEdit(item, shouldReset) {
    if (!item) {
        return;
    }

    const display = item.querySelector('[data-user-climb-display]');
    const edit = item.querySelector('[data-user-climb-edit]');
    const form = item.querySelector('[data-user-climb-edit-form]');
    if (shouldReset && form) {
        form.reset();
        initializeUserClimbEditForms(form);
    }

    if (display) {
        display.hidden = false;
        display.classList.remove('is-hidden');
    }
    if (edit) {
        edit.hidden = true;
        edit.classList.add('is-hidden');
    }
    item.classList.remove('is-editing');
    setUserClimbFormError(item, '');
}

function setUserClimbFormError(item, message) {
    const errorElement = item ? item.querySelector('[data-user-climb-error]') : null;
    if (!errorElement) {
        return;
    }

    errorElement.textContent = String(message || '').trim();
}

function syncUserClimbSectionVisibility(section) {
    if (!section) {
        return;
    }

    const list = section.querySelector('[data-user-climb-log-list]');
    const hasItems = Boolean(list && list.querySelector('[data-user-climb-item]'));
    section.hidden = !hasItems;
    section.classList.toggle('is-hidden', !hasItems);
}

function findUserClimbLogSection(peakId) {
    const normalizedPeakId = String(peakId || '').trim();
    if (!normalizedPeakId) {
        return null;
    }

    return document.querySelector('[data-user-climb-log-section][data-peak-id="' + normalizedPeakId + '"]');
}

function findPeakTrackingPanel(peakId) {
    const normalizedPeakId = String(peakId || '').trim();
    if (!normalizedPeakId) {
        return null;
    }

    return document.querySelector('[data-peak-tracking][data-peak-id="' + normalizedPeakId + '"]');
}

function replaceUserClimbItem(section, item, climb) {
    const list = section ? section.querySelector('[data-user-climb-log-list]') : null;
    if (!list || !item || !climb) {
        return;
    }

    item.insertAdjacentHTML('afterend', buildUserClimbItemMarkup(climb, section.dataset.peakName || 'Peak'));
    if (item.parentNode) {
        item.parentNode.removeChild(item);
    }
    initializeUserClimbEditForms(section);
    syncUserClimbSectionVisibility(section);
}

function upsertUserClimbItem(section, climb) {
    const list = section ? section.querySelector('[data-user-climb-log-list]') : null;
    if (!section || !list || !climb || climb.id === undefined || climb.id === null) {
        return;
    }

    const climbId = String(climb.id);
    let existingItem = null;
    list.querySelectorAll('[data-user-climb-item]').forEach(function(item) {
        if (existingItem || String(item.getAttribute('data-climb-id') || '') !== climbId) {
            return;
        }
        existingItem = item;
    });

    if (existingItem) {
        replaceUserClimbItem(section, existingItem, climb);
        return;
    }

    list.insertAdjacentHTML('afterbegin', buildUserClimbItemMarkup(climb, section.dataset.peakName || 'Peak'));
    initializeUserClimbEditForms(section);
    syncUserClimbSectionVisibility(section);
}

function buildUserClimbItemMarkup(climb, peakName) {
    const normalizedClimb = normalizeUserClimbRecord(climb);
    const weatherMeta = normalizedClimb.weather ? (CLIMB_WEATHER_META[normalizedClimb.weather] || null) : null;
    const difficultyDisplayLabel = normalizedClimb.difficultyLabel || 'No rating';
    const weatherMarkup = weatherMeta
        ? '<p class="peak-detail-list-item__meta peak-detail-user-climb-item__weather">'
            + '<span class="icon is-small" aria-hidden="true"><i class="fas ' + escapeHtml(weatherMeta.icon) + '"></i></span>'
            + '<span>' + escapeHtml(weatherMeta.label) + '</span>'
        + '</p>'
        : '';
    const notesMarkup = normalizedClimb.notes
        ? '<p class="peak-detail-list-item__copy">' + escapeHtml(normalizedClimb.notes) + '</p>'
        : '';
    const photoMarkup = normalizedClimb.photoUrls.length
        ? '<div class="peak-detail-photo-gallery" aria-label="Climb photo gallery">' + buildUserClimbPhotoMarkup(normalizedClimb.photoUrls, peakName) + '</div>'
        : '';

    return ''
        + '<article class="peak-detail-list-item peak-detail-user-climb-item" data-user-climb-item data-climb-id="' + escapeHtml(String(normalizedClimb.id || '')) + '">'
        + '  <div class="peak-detail-user-climb-item__display" data-user-climb-display>'
        + '    <div class="peak-detail-list-item__body">'
        + '      <div class="peak-detail-list-item__header">'
        + '        <div class="peak-detail-list-item__heading">'
        + '          <p class="peak-detail-list-item__title">' + escapeHtml(normalizedClimb.dateLabel) + '</p>'
        + '          <div class="peak-detail-user-climb-item__meta-row">'
        +               weatherMarkup
        +               buildClimbStarsMarkup(normalizedClimb.difficultyStars, difficultyDisplayLabel, true)
        + '          </div>'
        + '        </div>'
        + '        <div class="buttons peak-detail-user-climb-item__actions">'
        + '          <button type="button" class="button is-light peak-detail-user-climb-item__action" data-user-climb-action="edit">Edit</button>'
        + '          <button type="button" class="button is-danger is-light peak-detail-user-climb-item__action" data-user-climb-action="delete">Delete</button>'
        + '        </div>'
        + '      </div>'
        +        notesMarkup
        +        photoMarkup
        + '    </div>'
        + '  </div>'
        + '  <div class="peak-detail-user-climb-item__edit is-hidden" data-user-climb-edit hidden>'
        + '    <form class="peak-detail-log-form peak-detail-user-climb-form" data-user-climb-edit-form novalidate>'
        + '      <div class="columns is-multiline is-variable is-3">'
        + '        <div class="column is-12-mobile is-6-tablet">'
        + '          <div class="field">'
        + '            <label class="label">Date</label>'
        + '            <div class="control">'
        + '              <input class="input" type="date" name="date_climbed" value="' + escapeHtml(normalizedClimb.dateInputValue) + '" data-user-climb-date>'
        + '            </div>'
        + '          </div>'
        + '        </div>'
        + '        <div class="column is-12-mobile is-6-tablet">'
        + '          <div class="field">'
        + '            <label class="label">Weather</label>'
        + '            <div class="control"><div class="select is-fullwidth"><select name="weather" data-user-climb-weather>'
        +                  buildWeatherOptionsMarkup(normalizedClimb.weather)
        + '            </select></div></div>'
        + '          </div>'
        + '        </div>'
        + '        <div class="column is-12">'
        + '          <div class="field">'
        + '            <div class="peak-detail-log-form__field-head">'
        + '              <label class="label">Notes</label>'
        + '              <span class="peak-detail-log-form__counter" data-peak-log-notes-counter>' + escapeHtml(String(normalizedClimb.notes.length)) + ' / 500</span>'
        + '            </div>'
        + '            <div class="control">'
        + '              <textarea class="textarea" name="notes" rows="4" maxlength="500" data-peak-log-notes>' + escapeHtml(normalizedClimb.notes) + '</textarea>'
        + '            </div>'
        + '          </div>'
        + '        </div>'
        + '        <div class="column is-12">'
        + '          <div class="field">'
        + '            <div class="peak-detail-log-form__field-head">'
        + '              <label class="label">Difficulty</label>'
        + '              <span class="peak-detail-log-form__counter" data-peak-log-stars-label>' + escapeHtml(normalizedClimb.difficultyStars ? (String(normalizedClimb.difficultyStars) + ' / 5') : 'Tap to rate') + '</span>'
        + '            </div>'
        + '            <div class="peak-detail-stars" data-peak-star-rating>'
        + '              <input type="hidden" name="difficulty_rating" value="' + escapeHtml(normalizedClimb.difficultyInputValue) + '" data-peak-star-rating-input>'
        +                    buildClimbEditStarsMarkup(normalizedClimb.difficultyStars)
        + '            </div>'
        + '          </div>'
        + '        </div>'
        + '      </div>'
        + '      <p class="peak-detail-log-form__error peak-detail-user-climb-form__error" data-user-climb-error aria-live="polite"></p>'
        + '      <div class="buttons peak-detail-log-form__actions">'
        + '        <button type="button" class="button peak-detail-log-form__cancel" data-user-climb-action="cancel-edit">Cancel</button>'
        + '        <button type="submit" class="button peak-detail-log-form__submit" data-user-climb-submit>Save Changes</button>'
        + '      </div>'
        + '    </form>'
        + '  </div>'
        + '</article>';
}

function buildUserClimbPhotoMarkup(photoUrls, peakName) {
    return photoUrls.map(function(photoUrl, index) {
        return ''
            + '<a href="' + escapeHtml(photoUrl) + '" class="peak-detail-photo-gallery__link" target="_blank" rel="noreferrer noopener">'
            + '  <img src="' + escapeHtml(photoUrl) + '" alt="' + escapeHtml(String(peakName || 'Peak') + ' climb photo ' + (index + 1)) + '" class="peak-detail-photo-gallery__image" loading="lazy">'
            + '</a>';
    }).join('');
}

function buildWeatherOptionsMarkup(selectedWeather) {
    const normalizedWeather = String(selectedWeather || '').trim().toLowerCase();
    let markup = '<option value="">Select weather</option>';
    Object.keys(CLIMB_WEATHER_META).forEach(function(weatherKey) {
        const meta = CLIMB_WEATHER_META[weatherKey];
        const selected = weatherKey === normalizedWeather ? ' selected' : '';
        markup += '<option value="' + escapeHtml(weatherKey) + '"' + selected + '>' + escapeHtml(meta.label) + '</option>';
    });
    return markup;
}

function buildClimbEditStarsMarkup(activeStars) {
    const starCount = Number(activeStars || 0);
    let markup = '';
    for (let index = 1; index <= 5; index += 1) {
        const isActive = index <= starCount && starCount > 0;
        markup += ''
            + '<button type="button" class="peak-detail-stars__button' + (isActive ? ' is-active' : '') + '" data-peak-star-value="' + index + '" aria-label="Set difficulty to ' + index + ' out of 5" aria-pressed="' + (isActive ? 'true' : 'false') + '">'
            + '  <i class="fas fa-star" aria-hidden="true"></i>'
            + '</button>';
    }
    return markup;
}

function buildClimbStarsMarkup(starCount, label, isInline) {
    const normalizedCount = Number(starCount || 0);
    let starsMarkup = '<div class="peak-detail-stars-display' + (isInline ? ' peak-detail-stars-display--inline' : '') + '" aria-label="Difficulty ' + escapeHtml(String(label || 'not rated')) + '">';
    for (let index = 1; index <= 5; index += 1) {
        starsMarkup += '<span class="peak-detail-stars-display__star' + (index <= normalizedCount ? ' is-filled' : '') + '"><i class="fas fa-star" aria-hidden="true"></i></span>';
    }
    starsMarkup += '<span class="peak-detail-stars-display__value">' + escapeHtml(String(label || 'No rating')) + '</span></div>';
    return starsMarkup;
}

function normalizeUserClimbRecord(climb) {
    const currentClimb = climb || {};
    const dateValue = normalizeDateInputValue(currentClimb.date_climbed || currentClimb.climbed_at || currentClimb.created_at);
    const weatherValue = String(currentClimb.weather || '').trim().toLowerCase();
    const difficultyStars = normalizeDifficultyStars(currentClimb.difficulty_rating || currentClimb.difficulty);
    const difficultyLabel = String(currentClimb.difficulty_rating || currentClimb.difficulty || '').trim();
    return {
        id: currentClimb.id,
        dateInputValue: dateValue,
        dateLabel: formatUserClimbDateLabel(dateValue),
        notes: String(currentClimb.notes || ''),
        weather: weatherValue,
        difficultyInputValue: difficultyStars ? String(difficultyStars) : '',
        difficultyStars: difficultyStars,
        difficultyLabel: difficultyLabel,
        photoUrls: normalizePhotoUrlList(currentClimb.photo_urls)
    };
}

function normalizePhotoUrlList(value) {
    if (Array.isArray(value)) {
        return value.filter(function(item) {
            return String(item || '').trim();
        }).map(function(item) {
            return String(item).trim();
        });
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return [];
        }

        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return normalizePhotoUrlList(parsed);
            }
        } catch (error) {
            return [trimmed];
        }

        return [trimmed];
    }

    return [];
}

function normalizeDateInputValue(value) {
    const rawValue = String(value || '').trim();
    if (!rawValue) {
        return '';
    }
    return rawValue.slice(0, 10);
}

function formatUserClimbDateLabel(dateValue) {
    if (!dateValue) {
        return 'Climb log';
    }

    const parsedDate = new Date(dateValue + 'T00:00:00');
    if (Number.isNaN(parsedDate.getTime())) {
        return dateValue;
    }

    return parsedDate.toLocaleDateString('en-IE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

function normalizeDifficultyStars(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return 0;
    }

    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
        return Math.max(0, Math.min(5, Math.round(numericValue)));
    }

    const namedValues = {
        easy: 1,
        moderate: 2,
        medium: 2,
        hard: 3,
        challenging: 3,
        'very hard': 4,
        strenuous: 4,
        expert: 5,
        extreme: 5
    };
    return namedValues[String(value || '').trim().toLowerCase()] || 0;
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
                setPeakCommentError(section, 'Please write a trail note before posting.');
                if (commentInput) {
                    commentInput.focus();
                }
                return;
            }

            setPeakCommentError(section, '');
            if (submitButton) {
                submitButton.classList.add('is-loading');
            }

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
                setPeakCommentError(section, error.message || 'We could not post that trail note right now.');
                showToast(error.message || 'We could not post that trail note right now.', 'error');
            } finally {
                if (submitButton) {
                    submitButton.classList.remove('is-loading');
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

        deleteButton.classList.add('is-loading');
        deleteButton.disabled = true;

        try {
            await postJsonRequest('/api/peak-comment/' + commentId + '/delete', {});
            const article = section.querySelector('[data-comment-id="' + commentId + '"]');
            if (article && article.parentNode) {
                article.parentNode.removeChild(article);
            }
            syncPeakCommentEmptyState(section);
            showToast('Trail note deleted.', 'success');
        } catch (error) {
            showToast(error.message || 'We could not delete that trail note right now.', 'error');
            deleteButton.disabled = false;
        } finally {
            deleteButton.classList.remove('is-loading');
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

    const body = document.createElement('div');
    body.className = 'peak-detail-list-item__body';

    const header = document.createElement('div');
    header.className = 'peak-detail-list-item__header';

    const heading = document.createElement('div');
    heading.className = 'peak-detail-list-item__heading';

    if (comment.profile_url) {
        const link = document.createElement('a');
        link.className = 'peak-detail-list-item__title-link';
        link.href = String(comment.profile_url);

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

    const meta = document.createElement('p');
    meta.className = 'peak-detail-list-item__meta';
    meta.textContent = String(comment.relative_time || 'just now');
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
    article.appendChild(body);
    list.insertBefore(article, list.firstChild);
    syncPeakCommentEmptyState(section);
}

function openPeakLogForm(panel, form) {
    if (!panel || !form) {
        return;
    }

    panel.classList.add('is-log-form-open');
    setPeakLogFormError(panel, '');

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
    const dateInput = form.querySelector('[data-peak-log-date]');
    if (dateInput) {
        dateInput.value = getTodayDateValueLocal();
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

window.showToast = showToast;

function setAuthMode(type) {
    const elements = authModalElements();
    if (!elements.modal || !elements.loginForm || !elements.signupForm || !elements.modalTitle || !elements.modalSubtitle) {
        return;
    }

    const mode = type === 'signup' ? 'signup' : 'login';
    const copy = AUTH_MODAL_COPY[mode];

    elements.modal.dataset.authMode = mode;
    elements.loginForm.style.display = mode === 'login' ? 'block' : 'none';
    elements.signupForm.style.display = mode === 'signup' ? 'block' : 'none';
    elements.modalTitle.textContent = copy.title;
    elements.modalSubtitle.textContent = copy.subtitle;
    clearAuthValidation(elements.modal);
}

function openModal(type) {
    const elements = authModalElements();
    if (!elements.modal) {
        return;
    }

    setAuthMode(type);
    elements.modal.classList.add('is-active');
}

function closeModal() {
    const elements = authModalElements();
    if (elements.modal) {
        clearAuthValidation(elements.modal);
        elements.modal.classList.remove('is-active');
    }
}

function switchToLogin() {
    setAuthMode('login');
}

function switchToSignup() {
    setAuthMode('signup');
}

// Close modal if clicked outside
window.addEventListener('click', function(event) {
    const modal = document.getElementById('auth-modal');
    if (modal && event.target === modal) {
        closeModal();
    }
});

// Close with Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeModal();
    }
});
