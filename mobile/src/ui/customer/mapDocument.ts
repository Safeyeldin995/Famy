import { isValidLatLng } from "@shared/geo/latLng";
export type MapPosition = { lat: number; lng: number };
export function parseMapMessage(raw: string): MapPosition | "unavailable" | null {
  try {
    const value = JSON.parse(raw);
    if (value?.type === "unavailable") return "unavailable";
    if (
      value?.type === "center" &&
      typeof value.lat === "number" &&
      typeof value.lng === "number" &&
      isValidLatLng(value)
    )
      return { lat: value.lat, lng: value.lng };
  } catch {
    /* Untrusted map messages are ignored. */
  }
  return null;
}
/** Credential-free Leaflet surface. Permissions and confirmation stay native. */
export function mapDocument(center: MapPosition, interactive: boolean) {
  if (!isValidLatLng(center)) throw new Error("invalid_map_center");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://unpkg.com; style-src 'unsafe-inline' https://unpkg.com; img-src https://*.tile.openstreetmap.org data:; connect-src 'none'"><link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous"><style>html,body,#map{height:100%;width:100%;margin:0;background:#f3eef0}.leaflet-control-attribution{font-size:10px}</style></head><body><div id="map"></div><script>
    function send(value){var data=JSON.stringify(value);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(data);else window.parent.postMessage(data,'*')}
    var loaded=false;setTimeout(function(){if(!loaded)send({type:'unavailable'})},10000);
    function boot(){try{var map=L.map('map',{zoomControl:false,dragging:${interactive},touchZoom:${interactive},scrollWheelZoom:${interactive},doubleClickZoom:${interactive},keyboard:${interactive},boxZoom:false}).setView([${center.lat},${center.lng}],${interactive ? 16 : 15});var ok=0,errors=0;L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; OpenStreetMap'}).on('tileload',function(){loaded=true;ok++}).on('tileerror',function(){if(++errors>=3&&!ok)send({type:'unavailable'})}).addTo(map);${interactive ? "map.on('moveend',function(){var c=map.getCenter();send({type:'center',lat:c.lat,lng:c.lng})});" : ""}}catch(e){send({type:'unavailable'})}}
  </script><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous" onload="boot()" onerror="send({type:'unavailable'})"></script></body></html>`;
}
