import type { OpenAPIV2 } from '@hey-api/spec-types';

import { defaultPaginationKeywords } from '../../../../config/parser/config';
import type { Context } from '../../../../ir/context';
import { requestBodyPaginationField } from '../pagination';

describe('requestBodyPaginationField', () => {
  const schemas: Record<string, OpenAPIV2.SchemaObject> = {
    Extra: {
      properties: {
        extra: { $ref: '#/definitions/Pagination' },
      },
      type: 'object',
    },
    Filters: {
      properties: {
        start: { format: 'date-time', type: 'string' },
      },
      type: 'object',
    },
    Offset: {
      type: 'integer',
    },
    Pagination: {
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
      },
      type: 'object',
    },
  };

  const createContext = (keywords: ReadonlyArray<string>) =>
    ({
      config: {
        parser: {
          pagination: {
            keywords,
          },
        },
      },
      resolveRef: (ref: string) => schemas[ref.split('/').pop()!],
    }) as unknown as Context;

  const nested: OpenAPIV2.SchemaObject = {
    properties: {
      filters: { $ref: '#/definitions/Filters' },
      page: { $ref: '#/definitions/Pagination' },
    },
    type: 'object',
  };

  const scenarios: ReadonlyArray<{
    description: string;
    keywords: ReadonlyArray<string>;
    result: boolean | string;
    schema: OpenAPIV2.ReferenceObject | OpenAPIV2.SchemaObject;
  }> = [
    {
      description: 'top-level field',
      keywords: defaultPaginationKeywords,
      result: 'offset',
      schema: { $ref: '#/definitions/Pagination' },
    },
    {
      description: 'top-level field in allOf',
      keywords: defaultPaginationKeywords,
      result: 'offset',
      schema: {
        allOf: [
          { $ref: '#/definitions/Pagination' },
          { properties: { filters: { $ref: '#/definitions/Filters' } }, type: 'object' },
        ],
      },
    },
    {
      description: 'nested field without a dotted keyword',
      keywords: defaultPaginationKeywords,
      result: false,
      schema: nested,
    },
    {
      description: 'nested field with a dotted keyword',
      keywords: [...defaultPaginationKeywords, 'page.offset'],
      result: 'page.offset',
      schema: nested,
    },
    {
      description: 'field two levels deep',
      keywords: [...defaultPaginationKeywords, 'page.offset', 'page.extra.offset'],
      result: 'page.extra.offset',
      schema: {
        properties: {
          page: { $ref: '#/definitions/Extra' },
        },
        type: 'object',
      },
    },
    {
      description: 'nested field in a scalar reference',
      keywords: ['page.offset'],
      result: 'page.offset',
      schema: {
        properties: {
          page: {
            properties: {
              offset: { $ref: '#/definitions/Offset' },
            },
            type: 'object',
          },
        },
        type: 'object',
      },
    },
    {
      description: 'nested field in allOf at an intermediate level',
      keywords: ['page.offset'],
      result: 'page.offset',
      schema: {
        properties: {
          page: {
            allOf: [
              { properties: { limit: { type: 'integer' } }, type: 'object' },
              { properties: { offset: { type: 'integer' } }, type: 'object' },
            ],
          },
        },
        type: 'object',
      },
    },
    {
      description: 'nested field in a nullable container',
      keywords: ['page.offset'],
      result: 'page.offset',
      schema: {
        properties: {
          page: {
            allOf: [{ $ref: '#/definitions/Pagination' }],
            'x-nullable': true,
          },
        },
        type: 'object',
      },
    },
    {
      description: 'nested field that is not a scalar',
      keywords: ['page.offset'],
      result: false,
      schema: {
        properties: {
          page: {
            properties: { offset: { $ref: '#/definitions/Pagination' } },
            type: 'object',
          },
        },
        type: 'object',
      },
    },
    {
      description: 'nested field inside an array',
      keywords: ['page.offset'],
      result: false,
      schema: {
        properties: {
          page: { items: { $ref: '#/definitions/Pagination' }, type: 'array' },
        },
        type: 'object',
      },
    },
    {
      description: 'missing path',
      keywords: ['page.cursor', 'paging.offset'],
      result: false,
      schema: nested,
    },
    {
      description: 'dotted keyword against a property named like it',
      keywords: ['page.offset'],
      result: false,
      schema: {
        properties: {
          'page.offset': { type: 'integer' },
          pageXoffset: { type: 'integer' },
        },
        type: 'object',
      },
    },
    {
      description: 'top-level field wins over a dotted path',
      keywords: [...defaultPaginationKeywords, 'page.offset'],
      result: 'cursor',
      schema: {
        properties: {
          cursor: { type: 'string' },
          page: { $ref: '#/definitions/Pagination' },
        },
        type: 'object',
      },
    },
    {
      description: 'first matching dotted keyword wins',
      keywords: ['page.limit', 'page.offset'],
      result: 'page.limit',
      schema: nested,
    },
  ];

  it.each(scenarios)('$description → $result', ({ keywords, result, schema }) => {
    expect(requestBodyPaginationField({ context: createContext(keywords), schema })).toEqual(
      result,
    );
  });
});
