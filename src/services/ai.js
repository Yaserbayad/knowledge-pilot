import { extractJson } from '../utils.js';

export class AiService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async json({ system, prompt, fallback }) {
    const provider = this.config.provider;
    if (provider === 'mock') return structuredClone(typeof fallback === 'function' ? fallback() : fallback);
    if (provider === 'ollama') return this.#ollama(system, prompt);
    if (provider === 'openai_compatible') return this.#openAiCompatible(system, prompt);
    throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
  }

  async #openAiCompatible(system, prompt) {
    if (!this.config.apiKey) throw new Error('AI_API_KEY is required for openai_compatible mode');
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `${system}\nReturn only valid JSON.` },
          { role: 'user', content: prompt }
        ]
      }),
      signal: AbortSignal.timeout(120000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`AI request failed (${response.status}): ${body.slice(0, 500)}`);
    const parsed = JSON.parse(body);
    const content = parsed.choices?.[0]?.message?.content;
    const json = extractJson(content || '');
    if (!json) throw new Error('AI returned invalid JSON');
    return json;
  }

  async #ollama(system, prompt) {
    const response = await fetch(`${this.config.ollamaBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.config.ollamaModel,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: `${system}\nReturn only valid JSON.` },
          { role: 'user', content: prompt }
        ]
      }),
      signal: AbortSignal.timeout(180000)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`Ollama request failed (${response.status}): ${body.slice(0, 500)}`);
    const parsed = JSON.parse(body);
    const json = extractJson(parsed.message?.content || '');
    if (!json) throw new Error('Ollama returned invalid JSON');
    return json;
  }
}

export function mockPlan(user) {
  const primary = user.rankedTopics?.[0] || user.interests?.[0] || 'Critical thinking';
  const secondary = user.rankedTopics?.[1] || user.interests?.[1] || 'History';
  return {
    primarySubject: primary,
    secondarySubjects: [secondary],
    rationale: 'A curiosity-first weekly sequence that builds one main track while preserving variety.',
    proposals: [
      {
        title: `The hidden structure of ${primary}`,
        question: `What is the most useful idea in ${primary} that most people miss?`,
        topic: primary,
        reason: 'Creates a motivating entry point and reveals the conceptual map.',
        estimatedMinutes: 8
      },
      {
        title: `A real case from ${secondary}`,
        question: `What can one concrete case teach us about ${secondary}?`,
        topic: secondary,
        reason: 'Adds interleaving and cross-disciplinary perspective.',
        estimatedMinutes: 7
      },
      {
        title: `How to reason better about ${primary}`,
        question: `Which reasoning error most often distorts decisions in ${primary}?`,
        topic: primary,
        reason: 'Turns factual learning into transferable judgment.',
        estimatedMinutes: 9
      }
    ]
  };
}

export function mockLesson(proposal, sources = []) {
  return {
    title: proposal.title,
    question: proposal.question,
    topic: proposal.topic,
    estimatedMinutes: proposal.estimatedMinutes || 8,
    difficulty: 'moderate',
    content: {
      hook: `Consider this question: ${proposal.question}`,
      coreExplanation: `This demonstration lesson shows the complete learning flow for ${proposal.topic}. Configure an AI provider and a research source to replace this mock content with a researched lesson.`,
      context: 'The system starts with curiosity, supplies only the context required for understanding, and then builds toward application.',
      examples: ['A concrete case makes the abstract principle easier to distinguish.', 'A contrasting case reveals where the principle stops applying.'],
      perspectives: ['One perspective emphasizes foundational knowledge.', 'Another emphasizes practical transfer and decision quality.'],
      misconceptions: ['A short summary is not automatically deep learning.', 'Recognition is not the same as recall.'],
      practicalMeaning: 'The value comes from repeatedly connecting new information to prior knowledge and testing whether it can be recalled and applied.',
      knowledgeConnection: 'This connects curiosity, active recall, and adaptive review into one learning loop.',
      keyIdeas: ['New material should remain the main focus.', 'Retrieval practice protects long-term memory.', 'Connections make knowledge reusable.'],
      practicalTakeaway: 'After consuming any explanation, state the main idea from memory and apply it to a new example.',
      reflectionPrompt: 'How would you explain the central idea without looking back?',
      nextTeaser: 'The next lesson can test how spacing changes what remains accessible weeks later.'
    },
    quiz: [
      { type: 'recall', question: 'What is the difference between recognizing an idea and recalling it?', expected: 'Recall requires producing the idea without seeing it.' },
      { type: 'application', question: 'How could you apply the lesson to a subject you want to learn?', expected: 'Use a curiosity hook, explain, recall, and connect the idea.' }
    ],
    sources: sources.map((s, index) => ({ ...s, id: s.id || `src_${index + 1}` })),
    claims: []
  };
}
