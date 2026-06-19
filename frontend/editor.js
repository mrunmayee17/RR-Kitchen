// The editor is reached only at /editor/<token>; reuse that token to authorize writes.
const editorToken = decodeURIComponent((location.pathname.split("/editor/")[1] || "").replace(/\/$/, ""));

const elements = {
  recipeList: document.querySelector("#recipeList"),
  editorTitle: document.querySelector("#editorTitle"),
  editorStatus: document.querySelector("#editorStatus"),
  form: document.querySelector("#recipeForm"),
  titleInput: document.querySelector("#titleInput"),
  categoryInput: document.querySelector("#categoryInput"),
  prepInput: document.querySelector("#prepInput"),
  cookInput: document.querySelector("#cookInput"),
  servesInput: document.querySelector("#servesInput"),
  imageInput: document.querySelector("#imageInput"),
  descriptionInput: document.querySelector("#descriptionInput"),
  ingredientsInput: document.querySelector("#ingredientsInput"),
  methodInput: document.querySelector("#methodInput"),
  publishedInput: document.querySelector("#publishedInput"),
  newRecipeBtn: document.querySelector("#newRecipeBtn"),
  deleteRecipeBtn: document.querySelector("#deleteRecipeBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  importInput: document.querySelector("#importInput")
};

let recipes = [];
let selectedId = null;
let draftRecipe = null;

function authHeaders(extra = {}) {
  return { "X-Editor-Token": editorToken, ...extra };
}

function setStatus(message) {
  elements.editorStatus.textContent = message;
}

async function apiGetRecipes() {
  const response = await fetch("/api/recipes");
  if (!response.ok) throw new Error("Could not load recipes.");
  return response.json();
}

async function apiSave(recipe) {
  const isExisting = recipe.id && recipes.some((item) => item.id === recipe.id);
  const url = isExisting ? `/api/recipes/${encodeURIComponent(recipe.id)}` : "/api/recipes";
  const method = isExisting ? "PUT" : "POST";
  const response = await fetch(url, {
    method,
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(recipe)
  });
  if (!response.ok) throw new Error((await safeDetail(response)) || "Save failed.");
  return response.json();
}

async function apiDelete(id) {
  const response = await fetch(`/api/recipes/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (!response.ok) throw new Error((await safeDetail(response)) || "Delete failed.");
}

async function apiReplaceAll(list) {
  const response = await fetch("/api/recipes", {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(list)
  });
  if (!response.ok) throw new Error((await safeDetail(response)) || "Import failed.");
  return response.json();
}

async function safeDetail(response) {
  try {
    return (await response.json()).detail;
  } catch {
    return null;
  }
}

function selectedRecipe() {
  if (draftRecipe) return draftRecipe;
  if (selectedId === null) return null;
  return recipes.find((recipe) => recipe.id === selectedId) || recipes[0] || null;
}

async function refresh(selectId) {
  recipes = await apiGetRecipes();
  draftRecipe = null;
  selectedId = selectId || selectedRecipe()?.id || null;
  renderList();
  fillForm(selectedRecipe());
}

function renderList() {
  elements.recipeList.innerHTML = "";
  recipes.forEach((recipe) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `recipe-tab${recipe.id === selectedId ? " active" : ""}`;
    button.innerHTML = `<strong>${escapeHtml(recipe.title)}</strong><span>${escapeHtml(recipe.category || "")}</span>`;
    button.addEventListener("click", () => {
      draftRecipe = null;
      selectedId = recipe.id;
      renderList();
      fillForm(selectedRecipe());
    });
    elements.recipeList.append(button);
  });
}

function fillForm(recipe) {
  if (!recipe) {
    elements.form.reset();
    elements.editorTitle.textContent = "No recipes yet";
    return;
  }
  elements.editorTitle.textContent = recipe.title;
  elements.titleInput.value = recipe.title || "";
  elements.categoryInput.value = recipe.category || "";
  elements.prepInput.value = recipe.prep || "";
  elements.cookInput.value = recipe.cook || "";
  elements.servesInput.value = recipe.serves || "";
  elements.descriptionInput.value = recipe.description || "";
  elements.ingredientsInput.value = (recipe.ingredients || []).join("\n");
  elements.methodInput.value = (recipe.method || []).join("\n");
  elements.publishedInput.checked = Boolean(recipe.published);
  elements.imageInput.value = "";
}

function linesFromTextarea(value) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", reject);
    reader.readAsDataURL(file);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const current = selectedRecipe() || { image: "assets/kundapur-ghee-roast.png" };
  const uploadedImage = await readImageFile(elements.imageInput.files[0]);
  const recipe = {
    ...current,
    title: elements.titleInput.value.trim(),
    category: elements.categoryInput.value.trim(),
    prep: elements.prepInput.value.trim(),
    cook: elements.cookInput.value.trim(),
    serves: elements.servesInput.value.trim(),
    description: elements.descriptionInput.value.trim(),
    ingredients: linesFromTextarea(elements.ingredientsInput.value),
    method: linesFromTextarea(elements.methodInput.value),
    published: elements.publishedInput.checked,
    image: uploadedImage || current.image || "assets/kundapur-ghee-roast.png"
  };
  try {
    const saved = await apiSave(recipe);
    setStatus(`Saved "${saved.title}".`);
    draftRecipe = null;
    await refresh(saved.id);
  } catch (error) {
    setStatus(error.message);
  }
});

elements.newRecipeBtn.addEventListener("click", () => {
  selectedId = null;
  draftRecipe = {
    title: "New Amchi Recipe",
    category: "Konkani home recipe",
    prep: "15 min",
    cook: "30 min",
    serves: "4",
    published: false,
    image: "assets/kundapur-ghee-roast.png",
    description: "Add a short note about the dish.",
    ingredients: ["Add ingredients here"],
    method: ["Add cooking steps here"]
  };
  renderList();
  fillForm(draftRecipe);
  elements.editorTitle.textContent = "New recipe";
  setStatus("Fill in the details and save to publish.");
});

elements.deleteRecipeBtn.addEventListener("click", async () => {
  const recipe = selectedRecipe();
  if (draftRecipe) {
    draftRecipe = null;
    selectedId = recipes[0]?.id || null;
    renderList();
    fillForm(selectedRecipe());
    setStatus("Discarded new recipe draft.");
    return;
  }
  if (!recipe) return;
  if (recipes.length === 1) {
    setStatus("Keep at least one recipe in the kitchen.");
    return;
  }
  if (!confirm(`Delete "${recipe.title}"?`)) return;
  try {
    await apiDelete(recipe.id);
    selectedId = null;
    await refresh();
    setStatus(`Deleted "${recipe.title}".`);
  } catch (error) {
    setStatus(error.message);
  }
});

elements.exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(recipes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "rupas-kitchen-recipes.json";
  link.click();
  URL.revokeObjectURL(url);
});

elements.importInput.addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", async () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported) || imported.length === 0) throw new Error("Invalid recipe file.");
      await apiReplaceAll(imported);
      await refresh();
      setStatus(`Imported ${imported.length} recipes.`);
    } catch (error) {
      setStatus(error.message || "This recipe file could not be imported.");
    }
  });
  reader.readAsText(file);
  event.target.value = "";
});

refresh().catch((error) => setStatus(error.message));
