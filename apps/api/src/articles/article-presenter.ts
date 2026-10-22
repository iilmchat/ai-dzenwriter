import type { ArticleDetail, ArticleItem } from '@dzenwriter/shared';
import { countBlockingChecks } from './article-rules';
import type {
  ArticleView,
  LinkedFactRecord,
  PublicationRecord,
  ReviewRecord,
  VersionRecord,
} from './articles.repository';

export function toArticleItem(view: ArticleView, styleName: string): ArticleItem {
  return {
    id: view.id,
    topic: view.topic,
    keywords: [...view.keywords],
    title: view.title,
    styleId: view.styleId,
    styleName,
    format: view.format,
    tone: view.tone,
    lengthMin: view.lengthMin,
    lengthMax: view.lengthMax,
    productId: view.productId,
    status: view.status,
    owner: view.owner,
    reviewer: view.reviewer,
    plannedAt: view.plannedAt?.toISOString() ?? null,
    currentVersionNumber: view.currentVersionNumber,
    version: view.version,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

export function toVersionSummary(record: VersionRecord): ArticleDetail['versions'][number] {
  return {
    number: record.number,
    origin: record.origin,
    advertisingLabel: record.advertisingLabel,
    blockingChecks: countBlockingChecks(record.checks),
    createdAt: record.createdAt.toISOString(),
    createdBy: record.createdBy.login,
  };
}

export function toReviewSummary(record: ReviewRecord): ArticleDetail['reviews'][number] {
  return {
    decision: record.decision,
    comment: record.comment,
    versionNumber: record.versionNumber,
    reviewerLogin: record.reviewer.login,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toPublicationSummary(
  record: PublicationRecord,
): ArticleDetail['publications'][number] {
  return {
    channel: record.channel,
    status: record.status,
    externalUrl: record.externalUrl,
    scheduledAt: record.scheduledAt?.toISOString() ?? null,
    publishedAt: record.publishedAt?.toISOString() ?? null,
  };
}

export function toFactLink(record: LinkedFactRecord): ArticleDetail['facts'][number] {
  return {
    label: record.label,
    type: record.type,
    status: record.status,
    sourceName: record.sourceName,
  };
}
