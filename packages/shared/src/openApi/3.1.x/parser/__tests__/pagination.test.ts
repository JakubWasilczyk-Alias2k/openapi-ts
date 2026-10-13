import type { OpenAPIV3_1 } from '@hey-api/spec-types';

import { defaultPaginationKeywords } from '../../../../config/parser/config';
import type { Context } from '../../../../ir/context';
import { requestBodyPaginationField } from '../pagination';

describe('requestBodyPaginationField', () => {
  const schemas: Record<string, OpenAPIV3_1.SchemaObject> = {
    Filters: {
      properties: {
        start: { format: 'date-time', type: ['string', 'null'] },
      },
      type: 'object',
    },
    Pagination: {
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
      },
      type: 'object',
    },
    Size: {
      properties: {
        size: { type: 'integer' },
      },
      type: 'object',
    },
  };

  const context = {
    config: {
      parser: {
        pagination: {
          keywords: defaultPaginationKeywords,
        },
      },
    },
    resolveRef: (ref: string) => schemas[ref.split('/').pop()!],
  } as unknown as Context;

  const scenarios: ReadonlyArray<{
    description: string;
    result: boolean | string;
    schema: OpenAPIV3_1.SchemaObject;
  }> = [
    {
      description: 'top-level field',
      result: 'offset',
      schema: { $ref: '#/components/schemas/Pagination' },
    },
    {
      description: 'top-level field in allOf',
      result: 'offset',
      schema: {
        allOf: [
          { $ref: '#/components/schemas/Pagination' },
          { properties: { filters: { $ref: '#/components/schemas/Filters' } }, type: 'object' },
        ],
      },
    },
    {
      description: 'nested field in a keyword-named object',
      result: 'page.offset',
      schema: {
        properties: {
          filters: { $ref: '#/components/schemas/Filters' },
          page: { $ref: '#/components/schemas/Pagination' },
        },
        type: 'object',
      },
    },
    {
      description: 'nested field in a nullable keyword-named object',
      result: 'page.offset',
      schema: {
        properties: {
          page: {
            oneOf: [{ $ref: '#/components/schemas/Pagination' }, { type: 'null' }],
          },
        },
        type: 'object',
      },
    },
    {
      description: 'nested field in a keyword-named object inside allOf',
      result: 'page.offset',
      schema: {
        allOf: [
          {
            properties: {
              page: { $ref: '#/components/schemas/Pagination' },
            },
            type: 'object',
          },
        ],
      },
    },
    {
      description: 'top-level field wins over a nested one',
      result: 'cursor',
      schema: {
        properties: {
          cursor: { type: 'string' },
          page: { $ref: '#/components/schemas/Pagination' },
        },
        type: 'object',
      },
    },
    {
      description: 'keyword scalar in an object that is not keyword-named',
      result: false,
      schema: {
        properties: {
          filters: { $ref: '#/components/schemas/Filters' },
        },
        type: 'object',
      },
    },
    {
      description: 'keyword-named object without a keyword scalar',
      result: false,
      schema: {
        properties: {
          page: { $ref: '#/components/schemas/Size' },
        },
        type: 'object',
      },
    },
    {
      description: 'field nested two levels deep',
      result: false,
      schema: {
        properties: {
          page: {
            properties: {
              page: { $ref: '#/components/schemas/Pagination' },
            },
            type: 'object',
          },
        },
        type: 'object',
      },
    },
  ];

  it.each(scenarios)('$description → $result', ({ result, schema }) => {
    expect(requestBodyPaginationField({ context, schema })).toEqual(result);
  });
});
