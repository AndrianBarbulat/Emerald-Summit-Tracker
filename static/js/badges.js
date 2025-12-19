document.addEventListener('DOMContentLoaded', function() {
    initPublicProfileBadges();
});

function initPublicProfileBadges() {
    document.querySelectorAll('[data-public-profile-badges]').forEach(function(section) {
        const toggleButton = section.querySelector('[data-public-profile-badges-toggle]');
        const overflowRow = section.querySelector('[data-public-profile-badges-overflow]');
        if (!toggleButton || !overflowRow) {
            return;
        }

        toggleButton.addEventListener('click', function() {
            const isExpanded = toggleButton.getAttribute('aria-expanded') === 'true';
            const nextExpanded = !isExpanded;
            const nextLabel = nextExpanded
                ? String(toggleButton.getAttribute('data-expanded-label') || 'Show fewer')
                : String(toggleButton.getAttribute('data-collapsed-label') || '').trim();

            toggleButton.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
            toggleButton.textContent = nextLabel || (nextExpanded ? 'Show fewer' : 'Show more');
            overflowRow.hidden = !nextExpanded;
            overflowRow.classList.toggle('is-hidden', !nextExpanded);
        });
    });
}

function ensureBadgeCelebrationModal() {
    const modal = document.querySelector('[data-badge-celebration-modal]');
    if (!modal) {
        return null;
    }

    if (modal.dataset.badgeCelebrationReady !== 'true') {
        modal.querySelectorAll('[data-badge-celebration-dismiss]').forEach(function(element) {
            element.addEventListener('click', function(event) {
                event.preventDefault();
                closeBadgeCelebration();
            });
        });

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape' && modal.classList.contains('is-active')) {
                closeBadgeCelebration();
            }
        });

        modal.dataset.badgeCelebrationReady = 'true';
    }

    return {
        modal: modal,
        heading: modal.querySelector('[data-badge-celebration-heading]'),
        summary: modal.querySelector('[data-badge-celebration-summary]'),
        list: modal.querySelector('[data-badge-celebration-list]'),
        continueButton: modal.querySelector('.badge-celebration-modal__continue'),
        shareButton: modal.querySelector('[data-badge-celebration-share]')
    };
}

function normalizeBadgeCelebrationPayload(badges) {
    if (!Array.isArray(badges)) {
        return [];
    }

    return badges.map(function(badge) {
        const currentBadge = badge || {};
        const label = String(currentBadge.label || currentBadge.name || currentBadge.key || '').trim();
        if (!label) {
            return null;
        }

        return {
            key: String(currentBadge.key || '').trim(),
            label: label,
            description: String(currentBadge.description || 'Badge unlocked from your climbing progress.').trim(),
            icon: String(currentBadge.icon || 'fa-award').trim() || 'fa-award',
            shareUrl: String(currentBadge.share_url || currentBadge.shareUrl || '').trim()
        };
    }).filter(Boolean);
}

function buildBadgeCelebrationCardsMarkup(badges) {
    return badges.map(function(badge, index) {
        const cardClasses = ['badge-celebration-card'];
        if (index === 0) {
            cardClasses.push('badge-celebration-card--featured');
        }

        return ''
            + '<article class="' + cardClasses.join(' ') + '">'
            + '  <div class="badge-celebration-card__icon" aria-hidden="true"><i class="fas ' + escapeHtml(badge.icon) + '"></i></div>'
            + '  <div class="badge-celebration-card__body">'
            + '    <h3 class="badge-celebration-card__title">' + escapeHtml(badge.label) + '</h3>'
            + '    <p class="badge-celebration-card__copy">' + escapeHtml(badge.description) + '</p>'
            + '  </div>'
            + '</article>';
    }).join('');
}

function launchBadgeCelebrationConfetti(badgeCount) {
    if (typeof window.confetti !== 'function') {
        return;
    }

    const normalizedCount = Math.max(1, Number(badgeCount || 1));
    const baseParticles = Math.min(220, 90 + (normalizedCount - 1) * 25);
    const confettiOptions = {
        colors: ['#D4A853', '#74C69D', '#1B4332', '#D8F3DC'],
        disableForReducedMotion: true,
        spread: 72,
        startVelocity: 32,
        ticks: 180
    };

    window.confetti({
        ...confettiOptions,
        angle: 60,
        origin: { x: 0.15, y: 0.62 },
        particleCount: Math.round(baseParticles / 2)
    });
    window.confetti({
        ...confettiOptions,
        angle: 120,
        origin: { x: 0.85, y: 0.62 },
        particleCount: Math.round(baseParticles / 2)
    });
}

function closeBadgeCelebration() {
    const elements = ensureBadgeCelebrationModal();
    if (!elements || !elements.modal.classList.contains('is-active')) {
        return;
    }

    elements.modal.classList.remove('is-active');
    elements.modal.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('is-clipped');
    if (elements.shareButton) {
        elements.shareButton.hidden = true;
        elements.shareButton.removeAttribute('data-share-url');
        elements.shareButton.removeAttribute('data-share-title');
    }
}

async function triggerBadgeShare(button) {
    if (!button) {
        return;
    }

    const shareUrl = String(button.getAttribute('data-share-url') || '').trim();
    const shareTitle = String(button.getAttribute('data-share-title') || 'Badge unlocked').trim();
    if (!shareUrl) {
        showToast('We could not generate a badge share link yet.', 'warning');
        return;
    }

    if (navigator.share) {
        try {
            await navigator.share({
                title: shareTitle,
                text: shareTitle + ' on Emerald Peak Explorer',
                url: shareUrl
            });
            return;
        } catch (error) {
            if (error && error.name === 'AbortError') {
                return;
            }
        }
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(shareUrl);
            showToast('Badge share link copied.', 'success');
            return;
        } catch (error) {
            // Fall through to opening the share page.
        }
    }

    window.open(shareUrl, '_blank', 'noopener,noreferrer');
}

function showBadgeCelebration(badges) {
    const normalizedBadges = normalizeBadgeCelebrationPayload(badges);
    if (!normalizedBadges.length) {
        return null;
    }

    const elements = ensureBadgeCelebrationModal();
    if (!elements || !elements.list || !elements.heading || !elements.summary) {
        return null;
    }

    const badgeCount = normalizedBadges.length;
    elements.heading.textContent = badgeCount === 1 ? 'New badge earned' : badgeCount + ' new badges earned';
    elements.summary.textContent = badgeCount === 1
        ? 'That climb unlocked a new milestone. Nicely done.'
        : 'That climb unlocked a fresh set of milestones. Keep the momentum going.';
    elements.list.innerHTML = buildBadgeCelebrationCardsMarkup(normalizedBadges);
    elements.list.classList.toggle('badge-celebration-modal__list--scrollable', badgeCount > 1);
    if (elements.shareButton) {
        const shareBadge = normalizedBadges[0];
        if (shareBadge && shareBadge.shareUrl) {
            elements.shareButton.hidden = false;
            elements.shareButton.setAttribute('data-share-url', shareBadge.shareUrl);
            elements.shareButton.setAttribute('data-share-title', shareBadge.label);
        } else {
            elements.shareButton.hidden = true;
            elements.shareButton.removeAttribute('data-share-url');
            elements.shareButton.removeAttribute('data-share-title');
        }
        if (elements.shareButton.dataset.badgeCelebrationBound !== 'true') {
            elements.shareButton.addEventListener('click', function() {
                triggerBadgeShare(elements.shareButton);
            });
            elements.shareButton.dataset.badgeCelebrationBound = 'true';
        }
    }

    elements.modal.classList.add('is-active');
    elements.modal.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('is-clipped');

    window.requestAnimationFrame(function() {
        if (elements.continueButton) {
            elements.continueButton.focus();
        }
    });

    launchBadgeCelebrationConfetti(badgeCount);
    return elements.modal;
}


window.closeBadgeCelebration = closeBadgeCelebration;
window.showBadgeCelebration = showBadgeCelebration;
