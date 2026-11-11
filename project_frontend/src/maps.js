let pending;
export function loadMaps(key) {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (!key)
    return Promise.reject(
      new Error("Configure VITE_GOOGLE_MAPS_API_KEY to load the map."),
    );
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => fail(), 15000);
    const fail = () => {
      clearTimeout(timer);
      delete window.usMapReady;
      delete window.gm_authFailure;
      script.remove();
      pending = null;
      reject(
        new Error(
          "Map loading failed. Check network, billing, and API key restrictions.",
        ),
      );
    };
    window.usMapReady = () => {
      clearTimeout(timer);
      delete window.usMapReady;
      resolve(window.google.maps);
    };
    window.gm_authFailure = fail;
    script.onerror = fail;
    script.async = true;
    script.src =
      "https://maps.googleapis.com/maps/api/js?" +
      new URLSearchParams({ key, loading: "async", callback: "usMapReady" });
    document.head.appendChild(script);
  });
  return pending;
}
