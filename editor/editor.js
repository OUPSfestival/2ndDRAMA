const artistId = location.pathname.match(/\/artist\/([^/]+)/)?.[1];
const API = "/api";

const scroll = document.querySelector("#canvasScroll");
const canvas = new fabric.Canvas("canvas", {
  preserveObjectStacking: true,
  selection: true
});

canvas.setDimensions({
  width: Math.min(scroll.clientWidth, 1100),
  height: 1800
});
canvas.backgroundColor = "#e8e6dd";
canvas.renderAll();

let projects = [];
let current = null;
let undoStack = [], redoStack = [];
let restoring = false, saveTimer;

function snapshot() {
  if (restoring) return;
  undoStack.push(JSON.stringify(canvas.toJSON()));
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
  current.data = canvas.toJSON();
  save();
}

canvas.on("object:added", snapshot);
canvas.on("object:modified", snapshot);
canvas.on("object:removed", snapshot);

function save() {
  if (!current) return;

  clearTimeout(saveTimer);
  document.querySelector("#status").textContent = "EDITING...";

  saveTimer = setTimeout(async () => {
    try {
      const response = await fetch(`/api/canvas/${current.canvas_key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canvas: canvas.toJSON()
        })
      });

      if (!response.ok) throw new Error("Save failed");

      document.querySelector("#status").textContent = "SAVED ✓";

    } catch (error) {
      console.error(error);
      document.querySelector("#status").textContent = "SAVE ERROR!";
    }
  }, 700);
}

async function loadProject(p) {
  current = p;
  undoStack = [];
  redoStack = [];

  document.querySelector("#status").textContent = "LOADING...";

  try {
    const response = await fetch(`/api/canvas/${p.canvas_key}`);

    if (!response.ok) throw new Error("Could not load canvas");

    const result = await response.json();

    restoring = true;
    canvas.clear();
    canvas.backgroundColor = "#e8e6dd";

    if (result.canvas) {
      await canvas.loadFromJSON(result.canvas);
    }

    restoring = false;
    canvas.renderAll();
    undoStack = [JSON.stringify(canvas.toJSON())];
    redoStack = [];

    undoStack.push(JSON.stringify(canvas.toJSON()));

    document.querySelector("#pageName").textContent = p.artist_name;

    document.querySelectorAll(".project").forEach(el =>
      el.classList.toggle("active", el.dataset.id === p.id)
    );

    document.querySelector("#status").textContent = "SAVED ✓";

  } catch (error) {
    restoring = false;
    console.error(error);
    document.querySelector("#status").textContent = "LOAD ERROR";
  }
}

function renderProjects() {
  const list = document.querySelector("#projects");
  list.innerHTML = "";

  projects.forEach(p => {
    const el = document.createElement("div");
    el.className = "project";
    el.dataset.id = p.id;
    el.textContent = p.artist_name;

    el.onclick = () => loadProject(p);

    list.append(el);
  });
}

async function init() {
  const response = await fetch("/api/canvases");

  if (!response.ok) throw new Error("Could not load projects");

  projects = await response.json();

  renderProjects();

  const id = artistId.match(/-(\d+)$/)?.[1];

  const selected = projects.find(p => String(p.id) === id);

  if (selected) {
    await loadProject(selected);
  } else if (projects.length) {
    await loadProject(projects[0]);
  }
}

function addText() {
  const text = new fabric.IText("NEW TEXT", {
    left: 100, top: 100,
    fontSize: 32,
    fill: "#111111",
    fontFamily: "Arial"
  });
  canvas.add(text);
  canvas.setActiveObject(text);
  canvas.renderAll();
}

function addRect() {
  canvas.add(new fabric.Rect({
    left: 100, top: 100,
    width: 180, height: 120,
    fill: "transparent",
    stroke: "#111111",
    strokeWidth: 2
  }));
}

document.querySelectorAll("[data-tool]").forEach(button => {
  button.onclick = () => {
    const tool = button.dataset.tool;
    canvas.isDrawingMode = tool === "draw";

    if (tool === "text") addText();
    if (tool === "rect") addRect();

    document.querySelectorAll("[data-tool]")
      .forEach(b => b.classList.remove("active"));
    button.classList.add("active");
  };
});

document.querySelector("#image").onclick = () =>
  document.querySelector("#upload").click();

document.querySelector("#upload").onchange = e => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    alert("Please use images under 2 MB.");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => fabric.Image.fromURL(reader.result, img => {
    img.scaleToWidth(Math.min(400, img.width));
    img.set({ left: 100, top: 100 });
    canvas.add(img);
    canvas.setActiveObject(img);
  });
  reader.readAsDataURL(file);
  e.target.value = "";
};

document.querySelector("#delete").onclick = () => {
  const obj = canvas.getActiveObject();
  if (obj) canvas.remove(obj);
};

document.querySelector("#colour").oninput = e => {
  const obj = canvas.getActiveObject();
  if (!obj) return;
  obj.set(canvas.isDrawingMode ? "fill" : "fill", e.target.value);
  if (obj.type === "i-text") obj.set("fill", e.target.value);
  canvas.freeDrawingBrush.color = e.target.value;
  canvas.renderAll();
  snapshot();
};

document.querySelector("#fontSize").onchange = e => {
  const obj = canvas.getActiveObject();
  if (obj?.type === "i-text") {
    obj.set("fontSize", +e.target.value);
    canvas.renderAll();
    snapshot();
  }
};

function format(key, value) {
  const obj = canvas.getActiveObject();
  if (!obj || obj.type !== "i-text") return;
  obj.set(key, value);
  canvas.renderAll();
  snapshot();
}

document.querySelector("#bold").onclick = () => {
  const o = canvas.getActiveObject();
  format("fontWeight", o?.fontWeight === "bold" ? "normal" : "bold");
};

document.querySelector("#italic").onclick = () => {
  const o = canvas.getActiveObject();
  format("fontStyle", o?.fontStyle === "italic" ? "normal" : "italic");
};

document.querySelector("#underline").onclick = () => {
  const o = canvas.getActiveObject();
  format("underline", !o?.underline);
};

function restore(data) {
  restoring = true;
  canvas.loadFromJSON(JSON.parse(data), () => {
    restoring = false;
    canvas.renderAll();
    current.data = canvas.toJSON();
    save();
  });
}

document.querySelector("#undo").onclick = () => {
  if (undoStack.length < 2) return;
  redoStack.push(undoStack.pop());
  restore(undoStack.at(-1));
};

document.querySelector("#redo").onclick = () => {
  if (!redoStack.length) return;
  const state = redoStack.pop();
  undoStack.push(state);
  restore(state);
};

document.querySelector("#preview").onclick = () => {
  document.body.classList.toggle("preview");
  canvas.selection = document.body.classList.contains("preview");
  canvas.forEachObject(o => o.selectable = !canvas.selection);
  canvas.discardActiveObject();
  canvas.renderAll();
};

document.addEventListener("keydown", e => {
  if (e.target.matches("input,textarea") || e.target.isContentEditable) return;

  const key = e.key.toLowerCase();

  if (e.ctrlKey && key === "z") {
    e.preventDefault();
    document.querySelector("#undo").click();
  } else if (e.ctrlKey && key === "y") {
    e.preventDefault();
    document.querySelector("#redo").click();
  } else if (key === "t") addText();
  else if (key === "d") canvas.isDrawingMode = true;
  else if (key === "v") canvas.isDrawingMode = false;
  else if (key === "x" || key === "delete" || key === "backspace")
    document.querySelector("#delete").click();
  else if (e.ctrlKey && e.shiftKey && key === "n") {
    const name = prompt("Project name?");
    if (name) {
      const p = { id: crypto.randomUUID(), name, data: null };
      projects.push(p);
      renderProjects();
      loadProject(p);
      save();
    }
  }
});

canvas.freeDrawingBrush.width = 2;
canvas.freeDrawingBrush.color = "#111111";

init().catch(err => {
  document.querySelector("#status").textContent = "LOAD ERROR";
  console.error(err);
});