
(() => {
    if (window.__oupsEditor) return;
    window.__oupsEditor = true;

    const $ = id => document.getElementById(id);
    const container = $('canvas-container');

    if (!container || !window.Konva) return;

    let stage, layer, transformer;
    let selected = null;
    let textEditor = null;
    let currentKey = null;
    let saveTimer = null;
    let drawing = false;
    let currentLine = null;
    let history = [];
    let historyIndex = -1;
    let restoring = false;

    /* CANVAS */

    function createCanvas() {
        stage = new Konva.Stage({
            container,
            width: container.clientWidth,
            height: container.clientHeight
        });

        layer = new Konva.Layer();
        stage.add(layer);
        createTransformer();

        stage.on('click tap', selectFromCanvas);
        stage.on('dblclick dbltap', editFromCanvas);

        stage.on('dragend', () => {
            updateCanvasHeight();
            save();
        });

        stage.on('mousedown touchstart', startDrawing);
        stage.on('mousemove touchmove', draw);
        stage.on('mouseup touchend', stopDrawing);
    }

    function createTransformer() {
    transformer = new Konva.Transformer({
        resizeEnabled: true,
        rotateEnabled: false,
        keepRatio: true,
        anchorSize: 8,
        anchorStroke: '#B15E43',
        anchorFill: '#EAE7DF',
        borderStroke: '#B15E43',
        borderDash: [4, 4],
        enabledAnchors: [
            'top-left',
            'top-right',
            'bottom-left',
            'bottom-right'
        ],
        listening: true
    });

    layer.add(transformer);
    }




        /* UNDO / REDO */

        function updateHistoryButtons() {
            $('undo-button').disabled = historyIndex <= 0;
            $('redo-button').disabled = historyIndex >= history.length - 1;
        }

        function saveHistory() {
            if (restoring || !layer) return;

            const snapshot = JSON.stringify(
                layer.toJSON()
            );

            if (history[historyIndex] === snapshot) return;

            history = history.slice(0, historyIndex + 1);
            history.push(snapshot);

            historyIndex = history.length - 1;

            // Keep the last 50 steps
            if (history.length > 50) {
                history.shift();
                historyIndex--;
            }

            updateHistoryButtons();
        }

        function restoreHistory(index) {
            if (index < 0 || index >= history.length) return;

            finishEditing(false);

            restoring = true;
            historyIndex = index;

            const snapshot = JSON.parse(history[index]);

            layer.destroy();
            layer = Konva.Node.create(snapshot);

            layer.find('Transformer').forEach(node => node.destroy());

            stage.add(layer);

            restoreImages(layer);

            createTransformer();
            select(null);

            updateCanvasHeight();
            layer.draw();

            restoring = false;

            updateHistoryButtons();
            save();
        }

        function undo() {
            if (historyIndex > 0) {
                restoreHistory(historyIndex - 1);
            }
        }

        function redo() {
            if (historyIndex < history.length - 1) {
                restoreHistory(historyIndex + 1);
            }
        }

        $('undo-button').onclick = undo;
        $('redo-button').onclick = redo;

        document.addEventListener('keydown', e => {
            if (textEditor || e.target.matches('input, textarea')) return;

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
                e.preventDefault();

                if (e.shiftKey) redo();
                else undo();
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                redo();
            }
        });

    /* SELECTION */

    function getObject(target) {
        let node = target;

        while (node && node.getParent() !== layer) {
            node = node.getParent();
        }

        return !node || node === transformer ? null : node;
    }

        function select(element) {
        selected = element;
        transformer.nodes(element ? [element] : []);

        const isText = element?.getClassName() === 'Text';
        const isLine = element?.getClassName() === 'Line';

        $('delete-element').disabled = !element;

        [
            'format-bold',
            'format-italic',
            'format-underline',
            'font-bigger',
            'font-smaller'
        ].forEach(id => {
            $(id).disabled = !isText;
        });

        document.querySelectorAll('[data-color]').forEach(button => {
            button.disabled = !isText && !isLine;
        });

        $('element-info').textContent = element
            ? `${element.getClassName()} · X ${Math.round(element.x())} · Y ${Math.round(element.y())}`
            : 'Nothing selected';

        layer.batchDraw();
        }

    function selectFromCanvas(e) {
        if (textEditor || drawing) return;

        if (e.target === stage) {
            select(null);
            return;
        }

        const element = getObject(e.target);
        if (element) select(element);
    }

    /* DRAWING */

    function toggleDrawing() {
        drawing = !drawing;

        $('draw-tool').classList.toggle('active', drawing);

        stage.container().style.cursor = drawing
            ? 'crosshair'
            : 'default';

        select(null);
    }

    function startDrawing(e) {
        if (!drawing || textEditor) return;

        e.evt.preventDefault();

        const pos = stage.getPointerPosition();
        if (!pos) return;

        currentLine = new Konva.Line({
            points: [pos.x, pos.y],
            stroke: '#EAE7DF',
            strokeWidth: 3,
            hitStrokeWidth: 14,
            lineCap: 'round',
            lineJoin: 'round',
            tension: 0.3,
            draggable: true,
            listening: true
        });

        layer.add(currentLine);
        layer.draw();
    }

    function draw(e) {
        if (!drawing || !currentLine) return;

        e.evt.preventDefault();

        const pos = stage.getPointerPosition();
        if (!pos) return;

        currentLine.points(
            currentLine.points().concat([pos.x, pos.y])
        );

        layer.batchDraw();
        updateCanvasHeight();
    }

    function stopDrawing() {
        if (!currentLine) return;

        currentLine = null;
        updateCanvasHeight();
        save();
    }

    $('draw-tool').onclick = toggleDrawing;

    /* TEXT EDITING */

    function editFromCanvas(e) {
        if (drawing) return;

        let node = e.target;

        while (
            node &&
            node !== stage &&
            node.getClassName() !== 'Text'
        ) {
            node = node.getParent();
        }

        if (node && node !== stage) editText(node);
    }

    function editText(text) {
        finishEditing(false);
        select(text);

        const rect = stage.container().getBoundingClientRect();
        const pos = text.absolutePosition();

        const textarea = document.createElement('textarea');
        textEditor = textarea;
        textarea.value = text.text();

        Object.assign(textarea.style, {
            position: 'fixed',
            left: `${rect.left + pos.x}px`,
            top: `${rect.top + pos.y - container.scrollTop}px`,
            width: `${Math.max(100, text.width())}px`,
            height: `${Math.max(60, text.height() + 20)}px`,
            fontFamily: text.fontFamily(),
            fontSize: `${text.fontSize()}px`,
            fontStyle: text.fontStyle(),
            color: text.fill(),
            background: '#22221F',
            border: '1px solid #B15E43',
            padding: '8px',
            outline: 'none',
            resize: 'none',
            zIndex: 10000
        });

        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        textarea.addEventListener('input', () => {
            text.text(textarea.value);
            layer.draw();
            updateCanvasHeight();
        });

        textarea.addEventListener('keydown', e => {
            e.stopPropagation();

            if (e.key === 'Escape' ||
                (e.key === 'Enter' && e.ctrlKey)) {
                e.preventDefault();
                finishEditing();
            }
        });

        textarea.addEventListener('blur', () => {
            if (textEditor === textarea) finishEditing();
        });
    }

    function finishEditing(shouldSave = true) {
        if (!textEditor) return;

        textEditor.remove();
        textEditor = null;

        layer.draw();
        updateCanvasHeight();

        if (shouldSave) save();
    }



    /* CANVAS HEIGHT */

    function updateCanvasHeight() {
        if (!layer || !stage) return;

        let bottom = container.clientHeight;

        layer.getChildren().forEach(node => {
            if (node === transformer) return;

            const rect = node.getClientRect({
                relativeTo: layer
            });

            bottom = Math.max(
                bottom,
                rect.y + rect.height + 100
            );
        });

        stage.height(Math.max(container.clientHeight, bottom));
        layer.batchDraw();
    }

    /* ADD TEXT */

    $('add-text').onclick = () => {
        finishEditing();

        const text = new Konva.Text({
            x: 30,
            y: container.scrollTop + 40,
            width: Math.min(250, stage.width() - 60),
            text: 'Write your ideas here...',
            fontSize: 18,
            fontFamily: 'Arial',
            fill: '#EAE7DF',
            draggable: true,
            padding: 10,
            lineHeight: 1.4
        });

        layer.add(text);
        select(text);
        updateCanvasHeight();
        layer.draw();
        save();
        editText(text);
    };




/* UPLOAD IMAGE */

$('upload-image').onclick = () => $('image-input').click();

$('image-input').onchange = e => {
    const file = e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;

    const reader = new FileReader();

    reader.onload = event => {
        const image = new Image();

        image.onload = () => {
            // Compress and resize image
            const maxSize = 1400;
            const scale = Math.min(
                1,
                maxSize / Math.max(image.width, image.height)
            );

            const canvas = document.createElement('canvas');
            canvas.width = Math.round(image.width * scale);
            canvas.height = Math.round(image.height * scale);

            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

            const src = canvas.toDataURL('image/jpeg', 0.75);

            const compressedImage = new Image();

            compressedImage.onload = () => {
                const node = new Konva.Image({
                    x: 30,
                    y: container.scrollTop + 40,
                    image: compressedImage,
                    imageSrc: src,
                    width: canvas.width,
                    height: canvas.height,
                    draggable: true
                });

                layer.add(node);
                select(node);
                updateCanvasHeight();
                layer.draw();
                save();
            };

            compressedImage.src = src;
        };

        image.src = event.target.result;
    };

    reader.readAsDataURL(file);
    e.target.value = '';
};




/* UPLOAD IMAGE */

$('upload-image').onclick = () => {
    $('image-input').click();
};

$('image-input').onchange = e => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alert('Please select an image.');
        return;
    }

    const reader = new FileReader();

    reader.onload = event => {
        const image = new Image();

        image.onload = () => {
            const maxWidth = Math.min(400, stage.width() - 60);
            const scale = Math.min(1, maxWidth / image.width);

            const uploadedImage = new Konva.Image({
                x: 30,
                y: container.scrollTop + 40,
                image: image,
                imageSrc: event.target.result,
                width: image.width * scale,
                height: image.height * scale,
                draggable: true
            });

            layer.add(uploadedImage);
            select(uploadedImage);

            updateCanvasHeight();
            layer.draw();
            save();
        };

        image.src = event.target.result;
    };

    reader.readAsDataURL(file);
    e.target.value = '';
};


    /* FORMATTING */

    function getText() {
        return selected?.getClassName() === 'Text'
            ? selected
            : null;
    }

    function changeStyle(style) {
        const text = getText();
        if (!text) return;

        const styles = (text.fontStyle() || 'normal')
            .split(' ')
            .filter(s => s && s !== 'normal');

        const index = styles.indexOf(style);

        if (index >= 0) styles.splice(index, 1);
        else styles.push(style);

        text.fontStyle(styles.join(' ') || 'normal');

        layer.draw();
        save();
    }

    $('format-bold').onclick = () => changeStyle('bold');
    $('format-italic').onclick = () => changeStyle('italic');

    $('format-underline').onclick = () => {
        const text = getText();
        if (!text) return;

        text.textDecoration(
            text.textDecoration() === 'underline' ? '' : 'underline'
        );

        layer.draw();
        save();
    };

    $('font-bigger').onclick = () => {
        const text = getText();
        if (!text) return;

        text.fontSize(Math.min(48, text.fontSize() + 2));
        layer.draw();
        updateCanvasHeight();
        save();
    };

    $('font-smaller').onclick = () => {
        const text = getText();
        if (!text) return;

        text.fontSize(Math.max(12, text.fontSize() - 2));
        layer.draw();
        updateCanvasHeight();
        save();
    };

    document.querySelectorAll('[data-color]').forEach(button => {
    button.onclick = () => {
        if (!selected) return;

        const color = button.dataset.color;

        if (selected.getClassName() === 'Text') {
            selected.fill(color);
        }

        if (selected.getClassName() === 'Line') {
            selected.stroke(color);
        }

        layer.draw();
        save();
    };
});

    /* DELETE */

    $('delete-element').onclick = () => {
        if (!selected) return;

        selected.destroy();
        select(null);
        updateCanvasHeight();
        layer.draw();
        save();
    };

    /* SAVE */

    saveHistory();

    function save() {
        
        saveHistory();

        clearTimeout(saveTimer);
        $('save-status').textContent = 'Unsaved';
        saveTimer = setTimeout(saveCanvas, 800);
    }

    async function saveCanvas() {
        if (!currentKey) return;

        $('save-status').textContent = 'Saving...';

        try {
            const canvas = JSON.parse(layer.toJSON());

            canvas.children = (canvas.children || [])
                .filter(child => child.className !== 'Transformer');

            const response = await fetch('/api/canvas/' + currentKey, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ canvas })
            });

            if (!response.ok) {
            const message = await response.text();
            throw new Error(
                `Save failed (${response.status}): ${message}`
            );
            }

            $('save-status').textContent = 'Saved ✓';
        } catch (error) {
            console.error(error);
            $('save-status').textContent = 'Save failed';
        }
    }




function restoreImages(targetLayer) {
    targetLayer.find('Image').forEach(node => {
        const src = node.getAttr('imageSrc');
        if (!src) return;

        const image = new Image();

        image.onload = () => {
            node.image(image);
            targetLayer.batchDraw();
        };

        image.src = src;
    });
}






    /* LOAD */

    async function loadCanvas(key) {
        clearTimeout(saveTimer);
        finishEditing(false);

        $('save-status').textContent = 'Loading...';

        try {
            const response = await fetch('/api/canvas/' + key);
            if (!response.ok) throw new Error('Load failed');

            const result = await response.json();

            layer.destroy();
            selected = null;

            layer = result.canvas
                ? Konva.Node.create(result.canvas)
                : new Konva.Layer();

            layer.find('Transformer').forEach(node => node.destroy());

            layer.getChildren().forEach(node => {
                node.draggable(true);
            });

            stage.add(layer);
            restoreImages(layer);


            currentKey = key;

            createTransformer();
            select(null);
            // Reset undo/redo for the new project
            history = [];
            historyIndex = -1;
            saveHistory();

            updateCanvasHeight();
            layer.draw();

            $('save-status').textContent = 'Saved ✓';
        } catch (error) {
            console.error(error);
            $('save-status').textContent = 'Load failed';
        }
    }

    /* EVENTS */

    function formatDate(value) {
        const [year, month, day] = String(value).slice(0, 10).split('-');

        return new Date(
            Number(year),
            Number(month) - 1,
            Number(day)
        ).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
    }

    function addEvent(event) {
        const item = document.createElement('div');
        item.className = 'event';
        item.dataset.key = event.canvas_key;

        const name = document.createElement('strong');
        name.textContent = event.artist_name;

        const date = document.createElement('small');
        date.textContent = formatDate(event.event_date);

        const remove = document.createElement('button');
        remove.className = 'delete-event';
        remove.textContent = '×';

        item.append(name, date, remove);
        $('event-list').append(item);
    }

    async function loadEvents() {
        try {
            const response = await fetch('/api/canvases');
            if (!response.ok) throw new Error('Events failed');

            const events = await response.json();

            $('event-list').innerHTML = '';
            events.forEach(addEvent);

            updateActivePage();
            return events;
        } catch (error) {
            console.error(error);
            $('event-list').textContent = 'Could not load events';
            return [];
        }
    }

    function updateActivePage() {
        document.querySelectorAll('.event').forEach(item => {
            item.classList.toggle(
                'active',
                item.dataset.key === currentKey
            );
        });

        const active = document.querySelector('.event.active strong');

        $('artist-title').textContent =
            'ARTIST EDITOR / ' +
            (active ? active.textContent.toUpperCase() : '');
    }

    $('event-list').addEventListener('click', async e => {
        const item = e.target.closest('.event');
        if (!item) return;

        const key = item.dataset.key;

        if (e.target.closest('.delete-event')) {
            if (!confirm('Delete this event and its artist page permanently?')) {
                return;
            }

            try {
                clearTimeout(saveTimer);
                finishEditing(false);

                const id = key.replace('event-', '');

                const response = await fetch('/api/events/' + id, {
                    method: 'DELETE'
                });

                if (!response.ok) throw new Error('Delete failed');

                const events = await loadEvents();

                if (currentKey === key) {
                    currentKey = null;

                    if (events.length) {
                        await loadCanvas(events[0].canvas_key);
                    } else {
                        layer.destroy();
                        layer = new Konva.Layer();
                        stage.add(layer);
                        createTransformer();
                        select(null);
                        updateCanvasHeight();
                    }
                }

                updateActivePage();
            } catch (error) {
                console.error(error);
                alert('Could not delete event.');
            }

            return;
        }

        if (key === currentKey) return;

        finishEditing(false);
        clearTimeout(saveTimer);
        await saveCanvas();
        await loadCanvas(key);
        updateActivePage();
    });

    /* PREVIEW */

    $('preview-button').onclick = () => {
        const preview = document.body.classList.toggle('preview-mode');

        $('preview-button').textContent = preview ? 'Edit' : 'Preview';

        finishEditing();
        select(null);

        stage.listening(!preview);
        layer.draw();
    };

    /* RESIZE */

    window.addEventListener('resize', () => {
        stage.width(container.clientWidth);
        updateCanvasHeight();
        layer.draw();
    });

    /* START */

    async function start() {
        createCanvas();

        const events = await loadEvents();

        if (events.length) {
            await loadCanvas(events[0].canvas_key);
        } else {
            $('save-status').textContent = 'No events';
        }

        updateActivePage();
    }

    start();
})();
