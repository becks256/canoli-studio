import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { EditorApplication } from "../editor";
import type { Recipe } from "../ai/recipes/types";
import { compileEditPlan } from "../ai/recipes/executor";
import { readRecipePackage, recipeAssetIds } from "../ai/recipes/package";
import { Button, Select } from "./controls";

export function RecipePackagesPanel({
  editor,
  currentRecipe,
}: {
  editor: EditorApplication;
  currentRecipe?: Recipe;
}) {
  const { document, state, assets } = useSyncExternalStore(
    editor.subscribe,
    editor.getSnapshot,
  );
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selected, setSelected] = useState<{ recipe: Recipe; file: Blob }>();
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const refresh = async () => setRecipes(await editor.recipes.packages.list());
  useEffect(() => {
    let active = true;
    editor.recipes.packages.list().then(
      (value) => {
        if (active) setRecipes(value);
      },
      (error) => {
        if (active) setError(String(error));
      },
    );
    return () => {
      active = false;
    };
  }, [editor]);
  const attempt = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const select = async (id: string) => {
    const file = await editor.recipes.packages.get(id);
    if (!file) throw new Error("Package was removed. Refresh the library.");
    const { recipe } = await readRecipePackage(file);
    setSelected({ recipe, file });
    setParams(
      Object.fromEntries(
        recipe.parameters.map((parameter) => [
          parameter.name,
          parameter.default ?? (parameter.type === "boolean" ? false : ""),
        ]),
      ),
    );
  };
  const plan = selected
    ? compileEditPlan(
        selected.recipe,
        state.document,
        document.selectedLayer?.id ?? null,
        params,
        new Set([
          ...assets.values().map((asset) => asset.id),
          ...recipeAssetIds(selected.recipe),
        ]),
      )
    : null;
  const download = (file: Blob, name: string) => {
    const url = URL.createObjectURL(file);
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.luma-recipe`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div
      className="recipe-packages-panel"
      role="tabpanel"
      id="recipe-panel-packages"
      aria-labelledby="recipe-tab-packages"
    >
      <p>
        Portable packages include recipe source images and remain available
        after reloading.
      </p>
      <div className="portable-package-actions">
        <Button
          disabled={busy || !currentRecipe}
          onClick={() =>
            void attempt(async () => {
              const file = await editor.recipes.exportRecipePackage(
                currentRecipe!,
              );
              await editor.recipes.packages.save(file);
              await refresh();
              await select(currentRecipe!.id);
              setMessage("Portable package saved.");
            })
          }
        >
          Save selected recipe with assets
        </Button>
        <Button disabled={busy} onClick={() => input.current?.click()}>
          Import package
        </Button>
        <Button disabled={busy} onClick={() => void attempt(refresh)}>
          Refresh packages
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          aria-label="Import portable recipe package"
          accept=".luma-recipe,application/x-luma-recipe"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file)
              void attempt(async () => {
                const recipe = await editor.recipes.packages.save(file);
                await refresh();
                await select(recipe.id);
                setMessage("Package imported. Review before running.");
              });
          }}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <Select
        label="Saved package"
        value={selected?.recipe.id ?? ""}
        disabled={busy}
        options={[
          { value: "", label: "Choose a package", disabled: true },
          ...recipes.map((recipe) => ({
            value: recipe.id,
            label: recipe.name,
          })),
        ]}
        onChange={(id) => void attempt(() => select(id))}
      />
      {selected && (
        <>
          <h3>{selected.recipe.name}</h3>
          <p>{selected.recipe.description}</p>
          {selected.recipe.parameters.map((parameter) => (
            <label className="portable-package-parameter" key={parameter.name}>
              <span>{parameter.label}</span>
              {parameter.type === "boolean" ? (
                <input
                  type="checkbox"
                  checked={params[parameter.name] === true}
                  disabled={busy}
                  onChange={(event) =>
                    setParams({
                      ...params,
                      [parameter.name]: event.target.checked,
                    })
                  }
                />
              ) : parameter.type === "choice" ? (
                <select
                  disabled={busy}
                  value={String(params[parameter.name] ?? "")}
                  onChange={(event) =>
                    setParams({
                      ...params,
                      [parameter.name]: event.target.value,
                    })
                  }
                >
                  <option value="">Choose</option>
                  {parameter.options?.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  className="input"
                  disabled={busy}
                  value={String(params[parameter.name] ?? "")}
                  onChange={(event) =>
                    setParams({
                      ...params,
                      [parameter.name]: event.target.value,
                    })
                  }
                />
              )}
            </label>
          ))}
          <div aria-label="Package dry run">
            {plan?.errors.map((error, index) => (
              <p key={index} role="alert">
                {error}
              </p>
            ))}
            <ol>
              {plan?.steps.map((step) => (
                <li key={step.stepId}>{step.expectedVisualChange}</li>
              ))}
            </ol>
          </div>
          <div className="portable-package-actions">
            <Button
              disabled={busy || !plan?.valid}
              variant="primary"
              onClick={() =>
                void attempt(async () => {
                  await editor.recipes.executeRecipePackage(
                    selected.file,
                    params,
                  );
                  setMessage(
                    "Package executed. Undo restores the previous document.",
                  );
                })
              }
            >
              Run package
            </Button>
            <Button
              disabled={busy}
              onClick={() => download(selected.file, selected.recipe.name)}
            >
              Export package
            </Button>
            <Button
              disabled={busy}
              variant="danger"
              onClick={() =>
                void attempt(async () => {
                  await editor.recipes.packages.delete(selected.recipe.id);
                  setSelected(undefined);
                  await refresh();
                })
              }
            >
              Delete package
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
