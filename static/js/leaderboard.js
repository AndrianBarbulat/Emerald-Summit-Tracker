(function () {
    function showLeaderboardToast(message, type) {
        if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
            window.showToast(message, type || 'success');
        }
    }

    async function triggerLeaderboardShare(button) {
        if (!button) {
            return;
        }

        const shareUrl = String(button.getAttribute('data-share-url') || '').trim();
        const shareTitle = String(button.getAttribute('data-share-title') || 'Leaderboard').trim();
        const shareText = String(button.getAttribute('data-share-text') || shareTitle).trim();
        if (!shareUrl) {
            showLeaderboardToast('We could not generate a leaderboard share link yet.', 'warning');
            return;
        }

        if (navigator.share) {
            try {
                await navigator.share({
                    title: shareTitle,
                    text: shareText,
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
                showLeaderboardToast('Leaderboard share link copied.', 'success');
                return;
            } catch (error) {
                // Fall through to opening the share URL.
            }
        }

        window.open(shareUrl, '_blank', 'noopener,noreferrer');
    }

    function initLeaderboardShareButtons(root) {
        if (!root) {
            return;
        }

        const buttons = Array.from(root.querySelectorAll('[data-leaderboard-share-button]'));
        buttons.forEach(function (button) {
            if (button.dataset.leaderboardShareBound === 'true') {
                return;
            }
            button.addEventListener('click', function () {
                triggerLeaderboardShare(button);
            });
            button.dataset.leaderboardShareBound = 'true';
        });
    }

    function initLeaderboardTabs() {
        const root = document.querySelector('[data-leaderboard-page]');
        if (!root) {
            return;
        }

        const controls = Array.from(root.querySelectorAll('[data-leaderboard-tab-control]'));
        const panels = Array.from(root.querySelectorAll('[data-leaderboard-tab-panel]'));
        if (!controls.length || !panels.length) {
            return;
        }

        const allowedTabs = new Set(
            controls
                .map(function (control) {
                return control.getAttribute('data-leaderboard-tab-control');
                })
                .filter(Boolean)
        );
        const firstTab = controls[0].getAttribute('data-leaderboard-tab-control');
        const hasHighlightParam = typeof window !== 'undefined'
            && new URL(window.location.href).searchParams.has('highlight');

        function normalizeTabKey(value) {
            return String(value || '').replace(/^#/, '').trim().toLowerCase();
        }

        function getHashTab() {
            if (typeof window === 'undefined') {
                return '';
            }
            return normalizeTabKey(window.location.hash);
        }

        function syncUrlHash(tabKey) {
            if (typeof window === 'undefined' || !window.history || !window.history.replaceState) {
                return;
            }

            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.delete('tab');
            nextUrl.hash = tabKey ? '#' + tabKey : '';
            window.history.replaceState({}, '', nextUrl.toString());
        }

        function revealHighlightedRow(tabKey) {
            if (!hasHighlightParam || typeof window === 'undefined') {
                return;
            }

            const activePanel = panels.find(function (panel) {
                return panel.getAttribute('data-leaderboard-tab-panel') === tabKey;
            });
            if (!activePanel) {
                return;
            }

            const highlightedRow = activePanel.querySelector('[data-leaderboard-highlighted="true"]');
            if (!highlightedRow || root.dataset.highlightRevealFor === tabKey) {
                return;
            }

            root.dataset.highlightRevealFor = tabKey;
            window.requestAnimationFrame(function () {
                highlightedRow.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            });
        }

        function setActiveTab(tabKey, updateUrl) {
            const normalizedTabKey = normalizeTabKey(tabKey);
            if (!allowedTabs.has(normalizedTabKey)) {
                return;
            }

            controls.forEach(function (control) {
                const isActive = control.getAttribute('data-leaderboard-tab-control') === normalizedTabKey;
                control.classList.toggle('is-active', isActive);
                control.setAttribute('aria-selected', isActive ? 'true' : 'false');
                control.tabIndex = isActive ? 0 : -1;
            });

            panels.forEach(function (panel) {
                const isActive = panel.getAttribute('data-leaderboard-tab-panel') === normalizedTabKey;
                panel.classList.toggle('is-active', isActive);
                panel.hidden = !isActive;
            });

            if (updateUrl) {
                syncUrlHash(normalizedTabKey);
            }

            revealHighlightedRow(normalizedTabKey);
        }

        controls.forEach(function (control) {
            control.addEventListener('click', function () {
                setActiveTab(control.getAttribute('data-leaderboard-tab-control'), true);
            });
        });

        if (typeof window !== 'undefined') {
            window.addEventListener('hashchange', function () {
                const hashTab = getHashTab();
                if (allowedTabs.has(hashTab)) {
                    setActiveTab(hashTab, false);
                }
            });
        }

        const initialTab = normalizeTabKey(root.getAttribute('data-initial-tab'));
        const hashTab = getHashTab();
        const resolvedInitialTab = allowedTabs.has(hashTab)
            ? hashTab
            : allowedTabs.has(initialTab)
                ? initialTab
                : firstTab;
        setActiveTab(resolvedInitialTab, false);

        if (!allowedTabs.has(hashTab) && allowedTabs.has(resolvedInitialTab)) {
            syncUrlHash(resolvedInitialTab);
        }

        initLeaderboardShareButtons(root);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLeaderboardTabs);
    } else {
        initLeaderboardTabs();
    }
})();
