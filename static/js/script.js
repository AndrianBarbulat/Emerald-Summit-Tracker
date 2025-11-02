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
        initializeAuthForm(authForm);
    });

    document.querySelectorAll('[data-peak-log-form], [data-user-climb-edit-form]').forEach(function(form) {
        initializeClimbFormValidation(form);
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
    const peakDetailMapRegion = peakDetailMapElement ? peakDetailMapElement.closest('[data-peak-detail-map-region]') : null;
    const rawPeakLat = window.peakLat;
    const rawPeakLng = window.peakLng;
    const peakLat = rawPeakLat === null || rawPeakLat === undefined ? NaN : Number(rawPeakLat);
    const peakLng = rawPeakLng === null || rawPeakLng === undefined ? NaN : Number(rawPeakLng);
    if (peakDetailMapElement && window.L && Number.isFinite(peakLat) && Number.isFinite(peakLng)) {
        if (peakDetailMapRegion) {
            setLoadingRegion(peakDetailMapRegion, true, { message: 'Loading topo map...' });
        }

        const peakDetailMap = L.map('peak-detail-map').setView([peakLat, peakLng], 13);

        const tileLayer = L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'
        }).addTo(peakDetailMap);

        tileLayer.once('load', function() {
            if (peakDetailMapRegion) {
                setLoadingRegion(peakDetailMapRegion, false);
            }
        });

        L.circleMarker([peakLat, peakLng], {
            color: '#FFFFFF',
            fillColor: '#D4A853',
            fillOpacity: 1,
            radius: 9,
            weight: 3
        }).addTo(peakDetailMap);

        window.setTimeout(function() {
            if (peakDetailMapRegion) {
                setLoadingRegion(peakDetailMapRegion, false);
            }
        }, 1400);
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

    refreshTimeAgo(document);
    startTimeAgoUpdates();

    window.requestAnimationFrame(function() {
        window.requestAnimationFrame(function() {
            releaseInitialPageLoading();
        });
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

let timeAgoIntervalId = null;
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

function isValidEmailAddress(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function getTodayDateComparable() {
    return getTodayDateValueLocal();
}

function getDateValidationMessage(value) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
        return 'Please choose a climb date.';
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
        return 'Please choose a valid date.';
    }

    const dateParts = normalizedValue.split('-');
    const year = Number(dateParts[0]);
    const month = Number(dateParts[1]);
    const day = Number(dateParts[2]);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day) ||
        parsedDate.getUTCFullYear() !== year ||
        (parsedDate.getUTCMonth() + 1) !== month ||
        parsedDate.getUTCDate() !== day
    ) {
        return 'Please choose a valid date.';
    }

    if (normalizedValue > getTodayDateComparable()) {
        return 'Climb date cannot be in the future.';
    }

    return '';
}

function getNotesValidationMessage(value, maxLength) {
    const textValue = String(value || '');
    const limit = Number(maxLength || 500);
    if (textValue.length > limit) {
        return 'Notes must be ' + limit + ' characters or fewer.';
    }
    return '';
}

function getDifficultyValidationMessage(value) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
        return '';
    }

    const numericValue = Number(normalizedValue);
    if (!Number.isFinite(numericValue) || numericValue < 1 || numericValue > 5) {
        return 'Difficulty rating must be between 1 and 5.';
    }

    return '';
}

function getClimbFieldSelectorMap(overrides) {
    return Object.assign(
        {
            date_climbed: '[data-peak-log-date], [data-user-climb-date], [data-my-climb-date], [data-dashboard-climb-date], [data-bucket-log-date], input[name="date_climbed"]',
            notes: '[data-peak-log-notes], textarea[name="notes"]',
            difficulty_rating: '[data-peak-star-rating-input], select[name="difficulty_rating"]',
            photos: '[data-peak-log-photos], input[type="file"][name="photos"]'
        },
        overrides || {}
    );
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

function validateClimbFormClient(form, selectorOverrides) {
    if (!form) {
        return { fieldErrors: {}, firstInvalidControl: null, isValid: true };
    }

    const selectorMap = getClimbFieldSelectorMap(selectorOverrides);
    const dateInput = form.querySelector(selectorMap.date_climbed);
    const notesInput = form.querySelector(selectorMap.notes);
    const difficultyInput = form.querySelector(selectorMap.difficulty_rating);
    const photoInput = form.querySelector(selectorMap.photos);
    const fieldErrors = {};

    clearFormFieldErrors(form);

    if (dateInput) {
        const dateMessage = getDateValidationMessage(dateInput.value);
        if (dateMessage) {
            fieldErrors.date_climbed = dateMessage;
        }
    }

    if (notesInput) {
        const notesMessage = getNotesValidationMessage(
            notesInput.value,
            Number(notesInput.getAttribute('maxlength') || 500)
        );
        if (notesMessage) {
            fieldErrors.notes = notesMessage;
        }
    }

    if (difficultyInput) {
        const difficultyMessage = getDifficultyValidationMessage(difficultyInput.value);
        if (difficultyMessage) {
            fieldErrors.difficulty_rating = difficultyMessage;
        }
    }

    if (photoInput) {
        const photoMessage = validatePeakLogPhotos(photoInput.files);
        if (photoMessage) {
            fieldErrors.photos = photoMessage;
        }
    }

    const firstInvalidControl = applyFieldErrors(form, fieldErrors, selectorMap);
    if (firstInvalidControl && typeof firstInvalidControl.focus === 'function') {
        firstInvalidControl.focus();
    }

    return {
        fieldErrors: fieldErrors,
        firstInvalidControl: firstInvalidControl,
        isValid: !Object.keys(fieldErrors).length
    };
}

function initializeClimbFormValidation(form, selectorOverrides) {
    if (!form || form.dataset.validationReady === 'true') {
        return;
    }

    form.dataset.validationReady = 'true';
    const selectorMap = getClimbFieldSelectorMap(selectorOverrides);
    const dateInput = form.querySelector(selectorMap.date_climbed);
    const notesInput = form.querySelector(selectorMap.notes);
    const difficultyInput = form.querySelector(selectorMap.difficulty_rating);
    const photoInput = form.querySelector(selectorMap.photos);

    if (dateInput) {
        dateInput.setAttribute('max', getTodayDateComparable());
        dateInput.addEventListener('input', function() {
            clearFieldError(dateInput);
        });
        dateInput.addEventListener('change', function() {
            clearFieldError(dateInput);
        });
    }

    if (notesInput) {
        notesInput.addEventListener('input', function() {
            syncPeakLogNotesCounter(form);
            clearFieldError(notesInput);
        });
        syncPeakLogNotesCounter(form);
    }

    if (difficultyInput && difficultyInput.matches('select')) {
        difficultyInput.addEventListener('change', function() {
            clearFieldError(difficultyInput);
        });
    }

    if (photoInput) {
        photoInput.addEventListener('change', function() {
            clearFieldError(photoInput);
            syncPeakLogPhotoSummary(form);
        });
        syncPeakLogPhotoSummary(form);
    }
}

function clearAuthFieldError(input) {
    clearFieldError(input, { messageSelector: '.auth-modal__error' });
}

function setAuthFieldError(input, message) {
    setFieldError(input, message, { messageSelector: '.auth-modal__error' });
}

function clearAuthValidation(scope) {
    const root = scope || document.getElementById('auth-modal');
    if (!root) {
        return;
    }

    clearFormFieldErrors(root, { messageSelector: '.auth-modal__error' });
    root.querySelectorAll('[data-auth-form-error]').forEach(function(errorElement) {
        errorElement.textContent = '';
    });
}

function setAuthFormError(form, message) {
    const errorElement = form ? form.querySelector('[data-auth-form-error]') : null;
    if (!errorElement) {
        return;
    }

    errorElement.textContent = String(message || '').trim();
}

function validateAuthForm(form) {
    if (!form) {
        return { fieldErrors: {}, firstInvalidInput: null, isValid: true };
    }

    clearAuthValidation(form);

    const fieldErrors = {};
    form.querySelectorAll('[data-auth-required]').forEach(function(input) {
        const label = input.dataset.fieldLabel || 'This field';
        if (!String(input.value || '').trim()) {
            fieldErrors[input.name] = label + ' is required.';
        }
    });

    const emailInput = form.querySelector('input[type="email"][name="email"]');
    if (emailInput && String(emailInput.value || '').trim() && !isValidEmailAddress(emailInput.value)) {
        fieldErrors.email = 'Please enter a valid email address.';
    }

    const passwordInput = form.querySelector('input[name="password"]');
    const confirmInput = form.querySelector('[data-auth-confirm]');
    if (
        passwordInput &&
        confirmInput &&
        String(confirmInput.value || '').trim() &&
        passwordInput.value !== confirmInput.value
    ) {
        fieldErrors.confirm_password = 'Passwords must match.';
    }

    const selectorMap = {
        confirm_password: '[data-auth-confirm]',
        display_name: 'input[name="display_name"]',
        email: 'input[name="email"]',
        password: 'input[name="password"]'
    };
    const firstInvalidInput = applyFieldErrors(form, fieldErrors, selectorMap, { messageSelector: '.auth-modal__error' });
    if (firstInvalidInput && typeof firstInvalidInput.focus === 'function') {
        firstInvalidInput.focus();
    }

    return {
        fieldErrors: fieldErrors,
        firstInvalidInput: firstInvalidInput,
        isValid: !Object.keys(fieldErrors).length
    };
}

function initializeAuthForm(form) {
    if (!form || form.dataset.authReady === 'true') {
        return;
    }

    form.dataset.authReady = 'true';
    form.querySelectorAll('.input').forEach(function(input) {
        input.addEventListener('input', function() {
            clearAuthFieldError(input);
            setAuthFormError(form, '');

            if (input.name === 'password') {
                const confirmInput = form.querySelector('[data-auth-confirm]');
                if (confirmInput) {
                    clearAuthFieldError(confirmInput);
                }
            }
        });
    });

    form.addEventListener('submit', async function(event) {
        event.preventDefault();

        const validation = validateAuthForm(form);
        if (!validation.isValid) {
            return;
        }

        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton) {
            setButtonLoading(submitButton, true);
        }
        setAuthFormError(form, '');

        try {
            const response = await fetch(form.action, {
                body: new FormData(form),
                credentials: 'same-origin',
                headers: {
                    'Accept': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                },
                method: 'POST'
            });
            const result = await response.json().catch(function() {
                return {};
            });

            if (!response.ok) {
                const requestError = buildRequestError(result, 'We could not complete that request.');
                applyFieldErrors(
                    form,
                    requestError.fields,
                    {
                        confirm_password: '[data-auth-confirm]',
                        display_name: 'input[name="display_name"]',
                        email: 'input[name="email"]',
                        password: 'input[name="password"]'
                    },
                    { messageSelector: '.auth-modal__error' }
                );
                setAuthFormError(form, Object.keys(requestError.fields || {}).length ? '' : requestError.message);
                requestError.handledByAuthForm = true;
                throw requestError;
            }

            window.location.assign(result.redirect_to || '/home');
        } catch (error) {
            if (!error || !error.handledByAuthForm) {
                setAuthFormError(form, error && error.message ? error.message : 'We could not complete that request.');
            }
        } finally {
            if (submitButton) {
                setButtonLoading(submitButton, false);
            }
        }
    });
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
        initializeClimbFormValidation(form);
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

        setButtonLoading(button, true);
        setLoadingRegion(panel, true, { message: 'Updating your peak status...' });

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
            setLoadingRegion(panel, false);
            setButtonLoading(button, false);
        }
    });

    if (notesInput) {
        notesInput.addEventListener('input', function() {
            syncPeakLogNotesCounter(form);
            clearFieldError(notesInput);
            setPeakLogFormError(panel, '');
        });
        syncPeakLogNotesCounter(form);
    }

    if (photoInput) {
        photoInput.addEventListener('change', function() {
            const validationMessage = validatePeakLogPhotos(photoInput.files);
            clearFieldError(photoInput);
            if (validationMessage) {
                photoInput.value = '';
                syncPeakLogPhotoSummary(form);
                setFieldError(photoInput, validationMessage);
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
            const validation = validateClimbFormClient(form);
            if (!validation.isValid) {
                setPeakLogFormError(panel, getFirstFieldErrorMessage(validation.fieldErrors));
                return;
            }

            setPeakLogFormError(panel, '');
            setPeakTrackingMessage(panel, '', false);
            if (submitButton) {
                setButtonLoading(submitButton, true);
            }
            togglePeakLogFormBusy(form, true);
            setLoadingRegion(panel, true, { message: 'Logging your summit...' });

            try {
                formData.set('peak_id', String(peakId));
                const result = await postFormDataRequest('/api/log-climb', formData);
                updatePeakTrackingPanel(panel, result.user_status);
                const userClimbSection = findUserClimbLogSection(peakId);
                if (userClimbSection && result.climb) {
                    upsertUserClimbItem(userClimbSection, result.climb);
                }
                closePeakLogForm(panel, form, true);
                const successMessage = result.removed_from_bucket_list
                    ? 'Summit logged and removed from your bucket list.'
                    : (result.already_climbed
                        ? 'This summit is already logged.'
                        : 'Summit logged successfully.');
                setPeakTrackingMessage(panel, successMessage, false);
                showToast(successMessage, 'success');
                if (result.warning) {
                    window.setTimeout(function() {
                        showToast(result.warning, 'warning');
                    }, 320);
                }
            } catch (error) {
                applyFieldErrors(form, error.fields, getClimbFieldSelectorMap());
                setPeakLogFormError(panel, error.message || 'We could not save this summit right now.');
                showToast(error.message || 'We could not save this summit right now.', 'error');
            } finally {
                togglePeakLogFormBusy(form, false);
                setLoadingRegion(panel, false);
                if (submitButton) {
                    setButtonLoading(submitButton, false);
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

    const clearUserClimbValidationState = function(event) {
        const form = event.target.closest('[data-user-climb-edit-form]');
        if (!form) {
            return;
        }

        if (event.target.matches('[data-peak-log-notes]')) {
            syncPeakLogNotesCounter(form);
            setUserClimbFormError(form.closest('[data-user-climb-item]'), '');
            clearFieldError(event.target);
            return;
        }

        if (event.target.matches('[data-user-climb-date], [data-user-climb-weather]')) {
            clearFieldError(event.target);
        }
    };

    section.addEventListener('input', clearUserClimbValidationState);
    section.addEventListener('change', clearUserClimbValidationState);

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

            setButtonLoading(actionButton, true);
            setLoadingRegion(item, true, { message: 'Deleting climb log...' });

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
                showToast(error.message || 'We could not delete that climb log right now.', 'error');
            } finally {
                if (item.isConnected) {
                    setLoadingRegion(item, false);
                }
                setButtonLoading(actionButton, false);
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

        const validation = validateClimbFormClient(form);
        if (!validation.isValid) {
            setUserClimbFormError(item, getFirstFieldErrorMessage(validation.fieldErrors));
            return;
        }

        setUserClimbFormError(item, '');
        if (submitButton) {
            setButtonLoading(submitButton, true);
        }
        togglePeakLogFormBusy(form, true);
        setLoadingRegion(item, true, { message: 'Saving climb changes...' });

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
            applyFieldErrors(form, error.fields, getClimbFieldSelectorMap());
            setUserClimbFormError(item, error.message || 'We could not save that climb log right now.');
            showToast(error.message || 'We could not save that climb log right now.', 'error');
        } finally {
            togglePeakLogFormBusy(form, false);
            if (item.isConnected) {
                setLoadingRegion(item, false);
            }
            if (submitButton) {
                setButtonLoading(submitButton, false);
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
        initializeClimbFormValidation(form);
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
        clearFormFieldErrors(form);
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
    article.appendChild(body);
    list.insertBefore(article, list.firstChild);
    refreshTimeAgo(article);
    syncPeakCommentEmptyState(section);
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
window.deleteJsonRequest = deleteJsonRequest;
window.getTodayDateValueLocal = getTodayDateValueLocal;
window.initializeClimbFormValidation = initializeClimbFormValidation;
window.postFormDataRequest = postFormDataRequest;
window.postJsonRequest = postJsonRequest;
window.putJsonRequest = putJsonRequest;
window.setButtonLoading = setButtonLoading;
window.setFieldError = setFieldError;
window.setLoadingRegion = setLoadingRegion;
window.showToast = showToast;
window.syncPeakLogNotesCounter = syncPeakLogNotesCounter;
window.syncPeakLogPhotoSummary = syncPeakLogPhotoSummary;
window.togglePeakLogFormBusy = togglePeakLogFormBusy;
window.validateClimbFormClient = validateClimbFormClient;
window.validatePeakLogPhotos = validatePeakLogPhotos;
window.setPeakLogStarRating = setPeakLogStarRating;

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
