# World Cup Soccer RAG MCP

Ask an AI agent grounded questions about international soccer results, no setup ceremony required. This MCP server boots straight into a Calypso-powered World Cup demo corpus: 150 years of match history, ready for source-backed answers.

Built with [Calypso](https://calypso.so). Learn more in the [Calypso docs](https://docs.calypso.so).

## Kickoff

```bash
npx -y @calypsohq/soccer-rag-mcp-server
```

That is it. No API key, no dashboard setup, no copy-pasting secrets. The server connects to the same World Cup RAG corpus as the [RAG landing demo](https://rag.calypso.so/demos/world-cup-results).

## Inside The Corpus

This is the source-grounded research surface behind the World Cup Results Demo:

- 4 indexed CSV sources
- 49,393 match results from 1872 to 2026
- Results, tournaments, venues, shootouts, goalscorers, and historical team names
- Fast grounded answers by default, with citations from the soccer results corpus
- Read-only demo mode powered by `calypso-rag-agent:worldcup`

Source trail:

- `results.csv`: match results and venues, 49,393 rows
- `shootouts.csv`: shootout winners and first shooters
- `goalscorers.csv`: scorers, penalties, and own goals
- `former_names.csv`: historical team-name changes for 36 teams

## Try Asking

- Who are the best men's national soccer teams of all time? Rank them using the results corpus and cite your evidence.
- Which national teams dominated each era of international soccer from 1872 to 2026?
- Compare Brazil and Germany across World Cup eras using match results from the corpus.
- How strong is home advantage in international soccer, and has it changed over time?
- Does hosting a major tournament improve a country's performance? Use the corpus to show why or why not.
- What patterns stand out in international penalty shootouts? Use `shootouts.csv` and cite examples.

## What You Get

- Grounded answers from `calypso-rag-agent:worldcup`
- Citation-rich responses through the Calypso Responses API
- Handy resources like `soccer://corpus-info` and `soccer://starter-prompts`
- A clean `ask-world-cup-soccer` MCP tool for match-history questions
- A read-only demo surface, so agents can explore safely

## Claude Desktop Setup

Add this to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "world-cup-soccer": {
      "command": "npx",
      "args": ["-y", "@calypsohq/soccer-rag-mcp-server"]
    }
  }
}
```

Restart Claude Desktop, then ask Claude to use `world-cup-soccer` for grounded soccer questions. The primary tool is `ask-world-cup-soccer`.

## Bring Your Own Key

Want to use your own Calypso project with upload and bucket tools enabled?

```bash
CALYPSO_API_KEY=sk-... npx -y @calypsohq/soccer-rag-mcp-server
```

BYOK mode switches from the public World Cup demo into your own Calypso knowledge workspace.

For Claude Desktop BYOK mode, add an `env` block:

```json
{
  "mcpServers": {
    "world-cup-soccer": {
      "command": "npx",
      "args": ["-y", "@calypsohq/soccer-rag-mcp-server"],
      "env": {
        "CALYPSO_API_KEY": "sk-..."
      }
    }
  }
}
```

## Development

```bash
npm install
npm test
npm run smoke:stdio
```
