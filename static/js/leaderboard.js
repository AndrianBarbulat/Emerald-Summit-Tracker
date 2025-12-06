(function () {
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

        function setActiveTab(tabKey, updateUrl) {
            if (!allowedTabs.has(tabKey)) {
                return;
            }

            controls.forEach(function (control) {
                const isActive = control.getAttribute('data-leaderboard-tab-control') === tabKey;
                control.classList.toggle('is-active', isActive);
                control.setAttribute('aria-selected', isActive ? 'true' : 'false');
                control.tabIndex = isActive ? 0 : -1;
            });

            panels.forEach(function (panel) {
                const isActive = panel.getAttribute('data-leaderboard-tab-panel') === tabKey;
                panel.classList.toggle('is-active', isActive);
                panel.hidden = !isActive;
            });

            if (updateUrl && typeof window !== 'undefined' && window.history && window.history.replaceState) {
                const nextUrl = new URL(window.location.href);
                if (tabKey === 'peaks') {
                    nextUrl.searchParams.delete('tab');
                } else {
                    nextUrl.searchParams.set('tab', tabKey);
                }
                window.history.replaceState({}, '', nextUrl.toString());
            }
        }

        controls.forEach(function (control) {
            control.addEventListener('click', function () {
                setActiveTab(control.getAttribute('data-leaderboard-tab-control'), true);
            });
        });

        const initialTab = root.getAttribute('data-initial-tab');
        const resolvedInitialTab = allowedTabs.has(initialTab) ? initialTab : controls[0].getAttribute('data-leaderboard-tab-control');
        setActiveTab(resolvedInitialTab, false);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLeaderboardTabs);
    } else {
        initLeaderboardTabs();
    }
})();
