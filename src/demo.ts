import { AssetStore } from "./core/assets";
import { createDocument, createRaster } from "./core/model";

export async function createDemo() {
  const assets = new AssetStore();
  const doc = createDocument("Form study", 1600, 1200);
  const add = async (
    name: string,
    width: number,
    height: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext("2d")!);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Sample image failed."))),
        "image/png",
      ),
    );
    const asset = await assets.add(blob, name);
    return createRaster(name, asset.id, width, height);
  };
  const paper = await add("Warm paper", 1600, 1200, (ctx) => {
    ctx.fillStyle = "#e8e2d5";
    ctx.fillRect(0, 0, 1600, 1200);
    const gradient = ctx.createRadialGradient(350, 100, 0, 800, 600, 1200);
    gradient.addColorStop(0, "#f6f2e8");
    gradient.addColorStop(1, "#d6cebd");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1600, 1200);
    ctx.strokeStyle = "#a39b8a";
    ctx.lineWidth = 1;
    ctx.strokeRect(70, 70, 1460, 1060);
  });
  paper.locked = true;
  const shapes = await add("Sculptural forms", 900, 860, (ctx) => {
    ctx.fillStyle = "#b14e35";
    ctx.beginPath();
    ctx.arc(555, 262, 223, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#263e38";
    ctx.beginPath();
    ctx.roundRect(135, 200, 400, 650, [200, 200, 0, 0]);
    ctx.fill();
    ctx.fillStyle = "#d2b27a";
    ctx.beginPath();
    ctx.roundRect(230, 365, 215, 485, [108, 108, 0, 0]);
    ctx.fill();
    ctx.fillStyle = "#758272";
    ctx.beginPath();
    ctx.ellipse(650, 695, 185, 145, -0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#e8e2d5";
    ctx.lineWidth = 3;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.ellipse(650, 695, 55 + i * 20, 120, -0.15, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
  shapes.x = 350;
  shapes.y = 170;
  const title = await add("Edition notes", 1450, 115, (ctx) => {
    ctx.fillStyle = "#3a413a";
    ctx.font = "24px sans-serif";
    ctx.fillText("F O R M   /   S T U D Y   0 1", 0, 30);
    ctx.font = "18px sans-serif";
    ctx.fillText("An exploration of shape, color, and quiet balance.", 0, 68);
    ctx.textAlign = "right";
    ctx.fillText("LUMA STUDIO", 1450, 30);
    ctx.fillText("1600 × 1200", 1450, 68);
  });
  title.x = 75;
  title.y = 1050;
  doc.children = [paper, shapes, title];
  return { document: doc, assets, selectedId: shapes.id };
}
