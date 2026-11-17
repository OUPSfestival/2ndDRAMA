
const slug = window.location.pathname.split('/').pop();

// Extract the database ID from the artist slug
const match = slug.match(/-(\d+)$/);
const id = match ? match[1] : null;

const container = document.getElementById('canvas-container');

let stage = null;

// Format date
function formatDate(value) {
    return String(value).slice(0, 10);
}

// Create artist slug
function createArtistSlug(name, id) {
    const artistName = String(name)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    return `${artistName}-${id}`;
}

// Load project sidebar
async function loadProjects() {
    const response = await fetch('/api/canvases');

    if (!response.ok) {
        throw new Error('Could not load projects');
    }

    const projects = await response.json();
    const list = document.getElementById('event-list');

    list.innerHTML = '';

    projects.forEach(project => {
        const projectId = project.canvas_key.replace('event-', '');

        const artistSlug = createArtistSlug(
            project.artist_name,
            projectId
        );

        const link = document.createElement('a');
        link.className = 'event';
        link.href = '/artist/' + artistSlug;

        if (String(projectId) === String(id)) {
            link.classList.add('active');
        }

        const name = document.createElement('strong');
        name.textContent = project.artist_name;

        const date = document.createElement('small');
        date.textContent = formatDate(project.event_date);

        link.append(name, date);
        list.appendChild(link);
    });
}

// Load artist canvas
async function loadArtist() {

    if (!id) {
        throw new Error('Invalid artist URL');
    }

    try {
        // Load artist information
        const eventResponse = await fetch('/api/events/' + id);

        if (!eventResponse.ok) {
            throw new Error('Artist not found');
        }

        const event = await eventResponse.json();

        document.getElementById('artist-name').textContent =
            event.artist_name;

        document.getElementById('artist-date').textContent =
            formatDate(event.event_date);

        // Load artist canvas
        const canvasResponse = await fetch('/api/canvas/event-' + id);

        if (!canvasResponse.ok) {
            throw new Error('Could not load canvas');
        }

        const result = await canvasResponse.json();

        if (stage) {
            stage.destroy();
        }

        stage = new Konva.Stage({
            container: 'canvas-container',
            width: container.clientWidth,
            height: container.clientHeight
        });

        // Load saved canvas, if available
        if (!result.canvas) {
            return;
        }

        const layer = Konva.Node.create(result.canvas);

        // Restore uploaded images
        layer.find('Image').forEach(node => {

            const src = node.getAttr('imageSrc');

            if (!src) return;

            const image = new Image();

            image.onload = () => {
                node.image(image);
                layer.batchDraw();
            };

            image.onerror = () => {
                console.error('Could not load uploaded image:', src);
            };

            image.src = src;
        });

        // Remove editor transformers
        layer.find('Transformer').forEach(t => t.destroy());

        // Add canvas ONCE
        stage.add(layer);

        // Visitor cannot edit the canvas
        stage.listening(false);

        layer.draw();

    } catch (error) {

        console.error('Artist page error:', error);

        document.getElementById('artist-name').textContent =
            'Artist page could not be loaded';
    }
}

// Start
async function init() {
    try {
        await loadProjects();
        await loadArtist();
    } catch (error) {
        console.error(error);
    }
}

init();
