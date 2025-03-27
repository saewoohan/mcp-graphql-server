#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosError } from "axios";
import {
    buildClientSchema,
    getIntrospectionQuery as graphqlGetIntrospectionQuery,
    parse,
    visit,
    printSchema,
} from "graphql";
import type { IntrospectionQuery } from "graphql";

// =========================================
// Constants
// =========================================
const DEFAULT_GRAPHQL_ENDPOINT =
    process.env.ENDPOINT ?? "http://localhost:4000/graphql";
const USER_AGENT = process.env.USER_AGENT ?? "graphql-mcp-server/1.2.0";
const MAX_QUERY_COMPLEXITY = Number(process.env.MAX_DEPTH) || 100;
const DEFAULT_TIMEOUT = process.env.TIMEOUT ?? 30000;

// =========================================
// Tool Definitions
// =========================================
const GRAPHQL_QUERY_TOOL: Tool = {
    name: "graphql_query",
    description: "Execute GraphQL queries against a specified endpoint (de",
    inputSchema: {
        type: "object",
        properties: {
            endpoint: {
                type: "string",
                description:
                    "GraphQL endpoint URL (can be omitted to use default)",
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
                    "Additional headers to include in the request (for authentication, etc.)",
            },
            timeout: {
                type: "number",
                description: "Request timeout in milliseconds",
            },
            allowMutations: {
                type: "boolean",
                description: "Whether to allow mutation operations",
            },
        },
        required: ["query"],
    },
};

const GRAPHQL_INTROSPECT_TOOL: Tool = {
    name: "graphql_introspect",
    description: "Introspect a GraphQL schema from an endpoint",
    inputSchema: {
        type: "object",
        properties: {
            endpoint: {
                type: "string",
                description:
                    "GraphQL endpoint URL (can be omitted to use default)",
            },
            headers: {
                type: "object",
                description: "Additional headers to include in the request",
            },
            includeDeprecated: {
                type: "boolean",
                description: "Whether to include deprecated fields",
            },
        },
    },
};

const GRAPHQL_TOOLS = [GRAPHQL_QUERY_TOOL, GRAPHQL_INTROSPECT_TOOL] as const;

// =========================================
// Utility Functions
// =========================================
function sanitizeErrorMessage(error: unknown): string {
    if (error instanceof AxiosError) {
        if (error.response) {
            return `Server responded with status ${error.response.status}: ${error.message}`;
        }
        if (error.request) {
            return `No response received: ${error.message}`;
        }
    }
    return error instanceof Error ? error.message : String(error);
}

function formatGraphQLQuery(query: string): string {
    return query.replace(/\s+/g, " ").trim();
}

function isMutation(query: string): boolean {
    try {
        const document = parse(query);
        for (const definition of document.definitions) {
            if (
                definition.kind === "OperationDefinition" &&
                definition.operation === "mutation"
            ) {
                return true;
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

function calculateQueryComplexity(query: string): number {
    try {
        const document = parse(query);
        let complexity = 0;

        visit(document, {
            Field(node) {
                complexity += 1;
            },
        });

        return complexity;
    } catch (e) {
        return MAX_QUERY_COMPLEXITY + 1;
    }
}

// =========================================
// GraphQL Operations
// =========================================
async function executeGraphQLQuery({
    endpoint = DEFAULT_GRAPHQL_ENDPOINT,
    query,
    variables,
    headers = {},
    timeout = DEFAULT_TIMEOUT,
}: {
    endpoint?: string;
    query: string;
    variables?: Record<string, any> | string;
    headers?: Record<string, string>;
    timeout?: number;
}) {
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
                "User-Agent": USER_AGENT,
                ...headers,
            },
            timeout,
        },
    );

    return response;
}

async function fetchGraphQLSchema({
    endpoint = DEFAULT_GRAPHQL_ENDPOINT,
    headers = {},
    includeDeprecated = true,
    timeout = DEFAULT_TIMEOUT,
}: {
    endpoint?: string;
    headers?: Record<string, string>;
    includeDeprecated?: boolean;
    timeout?: number;
}) {
    const response = await axios.post(
        endpoint,
        {
            query: graphqlGetIntrospectionQuery({
                descriptions: true,
                inputValueDeprecation: includeDeprecated,
            }),
        },
        {
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "User-Agent": USER_AGENT,
                ...headers,
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
}

// =========================================
// Handler Functions
// =========================================
async function handleGraphQLQuery(
    query: string,
    variables?: Record<string, any> | string,
    endpoint: string = DEFAULT_GRAPHQL_ENDPOINT,
    headers: Record<string, string> = {},
    timeout: number = DEFAULT_TIMEOUT,
    allowMutations: boolean = false,
) {
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
                .map((e: any) => e.message)
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

        return {
            content: [
                {
                    type: "text",
                    text: `Query executed successfully in ${executionTime}ms at ${endpoint}`,
                },
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
}

async function handleGraphQLIntrospect(
    endpoint: string = DEFAULT_GRAPHQL_ENDPOINT,
    headers: Record<string, string> = {},
    includeDeprecated: boolean = true,
) {
    try {
        // Fetch schema
        const { schema } = await fetchGraphQLSchema({
            endpoint,
            headers,
            includeDeprecated,
        });

        const schemaString = printSchema(schema);

        return {
            content: [
                {
                    type: "text",
                    text: `Schema introspection from ${endpoint} completed successfully`,
                },
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
}

// =========================================
// Server Setup
// =========================================
const server = new Server(
    {
        name: "graphql-mcp-server",
        version: "0.1.0",
    },
    {
        capabilities: {
            tools: {},
        },
    },
);

// Set up request handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: GRAPHQL_TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        switch (request.params.name) {
            case "graphql_query": {
                const {
                    query,
                    variables,
                    endpoint,
                    headers,
                    timeout,
                    allowMutations,
                } = request.params.arguments as {
                    query: string;
                    variables?: Record<string, any> | string;
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

// =========================================
// Server Start
// =========================================
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
