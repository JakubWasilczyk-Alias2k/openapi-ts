import type { OpenAPIV2 } from '@hey-api/spec-types';

import type { Context } from '../../../ir/context';
import { getPaginationKeywordsRegExp } from '../../../ir/pagination';
import type { SchemaType } from '../../../openApi/shared/types/schema';
import { getSchemaType } from './schema';

const isPaginationType = (schemaType: SchemaType<OpenAPIV2.SchemaObject> | undefined): boolean =>
  schemaType === 'boolean' ||
  schemaType === 'integer' ||
  schemaType === 'number' ||
  schemaType === 'string';

// We handle only simple values for now, up to 1 nested field
export const paginationField = ({
  context,
  name,
  schema,
}: {
  context: Context;
  name: string;
  schema:
    | OpenAPIV2.ParameterObject
    | OpenAPIV2.SchemaObject
    | OpenAPIV2.ReferenceObject
    | {
        in: undefined;
      };
}): boolean | string => {
  const paginationRegExp = getPaginationKeywordsRegExp(context.config.parser.pagination);
  if (paginationRegExp.test(name)) {
    return true;
  }

  if ('$ref' in schema) {
    const ref = context.resolveRef<OpenAPIV2.ParameterObject | OpenAPIV2.SchemaObject>(
      schema.$ref ?? '',
    );

    if ('in' in ref && ref.in) {
      const refSchema =
        'schema' in ref
          ? ref.schema
          : {
              ...ref,
              in: undefined,
            };

      return paginationField({
        context,
        name,
        schema: refSchema,
      });
    }

    return paginationField({
      context,
      name,
      schema: ref,
    });
  }

  if ('in' in schema) {
    if (!schema.in) {
      return false;
    }

    const finalSchema =
      'schema' in schema
        ? schema.schema
        : {
            ...schema,
            in: undefined,
          };

    return paginationField({
      context,
      name,
      schema: finalSchema,
    });
  }

  for (const name in schema.properties) {
    const paginationRegExp = getPaginationKeywordsRegExp(context.config.parser.pagination);

    if (paginationRegExp.test(name)) {
      const property = schema.properties[name]!;

      if (typeof property !== 'boolean' && !('$ref' in property)) {
        const schemaType = getSchemaType(property);
        // TODO: resolve deeper references

        if (isPaginationType(schemaType)) {
          return name;
        }
      }
    }
  }

  for (const allOf of schema.allOf ?? []) {
    const pagination = paginationField({
      context,
      name,
      schema: allOf,
    });
    if (pagination) {
      return pagination;
    }
  }

  return false;
};

/**
 * Looks for a scalar pagination field one level down, inside an object
 * property such as `page: { offset, limit }`. Returns a dotted path, e.g.
 * `page.offset`.
 *
 * Only properties whose own name is a pagination keyword are entered. Any
 * object can hold a keyword-named scalar (`filters.start` is a date filter,
 * not a cursor), so the container name is what signals pagination intent.
 */
function nestedPaginationField({
  context,
  schema,
}: {
  context: Context;
  schema: OpenAPIV2.SchemaObject | OpenAPIV2.ReferenceObject;
}): string | false {
  if ('$ref' in schema) {
    return nestedPaginationField({
      context,
      schema: context.resolveRef<OpenAPIV2.SchemaObject>(schema.$ref ?? ''),
    });
  }

  const paginationRegExp = getPaginationKeywordsRegExp(context.config.parser.pagination);

  for (const name in schema.properties) {
    const property = schema.properties[name]!;

    if (typeof property === 'boolean' || !paginationRegExp.test(name)) {
      continue;
    }

    const field = paginationField({
      context,
      name: '',
      schema: property,
    });
    if (typeof field === 'string') {
      return `${name}.${field}`;
    }
  }

  for (const allOf of schema.allOf ?? []) {
    const field = nestedPaginationField({
      context,
      schema: allOf,
    });
    if (field) {
      return field;
    }
  }

  return false;
}

/**
 * Detects the pagination field of a request body. Top-level fields win, and
 * only when none is found do we look one level down (see
 * `nestedPaginationField`), so bodies detected before keep their result.
 */
export function requestBodyPaginationField({
  context,
  schema,
}: {
  context: Context;
  schema: OpenAPIV2.SchemaObject | OpenAPIV2.ReferenceObject;
}): boolean | string {
  return (
    paginationField({
      context,
      name: '',
      schema,
    }) || nestedPaginationField({ context, schema })
  );
}
