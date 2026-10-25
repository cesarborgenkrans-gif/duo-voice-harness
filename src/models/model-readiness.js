/* Working rule: downloaded catalogs do not prove a local model is loaded.
   Remote providers are ready when a model and credentials are configured. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DiscussionModelReadiness = api;
})(globalThis, function () {
  function matches(models, wanted) {
    const target = String(wanted || '').toLowerCase();
    return (models || []).some(id => !target || String(id).toLowerCase() === target || String(id).toLowerCase().endsWith('/' + target));
  }
  function assess(settings, response, confirmed = false) {
    if (!response?.ok) return false;
    if (settings.provider === 'local-llama') return response.state === 'ready' && (response.models || []).length > 0;
    if (settings.provider === 'openrouter') return !!settings.model?.trim() && !!settings.credentialRef && matches(response.models, settings.model);
    if (settings.provider === 'lmstudio' || settings.provider === 'ollama') {
      return Array.isArray(response.loadedModels) ? matches(response.loadedModels, settings.model) : confirmed;
    }
    return matches(response.models, settings.model);
  }
  return { assess };
});
