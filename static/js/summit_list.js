document.addEventListener('DOMContentLoaded', function() {
    if (!Array.isArray(window.peaksData)) {
        return;
    }

    const pageSize = Number(window.summitListConfig && window.summitListConfig.pageSize) || 25;
    const actionButtonsVisible = Boolean(window.summitListConfig && window.summitListConfig.actionButtonsVisible);
    const heightUnit = window.summitListConfig && window.summitListConfig.heightUnit === 'ft' ? 'ft' : 'm';
    const statusMarkup = window.peakStatusMarkup || {};
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
    const rowActionState = {
        bucketPendingPeakIds: {},
        errorsByPeakId: {},
        logForm: createDefaultLogForm(),
        logSubmittingPeakId: null,
        openLogPeakId: null
    };

    const peaks = window.peaksData.map(function(peak) {
        const initialStatus = normalizeStatusValue(peak.user_status);
        return {
            id: peak.id,
            peakKey: String(peak.id),
            name: (peak.name || 'Unnamed Peak').trim(),
            nameKey: normalizeValue(peak.name),
            heightRank: toNumber(peak.height_rank),
            heightM: toNumber(peak.height_m || peak.height),
            isBucketListed: Boolean(peak.is_bucket_listed || initialStatus === 'bucket_listed'),
            isClimbed: Boolean(peak.is_climbed || initialStatus === 'climbed'),
            prominenceM: toNumber(peak.prominence_m),
            county: (peak.county || '').trim(),
            countyKey: normalizeValue(peak.county),
            province: (peak.province || '').trim(),
            provinceKey: normalizeValue(peak.province),
            userStatus: initialStatus
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

    if (actionButtonsVisible) {
        elements.tableBody.addEventListener('click', handleRowActionClick);
        elements.tableBody.addEventListener('submit', handleLogClimbSubmit);
        document.addEventListener('click', handleOutsideActionClick);
        document.addEventListener('keydown', handleActionKeydown);
    }

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
        const peakStatus = getPeakStatus(peak);
        const cells = [
            '<td class="summit-list-table__rank-cell">' + renderRank(peak.heightRank) + '</td>',
            '<td><a class="summit-list-table__link" href="/peak/' + encodeURIComponent(peak.id) + '">' + escapeHtml(peak.name) + '</a></td>',
            '<td class="summit-list-table__metric-cell">' + formatElevation(peak.heightM) + '</td>',
            '<td class="summit-list-table__metric-cell">' + formatElevation(peak.prominenceM) + '</td>',
            '<td>' + escapeHtml(peak.county || '-') + '</td>',
            '<td>' + renderProvincePill(peak.province, 'summit-list-table__province-pill') + '</td>'
        ];

        if (statusColumnVisible) {
            cells.push('<td class="summit-list-table__status-cell">' + renderStatus(peakStatus) + '</td>');
        }

        if (actionButtonsVisible) {
            cells.push('<td class="summit-list-table__actions-cell">' + renderRowActions(peak) + '</td>');
        }

        return '<tr>' + cells.join('') + '</tr>';
    }

    function renderCard(peak) {
        const cardParts = [
            '<a class="summit-card summit-card--link" href="/peak/' + encodeURIComponent(peak.id) + '">',
            '<div class="summit-card__topline">',
            '<h3 class="summit-card__title">' + escapeHtml(peak.name) + '</h3>',
            statusColumnVisible ? renderStatus(getPeakStatus(peak)) : '',
            '</div>',
            '<p class="summit-card__metrics">' + formatInlineMetrics(peak) + '</p>',
            '<div class="summit-card__footer">',
            '<span class="summit-card__county">' + escapeHtml(peak.county || '-') + '</span>',
            renderProvincePill(peak.province, 'summit-card__province'),
            '</div>',
            '</a>'
        ];
        return cardParts.join('');
    }

    function renderStatus(status) {
        const normalizedStatus = normalizeStatusValue(status);
        if (statusMarkup[normalizedStatus]) {
            return statusMarkup[normalizedStatus];
        }

        const labelMap = {
            climbed: 'Climbed',
            bucket_listed: 'Bucket Listed',
            not_attempted: 'Not Attempted'
        };
        const iconMap = {
            climbed: 'fa-circle-check',
            bucket_listed: 'fa-bookmark',
            not_attempted: 'fa-minus'
        };

        return [
            '<span class="peak-status peak-status--', normalizedStatus.replace(/_/g, '-'), '" aria-label="', labelMap[normalizedStatus], '" title="', labelMap[normalizedStatus], '">',
            '<span class="icon peak-status__icon" aria-hidden="true"><i class="fas ', iconMap[normalizedStatus], '"></i></span>',
            '<span class="peak-status__label">', labelMap[normalizedStatus], '</span>',
            '</span>'
        ].join('');
    }

    function renderRowActions(peak) {
        const peakKey = peak.peakKey;
        const errorMessage = rowActionState.errorsByPeakId[peakKey];
        const isBucketPending = Boolean(rowActionState.bucketPendingPeakIds[peakKey]);
        const isLogSubmitting = rowActionState.logSubmittingPeakId === peakKey;
        const isModalOpen = rowActionState.openLogPeakId === peakKey;

        const actionParts = [
            '<div class="summit-list-row-actions">',
            '<div class="summit-list-row-actions__buttons">',
            renderLogActionButton(peak, isLogSubmitting),
            renderBucketActionButton(peak, isBucketPending),
            '</div>'
        ];

        if (isModalOpen) {
            actionParts.push(renderLogClimbForm(peak, isLogSubmitting));
        }

        if (errorMessage) {
            actionParts.push('<p class="summit-list-row-actions__error">' + escapeHtml(errorMessage) + '</p>');
        }

        actionParts.push('</div>');
        return actionParts.join('');
    }

    function renderLogActionButton(peak, isSubmitting) {
        const buttonClasses = ['button', 'is-small', 'summit-list-action-button'];
        const peakStatus = getPeakStatus(peak);

        if (peak.isClimbed) {
            buttonClasses.push('summit-list-action-button--complete');
            return [
                '<button type="button" class="', buttonClasses.join(' '), '" disabled title="Climb logged">',
                '<span class="icon" aria-hidden="true"><i class="fas fa-circle-check"></i></span>',
                '<span>Climbed</span>',
                '</button>'
            ].join('');
        }

        buttonClasses.push('summit-list-action-button--log');
        if (rowActionState.openLogPeakId === peak.peakKey) {
            buttonClasses.push('is-active');
        }

        return [
            '<button type="button" class="', buttonClasses.join(' '), '" data-action="open-log-climb" data-peak-id="', peak.peakKey, '"',
            isSubmitting ? ' disabled' : '',
            ' title="Log Climb">',
            '<span class="icon" aria-hidden="true"><i class="fas fa-mountain"></i></span>',
            '<span>', peakStatus === 'climbed' ? 'Climbed' : 'Log Climb', '</span>',
            '</button>'
        ].join('');
    }

    function renderBucketActionButton(peak, isPending) {
        const buttonClasses = ['button', 'is-small', 'summit-list-action-button', 'summit-list-action-button--bucket'];
        const actionLabel = peak.isClimbed
            ? 'Already Climbed'
            : (peak.isBucketListed ? 'Bucket Listed' : 'Add to Bucket List');
        if (peak.isBucketListed) {
            buttonClasses.push('is-active');
        }
        if (isPending) {
            buttonClasses.push('is-loading');
        }

        return [
            '<button type="button" class="', buttonClasses.join(' '), '" data-action="toggle-bucket" data-peak-id="', peak.peakKey, '"',
            (isPending || peak.isClimbed) ? ' disabled' : '',
            ' title="', escapeHtml(actionLabel), '">',
            '<span class="icon" aria-hidden="true"><i class="fas fa-bookmark"></i></span>',
            '<span>', escapeHtml(actionLabel), '</span>',
            '</button>'
        ].join('');
    }

    function renderLogClimbForm(peak, isSubmitting) {
        const formState = rowActionState.logForm;
        return [
            '<form class="summit-list-log-popover" data-log-climb-form data-peak-id="', peak.peakKey, '">',
            '<p class="summit-list-log-popover__title">Log climb for ', escapeHtml(peak.name), '</p>',
            '<div class="field">',
            '<label class="label" for="summit-log-date-', peak.peakKey, '">Date</label>',
            '<div class="control">',
            '<input id="summit-log-date-', peak.peakKey, '" class="input" type="date" name="climbed_at" value="', escapeHtml(formState.climbedAt), '"', isSubmitting ? ' disabled' : '', '>',
            '</div>',
            '</div>',
            '<div class="field">',
            '<label class="label" for="summit-log-difficulty-', peak.peakKey, '">Difficulty</label>',
            '<div class="control">',
            '<div class="select is-fullwidth">',
            '<select id="summit-log-difficulty-', peak.peakKey, '" name="difficulty"', isSubmitting ? ' disabled' : '', '>',
            renderDifficultyOptions(formState.difficulty),
            '</select>',
            '</div>',
            '</div>',
            '</div>',
            '<div class="field">',
            '<label class="label" for="summit-log-notes-', peak.peakKey, '">Notes</label>',
            '<div class="control">',
            '<textarea id="summit-log-notes-', peak.peakKey, '" class="textarea" name="notes" rows="2" placeholder="Trail conditions, weather, or a quick note..."', isSubmitting ? ' disabled' : '', '>', escapeHtml(formState.notes), '</textarea>',
            '</div>',
            '</div>',
            '<div class="summit-list-log-popover__buttons">',
            '<button type="button" class="button is-light is-small" data-action="close-log-climb" data-peak-id="', peak.peakKey, '"', isSubmitting ? ' disabled' : '', '>Cancel</button>',
            '<button type="submit" class="button is-small summit-list-log-popover__submit', isSubmitting ? ' is-loading' : '', '"', isSubmitting ? ' disabled' : '', '>Save Climb</button>',
            '</div>',
            '</form>'
        ].join('');
    }

    function renderDifficultyOptions(selectedDifficulty) {
        const difficulties = ['easy', 'moderate', 'hard'];
        return difficulties.map(function(difficulty) {
            const label = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
            const isSelected = selectedDifficulty === difficulty ? ' selected' : '';
            return '<option value="' + difficulty + '"' + isSelected + '>' + label + '</option>';
        }).join('');
    }

    function renderProvincePill(province, extraClassName) {
        if (!province) {
            return '<span class="summit-province-pill summit-province-pill--default' + buildExtraClass(extraClassName) + '">-</span>';
        }

        const provinceClassName = normalizeValue(province).replace(/[^a-z]+/g, '-');
        return [
            '<span class="summit-province-pill summit-province-pill--',
            provinceClassName,
            buildExtraClass(extraClassName),
            '">',
            escapeHtml(province),
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

    function formatElevation(value) {
        if (!Number.isFinite(value)) {
            return '-';
        }

        const displayValue = heightUnit === 'ft'
            ? Math.round(value * feetPerMeter)
            : Math.round(value);
        return displayValue + heightUnit;
    }

    function formatInlineMetrics(peak) {
        return [
            'Height ',
            formatElevation(peak.heightM),
            ' \u00b7 Prom. ',
            formatElevation(peak.prominenceM)
        ].join('');
    }

    function createDefaultLogForm() {
        return {
            climbedAt: getTodayDateValue(),
            difficulty: 'moderate',
            notes: ''
        };
    }

    function getPeakStatus(peak) {
        if (peak.isClimbed) {
            return 'climbed';
        }
        if (peak.isBucketListed) {
            return 'bucket_listed';
        }
        return 'not_attempted';
    }

    function handleRowActionClick(event) {
        const actionButton = event.target.closest('[data-action]');
        if (!actionButton) {
            return;
        }

        const actionName = actionButton.getAttribute('data-action');
        const peakKey = String(actionButton.getAttribute('data-peak-id') || '');
        if (!peakKey) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (actionName === 'open-log-climb') {
            toggleLogClimbPopover(peakKey);
            return;
        }

        if (actionName === 'close-log-climb') {
            closeLogClimbPopover();
            return;
        }

        if (actionName === 'toggle-bucket') {
            void toggleBucketListState(peakKey);
        }
    }

    function handleOutsideActionClick(event) {
        if (!rowActionState.openLogPeakId) {
            return;
        }

        if (event.target.closest('.summit-list-row-actions')) {
            return;
        }

        closeLogClimbPopover();
    }

    function handleActionKeydown(event) {
        if (event.key === 'Escape' && rowActionState.openLogPeakId) {
            closeLogClimbPopover();
        }
    }

    async function handleLogClimbSubmit(event) {
        const form = event.target.closest('[data-log-climb-form]');
        if (!form) {
            return;
        }

        event.preventDefault();
        const peakKey = String(form.getAttribute('data-peak-id') || '');
        if (!peakKey) {
            return;
        }

        const peak = findPeakByKey(peakKey);
        if (!peak) {
            return;
        }

        const formData = new FormData(form);
        rowActionState.logForm = {
            climbedAt: String(formData.get('climbed_at') || '').trim(),
            difficulty: String(formData.get('difficulty') || 'moderate').trim().toLowerCase(),
            notes: String(formData.get('notes') || '').trim()
        };

        if (!rowActionState.logForm.climbedAt) {
            setActionError(peakKey, 'Please choose a climb date.');
            render(currentFilteredPeaks);
            return;
        }

        clearActionError(peakKey);
        rowActionState.logSubmittingPeakId = peakKey;
        render(currentFilteredPeaks);

        try {
            const result = await postJson('/api/log-climb', {
                climbed_at: rowActionState.logForm.climbedAt,
                difficulty: rowActionState.logForm.difficulty,
                notes: rowActionState.logForm.notes,
                peak_id: peak.id
            });

            applyMembershipResponse(peakKey, result);
            rowActionState.logSubmittingPeakId = null;
            rowActionState.logForm = createDefaultLogForm();
            rowActionState.openLogPeakId = null;
            clearActionError(peakKey);
            render(currentFilteredPeaks);
            notifyToast(
                result.already_climbed ? 'This summit is already logged.' : 'Summit logged successfully.',
                'success'
            );
            if (result.warning) {
                notifyToast(result.warning, 'warning');
            }
        } catch (error) {
            rowActionState.logSubmittingPeakId = null;
            setActionError(peakKey, error.message || 'We could not save that climb.');
            render(currentFilteredPeaks);
            notifyToast(error.message || 'We could not save that climb.', 'error');
        }
    }

    function toggleLogClimbPopover(peakKey) {
        const peak = findPeakByKey(peakKey);
        if (!peak || peak.isClimbed) {
            return;
        }

        if (rowActionState.openLogPeakId === peakKey) {
            closeLogClimbPopover();
            return;
        }

        rowActionState.openLogPeakId = peakKey;
        rowActionState.logSubmittingPeakId = null;
        rowActionState.logForm = createDefaultLogForm();
        clearActionError(peakKey);
        render(currentFilteredPeaks);

        window.requestAnimationFrame(function() {
            const dateInput = document.getElementById('summit-log-date-' + peakKey);
            if (dateInput) {
                dateInput.focus();
            }
        });
    }

    function closeLogClimbPopover() {
        if (!rowActionState.openLogPeakId) {
            return;
        }

        const peakKey = rowActionState.openLogPeakId;
        rowActionState.openLogPeakId = null;
        rowActionState.logSubmittingPeakId = null;
        rowActionState.logForm = createDefaultLogForm();
        clearActionError(peakKey);
        render(currentFilteredPeaks);
    }

    async function toggleBucketListState(peakKey) {
        const peak = findPeakByKey(peakKey);
        if (!peak) {
            return;
        }

        const wasBucketListed = Boolean(peak.isBucketListed);
        clearActionError(peakKey);
        rowActionState.bucketPendingPeakIds[peakKey] = true;
        render(currentFilteredPeaks);

        try {
            const endpoint = wasBucketListed ? '/api/bucket-list/remove' : '/api/bucket-list/add';
            const result = await postJson(endpoint, { peak_id: peak.id });
            applyMembershipResponse(peakKey, result);
            clearActionError(peakKey);
            notifyToast(
                wasBucketListed ? 'Removed from your bucket list.' : 'Added to your bucket list.',
                'warning'
            );
        } catch (error) {
            setActionError(peakKey, error.message || 'We could not update your bucket list.');
            notifyToast(error.message || 'We could not update your bucket list.', 'error');
        } finally {
            delete rowActionState.bucketPendingPeakIds[peakKey];
            render(currentFilteredPeaks);
        }
    }

    function applyMembershipResponse(peakKey, responsePayload) {
        const peak = findPeakByKey(peakKey);
        if (!peak) {
            return;
        }

        peak.isBucketListed = Boolean(responsePayload && responsePayload.is_bucket_listed);
        peak.isClimbed = Boolean(responsePayload && responsePayload.is_climbed);
        peak.userStatus = normalizeStatusValue(responsePayload && responsePayload.user_status);
        if (peak.userStatus === 'not_attempted') {
            peak.userStatus = getPeakStatus(peak);
        }
    }

    function findPeakByKey(peakKey) {
        return peaks.find(function(peak) {
            return peak.peakKey === peakKey;
        }) || null;
    }

    function setActionError(peakKey, message) {
        if (!peakKey) {
            return;
        }
        rowActionState.errorsByPeakId[peakKey] = String(message || '').trim();
    }

    function clearActionError(peakKey) {
        if (!peakKey) {
            return;
        }
        delete rowActionState.errorsByPeakId[peakKey];
    }

    function notifyToast(message, type) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
        }
    }

    async function postJson(url, payload) {
        const response = await fetch(url, {
            body: JSON.stringify(payload),
            credentials: 'same-origin',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            method: 'POST'
        });

        const result = await response.json().catch(function() {
            return {};
        });

        if (!response.ok) {
            throw new Error(result.error || 'Something went wrong.');
        }

        return result;
    }

    function getTodayDateValue() {
        const now = new Date();
        const localTime = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
        return localTime.toISOString().slice(0, 10);
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

    function normalizeStatusValue(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'bucket') {
            return 'bucket_listed';
        }
        if (normalized === 'none') {
            return 'not_attempted';
        }
        if (normalized === 'climbed' || normalized === 'bucket_listed' || normalized === 'not_attempted') {
            return normalized;
        }
        return 'not_attempted';
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

    function buildExtraClass(className) {
        return className ? ' ' + className : '';
    }
});
