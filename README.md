# World Cup Soccer RAG MCP

Ask an AI agent grounded questions about international soccer results, no setup ceremony required. This MCP server boots straight into a Calypso-powered World Cup demo corpus, ready for source-backed answers.

Built with [Calypso](https://calypso.so). Learn more in the [Calypso docs](https://docs.calypso.so).

## Kickoff

```bash
npx -y @calypsohq/soccer-rag-mcp-server
```

That is it. No API key, no dashboard setup, no copy-pasting secrets. The server connects to the same World Cup RAG corpus as the [RAG landing demo](https://rag.calypso.so/demos/world-cup-results).

## Try Asking

- Who won the 2022 World Cup final?
- Which teams has Argentina played most often?
- Show me surprising upsets in World Cup history.
- Compare Brazil and Germany across knockout matches.
- What are good starter questions for exploring the corpus?

## What You Get

- Grounded answers from `calypso-rag-agent:worldcup`
- Citation-rich responses through the Calypso Responses API
- Handy resources like `soccer://corpus-info` and `soccer://starter-prompts`
- A read-only demo surface, so agents can explore safely

## Bring Your Own Key

Want to use your own Calypso project with upload and bucket tools enabled?

```bash
CALYPSO_API_KEY=sk-... npx -y @calypsohq/soccer-rag-mcp-server
```

BYOK mode switches from the public World Cup demo into your own Calypso knowledge workspace.

## Development

```bash
npm install
npm test
npm run smoke:stdio
```
