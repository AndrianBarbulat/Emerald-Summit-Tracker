document.addEventListener('DOMContentLoaded', function() {
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
});
