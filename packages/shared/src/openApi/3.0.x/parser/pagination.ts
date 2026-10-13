import type { OpenAPIV3 } from '@hey-api/spec-types';

import type { Context } from '../../../ir/context';
import { getPaginationKeywordsRegExp } from '../../../ir/pagination';
import type { SchemaType } from '../../../openApi/shared/types/schema';
import { mediaTypeObjects } from './mediaType';
import { getSchemaType } from './schema';

const isPaginationType = (schemaType: SchemaType<OpenAPIV3.SchemaObject> | undefined): boolean =>
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
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
}): boolean | string => {
  const paginationRegExp = getPaginationKeywordsRegExp(context.config.parser.pagination);
  if (paginationRegExp.test(name)) {
    return true;
  }

  if ('$ref' in schema) {
    const ref = context.resolveRef<
      OpenAPIV3.ParameterObject | OpenAPIV3.RequestBodyObject | OpenAPIV3.SchemaObject
    >(schema.$ref);

    if ('content' in ref || 'in' in ref) {
      let refSchema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined;

      if ('in' in ref) {
        refSchema = ref.schema;
      }

      if (!refSchema) {
        // parameter or body
        const contents = mediaTypeObjects({ content: ref.content });
        // TODO: add support for multiple content types, for now prefer JSON
        const content = contents.find((content) => content.type === 'json') || contents[0];
        if (content?.schema) {
          refSchema = content.schema;
        }
      }

      if (!refSchema) {
        return false;
      }

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

function nonNullableSchema(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
): OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject {
  if ('$ref' in schema) {
    return schema;
  }
  const compositionSchemas = schema.anyOf ?? schema.oneOf ?? [];
  return compositionSchemas.length === 1 ? compositionSchemas[0]! : schema;
}

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
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
}): string | false {
  if ('$ref' in schema) {
    return nestedPaginationField({
      context,
      schema: context.resolveRef<OpenAPIV3.SchemaObject>(schema.$ref),
    });
  }

  const paginationRegExp = getPaginationKeywordsRegExp(context.config.parser.pagination);

  for (const name in schema.properties) {
    if (!paginationRegExp.test(name)) {
      continue;
    }

    const field = paginationField({
      context,
      name: '',
      schema: nonNullableSchema(schema.properties[name]!),
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
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
}): boolean | string {
  return (
    paginationField({
      context,
      name: '',
      schema,
    }) || nestedPaginationField({ context, schema })
  );
}
