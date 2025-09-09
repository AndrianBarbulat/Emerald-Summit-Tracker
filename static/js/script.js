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

function openModal(type) {
    const modal = document.getElementById('auth-modal');
    if (!modal) {
        return;
    }

    modal.classList.add('is-active');

    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const modalTitle = document.getElementById('modal-title');
    if (!loginForm || !signupForm || !modalTitle) {
        return;
    }

    if (type === 'login') {
        loginForm.style.display = 'block';
        signupForm.style.display = 'none';
        modalTitle.textContent = 'Login';
        return;
    }

    loginForm.style.display = 'none';
    signupForm.style.display = 'block';
    modalTitle.textContent = 'Sign Up';
}

function closeModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) {
        modal.classList.remove('is-active');
    }
}

function switchToLogin() {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const modalTitle = document.getElementById('modal-title');
    if (!loginForm || !signupForm || !modalTitle) {
        return;
    }

    loginForm.style.display = 'block';
    signupForm.style.display = 'none';
    modalTitle.textContent = 'Login';
}

function switchToSignup() {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const modalTitle = document.getElementById('modal-title');
    if (!loginForm || !signupForm || !modalTitle) {
        return;
    }

    loginForm.style.display = 'none';
    signupForm.style.display = 'block';
    modalTitle.textContent = 'Sign Up';
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
