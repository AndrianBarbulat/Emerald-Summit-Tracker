const LANDING_MAP_PROVINCE_COLORS = {
    munster: '#74C69D',
    leinster: '#5B8FB9',
    ulster: '#E67E22',
    connacht: '#8E6BB5'
};

document.addEventListener('DOMContentLoaded', function() {
    initLandingMap();
    initPeakDetailMap();
});

function scheduleLeafletLayoutRefresh(map, options) {
    if (!map || typeof map.invalidateSize !== 'function') {
        return;
    }

    const refreshOptions = options || {};
    const center = Array.isArray(refreshOptions.center) ? refreshOptions.center : null;

    const refresh = function() {
        const container = map.getContainer ? map.getContainer() : null;
        if (!container || !container.isConnected) {
            return;
        }

        map.invalidateSize({ pan: false });
        if (center) {
            map.setView(center, map.getZoom(), { animate: false });
        }
    };

    window.requestAnimationFrame(function() {
        window.requestAnimationFrame(refresh);
    });

    window.setTimeout(refresh, 180);
}

function getProvinceColor(provinceName) {
    const provinceKey = String(provinceName || '').trim().toLowerCase();
    return LANDING_MAP_PROVINCE_COLORS[provinceKey] || '#74C69D';
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

function formatPeakHeightLabel(peak) {
    const heightUnit = document.body && document.body.dataset.heightUnit === 'ft' ? 'ft' : 'm';
    const rawHeight = peak.height_m === null || peak.height_m === undefined ? peak.height : peak.height_m;
    const metricHeight = rawHeight === null || rawHeight === undefined ? null : Number(rawHeight);
    const imperialHeight = peak.height_ft === null || peak.height_ft === undefined ? null : Number(peak.height_ft);

    if (heightUnit === 'ft') {
        if (Number.isFinite(imperialHeight)) {
            return Math.round(imperialHeight) + 'ft';
        }
        if (Number.isFinite(metricHeight)) {
            return Math.round(metricHeight * 3.28084) + 'ft';
        }
        return '';
    }

    if (Number.isFinite(metricHeight)) {
        return Math.round(metricHeight) + 'm';
    }
    if (Number.isFinite(imperialHeight)) {
        return Math.round(imperialHeight / 3.28084) + 'm';
    }
    return '';
}

function initLandingMap() {
    const mapElement = document.getElementById('peak-map');
    if (!mapElement || !window.L) {
        return;
    }

    const map = L.map('peak-map').setView([53.15, -7.95], 7.5);
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

        const popupCounty = peak.county ? '<br>' + window.escapeHtml(peak.county) : '';
        const popupProvince = peak.province ? '<br>' + window.escapeHtml(peak.province) : '';
        const popupHeightLabel = formatPeakHeightLabel(peak);
        const popupHeight = popupHeightLabel ? '<br>' + window.escapeHtml(popupHeightLabel) : '';
        const markerColor = getProvinceColor(peak.province);
        const peakStatus = window.normalizePeakStatusValue(peak.user_status);
        const popupStatus = statusTrackingEnabled
            ? '<div class="landing-map-popup-status">' + window.getPeakStatusMarkupFragment(peakStatus) + '</div>'
            : '';

        L.circleMarker([lat, lon], buildMapMarkerOptions(markerColor, peakStatus, statusTrackingEnabled))
            .bindPopup('<b>' + window.escapeHtml(peak.name || 'Unnamed Peak') + '</b>' + popupCounty + popupProvince + popupHeight + popupStatus)
            .addTo(map);
    });
}

function initPeakDetailMap() {
    const peakDetailMapElement = document.getElementById('peak-detail-map');
    const peakDetailMapRegion = peakDetailMapElement ? peakDetailMapElement.closest('[data-peak-detail-map-region]') : null;
    const rawPeakLat = window.peakLat;
    const rawPeakLng = window.peakLng;
    const peakLat = rawPeakLat === null || rawPeakLat === undefined ? NaN : Number(rawPeakLat);
    const peakLng = rawPeakLng === null || rawPeakLng === undefined ? NaN : Number(rawPeakLng);
    if (!peakDetailMapElement || !window.L || !Number.isFinite(peakLat) || !Number.isFinite(peakLng)) {
        return;
    }

    if (peakDetailMapRegion) {
        window.setLoadingRegion(peakDetailMapRegion, true, { message: 'Loading topo map...' });
    }

    const peakDetailMap = L.map('peak-detail-map').setView([peakLat, peakLng], 13);
    const refreshPeakDetailMapLayout = function() {
        scheduleLeafletLayoutRefresh(peakDetailMap, {
            center: [peakLat, peakLng]
        });
    };

    const tileLayer = L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'
    }).addTo(peakDetailMap);

    tileLayer.once('load', function() {
        refreshPeakDetailMapLayout();
        if (peakDetailMapRegion) {
            window.setLoadingRegion(peakDetailMapRegion, false);
        }
    });

    L.circleMarker([peakLat, peakLng], {
        color: '#FFFFFF',
        fillColor: '#D4A853',
        fillOpacity: 1,
        radius: 9,
        weight: 3
    }).addTo(peakDetailMap);

    refreshPeakDetailMapLayout();
    window.addEventListener('load', refreshPeakDetailMapLayout, { once: true });
    window.addEventListener('pageshow', refreshPeakDetailMapLayout);

    window.setTimeout(function() {
        refreshPeakDetailMapLayout();
        if (peakDetailMapRegion) {
            window.setLoadingRegion(peakDetailMapRegion, false);
        }
    }, 1400);
}

window.EmeraldMap = Object.assign(window.EmeraldMap || {}, {
    buildMapMarkerOptions: buildMapMarkerOptions,
    formatPeakHeightLabel: formatPeakHeightLabel,
    getProvinceColor: getProvinceColor,
    provinceColors: Object.assign({}, LANDING_MAP_PROVINCE_COLORS)
});
