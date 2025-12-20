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

function isValidEmailAddress(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
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
