document.addEventListener('DOMContentLoaded', function() {
    if (!Array.isArray(window.peaksData)) {
        return;
    }

    const pageSize = Number(window.summitListConfig && window.summitListConfig.pageSize) || 25;
    const heightUnit = window.summitListConfig && window.summitListConfig.heightUnit === 'ft' ? 'ft' : 'm';
    const statusColumnVisible = Boolean(window.summitListConfig && window.summitListConfig.statusColumnVisible);
    const provinces = ['Munster', 'Leinster', 'Ulster', 'Connacht'];
    const feetPerMeter = 3.28084;
    const filterDebounceDelay = 300;

    const elements = {
        search: document.getElementById('summit-search'),
        province: document.getElementById('summit-province'),
        county: document.getElementById('summit-county'),
        heightMin: document.getElementById('summit-height-min'),
        heightMax: document.getElementById('summit-height-max'),
        sort: document.getElementById('summit-sort'),
        clear: document.getElementById('summit-clear-filters'),
        count: document.getElementById('summit-results-count'),
        tableBody: document.getElementById('summit-table-body'),
        cardGrid: document.getElementById('summit-card-grid'),
        emptyState: document.getElementById('summit-empty-state'),
        prev: document.getElementById('summit-pagination-prev'),
        next: document.getElementById('summit-pagination-next'),
        paginationInfo: document.getElementById('summit-pagination-info')
    };

    if (!elements.tableBody || !elements.cardGrid) {
        return;
    }

    const state = {
        search: '',
        province: '',
        county: '',
        minHeight: '',
        maxHeight: '',
        sort: 'height-desc',
        page: 1
    };
    let currentFilteredPeaks = [];
    let filterDebounceTimer = null;

    const peaks = window.peaksData.map(function(peak) {
        return {
            id: peak.id,
            name: (peak.name || 'Unnamed Peak').trim(),
            nameKey: normalizeValue(peak.name),
            heightRank: toNumber(peak.height_rank),
            heightM: toNumber(peak.height_m || peak.height),
            prominenceM: toNumber(peak.prominence_m),
            county: (peak.county || '').trim(),
            countyKey: normalizeValue(peak.county),
            province: (peak.province || '').trim(),
            provinceKey: normalizeValue(peak.province),
            userStatus: String(peak.user_status || 'none').trim().toLowerCase()
        };
    });

    populateCountyOptions(peaks, state.province);
    updateHeightInputPlaceholders(peaks);

    elements.search.addEventListener('input', function() {
        scheduleDebouncedFilters();
    });

    elements.province.addEventListener('change', function() {
        syncFilterInputs();
        state.province = elements.province.value;
        populateCountyOptions(peaks, state.province);
        state.county = elements.county.value;
        state.page = 1;
        applyFilters();
    });

    elements.county.addEventListener('change', function() {
        syncFilterInputs();
        state.county = elements.county.value;
        state.page = 1;
        applyFilters();
    });

    elements.heightMin.addEventListener('input', function() {
        scheduleDebouncedFilters();
    });

    elements.heightMax.addEventListener('input', function() {
        scheduleDebouncedFilters();
    });

    elements.sort.addEventListener('change', function() {
        syncFilterInputs();
        state.sort = elements.sort.value;
        state.page = 1;
        applyFilters();
    });

    elements.clear.addEventListener('click', function() {
        window.clearTimeout(filterDebounceTimer);
        state.search = '';
        state.province = '';
        state.county = '';
        state.minHeight = '';
        state.maxHeight = '';
        state.sort = 'height-desc';
        state.page = 1;

        elements.search.value = '';
        elements.province.value = '';
        populateCountyOptions(peaks, '');
        elements.county.value = '';
        elements.heightMin.value = '';
        elements.heightMax.value = '';
        elements.sort.value = 'height-desc';
        applyFilters();
    });

    elements.prev.addEventListener('click', function() {
        if (state.page > 1) {
            state.page -= 1;
            render(currentFilteredPeaks);
        }
    });

    elements.next.addEventListener('click', function() {
        const totalPages = getTotalPages(currentFilteredPeaks.length, pageSize);
        if (state.page < totalPages) {
            state.page += 1;
            render(currentFilteredPeaks);
        }
    });

    applyFilters();

    function applyFilters() {
        const minHeight = toHeightInMeters(state.minHeight);
        const maxHeight = toHeightInMeters(state.maxHeight);

        currentFilteredPeaks = peaks
            .filter(function(peak) {
                const matchesSearch = !state.search || peak.nameKey.includes(state.search);
                const matchesProvince = !state.province || peak.province === state.province;
                const matchesCounty = !state.county || peak.county === state.county;
                const matchesMinHeight = minHeight === null || (peak.heightM !== null && peak.heightM >= minHeight);
                const matchesMaxHeight = maxHeight === null || (peak.heightM !== null && peak.heightM <= maxHeight);

                return matchesSearch && matchesProvince && matchesCounty && matchesMinHeight && matchesMaxHeight;
            })
            .sort(compareBy(state.sort));

        render(currentFilteredPeaks);
    }

    function render(filteredPeaks) {
        const totalPages = getTotalPages(filteredPeaks.length, pageSize);
        state.page = Math.min(state.page, totalPages);

        const startIndex = (state.page - 1) * pageSize;
        const visiblePeaks = filteredPeaks.slice(startIndex, startIndex + pageSize);

        elements.count.textContent = 'Showing ' + filteredPeaks.length + ' of ' + peaks.length + ' peaks';
        elements.paginationInfo.textContent = filteredPeaks.length
            ? 'Page ' + state.page + ' of ' + totalPages
            : 'Page 0 of 0';

        elements.prev.disabled = state.page <= 1 || !filteredPeaks.length;
        elements.next.disabled = state.page >= totalPages || !filteredPeaks.length;

        elements.emptyState.classList.toggle('is-hidden', filteredPeaks.length > 0);
        elements.tableBody.innerHTML = visiblePeaks.map(renderTableRow).join('');
        elements.cardGrid.innerHTML = visiblePeaks.map(renderCard).join('');
    }

    function renderTableRow(peak) {
        const cells = [
            '<td>' + renderRank(peak.heightRank) + '</td>',
            '<td><a class="summit-list-table__link" href="/peak/' + encodeURIComponent(peak.id) + '">' + escapeHtml(peak.name) + '</a></td>',
            '<td>' + formatMeters(peak.heightM) + '</td>',
            '<td>' + formatMeters(peak.prominenceM) + '</td>',
            '<td>' + escapeHtml(peak.county || '-') + '</td>',
            '<td>' + escapeHtml(peak.province || '-') + '</td>'
        ];

        if (statusColumnVisible) {
            cells.push('<td>' + renderStatus(peak.userStatus) + '</td>');
        }

        return '<tr>' + cells.join('') + '</tr>';
    }

    function renderCard(peak) {
        const cardParts = [
            '<article class="summit-card">',
            '<div class="summit-card__header">',
            '<div>',
            '<p class="summit-card__rank">Rank ' + renderRank(peak.heightRank) + '</p>',
            '<h3 class="summit-card__title"><a href="/peak/' + encodeURIComponent(peak.id) + '">' + escapeHtml(peak.name) + '</a></h3>',
            '</div>',
            peak.province ? '<span class="summit-card__province">' + escapeHtml(peak.province) + '</span>' : '',
            '</div>',
            '<div class="summit-card__meta-grid">',
            renderCardMeta('Height', formatMeters(peak.heightM)),
            renderCardMeta('Prominence', formatMeters(peak.prominenceM)),
            renderCardMeta('County', escapeHtml(peak.county || '-')),
            renderCardMeta('Province', escapeHtml(peak.province || '-')),
            '</div>'
        ];

        if (statusColumnVisible) {
            cardParts.push('<div class="summit-card__status">' + renderStatus(peak.userStatus, true) + '</div>');
        }

        cardParts.push('</article>');
        return cardParts.join('');
    }

    function renderCardMeta(label, value) {
        return [
            '<div class="summit-card__meta">',
            '<span class="summit-card__meta-label">', label, '</span>',
            '<span class="summit-card__meta-value">', value, '</span>',
            '</div>'
        ].join('');
    }

    function renderStatus(status, showLabel) {
        const normalizedStatus = status === 'climbed' || status === 'bucket' ? status : 'none';
        const iconMap = {
            climbed: 'fa-circle-check',
            bucket: 'fa-bookmark',
            none: 'fa-minus'
        };
        const labelMap = {
            climbed: 'Climbed',
            bucket: 'Bucket List',
            none: 'Neither'
        };

        return [
            '<span class="summit-status summit-status--', normalizedStatus, '" aria-label="', labelMap[normalizedStatus], '" title="', labelMap[normalizedStatus], '">',
            '<span class="icon" aria-hidden="true"><i class="fas ', iconMap[normalizedStatus], '"></i></span>',
            showLabel ? '<span>' + labelMap[normalizedStatus] + '</span>' : '',
            '</span>'
        ].join('');
    }

    function populateCountyOptions(allPeaks, selectedProvince) {
        const counties = uniqueValues(
            allPeaks.filter(function(peak) {
                return !selectedProvince || peak.province === selectedProvince;
            }),
            'county'
        );
        const previousValue = elements.county.value;

        elements.county.innerHTML = ['<option value="">All</option>']
            .concat(counties.map(function(county) {
                return '<option value="' + escapeHtml(county) + '">' + escapeHtml(county) + '</option>';
            }))
            .join('');

        if (counties.includes(previousValue)) {
            elements.county.value = previousValue;
        } else {
            elements.county.value = '';
        }
    }

    function updateHeightInputPlaceholders(allPeaks) {
        const heights = allPeaks
            .map(function(peak) {
                return peak.heightM;
            })
            .filter(function(height) {
                return Number.isFinite(height);
            });

        if (!heights.length) {
            return;
        }

        elements.heightMin.placeholder = formatHeightPlaceholder(Math.min.apply(null, heights));
        elements.heightMax.placeholder = formatHeightPlaceholder(Math.max.apply(null, heights));
    }

    function uniqueValues(allPeaks, field) {
        const values = new Set();

        allPeaks.forEach(function(peak) {
            if (field === 'province' && !provinces.includes(peak[field])) {
                return;
            }

            if (peak[field]) {
                values.add(peak[field]);
            }
        });

        return Array.from(values).sort(function(left, right) {
            return left.localeCompare(right);
        });
    }

    function compareBy(sortKey) {
        return function(left, right) {
            switch (sortKey) {
                case 'height-desc':
                    return compareNumbersDescending(left.heightM, right.heightM, left.name, right.name);
                case 'height-asc':
                    return compareNumbers(left.heightM, right.heightM, left.name, right.name);
                case 'prominence-desc':
                    return compareNumbersDescending(left.prominenceM, right.prominenceM, left.name, right.name);
                case 'name-asc':
                    return left.name.localeCompare(right.name);
                case 'name-desc':
                    return right.name.localeCompare(left.name);
                case 'rank-asc':
                    return compareNumbers(left.heightRank, right.heightRank, left.name, right.name);
                default:
                    return compareNumbersDescending(left.heightM, right.heightM, left.name, right.name);
            }
        };
    }

    function compareNumbers(leftNumber, rightNumber, leftName, rightName) {
        const leftValue = Number.isFinite(leftNumber) ? leftNumber : Number.POSITIVE_INFINITY;
        const rightValue = Number.isFinite(rightNumber) ? rightNumber : Number.POSITIVE_INFINITY;
        if (leftValue === rightValue) {
            return leftName.localeCompare(rightName);
        }
        return leftValue - rightValue;
    }

    function compareNumbersDescending(leftNumber, rightNumber, leftName, rightName) {
        const leftValue = Number.isFinite(leftNumber) ? leftNumber : Number.NEGATIVE_INFINITY;
        const rightValue = Number.isFinite(rightNumber) ? rightNumber : Number.NEGATIVE_INFINITY;
        if (leftValue === rightValue) {
            return leftName.localeCompare(rightName);
        }
        return rightValue - leftValue;
    }

    function compareStrings(leftValue, rightValue, leftName, rightName) {
        const comparison = String(leftValue || '').localeCompare(String(rightValue || ''));
        return comparison || leftName.localeCompare(rightName);
    }

    function formatMeters(value) {
        return Number.isFinite(value) ? value + 'm' : '-';
    }

    function renderRank(value) {
        return Number.isFinite(value) ? String(value) : '-';
    }

    function getTotalPages(count, size) {
        return Math.max(1, Math.ceil(count / size));
    }

    function normalizeValue(value) {
        return String(value || '').trim().toLowerCase();
    }

    function scheduleDebouncedFilters() {
        window.clearTimeout(filterDebounceTimer);
        filterDebounceTimer = window.setTimeout(function() {
            syncFilterInputs();
            state.page = 1;
            applyFilters();
        }, filterDebounceDelay);
    }

    function syncFilterInputs() {
        window.clearTimeout(filterDebounceTimer);
        state.search = normalizeValue(elements.search.value);
        state.minHeight = elements.heightMin.value.trim();
        state.maxHeight = elements.heightMax.value.trim();
    }

    function toHeightInMeters(value) {
        const numericValue = toNumber(value);
        if (numericValue === null) {
            return null;
        }

        return heightUnit === 'ft' ? numericValue / feetPerMeter : numericValue;
    }

    function formatHeightPlaceholder(heightM) {
        if (!Number.isFinite(heightM)) {
            return '';
        }

        const convertedHeight = heightUnit === 'ft'
            ? Math.round(heightM * feetPerMeter)
            : Math.round(heightM);
        return convertedHeight + ' ' + heightUnit;
    }

    function toNumber(value) {
        if (value === null || value === undefined) {
            return null;
        }

        if (typeof value === 'string' && value.trim() === '') {
            return null;
        }

        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
});
