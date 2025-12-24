document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('[data-peak-log-form], [data-user-climb-edit-form]').forEach(function(form) {
        initializeClimbFormValidation(form);
    });

    document.querySelectorAll('[data-peak-tracking]').forEach(function(panel) {
        initPeakTrackingPanel(panel);
    });

    document.querySelectorAll('[data-user-climb-log-section]').forEach(function(section) {
        initUserClimbLogSection(section);
    });

    document.querySelectorAll('[data-peak-community]').forEach(function(section) {
        initPeakCommunitySection(section);
    });
});

function getTodayDateComparable() {
    return getTodayDateValueLocal();
}

function getDateValidationMessage(value) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
        return 'Please choose a climb date.';
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
        return 'Please choose a valid date.';
    }

    const dateParts = normalizedValue.split('-');
    const year = Number(dateParts[0]);
    const month = Number(dateParts[1]);
    const day = Number(dateParts[2]);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day) ||
        parsedDate.getUTCFullYear() !== year ||
        (parsedDate.getUTCMonth() + 1) !== month ||
        parsedDate.getUTCDate() !== day
    ) {
        return 'Please choose a valid date.';
    }

    if (normalizedValue > getTodayDateComparable()) {
        return 'Climb date cannot be in the future.';
    }

    return '';
}

function getNotesValidationMessage(value, maxLength) {
    const textValue = String(value || '');
    const limit = Number(maxLength || 500);
    if (textValue.length > limit) {
        return 'Notes must be ' + limit + ' characters or fewer.';
    }
    return '';
}

function getDifficultyValidationMessage(value) {
    const normalizedValue = String(value || '').trim();
    if (!normalizedValue) {
        return '';
    }

    const numericValue = Number(normalizedValue);
    if (!Number.isFinite(numericValue) || !Number.isInteger(numericValue) || numericValue < 1 || numericValue > 5) {
        return 'Difficulty rating must be between 1 and 5.';
    }

    return '';
}

function getClimbFieldSelectorMap(overrides) {
    return Object.assign(
        {
            date_climbed: '[data-peak-log-date], [data-user-climb-date], [data-my-climb-date], [data-dashboard-climb-date], [data-bucket-log-date], input[name="date_climbed"]',
            notes: '[data-peak-log-notes], textarea[name="notes"]',
            difficulty_rating: '[data-peak-star-rating-input], select[name="difficulty_rating"]',
            photos: '[data-peak-log-photos], input[type="file"][name="photos"]'
        },
        overrides || {}
    );
}

function validateClimbFormClient(form, selectorOverrides) {
    if (!form) {
        return { fieldErrors: {}, firstInvalidControl: null, isValid: true };
    }

    const selectorMap = getClimbFieldSelectorMap(selectorOverrides);
    const dateInput = form.querySelector(selectorMap.date_climbed);
    const notesInput = form.querySelector(selectorMap.notes);
    const difficultyInput = form.querySelector(selectorMap.difficulty_rating);
    const photoInput = form.querySelector(selectorMap.photos);
    const fieldErrors = {};

    clearFormFieldErrors(form);

    if (dateInput) {
        const dateMessage = getDateValidationMessage(dateInput.value);
        if (dateMessage) {
            fieldErrors.date_climbed = dateMessage;
        }
    }

    if (notesInput) {
        const notesMessage = getNotesValidationMessage(
            notesInput.value,
            Number(notesInput.getAttribute('maxlength') || 500)
        );
        if (notesMessage) {
            fieldErrors.notes = notesMessage;
        }
    }

    if (difficultyInput) {
        const difficultyMessage = getDifficultyValidationMessage(difficultyInput.value);
        if (difficultyMessage) {
            fieldErrors.difficulty_rating = difficultyMessage;
        }
    }

    if (photoInput) {
        const photoMessage = validatePeakLogPhotos(photoInput.files);
        if (photoMessage) {
            fieldErrors.photos = photoMessage;
        }
    }

    const firstInvalidControl = applyFieldErrors(form, fieldErrors, selectorMap);
    if (firstInvalidControl && typeof firstInvalidControl.focus === 'function') {
        firstInvalidControl.focus();
    }

    return {
        fieldErrors: fieldErrors,
        firstInvalidControl: firstInvalidControl,
        isValid: !Object.keys(fieldErrors).length
    };
}

function initializeClimbFormValidation(form, selectorOverrides) {
    if (!form || form.dataset.validationReady === 'true') {
        return;
    }

    form.dataset.validationReady = 'true';
    const selectorMap = getClimbFieldSelectorMap(selectorOverrides);
    const dateInput = form.querySelector(selectorMap.date_climbed);
    const notesInput = form.querySelector(selectorMap.notes);
    const difficultyInput = form.querySelector(selectorMap.difficulty_rating);
    const photoInput = form.querySelector(selectorMap.photos);

    if (dateInput) {
        dateInput.setAttribute('max', getTodayDateComparable());
        dateInput.addEventListener('input', function() {
            clearFieldError(dateInput);
        });
        dateInput.addEventListener('change', function() {
            clearFieldError(dateInput);
        });
    }

    if (notesInput) {
        notesInput.addEventListener('input', function() {
            syncPeakLogNotesCounter(form);
            clearFieldError(notesInput);
        });
        syncPeakLogNotesCounter(form);
    }

    if (difficultyInput && difficultyInput.matches('select')) {
        difficultyInput.addEventListener('change', function() {
            clearFieldError(difficultyInput);
        });
    }

    if (photoInput) {
        photoInput.addEventListener('change', function() {
            clearFieldError(photoInput);
            syncPeakLogPhotoSummary(form);
        });
        syncPeakLogPhotoSummary(form);
    }
}

function setPeakTrackingMessage(panel, message, isError) {
    const messageElement = panel ? panel.querySelector('[data-peak-tracking-message]') : null;
    if (!messageElement) {
        return;
    }

    messageElement.textContent = String(message || '').trim();
    messageElement.classList.toggle('is-error', Boolean(isError));
}

function getPeakTrackingDefaultMessage(status) {
    const normalizedStatus = normalizePeakStatusValue(status);
    if (normalizedStatus === 'climbed') {
        return 'Your climb is already logged.';
    }

    if (normalizedStatus === 'bucket_listed') {
        return 'Log your climb whenever you\'re ready.';
    }

    return 'Track this peak from here.';
}

function updatePeakTrackingPanel(panel, status) {
    if (!panel) {
        return;
    }

    const normalizedStatus = normalizePeakStatusValue(status);
    const actionsContainer = panel.querySelector('[data-peak-tracking-actions]');
    const statusChip = panel.querySelector('[data-peak-status-chip]');
    const form = panel.querySelector('[data-peak-log-form]');
    const logButton = panel.querySelector('[data-peak-track-action="log-climb"]');
    const bucketButton = panel.querySelector('[data-peak-track-action="toggle-bucket"]');

    panel.dataset.currentStatus = normalizedStatus;

    if (statusChip && getPeakStatusMarkupFragment(normalizedStatus)) {
        statusChip.innerHTML = getPeakStatusMarkupFragment(normalizedStatus);
        statusChip.hidden = normalizedStatus !== 'climbed';
    }

    if (logButton) {
        const logLabel = logButton.querySelector('span:last-child');
        logButton.disabled = normalizedStatus === 'climbed';
        if (logLabel) {
            logLabel.textContent = normalizedStatus === 'climbed' ? 'Climb Logged' : 'Log Climb';
        }
    }

    if (bucketButton) {
        const isBucketListed = normalizedStatus === 'bucket_listed';
        const bucketLabel = bucketButton.querySelector('span:last-child');
        bucketButton.dataset.bucketActive = isBucketListed ? 'true' : 'false';
        bucketButton.classList.toggle('is-active', isBucketListed);
        bucketButton.disabled = normalizedStatus === 'climbed';
        if (bucketLabel) {
            bucketLabel.textContent = isBucketListed ? 'Remove from Bucket List' : 'Add to Bucket List';
        }
    }

    if (actionsContainer) {
        actionsContainer.hidden = normalizedStatus === 'climbed';
    }

    if (normalizedStatus === 'climbed') {
        closePeakLogForm(panel, form, true);
    }

    setPeakTrackingMessage(panel, getPeakTrackingDefaultMessage(normalizedStatus), false);
}

function showLeaderboardRankImprovementToast(result, delayMs) {
    if (!result || !result.rank_improved || !result.new_rank) {
        return;
    }

    window.setTimeout(function() {
        showToast('You moved up to #' + result.new_rank + ' on the leaderboard!', 'success');
    }, Math.max(Number(delayMs) || 0, 0));
}

function initPeakTrackingPanel(panel) {
    if (!panel) {
        return;
    }

    const form = panel.querySelector('[data-peak-log-form]');
    const notesInput = panel.querySelector('[data-peak-log-notes]');
    const photoInput = panel.querySelector('[data-peak-log-photos]');

    updatePeakTrackingPanel(panel, panel.dataset.initialStatus);
    if (form) {
        resetPeakLogForm(form);
        initializeClimbFormValidation(form);
    }

    panel.addEventListener('click', async function(event) {
        const starButton = event.target.closest('[data-peak-star-value]');
        if (starButton && form) {
            event.preventDefault();
            setPeakLogStarRating(form, Number(starButton.getAttribute('data-peak-star-value') || 0));
            return;
        }

        const button = event.target.closest('[data-peak-track-action]');
        if (!button) {
            return;
        }

        event.preventDefault();
        const peakId = Number(panel.dataset.peakId || 0);
        const actionName = button.getAttribute('data-peak-track-action');
        const currentStatus = normalizePeakStatusValue(panel.dataset.currentStatus);
        if (!peakId || !actionName) {
            return;
        }

        setPeakTrackingMessage(panel, '', false);
        if (actionName === 'log-climb') {
            if (currentStatus === 'climbed' || !form) {
                return;
            }
            openPeakLogForm(panel, form);
            return;
        }

        if (actionName === 'cancel-log-form') {
            closePeakLogForm(panel, form, true);
            return;
        }

        setButtonLoading(button, true);
        setLoadingRegion(panel, true, { message: 'Updating your peak status...' });

        try {
            let result = null;
            if (actionName === 'toggle-bucket' && currentStatus !== 'climbed') {
                const endpoint = currentStatus === 'bucket_listed'
                    ? '/api/bucket-list/remove'
                    : '/api/bucket-list/add';
                result = await postJsonRequest(endpoint, { peak_id: peakId });
                updatePeakTrackingPanel(panel, result.user_status);
                setPeakTrackingMessage(
                    panel,
                    currentStatus === 'bucket_listed'
                        ? 'Removed from your bucket list.'
                        : 'Added to your bucket list.',
                    false
                );
                showToast(
                    currentStatus === 'bucket_listed'
                        ? 'Removed from your bucket list.'
                        : 'Added to your bucket list.',
                    'warning'
                );
            }
        } catch (error) {
            setPeakTrackingMessage(panel, error.message || 'We could not update this peak right now.', true);
            showToast(error.message || 'We could not update this peak right now.', 'error');
        } finally {
            setLoadingRegion(panel, false);
            setButtonLoading(button, false);
        }
    });

    if (notesInput) {
        notesInput.addEventListener('input', function() {
            syncPeakLogNotesCounter(form);
            clearFieldError(notesInput);
            setPeakLogFormError(panel, '');
        });
        syncPeakLogNotesCounter(form);
    }

    if (photoInput) {
        photoInput.addEventListener('change', function() {
            const validationMessage = validatePeakLogPhotos(photoInput.files);
            clearFieldError(photoInput);
            if (validationMessage) {
                photoInput.value = '';
                syncPeakLogPhotoSummary(form);
                setFieldError(photoInput, validationMessage);
                setPeakLogFormError(panel, validationMessage);
                return;
            }
            setPeakLogFormError(panel, '');
            syncPeakLogPhotoSummary(form);
        });
        syncPeakLogPhotoSummary(form);
    }

    if (form) {
        form.addEventListener('submit', async function(event) {
            event.preventDefault();

            const peakId = Number(panel.dataset.peakId || 0);
            if (!peakId) {
                return;
            }

            const dateInput = form.querySelector('[data-peak-log-date]');
            const submitButton = form.querySelector('[data-peak-log-submit]');
            const formData = new FormData(form);
            const validation = validateClimbFormClient(form);
            if (!validation.isValid) {
                setPeakLogFormError(panel, getFirstFieldErrorMessage(validation.fieldErrors));
                return;
            }

            setPeakLogFormError(panel, '');
            setPeakTrackingMessage(panel, '', false);
            if (submitButton) {
                setButtonLoading(submitButton, true);
            }
            togglePeakLogFormBusy(form, true);
            setLoadingRegion(panel, true, { message: 'Logging your summit...' });

            try {
                formData.set('peak_id', String(peakId));
                const result = await postFormDataRequest('/api/log-climb', formData);
                updatePeakTrackingPanel(panel, result.user_status);
                const userClimbSection = findUserClimbLogSection(peakId);
                if (userClimbSection && result.climb) {
                    upsertUserClimbItem(userClimbSection, result.climb);
                }
                closePeakLogForm(panel, form, true);
                const successMessage = result.removed_from_bucket_list
                    ? 'Summit logged and removed from your bucket list.'
                    : (result.already_climbed
                        ? 'This summit is already logged.'
                        : 'Summit logged successfully.');
                setPeakTrackingMessage(panel, successMessage, false);
                showToast(successMessage, 'success');
                showLeaderboardRankImprovementToast(result, result.warning ? 520 : 220);
                if (result.warning) {
                    window.setTimeout(function() {
                        showToast(result.warning, 'warning');
                    }, 320);
                }
                if (Array.isArray(result.new_badges) && result.new_badges.length && typeof window.showBadgeCelebration === 'function') {
                    window.setTimeout(function() {
                        window.showBadgeCelebration(result.new_badges);
                    }, result.warning ? 240 : 120);
                }
            } catch (error) {
                applyFieldErrors(form, error.fields, getClimbFieldSelectorMap());
                setPeakLogFormError(panel, error.message || 'We could not save this summit right now.');
                showToast(error.message || 'We could not save this summit right now.', 'error');
            } finally {
                togglePeakLogFormBusy(form, false);
                setLoadingRegion(panel, false);
                if (submitButton) {
                    setButtonLoading(submitButton, false);
                }
            }
        });
    }
}

function initUserClimbLogSection(section) {
    if (!section) {
        return;
    }

    initializeUserClimbEditForms(section);
    syncUserClimbSectionVisibility(section);

    const clearUserClimbValidationState = function(event) {
        const form = event.target.closest('[data-user-climb-edit-form]');
        if (!form) {
            return;
        }

        if (event.target.matches('[data-peak-log-notes]')) {
            syncPeakLogNotesCounter(form);
            setUserClimbFormError(form.closest('[data-user-climb-item]'), '');
            clearFieldError(event.target);
            return;
        }

        if (event.target.matches('[data-user-climb-date], [data-user-climb-weather]')) {
            clearFieldError(event.target);
        }
    };

    section.addEventListener('input', clearUserClimbValidationState);
    section.addEventListener('change', clearUserClimbValidationState);

    section.addEventListener('click', async function(event) {
        const starButton = event.target.closest('[data-peak-star-value]');
        const starForm = starButton ? starButton.closest('[data-user-climb-edit-form]') : null;
        if (starButton && starForm) {
            event.preventDefault();
            setPeakLogStarRating(starForm, Number(starButton.getAttribute('data-peak-star-value') || 0));
            return;
        }

        const actionButton = event.target.closest('[data-user-climb-action]');
        if (!actionButton) {
            return;
        }

        event.preventDefault();
        const item = actionButton.closest('[data-user-climb-item]');
        if (!item) {
            return;
        }

        const actionName = actionButton.getAttribute('data-user-climb-action');
        if (actionName === 'edit') {
            openUserClimbEdit(section, item);
            return;
        }

        if (actionName === 'cancel-edit') {
            closeUserClimbEdit(item, true);
            return;
        }

        if (actionName === 'delete') {
            const climbId = Number(item.getAttribute('data-climb-id') || 0);
            if (!climbId) {
                return;
            }

            const confirmed = window.confirm('Delete this climb log? This cannot be undone.');
            if (!confirmed) {
                return;
            }

            setButtonLoading(actionButton, true);
            setLoadingRegion(item, true, { message: 'Deleting climb log...' });

            try {
                const result = await deleteJsonRequest('/api/climb/' + climbId);
                if (item.parentNode) {
                    item.parentNode.removeChild(item);
                }
                syncUserClimbSectionVisibility(section);
                const panel = findPeakTrackingPanel(result.peak_id || section.dataset.peakId);
                if (panel && result.user_status) {
                    updatePeakTrackingPanel(panel, result.user_status);
                }
                showToast('Climb log deleted.', 'success');
            } catch (error) {
                showToast(error.message || 'We could not delete that climb log right now.', 'error');
            } finally {
                if (item.isConnected) {
                    setLoadingRegion(item, false);
                }
                setButtonLoading(actionButton, false);
            }
        }
    });

    section.addEventListener('submit', async function(event) {
        const form = event.target.closest('[data-user-climb-edit-form]');
        if (!form) {
            return;
        }

        event.preventDefault();

        const item = form.closest('[data-user-climb-item]');
        const climbId = Number(item ? item.getAttribute('data-climb-id') || 0 : 0);
        const dateInput = form.querySelector('[data-user-climb-date]');
        const submitButton = form.querySelector('[data-user-climb-submit]');
        const notesInput = form.querySelector('[data-peak-log-notes]');
        const weatherSelect = form.querySelector('[data-user-climb-weather]');
        const difficultyInput = form.querySelector('[data-peak-star-rating-input]');

        if (!item || !climbId) {
            return;
        }

        const validation = validateClimbFormClient(form);
        if (!validation.isValid) {
            setUserClimbFormError(item, getFirstFieldErrorMessage(validation.fieldErrors));
            return;
        }

        setUserClimbFormError(item, '');
        if (submitButton) {
            setButtonLoading(submitButton, true);
        }
        togglePeakLogFormBusy(form, true);
        setLoadingRegion(item, true, { message: 'Saving climb changes...' });

        try {
            const result = await putJsonRequest('/api/climb/' + climbId, {
                date_climbed: String(dateInput.value || '').trim(),
                notes: notesInput ? notesInput.value : '',
                weather: weatherSelect ? weatherSelect.value : '',
                difficulty_rating: difficultyInput ? difficultyInput.value : ''
            });
            replaceUserClimbItem(section, item, result.climb || {});
            const panel = findPeakTrackingPanel(result.peak_id || section.dataset.peakId);
            if (panel && result.user_status) {
                updatePeakTrackingPanel(panel, result.user_status);
            }
            showToast('Climb log updated.', 'success');
            showLeaderboardRankImprovementToast(result, 220);
        } catch (error) {
            applyFieldErrors(form, error.fields, getClimbFieldSelectorMap());
            setUserClimbFormError(item, error.message || 'We could not save that climb log right now.');
            showToast(error.message || 'We could not save that climb log right now.', 'error');
        } finally {
            togglePeakLogFormBusy(form, false);
            if (item.isConnected) {
                setLoadingRegion(item, false);
            }
            if (submitButton) {
                setButtonLoading(submitButton, false);
            }
        }
    });
}

function initializeUserClimbEditForms(scope) {
    if (!scope) {
        return;
    }

    const forms = scope.matches && scope.matches('[data-user-climb-edit-form]')
        ? [scope]
        : Array.from(scope.querySelectorAll('[data-user-climb-edit-form]'));

    forms.forEach(function(form) {
        initializeClimbFormValidation(form);
        syncPeakLogNotesCounter(form);
        const difficultyInput = form.querySelector('[data-peak-star-rating-input]');
        setPeakLogStarRating(form, Number(difficultyInput ? difficultyInput.value || 0 : 0));
    });
}

function openUserClimbEdit(section, item) {
    if (!section || !item) {
        return;
    }

    section.querySelectorAll('[data-user-climb-item]').forEach(function(otherItem) {
        if (otherItem !== item) {
            closeUserClimbEdit(otherItem, true);
        }
    });

    const display = item.querySelector('[data-user-climb-display]');
    const edit = item.querySelector('[data-user-climb-edit]');
    const form = item.querySelector('[data-user-climb-edit-form]');
    if (display) {
        display.hidden = true;
        display.classList.add('is-hidden');
    }
    if (edit) {
        edit.hidden = false;
        edit.classList.remove('is-hidden');
    }
    item.classList.add('is-editing');
    setUserClimbFormError(item, '');
    if (form) {
        initializeUserClimbEditForms(form);
    }

    const focusTarget = item.querySelector('[data-user-climb-date]');
    if (focusTarget) {
        focusTarget.focus();
    }
}

function closeUserClimbEdit(item, shouldReset) {
    if (!item) {
        return;
    }

    const display = item.querySelector('[data-user-climb-display]');
    const edit = item.querySelector('[data-user-climb-edit]');
    const form = item.querySelector('[data-user-climb-edit-form]');
    if (shouldReset && form) {
        form.reset();
        clearFormFieldErrors(form);
        initializeUserClimbEditForms(form);
    }

    if (display) {
        display.hidden = false;
        display.classList.remove('is-hidden');
    }
    if (edit) {
        edit.hidden = true;
        edit.classList.add('is-hidden');
    }
    item.classList.remove('is-editing');
    setUserClimbFormError(item, '');
}

function setUserClimbFormError(item, message) {
    const errorElement = item ? item.querySelector('[data-user-climb-error]') : null;
    if (!errorElement) {
        return;
    }

    errorElement.textContent = String(message || '').trim();
}

function syncUserClimbSectionVisibility(section) {
    if (!section) {
        return;
    }

    const list = section.querySelector('[data-user-climb-log-list]');
    const hasItems = Boolean(list && list.querySelector('[data-user-climb-item]'));
    section.hidden = !hasItems;
    section.classList.toggle('is-hidden', !hasItems);
}

function findUserClimbLogSection(peakId) {
    const normalizedPeakId = String(peakId || '').trim();
    if (!normalizedPeakId) {
        return null;
    }

    return document.querySelector('[data-user-climb-log-section][data-peak-id="' + normalizedPeakId + '"]');
}

function findPeakTrackingPanel(peakId) {
    const normalizedPeakId = String(peakId || '').trim();
    if (!normalizedPeakId) {
        return null;
    }

    return document.querySelector('[data-peak-tracking][data-peak-id="' + normalizedPeakId + '"]');
}

function replaceUserClimbItem(section, item, climb) {
    const list = section ? section.querySelector('[data-user-climb-log-list]') : null;
    if (!list || !item || !climb) {
        return;
    }

    item.insertAdjacentHTML('afterend', buildUserClimbItemMarkup(climb, section.dataset.peakName || 'Peak'));
    if (item.parentNode) {
        item.parentNode.removeChild(item);
    }
    initializeUserClimbEditForms(section);
    syncUserClimbSectionVisibility(section);
}

function upsertUserClimbItem(section, climb) {
    const list = section ? section.querySelector('[data-user-climb-log-list]') : null;
    if (!section || !list || !climb || climb.id === undefined || climb.id === null) {
        return;
    }

    const climbId = String(climb.id);
    let existingItem = null;
    list.querySelectorAll('[data-user-climb-item]').forEach(function(item) {
        if (existingItem || String(item.getAttribute('data-climb-id') || '') !== climbId) {
            return;
        }
        existingItem = item;
    });

    if (existingItem) {
        replaceUserClimbItem(section, existingItem, climb);
        return;
    }

    list.insertAdjacentHTML('afterbegin', buildUserClimbItemMarkup(climb, section.dataset.peakName || 'Peak'));
    initializeUserClimbEditForms(section);
    syncUserClimbSectionVisibility(section);
}

function buildUserClimbItemMarkup(climb, peakName) {
    const normalizedClimb = normalizeUserClimbRecord(climb);
    const weatherMeta = normalizedClimb.weather ? ((window.CLIMB_WEATHER_META || {})[normalizedClimb.weather] || null) : null;
    const difficultyDisplayLabel = normalizedClimb.difficultyLabel || 'No rating';
    const weatherMarkup = weatherMeta
        ? '<p class="peak-detail-list-item__meta peak-detail-user-climb-item__weather">'
            + '<span class="icon is-small" aria-hidden="true"><i class="fas ' + escapeHtml(weatherMeta.icon) + '"></i></span>'
            + '<span>' + escapeHtml(weatherMeta.label) + '</span>'
        + '</p>'
        : '';
    const notesMarkup = normalizedClimb.notes
        ? '<p class="peak-detail-list-item__copy">' + escapeHtml(normalizedClimb.notes) + '</p>'
        : '';
    const photoMarkup = normalizedClimb.photoUrls.length
        ? '<div class="peak-detail-photo-gallery" aria-label="Climb photo gallery">' + buildUserClimbPhotoMarkup(normalizedClimb.photoUrls, peakName) + '</div>'
        : '';

    return ''
        + '<article class="peak-detail-list-item peak-detail-user-climb-item" data-user-climb-item data-climb-id="' + escapeHtml(String(normalizedClimb.id || '')) + '">'
        + '  <div class="peak-detail-user-climb-item__display" data-user-climb-display>'
        + '    <div class="peak-detail-list-item__body">'
        + '      <div class="peak-detail-list-item__header">'
        + '        <div class="peak-detail-list-item__heading">'
        + '          <p class="peak-detail-list-item__title">' + escapeHtml(normalizedClimb.dateLabel) + '</p>'
        + '          <div class="peak-detail-user-climb-item__meta-row">'
        +               weatherMarkup
        +               buildClimbStarsMarkup(normalizedClimb.difficultyStars, difficultyDisplayLabel, true)
        + '          </div>'
        + '        </div>'
        + '        <div class="buttons peak-detail-user-climb-item__actions">'
        + '          <button type="button" class="button is-light peak-detail-user-climb-item__action" data-user-climb-action="edit">Edit</button>'
        + '          <button type="button" class="button is-danger is-light peak-detail-user-climb-item__action" data-user-climb-action="delete">Delete</button>'
        + '        </div>'
        + '      </div>'
        +        notesMarkup
        +        photoMarkup
        + '    </div>'
        + '  </div>'
        + '  <div class="peak-detail-user-climb-item__edit is-hidden" data-user-climb-edit hidden>'
        + '    <form class="peak-detail-log-form peak-detail-user-climb-form" data-user-climb-edit-form novalidate>'
        + '      <div class="columns is-multiline is-variable is-3">'
        + '        <div class="column is-12-mobile is-6-tablet">'
        + '          <div class="field">'
        + '            <label class="label">Date</label>'
        + '            <div class="control">'
        + '              <input class="input" type="date" name="date_climbed" value="' + escapeHtml(normalizedClimb.dateInputValue) + '" data-user-climb-date>'
        + '            </div>'
        + '          </div>'
        + '        </div>'
        + '        <div class="column is-12-mobile is-6-tablet">'
        + '          <div class="field">'
        + '            <label class="label">Weather</label>'
        + '            <div class="control"><div class="select is-fullwidth"><select name="weather" data-user-climb-weather>'
        +                  buildWeatherOptionsMarkup(normalizedClimb.weather)
        + '            </select></div></div>'
        + '          </div>'
        + '        </div>'
        + '        <div class="column is-12">'
        + '          <div class="field">'
        + '            <div class="peak-detail-log-form__field-head">'
        + '              <label class="label">Notes</label>'
        + '              <span class="peak-detail-log-form__counter" data-peak-log-notes-counter>' + escapeHtml(String(normalizedClimb.notes.length)) + ' / 500</span>'
        + '            </div>'
        + '            <div class="control">'
        + '              <textarea class="textarea" name="notes" rows="4" maxlength="500" data-peak-log-notes>' + escapeHtml(normalizedClimb.notes) + '</textarea>'
        + '            </div>'
        + '          </div>'
        + '        </div>'
        + '        <div class="column is-12">'
        + '          <div class="field">'
        + '            <div class="peak-detail-log-form__field-head">'
        + '              <label class="label">Difficulty</label>'
        + '              <span class="peak-detail-log-form__counter" data-peak-log-stars-label>' + escapeHtml(normalizedClimb.difficultyStars ? (String(normalizedClimb.difficultyStars) + ' / 5') : 'Tap to rate') + '</span>'
        + '            </div>'
        + '            <div class="peak-detail-stars" data-peak-star-rating>'
        + '              <input type="hidden" name="difficulty_rating" value="' + escapeHtml(normalizedClimb.difficultyInputValue) + '" data-peak-star-rating-input>'
        +                    buildClimbEditStarsMarkup(normalizedClimb.difficultyStars)
        + '            </div>'
        + '          </div>'
        + '        </div>'
        + '      </div>'
        + '      <p class="peak-detail-log-form__error peak-detail-user-climb-form__error" data-user-climb-error aria-live="polite"></p>'
        + '      <div class="buttons peak-detail-log-form__actions">'
        + '        <button type="button" class="button peak-detail-log-form__cancel" data-user-climb-action="cancel-edit">Cancel</button>'
        + '        <button type="submit" class="button peak-detail-log-form__submit" data-user-climb-submit>Save Changes</button>'
        + '      </div>'
        + '    </form>'
        + '  </div>'
        + '</article>';
}

function buildUserClimbPhotoMarkup(photoUrls, peakName) {
    return photoUrls.map(function(photoUrl, index) {
        return ''
            + '<a href="' + escapeHtml(photoUrl) + '" class="peak-detail-photo-gallery__link" target="_blank" rel="noreferrer noopener">'
            + '  <img src="' + escapeHtml(photoUrl) + '" alt="' + escapeHtml(String(peakName || 'Peak') + ' climb photo ' + (index + 1)) + '" class="peak-detail-photo-gallery__image" loading="lazy">'
            + '</a>';
    }).join('');
}

function buildClimbEditStarsMarkup(activeStars) {
    const starCount = Number(activeStars || 0);
    let markup = '';
    for (let index = 1; index <= 5; index += 1) {
        const isActive = index <= starCount && starCount > 0;
        markup += ''
            + '<button type="button" class="peak-detail-stars__button' + (isActive ? ' is-active' : '') + '" data-peak-star-value="' + index + '" aria-label="Set difficulty to ' + index + ' out of 5" aria-pressed="' + (isActive ? 'true' : 'false') + '">'
            + '  <i class="fas fa-star" aria-hidden="true"></i>'
            + '</button>';
    }
    return markup;
}

function buildClimbStarsMarkup(starCount, label, isInline) {
    const normalizedCount = Number(starCount || 0);
    let starsMarkup = '<div class="peak-detail-stars-display' + (isInline ? ' peak-detail-stars-display--inline' : '') + '" aria-label="Difficulty ' + escapeHtml(String(label || 'not rated')) + '">';
    for (let index = 1; index <= 5; index += 1) {
        starsMarkup += '<span class="peak-detail-stars-display__star' + (index <= normalizedCount ? ' is-filled' : '') + '"><i class="fas fa-star" aria-hidden="true"></i></span>';
    }
    starsMarkup += '<span class="peak-detail-stars-display__value">' + escapeHtml(String(label || 'No rating')) + '</span></div>';
    return starsMarkup;
}

function normalizeUserClimbRecord(climb) {
    const currentClimb = climb || {};
    const dateValue = normalizeDateInputValue(currentClimb.date_climbed || currentClimb.climbed_at || currentClimb.created_at);
    const weatherValue = String(currentClimb.weather || '').trim().toLowerCase();
    const difficultyStars = normalizeDifficultyStars(currentClimb.difficulty_rating || currentClimb.difficulty);
    const difficultyLabel = String(currentClimb.difficulty_rating || currentClimb.difficulty || '').trim();
    return {
        id: currentClimb.id,
        dateInputValue: dateValue,
        dateLabel: formatUserClimbDateLabel(dateValue),
        notes: String(currentClimb.notes || ''),
        weather: weatherValue,
        difficultyInputValue: difficultyStars ? String(difficultyStars) : '',
        difficultyStars: difficultyStars,
        difficultyLabel: difficultyLabel,
        photoUrls: normalizePhotoUrlList(currentClimb.photo_urls)
    };
}

function normalizePhotoUrlList(value) {
    if (Array.isArray(value)) {
        return value.filter(function(item) {
            return String(item || '').trim();
        }).map(function(item) {
            return String(item).trim();
        });
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return [];
        }

        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return normalizePhotoUrlList(parsed);
            }
        } catch (error) {
            return [trimmed];
        }

        return [trimmed];
    }

    return [];
}

function normalizeDateInputValue(value) {
    const rawValue = String(value || '').trim();
    if (!rawValue) {
        return '';
    }
    return rawValue.slice(0, 10);
}

function formatUserClimbDateLabel(dateValue) {
    if (!dateValue) {
        return 'Climb log';
    }

    const parsedDate = new Date(dateValue + 'T00:00:00');
    if (Number.isNaN(parsedDate.getTime())) {
        return dateValue;
    }

    return parsedDate.toLocaleDateString('en-IE', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
}

function normalizeDifficultyStars(value) {
    if (value === undefined || value === null || String(value).trim() === '') {
        return 0;
    }

    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
        return Math.max(0, Math.min(5, Math.round(numericValue)));
    }

    const namedValues = {
        easy: 1,
        moderate: 2,
        medium: 2,
        hard: 3,
        challenging: 3,
        'very hard': 4,
        strenuous: 4,
        expert: 5,
        extreme: 5
    };
    return namedValues[String(value || '').trim().toLowerCase()] || 0;
}

function initPeakCommunitySection(section) {
    if (!section) {
        return;
    }

    const hiddenClimbers = section.querySelector('[data-peak-community-hidden-climbers]');
    const toggleButton = section.querySelector('[data-peak-community-toggle]');
    const commentForm = section.querySelector('[data-peak-comment-form]');
    const commentInput = section.querySelector('[data-peak-comment-input]');

    if (toggleButton && hiddenClimbers) {
        toggleButton.addEventListener('click', function() {
            const isHidden = hiddenClimbers.hasAttribute('hidden');
            if (isHidden) {
                hiddenClimbers.removeAttribute('hidden');
                hiddenClimbers.classList.remove('is-hidden');
            } else {
                hiddenClimbers.setAttribute('hidden', '');
                hiddenClimbers.classList.add('is-hidden');
            }

            const label = isHidden
                ? toggleButton.getAttribute('data-expanded-label')
                : toggleButton.getAttribute('data-collapsed-label');
            toggleButton.textContent = String(label || '').trim();
        });
    }

    syncPeakCommentEmptyState(section);

    if (commentInput) {
        commentInput.addEventListener('input', function() {
            clearFieldError(commentInput);
            setPeakCommentError(section, '');
        });
    }

    if (commentForm) {
        commentForm.addEventListener('submit', async function(event) {
            event.preventDefault();

            const peakId = Number(section.dataset.peakId || 0);
            const submitButton = commentForm.querySelector('[data-peak-comment-submit]');
            const commentText = String(commentInput ? commentInput.value || '' : '').trim();

            if (!peakId) {
                return;
            }

            if (!commentText) {
                clearFieldError(commentInput);
                setFieldError(commentInput, 'Please write a trail note before posting.');
                setPeakCommentError(section, 'Please write a trail note before posting.');
                if (commentInput) {
                    commentInput.focus();
                }
                return;
            }

            clearFieldError(commentInput);
            setPeakCommentError(section, '');
            if (submitButton) {
                setButtonLoading(submitButton, true);
            }
            setLoadingRegion(commentForm, true, { message: 'Posting trail note...' });

            try {
                const result = await postJsonRequest('/api/peak-comment', {
                    peak_id: peakId,
                    comment_text: commentText
                });
                prependPeakComment(section, result.comment || {});
                if (commentInput) {
                    commentInput.value = '';
                    commentInput.focus();
                }
                showToast('Trail note posted.', 'success');
            } catch (error) {
                applyFieldErrors(commentForm, error.fields, { comment_text: '[data-peak-comment-input]' });
                setPeakCommentError(section, error.message || 'We could not post that trail note right now.');
                showToast(error.message || 'We could not post that trail note right now.', 'error');
            } finally {
                setLoadingRegion(commentForm, false);
                if (submitButton) {
                    setButtonLoading(submitButton, false);
                }
            }
        });
    }

    section.addEventListener('click', async function(event) {
        const deleteButton = event.target.closest('[data-comment-delete]');
        if (!deleteButton) {
            return;
        }

        event.preventDefault();

        const commentId = Number(deleteButton.getAttribute('data-comment-id') || 0);
        if (!commentId) {
            return;
        }

        const commentItem = section.querySelector('[data-comment-id="' + commentId + '"]');
        setButtonLoading(deleteButton, true);
        if (commentItem) {
            setLoadingRegion(commentItem, true, { message: 'Deleting trail note...' });
        }

        try {
            await postJsonRequest('/api/peak-comment/' + commentId + '/delete', {});
            if (commentItem && commentItem.parentNode) {
                commentItem.parentNode.removeChild(commentItem);
            }
            syncPeakCommentEmptyState(section);
            showToast('Trail note deleted.', 'success');
        } catch (error) {
            showToast(error.message || 'We could not delete that trail note right now.', 'error');
        } finally {
            if (commentItem && commentItem.isConnected) {
                setLoadingRegion(commentItem, false);
            }
            setButtonLoading(deleteButton, false);
        }
    });
}

function setPeakCommentError(section, message) {
    const errorElement = section ? section.querySelector('[data-peak-comment-error]') : null;
    if (!errorElement) {
        return;
    }

    errorElement.textContent = String(message || '').trim();
}

function syncPeakCommentEmptyState(section) {
    const list = section ? section.querySelector('[data-peak-comments-list]') : null;
    const emptyState = section ? section.querySelector('[data-peak-comments-empty]') : null;
    if (!list || !emptyState) {
        return;
    }

    const hasComments = Boolean(list.querySelector('[data-comment-id]'));
    emptyState.classList.toggle('is-hidden', hasComments);
}

function prependPeakComment(section, comment) {
    const list = section ? section.querySelector('[data-peak-comments-list]') : null;
    if (!list) {
        return;
    }

    const article = document.createElement('article');
    article.className = 'peak-detail-list-item';
    if (comment && comment.id !== undefined && comment.id !== null) {
        article.setAttribute('data-comment-id', String(comment.id));
    }

    const layout = document.createElement('div');
    layout.className = 'peak-detail-list-item__layout';

    const avatar = buildUserAvatarNode(comment, 32);
    if (comment.profile_url) {
        const avatarLink = document.createElement('a');
        avatarLink.className = 'peak-detail-list-item__avatar-link';
        avatarLink.href = String(comment.profile_url);
        avatarLink.setAttribute('aria-label', String(comment.display_name || 'Climber'));
        avatarLink.appendChild(avatar);
        layout.appendChild(avatarLink);
    } else {
        const avatarWrap = document.createElement('span');
        avatarWrap.className = 'peak-detail-list-item__avatar';
        avatarWrap.setAttribute('aria-hidden', 'true');
        avatarWrap.appendChild(avatar);
        layout.appendChild(avatarWrap);
    }

    const body = document.createElement('div');
    body.className = 'peak-detail-list-item__body';

    const header = document.createElement('div');
    header.className = 'peak-detail-list-item__header';

    const heading = document.createElement('div');
    heading.className = 'peak-detail-list-item__heading';

    if (comment.profile_url) {
        const link = document.createElement('a');
        link.className = 'peak-detail-list-item__title-link user-profile-link';
        link.href = String(comment.profile_url);
        link.setAttribute('data-profile-preview-name', String(comment.display_name || 'Climber'));

        const title = document.createElement('p');
        title.className = 'peak-detail-list-item__title';
        title.textContent = String(comment.display_name || 'Climber');
        link.appendChild(title);
        heading.appendChild(link);
    } else {
        const title = document.createElement('p');
        title.className = 'peak-detail-list-item__title';
        title.textContent = String(comment.display_name || 'Climber');
        heading.appendChild(title);
    }

    const meta = document.createElement('time');
    meta.className = 'peak-detail-list-item__meta';
    meta.setAttribute('data-timestamp', String(comment.created_at || new Date().toISOString()));
    meta.textContent = timeAgo(comment.created_at || new Date().toISOString());
    heading.appendChild(meta);
    header.appendChild(heading);

    if (comment.can_delete && comment.id !== undefined && comment.id !== null) {
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'button is-text peak-detail-comment-delete';
        deleteButton.setAttribute('data-comment-delete', '');
        deleteButton.setAttribute('data-comment-id', String(comment.id));
        deleteButton.textContent = 'Delete';
        header.appendChild(deleteButton);
    }

    const copy = document.createElement('p');
    copy.className = 'peak-detail-list-item__copy';
    copy.textContent = String(comment.comment_text || '');

    body.appendChild(header);
    body.appendChild(copy);
    layout.appendChild(body);
    article.appendChild(layout);
    list.insertBefore(article, list.firstChild);
    refreshTimeAgo(article);
    syncPeakCommentEmptyState(section);
}

function buildUserAvatarNode(record, size) {
    const avatar = document.createElement('span');
    avatar.className = 'user-avatar';
    avatar.style.setProperty('--user-avatar-size', String(size || 32) + 'px');

    const avatarUrl = String(record && record.avatar_url ? record.avatar_url : '').trim();
    if (avatarUrl) {
        const image = document.createElement('img');
        image.className = 'user-avatar__image';
        image.src = avatarUrl;
        image.alt = String(record && record.display_name ? record.display_name : 'Climber') + ' avatar';
        image.onerror = function() {
            image.hidden = true;
            if (icon) {
                icon.hidden = false;
            }
        };
        avatar.appendChild(image);

        const icon = document.createElement('span');
        icon.className = 'icon user-avatar__icon';
        icon.hidden = true;
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<i class="fas fa-user-circle"></i>';
        avatar.appendChild(icon);
        return avatar;
    }

    const fallbackIcon = document.createElement('span');
    fallbackIcon.className = 'icon user-avatar__icon';
    fallbackIcon.setAttribute('aria-hidden', 'true');
    fallbackIcon.innerHTML = '<i class="fas fa-user-circle"></i>';
    avatar.appendChild(fallbackIcon);
    return avatar;
}

function openPeakLogForm(panel, form) {
    if (!panel || !form) {
        return;
    }

    panel.classList.add('is-log-form-open');
    setPeakLogFormError(panel, '');
    initializeClimbFormValidation(form);

    const dateInput = form.querySelector('[data-peak-log-date]');
    if (dateInput && !dateInput.value) {
        dateInput.value = getTodayDateValueLocal();
    }

    window.requestAnimationFrame(function() {
        if (dateInput) {
            dateInput.focus();
        }
    });
}

function closePeakLogForm(panel, form, reset) {
    if (!panel || !form) {
        return;
    }

    panel.classList.remove('is-log-form-open');
    setPeakLogFormError(panel, '');

    if (reset) {
        resetPeakLogForm(form);
    }
}

function resetPeakLogForm(form) {
    if (!form) {
        return;
    }

    form.reset();
    clearFormFieldErrors(form);
    const dateInput = form.querySelector('[data-peak-log-date]');
    if (dateInput) {
        dateInput.value = getTodayDateValueLocal();
        dateInput.setAttribute('max', getTodayDateComparable());
    }

    setPeakLogStarRating(form, 0);
    syncPeakLogNotesCounter(form);
    syncPeakLogPhotoSummary(form);
    togglePeakLogFormBusy(form, false);
}

function togglePeakLogFormBusy(form, isBusy) {
    if (!form) {
        return;
    }

    form.querySelectorAll('input, select, textarea, button').forEach(function(control) {
        control.disabled = Boolean(isBusy);
    });
}

function setPeakLogFormError(panel, message) {
    const errorElement = panel ? panel.querySelector('[data-peak-log-form-error]') : null;
    if (!errorElement) {
        return;
    }

    errorElement.textContent = String(message || '').trim();
}

function syncPeakLogNotesCounter(form) {
    if (!form) {
        return;
    }

    const notesInput = form.querySelector('[data-peak-log-notes]');
    const counter = form.querySelector('[data-peak-log-notes-counter]');
    if (!notesInput || !counter) {
        return;
    }

    const currentLength = String(notesInput.value || '').length;
    const maxLength = Number(notesInput.getAttribute('maxlength') || 500);
    counter.textContent = currentLength + ' / ' + maxLength;
    counter.classList.toggle('is-near-limit', currentLength >= 480);
}

function syncPeakLogPhotoSummary(form) {
    if (!form) {
        return;
    }

    const photoInput = form.querySelector('[data-peak-log-photos]');
    const summary = form.querySelector('[data-peak-log-photo-summary]');
    if (!photoInput || !summary) {
        return;
    }

    const photoCount = photoInput.files ? photoInput.files.length : 0;
    summary.textContent = photoCount
        ? photoCount + (photoCount === 1 ? ' photo selected.' : ' photos selected.')
        : 'No photos selected.';
}

function validatePeakLogPhotos(fileList) {
    const files = Array.from(fileList || []);
    const maxFiles = 3;
    const maxSizeBytes = 5 * 1024 * 1024;

    if (files.length > maxFiles) {
        return 'You can upload up to 3 photos.';
    }

    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        if (!String(file.type || '').toLowerCase().startsWith('image/')) {
            return 'Please upload image files only.';
        }
        if (Number(file.size || 0) > maxSizeBytes) {
            return 'Each photo must be 5MB or smaller.';
        }
    }

    return '';
}

function setPeakLogStarRating(form, value) {
    if (!form) {
        return;
    }

    const normalizedValue = Number.isFinite(value) ? Math.max(0, Math.min(5, value)) : 0;
    const ratingInput = form.querySelector('[data-peak-star-rating-input]');
    const ratingLabel = form.querySelector('[data-peak-log-stars-label]');
    const starButtons = form.querySelectorAll('[data-peak-star-value]');

    if (ratingInput) {
        ratingInput.value = normalizedValue ? String(normalizedValue) : '';
        clearFieldError(ratingInput);
    }

    starButtons.forEach(function(starButton) {
        const starValue = Number(starButton.getAttribute('data-peak-star-value') || 0);
        const isActive = starValue <= normalizedValue && normalizedValue > 0;
        starButton.classList.toggle('is-active', isActive);
        starButton.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (ratingLabel) {
        ratingLabel.textContent = normalizedValue ? (normalizedValue + ' / 5') : 'Tap to rate';
    }
}

window.initializeClimbFormValidation = initializeClimbFormValidation;
window.setPeakLogStarRating = setPeakLogStarRating;
window.showLeaderboardRankImprovementToast = showLeaderboardRankImprovementToast;
window.syncPeakLogNotesCounter = syncPeakLogNotesCounter;
window.syncPeakLogPhotoSummary = syncPeakLogPhotoSummary;
window.togglePeakLogFormBusy = togglePeakLogFormBusy;
window.validateClimbFormClient = validateClimbFormClient;
window.validatePeakLogPhotos = validatePeakLogPhotos;
