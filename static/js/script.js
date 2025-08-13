document.addEventListener('DOMContentLoaded', function() {
    // Initialize map
    const map = L.map('peak-map').setView([53.15, -7.95], 7.5);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap, CartoDB'
    }).addTo(map);
    
    // Peak markers
    const peaks = [
        { name: "Carrauntoohil", coords: [51.9999, -9.7422], user: "Maeve" },
        { name: "Lugnaquilla", coords: [52.9669, -6.4645], user: "Rian" },
        { name: "Galtymore", coords: [52.3661, -8.1789], user: "Siobhán" },
        { name: "Mweelrea", coords: [53.6373, -9.8301], user: "Dara" }
    ];
    
    peaks.forEach(peak => {
        L.marker(peak.coords)
            .bindPopup(`<b>${peak.name}</b><br>submitted by ${peak.user}`)
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
window.addEventListener('click', function (event) {
    const modal = document.getElementById('auth-modal');
    if (event.target === modal) {
        closeModal();
    }
});

// Close with Escape key
document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
        closeModal();
    }
});