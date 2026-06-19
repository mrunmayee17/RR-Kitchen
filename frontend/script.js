// Public site: read-only recipe browsing. Recipes come from the server API;
// editing happens only on the private /editor/<token> page. Momo's voice agent
// lives in momo.js.

const elements = {
  recipeList: document.querySelector("#recipeList"),
  recipeImage: document.querySelector("#recipeImage"),
  recipeStatus: document.querySelector("#recipeStatus"),
  recipeCategory: document.querySelector("#recipeCategory"),
  recipeTitle: document.querySelector("#recipeTitle"),
  recipeDescription: document.querySelector("#recipeDescription"),
  recipePrep: document.querySelector("#recipePrep"),
  recipeCook: document.querySelector("#recipeCook"),
  recipeServes: document.querySelector("#recipeServes"),
  recipeSource: document.querySelector("#recipeSource"),
  ingredientList: document.querySelector("#ingredientList"),
  methodList: document.querySelector("#methodList")
};

let recipes = [];
let selectedId = null;

async function loadRecipes() {
  try {
    const response = await fetch("/api/recipes");
    if (!response.ok) throw new Error("Could not load recipes.");
    recipes = await response.json();
  } catch {
    recipes = [];
  }
  selectedId = recipes[0]?.id || null;
  render();
}

function selectedRecipe() {
  return recipes.find((recipe) => recipe.id === selectedId) || recipes[0] || null;
}

function render() {
  const recipe = selectedRecipe();
  renderRecipeList();
  if (recipe) {
    selectedId = recipe.id;
    renderRecipe(recipe);
  }
}

function renderRecipeList() {
  elements.recipeList.innerHTML = "";
  recipes.forEach((recipe) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `recipe-tab${recipe.id === selectedId ? " active" : ""}`;
    button.innerHTML = `<strong>${escapeHtml(recipe.title)}</strong><span>${escapeHtml(recipe.category || "")}</span>`;
    button.addEventListener("click", () => {
      selectedId = recipe.id;
      render();
    });
    elements.recipeList.append(button);
  });
}

function renderRecipe(recipe) {
  elements.recipeImage.src = recipe.image || "assets/kundapur-ghee-roast.png";
  elements.recipeImage.alt = `${recipe.title} recipe photo`;
  elements.recipeStatus.textContent = recipe.published ? "Published" : "Draft";
  elements.recipeCategory.textContent = recipe.category || "";
  elements.recipeTitle.textContent = recipe.title || "";
  elements.recipeDescription.textContent = recipe.description || "";

  elements.recipeSource.innerHTML = "";
  if (recipe.sourceName && recipe.sourceUrl) {
    const link = document.createElement("a");
    link.href = recipe.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = recipe.sourceName;
    elements.recipeSource.append("Adapted from ", link);
    elements.recipeSource.hidden = false;
  } else {
    elements.recipeSource.hidden = true;
  }

  elements.recipePrep.textContent = recipe.prep || "";
  elements.recipeCook.textContent = recipe.cook || "";
  elements.recipeServes.textContent = recipe.serves || "";

  renderList(elements.ingredientList, recipe.ingredients || []);
  renderList(elements.methodList, recipe.method || []);
}

function renderList(container, items) {
  container.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    container.append(li);
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

loadRecipes();
