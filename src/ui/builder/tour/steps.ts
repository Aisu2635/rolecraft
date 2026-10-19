/** The first-run tour. `target` is the `data-tour` value on the element each step highlights. */
export const TOUR_STEPS: { target: string; title: string; body: string }[] = [
  {
    target: "sidebar",
    title: "Pick AWS services",
    body: "Search or browse services here. Each one you add becomes a permission you can fine-tune.",
  },
  {
    target: "steps",
    title: "Three steps",
    body: "Choose who can use the role, what it can do, then review and export. You can move between steps at any time.",
  },
  {
    target: "workspace",
    title: "Describe access in plain English",
    body: "Pick what each service may do and on which resources. Sentences and Grid are two views of the same permissions.",
  },
  {
    target: "output",
    title: "Your policy, live",
    body: "The policy, trust policy and scripts update as you go. Anything that still needs your input is listed here.",
  },
  {
    target: "actions",
    title: "Copy, export or share",
    body: "Copy the JSON, download ready-to-run scripts and templates, or share a link. Nothing leaves your browser.",
  },
];
