import wixWindowFrontend from 'wix-window-frontend';

$w.onReady(function () {
    $w("#button64").onClick(() => {
        wixWindowFrontend.lightbox.close({ action: 'accept' });
    });

    $w("#button65").onClick(() => {
        wixWindowFrontend.lightbox.close({ action: 'decline' });
    });
});