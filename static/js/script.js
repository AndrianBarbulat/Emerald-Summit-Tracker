document.addEventListener('DOMContentLoaded', function() {
    // Initialize map
    const map = L.map('peak-map').setView([53.15, -7.95], 7.5);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap, CartoDB'
    }).addTo(map);

    // Peak markers from server-rendered Supabase data.
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
});

function openModal(type) {
    document.getElementById('auth-modal').classList.add('is-active');

    if (type === 'login') {
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('signup-form').style.display = 'none';
        document.getElementById('modal-title').textContent = 'Login';
    } else {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('signup-form').style.display = 'block';
        document.getElementById('modal-title').textContent = 'Sign Up';
    }
}

function closeModal() {
    document.getElementById('auth-modal').classList.remove('is-active');
}

function switchToLogin() {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('signup-form').style.display = 'none';
    document.getElementById('modal-title').textContent = 'Login';
}

function switchToSignup() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('signup-form').style.display = 'block';
    document.getElementById('modal-title').textContent = 'Sign Up';
}

// Close modal if clicked outside
window.addEventListener('click', function(event) {
    const modal = document.getElementById('auth-modal');
    if (event.target === modal) {
        closeModal();
    }
});

// Close with Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeModal();
    }
});
