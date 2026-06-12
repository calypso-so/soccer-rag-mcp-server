import { CALYPSO_WORLDCUP_MODEL } from "./config.js";

export type WorldCupPrompt = {
  id: string;
  title: string;
  prompt: string;
  group: string;
};

export const WORLDCUP_CORPUS_INFO = {
  slug: "world-cup-results",
  title: "International Soccer Results Research Demo",
  agentModel: CALYPSO_WORLDCUP_MODEL,
  coverage: "1872-2026",
  sourceCount: 4,
  totalSize: "49k+ matches",
  formats: ["CSV"],
  representativeSources: [
    {
      filename: "results.csv",
      kind: "CSV",
      size: "49,393 rows",
      role: "Match results and venues",
    },
    {
      filename: "shootouts.csv",
      kind: "CSV",
      size: "Penalty records",
      role: "Shootout winners and first shooters",
    },
    {
      filename: "goalscorers.csv",
      kind: "CSV",
      size: "Goal events",
      role: "Scorers, penalties, and own goals",
    },
    {
      filename: "former_names.csv",
      kind: "CSV",
      size: "36 teams",
      role: "Historical team-name changes",
    },
  ],
  demoUrl: "https://rag.calypso.so/demos/world-cup-results",
};

export const WORLDCUP_STARTER_PROMPT_GROUPS = [
  {
    title: "Historical Rankings",
    description: "Compare national teams across the full results archive.",
    prompts: [
      {
        title: "Best teams of all time",
        prompt:
          "Who are the best men's national soccer teams of all time? Rank them using the results corpus and cite your evidence.",
      },
      {
        title: "Era dominance map",
        prompt:
          "Which national teams dominated each era of international soccer from 1872 to 2026?",
      },
      {
        title: "Brazil vs Germany",
        prompt:
          "Compare Brazil and Germany across World Cup eras using match results from the corpus.",
      },
    ],
  },
  {
    title: "Tournament Patterns",
    description: "Interrogate venue, host, and shootout effects.",
    prompts: [
      {
        title: "Home advantage over time",
        prompt:
          "How strong is home advantage in international soccer, and has it changed over time?",
      },
      {
        title: "Does hosting help?",
        prompt:
          "Does hosting a major tournament improve a country's performance? Use the corpus to show why or why not.",
      },
      {
        title: "Penalty shootout patterns",
        prompt:
          "What patterns stand out in international penalty shootouts? Use shootouts.csv and cite examples.",
      },
    ],
  },
  {
    title: "Fixtures & Players",
    description: "Explore rivalries, goalscorers, and team-name changes.",
    prompts: [
      {
        title: "Biggest rivalries",
        prompt:
          "What are the biggest international soccer rivalries in the dataset? Rank them by history and stakes.",
      },
      {
        title: "Top scorers and name changes",
        prompt:
          "Who are the top international goalscorers in the corpus, and where do former team names matter?",
      },
    ],
  },
] as const;

export function listWorldCupStarterPrompts(): WorldCupPrompt[] {
  const prompts: WorldCupPrompt[] = [];
  for (const group of WORLDCUP_STARTER_PROMPT_GROUPS) {
    for (const item of group.prompts) {
      const id = item.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      prompts.push({
        id: `worldcup-${id}`,
        title: item.title,
        prompt: item.prompt,
        group: group.title,
      });
    }
  }
  return prompts;
}
