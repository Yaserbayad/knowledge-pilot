import { APP_VERSION } from './version.js';
const stringArray = (description = '') => ({ type: 'array', description, items: { type: 'string' } });
const pathParameter = (name, description) => ({ name, in: 'path', required: true, description, schema: { type: 'string' } });

export function gptOpenApi(baseUrl) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Knowledge Pilot Business Actions',
      version: APP_VERSION,
      description: 'Processes verified topic-learning and book-learning tasks for a private self-hosted Knowledge Pilot installation.'
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/api/gpt/health': {
        get: {
          operationId: 'getKnowledgePilotHealth',
          summary: 'Check the Knowledge Pilot Action connection and pending task count.',
          responses: {
            200: {
              description: 'Health status.',
              content: { 'application/json': { schema: {
                type: 'object',
                properties: { ok: { type: 'boolean' }, mode: { type: 'string' }, pending: { type: 'integer' }, time: { type: 'string', format: 'date-time' } },
                required: ['ok', 'mode', 'pending', 'time'], additionalProperties: false
              } } }
            }
          }
        }
      },
      '/api/gpt/tasks': {
        get: {
          operationId: 'listKnowledgeTasks',
          summary: 'List Knowledge Pilot tasks, normally pending tasks ordered by priority.',
          parameters: [
            { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['pending', 'claimed', 'completed', 'failed', 'all'], default: 'pending' } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }
          ],
          responses: { 200: { description: 'Task summaries.', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/TaskSummary' } } } } } }
        }
      },
      '/api/gpt/tasks/{taskId}': {
        get: {
          operationId: 'getKnowledgeTaskContext',
          summary: 'Retrieve the complete context and result contract for one task.',
          parameters: [pathParameter('taskId', 'Knowledge Pilot task identifier.')],
          responses: { 200: { description: 'Task context.', content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskContext' } } } } }
        }
      },
      '/api/gpt/tasks/{taskId}/claim': {
        post: {
          operationId: 'claimKnowledgeTask',
          summary: 'Claim a pending task before researching and producing its result.',
          parameters: [pathParameter('taskId', 'Knowledge Pilot task identifier.')],
          responses: { 200: { description: 'Claimed task.', content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskRecord' } } } } }
        }
      },
      '/api/gpt/tasks/{taskId}/result': {
        post: {
          operationId: 'submitKnowledgeTaskResult',
          summary: 'Submit the verified result for a claimed Knowledge Pilot task.',
          parameters: [pathParameter('taskId', 'Knowledge Pilot task identifier.')],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskResultSubmission' } } } },
          responses: { 200: { description: 'Accepted result.', content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskResultResponse' } } } } }
        }
      },
      '/api/gpt/tasks/{taskId}/book-analysis-result': {
        post: {
          operationId: 'submitBookAnalysisResult',
          summary: 'Submit a complete book-analysis result using the strict versioned book-analysis contract.',
          description: 'Use this operation for book_analysis tasks. Contract errors return HTTP 422 with exact field diagnostics and leave the task pending for correction.',
          parameters: [pathParameter('taskId', 'Knowledge Pilot book-analysis task identifier.')],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/BookAnalysisResultSubmission' } } } },
          responses: {
            200: { description: 'Accepted book-analysis result.', content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskResultResponse' } } } },
            422: { description: 'Retryable result-contract error.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ContractErrorResponse' } } } }
          }
        }
      },
      '/api/gpt/tasks/{taskId}/fail': {
        post: {
          operationId: 'reportKnowledgeTaskFailure',
          summary: 'Report that a task cannot be completed accurately or safely.',
          parameters: [pathParameter('taskId', 'Knowledge Pilot task identifier.')],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/FailureRequest' } } } },
          responses: { 200: { description: 'Failed task record.', content: { 'application/json': { schema: { $ref: '#/components/schemas/TaskRecord' } } } } }
        }
      },
      '/api/gpt/books/{bookId}/source-text': {
        get: {
          operationId: 'getOwnedBookSourceText',
          summary: 'Read one bounded chunk from the learner-owned extracted book text.',
          description: 'Use only for book tasks that explicitly provide this endpoint. Retrieve additional chunks using nextOffset. Do not quote or reproduce substantial copyrighted text in outputs.',
          parameters: [
            pathParameter('bookId', 'Book identifier supplied in the task context.'),
            { name: 'offset', in: 'query', required: false, schema: { type: 'integer', minimum: 0, default: 0 } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1000, maximum: 24000, default: 16000 } }
          ],
          responses: {
            200: { description: 'Extracted text chunk.', content: { 'application/json': { schema: {
              type: 'object',
              properties: { offset: { type: 'integer' }, limit: { type: 'integer' }, totalCharacters: { type: 'integer' }, text: { type: 'string' }, nextOffset: { type: ['integer', 'null'] } },
              required: ['offset', 'limit', 'totalCharacters', 'text', 'nextOffset'], additionalProperties: false
            } } } }
          }
        }
      }
    },
    components: {
      securitySchemes: { ActionApiKey: { type: 'http', scheme: 'bearer' } },
      schemas: {
        TaskSummary: {
          type: 'object',
          properties: { id: { type: 'string' }, type: { type: 'string' }, userId: { type: 'string' }, status: { type: 'string' }, priority: { type: 'number' }, createdAt: { type: 'string', format: 'date-time' } },
          required: ['id', 'type', 'userId', 'status', 'priority', 'createdAt'], additionalProperties: false
        },
        TaskRecord: {
          type: 'object',
          properties: { id: { type: 'string' }, type: { type: 'string' }, userId: { type: 'string' }, payload: { type: 'object', properties: {}, additionalProperties: true }, dedupeKey: { type: 'string' }, priority: { type: 'number' }, status: { type: 'string' }, claimedAt: { type: ['string', 'null'] }, completedAt: { type: ['string', 'null'] }, attempts: { type: 'integer' }, resultRef: { type: ['string', 'null'] }, error: { type: ['string', 'null'] }, submissionRejectCount: { type: 'integer' }, lastSubmissionError: { type: ['object', 'null'], properties: {}, additionalProperties: true }, acceptedSubmission: { type: ['object', 'null'], properties: {}, additionalProperties: true }, createdAt: { type: 'string' }, updatedAt: { type: 'string' } },
          required: ['id', 'type', 'userId', 'status', 'createdAt', 'updatedAt'], additionalProperties: true
        },
        LearnerProfile: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' }, language: { type: 'string' }, timezone: { type: 'string' }, interests: stringArray(), rankedTopics: stringArray(), avoidedTopics: stringArray(), exampleQuestions: stringArray(), knowledgeRatings: { type: 'object', properties: {}, additionalProperties: { type: 'string' } }, mastery: { type: 'object', properties: {}, additionalProperties: true }, preferredWindows: stringArray() },
          required: ['id', 'name', 'language', 'timezone'], additionalProperties: true
        },
        TaskIdentity: {
          type: 'object',
          properties: { id: { type: 'string' }, type: { type: 'string' }, status: { type: 'string' }, createdAt: { type: 'string' }, lastSubmissionError: { type: ['object', 'null'], properties: {}, additionalProperties: true } },
          required: ['id', 'type', 'status', 'createdAt'], additionalProperties: false
        },
        TaskContext: {
          type: 'object',
          properties: {
            task: { $ref: '#/components/schemas/TaskIdentity' },
            learner: { $ref: '#/components/schemas/LearnerProfile' },
            governingStandard: { type: 'string' }, workflow: stringArray(), restrictions: stringArray(), taskInstructions: { type: 'string' }, contractVersion: { type: 'string' }, submissionOperation: { type: 'string' },
            resultContract: { type: 'object', properties: {}, additionalProperties: true },
            recentLessons: { type: 'array', items: { type: 'object', properties: {}, additionalProperties: true } },
            previousKnowledge: { type: 'array', items: { type: 'object', properties: {}, additionalProperties: true } },
            bookKnowledge: { type: 'array', items: { type: 'object', properties: {}, additionalProperties: true } },
            plan: { type: 'object', properties: {}, additionalProperties: true }, proposal: { type: 'object', properties: {}, additionalProperties: true },
            lesson: { type: 'object', properties: {}, additionalProperties: true }, bookSession: { type: 'object', properties: {}, additionalProperties: true },
            book: { type: 'object', properties: {}, additionalProperties: true }, bookPlan: { type: 'object', properties: {}, additionalProperties: true }, planItem: { type: 'object', properties: {}, additionalProperties: true },
            previousBookSessions: { type: 'array', items: { type: 'object', properties: {}, additionalProperties: true } },
            ownedCopy: { type: 'object', properties: { available: { type: 'boolean' }, filename: { type: 'string' }, format: { type: 'string' }, extractedCharacters: { type: 'integer' }, chunkEndpoint: { type: 'string' }, usage: { type: 'string' } }, additionalProperties: true },
            question: { type: ['string', 'object'], properties: {}, additionalProperties: true }, learnerAnswer: { type: 'string' }
          },
          required: ['task', 'learner', 'governingStandard', 'workflow', 'restrictions', 'taskInstructions', 'resultContract'], additionalProperties: true
        },
        SourceSubmission: {
          type: 'object',
          properties: { id: { type: 'string' }, title: { type: 'string' }, url: { type: 'string', format: 'uri', pattern: '^https://' }, sourceType: { type: 'string' }, claimsSupported: stringArray() },
          required: ['id', 'title', 'url'], additionalProperties: false
        },
        ClaimSubmission: {
          type: 'object',
          properties: { text: { type: 'string' }, sourceIds: stringArray() },
          required: ['text', 'sourceIds'], additionalProperties: false
        },
        AdversarialReview: {
          type: 'object',
          properties: { issuesFound: stringArray(), correctionsMade: stringArray(), unresolvedIssues: stringArray() },
          required: ['issuesFound', 'correctionsMade', 'unresolvedIssues'], additionalProperties: false
        },
        FinalAudit: {
          type: 'object',
          properties: { accuracyPassed: { type: 'boolean' }, sourceTraceabilityPassed: { type: 'boolean' }, completenessPassed: { type: 'boolean' }, learnerFitPassed: { type: 'boolean' }, noFabricationPassed: { type: 'boolean' } },
          required: ['accuracyPassed', 'sourceTraceabilityPassed', 'completenessPassed', 'learnerFitPassed', 'noFabricationPassed'], additionalProperties: false
        },
        VerificationSubmission: {
          type: 'object',
          properties: {
            learnerFit: { type: 'string' }, noveltyCheck: { type: 'string' }, coherenceCheck: { type: 'string' }, researchApproach: { type: 'string' }, editionConfidence: { type: 'string' },
            consensusStatus: { type: 'string' }, disagreements: stringArray(), uncertainty: stringArray(), authorFaithfulness: { type: 'string' }, criticismBasis: { type: 'string' }, sourceLimitations: stringArray(),
            adversarialReview: { $ref: '#/components/schemas/AdversarialReview' }, finalAudit: { $ref: '#/components/schemas/FinalAudit' },
            accuracyChecked: { type: 'boolean' }, noFabricationPassed: { type: 'boolean' }, fairnessChecked: { type: 'boolean' }
          },
          additionalProperties: false
        },
        TopicLessonContent: {
          type: 'object',
          properties: { hook: { type: 'string' }, coreExplanation: { type: 'string' }, context: { type: 'string' }, examples: stringArray(), perspectives: stringArray(), misconceptions: stringArray(), practicalMeaning: { type: 'string' }, knowledgeConnection: { type: 'string' }, keyIdeas: stringArray(), practicalTakeaway: { type: 'string' }, reflectionPrompt: { type: 'string' }, nextTeaser: { type: 'string' } },
          additionalProperties: false
        },
        QuizSubmission: {
          type: 'object',
          properties: { type: { type: 'string' }, question: { type: 'string' }, expected: { type: 'string' }, options: stringArray() },
          required: ['type', 'question', 'expected'], additionalProperties: false
        },
        BookMetadataSubmission: {
          type: 'object',
          properties: { title: { type: 'string' }, author: { type: 'string' }, isbn: { type: 'string' }, edition: { type: 'string' }, language: { type: 'string' }, publishedYear: { type: ['integer', 'null'] }, publisher: { type: 'string' }, bookType: { type: 'string', enum: ['nonfiction', 'business', 'science', 'history', 'psychology', 'biography', 'memoir', 'textbook', 'academic', 'fiction', 'other'] }, coverUrl: { type: 'string' }, description: { type: 'string' } },
          additionalProperties: false
        },
        BookSourceAssessment: {
          type: 'object',
          properties: { quality: { type: 'string', enum: ['high', 'medium', 'limited'] }, fullTextAvailable: { type: 'boolean' }, limitations: stringArray(), sufficientForDetailedPlan: { type: 'boolean' } },
          required: ['quality', 'fullTextAvailable', 'limitations', 'sufficientForDetailedPlan'], additionalProperties: false
        },
        BookPlanSessionSubmission: {
          type: 'object',
          properties: { title: { type: 'string' }, scope: { type: 'string' }, chapterRefs: stringArray(), pageRefs: stringArray(), goals: stringArray(), isCore: { type: 'boolean' }, estimatedMinutes: { type: 'number', minimum: 5, maximum: 10 } },
          required: ['title', 'scope', 'chapterRefs', 'pageRefs', 'goals', 'isCore', 'estimatedMinutes'], additionalProperties: false
        },
        BookPlanSubmission: {
          type: 'object',
          properties: { rationale: { type: 'string' }, recommendedWeeks: { type: 'integer', minimum: 1, maximum: 24 }, sessionsPerWeek: { type: 'integer', minimum: 1, maximum: 7 }, typicalMinutes: { type: 'integer', minimum: 5, maximum: 10 }, difficulty: { type: 'string' }, learningGoals: stringArray(), reviewCheckpoints: stringArray(), finalSynthesis: { type: 'string' }, sessions: { type: 'array', minItems: 0, maxItems: 36, items: { $ref: '#/components/schemas/BookPlanSessionSubmission' } } },
          required: ['rationale', 'recommendedWeeks', 'sessionsPerWeek', 'typicalMinutes', 'difficulty', 'learningGoals', 'reviewCheckpoints', 'finalSynthesis', 'sessions'], additionalProperties: false
        },
        BookSessionContentSubmission: {
          type: 'object',
          properties: {
            hook: { type: 'string' }, summary: { type: 'string' }, importantDetails: stringArray(), context: { type: 'string' }, criticalAssessment: { type: 'string' }, practicalApplication: { type: 'string' },
            quotations: { type: 'array', items: { type: 'object', properties: { text: { type: 'string', description: 'Brief verified excerpt. Total quoted words across the entire session must not exceed 25.' }, location: { type: 'string' } }, required: ['text', 'location'], additionalProperties: false } },
            connections: stringArray(), keyIdeas: stringArray(), reflectionPrompt: { type: 'string' }, nextPreview: { type: 'string' }
          },
          required: ['hook', 'summary', 'importantDetails', 'context', 'criticalAssessment', 'practicalApplication', 'quotations', 'connections', 'keyIdeas', 'reflectionPrompt', 'nextPreview'], additionalProperties: false
        },
        BookConceptSubmission: {
          type: 'object',
          properties: { name: { type: 'string' }, explanation: { type: 'string' }, topicConnection: { type: 'string' } },
          required: ['name', 'explanation', 'topicConnection'], additionalProperties: false
        },
        TopicLinkSubmission: {
          type: 'object',
          properties: { concept: { type: 'string' }, topic: { type: 'string' }, reason: { type: 'string' } },
          required: ['concept', 'topic', 'reason'], additionalProperties: false
        },
        BookAnalysisVerificationSubmission: {
          type: 'object',
          properties: {
            researchApproach: { type: 'string' }, editionConfidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            adversarialReview: { $ref: '#/components/schemas/AdversarialReview' }, finalAudit: { $ref: '#/components/schemas/FinalAudit' }
          },
          required: ['researchApproach', 'editionConfidence', 'adversarialReview', 'finalAudit'], additionalProperties: false
        },
        BookAnalysisResultSubmission: {
          type: 'object',
          description: 'Strict contract for book_analysis tasks. Do not wrap this object inside result, payload, data, or output.',
          properties: {
            contractVersion: { type: 'string', enum: ['book-analysis.v2'] },
            metadata: { $ref: '#/components/schemas/BookMetadataSubmission' },
            sourceAssessment: { $ref: '#/components/schemas/BookSourceAssessment' },
            plan: { $ref: '#/components/schemas/BookPlanSubmission' },
            sources: { type: 'array', minItems: 1, maxItems: 20, items: { $ref: '#/components/schemas/SourceSubmission' } },
            verification: { $ref: '#/components/schemas/BookAnalysisVerificationSubmission' }
          },
          required: ['contractVersion', 'metadata', 'sourceAssessment', 'plan', 'sources', 'verification'], additionalProperties: false
        },
        ContractErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string' }, code: { type: 'string' }, retryable: { type: 'boolean' }, details: stringArray(),
            diagnostics: { type: 'object', properties: {}, additionalProperties: true }, expectedOperation: { type: 'string' }
          },
          required: ['error', 'code', 'retryable', 'details', 'expectedOperation'], additionalProperties: true
        },
        TaskResultSubmission: {
          type: 'object',
          description: 'Superset result schema. Submit only the fields required by the task resultContract returned by getKnowledgeTaskContext.',
          properties: {
            contractVersion: { type: 'string' }, primarySubject: { type: 'string' }, secondarySubjects: stringArray(), rationale: { type: 'string' },
            proposals: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, question: { type: 'string' }, topic: { type: 'string' }, reason: { type: 'string' }, estimatedMinutes: { type: 'number' } }, additionalProperties: false } },
            title: { type: 'string' }, question: { type: 'string' }, topic: { type: 'string' }, language: { type: 'string' }, estimatedMinutes: { type: 'number' }, difficulty: { type: 'string' }, scope: { type: 'string' }, chapterRefs: stringArray(), pageRefs: stringArray(),
            content: { type: 'object', properties: {
              hook: { type: 'string' }, coreExplanation: { type: 'string' }, context: { type: 'string' }, examples: stringArray(), perspectives: stringArray(), misconceptions: stringArray(), practicalMeaning: { type: 'string' }, knowledgeConnection: { type: 'string' }, practicalTakeaway: { type: 'string' }, reflectionPrompt: { type: 'string' }, nextTeaser: { type: 'string' },
              summary: { type: 'string' }, importantDetails: stringArray(), criticalAssessment: { type: 'string' }, practicalApplication: { type: 'string' }, quotations: { type: 'array', items: { type: 'object', properties: { text: { type: 'string', description: 'Brief verified excerpt. Total quoted words across the entire session must not exceed 25.' }, location: { type: 'string' } }, additionalProperties: false } }, connections: stringArray(), keyIdeas: stringArray(), nextPreview: { type: 'string' }
            }, additionalProperties: false },
            quiz: { type: 'array', items: { $ref: '#/components/schemas/QuizSubmission' } }, sources: { type: 'array', items: { $ref: '#/components/schemas/SourceSubmission' } }, claims: { type: 'array', items: { $ref: '#/components/schemas/ClaimSubmission' } },
            metadata: { $ref: '#/components/schemas/BookMetadataSubmission' }, sourceAssessment: { $ref: '#/components/schemas/BookSourceAssessment' }, plan: { $ref: '#/components/schemas/BookPlanSubmission' },
            concepts: { type: 'array', items: { $ref: '#/components/schemas/BookConceptSubmission' } }, topicLinkSuggestions: { type: 'array', items: { $ref: '#/components/schemas/TopicLinkSubmission' } },
            answer: { type: 'string' }, confidence: { type: 'string' }, needsNewLesson: { type: 'boolean' }, suggestedTopic: { type: 'string' }, sourceUrls: stringArray(), correct: { type: 'boolean' }, score: { type: 'number' }, feedback: { type: 'string' }, idealAnswer: { type: 'string' }, verification: { $ref: '#/components/schemas/VerificationSubmission' }
          },
          additionalProperties: false
        },
        TaskResultResponse: {
          type: 'object',
          properties: {
            kind: { type: 'string' }, plan: { type: ['object', 'null'], properties: {}, additionalProperties: true }, lesson: { type: ['object', 'null'], properties: {}, additionalProperties: true }, interaction: { type: ['object', 'null'], properties: {}, additionalProperties: true }, book: { type: ['object', 'null'], properties: {}, additionalProperties: true }, session: { type: ['object', 'null'], properties: {}, additionalProperties: true }, requiresOwnedCopy: { type: 'boolean' }, submission: { type: 'object', properties: {}, additionalProperties: true }
          },
          required: ['kind'], additionalProperties: true
        },
        FailureRequest: {
          type: 'object',
          properties: { reason: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['reason'], additionalProperties: false
        }
      }
    },
    security: [{ ActionApiKey: [] }]
  };
}
