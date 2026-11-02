import { TextLayer, FontFile } from "../dom";
import type { EditorApplication } from "../editor";
import type { AffinePoint } from "../core/affine";
import defaultFontUrl from "@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url";
import type { FontSourceLease } from "../fonts/store";

/** Trusted local UI preparation. Font bytes come from the bundled OFL font;
 * one shared OO transaction admits its original source and the editable layer.
 * Nothing is installed or fetched by isolated commands/plugins. */
export async function insertEditorText(
  editor: EditorApplication,
  point: AffinePoint,
  control: { signal?: AbortSignal } = {},
): Promise<TextLayer> {
  const document = editor.document,
    assets = editor.assetStore,
    revision = document.getSnapshot().revision,
    alive = assets.captureLifetime();
  const check = () => {
    control.signal?.throwIfAborted();
    alive();
    if (
      editor.document !== document ||
      editor.assetStore !== assets ||
      document.getSnapshot().revision !== revision
    )
      throw new Error("The document changed while preparing text. Try again.");
  };
  check();
  let lease: FontSourceLease | undefined;
  try {
    if (document.precision === "float32") {
      const response = await fetch(defaultFontUrl, { signal: control.signal });
      check();
      if (!response.ok)
        throw new Error("The bundled text font could not be loaded.");
      lease = await assets.fonts.stage(await response.blob(), {}, control);
      check();
      lease.check();
    }
    let layer!: TextLayer;
    const staged = lease;
    document.transaction("Add text", () => {
      const file = staged
        ? document.fonts.files.add(
            new FontFile({
              id: staged.resource.id,
              name: "Manrope",
              resource: staged.resource.descriptor,
            }),
          )
        : undefined;
      layer = document.layers.add(
        new TextLayer({
          name: "Text",
          text: "Text",
          x: Math.round(point.x),
          y: Math.round(point.y),
          ...(file ? { fontFamily: file.family } : {}),
        }),
      ) as TextLayer;
    });
    document.selectedLayer = layer;
    return layer;
  } finally {
    lease?.release();
  }
}
