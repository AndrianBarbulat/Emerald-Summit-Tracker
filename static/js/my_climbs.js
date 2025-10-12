document.addEventListener('DOMContentLoaded', function() {
    initMyClimbsTable();
    initMyClimbsMap();
});

function initMyClimbsTable() {
    const table = document.querySelector('[data-my-climbs-table]');
    if (!table) {
        return;
    }

    table.addEventListener('click', function(event) {
        const toggleButton = event.target.closest('[data-climb-toggle]');
        if (!toggleButton) {
            return;
        }

        event.preventDefault();

        const climbId = String(toggleButton.getAttribute('data-climb-toggle') || '').trim();
        if (!climbId) {
            return;
        }

        const detailRow = table.querySelector('[data-climb-detail="' + climbId + '"]');
        if (!detailRow) {
            return;
        }

        const shouldOpen = detailRow.hasAttribute('hidden');

        table.querySelectorAll('[data-climb-detail]').forEach(function(otherRow) {
            otherRow.hidden = true;
            otherRow.classList.add('is-hidden');
        });

        table.querySelectorAll('[data-climb-toggle]').forEach(function(otherButton) {
            otherButton.setAttribute('aria-expanded', 'false');
        });

        if (shouldOpen) {
            detailRow.hidden = false;
            detailRow.classList.remove('is-hidden');
            toggleButton.setAttribute('aria-expanded', 'true');
        }
    });
}

function initMyClimbsMap() {
    const mapElement = document.querySelector('[data-my-climbs-map]');
    const markersData = Array.isArray(window.myClimbsMapData) ? window.myClimbsMapData : [];
    if (!mapElement || !window.L || !markersData.length) {
        return;
    }

    const map = L.map(mapElement, {
        scrollWheelZoom: false
    });

    L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'
    }).addTo(map);

    const markerLayer = L.featureGroup().addTo(map);

    markersData.forEach(function(point) {
        const lat = Number(point.latitude);
        const lng = Number(point.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return;
        }

        const climbCount = Number(point.climb_count) || 0;
        const latestClimbLabel = String(point.latest_climb_label || 'Unknown date');
        const climbMeta = climbCount > 1
            ? 'Climbed ' + climbCount + ' times, last on ' + latestClimbLabel
            : 'Last climbed on ' + latestClimbLabel;
        const peakName = escapeHtml(String(point.name || 'Unnamed Peak'));
        const peakUrl = '/peak/' + encodeURIComponent(String(point.peak_id || ''));

        const marker = L.circleMarker([lat, lng], {
            color: '#1B4332',
            fillColor: '#D4A853',
            fillOpacity: 0.96,
            radius: 8,
            weight: 3
        });

        marker.bindPopup(
            '<div class="my-climbs-map-popup">' +
                '<p class="my-climbs-map-popup__title">' + peakName + '</p>' +
                '<p class="my-climbs-map-popup__meta">' + escapeHtml(climbMeta) + '</p>' +
                '<a class="my-climbs-map-popup__link" href="' + peakUrl + '">View Peak</a>' +
            '</div>'
        );
        marker.addTo(markerLayer);
    });

    if (!markerLayer.getLayers().length) {
        return;
    }

    map.fitBounds(markerLayer.getBounds(), {
        maxZoom: 11,
        padding: [40, 40]
    });

    window.setTimeout(function() {
        map.invalidateSize();
    }, 0);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
