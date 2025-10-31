document.addEventListener('DOMContentLoaded', function() {
    initExploreMapPage();
});

function initExploreMapPage() {
    const page = document.querySelector('[data-explore-map-page]');
    const mapElement = page ? page.querySelector('[data-explore-map]') : null;
    if (!page || !mapElement || !window.L) {
        return;
    }

    const config = window.exploreMapConfig || {};
    const feetPerMeter = 3.28084;
    const statusLabels = {
        bucket_listed: 'Bucket Listed',
        climbed: 'Climbed',
        not_attempted: 'Not Attempted'
    };
    const statusTrackingEnabled = Boolean(config.statusTrackingEnabled);
    const heightUnit = config.heightUnit === 'ft' ? 'ft' : 'm';

    const elements = {
        countLabels: Array.from(page.querySelectorAll('[data-map-marker-count]')),
        county: page.querySelector('[data-map-filter="county"]'),
        heightMax: page.querySelector('[data-map-filter="max-height"]'),
        heightMin: page.querySelector('[data-map-filter="min-height"]'),
        province: page.querySelector('[data-map-filter="province"]'),
        region: page.querySelector('[data-explore-map-region]'),
        reset: page.querySelector('[data-map-reset]'),
        sidebar: page.querySelector('[data-map-sidebar]'),
        sidebarPanel: page.querySelector('[data-map-sidebar-panel]'),
        toggleButtons: Array.from(page.querySelectorAll('[data-map-sidebar-toggle]'))
    };

    const layerToggleElements = {
        all: page.querySelector('[data-map-layer-toggle="all"]'),
        bucket: page.querySelector('[data-map-layer-toggle="bucket"]'),
        climbed: page.querySelector('[data-map-layer-toggle="climbed"]')
    };

    const peaks = (Array.isArray(window.exploreMapPeaks) ? window.exploreMapPeaks : [])
        .map(function(peak) {
            const latitude = Number(peak.latitude);
            const longitude = Number(peak.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                return null;
            }

            const heightM = peak.height_m === null || peak.height_m === undefined ? null : Number(peak.height_m);
            const userStatus = normalizeMapStatus(peak.user_status);
            return {
                county: String(peak.county || '').trim(),
                heightM: Number.isFinite(heightM) ? heightM : null,
                id: peak.id,
                isBucketListed: userStatus === 'bucket_listed',
                isClimbed: userStatus === 'climbed',
                latitude: latitude,
                longitude: longitude,
                name: String(peak.name || 'Unnamed Peak').trim(),
                province: String(peak.province || '').trim(),
                provinceKey: normalizeProvinceKey(peak.province),
                userStatus: userStatus
            };
        })
        .filter(Boolean);

    const state = {
        county: '',
        hasFittedBounds: false,
        maxHeight: '',
        minHeight: '',
        province: '',
        sidebarOpen: !isExploreMapMobile(),
        visiblePeaks: []
    };

    const map = L.map(mapElement, {
        zoomControl: true
    }).setView(config.defaultCenter || [53.25, -8.1], Number(config.defaultZoom) || 7);

    map.createPane('mapOverlayClimbed');
    map.getPane('mapOverlayClimbed').style.zIndex = '640';
    map.createPane('mapOverlayBucket');
    map.getPane('mapOverlayBucket').style.zIndex = '650';

    const tileLayer = L.tileLayer('https://tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'
    });
    tileLayer.addTo(map);

    const baseLayer = typeof L.markerClusterGroup === 'function'
        ? L.markerClusterGroup({
            chunkedLoading: true,
            iconCreateFunction: buildClusterIcon,
            maxClusterRadius: 52,
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true
        })
        : L.layerGroup();
    const climbedOverlayLayer = L.layerGroup();
    const bucketOverlayLayer = L.layerGroup();

    map.addLayer(baseLayer);
    map.addLayer(climbedOverlayLayer);
    map.addLayer(bucketOverlayLayer);

    if (elements.region && typeof window.setLoadingRegion === 'function') {
        window.setLoadingRegion(elements.region, true, { message: 'Loading terrain map...' });
    }

    tileLayer.once('load', function() {
        if (elements.region && typeof window.setLoadingRegion === 'function') {
            window.setLoadingRegion(elements.region, false);
        }
    });
    window.setTimeout(function() {
        if (elements.region && typeof window.setLoadingRegion === 'function') {
            window.setLoadingRegion(elements.region, false);
        }
    }, 1400);

    populateCountyOptions(peaks, '');
    syncSidebarState();
    renderVisibleMarkers(true);

    if (elements.province) {
        elements.province.addEventListener('change', function() {
            state.province = elements.province.value;
            populateCountyOptions(peaks, state.province);
            state.county = elements.county ? elements.county.value : '';
            renderVisibleMarkers(true);
        });
    }

    if (elements.county) {
        elements.county.addEventListener('change', function() {
            state.county = elements.county.value;
            renderVisibleMarkers(true);
        });
    }

    [elements.heightMin, elements.heightMax].forEach(function(input) {
        if (!input) {
            return;
        }

        input.addEventListener('input', function() {
            state.minHeight = elements.heightMin ? String(elements.heightMin.value || '').trim() : '';
            state.maxHeight = elements.heightMax ? String(elements.heightMax.value || '').trim() : '';
            renderVisibleMarkers(true);
        });
    });

    Object.keys(layerToggleElements).forEach(function(layerKey) {
        const toggle = layerToggleElements[layerKey];
        if (!toggle) {
            return;
        }

        toggle.addEventListener('change', function() {
            renderVisibleMarkers(true);
        });
    });

    if (elements.reset) {
        elements.reset.addEventListener('click', function() {
            state.province = '';
            state.county = '';
            state.minHeight = '';
            state.maxHeight = '';

            if (elements.province) {
                elements.province.value = '';
            }
            populateCountyOptions(peaks, '');
            if (elements.county) {
                elements.county.value = '';
            }
            if (elements.heightMin) {
                elements.heightMin.value = '';
            }
            if (elements.heightMax) {
                elements.heightMax.value = '';
            }

            if (layerToggleElements.all) {
                layerToggleElements.all.checked = true;
            }
            if (layerToggleElements.climbed && !layerToggleElements.climbed.disabled) {
                layerToggleElements.climbed.checked = true;
            }
            if (layerToggleElements.bucket && !layerToggleElements.bucket.disabled) {
                layerToggleElements.bucket.checked = true;
            }

            renderVisibleMarkers(true);
        });
    }

    elements.toggleButtons.forEach(function(button) {
        button.addEventListener('click', function() {
            if (isExploreMapMobile()) {
                state.sidebarOpen = !elements.sidebar.classList.contains('is-open');
            } else {
                state.sidebarOpen = elements.sidebar.classList.contains('is-collapsed');
            }
            syncSidebarState();
        });
    });

    window.addEventListener('resize', function() {
        state.sidebarOpen = !isExploreMapMobile();
        syncSidebarState();
        window.setTimeout(function() {
            map.invalidateSize();
        }, 40);
    });

    function renderVisibleMarkers(shouldFitBounds) {
        const filteredPeaks = peaks.filter(matchesActiveFilters);
        const visiblePeaks = filteredPeaks.filter(isPeakVisibleInCurrentLayers);
        state.visiblePeaks = visiblePeaks;

        baseLayer.clearLayers();
        climbedOverlayLayer.clearLayers();
        bucketOverlayLayer.clearLayers();

        if (layerToggleElements.all && layerToggleElements.all.checked) {
            filteredPeaks.forEach(function(peak) {
                baseLayer.addLayer(buildBaseMarker(peak));
            });
        }

        if (statusTrackingEnabled && layerToggleElements.climbed && layerToggleElements.climbed.checked) {
            filteredPeaks.forEach(function(peak) {
                if (peak.isClimbed) {
                    climbedOverlayLayer.addLayer(buildClimbedOverlayMarker(peak));
                }
            });
        }

        if (statusTrackingEnabled && layerToggleElements.bucket && layerToggleElements.bucket.checked) {
            filteredPeaks.forEach(function(peak) {
                if (peak.isBucketListed) {
                    bucketOverlayLayer.addLayer(buildBucketOverlayMarker(peak));
                }
            });
        }

        updateVisibleCount(visiblePeaks.length);

        if (!visiblePeaks.length) {
            map.setView(config.defaultCenter || [53.25, -8.1], Number(config.defaultZoom) || 7);
            return;
        }

        if (shouldFitBounds || !state.hasFittedBounds) {
            const bounds = L.latLngBounds(
                visiblePeaks.map(function(peak) {
                    return [peak.latitude, peak.longitude];
                })
            );
            map.fitBounds(bounds, getMapFitOptions());
            state.hasFittedBounds = true;
        }
    }

    function matchesActiveFilters(peak) {
        const matchesProvince = !state.province || peak.province === state.province;
        const matchesCounty = !state.county || peak.county === state.county;
        const minHeightM = toMeters(state.minHeight);
        const maxHeightM = toMeters(state.maxHeight);
        const matchesMinHeight = minHeightM === null || (peak.heightM !== null && peak.heightM >= minHeightM);
        const matchesMaxHeight = maxHeightM === null || (peak.heightM !== null && peak.heightM <= maxHeightM);
        return matchesProvince && matchesCounty && matchesMinHeight && matchesMaxHeight;
    }

    function isPeakVisibleInCurrentLayers(peak) {
        if (layerToggleElements.all && layerToggleElements.all.checked) {
            return true;
        }

        const showClimbed = statusTrackingEnabled
            && layerToggleElements.climbed
            && layerToggleElements.climbed.checked
            && peak.isClimbed;
        const showBucket = statusTrackingEnabled
            && layerToggleElements.bucket
            && layerToggleElements.bucket.checked
            && peak.isBucketListed;
        return showClimbed || showBucket;
    }

    function buildBaseMarker(peak) {
        const provinceKey = peak.provinceKey || 'default';
        return L.marker([peak.latitude, peak.longitude], {
            icon: L.divIcon({
                className: 'explore-map-div-icon',
                html: '<span class="explore-map-marker explore-map-marker--' + escapeMapHtml(provinceKey) + '"></span>',
                iconAnchor: [8, 8],
                iconSize: [16, 16]
            })
        }).bindPopup(buildPopupMarkup(peak));
    }

    function buildClimbedOverlayMarker(peak) {
        return L.marker([peak.latitude, peak.longitude], {
            icon: L.divIcon({
                className: 'explore-map-div-icon',
                html: '<span class="explore-map-overlay-marker explore-map-overlay-marker--climbed"></span>',
                iconAnchor: [13, 13],
                iconSize: [26, 26]
            }),
            pane: 'mapOverlayClimbed'
        }).bindPopup(buildPopupMarkup(peak));
    }

    function buildBucketOverlayMarker(peak) {
        return L.marker([peak.latitude, peak.longitude], {
            icon: L.divIcon({
                className: 'explore-map-div-icon',
                html: '<span class="explore-map-overlay-marker explore-map-overlay-marker--bucket"><i class="fas fa-star" aria-hidden="true"></i></span>',
                iconAnchor: [13, 13],
                iconSize: [26, 26]
            }),
            pane: 'mapOverlayBucket'
        }).bindPopup(buildPopupMarkup(peak));
    }

    function buildPopupMarkup(peak) {
        const statusCopy = statusTrackingEnabled
            ? '<p class="explore-map-popup__status">Status: <strong>' + escapeMapHtml(statusLabels[peak.userStatus] || 'Not Attempted') + '</strong></p>'
            : '<p class="explore-map-popup__status">Sign up to track this peak.</p>';
        const countyCopy = peak.county ? escapeMapHtml(peak.county) : 'Unknown county';
        const provinceCopy = peak.province ? escapeMapHtml(peak.province) : 'Unknown province';
        const heightCopy = peak.heightM !== null ? String(Math.round(peak.heightM)) + 'm' : 'Height unknown';

        return ''
            + '<div class="explore-map-popup">'
            + '  <p class="explore-map-popup__title">' + escapeMapHtml(peak.name) + '</p>'
            + '  <p class="explore-map-popup__meta">' + escapeMapHtml(heightCopy) + ' - ' + countyCopy + ' - ' + provinceCopy + '</p>'
            +     statusCopy
            + '  <a class="explore-map-popup__link" href="/peak/' + encodeURIComponent(peak.id) + '">View Details</a>'
            + '</div>';
    }

    function buildClusterIcon(cluster) {
        const childCount = cluster.getChildCount();
        let sizeClass = 'small';
        if (childCount >= 25) {
            sizeClass = 'large';
        } else if (childCount >= 10) {
            sizeClass = 'medium';
        }

        return L.divIcon({
            className: 'explore-map-cluster',
            html: '<span class="explore-map-cluster__icon explore-map-cluster__icon--' + sizeClass + '">' + childCount + '</span>',
            iconAnchor: [30, 30],
            iconSize: sizeClass === 'large' ? [60, 60] : (sizeClass === 'medium' ? [52, 52] : [44, 44])
        });
    }

    function populateCountyOptions(allPeaks, province) {
        if (!elements.county) {
            return;
        }

        const previousValue = elements.county.value;
        const counties = Array.from(new Set(
            allPeaks
                .filter(function(peak) {
                    return !province || peak.province === province;
                })
                .map(function(peak) {
                    return peak.county;
                })
                .filter(function(county) {
                    return Boolean(county);
                })
        )).sort(function(left, right) {
            return left.localeCompare(right);
        });

        elements.county.innerHTML = ['<option value="">All counties</option>']
            .concat(counties.map(function(county) {
                return '<option value="' + escapeMapHtml(county) + '">' + escapeMapHtml(county) + '</option>';
            }))
            .join('');

        if (counties.indexOf(previousValue) !== -1) {
            elements.county.value = previousValue;
            return;
        }

        elements.county.value = '';
    }

    function updateVisibleCount(count) {
        const label = 'Showing ' + count + ' peak' + (count === 1 ? '' : 's');
        elements.countLabels.forEach(function(element) {
            element.textContent = label;
        });
    }

    function toMeters(value) {
        const numericValue = Number(value);
        if (!String(value || '').trim() || !Number.isFinite(numericValue)) {
            return null;
        }

        return heightUnit === 'ft' ? numericValue / feetPerMeter : numericValue;
    }

    function syncSidebarState() {
        if (!elements.sidebar) {
            return;
        }

        const isMobile = isExploreMapMobile();
        elements.sidebar.classList.toggle('is-open', state.sidebarOpen);
        elements.sidebar.classList.toggle('is-collapsed', !isMobile && !state.sidebarOpen);

        elements.toggleButtons.forEach(function(button) {
            const expanded = state.sidebarOpen ? 'true' : 'false';
            button.setAttribute('aria-expanded', expanded);
            const label = button.querySelector('[data-map-sidebar-toggle-label]');
            if (label) {
                label.textContent = state.sidebarOpen
                    ? String(button.getAttribute('data-expanded-label') || 'Hide Filters')
                    : String(button.getAttribute('data-collapsed-label') || 'Show Filters');
            }
        });
    }

    function getMapFitOptions() {
        if (isExploreMapMobile()) {
            return {
                maxZoom: 12,
                paddingBottomRight: [28, 240],
                paddingTopLeft: [28, 88]
            };
        }

        const sidebarWidth = elements.sidebar && !elements.sidebar.classList.contains('is-collapsed') ? 360 : 80;
        return {
            maxZoom: 12,
            paddingBottomRight: [40, 40],
            paddingTopLeft: [sidebarWidth, 40]
        };
    }
}

function normalizeMapStatus(value) {
    const normalizedValue = String(value || '').trim().toLowerCase();
    if (normalizedValue === 'climbed' || normalizedValue === 'bucket_listed' || normalizedValue === 'not_attempted') {
        return normalizedValue;
    }
    if (normalizedValue === 'bucket') {
        return 'bucket_listed';
    }
    return 'not_attempted';
}

function normalizeMapValue(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeProvinceKey(value) {
    const normalizedValue = normalizeMapValue(value).replace(/[^a-z]+/g, '-');
    return normalizedValue || 'default';
}

function isExploreMapMobile() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function escapeMapHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
