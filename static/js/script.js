document.addEventListener('DOMContentLoaded', function() {
    // Initialize map
    const map = L.map('peak-map').setView([53.15, -7.95], 7.5);
    
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap, CartoDB'
    }).addTo(map);
    
    // Peak markers
    const peaks = [
        { name: "Carrauntoohil", coords: [51.9999, -9.7422], user: "Maeve" },
        { name: "Lugnaquilla", coords: [52.9669, -6.4645], user: "Rian" },
        { name: "Galtymore", coords: [52.3661, -8.1789], user: "Siobhán" },
        { name: "Mweelrea", coords: [53.6373, -9.8301], user: "Dara" }
    ];
    
    peaks.forEach(peak => {
        L.marker(peak.coords)
            .bindPopup(`<b>${peak.name}</b><br>submitted by ${peak.user}`)
            .addTo(map);
    });
});