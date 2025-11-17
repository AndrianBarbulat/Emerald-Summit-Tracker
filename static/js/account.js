const ACCOUNT_DISPLAY_NAME_PATTERN = /^[A-Za-z0-9_]{3,30}$/;
const ACCOUNT_MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ACCOUNT_ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

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
        displayNameInput: form.querySelector('[data-account-display-name]'),
        locationInput: form.querySelector('[data-account-location]'),
        previewAvatarIcon: document.querySelector('[data-account-preview-avatar-icon]'),
        previewAvatarImage: document.querySelector('[data-account-preview-avatar-image]'),
        previewBio: document.querySelector('[data-account-preview-bio]'),
        previewDisplayName: document.querySelector('[data-account-preview-display-name]'),
        previewLocation: document.querySelector('[data-account-preview-location]'),
        previewProfileLink: document.querySelector('[data-account-preview-profile-link]'),
        saveButton: form.querySelector('[data-account-save-button]')
    };

    const state = {
        avatarBlob: null,
        avatarError: '',
        avatarFilename: '',
        avatarObjectUrl: '',
        originalAvatarUrl: elements.avatarImage && !elements.avatarImage.hidden
            ? String(elements.avatarImage.getAttribute('src') || '').trim()
            : '',
        originalFileLabel: elements.avatarFileName ? String(elements.avatarFileName.textContent || '').trim() : 'No file selected'
    };

    syncAccountBioCounter(elements);
    syncAccountPreview(elements);

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
        location: '[data-account-location]'
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

function escapeAccountHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
