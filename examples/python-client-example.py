#!/usr/bin/env python3
import asyncio
import os
from typing import Optional
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    # Create server parameters for stdio connection
    server_params = StdioServerParameters(
        command="node",
        args=["../dist/index.js"],
        env=None
    )

    # Connect to the server
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # Initialize the connection
            await session.initialize()
            print("Connected to Calypso MCP server")

            # List available tools
            tools = await session.list_tools()
            print("Available tools:")
            for tool in tools.tools:
                print(f"- {tool.name}: {tool.description}")

            # Example: Query the Calypso RAG agent directly
            print("\nQuerying calypso-rag-agent...")
            market_result = await session.call_tool(
                "calypso-rag-agent",
                arguments={
                    "prompt": "Summarize the current knowledge base guidance for campaign approval behavior."
                }
            )
            print("Result:")
            print(market_result.content[0].text)

            # Example: Follow-up request in the same conversation
            print("\nQuerying calypso-rag-agent again...")
            research_result = await session.call_tool(
                "calypso-rag-agent",
                arguments={
                    "prompt": "Now focus only on the retrieval path and list the main components involved."
                }
            )
            print("Follow-up result:")
            print(research_result.content[0].text)

if __name__ == "__main__":
    asyncio.run(main()) 