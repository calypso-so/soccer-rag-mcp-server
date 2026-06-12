import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  try {
    // Create a client
    const client = new Client({
      name: "calypso-client-example",
      version: "1.0.0",
    });

    // Connect to the server
    const transport = new StdioClientTransport({
      command: "node",
      args: ["../dist/index.js"],
    });
    await client.connect(transport);

    console.log("Connected to Calypso MCP server");

    // List available tools
    const toolsResult = await client.listTools();
    console.log("Available tools:");
    for (const tool of toolsResult.tools) {
      console.log(`- ${tool.name}: ${tool.description}`);
    }

    // Example: Query the Calypso RAG agent directly
    console.log("\nQuerying calypso-rag-agent...");
    const routedResult = await client.callTool({
      name: "calypso-rag-agent",
      arguments: {
        prompt: "Summarize the current knowledge base guidance for campaign approval behavior.",
      },
    });

    console.log("Result:");
    console.log((routedResult as any).content[0].text);

    // Example: Follow-up request in the same conversation
    console.log("\nQuerying calypso-rag-agent again...");
    const followupResult = await client.callTool({
      name: "calypso-rag-agent",
      arguments: {
        prompt: "Now focus only on the retrieval path and list the main components involved.",
      },
    });

    console.log("Follow-up result:");
    console.log((followupResult as any).content[0].text);

    // Close the client
    await client.close();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main(); 