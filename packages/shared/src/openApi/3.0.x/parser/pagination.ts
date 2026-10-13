import type { OpenAPIV3 } from '@hey-api/spec-types';

import type { Context } from '../../../ir/context';
import { getPaginationKeywordsRegExp, getPaginationPaths } from '../../../ir/pagination';
import type { SchemaType } from '../../../openApi/shared/types/schema';
import { mediaTypeObjects } from './mediaType';
import { getSchemaType } from './schema';

function isPaginationType(schemaType: SchemaType<OpenAPIV3.SchemaObject> | undefined): boolean {
  return (
    schemaType === 'boolean' ||
    schemaType === 'integer' ||
    schemaType === 'number' ||
    schemaType === 'string'
  );
}

// We handle only simple values for now, up to 1 nested field
export function paginationField({
  context,
  name,
  schema,
}: {
  context: Context;
  name: string;
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
}): boolean | string {
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
}

/**
 * Resolves references, request bodies included, and enters the single
 * member of a nullable union.
 */
function resolvePaginationSchema({
  context,
  schema,
}: {
  context: Context;
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
}): OpenAPIV3.SchemaObject | undefined {
  if ('$ref' in schema) {
    const ref = context.resolveRef<OpenAPIV3.RequestBodyObject | OpenAPIV3.SchemaObject>(
      schema.$ref,
    );

    if ('content' in ref) {
      const contents = mediaTypeObjects({ content: ref.content });
      // TODO: add support for multiple content types, for now prefer JSON
      const content = contents.find((content) => content.type === 'json') || contents[0];
      return content?.schema
        ? resolvePaginationSchema({ context, schema: content.schema })
        : undefined;
    }

    return resolvePaginationSchema({ context, schema: ref });
  }

  const compositionSchemas = schema.anyOf ?? schema.oneOf ?? [];
  if (compositionSchemas.length === 1) {
    return resolvePaginationSchema({ context, schema: compositionSchemas[0]! });
  }

  return schema;
}

/**
 * Checks that `path` leads to a scalar pagination field. Every member of an
 * `allOf` is searched, arrays are not entered.
 */
function hasPaginationPath({
  context,
  path,
  schema,
}: {
  context: Context;
  path: ReadonlyArray<string>;
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
}): boolean {
  const resolved = resolvePaginationSchema({ context, schema });
  if (!resolved) {
    return false;
  }

  const [name, ...rest] = path;
  const property = resolved.properties?.[name!];
  if (property !== undefined) {
    if (rest.length) {
      return hasPaginationPath({ context, path: rest, schema: property });
    }

    const field = resolvePaginationSchema({ context, schema: property });
    return field !== undefined && isPaginationType(getSchemaType(field));
  }

  return (resolved.allOf ?? []).some((allOf) =>
    hasPaginationPath({ context, path, schema: allOf }),
  );
}

/**
 * Detects the pagination field of a request body. A top-level field matched
 * by name wins. Otherwise, keywords containing a dot (e.g. `page.offset`)
 * are tried as paths into the body, in config order.
 */
export function requestBodyPaginationField({
  context,
  schema,
}: {
  context: Context;
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject;
}): boolean | string {
  const pagination = paginationField({
    context,
    name: '',
    schema,
  });
  if (pagination) {
    return pagination;
  }

  for (const path of getPaginationPaths(context.config.parser.pagination)) {
    if (hasPaginationPath({ context, path, schema })) {
      return path.join('.');
    }
  }

  return false;
}
