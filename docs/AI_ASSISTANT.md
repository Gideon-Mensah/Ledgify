# Ledgify AI Assistant

The AI Assistant has two bounded responsibilities: explain the implemented Ledgify application and prepare proposals that a user can explicitly turn into draft accounting work. It cannot approve or post.

## Knowledge maintenance

Application help lives in `apps/ai/services/knowledge_service.py` as small versioned sections with stable IDs, routes, permissions, keywords and code-backed instructions. Update the relevant section when a route, label, permission or workflow changes, and increment `KNOWLEDGE_VERSION`. Retrieval is lexical and route-aware; no vector database is needed at the current scale.

## Provider configuration

Provider credentials exist only in the Django/Render environment. The frontend sends authenticated requests through the normal API client and its `X-Organisation-ID` header. The OpenAI adapter uses the Responses API without provider-side conversation storage, limits history/context/output, applies a timeout and bounded retry, and falls back to local Ledgify knowledge when unavailable.

## Draft safety

AI action proposals are organisation-scoped and non-mutating. An explicit **Create draft for review** action validates active organisation accounts, decimal amounts, balance and duplicate lines, then invokes the normal journal service to create a `draft` journal. Posting remains in the normal journal workflow and requires its existing permission and human confirmation.
