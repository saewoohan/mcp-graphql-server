#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { parse, printSchema } from "graphql";

import { config } from "./config.js";
import {
  calculateQueryComplexity,
  executeGraphQLQuery,
  fetchGraphQLSchema,
  formatGraphQLQuery,
  isMutation,
  sanitizeErrorMessage,
} from "./utils.js";

const DEFAULT_GRAPHQL_ENDPOINT = config.endpoint;
const MAX_QUERY_COMPLEXITY = config.maxQueryComplexity;
const DEFAULT_TIMEOUT = config.timeout;
const DEFAULT_HEADERS = config.headers;

const GRAPHQL_QUERY_TOOL: Tool = {
  name: "graphql_query",
  description:
    "Execute GraphQL queries using either a specified endpoint or the default endpoint configured during installation",
  inputSchema: {
    type: "object",
    properties: {
      endpoint: {
        type: "string",
        description: "GraphQL endpoint URL (can be omitted to use default)",
      },
      query: {
        type: "string",
        description: "GraphQL query to execute",
      },
      variables: {
        type: "object",
        description: "Variables to use with the query (JSON object)",
      },
      headers: {
        type: "object",
        description:
          "Additional headers to include in the request (will be merged with default headers)",
      },
      timeout: {
        type: "number",
        description: "Request timeout in milliseconds",
      },
    },
    required: ["query"],
  },
};

const GRAPHQL_INTROSPECT_TOOL: Tool = {
  name: "graphql_introspect",
  description:
    "Introspect a GraphQL schema from an endpoint with configurable headers",
  inputSchema: {
    type: "object",
    properties: {
      endpoint: {
        type: "string",
        description: "GraphQL endpoint URL (can be omitted to use default)",
      },
      headers: {
        type: "object",
        description:
          "Additional headers to include in the request (will be merged with default headers)",
      },
      includeDeprecated: {
        type: "boolean",
        description: "Whether to include deprecated fields",
      },
    },
  },
};

const GRAPHQL_TOOLS = [GRAPHQL_QUERY_TOOL, GRAPHQL_INTROSPECT_TOOL] as const;

const handleGraphQLQuery = async (
  query: string,
  variables?: Record<string, unknown> | string,
  endpoint: string = DEFAULT_GRAPHQL_ENDPOINT,
  headers: Record<string, string> = {},
  timeout = DEFAULT_TIMEOUT,
  allowMutations = false,
) => {
  try {
    // Validate query syntax
    parse(query);

    // Check for mutations if they're not allowed
    if (!allowMutations && isMutation(query)) {
      return {
        content: [
          {
            type: "text",
            text: "Mutation operations are not allowed unless explicitly enabled with allowMutations=true",
          },
        ],
        isError: true,
      };
    }

    // Calculate query complexity
    const queryComplexity = calculateQueryComplexity(query);
    if (queryComplexity > MAX_QUERY_COMPLEXITY) {
      return {
        content: [
          {
            type: "text",
            text: `Query complexity (${queryComplexity}) exceeds maximum allowed (${MAX_QUERY_COMPLEXITY})`,
          },
        ],
        isError: true,
      };
    }

    // Process variables
    let processedVariables = variables;
    if (typeof variables === "string") {
      try {
        processedVariables = JSON.parse(variables);
      } catch (parseError) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to parse variables as JSON: ${(parseError as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // Execute query
    const startTime = Date.now();
    const response = await executeGraphQLQuery({
      endpoint,
      query,
      variables: processedVariables,
      headers,
      timeout,
    });
    const executionTime = Date.now() - startTime;

    // Check for GraphQL errors
    if (response.data.errors) {
      const errorMessages = response.data.errors
        .map((e: unknown) => (e as { message: string }).message)
        .join(", ");

      return {
        content: [
          {
            type: "text",
            text: `GraphQL server returned errors: ${errorMessages}`,
          },
        ],
        isError: true,
      };
    }

    // Return successful response
    const formattedQuery = formatGraphQLQuery(query);
    const formattedData = JSON.stringify(response.data.data, null, 2);
    const hasDefaultHeaders = Object.keys(DEFAULT_HEADERS).length > 0;

    return {
      content: [
        {
          type: "text",
          text: `Query executed successfully in ${executionTime}ms at ${endpoint}`,
        },
        ...(hasDefaultHeaders
          ? [
              {
                type: "text",
                text: `Using default headers: ${JSON.stringify(DEFAULT_HEADERS, null, 2)}`,
              },
            ]
          : []),
        {
          type: "text",
          text: `\nQuery:\n\`\`\`graphql\n${formattedQuery}\n\`\`\``,
        },
        {
          type: "text",
          text: `\nResult:\n\`\`\`json\n${formattedData}\n\`\`\``,
        },
      ],
    };
  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error);

    return {
      content: [
        {
          type: "text",
          text: `Error executing GraphQL query: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
};

const handleGraphQLIntrospect = async (
  endpoint: string = DEFAULT_GRAPHQL_ENDPOINT,
  headers: Record<string, string> = {},
  includeDeprecated = true,
) => {
  try {
    // Fetch schema
    const { schema } = await fetchGraphQLSchema({
      endpoint,
      headers,
      includeDeprecated,
    });

    const schemaString = printSchema(schema);
    const hasDefaultHeaders = Object.keys(DEFAULT_HEADERS).length > 0;

    return {
      content: [
        {
          type: "text",
          text: `Schema introspection from ${endpoint} completed successfully`,
        },
        ...(hasDefaultHeaders
          ? [
              {
                type: "text",
                text: `Using default headers: ${JSON.stringify(DEFAULT_HEADERS, null, 2)}`,
              },
            ]
          : []),
        {
          type: "text",
          text: `\nGraphQL Schema:\n\`\`\`graphql\n${schemaString}\n\`\`\``,
        },
      ],
    };
  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error);

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error introspecting GraphQL schema: ${errorMessage}`,
        },
      ],
    };
  }
};

const server = new Server(
  {
    name: "graphql-mcp-server",
    version: config.version,
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: GRAPHQL_TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "graphql_query": {
        const { query, variables, endpoint, headers, timeout, allowMutations } =
          request.params.arguments as {
            query: string;
            variables?: Record<string, unknown> | string;
            endpoint?: string;
            headers?: Record<string, string>;
            timeout?: number;
            allowMutations?: boolean;
          };

        return await handleGraphQLQuery(
          query,
          variables,
          endpoint,
          headers,
          timeout,
          allowMutations,
        );
      }

      case "graphql_introspect": {
        const { endpoint, headers, includeDeprecated } = request.params
          .arguments as {
          endpoint?: string;
          headers?: Record<string, string>;
          includeDeprecated?: boolean;
        };

        return await handleGraphQLIntrospect(
          endpoint,
          headers,
          includeDeprecated,
        );
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${request.params.name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function runServer() {
  try {
    console.error("Starting GraphQL MCP server...");
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("GraphQL MCP server ready");
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
