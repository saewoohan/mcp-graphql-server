[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/saewoohan-mcp-graphql-tools-badge.png)](https://mseep.ai/app/saewoohan-mcp-graphql-tools)

# GraphQL MCP Tools

A Model Context Protocol (MCP) server implementation that provides GraphQL API interaction capabilities. This server enables AI assistants to interact with GraphQL APIs through a set of standardized tools.

## Components

### Tools

- **graphql_query**
  - Execute GraphQL queries against any endpoint
  - Input:
    - `query` (string): The GraphQL query to execute
    - `variables` (object, optional): Variables for the query
    - `endpoint` (string, optional): GraphQL endpoint URL
    - `headers` (object, optional): HTTP headers for the request
    - `timeout` (number, optional): Request timeout in milliseconds
    - `allowMutations` (boolean, optional): Whether to allow mutation operations

- **graphql_introspect**
  - Retrieve and explore GraphQL schema information
  - Input:
    - `endpoint` (string, optional): GraphQL endpoint URL
    - `headers` (object, optional): HTTP headers for the request
    - `includeDeprecated` (boolean, optional): Whether to include deprecated types/fields

## Usage with Claude Desktop

### NPX

```json
{
  "mcpServers": {
    "graphql": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-graphql-tools",
        "--endpoint=https://api.github.com/graphql",
        "--headers={\"Authorization\":\"Bearer YOUR_GITHUB_TOKEN\"}",
        "--timeout=30000",
        "--maxComplexity=100"
      ]
    }
  }
}
```

## Configuration Options
The server accepts the following command-line arguments:

- --endpoint (-e): Default GraphQL endpoint URL (default: http://localhost:4000/graphql)
- --headers (-H): Default headers for all requests as JSON string
- --timeout (-t): Default request timeout in milliseconds (default: 30000)
- --maxComplexity (-m): Maximum allowed query complexity (default: 100)

## License
This MCP server is licensed under the MIT License. This means you are free to use, modify, and distribute the software, subject to the terms and conditions of the MIT License. For more details, please see the LICENSE file in the project repository.
