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

export function getExpoPublicGoogleMapsBrowserKey(): string {
  return process.env.EXPO_PUBLIC_GOOGLE_MAPS_BROWSER_KEY?.trim() ?? "";
}

/** Inline HTML for mobile web export (iframe srcDoc). Permissions stay native. */
export function googleMapDocument(center: MapPosition, interactive: boolean, apiKey: string) {
  if (!isValidLatLng(center)) throw new Error("invalid_map_center");
  if (!apiKey) throw new Error("missing_google_maps_key");
  const lat = center.lat;
  const lng = center.lng;
  const zoom = interactive ? 16 : 15;
  const gesture = interactive ? "greedy" : "none";
  const drag = interactive ? "true" : "false";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://maps.googleapis.com; style-src 'unsafe-inline'; img-src https://*.googleapis.com https://*.gstatic.com data:; connect-src https://maps.googleapis.com https://*.googleapis.com"><style>html,body,#map{height:100%;width:100%;margin:0;background:#f3eef0}</style></head><body><div id="map"></div><script>
    function send(value){var data=JSON.stringify(value);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(data);else window.parent.postMessage(data,'*')}
    window.gm_authFailure=function(){send({type:'unavailable'})};
    var loaded=false;setTimeout(function(){if(!loaded)send({type:'unavailable'})},10000);
    function initMap(){try{loaded=true;var map=new google.maps.Map(document.getElementById('map'),{center:{lat:${lat},lng:${lng}},zoom:${zoom},disableDefaultUI:true,zoomControl:false,gestureHandling:'${gesture}',draggable:${drag},scrollwheel:${drag},disableDoubleClickZoom:${interactive ? "false" : "true"},keyboardShortcuts:${drag},clickableIcons:false});${interactive ? "map.addListener('idle',function(){var c=map.getCenter();send({type:'center',lat:c.lat(),lng:c.lng()})});" : ""}}catch(e){send({type:'unavailable'})}}
  </script><script src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&language=ar&region=EG&callback=initMap" async defer onerror="send({type:'unavailable'})"></script></body></html>`;
}
