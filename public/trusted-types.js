if (window.trustedTypes?.createPolicy) {
  window.trustedTypes.createPolicy("default", {
    createHTML: (value) => value,
    createScript: (value) => value,
    createScriptURL: (value) => value,
  });
}
