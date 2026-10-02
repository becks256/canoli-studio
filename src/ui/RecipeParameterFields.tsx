import type { RecipeParameter } from "../ai/recipes/types";

/** Keep entered values intact; the shared recipe resolver owns validation. */
export function RecipeParameterFields({
  parameters,
  values,
  onChange,
  disabled = false,
}: {
  parameters: RecipeParameter[];
  values: Record<string, unknown>;
  onChange(values: Record<string, unknown>): void;
  disabled?: boolean;
}) {
  return (
    <>
      {parameters.map((parameter) => {
        const value = values[parameter.name] ?? parameter.default ?? "";
        const options =
          parameter.type === "boolean" ? ["true", "false"] : parameter.options;
        return (
          <label className="portable-package-parameter" key={parameter.name}>
            <span>
              {parameter.label}
              {parameter.required ? " *" : ""}
            </span>
            {parameter.type === "boolean" || parameter.type === "choice" ? (
              <select
                disabled={disabled}
                value={String(value)}
                onChange={(event) =>
                  onChange({ ...values, [parameter.name]: event.target.value })
                }
              >
                <option value="">Choose</option>
                {options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                disabled={disabled}
                inputMode={parameter.type === "number" ? "decimal" : undefined}
                value={String(value)}
                title={parameter.description}
                onChange={(event) =>
                  onChange({ ...values, [parameter.name]: event.target.value })
                }
              />
            )}
          </label>
        );
      })}
    </>
  );
}
