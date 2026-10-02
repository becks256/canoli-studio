import { z } from "zod";
import { AffineTransform } from "./affine";

const coefficient = z.number().finite();
export const affineSchema = z
  .object({
    a: coefficient,
    b: coefficient,
    c: coefficient,
    d: coefficient,
    e: coefficient,
    f: coefficient,
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      AffineTransform.fromJSON(value).inverse();
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Transform must have a finite, invertible matrix.",
      });
    }
  });
