/**
 * How a caller picks the credential for a model.
 *
 * It lives in its own module rather than beside either consumer because both need it and they
 * already point at each other: `mount-agent.ts` imports `buildAgentHitl` from
 * `build-agent-streamer.ts`, so declaring the type in `mount-agent.ts` and importing it back
 * created a cycle the architecture guard rejected — correctly. A shared contract that two modules
 * depend on belongs to neither of them.
 */

/**
 * Chooses the API key for a model. Receives the model id the compiled agent declares, or
 * `undefined` when it declares none.
 *
 * The resolver form exists because the credential depends on the model, and the model is only
 * known once the agent module is compiled. Callers that resolved eagerly were choosing a provider
 * before anyone could read which one the agent asked for — usetheokit/theokit#326 on the agent
 * endpoint, #328 on the thread follow-up route.
 *
 * @public
 */
export type ApiKeyResolver = (modelId: string | undefined) => string
