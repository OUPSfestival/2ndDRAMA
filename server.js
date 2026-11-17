const express = require('express');
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const path = require('path');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve all files from the main project folder
app.use(express.static(__dirname));

const sql = neon(process.env.DATABASE_URL);

// MAIN FESTIVAL PAGE
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function slugify(name) {
    return String(name)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

async function findArtistBySlug(slug) {
    const match = slug.match(/^(.+)-(\d+)$/);

    if (!match) return null;

    const id = Number(match[2]);

    if (!Number.isSafeInteger(id)) return null;

    const result = await sql`
        SELECT id, artist_name, event_date
        FROM events
        WHERE id = ${id}
    `;

    if (!result.length) return null;

    const artist = result[0];

    if (slugify(artist.artist_name) !== match[1]) {
        return null;
    }

    return artist;
}

// PUBLIC ARTIST PAGE
app.get('/artist/:slug', async (req, res) => {
    try {
        const artist = await findArtistBySlug(req.params.slug);

        if (!artist) {
            return res.status(404).send('Artist not found');
        }

        res.sendFile(__dirname + '/artist.html');

    } catch (error) {
        console.error(error);
        res.status(500).send('Could not open artist page');
    }
});

// API: FIND ARTIST
app.get('/api/artists/by-slug/:slug', async (req, res) => {
    try {
        const artist = await findArtistBySlug(req.params.slug);

        if (!artist) {
            return res.status(404).json({
                error: 'Artist not found'
            });
        }

        res.json(artist);

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: 'Could not find artist'
        });
    }
});



// Test database connection
app.get('/api/health', async (req, res) => {
    try {
        const result = await sql`SELECT NOW()`;
        res.json({ message: 'OUPS! connected to Neon!', time: result[0].now });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Database connection failed' });
    }
});

// Get all events
app.get('/api/events', async (req, res) => {
    try {
        const events = await sql`
            SELECT
                id,
                artist_name,
                TO_CHAR(event_date, 'YYYY-MM-DD') AS event_date,
                event_time,
                latitude,
                longitude,
                created_at
            FROM events
            ORDER BY event_date, event_time
        `;

        res.json(events);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Could not load events' });
    }
});

// GET ONE EVENT
app.get('/api/events/:id', async (req, res) => {
    try {
        const result = await sql`
            SELECT * FROM events WHERE id = ${req.params.id}
        `;

        if (!result.length) {
            return res.status(404).json({ error: 'Artist not found' });
        }

        res.json(result[0]);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Could not load artist' });
    }
});


// REGISTER A NEW EVENT AND CREATE ITS EDITOR PAGE
app.post('/api/events', async (req, res) => {
    try {
        const { artist_name, event_date, event_time, latitude, longitude } = req.body;

        if (
            typeof artist_name !== 'string' ||
            !artist_name.trim() ||
            !/^\d{4}-\d{2}-\d{2}$/.test(event_date) ||
            !/^\d{2}:\d{2}$/.test(event_time) ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            latitude < -90 || latitude > 90 ||
            longitude < -180 || longitude > 180
        ) {
            return res.status(400).json({ error: 'Invalid event details' });
        }

        const result = await sql`
            INSERT INTO events
                (artist_name, event_date, event_time, latitude, longitude)
            VALUES
                (${artist_name.trim()}, ${event_date}, ${event_time}, ${latitude}, ${longitude})
            RETURNING *
        `;

        const newEvent = result[0];
        const canvasKey = `event-${newEvent.id}`;

        // Create an empty editor canvas for this event
        await sql`
            INSERT INTO artist_canvases
                (artist_key, canvas_json, updated_at)
            VALUES
                (${canvasKey}, ${JSON.stringify({
                    className: 'Layer',
                    attrs: {},
                    children: []
                })}::jsonb, NOW())
            ON CONFLICT (artist_key) DO NOTHING
        `;

        res.status(201).json({
            ...newEvent,
            canvas_key: canvasKey
        });

    } catch (error) {
        console.error('Event creation error:', error);
        res.status(500).json({ error: 'Could not create event and editor page' });
    }
});



// GET ALL ARTIST EDITOR PAGES
app.get('/api/canvases', async (req, res) => {
    try {
        const pages = await sql`
            SELECT
                e.id,
                e.artist_name,
                e.event_date,
                'event-' || e.id AS canvas_key
            FROM events e
            ORDER BY e.event_date, e.event_time
        `;

        res.json(pages);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Could not load editor pages' });
    }
});




// LOAD AN ARTIST CANVAS
app.get('/api/canvas/:key', async (req, res) => {
    try {
        const key = req.params.key;

        if (!/^event-\d+$/.test(key)) {
            return res.status(400).json({ error: 'Invalid canvas key' });
        }

        const result = await sql`
            SELECT canvas_json
            FROM artist_canvases
            WHERE artist_key = ${key}
        `;

        res.json({
            canvas: result.length ? result[0].canvas_json : null
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Could not load canvas' });
    }
});

// SAVE AN ARTIST CANVAS
app.put('/api/canvas/:key', async (req, res) => {
    try {
        const key = req.params.key;
        const canvas = req.body.canvas;

        if (!/^event-\d+$/.test(key)) {
            return res.status(400).json({ error: 'Invalid canvas key' });
        }

        if (!canvas || typeof canvas !== 'object' || Array.isArray(canvas)) {
            return res.status(400).json({ error: 'Invalid canvas data' });
        }

        await sql`
            INSERT INTO artist_canvases
                (artist_key, canvas_json, updated_at)
            VALUES
                (${key}, ${JSON.stringify(canvas)}::jsonb, NOW())
            ON CONFLICT (artist_key)
            DO UPDATE SET
                canvas_json = EXCLUDED.canvas_json,
                updated_at = NOW()
        `;

        res.json({ message: 'Canvas saved!' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Could not save canvas' });
    }
});




// DELETE EVENT AND ITS ARTIST CANVAS
app.delete('/api/events/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id)) {
            return res.status(400).json({ error: 'Invalid ID' });
        }

        // Delete the event
        const result = await sql`
            DELETE FROM events
            WHERE id = ${id}
            RETURNING id
        `;

        if (!result.length) {
            return res.status(404).json({ error: 'Event not found' });
        }

        // Delete its artist canvas
        await sql`
            DELETE FROM artist_canvases
            WHERE artist_key = ${'event-' + id}
        `;

        res.json({ message: 'Event deleted!' });

    } catch (error) {
        console.error('DELETE EVENT ERROR:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
const PORT = 3000;

app.listen(PORT, () => {
    console.log(`OUPS! running at http://localhost:${PORT}`);
});