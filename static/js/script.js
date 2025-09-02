document.addEventListener('DOMContentLoaded', function() {
    const navbarBurger = document.querySelector('.navbar-burger');
    if (navbarBurger) {
        navbarBurger.addEventListener('click', function() {
            const targetId = navbarBurger.dataset.target;
            const navbarMenu = targetId ? document.getElementById(targetId) : null;
            if (!navbarMenu) {
                return;
            }

            const isActive = navbarBurger.classList.toggle('is-active');
            navbarMenu.classList.toggle('is-active', isActive);
            navbarBurger.setAttribute('aria-expanded', isActive ? 'true' : 'false');
        });
    }

    const mapElement = document.getElementById('peak-map');
    if (mapElement && window.L) {
        const map = L.map('peak-map').setView([53.15, -7.95], 7.5);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap, CartoDB'
        }).addTo(map);

        const peaks = Array.isArray(window.peaksData) ? window.peaksData : [];
        peaks.forEach(peak => {
            const lat = Number(peak.latitude);
            const lon = Number(peak.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                return;
            }

            const popupCounty = peak.county ? `<br>${peak.county}` : '';
            const popupHeight = peak.height_m ? `<br>${peak.height_m}m` : '';
            L.marker([lat, lon])
                .bindPopup(`<b>${peak.name || 'Unnamed Peak'}</b>${popupCounty}${popupHeight}`)
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
