"""US place search for the origin and destination fields, through TomTom Search."""

from dataclasses import dataclass
from urllib.parse import quote

import httpx
from django.core.cache import BaseCache
from django.core.cache import cache as default_cache

from planner.trip import timezone_at
from planner.upstream import UpstreamFailed, get_with_retry

TOMTOM_SEARCH_URL = "https://api.tomtom.com/search/2/search/{query}.json"
MAX_RESULTS = 6
CACHE_TTL_S = 24 * 3600  # Place coordinates don't change from one search to the next.
REQUEST_TIMEOUT_S = 10.0
RETRY_DELAY_S = 0.5


class GeocodingError(Exception):
    """Place search failed; the message is safe to show."""


@dataclass(frozen=True)
class Place:
    label: str
    lat: float
    lon: float
    timezone: str


class TomTomGeocoder:
    def __init__(
        self,
        api_key: str,
        http: httpx.Client | None = None,
        cache: BaseCache = default_cache,
        retry_delay_s: float = RETRY_DELAY_S,
    ):
        self._api_key = api_key
        self._http = http or httpx.Client(timeout=REQUEST_TIMEOUT_S)
        self._cache = cache
        self._retry_delay_s = retry_delay_s

    def search(self, query: str) -> list[Place]:
        query = " ".join(query.split())
        key = f"geocode:v1:{query.lower()}"
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        try:
            response = get_with_retry(
                self._http,
                TOMTOM_SEARCH_URL.format(query=quote(query, safe="")),
                {
                    "key": self._api_key,
                    "typeahead": "true",
                    "limit": str(MAX_RESULTS),
                    "countrySet": "US",
                },
                service="TomTom Search",
                retry_delay_s=self._retry_delay_s,
            )
        except UpstreamFailed as exc:
            raise GeocodingError("Place search isn't available right now") from exc
        if response.status_code == 429:
            raise GeocodingError("Too many place searches; try again in a moment")
        if not response.is_success:
            raise GeocodingError("Place search isn't available right now")

        places = []
        try:
            for result in response.json()["results"]:
                position = result["position"]
                lat, lon = float(position["lat"]), float(position["lon"])
                places.append(
                    Place(
                        label=result["address"]["freeformAddress"],
                        lat=lat,
                        lon=lon,
                        timezone=timezone_at((lat, lon)).key,
                    )
                )
        except (KeyError, TypeError, ValueError) as exc:
            raise GeocodingError("Place search isn't available right now") from exc
        self._cache.set(key, places, CACHE_TTL_S)
        return places
