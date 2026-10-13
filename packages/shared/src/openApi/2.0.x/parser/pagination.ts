import type { OpenAPIV2 } from '@hey-api/spec-types';

import type { Context } from '../../../ir/context';
import { getPaginationKeywordsRegExp, getPaginationPaths } from '../../../ir/pagination';
import type { SchemaType } from '../../../openApi/shared/types/schema';
import { getSchemaType } from './schema';

function isPaginationType(schemaType: SchemaType<OpenAPIV2.SchemaObject> | undefined): boolean {
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
  schema:
    | OpenAPIV2.ParameterObject
    | OpenAPIV2.SchemaObject
    | OpenAPIV2.ReferenceObject
    | {
        in: undefined;
      };
}): boolean | string {
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
}

function resolvePaginationSchema({
  context,
  schema,
}: {
  context: Context;
  schema: OpenAPIV2.SchemaObject | OpenAPIV2.ReferenceObject;
}): OpenAPIV2.SchemaObject {
  if ('$ref' in schema) {
    return resolvePaginationSchema({
      context,
      schema: context.resolveRef<OpenAPIV2.SchemaObject>(schema.$ref ?? ''),
    });
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
  schema: OpenAPIV2.SchemaObject | OpenAPIV2.ReferenceObject;
}): boolean {
  const resolved = resolvePaginationSchema({ context, schema });

  const [name, ...rest] = path;
  const property = resolved.properties?.[name!];
  if (property !== undefined) {
    if (rest.length) {
      return hasPaginationPath({ context, path: rest, schema: property });
    }

    return isPaginationType(getSchemaType(resolvePaginationSchema({ context, schema: property })));
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
  schema: OpenAPIV2.SchemaObject | OpenAPIV2.ReferenceObject;
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
