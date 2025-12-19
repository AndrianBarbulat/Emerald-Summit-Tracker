const CLIMB_WEATHER_META = {
    sunny: { icon: 'fa-sun', label: 'Sunny' },
    cloudy: { icon: 'fa-cloud-sun', label: 'Cloudy' },
    overcast: { icon: 'fa-cloud', label: 'Overcast' },
    rainy: { icon: 'fa-cloud-rain', label: 'Rainy' },
    windy: { icon: 'fa-wind', label: 'Windy' },
    snowy: { icon: 'fa-snowflake', label: 'Snowy' },
    foggy: { icon: 'fa-smog', label: 'Foggy' },
    mixed: { icon: 'fa-cloud-sun-rain', label: 'Mixed' }
};

function getClimbWeatherMeta(weatherKey) {
    const normalizedWeather = String(weatherKey || '').trim().toLowerCase();
    return CLIMB_WEATHER_META[normalizedWeather] || null;
}

function buildWeatherOptionsMarkup(selectedWeather) {
    const normalizedWeather = String(selectedWeather || '').trim().toLowerCase();
    let markup = '<option value="">Select weather</option>';
    Object.keys(CLIMB_WEATHER_META).forEach(function(weatherKey) {
        const meta = CLIMB_WEATHER_META[weatherKey];
        const selected = weatherKey === normalizedWeather ? ' selected' : '';
        markup += '<option value="' + window.escapeHtml(weatherKey) + '"' + selected + '>' + window.escapeHtml(meta.label) + '</option>';
    });
    return markup;
}

window.buildWeatherOptionsMarkup = buildWeatherOptionsMarkup;
window.CLIMB_WEATHER_META = CLIMB_WEATHER_META;
window.getClimbWeatherMeta = getClimbWeatherMeta;
