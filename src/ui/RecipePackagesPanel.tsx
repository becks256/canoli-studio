import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { EditorApplication } from "../editor";
import type { Recipe } from "../ai/recipes/types";
import type {EditPlan} from "../ai/recipes/types";
import { readRecipePackage } from "../ai/recipes/package";
import { Button, Select } from "./controls";

export function RecipePackagesPanel({
  editor,
  currentRecipe,
}: {
  editor: EditorApplication;
  currentRecipe?: Recipe;
}) {
  const { document, state } = useSyncExternalStore(
    editor.subscribe,
    editor.getSnapshot,
  );
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selected, setSelected] = useState<{ recipe: Recipe; file: Blob }>();
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [progress,setProgress]=useState('');
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const execution=useRef<AbortController|null>(null);
  useEffect(()=>()=>execution.current?.abort(),[]);
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
  const [planned,setPlanned]=useState<{selected:typeof selected;params:typeof params;data:typeof state.document;selectedId:typeof state.selectedId;plan:EditPlan}|null>(null),[planError,setPlanError]=useState('');
  const plan=planned&&planned.selected===selected&&planned.params===params&&planned.data===state.document&&planned.selectedId===state.selectedId?planned.plan:null;
  useEffect(()=>{
    const abort=new AbortController();setPlanned(null);setPlanError('');
    if(selected)void editor.recipes.compilePackagePlan(selected.file,params,{signal:abort.signal}).then(value=>{if(!abort.signal.aborted)setPlanned({selected,params,data:state.document,selectedId:state.selectedId,plan:value});},error=>{if(!abort.signal.aborted)setPlanError(String(error));});
    return()=>abort.abort();
  },[selected,params,state.document,state.selectedId,document,editor]);
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
        Portable packages retain recipe source images and embedded font files,
        including complete font originals. They remain available after reloading.
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
          {selected.recipe.fontFiles?.length&&<section aria-label="Package font files"><h4>Embedded font files</h4><p>These packages retain complete original font files. Only dependencies needed by executed steps attach to the document.</p><ul>{selected.recipe.fontFiles.map(file=><li key={file.id}>{file.name} · {file.resource.report.faces[0].fullName??'Unnamed face'} · {file.resource.report.format.toUpperCase()}</li>)}</ul></section>}
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
            {planError&&<p role="alert">{planError}</p>}
            {!plan&&!planError&&<p role="status">Checking package sources and commands…</p>}
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
                  const controller=new AbortController();execution.current=controller;setProgress('Preparing package');
                  try{await editor.recipes.executeRecipePackage(selected.file,params,{signal:controller.signal,onProgress:value=>setProgress(`${value.phase}${value.fraction===null?'':` ${Math.round(value.fraction*100)}%`}`)});}
                  finally{if(execution.current===controller)execution.current=null;setProgress('');}
                  setMessage(
                    "Package executed. Undo restores the previous document.",
                  );
                })
              }
            >
              Run package
            </Button>
            {busy&&progress&&<div role="status">{progress} <Button onClick={()=>execution.current?.abort()}>Cancel preparation</Button></div>}
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
