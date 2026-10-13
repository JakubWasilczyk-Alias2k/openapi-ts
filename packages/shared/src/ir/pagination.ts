import type { Parser } from '../config/parser/types';
import type { IR } from './types';

function isPaginationPath(keyword: string): boolean {
  return keyword.includes('.');
}

/**
 * Matches names that are pagination keywords. Keywords containing a dot are
 * paths into the request body (see `getPaginationPaths()`) and never match a
 * name.
 */
export function getPaginationKeywordsRegExp(pagination: Parser['pagination']): RegExp {
  const keywords = pagination.keywords.filter((keyword) => !isPaginationPath(keyword));
  if (!keywords.length) {
    // `^()$` would match the empty name used for request bodies
    return /(?!)/;
  }
  const pattern = `^(${keywords.join('|')})$`;
  return new RegExp(pattern);
}

/**
 * Returns the keywords that are paths into the request body, e.g.
 * `page.offset`, split into segments and in config order.
 */
export function getPaginationPaths(
  pagination: Parser['pagination'],
): ReadonlyArray<ReadonlyArray<string>> {
  return pagination.keywords.filter(isPaginationPath).map((keyword) => keyword.split('.'));
}

export interface Pagination {
  in: 'body' | 'cookie' | 'header' | 'path' | 'query';
  name: string;
  schema: IR.SchemaObject;
}
