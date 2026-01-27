import { type R2Client, uploadJson } from "@utils/r2";
import type Article from './article';
import { appConfig } from "../config";

export type ArticleAssetStorage = {
  client: R2Client;
  bucket: string;
  prefix?: string;
};

const DEFAULT_ASSET_PREFIX = "articles";

type ArticleAsset = Pick<Article, "key_points" | "summary" | "soft_language_summary" | "middle_summary" | "dialogs">;

export async function persistArticleAsset(
  storageConfig: ArticleAssetStorage,
  articleId: string,
  asset: ArticleAsset
): Promise<{ key: string; url: string }> {
  if (!storageConfig?.client || !storageConfig.bucket) {
    throw new Error("Article asset storage configuration is required");
  }
  const trimmedPrefix = trimSlashes(storageConfig.prefix ?? DEFAULT_ASSET_PREFIX);
  const basePrefix = trimmedPrefix ? `${trimmedPrefix}/${articleId}` : articleId;
  const key = `${basePrefix}/asset.json`;
  
  await uploadJson({
    client: storageConfig.client,
    bucket: storageConfig.bucket,
    key,
    data: asset,
  });

  return { key, url: buildAssetUrl(storageConfig.bucket, key) };
}

function trimSlashes(input: string): string {
  return input.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function buildAssetUrl(bucket: string, key: string): string {
    const publicBase = appConfig.r2.publicUrlBase;
    // R2 public URL: https://asset.politopics.net/{key}
    return `${publicBase.replace(/\/+$/, "")}/${key}`;
}