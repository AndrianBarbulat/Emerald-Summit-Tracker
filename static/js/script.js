(function() {
            // map  Ireland
            const map = L.map('peak-map').setView([53.15, -7.95], 7.5);

            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; CartoDB'
            }).addTo(map);

            // iconic peaks (ireland / northern ireland) temp submitted points
            const peaks = [
                { name: "Carrauntoohil", coords: [51.9999, -9.7422], user: "Maeve" },
                { name: "Lugnaquilla", coords: [52.9669, -6.4645], user: "Rian" },
                { name: "Galtymore", coords: [52.3661, -8.1789], user: "Siobhán" },
                { name: "Mweelrea", coords: [53.6373, -9.8301], user: "Dara" },
                { name: "Errigal", coords: [55.0339, -8.1131], user: "Orla" },
                { name: "Slieve Donard", coords: [54.18, -5.92], user: "Liam" },
                { name: "Mount Leinster", coords: [52.617, -6.778], user: "Cian" },
                { name: "Brandon Mountain", coords: [52.235, -10.254], user: "Aoife" }
            ];

            peaks.forEach(p => {
                const marker = L.marker(p.coords)
                    .bindPopup(`<b>${p.name}</b><br>submitted by ${p.user}`)
                    .addTo(map);
            });

            L.circle([53.27, -9.05], {
                color: '#326755',
                fillColor: '#4c8b73',
                fillOpacity: 0.15,
                radius: 38000
            }).addTo(map).bindTooltip('wild atlantic way hotspots', {sticky: true});
    })();