const map = L.map('map', {
    zoomControl: false,
    doubleClickZoom: false
}).setView([50.8503, 4.3517], 13);

L.control.zoom({
    position: 'bottomright'
}).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
}).addTo(map);

// Popup elements
const popup = document.getElementById('event-popup');
const form = document.getElementById('event-form');
const cancelButton = document.getElementById('cancel-button');

let selectedLocation = null;

// Create Sun marker and show event information
function addEventMarker(event) {

    const markerIcon = L.divIcon({
        className: 'custom-marker',
        html: '<div>☉</div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
    });

    const marker = L.marker(
        [event.latitude, event.longitude],
        { icon: markerIcon }
    ).addTo(map);

const rawDate = String(event.event_date).slice(0, 10);
const [year, month, day] = rawDate.split('-');

const formattedDate = `${day}.${month}.${year}`;

;

const formattedTime = String(event.event_time).slice(0, 5);

const artistSlug = createArtistSlug(event);

marker.bindPopup(`
    <div class="event-info">
        <div>
            <strong>Date</strong>
            <span>${formattedDate}</span>
        </div>
        <div>
            <strong>Time</strong>
            <span>${formattedTime}</span>
        </div>
        <div>
            <strong>Artist</strong>
            <span>${escapeHTML(event.artist_name)}</span>
        </div>
            <button onclick="window.location.href='https://oups-our-drama-2nd-edition.onrender.com/artist/${artistSlug}'">
            Open artist page
            </button>
    </div>
`);
}

// Safely display artist names
function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function createArtistSlug(event) {
    const name = String(event.artist_name)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    return `${name}-${event.id}`;
}




// Load saved events from Neon
async function loadEvents() {

    try {
        const response = await fetch(
        'https://oups-our-drama-2nd-edition.onrender.com/api/events'
        );

        if (!response.ok) {
            throw new Error('Could not load events');
        }

        const events = await response.json();

        events.forEach(addEventMarker);

    } catch (error) {
        console.error(error);
        alert('Could not load festival events.');
    }
}

// Click map to open registration
map.on('dblclick', function(event) {

    selectedLocation = event.latlng;
    popup.classList.remove('hidden');

});

// Save event to Neon
form.addEventListener('submit', async function(event) {

    event.preventDefault();

    if (!selectedLocation) return;

    const artist = document.getElementById('artist').value;
    const date = document.getElementById('date').value;
    const time = document.getElementById('time').value;

    const saveButton = form.querySelector('button[type="submit"]');
    saveButton.disabled = true;

    try {
        const response = await fetch('/api/events', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                artist_name: artist,
                event_date: date,
                event_time: time,
                latitude: selectedLocation.lat,
                longitude: selectedLocation.lng
            })
        });

        if (!response.ok) {
            throw new Error('Could not save event');
        }

        const savedEvent = await response.json();

        addEventMarker(savedEvent);

        popup.classList.add('hidden');
        form.reset();
        selectedLocation = null;

    } catch (error) {
        console.error(error);
        alert('Could not save your event. Please try again.');
    } finally {
        saveButton.disabled = false;
    }

});

// Cancel registration
cancelButton.addEventListener('click', function() {

    popup.classList.add('hidden');
    form.reset();
    selectedLocation = null;

});

// Load existing events when website opens
loadEvents();
