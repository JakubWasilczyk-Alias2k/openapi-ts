import { defaultPaginationKeywords } from '../../config/parser/config';
import type { Parser } from '../../config/parser/types';
import type { Context } from '../context';
import { operationPagination } from '../operation';
import { getPaginationKeywordsRegExp } from '../pagination';
import type { IR } from '../types';

describe('paginationKeywordsRegExp', () => {
  const defaultScenarios: ReadonlyArray<{
    result: boolean;
    value: string;
  }> = [
    {
      result: true,
      value: 'after',
    },
    {
      result: true,
      value: 'before',
    },
    {
      result: true,
      value: 'cursor',
    },
    {
      result: true,
      value: 'offset',
    },
    {
      result: true,
      value: 'page',
    },
    {
      result: true,
      value: 'start',
    },
    {
      result: false,
      value: 'my_start',
    },
    {
      result: false,
      value: 'start_my',
    },
  ];

  it.each(defaultScenarios)('is $value pagination param? $output', async ({ result, value }) => {
    const paginationRegExp = getPaginationKeywordsRegExp({
      keywords: defaultPaginationKeywords,
    });
    expect(paginationRegExp.test(value)).toEqual(result);
  });

  const customScenarios: ReadonlyArray<{
    result: boolean;
    value: string;
  }> = [
    { result: true, value: 'customPagination' },
    { result: true, value: 'pageSize' },
    { result: true, value: 'perPage' },
    { result: false, value: 'page' },
  ];

  it.each(customScenarios)(
    'with custom config, $value should match? $result',
    async ({ result, value }) => {
      const pagination: Parser['pagination'] = {
        keywords: ['customPagination', 'pageSize', 'perPage'],
      };
      const paginationRegExp = getPaginationKeywordsRegExp(pagination);
      expect(paginationRegExp.test(value)).toEqual(result);
    },
  );
});

describe('operationPagination', () => {
  const queryParam = (
    name: string,
    type: IR.SchemaObject['type'] = 'string',
    pagination = false,
  ): IR.ParameterObject => ({
    explode: true,
    location: 'query',
    name,
    schema: { type },
    style: 'form',
    ...(pagination ? { pagination: true } : {}),
  });

  const emptyContext = {} as Context;

  const baseOperationMeta = {
    method: 'post' as const,
    path: '/test' as const,
  };

  const queryScenarios: ReadonlyArray<{
    hasPagination: boolean;
    operation: IR.OperationObject;
  }> = [
    {
      hasPagination: true,
      operation: {
        ...baseOperationMeta,
        id: 'op1',
        method: 'get',
        parameters: {
          query: {
            page: queryParam('page', 'integer', true),
          },
        },
      },
    },
    {
      hasPagination: false,
      operation: {
        ...baseOperationMeta,
        id: 'op2',
        method: 'get',
        parameters: {
          query: {
            sort: queryParam('sort', 'string'),
          },
        },
      },
    },
    {
      hasPagination: true,
      operation: {
        ...baseOperationMeta,
        id: 'op3',
        method: 'get',
        parameters: {
          query: {
            pagesize: queryParam('pageSize', 'string', true),
          },
        },
      },
    },
  ];

  it.each(queryScenarios)(
    'query params for $operation.id → $hasPagination',
    ({ hasPagination, operation }: (typeof queryScenarios)[number]) => {
      const pagination = operationPagination({
        context: emptyContext,
        operation,
      });
      expect(Boolean(pagination)).toEqual(hasPagination);
      if (pagination && pagination.in !== 'body') {
        const parameter =
          operation.parameters?.[pagination.in]?.[pagination.name.toLocaleLowerCase()];
        if (parameter) {
          expect(pagination.name).toBe(parameter.name);
        }
      }
    },
  );

  it('body.pagination === true returns entire body', () => {
    const operation: IR.OperationObject = {
      ...baseOperationMeta,
      body: {
        mediaType: 'application/json',
        pagination: true,
        schema: {
          properties: {
            page: { type: 'integer' },
          },
          type: 'object',
        },
      },
      id: 'bodyTrue',
    };

    const result = operationPagination({ context: emptyContext, operation });

    expect(result?.in).toEqual('body');
    expect(result?.name).toEqual('body');
    expect(result?.schema?.type).toEqual('object');
  });

  it('body.pagination = "pagination" returns the matching property', () => {
    const operation: IR.OperationObject = {
      ...baseOperationMeta,
      body: {
        mediaType: 'application/json',
        pagination: 'pagination',
        schema: {
          properties: {
            pagination: {
              properties: {
                page: { type: 'integer' },
              },
              type: 'object',
            },
          },
          type: 'object',
        },
      },
      id: 'bodyField',
    };

    const result = operationPagination({ context: emptyContext, operation });

    expect(result?.in).toEqual('body');
    expect(result?.name).toEqual('pagination');
    expect(result?.schema?.type).toEqual('object');
  });

  it('resolves $ref and uses the resolved pagination property', () => {
    const context: Context = {
      resolveIrRef: vi.fn().mockReturnValue({
        properties: {
          pagination: {
            properties: {
              page: { type: 'integer' },
            },
            type: 'object',
          },
        },
        type: 'object',
      }),
    } as unknown as Context;

    const operation: IR.OperationObject = {
      ...baseOperationMeta,
      body: {
        mediaType: 'application/json',
        pagination: 'pagination',
        schema: { $ref: '#/components/schemas/PaginationBody' },
      },
      id: 'refPagination',
    };

    const result = operationPagination({ context, operation });

    expect(context.resolveIrRef).toHaveBeenCalledWith('#/components/schemas/PaginationBody');
    expect(result?.in).toEqual('body');
    expect(result?.name).toEqual('pagination');
    expect(result?.schema?.type).toEqual('object');
  });

  it('finds the pagination property inside an allOf composition', () => {
    const schemas: Record<string, IR.SchemaObject> = {
      '#/components/schemas/List': {
        items: [
          { $ref: '#/components/schemas/Pagination' },
          {
            properties: {
              filters: { type: 'object' },
            },
            type: 'object',
          },
        ],
        logicalOperator: 'and',
      },
      '#/components/schemas/Pagination': {
        properties: {
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
        type: 'object',
      },
    };
    const context = {
      resolveIrRef: (ref: string) => schemas[ref],
    } as unknown as Context;

    const operation: IR.OperationObject = {
      ...baseOperationMeta,
      body: {
        mediaType: 'application/json',
        pagination: 'offset',
        schema: { $ref: '#/components/schemas/List' },
      },
      id: 'allOfPagination',
    };

    const result = operationPagination({ context, operation });

    expect(result).toEqual({
      in: 'body',
      name: 'offset',
      schema: { type: 'integer' },
    });
  });

  it.each([
    {
      description: 'object',
      page: { $ref: '#/components/schemas/Pagination' },
    },
    {
      description: 'nullable object',
      page: {
        items: [{ $ref: '#/components/schemas/Pagination' }, { type: 'null' }],
        logicalOperator: 'or',
      },
    },
  ] satisfies ReadonlyArray<{ description: string; page: IR.SchemaObject }>)(
    'walks a nested pagination path through a $description',
    ({ page }) => {
      const schemas: Record<string, IR.SchemaObject> = {
        '#/components/schemas/List': {
          properties: {
            filters: { type: 'object' },
            page,
          },
          type: 'object',
        },
        '#/components/schemas/Pagination': {
          properties: {
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
          type: 'object',
        },
      };
      const context = {
        resolveIrRef: (ref: string) => schemas[ref],
      } as unknown as Context;

      const operation: IR.OperationObject = {
        ...baseOperationMeta,
        body: {
          mediaType: 'application/json',
          pagination: 'page.offset',
          schema: { $ref: '#/components/schemas/List' },
        },
        id: 'nestedPagination',
      };

      const result = operationPagination({ context, operation });

      expect(result).toEqual({
        in: 'body',
        name: 'page.offset',
        schema: { type: 'integer' },
      });
    },
  );

  it('does not search the members of a union with several non-null schemas', () => {
    const operation: IR.OperationObject = {
      ...baseOperationMeta,
      body: {
        mediaType: 'application/json',
        pagination: 'offset',
        schema: {
          items: [
            {
              properties: {
                offset: { type: 'integer' },
              },
              type: 'object',
            },
            {
              properties: {
                cursor: { type: 'string' },
              },
              type: 'object',
            },
          ],
          logicalOperator: 'or',
        },
      },
      id: 'unionPagination',
    };

    const result = operationPagination({ context: emptyContext, operation });

    expect(result).toBeUndefined();
  });

  it('falls back to query when pagination key not found in body', () => {
    const operation: IR.OperationObject = {
      ...baseOperationMeta,
      body: {
        mediaType: 'application/json',
        pagination: 'pagination',
        schema: {
          properties: {
            notPagination: { type: 'string' },
          },
          type: 'object',
        },
      },
      id: 'fallback',
      parameters: {
        query: {
          cursor: queryParam('cursor', 'string', true),
        },
      },
    };

    const result = operationPagination({ context: emptyContext, operation });

    expect(result?.in).toEqual('query');
    expect(result?.name).toEqual('cursor');
    expect(result?.schema?.type).toEqual('string');
  });
});
