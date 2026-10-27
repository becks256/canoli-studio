import{z}from'zod';
export const recipeDeliverySchema=z.object({version:z.literal(1),name:z.string().min(1).max(120),sha256:z.string().regex(/^[a-f0-9]{64}$/),byteLength:z.number().int().positive().safe()}).strict();
export type RecipeDelivery=z.infer<typeof recipeDeliverySchema>;
