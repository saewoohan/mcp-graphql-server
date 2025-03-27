import axios, { AxiosError } from "axios";
import {
  parse,
  visit,
  Kind,
  OperationTypeNode,
  getIntrospectionQuery,
  buildClientSchema,
} from "graphql";
import type { IntrospectionQuery } from "graphql";
import { config } from "./config.js";

const DEFAULT_GRAPHQL_ENDPOINT = config.endpoint;
const DEFAULT_TIMEOUT = config.timeout;
const DEFAULT_HEADERS = config.headers;
const MAX_QUERY_COMPLEXITY = config.maxQueryComplexity;

export const sanitizeErrorMessage = (error: unknown): string => {
  if (error instanceof AxiosError) {
    if (error.response) {
      return `Server responded with status ${error.response.status}: ${error.message}`;
    }
    if (error.request) {
      return `No response received: ${error.message}`;
    }
  }
  return error instanceof Error ? error.message : String(error);
};

export const formatGraphQLQuery = (query: string): string => {
  return query.replace(/\s+/g, " ").trim();
};

export const isMutation = (query: string): boolean => {
  try {
    const document = parse(query);
    for (const definition of document.definitions) {
      if (
        definition.kind === Kind.OPERATION_DEFINITION &&
        definition.operation === OperationTypeNode.MUTATION
      ) {
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
};

export const calculateQueryComplexity = (query: string): number => {
  try {
    const document = parse(query);
    let complexity = 0;

    visit(document, {
      Field(_) {
        complexity += 1;
      },
    });

    return complexity;
  } catch (e) {
    return MAX_QUERY_COMPLEXITY + 1;
  }
};

export const executeGraphQLQuery = async ({
  endpoint = DEFAULT_GRAPHQL_ENDPOINT,
  query,
  variables,
  headers = {},
  timeout = DEFAULT_TIMEOUT,
}: {
  endpoint?: string;
  query: string;
  variables?: Record<string, unknown> | string;
  headers?: Record<string, string>;
  timeout?: number;
}) => {
  let processedVariables = variables;
  if (typeof variables === "string") {
    processedVariables = JSON.parse(variables);
  }

  const response = await axios.post(
    endpoint,
    {
      query,
      variables: processedVariables,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...DEFAULT_HEADERS, // Apply default headers
        ...headers, // Request-specific headers override defaults
      },
      timeout,
    },
  );

  return response;
};

export const fetchGraphQLSchema = async ({
  endpoint = DEFAULT_GRAPHQL_ENDPOINT,
  headers = {},
  includeDeprecated = true,
  timeout = DEFAULT_TIMEOUT,
}: {
  endpoint?: string;
  headers?: Record<string, string>;
  includeDeprecated?: boolean;
  timeout?: number;
}) => {
  const response = await axios.post(
    endpoint,
    {
      query: getIntrospectionQuery({
        descriptions: true,
        inputValueDeprecation: includeDeprecated,
      }),
    },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...DEFAULT_HEADERS, // Apply default headers
        ...headers, // Request-specific headers override defaults
      },
      timeout,
    },
  );

  if (response.data.errors) {
    throw new Error(
      `GraphQL server returned errors: ${JSON.stringify(response.data.errors)}`,
    );
  }

  const introspectionResult = response.data.data as IntrospectionQuery;
  const schema = buildClientSchema(introspectionResult);

  return { schema, introspectionResult };
};
