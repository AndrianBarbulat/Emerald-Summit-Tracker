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

            L.circleMarker([lat, lon], {
                color: '#FFFFFF',
                fillColor: markerColor,
                fillOpacity: 0.95,
                radius: 6,
                weight: 2
            })
                .bindPopup(`<b>${peak.name || 'Unnamed Peak'}</b>${popupCounty}${popupProvince}${popupHeight}`)
                .addTo(map);
        });
    }
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
