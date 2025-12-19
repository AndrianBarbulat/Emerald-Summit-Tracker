const ACCOUNT_DISPLAY_NAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;
const ACCOUNT_MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ACCOUNT_ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ACCOUNT_UNIT_OPTIONS = new Set(['metric', 'imperial']);
const ACCOUNT_DELETE_CONFIRM_TEXT = 'DELETE';

document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('[data-account-profile-form]');
    if (!form) {
        return;
    }

    const elements = {
        avatarHelp: form.querySelector('[data-account-avatar-help]'),
        avatarIcon: form.querySelector('[data-account-avatar-icon]'),
        avatarImage: form.querySelector('[data-account-avatar-image]'),
        avatarInput: form.querySelector('[data-account-avatar-input]'),
        avatarFileName: form.querySelector('[data-account-avatar-file-name]'),
        bioCounter: form.querySelector('[data-account-bio-counter]'),
        bioInput: form.querySelector('[data-account-bio]'),
        deleteConfirmButton: document.querySelector('[data-account-delete-confirm-button]'),
        deleteConfirmInput: document.querySelector('[data-account-delete-confirm-input]'),
        deleteError: document.querySelector('[data-account-delete-error]'),
        deleteModal: document.querySelector('[data-account-delete-modal]'),
        deleteOpenButton: document.querySelector('[data-account-delete-open-button]'),
        deleteCloseButtons: Array.from(document.querySelectorAll('[data-account-delete-close]')),
        displayNameInput: form.querySelector('[data-account-display-name]'),
        emailInput: document.querySelector('[data-account-email]'),
        locationInput: form.querySelector('[data-account-location]'),
        passwordResetButton: document.querySelector('[data-account-password-reset-button]'),
        passwordResetMessage: document.querySelector('[data-account-password-reset-message]'),
        previewUnitPreference: document.querySelector('[data-account-preview-unit-preference]'),
        previewAvatarIcon: document.querySelector('[data-account-preview-avatar-icon]'),
        previewAvatarImage: document.querySelector('[data-account-preview-avatar-image]'),
        previewBio: document.querySelector('[data-account-preview-bio]'),
        previewDisplayName: document.querySelector('[data-account-preview-display-name]'),
        previewLocation: document.querySelector('[data-account-preview-location]'),
        previewProfileLink: document.querySelector('[data-account-preview-profile-link]'),
        previewVisibility: document.querySelector('[data-account-preview-visibility]'),
        privacyDescription: form.querySelector('[data-account-privacy-description]'),
        publicToggle: form.querySelector('[data-account-public-toggle]'),
        publicToggleLabel: form.querySelector('[data-account-public-toggle-label]'),
        saveButton: form.querySelector('[data-account-save-button]')
    };
    elements.unitInputs = Array.from(form.querySelectorAll('[data-account-unit-input]'));

    const state = {
        avatarBlob: null,
        avatarError: '',
        avatarFilename: '',
        avatarObjectUrl: '',
        deleteBusy: false,
        originalAvatarUrl: elements.avatarImage && !elements.avatarImage.hidden
            ? String(elements.avatarImage.getAttribute('src') || '').trim()
            : '',
        originalFileLabel: elements.avatarFileName ? String(elements.avatarFileName.textContent || '').trim() : 'No file selected'
    };

    syncAccountBioCounter(elements);
    syncAccountPreview(elements);
    syncAccountPreferencePreview(elements);

    if (elements.displayNameInput) {
        elements.displayNameInput.addEventListener('input', function() {
            clearAccountFieldError(elements.displayNameInput);
            syncAccountPreview(elements);
        });
    }

    if (elements.bioInput) {
        elements.bioInput.addEventListener('input', function() {
            clearAccountFieldError(elements.bioInput);
            syncAccountBioCounter(elements);
            syncAccountPreview(elements);
        });
    }

    if (elements.locationInput) {
        elements.locationInput.addEventListener('input', function() {
            clearAccountFieldError(elements.locationInput);
            syncAccountPreview(elements);
        });
    }

    if (elements.avatarInput) {
        elements.avatarInput.addEventListener('change', function() {
            clearAccountFieldError(elements.avatarInput);
            handleAccountAvatarSelection(elements, state);
        });
    }

    if (elements.publicToggle) {
        elements.publicToggle.addEventListener('change', function() {
            clearAccountFieldError(elements.publicToggle);
            syncAccountPreferencePreview(elements);
        });
    }

    elements.unitInputs.forEach(function(input) {
        input.addEventListener('change', function() {
            clearAccountUnitErrors(elements);
            syncAccountPreferencePreview(elements);
        });
    });

    if (elements.passwordResetButton) {
        elements.passwordResetButton.addEventListener('click', async function() {
            const email = String(elements.emailInput ? elements.emailInput.value : '').trim();
            setAccountInlineMessage(elements.passwordResetMessage, '', '');
            if (!email) {
                if (typeof window.showToast === 'function') {
                    window.showToast('We could not find an email address for this account.', 'error');
                }
                return;
            }

            toggleAccountSaveBusy(elements.passwordResetButton, true);
            try {
                const result = await window.postJsonRequest('/api/account/password-reset', {});
                const message = result && result.message
                    ? result.message
                    : ('We\'ve sent a password reset email to ' + email + '.');
                setAccountInlineMessage(elements.passwordResetMessage, message, 'success');
                if (typeof window.showToast === 'function') {
                    window.showToast(message, 'success');
                }
            } catch (error) {
                const message = (error && error.message) || 'We could not send a password reset email right now.';
                setAccountInlineMessage(elements.passwordResetMessage, message, 'error');
                if (typeof window.showToast === 'function') {
                    window.showToast(message, 'error');
                }
            } finally {
                toggleAccountSaveBusy(elements.passwordResetButton, false);
            }
        });
    }

    if (elements.deleteOpenButton) {
        elements.deleteOpenButton.addEventListener('click', function() {
            openAccountDeleteModal(elements);
        });
    }

    elements.deleteCloseButtons.forEach(function(button) {
        button.addEventListener('click', function() {
            closeAccountDeleteModal(elements, state);
        });
    });

    if (elements.deleteModal) {
        elements.deleteModal.addEventListener('click', function(event) {
            if (event.target === elements.deleteModal) {
                closeAccountDeleteModal(elements, state);
            }
        });
    }

    if (elements.deleteConfirmInput) {
        elements.deleteConfirmInput.addEventListener('input', function() {
            syncAccountDeleteConfirmState(elements);
        });
    }

    if (elements.deleteConfirmButton) {
        elements.deleteConfirmButton.addEventListener('click', async function() {
            if (state.deleteBusy) {
                return;
            }

            const confirmationValue = String(elements.deleteConfirmInput ? elements.deleteConfirmInput.value : '').trim();
            if (confirmationValue !== ACCOUNT_DELETE_CONFIRM_TEXT) {
                setAccountDeleteError(elements, 'Type DELETE exactly to confirm account deletion.');
                syncAccountDeleteConfirmState(elements);
                return;
            }

            state.deleteBusy = true;
            setAccountDeleteError(elements, '');
            toggleAccountSaveBusy(elements.deleteConfirmButton, true);
            try {
                const result = await window.postJsonRequest('/api/account/delete', { confirm: ACCOUNT_DELETE_CONFIRM_TEXT });
                const warnings = Array.isArray(result && result.warnings) ? result.warnings : [];
                const message = warnings.length
                    ? 'Your account was deleted, but a few cleanup steps had to be finished best-effort.'
                    : 'Your account has been deleted.';
                if (typeof window.showToast === 'function') {
                    window.showToast(message, warnings.length ? 'warning' : 'success');
                }
                window.setTimeout(function() {
                    window.location.assign((result && (result.redirect || result.redirect_url)) || '/');
                }, warnings.length ? 1200 : 700);
            } catch (error) {
                const message = (error && error.message) || 'We could not delete your account right now.';
                setAccountDeleteError(elements, message);
                if (typeof window.showToast === 'function') {
                    window.showToast(message, 'error');
                }
            } finally {
                state.deleteBusy = false;
                toggleAccountSaveBusy(elements.deleteConfirmButton, false);
                syncAccountDeleteConfirmState(elements);
            }
        });
    }

    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && elements.deleteModal && elements.deleteModal.classList.contains('is-active')) {
            closeAccountDeleteModal(elements, state);
        }
    });

    form.addEventListener('submit', async function(event) {
        event.preventDefault();
        clearAccountFormErrors(form);

        const validation = validateAccountProfileForm(elements, state);
        if (!validation.isValid) {
            const firstInvalid = applyAccountFieldErrors(form, validation.fieldErrors);
            if (firstInvalid && typeof firstInvalid.focus === 'function') {
                firstInvalid.focus();
            }
            return;
        }

        const formData = new FormData();
        formData.append('display_name', String(elements.displayNameInput ? elements.displayNameInput.value : '').trim());
        formData.append('bio', String(elements.bioInput ? elements.bioInput.value : '').trim());
        formData.append('location', String(elements.locationInput ? elements.locationInput.value : '').trim());
        formData.append('profile_visibility', elements.publicToggle && elements.publicToggle.checked ? 'public' : 'private');
        formData.append('unit_preference', getAccountSelectedUnitPreference(elements, 'metric'));
        if (state.avatarBlob) {
            formData.append('avatar', state.avatarBlob, state.avatarFilename || 'avatar.jpg');
        }

        toggleAccountSaveBusy(elements.saveButton, true);
        try {
            const result = await window.postFormDataRequest('/api/profile/update', formData);
            const updatedProfile = result && result.profile ? result.profile : {};

            if (elements.displayNameInput) {
                elements.displayNameInput.value = String(updatedProfile.display_name || '').trim();
            }
            if (elements.bioInput) {
                elements.bioInput.value = String(updatedProfile.bio || '');
            }
            if (elements.locationInput) {
                elements.locationInput.value = String(updatedProfile.location || '');
            }
            if (elements.publicToggle) {
                elements.publicToggle.checked = getAccountProfileIsPublic(updatedProfile);
            }
            syncAccountUnitInputs(elements, getAccountProfileUnitPreference(updatedProfile));

            const updatedAvatarUrl = String(updatedProfile.avatar_url || '').trim();
            state.originalAvatarUrl = updatedAvatarUrl;
            state.avatarBlob = null;
            state.avatarError = '';
            state.avatarFilename = '';
            if (elements.avatarInput) {
                elements.avatarInput.value = '';
            }
            setAccountAvatarFileLabel(elements, updatedAvatarUrl ? 'Current avatar' : 'No file selected');
            setAccountAvatarHelp(elements, 'Image only, max 2MB. We resize it to 200x200 before upload.');
            revokeAccountAvatarPreview(state);
            applyAccountAvatarPreview(elements, updatedAvatarUrl);
            syncAccountBioCounter(elements);
            syncAccountPreview(elements);
            syncAccountPreferencePreview(elements);
            syncNavbarDisplayName(updatedProfile.display_name);
            if (typeof window.showToast === 'function') {
                window.showToast('Your profile has been updated.', 'success');
            }
            window.dispatchEvent(new CustomEvent('profile:updated', { detail: { message: 'Your profile has been updated.', profile: updatedProfile } }));
        } catch (error) {
            const firstInvalid = applyAccountFieldErrors(form, error && error.fields ? error.fields : {});
            if (firstInvalid && typeof firstInvalid.focus === 'function') {
                firstInvalid.focus();
            }
            if (typeof window.showToast === 'function') {
                window.showToast((error && error.message) || 'We could not update your profile right now.', 'error');
            }
        } finally {
            toggleAccountSaveBusy(elements.saveButton, false);
        }
    });
});

function validateAccountProfileForm(elements, state) {
    const fieldErrors = {};
    const displayName = String(elements.displayNameInput ? elements.displayNameInput.value : '').trim();
    const bio = String(elements.bioInput ? elements.bioInput.value : '').trim();
    const location = String(elements.locationInput ? elements.locationInput.value : '').trim();
    const unitPreference = getAccountSelectedUnitPreference(elements, '');

    if (!displayName) {
        fieldErrors.display_name = 'Display name is required.';
    } else if (!ACCOUNT_DISPLAY_NAME_PATTERN.test(displayName)) {
        fieldErrors.display_name = 'Use 3-30 letters, numbers, or underscores.';
    }

    if (bio.length > 500) {
        fieldErrors.bio = 'Bio must be 500 characters or fewer.';
    }

    if (location.length > 200) {
        fieldErrors.location = 'Location must be 200 characters or fewer.';
    }

    if (!ACCOUNT_UNIT_OPTIONS.has(unitPreference)) {
        fieldErrors.unit_preference = 'Choose either metric or imperial units.';
    }

    if (state.avatarError) {
        fieldErrors.avatar = state.avatarError;
    }

    return {
        isValid: Object.keys(fieldErrors).length === 0,
        fieldErrors: fieldErrors
    };
}

async function handleAccountAvatarSelection(elements, state) {
    const input = elements.avatarInput;
    const file = input && input.files ? input.files[0] : null;
    state.avatarError = '';

    if (!file) {
        state.avatarBlob = null;
        state.avatarFilename = '';
        revokeAccountAvatarPreview(state);
        applyAccountAvatarPreview(elements, state.originalAvatarUrl);
        setAccountAvatarFileLabel(elements, state.originalFileLabel);
        setAccountAvatarHelp(elements, 'Image only, max 2MB. We resize it to 200x200 before upload.');
        return;
    }

    const validationMessage = getAccountAvatarValidationMessage(file);
    if (validationMessage) {
        state.avatarBlob = null;
        state.avatarFilename = '';
        state.avatarError = validationMessage;
        if (input) {
            input.value = '';
        }
        revokeAccountAvatarPreview(state);
        applyAccountAvatarPreview(elements, state.originalAvatarUrl);
        setAccountAvatarFileLabel(elements, state.originalFileLabel);
        setAccountAvatarHelp(elements, validationMessage);
        if (typeof window.setFieldError === 'function' && input) {
            window.setFieldError(input, validationMessage);
        }
        return;
    }

    setAccountAvatarHelp(elements, 'Preparing a 200x200 preview...');

    try {
        const resizedAvatar = await resizeAccountAvatarFile(file);
        state.avatarBlob = resizedAvatar.blob;
        state.avatarFilename = resizedAvatar.filename;
        state.avatarError = '';
        revokeAccountAvatarPreview(state);
        state.avatarObjectUrl = URL.createObjectURL(resizedAvatar.blob);
        applyAccountAvatarPreview(elements, state.avatarObjectUrl);
        setAccountAvatarFileLabel(elements, String(file.name || 'avatar').trim() + ' ready');
        setAccountAvatarHelp(elements, 'Preview ready. Your avatar will upload as a 200x200 image.');
    } catch (error) {
        state.avatarBlob = null;
        state.avatarFilename = '';
        state.avatarError = 'We could not prepare that image. Please try another file.';
        revokeAccountAvatarPreview(state);
        applyAccountAvatarPreview(elements, state.originalAvatarUrl);
        setAccountAvatarFileLabel(elements, state.originalFileLabel);
        setAccountAvatarHelp(elements, state.avatarError);
        if (typeof window.setFieldError === 'function' && input) {
            window.setFieldError(input, state.avatarError);
        }
    }
}

function getAccountAvatarValidationMessage(file) {
    if (!file) {
        return '';
    }

    const fileType = String(file.type || '').trim().toLowerCase();
    if (!fileType.startsWith('image/')) {
        return 'Please choose an image file.';
    }
    if (!ACCOUNT_ALLOWED_AVATAR_TYPES.has(fileType)) {
        return 'Avatar images must be JPG, PNG, WEBP, or GIF.';
    }
    if (Number(file.size || 0) > ACCOUNT_MAX_AVATAR_BYTES) {
        return 'Avatar images must be 2MB or smaller.';
    }
    return '';
}

function resizeAccountAvatarFile(file) {
    return loadAccountImageFromFile(file).then(function(image) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Canvas is not available.');
        }

        const sourceWidth = Number(image.naturalWidth || image.width || 0);
        const sourceHeight = Number(image.naturalHeight || image.height || 0);
        const squareSize = Math.min(sourceWidth, sourceHeight);
        const sourceX = Math.max((sourceWidth - squareSize) / 2, 0);
        const sourceY = Math.max((sourceHeight - squareSize) / 2, 0);
        const outputType = file.type === 'image/png'
            ? 'image/png'
            : (file.type === 'image/webp' ? 'image/webp' : 'image/jpeg');
        const fileExtension = outputType === 'image/png'
            ? 'png'
            : (outputType === 'image/webp' ? 'webp' : 'jpg');

        canvas.width = 200;
        canvas.height = 200;
        context.clearRect(0, 0, 200, 200);
        context.drawImage(image, sourceX, sourceY, squareSize, squareSize, 0, 0, 200, 200);

        return new Promise(function(resolve, reject) {
            canvas.toBlob(function(blob) {
                if (!blob) {
                    reject(new Error('Avatar resize failed.'));
                    return;
                }

                resolve({
                    blob: blob,
                    filename: 'avatar.' + fileExtension
                });
            }, outputType, outputType === 'image/jpeg' ? 0.92 : undefined);
        });
    });
}

function loadAccountImageFromFile(file) {
    return new Promise(function(resolve, reject) {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = function() {
            URL.revokeObjectURL(objectUrl);
            resolve(image);
        };
        image.onerror = function() {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Image load failed.'));
        };
        image.src = objectUrl;
    });
}

function applyAccountFieldErrors(form, fieldErrors) {
    if (!form || typeof window.applyFieldErrors !== 'function') {
        return null;
    }

    return window.applyFieldErrors(form, fieldErrors, {
        avatar: '[data-account-avatar-input]',
        bio: '[data-account-bio]',
        display_name: '[data-account-display-name]',
        location: '[data-account-location]',
        profile_visibility: '[data-account-public-toggle]',
        unit_preference: '[data-account-unit-input]'
    });
}

function clearAccountFormErrors(form) {
    if (form && typeof window.clearFormFieldErrors === 'function') {
        window.clearFormFieldErrors(form);
    }
}

function clearAccountFieldError(control) {
    if (control && typeof window.clearFieldError === 'function') {
        window.clearFieldError(control);
    }
}

function setAccountInlineMessage(element, message, type) {
    if (!element) {
        return;
    }

    const normalizedMessage = String(message || '').trim();
    element.hidden = !normalizedMessage;
    element.textContent = normalizedMessage;
    element.classList.remove('is-success', 'is-danger');
    if (normalizedMessage && type === 'success') {
        element.classList.add('is-success');
    }
    if (normalizedMessage && type === 'error') {
        element.classList.add('is-danger');
    }
}

function openAccountDeleteModal(elements) {
    if (!elements.deleteModal) {
        return;
    }

    elements.deleteModal.classList.add('is-active');
    document.documentElement.classList.add('is-clipped');
    if (elements.deleteConfirmInput) {
        elements.deleteConfirmInput.value = '';
    }
    setAccountDeleteError(elements, '');
    syncAccountDeleteConfirmState(elements);
    if (elements.deleteConfirmInput && typeof elements.deleteConfirmInput.focus === 'function') {
        window.setTimeout(function() {
            elements.deleteConfirmInput.focus();
        }, 40);
    }
}

function closeAccountDeleteModal(elements, state) {
    if (!elements.deleteModal || (state && state.deleteBusy)) {
        return;
    }

    elements.deleteModal.classList.remove('is-active');
    document.documentElement.classList.remove('is-clipped');
    if (elements.deleteConfirmInput) {
        elements.deleteConfirmInput.value = '';
    }
    setAccountDeleteError(elements, '');
    syncAccountDeleteConfirmState(elements);
}

function setAccountDeleteError(elements, message) {
    if (!elements.deleteError) {
        return;
    }

    elements.deleteError.textContent = String(message || '').trim();
    if (elements.deleteConfirmInput) {
        if (message) {
            elements.deleteConfirmInput.classList.add('field-error', 'is-danger');
            elements.deleteConfirmInput.setAttribute('aria-invalid', 'true');
        } else {
            elements.deleteConfirmInput.classList.remove('field-error', 'is-danger');
            elements.deleteConfirmInput.removeAttribute('aria-invalid');
        }
    }
}

function syncAccountDeleteConfirmState(elements) {
    const typedValue = String(elements.deleteConfirmInput ? elements.deleteConfirmInput.value : '').trim();
    const isReady = typedValue === ACCOUNT_DELETE_CONFIRM_TEXT;
    if (elements.deleteConfirmButton) {
        elements.deleteConfirmButton.disabled = !isReady;
        elements.deleteConfirmButton.classList.toggle('is-disabled', !isReady);
    }
    if (typedValue && typedValue !== ACCOUNT_DELETE_CONFIRM_TEXT) {
        setAccountDeleteError(elements, 'Type DELETE exactly to confirm account deletion.');
        return;
    }
    if (!typedValue || isReady) {
        setAccountDeleteError(elements, '');
    }
}

function syncAccountBioCounter(elements) {
    const counter = elements.bioCounter;
    const textarea = elements.bioInput;
    if (!counter || !textarea) {
        return;
    }

    const length = String(textarea.value || '').length;
    counter.textContent = String(length) + ' / 500';
    counter.classList.toggle('is-warning', length >= 460 && length < 500);
    counter.classList.toggle('is-danger', length >= 500);
}

function syncAccountPreview(elements) {
    const displayName = String(elements.displayNameInput ? elements.displayNameInput.value : '').trim() || 'Climber';
    const bio = String(elements.bioInput ? elements.bioInput.value : '').trim();
    const location = String(elements.locationInput ? elements.locationInput.value : '').trim();

    if (elements.previewDisplayName) {
        elements.previewDisplayName.textContent = displayName;
    }

    if (elements.previewLocation) {
        if (location) {
            elements.previewLocation.innerHTML = '<i class="fas fa-location-dot"></i> ' + escapeAccountHtml(location);
        } else {
            elements.previewLocation.textContent = 'Add a location to show where you climb from.';
        }
    }

    if (elements.previewBio) {
        elements.previewBio.textContent = bio || 'Your bio will appear here once you add one.';
    }

    if (elements.previewProfileLink) {
        if (displayName && ACCOUNT_DISPLAY_NAME_PATTERN.test(displayName)) {
            elements.previewProfileLink.innerHTML = '<a href="/profile/me">/profile/' + escapeAccountHtml(displayName) + '</a>';
        } else {
            elements.previewProfileLink.textContent = 'Saved after you set a display name';
        }
    }
}

function syncAccountPreferencePreview(elements) {
    const isPublic = Boolean(elements.publicToggle && elements.publicToggle.checked);
    const unitPreference = getAccountSelectedUnitPreference(elements, 'metric');

    if (elements.publicToggleLabel) {
        elements.publicToggleLabel.textContent = isPublic ? 'Public' : 'Private';
    }

    if (elements.privacyDescription) {
        elements.privacyDescription.textContent = isPublic
            ? 'Other climbers can see your profile, bio, location, stats, climb history, and leaderboard placements.'
            : 'Your public profile and leaderboard placements stay hidden from other climbers until you switch this on.';
    }

    if (elements.previewVisibility) {
        elements.previewVisibility.textContent = isPublic ? 'Public profile' : 'Private profile';
    }

    if (elements.previewUnitPreference) {
        elements.previewUnitPreference.textContent = unitPreference === 'imperial'
            ? 'Imperial (feet)'
            : 'Metric (metres)';
    }
}

function applyAccountAvatarPreview(elements, avatarUrl) {
    const normalizedUrl = String(avatarUrl || '').trim();
    const hasAvatar = Boolean(normalizedUrl);
    [elements.avatarImage, elements.previewAvatarImage].forEach(function(imageElement) {
        if (!imageElement) {
            return;
        }
        if (hasAvatar) {
            imageElement.setAttribute('src', normalizedUrl);
            imageElement.hidden = false;
        } else {
            imageElement.removeAttribute('src');
            imageElement.hidden = true;
        }
    });
    [elements.avatarIcon, elements.previewAvatarIcon].forEach(function(iconElement) {
        if (!iconElement) {
            return;
        }
        iconElement.hidden = hasAvatar;
    });
}

function revokeAccountAvatarPreview(state) {
    if (state.avatarObjectUrl) {
        URL.revokeObjectURL(state.avatarObjectUrl);
        state.avatarObjectUrl = '';
    }
}

function setAccountAvatarFileLabel(elements, text) {
    if (elements.avatarFileName) {
        elements.avatarFileName.textContent = String(text || '').trim() || 'No file selected';
    }
}

function setAccountAvatarHelp(elements, text) {
    if (elements.avatarHelp) {
        elements.avatarHelp.textContent = String(text || '').trim();
    }
}

function toggleAccountSaveBusy(button, isBusy) {
    if (button && typeof window.setButtonLoading === 'function') {
        window.setButtonLoading(button, isBusy);
        return;
    }

    if (!button) {
        return;
    }

    button.disabled = Boolean(isBusy);
    button.classList.toggle('is-loading', Boolean(isBusy));
}

function syncNavbarDisplayName(displayName) {
    const normalizedName = String(displayName || '').trim();
    if (!normalizedName) {
        return;
    }

    document.querySelectorAll('.site-navbar__display-name').forEach(function(element) {
        element.textContent = normalizedName;
    });
}

function clearAccountUnitErrors(elements) {
    elements.unitInputs.forEach(function(input) {
        clearAccountFieldError(input);
    });
}

function getAccountSelectedUnitPreference(elements, fallbackValue) {
    const selectedInput = elements.unitInputs.find(function(input) {
        return input.checked;
    });
    const normalizedValue = String(selectedInput ? selectedInput.value : fallbackValue || '').trim().toLowerCase();
    return ACCOUNT_UNIT_OPTIONS.has(normalizedValue)
        ? normalizedValue
        : String(fallbackValue || '').trim().toLowerCase();
}

function syncAccountUnitInputs(elements, unitPreference) {
    const normalizedUnit = ACCOUNT_UNIT_OPTIONS.has(String(unitPreference || '').trim().toLowerCase())
        ? String(unitPreference || '').trim().toLowerCase()
        : 'metric';
    elements.unitInputs.forEach(function(input) {
        input.checked = String(input.value || '').trim().toLowerCase() === normalizedUnit;
    });
}

function getAccountProfileIsPublic(profile) {
    const profileObject = profile && typeof profile === 'object' ? profile : {};
    const preferences = profileObject.preferences && typeof profileObject.preferences === 'object'
        ? profileObject.preferences
        : {};
    const candidateValues = [
        profileObject.profile_visibility,
        profileObject.public_profile,
        profileObject.is_public,
        profileObject.show_profile,
        preferences.profile_visibility,
        preferences.public_profile,
        preferences.is_public,
        preferences.show_profile
    ];

    for (let index = 0; index < candidateValues.length; index += 1) {
        const value = candidateValues[index];
        if (typeof value === 'boolean') {
            return value;
        }

        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized) {
            continue;
        }
        if (['public', 'everyone', 'all', 'true', '1', 'on', 'yes'].includes(normalized)) {
            return true;
        }
        if (['private', 'hidden', 'off', 'false', '0', 'only me', 'me'].includes(normalized)) {
            return false;
        }
    }

    return Boolean(String(profileObject.display_name || '').trim());
}

function getAccountProfileUnitPreference(profile) {
    const profileObject = profile && typeof profile === 'object' ? profile : {};
    const preferences = profileObject.preferences && typeof profileObject.preferences === 'object'
        ? profileObject.preferences
        : {};
    const candidateValues = [
        profileObject.unit_preference,
        profileObject.units,
        profileObject.measurement_system,
        profileObject.measurement_preference,
        profileObject.height_unit,
        profileObject.height_units,
        profileObject.distance_unit,
        profileObject.distance_units,
        profileObject.use_imperial_units,
        preferences.unit_preference,
        preferences.units,
        preferences.measurement_system,
        preferences.measurement_preference,
        preferences.height_unit,
        preferences.height_units,
        preferences.distance_unit,
        preferences.distance_units,
        preferences.use_imperial_units
    ];

    for (let index = 0; index < candidateValues.length; index += 1) {
        const value = candidateValues[index];
        if (typeof value === 'boolean') {
            return value ? 'imperial' : 'metric';
        }

        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized) {
            continue;
        }
        if (['imperial', 'feet', 'foot', 'ft', 'us', 'true', '1', 'yes', 'on'].includes(normalized)) {
            return 'imperial';
        }
        if (['metric', 'meters', 'metres', 'm', 'false', '0', 'no', 'off'].includes(normalized)) {
            return 'metric';
        }
    }

    return 'metric';
}

function escapeAccountHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
