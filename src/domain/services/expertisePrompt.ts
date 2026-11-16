import { ExpertiseMode, UserExpertiseProfile, DEFAULT_EXPERTISE_PROFILE } from '../models/types';

// Prompt adaptation layer: modifies system and user prompts based on the user's
// expertise profile. Each function returns additional instructions to prepend or
// append to existing prompts — the caller decides where they go.

// ── Extraction (meeting/document → requirements) ─────────────────────────────

const EXTRACTION_ADDONS: Record<ExpertiseMode, string> = {
  'power-user': '',

  'domain-transfer': `The reader is a technical person (developer/architect) who does NOT know this business domain.
- When a domain-specific term appears (industry jargon, acronyms, regulatory references, business workflows), include a brief clarification in parentheses in the description. Example: "HIPAA compliance (U.S. healthcare data privacy regulation requiring encryption at rest and audit logs)".
- Frame acceptance criteria in terms a developer can act on directly — map business outcomes to technical verifiable conditions where possible.
- If the meeting references an industry-standard process, briefly note what it entails.`,

  'tech-shield': `The reader is a non-technical business stakeholder who understands the domain well but NOT software engineering.
- Write descriptions in plain, everyday language. Say "the system should remember the user's choice" instead of "persist user preference to session state".
- Frame acceptance criteria as observable outcomes the user can verify themselves: "the user sees a confirmation message" rather than "API returns 200 with a JSON body".
- Avoid implementation details (databases, APIs, protocols, frameworks) in requirement descriptions — focus on what the system does, not how.
- Keep type and priority classifications, but describe them without jargon if their names aren't self-explanatory.`,

  'full-guidance': `The reader is new to both this business domain AND software engineering.
- Write descriptions in plain, everyday language. Avoid all technical jargon.
- When a domain-specific term appears (industry jargon, acronyms, regulatory references), include a brief clarification in parentheses. Example: "KYC check (a 'Know Your Customer' identity verification that banks are legally required to do before opening an account)".
- Frame acceptance criteria as things a person can observe: "the user sees…", "the system shows…", "an email is sent when…".
- Avoid implementation details entirely — no mention of databases, APIs, protocols, or frameworks.
- If a requirement is complex, add a one-sentence "In simple terms:" summary at the start of the description.`,
};

export function extractionExpertiseAddon(profile?: UserExpertiseProfile): string {
  return EXTRACTION_ADDONS[(profile ?? DEFAULT_EXPERTISE_PROFILE).mode];
}

// ── Specification (requirements → spec document) ─────────────────────────────

const SPEC_ADDONS: Record<ExpertiseMode, string> = {
  'power-user': '',

  'domain-transfer': `The person reading this spec is a developer/architect who is new to this business domain.
- Include a "Domain Context" section at the top that explains the business domain, its key concepts, and why this feature matters in that context.
- Map every domain-specific term to a brief definition the first time it appears.
- When a requirement is driven by a regulation, standard, or business process, explain the "why" before the "what".
- Technical implementation details are welcome — the reader can handle them.`,

  'tech-shield': `The person reading this spec is a non-technical stakeholder who understands the business domain.
- Write the specification primarily as user stories: "As a [role], I want [goal] so that [reason]".
- Replace architecture/API sections with "How it works (simplified)" sections using everyday analogies.
- Do NOT include code snippets, database schemas, or API endpoint definitions.
- Describe system behavior and user-visible outcomes, not implementation.
- Keep the spec actionable: a developer will translate it separately, but the reader should be able to validate completeness.`,

  'full-guidance': `The person reading this spec is new to both the business domain and software engineering.
- Include a "Domain Context" section explaining the business domain in everyday language.
- Include a "Domain Dictionary" section defining every business term and acronym.
- Write requirements as user stories: "As a [role], I want [goal] so that [reason]".
- Replace technical sections with "How it works (simplified)" sections using real-world analogies (e.g., "think of the login system like a building's security desk — it checks your badge before letting you in").
- Do NOT include code, schemas, API details, or architectural diagrams.
- For complex features, include a "What this means for you" summary in plain language.
- Focus on what the user will see and experience, step by step.`,
};

export function specExpertiseAddon(profile?: UserExpertiseProfile): string {
  return SPEC_ADDONS[(profile ?? DEFAULT_EXPERTISE_PROFILE).mode];
}

// ── Clarification phase ──────────────────────────────────────────────────────

const CLARIFICATION_ADDONS: Record<ExpertiseMode, string> = {
  'power-user': '',

  'domain-transfer': `The user is technically proficient but new to this business domain.
- Focus your clarification questions on domain meaning: "What does [term] mean in your industry?", "Is [process] a regulatory requirement or an internal policy?".
- You can use technical language freely — the user understands software concepts.
- Don't ask about technical implementation choices unless the spec is ambiguous about them.`,

  'tech-shield': `The user understands the business domain but is not technical.
- Frame questions in business terms, not technical ones. Instead of "Should this be a synchronous or asynchronous operation?", ask "Should the user wait for this to finish, or can they continue working while it happens in the background?".
- Focus on behavior and outcomes: "When a customer cancels an order, should they get a refund immediately or after review?".
- If you need to clarify a technical decision, translate it: "How fast should this be? For example, should the page load in under 2 seconds?".`,

  'full-guidance': `The user is new to both this domain and software engineering.
- Use the simplest possible language in your questions.
- Provide context for each question — explain briefly why it matters before asking.
- Offer concrete options when possible: "Should the system do A or B?" is easier to answer than "How should the system handle X?".
- If clarifying a domain concept, acknowledge that it may be unfamiliar: "The meeting mentioned [term] — could you explain what that means in your organization?".
- If clarifying a technical decision, translate it entirely: "When someone uploads a large file, should they see a progress bar (so they know it's working), or is a simple 'please wait' message enough?".`,
};

export function clarificationExpertiseAddon(profile?: UserExpertiseProfile): string {
  return CLARIFICATION_ADDONS[(profile ?? DEFAULT_EXPERTISE_PROFILE).mode];
}

// ── Planning & Tasks ─────────────────────────────────────────────────────────

const PLANNING_ADDONS: Record<ExpertiseMode, string> = {
  'power-user': '',

  'domain-transfer': `The reader is a developer new to this domain.
- Add a brief domain-context note to tasks that depend on business rules or regulations.
- Technical task language is fine — just annotate the "why" when it comes from domain knowledge.`,

  'tech-shield': `The reader is a non-technical stakeholder.
- Write tasks as high-level milestones, not implementation steps. "Set up user login" instead of "Implement JWT auth middleware with refresh token rotation".
- Describe each task's outcome in terms of what the user will see or be able to do.
- Group tasks by user-facing feature area, not by technical layer.`,

  'full-guidance': `The reader is new to both the domain and software engineering.
- Write tasks as plain-language milestones with expected outcomes.
- Add a one-sentence "What this means:" note for each milestone.
- Group by what the user will experience, not by technical system.
- Avoid technical acronyms entirely.`,
};

export function planningExpertiseAddon(profile?: UserExpertiseProfile): string {
  return PLANNING_ADDONS[(profile ?? DEFAULT_EXPERTISE_PROFILE).mode];
}

// ── Implementation ───────────────────────────────────────────────────────────

const IMPLEMENTATION_ADDONS: Record<ExpertiseMode, string> = {
  'power-user': '',

  'domain-transfer': `The project owner is a developer who is new to this business domain.
- Add code comments only where a business rule drives the implementation and a developer unfamiliar with the domain would otherwise misunderstand the intent.`,

  'tech-shield': `The project owner is a non-technical stakeholder.
- When reporting progress or asking questions, use plain language: "Built the login page" instead of "Implemented auth controller with session middleware".
- If you need a decision, frame it as a user-visible choice.`,

  'full-guidance': `The project owner is new to both the domain and engineering.
- When reporting progress, describe what the user can now see or do.
- When asking questions, provide simple options with brief explanations.
- Add inline comments where business rules drive implementation, explaining the rule in plain language.`,
};

export function implementationExpertiseAddon(profile?: UserExpertiseProfile): string {
  return IMPLEMENTATION_ADDONS[(profile ?? DEFAULT_EXPERTISE_PROFILE).mode];
}

// ── Generic helper: append addon to a prompt if non-empty ────────────────────

export function withExpertiseAddon(basePrompt: string, addon: string): string {
  if (!addon) return basePrompt;
  return `${basePrompt}\n\n${addon}`;
}
