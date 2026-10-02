import { z } from "zod";

export const authoredMetadataSchema = z
  .object({
    title: z.string().max(240),
    description: z.string().max(4096),
    altText: z.string().max(2048),
    creator: z.string().max(240),
    copyright: z.string().max(1024),
    license: z.string().max(1024),
    keywords: z.array(z.string().min(1).max(80)).max(64),
  })
  .strict();
export type AuthoredMetadataData = z.infer<typeof authoredMetadataSchema>;
export function emptyMetadata(): AuthoredMetadataData {
  return {
    title: "",
    description: "",
    altText: "",
    creator: "",
    copyright: "",
    license: "",
    keywords: [],
  };
}
