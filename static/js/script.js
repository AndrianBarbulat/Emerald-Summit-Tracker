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
});

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
    const response = await fetch(url, {
        body: JSON.stringify(payload),
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
            }
        } catch (error) {
            setPeakTrackingMessage(panel, error.message || 'We could not update this peak right now.', true);
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
                closePeakLogForm(panel, form, true);
                showSiteToast(result.already_climbed ? 'This summit is already logged.' : 'Summit logged successfully.');
                if (result.warning) {
                    window.setTimeout(function() {
                        showSiteToast(result.warning);
                    }, 320);
                }
            } catch (error) {
                setPeakLogFormError(panel, error.message || 'We could not save this summit right now.');
            } finally {
                togglePeakLogFormBusy(form, false);
                if (submitButton) {
                    submitButton.classList.remove('is-loading');
                }
            }
        });
    }
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
    let container = document.querySelector('.site-toast-container');
    if (container) {
        return container;
    }

    container = document.createElement('div');
    container.className = 'site-toast-container';
    document.body.appendChild(container);
    return container;
}

function showSiteToast(message) {
    const container = ensureSiteToastContainer();
    const toast = document.createElement('div');
    toast.className = 'site-toast';
    toast.textContent = String(message || '').trim();
    container.appendChild(toast);

    window.requestAnimationFrame(function() {
        toast.classList.add('is-visible');
    });

    window.setTimeout(function() {
        toast.classList.remove('is-visible');
        window.setTimeout(function() {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 220);
    }, 2800);
}

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
