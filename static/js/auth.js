document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('form[data-auth-form]').forEach(function(authForm) {
        initializeAuthForm(authForm);
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

window.closeModal = closeModal;
window.openModal = openModal;
window.switchToLogin = switchToLogin;
window.switchToSignup = switchToSignup;
